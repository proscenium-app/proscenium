// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation
import ObjectiveC
import Tauri
import UIKit

extension VaultPickerPlugin {
  /// The files opened from Files since launch: `{files: [{path, inPlace,
  /// held}]}`.
  @objc public func openedFiles(_ invoke: Invoke) throws {
    DispatchQueue.main.async {
      invoke.resolve(["files": OpenedFiles.list()])
    }
  }
}

/// A file a writer opened in Proscenium from Files, read through the grant
/// Files gave with it (docs/engineering/cross-platform.md#PLAT-78). Main
/// thread only.
///
/// The app opens documents in place (`LSSupportsOpeningDocumentsInPlace`), so
/// Files hands over the file itself, wherever it is, rather than a copy in the
/// app's Inbox, as a URL that carries the grant to read it. A URL made again
/// from its path carries none, and the read meets EPERM. The app's delegate is
/// tao's, which passes on only the URL's text (`application:openURL:options:`,
/// tao 0.35), so the plugin takes the URL there first: it starts the URL's
/// access, keeps the URL and a bookmark of it for as long as the app runs, as
/// the Plays folder's grant is kept, and lets tao go on as before, so Rust's
/// read of the path finds the grant in place.
enum OpenedFiles {
  private struct Held {
    let url: URL
    let inPlace: Bool
    let held: Bool
    /// The grant in a form that outlives the URL, taken while access is open.
    let bookmark: Data?
  }

  private static var files: [Held] = []
  private static var installed = false

  /// Puts the plugin in front of tao's `application:openURL:options:`. Once,
  /// when the plugin starts: Tauri starts its plugins before UIKit starts the
  /// app, and tao has declared its delegate's class by then, so the first
  /// file, the one a launch from Files brings, passes through here too.
  static func install() {
    guard !installed else { return }
    installed = true
    let selector = NSSelectorFromString("application:openURL:options:")
    guard let delegate: AnyClass = NSClassFromString("AppDelegate"),
      let method = class_getInstanceMethod(delegate, selector)
    else {
      NSLog("Proscenium: no app delegate to take an opened file's grant from")
      return
    }
    typealias OpenURL =
      @convention(c) (AnyObject, Selector, AnyObject?, NSURL?, NSDictionary?) -> Bool
    let tao = unsafeBitCast(method_getImplementation(method), to: OpenURL.self)
    let ours: @convention(block) (AnyObject, AnyObject?, NSURL?, NSDictionary?) -> Bool = {
      this, application, url, options in
      if let url { take(url as URL, options: options) }
      return tao(this, selector, application, url, options)
    }
    method_setImplementation(method, imp_implementationWithBlock(ours))
  }

  private static func take(_ url: URL, options: NSDictionary?) {
    guard url.isFileURL else { return }
    let key = UIApplication.OpenURLOptionsKey.openInPlace.rawValue
    let inPlace = (options?[key] as? NSNumber)?.boolValue ?? false
    // A copy in the app's own Inbox needs no grant, and has none to start.
    let held = url.startAccessingSecurityScopedResource()
    let bookmark = held ? try? url.bookmarkData() : nil
    files.append(Held(url: url, inPlace: inPlace, held: held, bookmark: bookmark))
    NSLog(
      "Proscenium: opened %@ (in place: %@, its grant held: %@)", url.lastPathComponent,
      inPlace ? "yes" : "no", held ? "yes" : "no")
  }

  static func list() -> [JsonObject] {
    files.map { ["path": $0.url.path, "inPlace": $0.inPlace, "held": $0.held] }
  }
}
