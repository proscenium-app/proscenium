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
