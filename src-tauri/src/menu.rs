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

use tauri::menu::{
    AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu, SubmenuBuilder,
};
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
    ("title-page", "Edit Title Page…", None),
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

/// Build one submenu from a table, turning `("", "", None)` into a separator.
fn build<R: Runtime>(
    app: &AppHandle<R>,
    title: &str,
    items: &[Item],
) -> tauri::Result<Submenu<R>> {
    let mut b = SubmenuBuilder::new(app, title);
    for (id, label, accel) in items {
        if id.is_empty() {
            b = b.separator();
        } else {
            b = b.item(&MenuItem::with_id(app, *id, *label, true, *accel)?);
        }
    }
    b.build()
}

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

/// Forward the item's id to the webview. Nothing is decided here.
pub fn on_menu_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    let _ = app.emit(EVENT_MENU_ACTION, id.to_string());
}
