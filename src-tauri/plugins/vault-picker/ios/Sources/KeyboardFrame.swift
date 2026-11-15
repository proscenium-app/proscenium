// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Tauri
import UIKit
import WebKit

class KeyboardArgs: Decodable {
  /// Keep the page where it is when a keyboard comes up.
  let pin: Bool
  /// The web view's scroll view in the log at each change: a probe build's.
  let log: Bool
}

extension VaultPickerPlugin {
  /// Watches the keyboard's frame from the moment the web view exists
  /// (docs/engineering/cross-platform.md#PLAT-77), and raises the plugin's
  /// `keyboard` event, `{inset}`, whenever what it covers changes. Resolves
  /// at once.
  @objc public func watchKeyboard(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(KeyboardArgs.self)
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      KeyboardFrame.shared.start(args, plugin: self)
    }
    invoke.resolve()
  }
}

/// How much of the page's window a docked keyboard covers, as UIKit lays the
/// keyboard out. Main thread only.
///
/// The page's visual viewport, which it read before, follows what WebKit makes
/// of the keyboard rather than the keyboard itself (a hardware keyboard's
/// suggestion bar moved it in WebKit's bug 247410, and WebKit's own scroll
/// moves it too). UIKit's keyboard layout guide, with undocked keyboards not
/// followed, is the docked keyboard's top, or the web view's bottom when there
/// is none: a hidden view held between the two is as tall as what the keyboard
/// covers, the screen's keyboard or a hardware keyboard's shortcut bar alike,
/// and 0 for a floating, split or hidden one.
///
/// WebKit scrolls its page up to show the line being typed when a keyboard
/// comes up. The page is a window, not a document: it is exactly as tall as
/// the web view's safe area, its chrome sits at its top and bottom, and it
/// scrolls inside its own panes, which ride above the keyboard by the inset.
/// So the page's own scroll is held at its top while the page is at its own
/// size, and only a page the writer has pinched larger may move.
final class KeyboardFrame {
  static let shared = KeyboardFrame()

  private weak var plugin: VaultPickerPlugin?
  private var args: KeyboardArgs?
  private weak var webview: WKWebView?
  private var probe: KeyboardProbe?
  private var reported: CGFloat?
  private var observers: [NSObjectProtocol] = []
  private var offsetWatch: NSKeyValueObservation?

  func start(_ args: KeyboardArgs, plugin: VaultPickerPlugin) {
    self.args = args
    self.plugin = plugin
    attach()
  }

  /// The web view, when Tauri hands it to the plugin.
  func found(_ webview: WKWebView) {
    self.webview = webview
    attach()
  }

  private func attach() {
    guard probe == nil, let args, let webview else { return }
    let host = webview.superview ?? webview
    let guide = webview.keyboardLayoutGuide
    guide.followsUndockedKeyboard = false
    guide.usesBottomSafeArea = false

    let probe = KeyboardProbe()
    probe.isHidden = true
    probe.isUserInteractionEnabled = false
    probe.translatesAutoresizingMaskIntoConstraints = false
    host.addSubview(probe)
    let top = probe.topAnchor.constraint(equalTo: guide.topAnchor)
    top.priority = .defaultHigh
    NSLayoutConstraint.activate([
      probe.leadingAnchor.constraint(equalTo: webview.leadingAnchor),
      probe.widthAnchor.constraint(equalToConstant: 1),
      probe.bottomAnchor.constraint(equalTo: webview.bottomAnchor),
      probe.heightAnchor.constraint(greaterThanOrEqualToConstant: 0),
      top,
    ])
    probe.changed = { [weak self] in self?.measure("layout") }
    self.probe = probe

    let names: [Notification.Name] = [
      UIResponder.keyboardWillShowNotification,
      UIResponder.keyboardDidShowNotification,
      UIResponder.keyboardWillHideNotification,
      UIResponder.keyboardDidHideNotification,
      UIResponder.keyboardWillChangeFrameNotification,
      UIResponder.keyboardDidChangeFrameNotification,
    ]
    for name in names {
      observers.append(
        NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) {
          [weak self] note in
          self?.probe?.superview?.layoutIfNeeded()
          self?.measure(note.name.rawValue)
        })
    }

    if args.pin {
      offsetWatch = webview.scrollView.observe(\.contentOffset, options: [.new]) {
        [weak self] scroll, _ in
        self?.hold(scroll)
      }
    }
    NSLog("Proscenium: watching the keyboard (pin: %@)", args.pin ? "yes" : "no")
    host.layoutIfNeeded()
    measure("start")
  }

  /// The page's own scroll, back at its top, unless the writer pinched the
  /// page larger.
  private func hold(_ scroll: UIScrollView) {
    guard scroll.zoomScale <= scroll.minimumZoomScale + 0.001 else { return }
    let top = CGPoint(x: -scroll.adjustedContentInset.left, y: -scroll.adjustedContentInset.top)
    if scroll.contentOffset != top {
      scroll.contentOffset = top
    }
  }

  /// What the keyboard covers of the page's own window, which ends above the
  /// web view's bottom safe area (the home indicator's strip): WebKit lays the
  /// page out inside the safe area, so a docked keyboard covers that much less
  /// of it than of the web view.
  private func measure(_ why: String) {
    guard let probe else { return }
    let bottom = webview?.safeAreaInsets.bottom ?? 0
    let inset = max(0, (probe.bounds.height - bottom).rounded())
    if args?.log == true, let scroll = webview?.scrollView {
      NSLog(
        "Proscenium: keyboard %@: inset %.0f (covers %.0f of the web view); scroll offset %@, inset %@, adjusted %@, zoom %.2f; web view %@",
        why, inset, probe.bounds.height, NSCoder.string(for: scroll.contentOffset),
        NSCoder.string(for: scroll.contentInset), NSCoder.string(for: scroll.adjustedContentInset),
        scroll.zoomScale, NSCoder.string(for: webview?.frame ?? .zero))
    }
    guard inset != reported else { return }
    reported = inset
    plugin?.trigger("keyboard", data: ["inset": Double(inset)])
  }
}

/// A hidden view whose height is what the keyboard covers; it says when that
/// changes.
final class KeyboardProbe: UIView {
  var changed: (() -> Void)?

  override var bounds: CGRect {
    didSet {
      if bounds.size != oldValue.size { changed?() }
    }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    changed?()
  }
}
