// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import SwiftRs
import Tauri
import UIKit
import UniformTypeIdentifiers
import WebKit

class ResolveArgs: Decodable {
  let bookmark: String
}

class MaterializeArgs: Decodable {
  let path: String
  let timeoutMs: Int?
}

class DownloadArgs: Decodable {
  let path: String
  /// The most files and folders one pass looks at.
  let most: Int?
}

/// The folder picker and bookmark store for the vault.
///
/// **Why this plugin exists.** `tauri-plugin-dialog` implements *file* pickers on
/// iOS but not a **folder** picker (tauri-apps/plugins-workspace#933), and a
/// Proscenium vault is a folder. Everything here is Apple's ordinary
/// out-of-sandbox document flow: the writer grants access by choosing a folder,
/// and a bookmark makes that grant survive relaunch.
///
/// **No entitlement is involved, and that is the point.** Because access comes
/// from the picker rather than from an iCloud container, the vault can live
/// anywhere the Files app can reach — iCloud Drive, a Möbius/Syncthing folder,
/// On My iPad — so the app stays out of the sync business exactly as
/// cross-platform.md intends. It also means no paid-membership capability is
/// required, and the same shape ports to Android's SAF tree picker.
class VaultPickerPlugin: Plugin, UIDocumentPickerDelegate {
  /// The picker is presented asynchronously and answered in a delegate
  /// callback, so the invoke has to outlive the call that started it.
  private var pending: Invoke?

  /// Scoped URLs we hold open for the process lifetime. `startAccessing…` is
  /// balanced by `stopAccessing…` in `deinit` — dropping the scope while a vault
  /// is open would fail every subsequent read, so the app keeps it for as long
  /// as it runs.
  private var scoped: [URL] = []

  /// The page's theme colour, watched for as long as the web view lives.
  private var themeWatch: NSKeyValueObservation?

  /// Before the app has launched, Tauri starts its plugins: the one moment a
  /// file opened from Files can be taken before tao hands it on
  /// (OpenedFiles.swift).
  override init() {
    super.init()
    OpenedFiles.install()
    // SystemBridge.swift's commands (share, print, open a link, copy,
    // coordinated access, background tasks, the iCloud container) are @objc
    // methods Tauri finds by selector, which no code names, and the linker
    // takes a file of a static library only for a symbol something names.
    // These two are that file's, so the file and every command in it are
    // linked. Without them it came in only by chance, for a type's metadata
    // emitted there, and a new file that took the metadata left all of its
    // commands out of the app (scripts/ipad/plugin-commands.mjs checks).
    _ = BackgroundTasks.shared
    _ = Coordinations.shared
  }

  deinit {
    for url in scoped {
      url.stopAccessingSecurityScopedResource()
    }
  }

  /// The web view and its controller exist: the keyboard is watched against
  /// the one, and on iPadOS 17 to 25 the menu's key commands go on the other.
  /// The page's chrome is painted behind it (docs/engineering/cross-platform.md#PLAT-80).
  override func load(webview: WKWebView) {
    let controller = manager.viewController
    DispatchQueue.main.async { [weak self] in
      KeyboardFrame.shared.found(webview)
      MainMenu.shared.attachLegacy(to: controller)
      self?.paintChrome(of: webview)
    }
  }

  /// The page lies inside the web view's safe area, so what is outside it, the
  /// strip iPadOS keeps above the toolbar for its status bar and window
  /// controls and the home indicator's below the status bar, shows what is
  /// behind the page: the system's white or black. The page names its chrome
  /// as its theme colour, light or dark as it is (src/ui/use-accent.ts), and
  /// that is painted behind it, so those strips read as the app's bars.
  private func paintChrome(of webview: WKWebView) {
    themeWatch = webview.observe(\.themeColor, options: [.initial, .new]) { web, _ in
      guard let chrome = web.themeColor else { return }
      web.backgroundColor = chrome
      web.scrollView.backgroundColor = chrome
      web.underPageBackgroundColor = chrome
    }
  }

  /// Present the system folder picker. Resolves `{path, bookmark}`, or `null`
  /// when the writer cancels — never an error, since cancelling is a normal
  /// answer and the frontend treats null as "no change".
  @objc public func pickFolder(_ invoke: Invoke) throws {
    if pending != nil {
      invoke.reject("a folder picker is already open")
      return
    }
    pending = invoke

    DispatchQueue.main.async { [weak self] in
      guard let self else { return }

      // asCopy: false is load-bearing — a copy would hand us a throwaway
      // duplicate in our own container instead of the writer's real folder,
      // and nothing would ever sync.
      let picker = UIDocumentPickerViewController(
        forOpeningContentTypes: [UTType.folder],
        asCopy: false
      )
      picker.delegate = self
      picker.allowsMultipleSelection = false

      guard let presenter = self.topViewController() else {
        self.finish { $0.reject("no view controller available to present the picker") }
        return
      }
      presenter.present(picker, animated: true)
    }
  }

  /// Re-open a folder granted in an earlier launch. Resolves `{path, bookmark}`
  /// where `bookmark` may be **refreshed** — iOS marks a bookmark stale when the
  /// item moves or the provider re-registers it, and the caller must persist the
  /// replacement or the grant is lost on the launch after next.
  @objc public func resolveBookmark(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(ResolveArgs.self)

    guard let data = Data(base64Encoded: args.bookmark) else {
      invoke.reject("stored bookmark is not valid base64")
      return
    }

    var stale = false
    let url: URL
    do {
      // NB: `.withSecurityScope` is a macOS-only option. On iOS a bookmark made
      // from a scoped URL resolves back to a scoped URL on its own, so passing
      // no options is correct here rather than merely tolerated.
      url = try URL(
        resolvingBookmarkData: data,
        options: [],
        relativeTo: nil,
        bookmarkDataIsStale: &stale
      )
    } catch {
      invoke.reject("could not resolve the stored folder: \(error.localizedDescription)")
      return
    }

    guard url.startAccessingSecurityScopedResource() else {
      invoke.reject("access to the stored folder was refused")
      return
    }
    scoped.append(url)

    // Hand back a refreshed bookmark when iOS says the old one is stale; the
    // folder is open right now, so this is the one moment it can be renewed.
    var bookmark = args.bookmark
    if stale, let renewed = try? url.bookmarkData() {
      bookmark = renewed.base64EncodedString()
    }
    invoke.resolve(["path": url.path, "bookmark": bookmark])
  }

  /// Bring an evicted iCloud file back to the device before it is read.
  ///
  /// **Why this is not optional.** iCloud evicts file contents it thinks are not
  /// needed, leaving only a stub. A synced vault on a fresh iPad is therefore a
  /// tree of *names* whose bytes are elsewhere, and a plain read fails. Without
  /// this the app would decide the writer's plays were missing, and storage §9
  /// reconciliation would faithfully report them as such — a frightening lie
  /// about someone's work.
  ///
  /// Resolves `{ready: bool}`. `ready: false` means "not available yet", never
  /// "gone": the caller reports a file it could not fetch rather than treating
  /// absence as deletion.
  @objc public func materialize(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(MaterializeArgs.self)
    let url = URL(fileURLWithPath: args.path)
    let deadline = Date().addingTimeInterval(Double(args.timeoutMs ?? 20_000) / 1000.0)

    // Already local, or not an iCloud item at all (an On My iPad vault, or a
    // genuinely missing file). Either way there is nothing to wait for, so
    // answer immediately rather than burning the timeout.
    switch Self.downloadState(of: url) {
    case .current:
      invoke.resolve(["ready": true])
      return
    case .notUbiquitous:
      invoke.resolve(["ready": FileManager.default.fileExists(atPath: args.path)])
      return
    case .pending:
      break
    }

    do {
      try FileManager.default.startDownloadingUbiquitousItem(at: url)
    } catch {
      invoke.reject("could not start downloading \(url.lastPathComponent): \(error.localizedDescription)")
      return
    }

    // Poll rather than use NSMetadataQuery: the query wants a run loop and a
    // long-lived observer, while a read is a one-shot question with a caller
    // already waiting on an answer. Off the main thread so the UI keeps drawing
    // during the wait.
    DispatchQueue.global(qos: .userInitiated).async {
      while Date() < deadline {
        if Self.downloadState(of: url) == .current {
          invoke.resolve(["ready": true])
          return
        }
        Thread.sleep(forTimeInterval: 0.15)
      }
      // Timed out. Not an error — the network may simply be slow, and saying so
      // lets the caller surface "not downloaded yet" instead of "lost".
      invoke.resolve(["ready": false])
    }
  }

  /// Ask iCloud for everything in a folder that is not on this iPad yet
  /// (docs/engineering/cross-platform.md#PLAT-69).
  ///
  /// **Why the app asks.** Since iPadOS 16.4 iCloud Drive keeps what it has
  /// not brought down as dataless items: a folder nothing has looked into has
  /// no entries on the iPad at all, and a file's bytes stay in the cloud. A
  /// listing coordinated with `.immediatelyAvailableMetadataOnly` waits for
  /// neither, and `materialize` asks for one file the vault already knows to
  /// read. So a Plays folder nothing had looked into listed as play folders with
  /// nothing in them, no play was found, and the writer was left to download
  /// the folder by hand in Files.
  ///
  /// One pass walks the folder a folder at a time. Each folder is listed inside
  /// a coordinated read with no options, which waits for iCloud to say what is
  /// in it (Apple's own sample for a picked folder reads it so, and a read of a
  /// folder brings that folder's listing down, not its whole tree), and is
  /// given up after ten seconds without an answer, the whole pass after thirty.
  /// Each file in it that is not current is asked for by
  /// `startDownloadingUbiquitousItem`, one file at a time, since asking for a
  /// folder is not documented to reach what is inside it; a stub
  /// `.<name>.icloud`, the older form, asks for the file it stands for. It
  /// waits for none of the files; the page asks again, and finds what came down
  /// by listing and reading as before. A file changed on another device is not
  /// current either (`.downloaded`: a copy older than the cloud's), so the same
  /// passes keep the folder up to date while it is open.
  ///
  /// Resolves `{ubiquitous, waiting}`: whether iCloud Drive keeps the folder,
  /// and how much was asked for or could not be looked into yet, 0 when
  /// everything is here. A file whose download failed is not waited for, and
  /// one whose state iCloud does not say is not counted, so a pass never says
  /// "downloading" for ever.
  @objc public func downloadFolder(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(DownloadArgs.self)
    let root = URL(fileURLWithPath: args.path)
    let most = args.most ?? 5_000
    // Off the plugin's queue: each folder's read may wait for iCloud.
    DispatchQueue.global(qos: .utility).async {
      let ubiquitous =
        (try? root.resourceValues(forKeys: [.isUbiquitousItemKey]))?.isUbiquitousItem == true
      guard ubiquitous else {
        invoke.resolve(["ubiquitous": false, "waiting": 0])
        return
      }
      invoke.resolve(["ubiquitous": true, "waiting": Self.askForEverything(in: root, most: most)])
    }
  }

  /// The walk: how many files were asked for, and folders not looked into yet.
  private static func askForEverything(in root: URL, most: Int) -> Int {
    let fm = FileManager.default
    let deadline = Date().addingTimeInterval(30)
    var waiting = 0
    var seen = 0
    var folders: [(URL, Int)] = [(root, 0)]
    while let next = folders.popLast() {
      let (folder, depth) = next
      // Out of time: what is left is still to look into, next pass.
      guard Date() < deadline, let entries = listed(folder, wait: 10) else {
        waiting += 1
        continue
      }
      for url in entries {
        seen += 1
        if seen > most { return waiting }
        let name = url.lastPathComponent
        // `.<name>.icloud`, with a name in it: "..icloud" stands for nothing.
        if name.hasPrefix("."), name.hasSuffix(".icloud"), name.count > ".icloud".count + 1 {
          let real = url.deletingLastPathComponent()
            .appendingPathComponent(String(name.dropFirst().dropLast(".icloud".count)))
          if (try? fm.startDownloadingUbiquitousItem(at: real)) != nil { waiting += 1 }
          continue
        }
        if (try? url.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory == true {
          if depth < 12 { folders.append((url, depth + 1)) }
          continue
        }
        if waitingFor(url), (try? fm.startDownloadingUbiquitousItem(at: url)) != nil {
          waiting += 1
        }
      }
    }
    return waiting
  }

  /// A folder's entries, hidden ones too, listed inside a coordinated read that
  /// waits for iCloud to say what is in it: nil when it has not said in `wait`.
  private static func listed(_ folder: URL, wait: TimeInterval) -> [URL]? {
    let coordinator = NSFileCoordinator(filePresenter: nil)
    let granted = DispatchSemaphore(value: 0)
    DispatchQueue.global(qos: .utility).async {
      if granted.wait(timeout: .now() + wait) == .timedOut { coordinator.cancel() }
    }
    var entries: [URL]?
    var failure: NSError?
    coordinator.coordinate(readingItemAt: folder, options: [], error: &failure) { given in
      granted.signal()
      entries = try? FileManager.default.contentsOfDirectory(
        at: given,
        includingPropertiesForKeys: [
          .isDirectoryKey, .isUbiquitousItemKey, .ubiquitousItemDownloadingStatusKey,
          .ubiquitousItemDownloadingErrorKey,
        ],
        options: []
      )
    }
    if failure != nil { granted.signal() }
    return entries
  }

  /// Whether iCloud says an item is not current here and is still coming:
  /// never for one whose state it does not say, or whose download failed.
  private static func waitingFor(_ url: URL) -> Bool {
    guard
      let values = try? url.resourceValues(forKeys: [
        .isUbiquitousItemKey, .ubiquitousItemDownloadingStatusKey,
        .ubiquitousItemDownloadingErrorKey,
      ]),
      values.isUbiquitousItem == true,
      values.ubiquitousItemDownloadingError == nil,
      let status = values.ubiquitousItemDownloadingStatus
    else { return false }
    return status != .current
  }

  private enum DownloadState {
    case current
    case pending
    case notUbiquitous
  }

  private static func downloadState(of url: URL) -> DownloadState {
    let keys: Set<URLResourceKey> = [
      .ubiquitousItemDownloadingStatusKey,
      .isUbiquitousItemKey,
    ]
    guard let values = try? url.resourceValues(forKeys: keys) else {
      // Resource values fail on a path with no local stub at all — nothing is
      // known about it, so let the download attempt be the judge.
      return .pending
    }
    if values.isUbiquitousItem != true {
      return .notUbiquitous
    }
    return values.ubiquitousItemDownloadingStatus == .current ? .current : .pending
  }

  // MARK: - UIDocumentPickerDelegate

  func documentPicker(
    _ controller: UIDocumentPickerViewController,
    didPickDocumentsAt urls: [URL]
  ) {
    guard let url = urls.first else {
      finish { $0.resolve() }
      return
    }

    guard url.startAccessingSecurityScopedResource() else {
      finish { $0.reject("access to the chosen folder was refused") }
      return
    }

    // Bookmark while the scope is open — outside it, this throws.
    let bookmark: Data
    do {
      bookmark = try url.bookmarkData()
    } catch {
      url.stopAccessingSecurityScopedResource()
      finish { $0.reject("could not remember the chosen folder: \(error.localizedDescription)") }
      return
    }

    scoped.append(url)
    finish {
      $0.resolve(["path": url.path, "bookmark": bookmark.base64EncodedString()])
    }
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    finish { $0.resolve() }
  }

  // MARK: - Helpers

  /// Answer the outstanding invoke exactly once, then clear it — a second
  /// delegate callback (cancel arriving after a pick, say) must not resolve a
  /// dead invoke.
  private func finish(_ body: (Invoke) -> Void) {
    guard let invoke = pending else { return }
    pending = nil
    body(invoke)
  }

  /// The controller a sheet or panel is presented from: the window's root, or
  /// whatever it is already presenting. SystemBridge.swift presents from it too.
  func topViewController() -> UIViewController? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    let windows = scenes.flatMap(\.windows)
    let window = windows.first(where: \.isKeyWindow) ?? windows.first

    var controller = window?.rootViewController
    while let presented = controller?.presentedViewController {
      controller = presented
    }
    return controller
  }
}

// Public: a release build with Xcode 27's linker refuses a `@_cdecl` entry
// point that is not, and costs nothing with Xcode 26.
@_cdecl("init_plugin_vault_picker")
public func initPlugin() -> Plugin {
  return VaultPickerPlugin()
}
