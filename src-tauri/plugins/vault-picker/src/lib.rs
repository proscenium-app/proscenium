// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! The mobile folder picker for the vault.
//!
//! `tauri-plugin-dialog` implements file pickers on iOS but **not** a folder
//! picker (tauri-apps/plugins-workspace#933), and a Proscenium vault is a
//! folder. This plugin supplies the missing piece: the system folder picker plus
//! a bookmark that makes the writer's grant survive relaunch.
//!
//! It deliberately needs **no entitlement**. Because access comes from the
//! picker rather than from an app-owned iCloud container, the vault can live
//! anywhere the Files app can reach — iCloud Drive, a Syncthing/Möbius folder,
//! On My iPad — so the app stays out of the sync business exactly as
//! cross-platform.md intends, and no paid-membership capability is required.
//! Android's SAF tree picker is the same shape and lands behind this same type.
//!
//! The plugin exposes **no frontend commands**: the app's own `vault_pick_folder`
//! orchestrates pick → open → persist, so there stays exactly one guarded path
//! into the vault rather than two.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

pub use models::*;

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

mod error;
mod models;

pub use error::{Error, Result};

#[cfg(desktop)]
use desktop::VaultPicker;
#[cfg(mobile)]
use mobile::VaultPicker;

/// Extensions to [`tauri::App`], [`tauri::AppHandle`] and [`tauri::Window`] to
/// access the vault-picker APIs.
pub trait VaultPickerExt<R: Runtime> {
    fn vault_picker(&self) -> &VaultPicker<R>;
}

impl<R: Runtime, T: Manager<R>> crate::VaultPickerExt<R> for T {
    fn vault_picker(&self) -> &VaultPicker<R> {
        self.state::<VaultPicker<R>>().inner()
    }
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("vault-picker")
        .setup(|app, api| {
            #[cfg(mobile)]
            let vault_picker = mobile::init(app, api)?;
            #[cfg(desktop)]
            let vault_picker = desktop::init(app, api)?;
            app.manage(vault_picker);
            Ok(())
        })
        .build()
}
