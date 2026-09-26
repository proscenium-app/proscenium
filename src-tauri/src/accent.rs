// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! The Mac's accent colour, for Settings › Appearance › Follow Mac.
//!
//! Follow Mac used to be called System and said it followed macOS, while it
//! was one fixed blue in tokens.css. The page cannot ask AppKit, and a system
//! colour keyword in CSS gives no number to hold accent text to a contrast
//! floor with, so the colour comes from here as sRGB hex and
//! `src/ui/system-accent.ts` derives the seven accent tokens from it. The page
//! asks again whenever the window comes forward, which is where a writer who
//! has just changed it in System Settings is coming back from.

/// The accent colour chosen in System Settings › Appearance, as `#rrggbb` in
/// sRGB, or None where there is no Mac to ask. With Multicolor chosen, AppKit
/// answers an app's own accent, which for Proscenium (no asset of its own) is
/// macOS's blue.
#[tauri::command]
pub fn system_accent() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::{NSColor, NSColorSpace};
        // A dynamic colour in no fixed space: sRGB is what the page computes in.
        let srgb =
            NSColor::controlAccentColor().colorUsingColorSpace(&NSColorSpace::sRGBColorSpace())?;
        Some(hex(
            srgb.redComponent(),
            srgb.greenComponent(),
            srgb.blueComponent(),
        ))
    }
    #[cfg(not(target_os = "macos"))]
    None
}

/// Components in 0…1 as `#rrggbb`; a component outside the range is clamped.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn hex(r: f64, g: f64, b: f64) -> String {
    let byte = |c: f64| (c.clamp(0.0, 1.0) * 255.0).round() as u8;
    format!("#{:02x}{:02x}{:02x}", byte(r), byte(g), byte(b))
}

#[cfg(test)]
mod tests {
    use super::hex;

    #[test]
    fn components_become_the_hex_the_page_parses() {
        assert_eq!(hex(0.0, 122.0 / 255.0, 1.0), "#007aff");
        assert_eq!(hex(1.0, 1.0, 1.0), "#ffffff");
        // Extended-range sRGB can stray past 0…1; the page gets a colour either way.
        assert_eq!(hex(-0.2, 1.3, 0.5), "#00ff80");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn the_mac_answers_a_colour() {
        let answer = super::system_accent().expect("AppKit resolves the accent colour");
        assert!(
            answer.len() == 7
                && answer.starts_with('#')
                && answer[1..].chars().all(|c| c.is_ascii_hexdigit())
        );
    }
}
