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

#[cfg(not(windows))]
use tauri::menu::{AboutMetadata, PredefinedMenuItem};
use tauri::menu::{Menu, MenuItem, Submenu, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Runtime};

/// The event a menu item raises. One channel, one payload: the item's id.
pub const EVENT_MENU_ACTION: &str = "menu://action";

/// `(id, label, accelerator)` — the accelerator is what macOS draws beside the
/// item, and the frontend binds the same chord at the window so both routes
/// work whether or not the menu bar exists (iOS has none).
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
];

const VIEW: &[Item] = &[
    ("view-script", "Script", Some("CmdOrCtrl+1")),
    ("view-corkboard", "Board", Some("CmdOrCtrl+2")),
    ("view-outliner", "Outline", Some("CmdOrCtrl+3")),
    ("view-cast", "Cast", Some("CmdOrCtrl+4")),
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
    ("view-cast", "Cast", None),
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

/// Build one submenu from a table, turning `("", "", None)` into a separator.
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
        #[cfg(feature = "updater")]
        {
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

#[cfg(not(windows))]
pub fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, Some("CmdOrCtrl+,"))?;
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
}
