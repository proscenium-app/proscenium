// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! The version this copy answers to.
//!
//! macOS allows only `X.Y.Z` in `CFBundleShortVersionString`, so a build on the
//! alpha or beta track carries its whole version, `X.Y.Z-alpha.N` or
//! `X.Y.Z-beta.N`, in its own `Info.plist` as `ProsceniumVersion`. That whole
//! version is the one it reports to the update service, compares an offered
//! update against, and shows in Settings and Copy Diagnostics. A release has no
//! such key, and neither does a local or development build: their version is
//! the package's, `X.Y.Z`. A Windows track build is given its whole version at
//! build time instead (`PROSCENIUM_VERSION`), since it has no Info.plist.

use tauri::{AppHandle, Runtime};

/// The key a track build adds to its Info.plist.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub const KEY: &str = "ProsceniumVersion";

/// This copy's whole version.
pub fn whole<R: Runtime>(app: &AppHandle<R>) -> String {
    let package = app.package_info().version.to_string();
    bundle_version()
        .filter(|v| belongs_to(v, &package))
        .unwrap_or(package)
}

/// A track version of this package: `X.Y.Z-alpha.N` or `X.Y.Z-beta.N`, with the
/// package's own `X.Y.Z`. Anything else in the key is ignored rather than
/// trusted, because the version decides what the updater will install.
pub fn belongs_to(version: &str, package: &str) -> bool {
    let Some((base, pre)) = version.split_once('-') else {
        return false;
    };
    let Some((track, n)) = pre.split_once('.') else {
        return false;
    };
    base == package
        && matches!(track, "alpha" | "beta")
        && !n.is_empty()
        && n.len() <= 9
        && n.bytes().all(|b| b.is_ascii_digit())
        && (n == "0" || !n.starts_with('0'))
}

#[cfg(target_os = "macos")]
fn bundle_version() -> Option<String> {
    use objc2_foundation::{NSBundle, NSString};
    let value = NSBundle::mainBundle().objectForInfoDictionaryKey(&NSString::from_str(KEY))?;
    let text = value.downcast_ref::<NSString>()?;
    Some(text.to_string())
}

/// Windows has no Info.plist: a track build is given its whole version when it
/// is built, as `PROSCENIUM_VERSION`, and keeps it (build.rs). It is held to
/// the same rule as a Mac's key, so a stray value is ignored.
#[cfg(windows)]
fn bundle_version() -> Option<String> {
    WHOLE.map(str::to_string)
}

/// The whole version, kept whole in the executable: an update proof reads it
/// from outside, as a Mac's reads the Info.plist. Without `#[used]` the
/// optimizer writes so short a string with a few stores, and its text is in
/// the binary nowhere (measured on a beta's build, 2026-10-14).
#[cfg(windows)]
#[used]
static WHOLE: Option<&str> = option_env!("PROSCENIUM_VERSION");

#[cfg(not(any(target_os = "macos", windows)))]
fn bundle_version() -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::belongs_to;

    #[test]
    fn only_a_track_version_of_this_package_is_taken() {
        assert!(belongs_to("1.0.1-alpha.57", "1.0.1"));
        assert!(belongs_to("1.0.1-beta.2", "1.0.1"));
        assert!(belongs_to("1.0.1-alpha.0", "1.0.1"));
        for bad in [
            "1.0.1",
            "1.0.2-alpha.57",
            "1.0.1-rc.1",
            "1.0.1-alpha",
            "1.0.1-alpha.",
            "1.0.1-alpha.05",
            "1.0.1-alpha.5x",
            "1.0.1-alpha.5.1",
            "1.0.1-alpha.1234567890",
            "1.0.1-ALPHA.5",
            " 1.0.1-alpha.5",
        ] {
            assert!(!belongs_to(bad, "1.0.1"), "{bad:?} was taken");
        }
    }
}
