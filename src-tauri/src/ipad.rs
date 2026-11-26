// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! What only the iPad's build does (docs/engineering/cross-platform.md#PLAT-D103):
//!
//! - **The page reaches nothing.** WebKit's content rules, which refuse every
//!   request the page makes to another host, are in the window's web view
//!   before the page has a byte of its own, as on a Mac
//!   (docs/engineering/cross-platform.md#PLAT-62).
//! - **Leaving the app keeps the words.** iOS suspends an app the writer
//!   leaves, and may end it later without a word to it, so leaving is a quit
//!   that may come back: the page settles as for a quit while the app holds
//!   time from iOS to finish (docs/app/keeping-work/storage-and-file-format.md#STOR-D13).
//! - **In iCloud Drive, access is coordinated.** Every listing, read and
//!   replace the vault makes in a folder iCloud syncs goes through a file
//!   coordinator, through the folder-picker plugin (vault/coordination.rs).
//! - **Which copy this is.** TestFlight's or the App Store's. Which iPadOS,
//!   the reports ask of the system themselves, at launch (telemetry/mod.rs).
//! - **The menu bar carries the Mac's menu.** iPadOS's main menu is built from
//!   the Mac's tables, and an item chosen there, by a click or its chord,
//!   raises the same `menu://action` the Mac's menu bar does
//!   (docs/engineering/cross-platform.md#PLAT-76).
//! - **The keyboard's own frame.** How much of the page a docked keyboard
//!   covers, as UIKit says, goes to the page as `app://keyboard`
//!   (docs/engineering/cross-platform.md#PLAT-77).
//! - **A file opened from Files** is read through the grant Files gave with
//!   it, coordinated as the Plays folder's files are
//!   (docs/engineering/cross-platform.md#PLAT-78).
//!
//! Every call to the plugin blocks its caller until the iPad answers, and some
//! answers need the main thread, so none is made from it: each runs on a
//! command's worker or a thread of its own.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::Duration;

use serde::Serialize;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter};
use tauri_plugin_vault_picker::{KeyboardRequest, MenuRequest, VaultPickerExt};

use crate::vault::coordination::{self, Access, Coordinator, Lease};

// --- The page reaches nothing ------------------------------------------------

/// Builds the main window once WebKit has compiled the content rules, and adds
/// them to its web view in the same turn of the main thread that makes it.
///
/// Tauri takes a ready WebKit configuration only on a Mac, so the rules cannot
/// be in the iPad's before the web view exists. They are added the moment it
/// does, before the main thread returns to WebKit: the page's own document
/// comes from the app, which the rules allow, and nothing it could ask another
/// host for can be asked before WebKit has read the document, which it does
/// only after the rules have reached it.
pub fn build_window(
    app: AppHandle,
    window: tauri::utils::config::WindowConfig,
) -> Result<(), String> {
    use block2::RcBlock;
    use objc2::MainThreadMarker;
    use objc2_foundation::{NSError, NSString};
    use objc2_web_kit::{WKContentRuleList, WKContentRuleListStore, WKUserContentController};

    let mtm = MainThreadMarker::new().ok_or("WebKit setup must run on the main thread")?;
    let store = unsafe { WKContentRuleListStore::defaultStore(mtm) }
        .ok_or("WebKit has no content-rule store")?;
    let rules = NSString::from_str(&crate::telemetry::allowlist::webview_rules());
    let completed = RcBlock::new(move |list: *mut WKContentRuleList, error: *mut NSError| {
        let result = (|| -> Result<(), String> {
            if list.is_null() || !error.is_null() {
                return Err("WebKit could not compile the network policy".into());
            }
            // SAFETY: WebKit keeps the compiled list alive through this
            // callback, and the controller retains it once it is added.
            let list = unsafe { objc2::rc::Retained::retain(list) }
                .ok_or("WebKit gave no network policy")?;
            let builder = tauri::WebviewWindowBuilder::from_config(&app, &window)
                .map_err(|e| e.to_string())?
                .on_navigation(crate::navigation_allowed);
            // The simulator proof's harness, in a probe build alone.
            #[cfg(feature = "ipad-probe")]
            let builder = match crate::ipad_probe::script() {
                Some(script) => builder.initialization_script(script),
                None => builder,
            };
            let window = builder.build().map_err(|e| e.to_string())?;
            // A probe build's negative control goes without the rules.
            #[cfg(feature = "ipad-probe")]
            if crate::ipad_probe::without_rules() {
                return Ok(());
            }
            // On the main thread, Tauri runs this before `with_webview`
            // returns; the list is touched on the main thread alone.
            let list = MainThreadOnly(list);
            let added = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
            let marked = added.clone();
            window
                .with_webview(move |webview| {
                    let list = list;
                    // SAFETY: the web view's own user content controller,
                    // alive while its web view is, used on the main thread.
                    let controller =
                        unsafe { &*(webview.controller() as *const WKUserContentController) };
                    unsafe { controller.addContentRuleList(&list.0) };
                    marked.store(true, Ordering::SeqCst);
                })
                .map_err(|e| e.to_string())?;
            if !added.load(Ordering::SeqCst) {
                return Err("the network policy did not reach the web view in time".into());
            }
            Ok(())
        })();
        if let Err(error) = result {
            eprintln!("Proscenium could not start safely: {error}");
            app.exit(1);
        }
    });
    unsafe {
        store.compileContentRuleListForIdentifier_encodedContentRuleList_completionHandler(
            Some(&NSString::from_str("proscenium-local-only-v1")),
            Some(&rules),
            Some(&completed),
        );
    }
    Ok(())
}

/// A WebKit object carried into a closure that Tauri runs on the main thread,
/// where it is created and used. Never touched anywhere else.
struct MainThreadOnly<T>(T);
// SAFETY: see above; the closure that holds it runs on the main thread.
unsafe impl<T> Send for MainThreadOnly<T> {}

// --- Leaving the app keeps the words -----------------------------------------

/// The question, to the page: `{ id }`. Answered with `leaving_settled`.
pub const EVENT_LEAVING: &str = "app://leaving";

/// How long the app holds iOS's time for the page. iOS gives an app about
/// thirty seconds; the page's own settle stops at ten.
const SETTLE_WITHIN: Duration = Duration::from_secs(25);

static NEXT_LEAVING: AtomicU64 = AtomicU64::new(1);

fn answers() -> &'static Mutex<HashMap<u64, mpsc::Sender<()>>> {
    static ANSWERS: OnceLock<Mutex<HashMap<u64, mpsc::Sender<()>>>> = OnceLock::new();
    ANSWERS.get_or_init(Default::default)
}

#[derive(Clone, Serialize)]
struct Leaving {
    id: u64,
}

/// The app is about to leave the front (iOS's `applicationWillResignActive`,
/// Tauri's `Suspended`), which also comes for a glance at Control Center:
/// settling early loses nothing. The page settles as for a quit, and the app
/// holds time from iOS until it says so, or until that time is up.
pub fn leaving(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let id = NEXT_LEAVING.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = mpsc::channel();
        answers()
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .insert(id, tx);
        // The page first, before anything is asked of iOS, so nothing the
        // plugin waits on holds its words back: the time was once asked for
        // first, on the main queue, which may not turn again as the app
        // leaves, and the page was told only once the app came back.
        let told = app.emit(EVENT_LEAVING, Leaving { id }).is_ok();
        let picker = app.vault_picker();
        let task = picker.begin_background_task().ok();
        if told {
            let _ = rx.recv_timeout(SETTLE_WITHIN);
        }
        answers()
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .remove(&id);
        if let Some(task) = task {
            let _ = picker.end_background_task(task);
        }
    });
}

/// The page has settled for leaving `id`: what could land landed, and the rest
/// is where the next launch finds it.
#[tauri::command]
pub fn leaving_settled(id: u64) {
    if let Some(tx) = answers()
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .remove(&id)
    {
        let _ = tx.send(());
    }
}

// --- Which copy this is --------------------------------------------------------

#[derive(Debug, Clone, Default)]
pub struct Facts {
    pub testflight: bool,
}

static FACTS: OnceLock<Facts> = OnceLock::new();

/// Asks the iPad once, on a thread of its own, at launch.
pub fn learn_facts(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        if let Ok(facts) = app.vault_picker().store_facts() {
            let _ = FACTS.set(Facts {
                testflight: facts.testflight,
            });
        }
    });
}

/// What the iPad said, or nothing yet in the moment after launch.
pub fn facts() -> Facts {
    FACTS.get().cloned().unwrap_or_default()
}

// --- The menu bar and the keyboard --------------------------------------------

/// The keyboard's claim on the page, to the page: `{ inset }`, in CSS pixels.
pub const EVENT_KEYBOARD: &str = "app://keyboard";

#[derive(Clone, Serialize)]
struct Keyboard {
    inset: f64,
}

/// What the plugin raised, for the page.
enum Raised {
    Menu(String),
    Keyboard(f64),
}

/// The inset the iPad last reported, for a page that asks before any change.
static INSET: Mutex<Option<f64>> = Mutex::new(None);

/// How much of the page a docked keyboard covers now, in CSS pixels, or
/// nothing before the iPad has said. Only the iPad's build has the command:
/// elsewhere the page measures its own viewport.
#[tauri::command]
pub fn keyboard_inset() -> Option<f64> {
    *INSET.lock().unwrap_or_else(|p| p.into_inner())
}

/// iPadOS's main menu from the Mac's tables, and the keyboard's frame, each
/// raised on a channel of Rust's own. Once, at launch, from a thread of its
/// own.
///
/// A key command and a keyboard's change reach Rust on the main thread, inside
/// UIKit's own callback, so what they raise is emitted from a second thread,
/// in the order it was raised: an emit on the main thread would run the page's
/// script there and then.
pub fn install_native(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let (tx, rx) = mpsc::channel::<Raised>();
        let emitting = app.clone();
        std::thread::spawn(move || {
            for raised in rx {
                match raised {
                    Raised::Menu(id) => {
                        #[cfg(feature = "ipad-probe")]
                        crate::ipad_probe::note(format!("menu {id}"));
                        crate::menu::on_menu_event(&emitting, &id);
                    }
                    Raised::Keyboard(inset) => {
                        #[cfg(feature = "ipad-probe")]
                        crate::ipad_probe::note(format!("keyboard {inset}"));
                        *INSET.lock().unwrap_or_else(|p| p.into_inner()) = Some(inset);
                        let _ = emitting.emit(EVENT_KEYBOARD, Keyboard { inset });
                    }
                }
            }
        });

        let picker = app.vault_picker();
        let to_page = Mutex::new(tx.clone());
        let menu = Channel::new(move |body| {
            if let Some(id) = field(&body, "id").and_then(|v| v.as_str().map(String::from)) {
                let _ = to_page
                    .lock()
                    .unwrap_or_else(|p| p.into_inner())
                    .send(Raised::Menu(id));
            }
            Ok(())
        });
        let to_page = Mutex::new(tx);
        let keyboard = Channel::new(move |body| {
            if let Some(inset) = field(&body, "inset").and_then(|v| v.as_f64()) {
                let _ = to_page
                    .lock()
                    .unwrap_or_else(|p| p.into_inner())
                    .send(Raised::Keyboard(inset));
            }
            Ok(())
        });
        // Listening first, so nothing raised in between is lost.
        let listening = picker
            .listen("menu", menu)
            .and_then(|()| picker.listen("keyboard", keyboard));
        if let Err(error) = listening {
            eprintln!("Proscenium will not hear the iPad's menu or keyboard: {error}");
            return;
        }
        // A probe build logs what it built, and may be told to go without the
        // menu (`PROSCENIUM_IPAD_PROBE_NO_MENU`), to take the key commands
        // iPadOS 17 to 25 take on a later iPadOS
        // (`PROSCENIUM_IPAD_PROBE_LEGACY_MENU`), or to leave the page where
        // WebKit puts it when a keyboard comes up, the keyboard's negative
        // control (`PROSCENIUM_IPAD_PROBE_NO_PIN`).
        #[cfg(feature = "ipad-probe")]
        let (menu, legacy, log, pin) = (
            std::env::var_os("PROSCENIUM_IPAD_PROBE_NO_MENU").is_none(),
            std::env::var_os("PROSCENIUM_IPAD_PROBE_LEGACY_MENU").is_some(),
            true,
            std::env::var_os("PROSCENIUM_IPAD_PROBE_NO_PIN").is_none(),
        );
        #[cfg(not(feature = "ipad-probe"))]
        let (menu, legacy, log, pin) = (true, false, false, true);
        let menus = crate::menu::ipad_menus();
        if menu {
            if let Err(error) = picker.install_menu(MenuRequest { menus, legacy, log }) {
                eprintln!("Proscenium has no menu on this iPad: {error}");
            }
        }
        if let Err(error) = picker.watch_keyboard(KeyboardRequest { pin, log }) {
            eprintln!("Proscenium cannot see this iPad's keyboard: {error}");
        }
    });
}

/// One field of what the plugin sent on a channel.
fn field(body: &InvokeResponseBody, name: &str) -> Option<serde_json::Value> {
    match body {
        InvokeResponseBody::Json(json) => serde_json::from_str::<serde_json::Value>(json)
            .ok()?
            .get(name)
            .cloned(),
        InvokeResponseBody::Raw(_) => None,
    }
}

// --- The app's own iCloud container --------------------------------------------

/// The app's iCloud container's `Documents`, the folder iCloud Drive shows as
/// Proscenium on every device, as the Mac's is
/// (docs/engineering/cross-platform.md#PLAT-8), made on first use; or `None`
/// where iCloud is not there, which the Welcome screen then does not offer.
/// Kept once found; asked again until then, since a writer may sign in to
/// iCloud while the app runs. Called from a command's worker, never the main
/// thread. A folder in it is in iCloud Drive, so every access is coordinated
/// once it opens (`opened`).
pub fn cloud_root(app: &AppHandle) -> Option<String> {
    static FOUND: OnceLock<String> = OnceLock::new();
    if let Some(found) = FOUND.get() {
        return Some(found.clone());
    }
    let container = app.vault_picker().cloud_container().ok().flatten()?;
    let documents = Path::new(&container).join("Documents");
    std::fs::create_dir_all(&documents).ok()?;
    Some(
        FOUND
            .get_or_init(|| documents.to_string_lossy().into_owned())
            .clone(),
    )
}

// --- A file opened from Files ---------------------------------------------------

/// Files opened from Files since launch. The plugin started the grant each
/// came with before tao handed the app its path; reading one is coordinated,
/// as a read in the Plays folder is, since Files may have opened it in iCloud
/// Drive or another provider's folder.
fn from_files() -> &'static Mutex<HashSet<PathBuf>> {
    static OPENED: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
    OPENED.get_or_init(Default::default)
}

/// Paths Files just opened in the app: each read of them is coordinated from
/// now on. On the main thread, before the page can ask for any of them.
pub fn opened_from_files(paths: &[PathBuf]) {
    let mut opened = from_files().lock().unwrap_or_else(|p| p.into_inner());
    for path in paths {
        #[cfg(feature = "ipad-probe")]
        crate::ipad_probe::note(format!("opened {}", path.display()));
        opened.insert(path.clone());
    }
}

// --- Coordinated access in iCloud Drive ---------------------------------------

/// The folders the app opened that iCloud Drive syncs.
fn ubiquitous_roots() -> &'static Mutex<Vec<PathBuf>> {
    static ROOTS: OnceLock<Mutex<Vec<PathBuf>>> = OnceLock::new();
    ROOTS.get_or_init(Default::default)
}

struct PickerCoordinator {
    app: AppHandle,
}

/// How many accesses were coordinated since launch: what a probe build reports.
static COORDINATED: AtomicU64 = AtomicU64::new(0);

#[cfg_attr(not(feature = "ipad-probe"), allow(dead_code))]
pub fn coordinated() -> u64 {
    COORDINATED.load(Ordering::SeqCst)
}

/// The folders whose access is coordinated, for a probe build's report.
#[cfg_attr(not(feature = "ipad-probe"), allow(dead_code))]
pub fn coordinated_roots() -> Vec<String> {
    ubiquitous_roots()
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .iter()
        .map(|r| r.to_string_lossy().into_owned())
        .collect()
}

struct PickerLease {
    app: AppHandle,
    token: i64,
    path: PathBuf,
}

impl Lease for PickerLease {
    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for PickerLease {
    fn drop(&mut self) {
        let _ = self.app.vault_picker().end_coordinated(self.token);
    }
}

/// Whether `path` is in a folder the app opened that iCloud Drive syncs.
fn in_icloud(path: &Path) -> bool {
    ubiquitous_roots()
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .iter()
        .any(|root| path.starts_with(root))
}

impl Coordinator for PickerCoordinator {
    fn covers(&self, path: &Path) -> bool {
        in_icloud(path)
            || from_files()
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .contains(path)
    }

    fn begin(&self, path: &Path, access: Access) -> std::io::Result<Box<dyn Lease>> {
        let given = self
            .app
            .vault_picker()
            .begin_coordinated(path.to_string_lossy().into_owned(), access.as_str(), None)
            .map_err(|e| match access {
                // A read the coordinator could not grant in time is a file
                // that has not come down: the read that fetches on a miss
                // asks the platform again, and says so if it still has not.
                Access::Read => std::io::Error::new(std::io::ErrorKind::WouldBlock, e.to_string()),
                _ => std::io::Error::other(e.to_string()),
            })?;
        COORDINATED.fetch_add(1, Ordering::SeqCst);
        Ok(Box::new(PickerLease {
            app: self.app.clone(),
            token: given.token,
            path: PathBuf::from(given.path),
        }))
    }
}

/// The coordinator, once, at launch.
pub fn install_coordinator(app: &AppHandle) {
    coordination::install(Box::new(PickerCoordinator { app: app.clone() }));
}

/// A folder the vault just opened: if iCloud Drive syncs it, every access to
/// it and to anything inside it is coordinated from now on. A folder on the
/// iPad itself pays nothing. Called from a command's worker.
pub fn opened(app: &AppHandle, root: &Path) {
    // A folder under iCloud Drive's own folder on the iPad is in iCloud Drive,
    // and the path says so at once.
    let by_path = crate::scope::is_icloud_item(&root.to_string_lossy());
    // A probe build may treat every folder so, since the simulator has no
    // iCloud account: the proof then runs through the coordinator throughout.
    #[cfg(feature = "ipad-probe")]
    let by_path = by_path || crate::ipad_probe::coordinate_everything();
    // Anywhere else Files reaches, the platform says whether the folder is
    // ubiquitous (`isUbiquitousItemKey`).
    if by_path
        || app
            .vault_picker()
            .is_ubiquitous(root.to_string_lossy().into_owned())
            .unwrap_or(false)
    {
        cover(root);
    }
}

// --- The app asks iCloud for the open folder ----------------------------------

/// One pass of asking iCloud for everything in the open folder that is not on
/// the iPad yet (docs/engineering/cross-platform.md#PLAT-69). iCloud Drive on an
/// iPad knows a folder by its names and leaves what is in it in the cloud until
/// something asks, so a Plays folder nothing had asked for showed no plays until
/// the writer downloaded it by hand in Files. The page asks in passes, while the
/// folder is open, and finds what came down by listing and reading as before.
/// A folder iCloud Drive does not sync is not walked at all.
pub fn download(
    app: &AppHandle,
    root: &Path,
) -> Result<tauri_plugin_vault_picker::Downloading, String> {
    if !in_icloud(root) {
        return Ok(Default::default());
    }
    // A probe build's folder stands in for one iCloud has not brought down,
    // since the simulator has no iCloud account.
    #[cfg(feature = "ipad-probe")]
    if let Some(pass) = crate::ipad_probe::download(root) {
        return Ok(pass);
    }
    app.vault_picker()
        .download_folder(root.to_string_lossy().into_owned())
        .map_err(|e| e.to_string())
}

/// Every access to `root`, and to anything inside it, coordinated from now on.
fn cover(root: &Path) {
    let mut roots = ubiquitous_roots().lock().unwrap_or_else(|p| p.into_inner());
    // As given and as the vault resolves it: `/var` is a link to
    // `/private/var`, and the vault's paths are the canonical ones.
    let canonical = crate::long_path::canonical(root).ok();
    for root in std::iter::once(root.to_path_buf()).chain(canonical) {
        if !roots.iter().any(|r| root.starts_with(r)) {
            roots.push(root);
        }
    }
}
