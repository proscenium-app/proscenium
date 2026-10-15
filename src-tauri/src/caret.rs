// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Whether the Mac asks for a text cursor that does not blink.
//!
//! macOS 15 and later have the setting (System Settings › Accessibility,
//! Prefer non-blinking cursor), and the system's note on it is addressed to
//! exactly this case: "Apps that draw custom insertion indicators should
//! honor this setting." A document draws its own caret (`src/markdown/caret.ts`),
//! and the page has no way to ask: no media query carries the setting, and
//! reduced motion is a different one. So the answer comes from here, and
//! `src/app/settings/system-caret.ts` puts it on the document for the
//! stylesheet. The page asks again whenever the window comes forward, which is
//! where a writer who has just changed it in System Settings is coming back
//! from.

/// True when the Mac's setting for a non-blinking text cursor is on. False
/// where it is off, and where there is no such setting to ask: before
/// macOS 15, and off the Mac.
#[tauri::command]
pub fn steady_caret() -> bool {
    prefers_non_blinking().unwrap_or(false)
}

/// The system's own answer, or None where the system has no such question.
///
/// `AXPrefersNonBlinkingTextInsertionIndicator` is public API of the
/// Accessibility framework from macOS 15. The app runs from macOS 14, where
/// the symbol does not exist, so it is looked up when asked rather than linked.
#[cfg(target_os = "macos")]
fn prefers_non_blinking() -> Option<bool> {
    use std::ffi::CStr;
    const FRAMEWORK: &CStr = c"/System/Library/Frameworks/Accessibility.framework/Accessibility";
    const QUESTION: &CStr = c"AXPrefersNonBlinkingTextInsertionIndicator";
    // SAFETY: both strings are NUL-terminated constants; the framework is the
    // system's, never unloaded; and the symbol, where present, is declared
    // `BOOL AXPrefersNonBlinkingTextInsertionIndicator(void)`, which is the
    // signature it is called with.
    unsafe {
        let framework = libc::dlopen(FRAMEWORK.as_ptr(), libc::RTLD_LAZY);
        if framework.is_null() {
            return None;
        }
        let question = libc::dlsym(framework, QUESTION.as_ptr());
        if question.is_null() {
            return None;
        }
        let ask: unsafe extern "C" fn() -> objc2::runtime::Bool = std::mem::transmute(question);
        Some(ask().as_bool())
    }
}

#[cfg(not(target_os = "macos"))]
fn prefers_non_blinking() -> Option<bool> {
    None
}

#[cfg(test)]
mod tests {
    /// The Mac's major version, from the system's own tool.
    #[cfg(target_os = "macos")]
    fn macos_major() -> u32 {
        let out = std::process::Command::new("/usr/bin/sw_vers")
            .arg("-productVersion")
            .output()
            .expect("sw_vers runs");
        String::from_utf8_lossy(&out.stdout)
            .trim()
            .split('.')
            .next()
            .and_then(|major| major.parse().ok())
            .expect("a version number")
    }

    /// From macOS 15 the question exists and the system answers it; before, it
    /// does not, and the command says no. Which answer a Mac gives is its
    /// owner's setting, so the test holds that there is one, not what it is.
    #[cfg(target_os = "macos")]
    #[test]
    fn the_mac_answers_where_it_has_the_setting() {
        let answer = super::prefers_non_blinking();
        if macos_major() >= 15 {
            assert!(answer.is_some(), "macOS 15 and later answer the question");
            assert_eq!(super::steady_caret(), answer.unwrap());
        } else {
            assert_eq!(answer, None);
            assert!(!super::steady_caret());
        }
    }

    /// Asking is safe to do again and again, as the page does each time the
    /// window comes forward, and gives one answer while nothing changes.
    #[test]
    fn asking_twice_gives_one_answer() {
        assert_eq!(super::steady_caret(), super::steady_caret());
    }
}
