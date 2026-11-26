// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::*;

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_vault_picker);

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<VaultPicker<R>> {
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_vault_picker)?;
    // Android's SAF tree picker is the same shape with a different mechanism (a
    // persistable URI grant rather than a bookmark) — cross-platform.md
    // §Android. Deliberately not wired: no Kotlin side exists yet, so this
    // registration would fail loudly rather than silently, which is what we
    // want when the Boox work starts.
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin("org.habiby.proscenium", "VaultPickerPlugin")?;
    Ok(VaultPicker(handle))
}

/// Access to the vault-picker APIs.
pub struct VaultPicker<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> VaultPicker<R> {
    /// Present the system folder picker. `None` means the writer cancelled,
    /// which is an answer rather than a failure.
    pub fn pick_folder(&self) -> crate::Result<Option<PickedFolder>> {
        self.0
            .run_mobile_plugin::<Option<PickedFolder>>("pickFolder", ())
            .map_err(Into::into)
    }

    /// Re-grant access to a folder chosen in an earlier launch. The returned
    /// `bookmark` may differ from the one passed in — iOS renews stale bookmarks
    /// on resolve — so persist whatever comes back.
    pub fn resolve_bookmark(&self, bookmark: String) -> crate::Result<PickedFolder> {
        self.0
            .run_mobile_plugin("resolveBookmark", ResolveRequest { bookmark })
            .map_err(Into::into)
    }

    /// Bring an evicted iCloud file back to the device so it can be read. See
    /// the Swift side for why a read cannot skip this.
    pub fn materialize(&self, path: String, timeout_ms: Option<u32>) -> crate::Result<bool> {
        self.0
            .run_mobile_plugin::<MaterializeResponse>(
                "materialize",
                MaterializeRequest { path, timeout_ms },
            )
            .map(|r| r.ready)
            .map_err(Into::into)
    }

    /// Ask iCloud for everything in a folder that is not on this device yet,
    /// and say how much that was. Starts downloads and waits for none of them:
    /// the caller asks again (docs/engineering/cross-platform.md#PLAT-69).
    pub fn download_folder(&self, path: String) -> crate::Result<Downloading> {
        self.0
            .run_mobile_plugin("downloadFolder", DownloadRequest { path, most: None })
            .map_err(Into::into)
    }

    // Every call below blocks its caller until the iPad answers, so none is
    // made from the main thread, which some of the answers need.

    /// The share sheet for a file (an export), until it closes.
    pub fn share_file(&self, path: String) -> crate::Result<Shared> {
        self.0
            .run_mobile_plugin("shareFile", PathRequest { path })
            .map_err(Into::into)
    }

    /// The print panel for a PDF, once it is up.
    pub fn print_file(&self, path: String, job_title: String) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("printFile", PrintRequest { path, job_title })
            .map_err(Into::into)
    }

    /// An `https` page in Safari.
    pub fn open_url(&self, url: String) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("openUrl", UrlRequest { url })
            .map_err(Into::into)
    }

    /// Text onto the pasteboard.
    pub fn copy_text(&self, text: String) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("copyText", TextRequest { text })
            .map_err(Into::into)
    }

    /// Time from iOS to finish as the app leaves; the id gives it back.
    pub fn begin_background_task(&self) -> crate::Result<i64> {
        self.0
            .run_mobile_plugin::<TaskId>("beginBackgroundTask", ())
            .map(|t| t.id)
            .map_err(Into::into)
    }

    pub fn end_background_task(&self, id: i64) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("endBackgroundTask", TaskId { id })
            .map_err(Into::into)
    }

    /// Whether TestFlight installed this copy, and the system's version.
    pub fn store_facts(&self) -> crate::Result<StoreFacts> {
        self.0
            .run_mobile_plugin("storeFacts", ())
            .map_err(Into::into)
    }

    /// Whether a folder is in iCloud Drive, where access is coordinated.
    pub fn is_ubiquitous(&self, path: String) -> crate::Result<bool> {
        self.0
            .run_mobile_plugin::<Ubiquity>("isUbiquitous", PathRequest { path })
            .map(|u| u.ubiquitous)
            .map_err(Into::into)
    }

    /// Coordinated access to `path` (`list`, `read` or `replace`), granted and
    /// held until [`Self::end_coordinated`] with its token.
    pub fn begin_coordinated(
        &self,
        path: String,
        access: &str,
        wait_ms: Option<u32>,
    ) -> crate::Result<Coordinated> {
        self.0
            .run_mobile_plugin(
                "beginCoordinated",
                CoordinateRequest {
                    path,
                    access: access.to_string(),
                    wait_ms,
                    hold_ms: None,
                },
            )
            .map_err(Into::into)
    }

    pub fn end_coordinated(&self, token: i64) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("endCoordinated", TokenRequest { token })
            .map_err(Into::into)
    }

    /// Rust's own channel for one of the plugin's events: `menu`, an item
    /// chosen (`{id}`), and `keyboard`, the keyboard's inset (`{inset}`).
    /// Tauri's own listener list carries it, as it does a page's.
    pub fn listen(&self, event: &str, handler: tauri::ipc::Channel) -> crate::Result<()> {
        self.0
            .run_mobile_plugin(
                "registerListener",
                ListenRequest {
                    event: event.to_string(),
                    handler,
                },
            )
            .map_err(Into::into)
    }

    /// iPadOS's main menu, built once from the app's menus.
    pub fn install_menu(&self, request: MenuRequest) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("installMenu", request)
            .map_err(Into::into)
    }

    /// The keyboard's frame, watched from the moment the web view exists.
    pub fn watch_keyboard(&self, request: KeyboardRequest) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("watchKeyboard", request)
            .map_err(Into::into)
    }

    /// The app's own iCloud container's folder, or `None` where iCloud is not
    /// there (no account, iCloud Drive off, or the app turned off in it).
    pub fn cloud_container(&self) -> crate::Result<Option<String>> {
        self.0
            .run_mobile_plugin::<CloudContainer>("cloudContainer", ())
            .map(|c| c.path)
            .map_err(Into::into)
    }

    /// The files opened from Files since launch, as the plugin holds them.
    pub fn opened_files(&self) -> crate::Result<Vec<OpenedFile>> {
        self.0
            .run_mobile_plugin::<OpenedFiles>("openedFiles", ())
            .map(|o| o.files)
            .map_err(Into::into)
    }
}
