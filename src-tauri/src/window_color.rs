// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! The colour the window shows before the page has painted anything.
//!
//! A launch used to pass through colours no one chose: the window's own
//! background, then WebKit's white, then the page in its light tokens (the
//! dark ones are switched on by script), and only then the app, each one a
//! flash. Now the window, the page's first frame (index.html) and the
//! launch screen are one flat colour: the desk (tokens.css `--desk`), light or
//! dark as the page will be. The play is the first thing that changes it.
//!
//! For the window's colour to show, WebKit must not paint its own background
//! over it (webview_policy.rs turns that off, in the download build only: it is
//! private API). It is turned back on once the page has painted
//! (`draw_webkit_background`, from main.tsx): a web view left without it goes
//! bare after a few seconds behind another app's window, and a probe of the
//! real window showed the desk where the page had been — a flash, each time
//! the window came back to the front.

use tauri::webview::Color;

/// `--desk` in tokens.css, light. The tests below hold the two in step.
pub const DESK_LIGHT: Color = Color(0xdc, 0xd2, 0xc0, 0xff);
/// `--desk` in tokens.css, under `:root[data-theme="dark"]`.
pub const DESK_DARK: Color = Color(0x19, 0x17, 0x14, 0xff);

/// The desk for Settings › Appearance (`system`, `light` or `dark`), with
/// `system` resolved as the page resolves it (ui/use-accent.ts).
pub fn desk(appearance: &str, system_dark: bool) -> Color {
    let dark = match appearance {
        "dark" => true,
        "light" => false,
        _ => system_dark,
    };
    if dark { DESK_DARK } else { DESK_LIGHT }
}

/// WebKit paints its own background again: the page has painted its first
/// frame, so nothing of it shows (see the module comment for why it was off).
#[cfg(feature = "webkit-background")]
pub fn draw_webkit_background(webview: &tauri::Webview) {
    let _ = webview.with_webview(|platform| {
        use objc2::runtime::NSObject;
        use objc2_foundation::{NSNumber, NSObjectNSKeyValueCoding, NSString};
        // SAFETY: on macOS the platform web view is the WKWebView, and
        // with_webview runs this on the main thread. `drawsBackground` is the
        // key webview_policy.rs set on its configuration.
        unsafe {
            let view = &*(platform.inner() as *const NSObject);
            view.setValue_forKey(Some(&NSNumber::numberWithBool(true)), &NSString::from_str("drawsBackground"));
        }
    });
}

/// Whether the Mac is in Dark mode right now — what `prefers-color-scheme`
/// will say to the page. False off the main thread, where AppKit can't be asked.
#[cfg(target_os = "macos")]
pub fn system_is_dark() -> bool {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSAppearanceNameAqua, NSAppearanceNameDarkAqua, NSApplication};
    use objc2_foundation::NSArray;
    let Some(mtm) = MainThreadMarker::new() else { return false };
    let appearance = NSApplication::sharedApplication(mtm).effectiveAppearance();
    // SAFETY: AppKit's appearance-name statics, read on the main thread.
    let (aqua, dark) = unsafe { (NSAppearanceNameAqua, NSAppearanceNameDarkAqua) };
    appearance
        .bestMatchFromAppearancesWithNames(&NSArray::from_slice(&[aqua, dark]))
        .is_some_and(|name| name.isEqualToString(dark))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The value of the first `--desk:` after `from` in tokens.css.
    fn desk_in_tokens(from: &str) -> Color {
        let css = include_str!("../../src/app/styles/tokens.css");
        let at = css.find(from).expect("tokens.css has moved on") + from.len();
        let rest = &css[at..];
        let value = &rest[rest.find("--desk:").expect("no --desk") + "--desk:".len()..];
        let hex = value.trim_start().strip_prefix('#').expect("--desk is a hex colour");
        let byte = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).expect("hex");
        Color(byte(0), byte(2), byte(4), 0xff)
    }

    #[test]
    fn the_window_is_the_desk_the_page_will_draw() {
        assert_eq!(desk_in_tokens(""), DESK_LIGHT, "light --desk in tokens.css changed; change DESK_LIGHT with it");
        assert_eq!(
            desk_in_tokens(":root[data-theme=\"dark\"] {"),
            DESK_DARK,
            "dark --desk in tokens.css changed; change DESK_DARK with it",
        );
    }

    #[test]
    fn appearance_decides_and_system_follows_the_mac() {
        assert_eq!(desk("light", true), DESK_LIGHT);
        assert_eq!(desk("dark", false), DESK_DARK);
        assert_eq!(desk("system", true), DESK_DARK);
        assert_eq!(desk("system", false), DESK_LIGHT);
        assert_eq!(desk("", false), DESK_LIGHT);
    }
}
