// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<VaultPicker<R>> {
    Ok(VaultPicker(app.clone()))
}

/// Access to the vault-picker APIs.
///
/// Desktop has a real folder dialog (`tauri-plugin-dialog`) and persists a plain
/// absolute path, so this plugin has nothing to add there. The methods exist so
/// the plugin compiles for every target; the app never calls them on desktop —
/// `capabilities()` routes it to the dialog instead.
pub struct VaultPicker<R: Runtime>(#[allow(dead_code)] AppHandle<R>);

impl<R: Runtime> VaultPicker<R> {
    pub fn pick_folder(&self) -> crate::Result<Option<PickedFolder>> {
        Err(crate::Error::DesktopUnsupported)
    }

    pub fn resolve_bookmark(&self, _bookmark: String) -> crate::Result<PickedFolder> {
        Err(crate::Error::DesktopUnsupported)
    }

    /// Desktop iCloud Drive materializes dataless files transparently on read
    /// (APFS), so there is nothing to wait for: anything that exists is readable.
    pub fn materialize(&self, path: String, _timeout_ms: Option<u32>) -> crate::Result<bool> {
        Ok(std::path::Path::new(&path).exists())
    }
}
