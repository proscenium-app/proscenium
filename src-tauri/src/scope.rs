// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Where plays are allowed to live, and how that permission survives a relaunch
//! (docs/app/keeping-work/storage-and-file-format.md#STOR-D12).
//!
//! Two things a sandboxed Mac app needs and an unsandboxed one does not:
//!
//!  1. **The iCloud container** — the app's own folder in iCloud Drive, shown
//!     in Finder as iCloud Drive › Proscenium. It needs no picker and no
//!     bookmark, which is why it is the zero-click
//!     default and `~/Documents/Plays` is not: nothing can create a folder under
//!     Documents without the writer going through the panel.
//!
//!  2. **Security-scoped bookmarks** — a folder the writer picked is readable
//!     for as long as the app runs, and unreadable on the next launch unless a
//!     bookmark re-grants it. A stored path is a hint; the bookmark is the
//!     permission. This is the design `settings.rs` already had for iOS, made
//!     universal.
//!
//! A bookmark can go **stale** (the folder moved, or its provider
//! re-registered). Resolving one hands back a refreshed bookmark, and the caller
//! persists it immediately. Failed renewal keeps the usable grant for this
//! session and reports that durable access still needs attention.
//!
//! Off macOS every function here is a no-op that reports "no bookmark needed",
//! and the plain path is the whole story.

/// The path the writer chose, plus the bookmark that will re-open it.
pub struct Scoped {
    pub path: String,
    /// `None` where this platform needs no grant to reach the path.
    pub bookmark: Option<String>,
    pub problem: Option<String>,
}

#[cfg(target_os = "macos")]
mod imp {
    use base64::Engine as _;
    use objc2::rc::Retained;
    use objc2::runtime::Bool;
    use objc2_foundation::{
        NSData, NSFileManager, NSString, NSURLBookmarkCreationOptions,
        NSURLBookmarkResolutionOptions, NSURL,
    };

    use super::Scoped;

    fn b64() -> base64::engine::general_purpose::GeneralPurpose {
        base64::engine::general_purpose::STANDARD
    }

    fn data_to_b64(data: &NSData) -> String {
        b64().encode(data.to_vec())
    }

    fn b64_to_data(s: &str) -> Option<Retained<NSData>> {
        let bytes = b64().decode(s).ok()?;
        Some(NSData::with_bytes(&bytes))
    }

    /// A security-scoped bookmark for `path`, or `None` if one cannot be made.
    ///
    /// A failure here is not fatal: unsandboxed, the plain path keeps working,
    /// and the writer is asked for the folder again if it ever stops.
    pub fn bookmark(path: &str) -> Option<String> {
        let url = NSURL::fileURLWithPath(&NSString::from_str(path));
        let data = url
            .bookmarkDataWithOptions_includingResourceValuesForKeys_relativeToURL_error(
                NSURLBookmarkCreationOptions::WithSecurityScope,
                None,
                None,
            )
            .ok()?;
        Some(data_to_b64(&data))
    }

    /// Resolve a bookmark and start accessing the folder it names.
    ///
    /// Access is started and deliberately never stopped: the app holds exactly
    /// one Plays folder open for as long as it runs, and stopping would revoke
    /// the grant mid-save. It is released when the process exits.
    ///
    /// A stale bookmark still resolves; we mint a fresh one and hand it back, so
    /// the caller can persist the replacement.
    pub fn resolve(bookmark: &str) -> Option<Scoped> {
        let data = b64_to_data(bookmark)?;
        let mut stale = Bool::NO;
        let url = unsafe {
            NSURL::URLByResolvingBookmarkData_options_relativeToURL_bookmarkDataIsStale_error(
                &data,
                NSURLBookmarkResolutionOptions::WithSecurityScope,
                None,
                &mut stale,
            )
        }
        .ok()?;
        // Not fatal when false: a folder inside our own container needs no
        // grant, and `is_dir` below is the real test of whether we can read it.
        let _ = unsafe { url.startAccessingSecurityScopedResource() };

        let path = url.path()?.to_string();
        if !std::path::Path::new(&path).is_dir() {
            return None;
        }
        let renewed = stale.as_bool().then(|| bookmark_for_url(&url));
        let (bookmark, problem) = super::renewed_bookmark(bookmark, renewed);
        Some(Scoped { path, bookmark: Some(bookmark), problem })
    }

    fn bookmark_for_url(url: &NSURL) -> Option<String> {
        let data = url
            .bookmarkDataWithOptions_includingResourceValuesForKeys_relativeToURL_error(
                NSURLBookmarkCreationOptions::WithSecurityScope,
                None,
                None,
            )
            .ok()?;
        Some(data_to_b64(&data))
    }

    /// Whether iCloud manages this item — true under iCloud Drive, and for
    /// `~/Documents` and `~/Desktop` when Desktop & Documents sync is on, whose
    /// paths never mention iCloud at all (providers.rs).
    pub fn is_icloud_item(path: &str) -> bool {
        let url = NSURL::fileURLWithPath(&NSString::from_str(path));
        NSFileManager::defaultManager().isUbiquitousItemAtURL(&url)
    }

    /// The app's iCloud Drive container, or `None` when iCloud is unavailable —
    /// not signed in, or turned off for this app. The welcome screen then does
    /// not offer it (docs/app/keeping-work/storage-and-file-format.md#STOR-D12), rather than offering a door that opens onto
    /// nothing.
    ///
    /// `Documents` inside the container is the part Finder shows under
    /// iCloud Drive › Proscenium; the container root also holds `Data`, which is
    /// ours and not the writer's.
    pub fn cloud_root() -> Option<String> {
        let fm = NSFileManager::defaultManager();
        // `None` means "the app's default container", i.e. iCloud.<bundle id>
        // as declared in the entitlements.
        let url = fm.URLForUbiquityContainerIdentifier(None)?;
        let root = url.path()?.to_string();
        let docs = std::path::Path::new(&root).join("Documents");
        // Created on first use; a container that exists but has no Documents
        // yet is the ordinary first-run state.
        std::fs::create_dir_all(&docs).ok()?;
        Some(docs.to_string_lossy().to_string())
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use super::Scoped;

    pub fn bookmark(_path: &str) -> Option<String> {
        None
    }

    pub fn resolve(_bookmark: &str) -> Option<Scoped> {
        None
    }

    pub fn cloud_root() -> Option<String> {
        None
    }

    pub fn is_icloud_item(_path: &str) -> bool {
        false
    }
}

pub use imp::{bookmark, cloud_root, is_icloud_item, resolve};

#[cfg(any(target_os = "macos", test))]
fn renewed_bookmark(previous: &str, renewed: Option<Option<String>>) -> (String, Option<String>) {
    match renewed {
        Some(Some(fresh)) => (fresh, None),
        Some(None) => (previous.into(), Some("The folder opened, but its access could not be renewed for the next launch.".into())),
        None => (previous.into(), None),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn a7_12_failed_renewal_keeps_the_usable_grant_but_does_not_report_success() {
        let (bookmark, problem) = super::renewed_bookmark("usable", Some(None));
        assert_eq!(bookmark, "usable");
        assert!(problem.is_some());
        assert_eq!(super::renewed_bookmark("old", Some(Some("fresh".into()))), ("fresh".into(), None));
    }
}
