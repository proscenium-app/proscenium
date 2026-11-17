// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! The native menu bar (docs/engineering/design-system.md#UI-D107).
//!
//! A Mac app without a menu bar is a web page in a window: ⌘, does nothing,
//! Help has no Keyboard Shortcuts, and the only way to find out what the app
//! can do is to hunt the toolbar. This declares the six menus the handoff names
//! and hands every one of its own items to the frontend as a single event.
//!
//! **Rust decides nothing here.** Every item forwards an id to the webview over
//! `menu://action`, and `src/app/menu-actions.ts` is the only place that says
//! what an id means — the same rule as the rest of this crate, where Rust
//! stores bytes and TypeScript assigns meaning. It also means the menu bar and
//! the window's own keymap cannot drift into two different answers.
//!
//! The predefined items (Undo, Cut, Minimize, the app menu's About/Quit) stay
//! predefined so the OS wires them itself — a hand-rolled Copy is a Copy that
//! does not work in a native text field.
//!
//! An iPad has no Tauri menu, so the same tables go to iPadOS's main menu
//! instead (`ipad_menus`, docs/engineering/cross-platform.md#PLAT-76): the
//! picker plugin builds it, and an item chosen there raises the same event.

#[cfg(all(desktop, not(windows)))]
use tauri::menu::{AboutMetadata, PredefinedMenuItem};
#[cfg(desktop)]
use tauri::menu::{Menu, MenuItem, Submenu, SubmenuBuilder};
#[cfg(desktop)]
use tauri::Runtime;
use tauri::{AppHandle, Emitter};

/// The event a menu item raises. One channel, one payload: the item's id.
pub const EVENT_MENU_ACTION: &str = "menu://action";

/// `(id, label, accelerator)` — the accelerator is what macOS draws beside the
/// item, and the frontend binds the same chord at the window so both routes
/// work whether or not a menu takes it first.
type Item = (&'static str, &'static str, Option<&'static str>);

const FILE: &[Item] = &[
    ("new-play", "New Play…", Some("CmdOrCtrl+N")),
    ("import-draft", "Import a Draft…", Some("CmdOrCtrl+Shift+I")),
    ("open-vault", "Open Vault…", Some("CmdOrCtrl+O")),
    ("all-plays", "All Plays", Some("CmdOrCtrl+Shift+O")),
    ("", "", None), // separator
    ("save", "Save", Some("CmdOrCtrl+S")),
    ("reveal", "Reveal in Finder", None),
    ("", "", None),
    ("export-pdf", "Export PDF…", Some("CmdOrCtrl+Shift+E")),
    // docs/app/formatting/formats-and-layout.md#FMT-145: the same dialog, on a word processor's file.
    ("export-docx", "Export .docx…", None),
    ("export-odt", "Export .odt…", None),
    ("print", "Print…", Some("CmdOrCtrl+P")),
];

const SCRIPT: &[Item] = &[
    ("el-act", "Act", Some("CmdOrCtrl+Alt+1")),
    ("el-scene", "Scene", Some("CmdOrCtrl+Alt+2")),
    ("el-sceneHeading", "Scene Heading", Some("CmdOrCtrl+Alt+S")),
    ("el-action", "Action", Some("CmdOrCtrl+Alt+A")),
    ("el-character", "Character", Some("CmdOrCtrl+Alt+C")),
    ("el-parenthetical", "Parenthetical", Some("CmdOrCtrl+Alt+P")),
    ("el-dialogue", "Dialogue", Some("CmdOrCtrl+Alt+D")),
    ("el-transition", "Transition", Some("CmdOrCtrl+Alt+T")),
    ("el-lyric", "Lyric", Some("CmdOrCtrl+Alt+L")),
    ("", "", None),
    ("mark-strong", "Bold", Some("CmdOrCtrl+B")),
    ("mark-em", "Italic", Some("CmdOrCtrl+I")),
    ("mark-underline", "Underline", Some("CmdOrCtrl+U")),
    ("", "", None),
    ("line-break", "Line Break", Some("Shift+Enter")),
    ("page-break", "Page Break", Some("CmdOrCtrl+Enter")),
    ("", "", None),
    ("spelling-next", "Next Misspelling", Some("CmdOrCtrl+;")),
    ("", "", None),
    // The same words as the script-name menu in the page (src/app/Toolbar.tsx):
    // one sheet, one name. The menu bar said Edit Title Page… for it.
    ("title-page", "Edit Opening Pages…", None),
    // The same words as the script-name menu in the page (src/app/Toolbar.tsx).
    (
        "cast-names",
        "Capitalize Character Names in Directions…",
        None,
    ),
];

const VIEW: &[Item] = &[
    ("view-script", "Script", Some("CmdOrCtrl+1")),
    ("view-corkboard", "Board", Some("CmdOrCtrl+2")),
    ("view-outliner", "Outline", Some("CmdOrCtrl+3")),
    // `&&` is one `&`: a lone one marks a mnemonic, which the Mac's menu
    // strips and a PC's underlines (`ipad_item` reads it the same way).
    ("view-cast", "Cast && Pages", Some("CmdOrCtrl+4")),
    ("view-changes", "Changes", Some("CmdOrCtrl+5")),
    ("", "", None),
    ("toggle-binder", "Binder", Some("CmdOrCtrl+Alt+B")),
    ("toggle-inspector", "Inspector", Some("CmdOrCtrl+Alt+I")),
    ("toggle-comments", "Comments", Some("CmdOrCtrl+Shift+C")),
    ("", "", None),
    ("split-row", "Split Side by Side", None),
    ("split-col", "Split Top and Bottom", None),
    // The focused pane, when it is one of several. A pane has its own close
    // box too; this is the one a writer finds from the menu bar and the one
    // that needs no pointer.
    ("close-pane", "Close Pane", None),
    ("", "", None),
    ("zoom-in", "Zoom In", Some("CmdOrCtrl+Plus")),
    ("zoom-out", "Zoom Out", Some("CmdOrCtrl+-")),
    ("zoom-actual", "Actual Size", Some("CmdOrCtrl+0")),
    ("zoom-fit-width", "Fit Width", None),
    ("zoom-fit-page", "Fit Page", None),
    ("", "", None),
    ("focus", "Focus", Some("Ctrl+Cmd+F")),
];

const PLAY: &[Item] = &[
    ("view-cast", "Cast && Pages", None),
    ("history", "Versions…", None),
    ("", "", None),
    ("find", "Find…", Some("CmdOrCtrl+F")),
    ("find-replace", "Find and Replace…", Some("CmdOrCtrl+Alt+F")),
    ("goto-scene", "Go to Scene…", Some("CmdOrCtrl+Shift+J")),
    ("scene-prev", "Previous Scene", Some("Cmd+Alt+Up")),
    ("scene-next", "Next Scene", Some("Cmd+Alt+Down")),
    ("", "", None),
    ("comment", "Comment", Some("CmdOrCtrl+Alt+M")),
];

/// Settings…, in the app's own menu on a Mac and an iPad, in File on a PC.
#[cfg_attr(windows, allow(dead_code))]
const SETTINGS: Item = ("settings", "Settings…", Some("CmdOrCtrl+,"));

const HELP: &[Item] = &[
    ("tutorials", "Tutorials", None),
    ("shortcuts", "Keyboard Shortcuts", Some("CmdOrCtrl+/")),
    ("", "", None),
    // docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D5: plain text a writer reads before pasting,
    // and a GitHub issue they edit before submitting. Nothing is sent from here.
    ("copy-diagnostics", "Copy Diagnostics", None),
    ("report-problem", "Send Feedback…", None),
];

/// The chord a PC's menu shows beside an item, as `src/ui/keys.ts` writes the
/// Mac's on a PC (`src/ui/keys.test.ts` holds the two together). Ctrl where a
/// Mac has ⌘, and no Ctrl+Alt, which is AltGr on many keyboards. Import a
/// Draft has none: Ctrl+Shift+I is the Inspector's there.
#[cfg_attr(not(windows), allow(dead_code))]
pub const PC_KEYS: &[(&str, &str)] = &[
    ("new-play", "Ctrl+N"),
    ("open-vault", "Ctrl+O"),
    ("all-plays", "Ctrl+Shift+O"),
    ("save", "Ctrl+S"),
    ("export-pdf", "Ctrl+Shift+E"),
    ("print", "Ctrl+P"),
    ("settings", "Ctrl+,"),
    ("el-act", "Ctrl+Shift+1"),
    ("el-scene", "Ctrl+Shift+2"),
    ("el-sceneHeading", "Ctrl+Shift+S"),
    ("el-action", "Ctrl+Shift+A"),
    ("el-character", "Ctrl+Shift+C"),
    ("el-parenthetical", "Ctrl+Shift+P"),
    ("el-dialogue", "Ctrl+Shift+D"),
    ("el-transition", "Ctrl+Shift+T"),
    ("el-lyric", "Ctrl+Shift+L"),
    ("mark-strong", "Ctrl+B"),
    ("mark-em", "Ctrl+I"),
    ("mark-underline", "Ctrl+U"),
    ("line-break", "Shift+Enter"),
    ("page-break", "Ctrl+Enter"),
    ("spelling-next", "Ctrl+;"),
    ("view-script", "Ctrl+1"),
    ("view-corkboard", "Ctrl+2"),
    ("view-outliner", "Ctrl+3"),
    ("view-cast", "Ctrl+4"),
    ("view-changes", "Ctrl+5"),
    ("toggle-binder", "Ctrl+Shift+B"),
    ("toggle-inspector", "Ctrl+Shift+I"),
    ("toggle-comments", "Ctrl+Shift+M"),
    ("zoom-in", "Ctrl++"),
    ("zoom-out", "Ctrl+-"),
    ("zoom-actual", "Ctrl+0"),
    ("focus", "Ctrl+Shift+F"),
    ("find", "Ctrl+F"),
    ("find-replace", "Ctrl+H"),
    ("goto-scene", "Ctrl+Shift+J"),
    ("scene-prev", "Ctrl+PageUp"),
    ("scene-next", "Ctrl+PageDown"),
    ("comment", "Ctrl+M"),
    ("shortcuts", "Ctrl+/"),
];

/// The chord an iPad's menu takes for an item, where it is not the Mac's, as
/// `src/ui/keys.ts` writes it there (`IPAD_CHORDS`; `src/ui/keys.test.ts`
/// holds the two together): iPadOS keeps ⌘⌥D for its Dock, and nothing the
/// app asks for wins it back, so Dialogue is ⌘⇧D, which nothing of the Mac's
/// uses.
#[cfg_attr(not(any(target_os = "ios", test)), allow(dead_code))]
pub const IPAD_KEYS: &[(&str, &str)] = &[("el-dialogue", "CmdOrCtrl+Shift+D")];

/// Build one submenu from a table, turning `("", "", None)` into a separator.
#[cfg(desktop)]
fn build<R: Runtime>(app: &AppHandle<R>, title: &str, items: &[Item]) -> tauri::Result<Submenu<R>> {
    let mut b = SubmenuBuilder::new(app, title);
    for (id, label, accel) in items {
        if id.is_empty() {
            b = b.separator();
        } else {
            b = b.item(&item(app, id, label, *accel)?);
        }
    }
    b.build()
}

/// One item. On a Mac its chord is the menu's accelerator. On Windows the
/// chord is only drawn beside it: WebView2 holds the keyboard, so the page
/// binds every chord at the window (use-shell-commands.ts), and an
/// accelerator the window did see would be a second press of the same key.
#[cfg(desktop)]
fn item<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    label: &str,
    accel: Option<&str>,
) -> tauri::Result<MenuItem<R>> {
    #[cfg(windows)]
    {
        let _ = accel;
        let label = match PC_KEYS.iter().find(|(i, _)| *i == id) {
            Some((_, keys)) => format!("{}\t{keys}", pc_label(label)),
            None => pc_label(label),
        };
        MenuItem::with_id(app, id, label, true, None::<&str>)
    }
    #[cfg(not(windows))]
    MenuItem::with_id(app, id, label, true, accel)
}

/// A label in a PC's words, where the Mac's names its own things.
#[cfg(windows)]
fn pc_label(label: &str) -> String {
    label.replace("Finder", "File Explorer")
}

/// Windows' menu bar: the same items under the same names, with File ending
/// in Settings and Exit, About and updates under Help, and no Window menu,
/// whose items are the title bar's. Exit, like the close box, is a quit the
/// page is asked about first (quit.rs); the predefined Quit would end the
/// app without asking.
#[cfg(windows)]
pub fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let file = {
        let mut b = SubmenuBuilder::new(app, "&File");
        for (id, label, accel) in FILE {
            b = if id.is_empty() {
                b.separator()
            } else {
                b.item(&item(app, id, label, *accel)?)
            };
        }
        b.separator()
            .item(&item(app, "settings", "Settings…", None)?)
            .separator()
            .item(&MenuItem::with_id(app, QUIT, "E&xit", true, None::<&str>)?)
            .build()?
    };
    let edit = SubmenuBuilder::new(app, "&Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let help = {
        let mut b = SubmenuBuilder::new(app, "&Help");
        for (id, label, accel) in HELP {
            b = if id.is_empty() {
                b.separator()
            } else {
                b.item(&item(app, id, label, *accel)?)
            };
        }
        b = b.separator();
        // Only a copy that updates itself offers to: not the Microsoft
        // Store's, which runs from its package and which the Store updates.
        #[cfg(feature = "updater")]
        if crate::packaged::family().is_none() {
            b = b.item(&MenuItem::with_id(
                app,
                "check-updates",
                "Check for Updates…",
                true,
                None::<&str>,
            )?);
        }
        b.item(&MenuItem::with_id(
            app,
            "about",
            "About Proscenium",
            true,
            None::<&str>,
        )?)
        .build()?
    };
    Menu::with_items(
        app,
        &[
            &file,
            &edit,
            &build(app, "&Script", SCRIPT)?,
            &build(app, "&View", VIEW)?,
            &build(app, "&Play", PLAY)?,
            &help,
        ],
    )
}

/// Exit's id: the one item Rust answers itself, since a quit is the gate's.
#[cfg_attr(not(windows), allow(dead_code))]
pub const QUIT: &str = "quit";

#[cfg(all(desktop, not(windows)))]
pub fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let (id, label, accel) = SETTINGS;
    let settings = MenuItem::with_id(app, id, label, true, accel)?;
    let app_menu = SubmenuBuilder::new(app, "Proscenium").about(Some(AboutMetadata::default()));
    // Where a Mac app puts it, under About (docs/engineering/release-engineering.md#REL-D6). Only a
    // build that can update itself offers to.
    #[cfg(feature = "updater")]
    let app_menu = app_menu.item(&MenuItem::with_id(
        app,
        "check-updates",
        "Check for Updates…",
        true,
        None::<&str>,
    )?);
    let app_menu = app_menu
        .separator()
        .item(&settings)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    // Undo/Cut/Copy/Paste stay PREDEFINED: the OS wires them to whatever has
    // focus, including a native text field, which a hand-rolled item cannot.
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .separator()
        .close_window()
        .build()?;

    Menu::with_items(
        app,
        &[
            &app_menu,
            &build(app, "File", FILE)?,
            &edit,
            &build(app, "Script", SCRIPT)?,
            &build(app, "View", VIEW)?,
            &build(app, "Play", PLAY)?,
            &window,
            &build(app, "Help", HELP)?,
        ],
    )
}

/// Forward the item's id to the webview. Nothing is decided here, but for
/// Windows' Exit, which asks the quit gate as the close box does.
pub fn on_menu_event(app: &AppHandle, id: &str) {
    #[cfg(windows)]
    if id == QUIT {
        crate::quit::close_requested(app);
        return;
    }
    let _ = app.emit(EVENT_MENU_ACTION, id.to_string());
}

// --- The iPad's main menu -----------------------------------------------------

/// What the Mac's menus hold that an iPad cannot do: it has no Finder to
/// reveal a play in. Check for Updates and the Window menu are not in the
/// tables: TestFlight and the App Store update an iPad, and iPadOS keeps its
/// windows' commands for itself.
#[cfg(any(target_os = "ios", test))]
const NOT_ON_AN_IPAD: &[&str] = &["reveal"];

/// What an iPad's View menu carries that a Mac's does not: ⌃⇥ and ⌃⇧⇥, which
/// move between the window's areas
/// (docs/app/preferences-and-help/accessibility.md#A11Y-7). A Mac's page and a
/// PC's take them themselves; on an iPad UIKit keeps Control-Tab, and the page
/// hears the Control key alone. So the menu takes them, its Tab key commands
/// put before the system's own behaviour (MainMenu.swift), and gives them back
/// as `next-area` and `previous-area`, which the page runs as its own ⌃⇥.
#[cfg(any(target_os = "ios", test))]
const IPAD_AREAS: &[Item] = &[
    ("", "", None),
    ("next-area", "Next Area", Some("Ctrl+Tab")),
    ("previous-area", "Previous Area", Some("Ctrl+Shift+Tab")),
];

/// The Mac's menus as iPadOS's main menu takes them
/// (docs/engineering/cross-platform.md#PLAT-76), in the Mac's order: the same
/// items, ids and chords. Each menu is either one the system already has
/// (`application`, `file`, `edit`, `view`, `window`, `help`), which the app's
/// items go into, or one of the app's own (Script, Play), which goes after the
/// one before it. Edit and Window carry nothing: as on a Mac, Undo, Cut, Copy,
/// Paste and Select All are the system's, wired to whatever has focus, and
/// the system's window commands stay its own. They are listed so the app's own
/// menus land where a Mac has them.
#[cfg(any(target_os = "ios", test))]
pub fn ipad_menus() -> Vec<tauri_plugin_vault_picker::MenuSpec> {
    let menu =
        |title: &str, system: Option<&str>, items: &[Item]| tauri_plugin_vault_picker::MenuSpec {
            title: title.into(),
            system: system.map(Into::into),
            items: items
                .iter()
                .filter(|(id, _, _)| !NOT_ON_AN_IPAD.contains(id))
                .map(|&(id, label, accel)| ipad_item(id, label, ipad_accel(id, accel)))
                .collect(),
        };
    let view: Vec<Item> = VIEW.iter().chain(IPAD_AREAS).copied().collect();
    vec![
        menu("Proscenium", Some("application"), &[SETTINGS]),
        menu("File", Some("file"), FILE),
        menu("Edit", Some("edit"), &[]),
        menu("Script", None, SCRIPT),
        menu("View", Some("view"), &view),
        menu("Play", None, PLAY),
        menu("Window", Some("window"), &[]),
        menu("Help", Some("help"), HELP),
    ]
}

/// An item's chord on an iPad: the Mac's, but where iPadOS keeps it for
/// itself (`IPAD_KEYS`), the one the page binds there instead.
#[cfg(any(target_os = "ios", test))]
fn ipad_accel(id: &str, mac: Option<&'static str>) -> Option<&'static str> {
    match IPAD_KEYS.iter().find(|(item, _)| *item == id) {
        Some((_, ipad)) => Some(ipad),
        None => mac,
    }
}

/// One item of the iPad's menu: an id of `""` is a separator, as in the tables.
#[cfg(any(target_os = "ios", test))]
fn ipad_item(
    id: &str,
    label: &str,
    accel: Option<&str>,
) -> tauri_plugin_vault_picker::MenuItemSpec {
    let (key, modifiers) = match accel.and_then(ipad_chord) {
        Some((key, modifiers)) => (Some(key), modifiers),
        None => (None, Vec::new()),
    };
    tauri_plugin_vault_picker::MenuItemSpec {
        id: id.into(),
        // A menu bar writes a lone `&` as `&&`; UIKit takes the words as they are.
        label: label.replace("&&", "&"),
        key,
        modifiers,
    }
}

/// An accelerator as UIKit's key commands take it: the key, a character or
/// `return`, `tab`, `up` or `down`, and its modifiers, `command`, `shift`, `alternate`
/// and `control`. `None` for anything else, which the tests refuse, so no
/// chord is lost on the way to the iPad.
#[cfg(any(target_os = "ios", test))]
fn ipad_chord(accel: &str) -> Option<(String, Vec<String>)> {
    let mut modifiers = Vec::new();
    let mut key = None;
    for part in accel.split('+') {
        let named = match part {
            "CmdOrCtrl" | "CommandOrControl" | "Cmd" | "Command" => Some("command"),
            "Shift" => Some("shift"),
            "Alt" | "Option" => Some("alternate"),
            "Ctrl" | "Control" => Some("control"),
            _ => None,
        };
        if let Some(modifier) = named {
            modifiers.push(modifier.to_string());
            continue;
        }
        if key.is_some() {
            return None;
        }
        key = Some(match part {
            "Plus" => "+".to_string(),
            "Enter" | "Return" => "return".to_string(),
            "Tab" => "tab".to_string(),
            "Up" => "up".to_string(),
            "Down" => "down".to_string(),
            one if one.chars().count() == 1 => one.to_lowercase(),
            _ => return None,
        });
    }
    Some((key?, modifiers))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One sheet, one name: the script-name menu in the page calls the sheet
    /// for the title page, the characters page and the opening notes "Edit
    /// Opening Pages…" (src/app/Toolbar.tsx, held by src/app/menu-names.test.ts),
    /// and the menu bar says the same.
    #[test]
    fn the_opening_pages_sheet_has_one_name() {
        let (_, label, _) = SCRIPT
            .iter()
            .find(|(id, _, _)| *id == "title-page")
            .expect("the Script menu opens the opening pages sheet");
        assert_eq!(*label, "Edit Opening Pages…");
    }

    /// The File menu's New Play… carries ⌘N, which the Plays screen's own
    /// New Play menu shows beside Blank Play: the page answers the item.
    #[test]
    fn new_play_is_command_n() {
        let (_, _, accel) = FILE
            .iter()
            .find(|(id, _, _)| *id == "new-play")
            .expect("the File menu has New Play…");
        assert_eq!(*accel, Some("CmdOrCtrl+N"));
    }

    /// Every chord of the Mac's menus reaches the iPad's: an accelerator the
    /// iPad could not read would leave its item there with no chord.
    #[test]
    fn every_chord_reaches_the_ipad() {
        for (id, _, accel) in FILE
            .iter()
            .chain(SCRIPT)
            .chain(VIEW)
            .chain(PLAY)
            .chain(HELP)
            .chain([&SETTINGS])
        {
            if let Some(accel) = accel {
                assert!(
                    ipad_chord(accel).is_some(),
                    "{id}: {accel} has no iPad chord"
                );
            }
        }
    }

    #[test]
    fn chords_are_written_as_uikit_takes_them() {
        let chord = |a: &str| ipad_chord(a).expect(a);
        let words = |m: &[&str]| m.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(chord("CmdOrCtrl+N"), ("n".into(), words(&["command"])));
        assert_eq!(
            chord("CmdOrCtrl+Shift+I"),
            ("i".into(), words(&["command", "shift"]))
        );
        assert_eq!(
            chord("CmdOrCtrl+Alt+D"),
            ("d".into(), words(&["command", "alternate"]))
        );
        assert_eq!(
            chord("Ctrl+Cmd+F"),
            ("f".into(), words(&["control", "command"]))
        );
        assert_eq!(chord("Shift+Enter"), ("return".into(), words(&["shift"])));
        assert_eq!(
            chord("CmdOrCtrl+Enter"),
            ("return".into(), words(&["command"]))
        );
        assert_eq!(
            chord("Cmd+Alt+Up"),
            ("up".into(), words(&["command", "alternate"]))
        );
        assert_eq!(chord("CmdOrCtrl+Plus"), ("+".into(), words(&["command"])));
        assert_eq!(chord("CmdOrCtrl+-"), ("-".into(), words(&["command"])));
        assert_eq!(chord("CmdOrCtrl+;"), (";".into(), words(&["command"])));
        assert_eq!(chord("CmdOrCtrl+,"), (",".into(), words(&["command"])));
        assert_eq!(ipad_chord("CmdOrCtrl+Space+X"), None);
        assert_eq!(ipad_chord("CmdOrCtrl+Shift"), None);
    }

    /// A lone `&` is a mnemonic to a menu bar, stripped on a Mac and underlined
    /// on a PC, so an ampersand is written `&&`; the iPad, which takes words as
    /// they are, gets one back. Cast && Pages read "Cast  Pages" otherwise.
    #[test]
    fn an_ampersand_is_written_twice_and_read_once() {
        for (_, label, _) in FILE
            .iter()
            .chain(SCRIPT)
            .chain(VIEW)
            .chain(PLAY)
            .chain(HELP)
        {
            let lone = label.replace("&&", "");
            assert!(!lone.contains('&'), "a lone & in {label:?}");
        }
        let view = ipad_menus()
            .into_iter()
            .find(|m| m.title == "View")
            .unwrap();
        assert!(view.items.iter().any(|i| i.label == "Cast & Pages"));
    }

    /// The iPad's menu is the Mac's, item for item, but for Reveal in Finder,
    /// in the Mac's order, with Settings… in the app's own menu, and the View
    /// menu's ⌃⇥ and ⌃⇧⇥ after the Mac's own (`IPAD_AREAS`).
    #[test]
    fn the_ipad_carries_the_macs_menus() {
        let menus = ipad_menus();
        let titles: Vec<&str> = menus.iter().map(|m| m.title.as_str()).collect();
        assert_eq!(
            titles,
            [
                "Proscenium",
                "File",
                "Edit",
                "Script",
                "View",
                "Play",
                "Window",
                "Help"
            ]
        );
        let ids = |title: &str| -> Vec<String> {
            menus
                .iter()
                .find(|m| m.title == title)
                .unwrap()
                .items
                .iter()
                .map(|i| i.id.clone())
                .collect()
        };
        let mac = |items: &[Item]| -> Vec<String> {
            items
                .iter()
                .map(|(id, _, _)| id.to_string())
                .filter(|id| id != "reveal")
                .collect()
        };
        assert_eq!(ids("File"), mac(FILE));
        assert_eq!(ids("Script"), mac(SCRIPT));
        let view: Vec<Item> = VIEW.iter().chain(IPAD_AREAS).copied().collect();
        assert_eq!(ids("View"), mac(&view));
        assert_eq!(ids("Play"), mac(PLAY));
        assert_eq!(ids("Help"), mac(HELP));
        assert_eq!(ids("Proscenium"), ["settings"]);
        assert!(ids("Edit").is_empty() && ids("Window").is_empty());
        assert!(menus
            .iter()
            .flat_map(|m| &m.items)
            .all(|i| i.id != "reveal"));
        let settings = &menus[0].items[0];
        assert_eq!(settings.key.as_deref(), Some(","));
        assert_eq!(settings.modifiers, ["command"]);
    }

    /// iPadOS keeps ⌘⌥D for its Dock, so the iPad's menu takes Dialogue at
    /// ⌘⇧D, as the page binds it there (`IPAD_KEYS`, src/ui/keys.ts), and
    /// every other item at the Mac's own chord.
    #[test]
    fn the_ipad_takes_dialogue_at_command_shift_d() {
        let menus = ipad_menus();
        let items: Vec<_> = menus.iter().flat_map(|m| &m.items).collect();
        let dialogue = items.iter().find(|i| i.id == "el-dialogue").unwrap();
        assert_eq!(dialogue.key.as_deref(), Some("d"));
        assert_eq!(dialogue.modifiers, ["command", "shift"]);
        let character = items.iter().find(|i| i.id == "el-character").unwrap();
        assert_eq!(character.modifiers, ["command", "alternate"]);
        let chords: Vec<_> = items
            .iter()
            .filter_map(|i| i.key.as_ref().map(|k| (k.clone(), i.modifiers.clone())))
            .collect();
        let mut unique = chords.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(
            unique.len(),
            chords.len(),
            "two of the iPad's items share a chord"
        );
        assert!(!chords
            .iter()
            .any(|(k, m)| k == "d" && *m == ["command", "alternate"]));
    }

    /// ⌃⇥ and ⌃⇧⇥ in the iPad's View menu, which UIKit keeps from the page,
    /// and in no menu of a Mac's, whose page takes them itself.
    #[test]
    fn the_ipad_menu_moves_between_the_areas() {
        let menus = ipad_menus();
        let view = menus.iter().find(|m| m.title == "View").unwrap();
        let next = view.items.iter().find(|i| i.id == "next-area").unwrap();
        assert_eq!(next.key.as_deref(), Some("tab"));
        assert_eq!(next.modifiers, ["control"]);
        let previous = view.items.iter().find(|i| i.id == "previous-area").unwrap();
        assert_eq!(previous.key.as_deref(), Some("tab"));
        assert_eq!(previous.modifiers, ["control", "shift"]);
        for table in [FILE, SCRIPT, VIEW, PLAY, HELP] {
            assert!(!table.iter().any(|(id, _, _)| id.ends_with("-area")));
        }
    }
}
