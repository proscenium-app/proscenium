// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation
import Tauri
import UIKit

class ShareArgs: Decodable {
  let path: String
}

class PrintArgs: Decodable {
  let path: String
  let jobTitle: String
}

class UrlArgs: Decodable {
  let url: String
}

class TextArgs: Decodable {
  let text: String
}

class TaskArgs: Decodable {
  let id: Int
}

class PathArgs: Decodable {
  let path: String
}

class CoordinateArgs: Decodable {
  let path: String
  /// `list`, `read` or `replace`.
  let access: String
  /// How long to wait for the coordinator to grant access.
  let waitMs: Int?
  /// How long a granted access may be held before it is given back anyway.
  let holdMs: Int?
}

class TokenArgs: Decodable {
  let token: Int
}

/// What the app asks of the iPad beside the folder picker: the share sheet and
/// the print panel for an export, Safari for a link, the pasteboard, time to
/// finish as the app leaves, and coordinated access to files in iCloud Drive.
///
/// Rust calls each of these from a command or a thread of its own, never from
/// the main thread, and Tauri runs a plugin's methods on one serial queue: so a
/// method never blocks that queue waiting for UIKit or for Rust. UIKit work
/// goes to the main queue; a coordination waits on a thread of its own.
extension VaultPickerPlugin {
  // MARK: - An export leaves the iPad

  /// The share sheet for an exported file: Files, a printer, Mail, AirDrop.
  /// No Save panel on an iPad names a path, so this is where an export goes
  /// (docs/engineering/cross-platform.md#PLAT-36). Resolves when the sheet
  /// closes: `{completed, activity}`, `completed` false when the writer
  /// dismissed it without choosing anything.
  @objc public func shareFile(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(ShareArgs.self)
    let url = URL(fileURLWithPath: args.path)
    DispatchQueue.main.async { [weak self] in
      guard let presenter = self?.topViewController() else {
        invoke.reject("no view controller available to present the share sheet")
        return
      }
      let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
      sheet.completionWithItemsHandler = { activity, completed, _, error in
        if let error {
          invoke.reject("the share sheet could not finish: \(error.localizedDescription)")
          return
        }
        invoke.resolve(["completed": completed, "activity": activity?.rawValue ?? ""])
      }
      // On an iPad the sheet is a popover, which needs somewhere to stand.
      Self.center(sheet.popoverPresentationController, in: presenter.view)
      presenter.present(sheet, animated: true)
      NSLog("Proscenium: the share sheet is up for %@", url.lastPathComponent)
    }
  }

  /// The system's print panel for an exported PDF. Resolves once the panel is
  /// up, as a Mac's does: printing and cancelling are the panel's.
  @objc public func printFile(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(PrintArgs.self)
    let url = URL(fileURLWithPath: args.path)
    DispatchQueue.main.async { [weak self] in
      guard let presenter = self?.topViewController(), let view = presenter.view else {
        invoke.reject("no view controller available to present the print panel")
        return
      }
      guard UIPrintInteractionController.canPrint(url) else {
        invoke.reject("the PDF cannot be printed")
        return
      }
      let info = UIPrintInfo(dictionary: nil)
      info.jobName = args.jobTitle
      info.outputType = .general
      let panel = UIPrintInteractionController.shared
      panel.printInfo = info
      panel.printingItem = url
      let middle = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
      let shown = panel.present(from: middle, in: view, animated: true) { _, _, _ in
        try? FileManager.default.removeItem(at: url)
      }
      shown ? invoke.resolve() : invoke.reject("the print panel did not open")
    }
  }

  // MARK: - A link opens in Safari

  /// One of the app's own pages, in Safari. Only `https`: Rust passes nothing
  /// but the fixed addresses in its allowlist.
  @objc public func openUrl(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(UrlArgs.self)
    guard let url = URL(string: args.url), url.scheme == "https" else {
      invoke.reject("only an https address opens in Safari")
      return
    }
    DispatchQueue.main.async {
      UIApplication.shared.open(url, options: [:]) { opened in
        opened ? invoke.resolve() : invoke.reject("Safari did not open the page")
      }
    }
  }

  // MARK: - The pasteboard

  /// Copy Diagnostics and feedback's Copy, written from Rust, as on a Mac: a
  /// page may write the clipboard only inside a click in the page.
  @objc public func copyText(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(TextArgs.self)
    DispatchQueue.main.async {
      UIPasteboard.general.string = args.text
      invoke.resolve()
    }
  }

  // MARK: - Time to finish as the app leaves

  /// Time from iOS to finish what the page is saving as the app leaves the
  /// front (docs/app/keeping-work/storage-and-file-format.md#STOR-D13).
  /// Resolves `{id}`. If iOS's time runs out first, it is given back at once,
  /// so iOS never ends the app for holding on.
  ///
  /// Asked and answered on the caller's thread, never the main queue's: iOS
  /// lets a background task be begun and ended from any thread, and the app
  /// asks for one as it leaves the front, when the main queue may not turn
  /// again before iOS suspends it. Answered there, the page was told to keep
  /// its words only once the app came back, and words typed in autosave's
  /// wait before leaving were not on disk while it was away.
  @objc public func beginBackgroundTask(_ invoke: Invoke) throws {
    let id = BackgroundTasks.shared.begin()
    invoke.resolve(["id": id])
  }

  /// Gives the time back, on the caller's thread too. An id iOS already took
  /// back is no harm.
  @objc public func endBackgroundTask(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(TaskArgs.self)
    BackgroundTasks.shared.end(args.id)
    invoke.resolve()
  }

  // MARK: - Which copy this is

  /// Which copy this is, and on which iPadOS: `{testflight, systemVersion}`.
  /// TestFlight's builds carry a sandbox receipt, the App Store's a receipt of
  /// its own, and a copy installed by hand none at all. The version is
  /// iPadOS's major, minor and, when there is one, patch number.
  @objc public func storeFacts(_ invoke: Invoke) throws {
    let receipt = Bundle.main.appStoreReceiptURL
    let testflight =
      receipt?.lastPathComponent == "sandboxReceipt"
      && FileManager.default.fileExists(atPath: receipt?.path ?? "")
    let os = ProcessInfo.processInfo.operatingSystemVersion
    let version =
      os.patchVersion == 0
      ? "\(os.majorVersion).\(os.minorVersion)"
      : "\(os.majorVersion).\(os.minorVersion).\(os.patchVersion)"
    invoke.resolve(["testflight": testflight, "systemVersion": version])
  }

  // MARK: - Coordinated access in iCloud Drive

  /// Whether a folder is in iCloud Drive (a ubiquitous item), where every read
  /// and write goes through a file coordinator. A folder on the iPad itself is
  /// not, and pays nothing.
  @objc public func isUbiquitous(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(PathArgs.self)
    let url = URL(fileURLWithPath: args.path)
    let values = try? url.resourceValues(forKeys: [.isUbiquitousItemKey])
    invoke.resolve(["ubiquitous": values?.isUbiquitousItem == true])
  }

  /// Begins coordinated access to a file or folder in iCloud Drive, as Apple
  /// asks of a folder picked through the document picker
  /// (docs/engineering/cross-platform.md#PLAT-12). On a thread of its own the
  /// coordinator is asked for access; once it grants it, this resolves
  /// `{token, path}` with the URL the coordinator gave, and the access is held
  /// while Rust lists, reads or writes, until `endCoordinated` with that token.
  /// The write itself stays Rust's one atomic writer: the coordinator only says
  /// when it may run.
  ///
  /// `list` asks for what is already known of a folder's contents and fetches
  /// nothing; `read` waits for an evicted file to come down; `replace` is a
  /// write that puts a new file in the old one's place.
  @objc public func beginCoordinated(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(CoordinateArgs.self)
    let url = URL(fileURLWithPath: args.path)
    let wait = Double(args.waitMs ?? 20_000) / 1000.0
    let hold = DispatchTimeInterval.milliseconds(args.holdMs ?? 60_000)
    let lease = Coordinations.shared.open()
    let coordinator = NSFileCoordinator(filePresenter: nil)
    let granted = DispatchSemaphore(value: 0)

    Thread.detachNewThread {
      var failure: NSError?
      let accessor: (URL) -> Void = { given in
        granted.signal()
        invoke.resolve(["token": lease.token, "path": given.path])
        // Held until Rust is done, or for `hold` at most: a Rust thread that
        // died must not keep iCloud Drive waiting for ever.
        _ = lease.done.wait(timeout: .now() + hold)
      }
      switch args.access {
      case "list":
        coordinator.coordinate(
          readingItemAt: url, options: .immediatelyAvailableMetadataOnly, error: &failure,
          byAccessor: accessor)
      case "read":
        coordinator.coordinate(
          readingItemAt: url, options: [], error: &failure, byAccessor: accessor)
      case "replace":
        coordinator.coordinate(
          writingItemAt: url, options: .forReplacing, error: &failure, byAccessor: accessor)
      default:
        granted.signal()
        invoke.reject("unknown access \(args.access)")
      }
      Coordinations.shared.close(lease.token)
      if let failure {
        granted.signal()
        invoke.reject("coordinated access failed: \(failure.localizedDescription)")
      }
    }

    // A grant that does not come within `wait` (a file that cannot come down,
    // with no network) is cancelled: Rust is told, and says the file has not
    // finished downloading rather than waiting for ever.
    DispatchQueue.global(qos: .userInitiated).async {
      if granted.wait(timeout: .now() + wait) == .timedOut {
        coordinator.cancel()
      }
    }
  }

  /// Ends a coordinated access: the coordinator's block returns.
  @objc public func endCoordinated(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(TokenArgs.self)
    Coordinations.shared.finish(args.token)
    invoke.resolve()
  }

  // MARK: - The app's own iCloud container

  /// The app's own iCloud container, which iCloud Drive shows as Proscenium on
  /// every device, as the Mac's is (docs/engineering/cross-platform.md#PLAT-8):
  /// `{path}`, the container's own folder, or `{path: null}` where there is
  /// none to be had: no iCloud account, iCloud Drive off, or the app turned off
  /// in iCloud's settings. The first container named in the app's entitlements
  /// is asked for, on a queue of its own, as Apple asks: the first answer can
  /// take a while, and the plugin's queue is never held for it. The app's own
  /// container needs no grant.
  @objc public func cloudContainer(_ invoke: Invoke) throws {
    DispatchQueue.global(qos: .userInitiated).async {
      let url = FileManager.default.url(forUbiquityContainerIdentifier: nil)
      invoke.resolve(["path": url?.path])
    }
  }

  // MARK: - Helpers

  /// A popover anchored in the middle of `view`, with no arrow.
  static func center(_ popover: UIPopoverPresentationController?, in view: UIView?) {
    guard let popover, let view else { return }
    popover.sourceView = view
    popover.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
    popover.permittedArrowDirections = []
  }
}

/// The background tasks the app holds, by id. Begun and ended from any thread
/// (the app's leave path is a thread of its own), and iOS calls a task's
/// expiry on the main thread, so the table is behind a lock.
final class BackgroundTasks {
  static let shared = BackgroundTasks()
  private let lock = NSLock()
  private var tasks: [Int: UIBackgroundTaskIdentifier] = [:]
  /// Ids whose task is being asked for, and those of them already ended: an
  /// expiry that came before the task was in the table.
  private var beginning: Set<Int> = []
  private var ended: Set<Int> = []
  private var next = 1

  func begin() -> Int {
    lock.lock()
    let id = next
    next += 1
    beginning.insert(id)
    lock.unlock()
    let task = UIApplication.shared.beginBackgroundTask(
      withName: "Proscenium keeps what was typed"
    ) { [weak self] in
      self?.end(id)
    }
    lock.lock()
    beginning.remove(id)
    let endedAlready = ended.remove(id) != nil
    if !endedAlready { tasks[id] = task }
    lock.unlock()
    if endedAlready, task != .invalid {
      UIApplication.shared.endBackgroundTask(task)
    }
    return id
  }

  func end(_ id: Int) {
    lock.lock()
    let task = tasks.removeValue(forKey: id)
    if task == nil, beginning.contains(id) { ended.insert(id) }
    lock.unlock()
    if let task, task != .invalid {
      UIApplication.shared.endBackgroundTask(task)
    }
  }
}

/// Coordinated accesses being held, each released by its token.
final class Coordinations {
  static let shared = Coordinations()

  struct Lease {
    let token: Int
    let done: DispatchSemaphore
  }

  private let lock = NSLock()
  private var held: [Int: DispatchSemaphore] = [:]
  private var next = 1

  func open() -> Lease {
    lock.lock()
    defer { lock.unlock() }
    let lease = Lease(token: next, done: DispatchSemaphore(value: 0))
    next += 1
    held[lease.token] = lease.done
    return lease
  }

  func finish(_ token: Int) {
    lock.lock()
    let done = held[token]
    lock.unlock()
    done?.signal()
  }

  func close(_ token: Int) {
    lock.lock()
    held.removeValue(forKey: token)
    lock.unlock()
  }
}
