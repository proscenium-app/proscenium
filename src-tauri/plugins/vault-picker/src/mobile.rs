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
}
