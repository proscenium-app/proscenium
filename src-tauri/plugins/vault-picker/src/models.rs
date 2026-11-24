// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

use serde::{Deserialize, Serialize};

/// A folder the writer granted access to.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedFolder {
    /// Absolute filesystem path, ready for the vault to open.
    pub path: String,
    /// Opaque base64 bookmark that re-grants access on a later launch. On iOS a
    /// path alone is worthless across launches — the *grant*, not the location,
    /// is the thing worth persisting. May come back **refreshed** from a resolve;
    /// callers must store whatever they are handed.
    pub bookmark: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveRequest {
    pub bookmark: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterializeRequest {
    /// Absolute path of the file to bring back to the device.
    pub path: String,
    pub timeout_ms: Option<u32>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterializeResponse {
    /// True when the bytes are local and a read will succeed. False means "not
    /// yet" — never "deleted".
    pub ready: bool,
}

/// A file or folder the iPad is asked about.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathRequest {
    pub path: String,
}

/// How the share sheet closed.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Shared {
    /// False when the writer dismissed the sheet without choosing anything.
    pub completed: bool,
    /// The activity chosen (Save to Files, Print, AirDrop…), by its identifier.
    pub activity: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintRequest {
    pub path: String,
    pub job_title: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UrlRequest {
    pub url: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextRequest {
    pub text: String,
}

/// A background task, by the plugin's own id.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskId {
    pub id: i64,
}

/// Which copy this is, and on which system version.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreFacts {
    /// TestFlight installed this copy.
    pub testflight: bool,
    /// iPadOS's major and minor version, and its patch when there is one.
    pub system_version: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ubiquity {
    pub ubiquitous: bool,
}

/// A folder to ask iCloud for: everything in it not on this device yet.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    pub path: String,
    /// The most files and folders one pass looks at, so a pass over a folder
    /// that holds far more than plays still ends.
    pub most: Option<u32>,
}

/// One pass of asking iCloud for a folder: whether iCloud Drive keeps it, and
/// how many of its files and folders were not yet on this device. Each of
/// those was asked for; 0 means everything is here.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Downloading {
    pub ubiquitous: bool,
    pub waiting: u32,
}

/// Coordinated access to a file or folder in iCloud Drive.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoordinateRequest {
    pub path: String,
    /// `list`, `read` or `replace`.
    pub access: String,
    pub wait_ms: Option<u32>,
    pub hold_ms: Option<u32>,
}

/// An access the coordinator granted, held until it is ended by its token.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Coordinated {
    pub token: i64,
    /// The URL the coordinator gave, as a path: the one to use while it is held.
    pub path: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenRequest {
    pub token: i64,
}

/// One of the app's menus, as iPadOS's main menu takes it.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuSpec {
    pub title: String,
    /// The system's own menu the items go into (`application`, `file`,
    /// `edit`, `view`, `window`, `help`), or none for a menu of the app's own.
    pub system: Option<String>,
    pub items: Vec<MenuItemSpec>,
}

/// One item of a menu. An empty id is a separator.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuItemSpec {
    /// What the page is told when the item is chosen (`menu://action`).
    pub id: String,
    pub label: String,
    /// The chord's key: a character, or `return`, `up` or `down`.
    pub key: Option<String>,
    /// `command`, `shift`, `alternate`, `control`.
    pub modifiers: Vec<String>,
}

/// The main menu to build.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuRequest {
    pub menus: Vec<MenuSpec>,
    /// Key commands on the window's root view controller, as iPadOS 17 to 25
    /// take them, even on a later iPadOS: a probe build's choice alone.
    pub legacy: bool,
    /// The menu as the system gave it and as built, in the log: a probe
    /// build's alone.
    pub log: bool,
}

/// How the keyboard's frame is watched.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyboardRequest {
    /// Keep the page where it is when a keyboard comes up: WebKit would
    /// otherwise scroll it up under the keyboard. Off only in a probe build's
    /// negative control.
    pub pin: bool,
    /// The web view's scroll view in the log at each change: a probe build's.
    pub log: bool,
}

/// Rust's own channel for an event the plugin raises (`menu`, `keyboard`).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListenRequest {
    pub event: String,
    pub handler: tauri::ipc::Channel,
}

/// A file opened from Files, as the plugin holds it.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedFile {
    pub path: String,
    /// Files opened it in place, rather than handing over a copy in the
    /// app's Inbox.
    pub in_place: bool,
    /// The grant Files gave with it is started and held.
    pub held: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedFiles {
    pub files: Vec<OpenedFile>,
}

/// The app's own iCloud container, or none where iCloud is not there.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudContainer {
    pub path: Option<String>,
}
