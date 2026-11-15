// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Tauri
import UIKit

class MenuItemArgs: Decodable {
  /// What the page is told; empty for a separator.
  let id: String
  let label: String
  /// A character, or `return`, `up` or `down`.
  let key: String?
  /// `command`, `shift`, `alternate`, `control`.
  let modifiers: [String]
}

class MenuSpecArgs: Decodable {
  let title: String
  /// The system's own menu the items go into, or none for one of the app's.
  let system: String?
  let items: [MenuItemArgs]
}

class MenuRequestArgs: Decodable {
  let menus: [MenuSpecArgs]
  /// iPadOS 17 to 25's key commands, even on a later iPadOS: a probe build's.
  let legacy: Bool
  /// The menu in the log as the system gave it and as built: a probe build's.
  let log: Bool
}

extension VaultPickerPlugin {
  /// iPadOS's main menu, built from the Mac's menus as Rust hands them over
  /// (docs/engineering/cross-platform.md#PLAT-76). An item chosen there, by
  /// its chord or in the menu bar, is raised as the plugin's `menu` event
  /// with its id, and Rust tells the page as the Mac's menu bar does.
  /// Resolves at once: the menu is built on the main thread.
  @objc public func installMenu(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(MenuRequestArgs.self)
    DispatchQueue.main.async { [weak self] in
      MainMenu.shared.plugin = self
      MainMenu.shared.install(args)
    }
    invoke.resolve()
  }
}

extension UIApplication {
  /// Where every item of the app's menus lands, whatever has focus: UIKit
  /// sends a menu's action up the responder chain from the focused view, and
  /// the application is on every chain.
  @objc func prosceniumMenuItem(_ sender: UICommand) {
    MainMenu.shared.chosen(sender)
  }
}

/// The app's menus in iPadOS's main menu. Main thread only.
///
/// - **iPadOS 26 and later:** the main menu system, configured once, which
///   iPadOS shows as its menu bar and, while ⌘ is held, as the list of
///   shortcuts. The system's own document, printing, finding, formatting,
///   sidebar, toolbar and inspector items are left out: the app's items carry
///   those commands under the Mac's names and chords (⌘N, ⌘S, ⌘P, ⌘F, ⌘B),
///   and the system's would be second copies answering the same chords. So is
///   its Spelling menu: the app's own checker marks words, and its Next
///   Misspelling takes ⌘;. Edit's Undo, Cut, Copy, Paste and Select All stay
///   the system's, as on a Mac.
/// - **iPadOS 17 to 25:** no menu bar, and building the main menu there means
///   overriding the app delegate's `buildMenu(with:)`, which is tao's. So each
///   chord is a key command on the window's root view controller, which is on
///   the responder chain whenever the page has focus, and iPadOS lists it with
///   its title while ⌘ is held. An item with no chord has nowhere to be.
final class MainMenu {
  static let shared = MainMenu()

  weak var plugin: VaultPickerPlugin?
  private var legacyCommands: [UIKeyCommand] = []
  private weak var legacyHost: UIViewController?

  func install(_ request: MenuRequestArgs) {
    if #available(iOS 26.0, *), !request.legacy {
      configure(request)
      return
    }
    legacyCommands = request.menus.flatMap { menu in
      menu.items.compactMap { item -> UIKeyCommand? in
        guard !item.id.isEmpty, let command = Self.element(item, in: menu) as? UIKeyCommand
        else { return nil }
        command.discoverabilityTitle = item.label
        return command
      }
    }
    NSLog("Proscenium: %d key commands for iPadOS 17 to 25", legacyCommands.count)
    attachLegacy(to: nil)
  }

  /// The key commands, on the window's root view controller once there is
  /// one: the web view, which the controller holds, may come after the menu.
  func attachLegacy(to controller: UIViewController?) {
    guard !legacyCommands.isEmpty,
      let host = controller ?? plugin?.manager.viewController,
      host !== legacyHost
    else { return }
    for command in legacyCommands {
      host.addKeyCommand(command)
    }
    legacyHost = host
    NSLog("Proscenium: key commands on %@", String(describing: type(of: host)))
  }

  func chosen(_ command: UICommand) {
    guard let list = command.propertyList as? [String: String], let id = list["id"] else {
      return
    }
    plugin?.trigger("menu", data: ["id": id])
  }

  // MARK: - iPadOS 26 and later

  @available(iOS 26.0, *)
  private func configure(_ request: MenuRequestArgs) {
    let configuration = UIMainMenuSystem.Configuration()
    configuration.newScenePreference = .removed
    configuration.documentPreference = .removed
    configuration.printingPreference = .removed
    configuration.findingPreference = .removed
    configuration.toolbarPreference = .removed
    configuration.sidebarPreference = .removed
    configuration.inspectorPreference = .removed
    configuration.textFormattingPreference = .removed
    UIMainMenuSystem.shared.setBuildConfiguration(configuration) { builder in
      MainMenu.build(request, into: builder)
    }
  }

  /// The app's menus into the system's, in the Mac's order: a system menu
  /// takes the app's items at its start, and a menu of the app's own goes
  /// after the one before it.
  private static func build(_ request: MenuRequestArgs, into builder: UIMenuBuilder) {
    if request.log { log(builder, "as the system gives it") }
    builder.remove(menu: .spelling)
    // A document's Open… and Open Recent, which iPadOS offers an app that
    // declares document types: the app opens a Plays folder, by Open Vault…,
    // which takes ⌘O. Beside the system's ⌘O, iPadOS dropped the File menu's
    // group that holds Open Vault… whole.
    builder.remove(menu: .open)
    builder.remove(menu: .openRecent)
    var previous: UIMenu.Identifier?
    for menu in request.menus {
      let groups = Self.groups(menu)
      let system = menu.system.flatMap(Self.systemMenu)
      if system == .application {
        if !groups.isEmpty, builder.menu(for: .application) != nil {
          let settings = UIMenu(
            title: "", identifier: own("settings"), options: .displayInline, children: groups)
          if builder.menu(for: .preferences) != nil {
            builder.replace(menu: .preferences, with: settings)
          } else if builder.menu(for: .about) != nil {
            builder.insertSibling(settings, afterMenu: .about)
          } else {
            builder.insertChild(settings, atStartOfMenu: .application)
          }
        }
        previous = .application
      } else if let system, builder.menu(for: system) != nil {
        for group in groups.reversed() {
          builder.insertChild(group, atStartOfMenu: system)
        }
        previous = system
      } else if !groups.isEmpty {
        let mine = UIMenu(title: menu.title, identifier: own(menu.title), children: groups)
        if let previous {
          builder.insertSibling(mine, afterMenu: previous)
        } else {
          builder.insertSibling(mine, beforeMenu: .edit)
        }
        previous = mine.identifier
      }
    }
    if request.log { log(builder, "as built") }
  }

  private static func systemMenu(_ name: String) -> UIMenu.Identifier? {
    switch name {
    case "application": return .application
    case "file": return .file
    case "edit": return .edit
    case "view": return .view
    case "window": return .window
    case "help": return .help
    default: return nil
    }
  }

  private static func own(_ name: String) -> UIMenu.Identifier {
    UIMenu.Identifier("org.habiby.proscenium.menu.\(name.lowercased())")
  }

  // MARK: - Items

  /// A menu's items in groups, split where the Mac's menu has a separator.
  private static func groups(_ menu: MenuSpecArgs) -> [UIMenu] {
    var groups: [[UIMenuElement]] = [[]]
    for item in menu.items {
      if item.id.isEmpty {
        groups.append([])
      } else {
        groups[groups.count - 1].append(element(item, in: menu))
      }
    }
    return groups.filter { !$0.isEmpty }.map {
      UIMenu(title: "", options: .displayInline, children: $0)
    }
  }

  /// One item: a key command where it has a chord, a command where not. The
  /// menu's title goes with the id, since an item may be in two menus (Cast is
  /// in View and in Play) and the main menu takes no command twice.
  private static func element(_ item: MenuItemArgs, in menu: MenuSpecArgs) -> UIMenuElement {
    let list = ["id": item.id, "menu": menu.title]
    let action = #selector(UIApplication.prosceniumMenuItem(_:))
    guard let input = input(item.key) else {
      return UICommand(title: item.label, action: action, propertyList: list)
    }
    let command = UIKeyCommand(
      title: item.label, action: action, input: input, modifierFlags: flags(item.modifiers),
      propertyList: list)
    // UIKit's own keyboard navigation takes Control-Tab before the page hears
    // its Tab, and the menu's Next Area and Previous Area are those chords
    // (menu.rs, IPAD_AREAS): a Tab key command goes before it.
    if input == "\t" { command.wantsPriorityOverSystemBehavior = true }
    return command
  }

  private static func input(_ key: String?) -> String? {
    switch key {
    case .none: return nil
    case "return"?: return "\r"
    case "tab"?: return "\t"
    case "up"?: return UIKeyCommand.inputUpArrow
    case "down"?: return UIKeyCommand.inputDownArrow
    case let key?: return key
    }
  }

  private static func flags(_ names: [String]) -> UIKeyModifierFlags {
    var flags: UIKeyModifierFlags = []
    for name in names {
      switch name {
      case "command": flags.insert(.command)
      case "shift": flags.insert(.shift)
      case "alternate": flags.insert(.alternate)
      case "control": flags.insert(.control)
      default: break
      }
    }
    return flags
  }

  // MARK: - What a probe build says

  /// The main menu's top level, each item with its chord, in the log: a line
  /// for each menu, since the log cuts a long one short.
  private static func log(_ builder: UIMenuBuilder, _ stage: String) {
    let tops: [UIMenu.Identifier] = [
      .application, .file, .edit, .format, .view, .window, .help,
      own("file"), own("script"), own("view"), own("play"), own("help"),
    ]
    for id in tops {
      guard let menu = builder.menu(for: id) else { continue }
      var lines: [String] = []
      describe(menu.children, depth: 1, into: &lines)
      NSLog(
        "Proscenium: the main menu %@, %@:\n%@", stage,
        menu.title.isEmpty ? id.rawValue : menu.title, lines.joined(separator: "\n"))
    }
  }

  private static func describe(_ elements: [UIMenuElement], depth: Int, into lines: inout [String]) {
    let indent = String(repeating: "  ", count: depth)
    for element in elements {
      if let menu = element as? UIMenu {
        if menu.options.contains(.displayInline) {
          lines.append("\(indent)--")
          describe(menu.children, depth: depth, into: &lines)
        } else {
          lines.append("\(indent)\(menu.title) ›")
          describe(menu.children, depth: depth + 1, into: &lines)
        }
      } else if let command = element as? UIKeyCommand {
        lines.append("\(indent)\(command.title)  \(chord(command))")
      } else if let command = element as? UICommand {
        lines.append("\(indent)\(command.title)")
      } else if let action = element as? UIAction {
        lines.append("\(indent)\(action.title) (action)")
      } else {
        lines.append("\(indent)\(element.title)")
      }
    }
  }

  private static func chord(_ command: UIKeyCommand) -> String {
    let flags = command.modifierFlags
    var text = ""
    if flags.contains(.control) { text += "⌃" }
    if flags.contains(.alternate) { text += "⌥" }
    if flags.contains(.shift) { text += "⇧" }
    if flags.contains(.command) { text += "⌘" }
    switch command.input {
    case "\r"?: text += "↩"
    case "\t"?: text += "⇥"
    case UIKeyCommand.inputUpArrow?: text += "↑"
    case UIKeyCommand.inputDownArrow?: text += "↓"
    case let input?: text += input.uppercased()
    case .none: break
    }
    return text
  }
}
