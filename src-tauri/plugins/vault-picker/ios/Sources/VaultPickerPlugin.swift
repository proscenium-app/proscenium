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

  deinit {
    for url in scoped {
      url.stopAccessingSecurityScopedResource()
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

  private func topViewController() -> UIViewController? {
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

@_cdecl("init_plugin_vault_picker")
func initPlugin() -> Plugin {
  return VaultPickerPlugin()
}
