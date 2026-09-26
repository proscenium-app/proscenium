// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! macOS smart-substitution kill switch (the root cause of an ellipsis that jumped as it was typed).
//!
//! The OS rewrites the webview's contenteditable DOM directly — smart quotes,
//! smart dashes, and text replacement (which is where a writer's `...` → `…`
//! comes from). The editor's `EllipsisFloor` repairs the one substitution that
//! is repairable by rule; quotes and dashes are legitimate characters a writer
//! may want, so no document-level floor can fix them and they would corrupt the
//! `.fountain` silently. The only correct fix is to stop the substitution at
//! the source, for this app only.
//!
//! There is no public WKWebView property for this — the once-planned
//! `isAutomaticQuoteSubstitutionEnabled` is an NSSpellChecker *class* method
//! (the user preference), confirmed against the MacOSX SDK headers, so setting
//! it as a webview property would have been an unrecognised-selector crash
//! at launch. What IS public and stable: WebKit resolves its text-
//! checker state from `NSUserDefaults` — the `Web*` override keys first, then
//! the NSSpellChecker class preferences, which read the `NS*` keys. Both are
//! plain string defaults, and the app's own domain precedes NSGlobalDomain in
//! the search list, so writing `false` there turns the machinery off for
//! Proscenium without touching the writer's system-wide setting.
//!
//! `setBool_forKey` (persistent app domain) rather than `registerDefaults:`
//! on purpose: the registration domain is searched LAST — after NSGlobalDomain
//! — so a user who ever toggled the global checkbox would mask a registered
//! fallback. Runs before the webview exists, so no state is cached first.
//!
//! Spell checking is deliberately NOT touched — squiggles are a feature
//! (docs/app/writing/editor-ux.md#EDIT-80); it is the silent rewriting that has to go.

#[cfg(target_os = "macos")]
pub fn disable_for_this_app() {
    use objc2_foundation::{NSString, NSUserDefaults};

    let defaults = NSUserDefaults::standardUserDefaults();
    for key in [
        // WebKit's own override keys, consulted before the system preference.
        "WebAutomaticQuoteSubstitutionEnabled",
        "WebAutomaticDashSubstitutionEnabled",
        "WebAutomaticTextReplacementEnabled",
        // The NSSpellChecker-read preferences, app-scoped here.
        "NSAutomaticQuoteSubstitutionEnabled",
        "NSAutomaticDashSubstitutionEnabled",
        "NSAutomaticTextReplacementEnabled",
        // Smart copy/paste ("insert delete") rewrites whitespace around
        // pastes on the same mechanism; a monospace grid wants none of it.
        "WebSmartInsertDeleteEnabled",
        "NSSmartInsertDeleteEnabled",
    ] {
        defaults.setBool_forKey(false, &NSString::from_str(key));
    }
}

#[cfg(not(target_os = "macos"))]
pub fn disable_for_this_app() {}
