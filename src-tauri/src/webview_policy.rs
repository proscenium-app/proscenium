// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! docs/app/keeping-work/privacy-and-telemetry.md#PRIV-5: CSP does not prevent WebKit preconnect. Compile a content rule list
//! before creating the window, so even the first script runs under the policy.

use block2::RcBlock;
use objc2::MainThreadMarker;
use objc2_foundation::{NSError, NSString};
use objc2_web_kit::{WKContentRuleList, WKContentRuleListStore, WKWebViewConfiguration};
use tauri::{AppHandle, utils::config::WindowConfig, webview::Color};

/// `background` is the colour the window shows until the page paints
/// (window_color.rs).
pub fn build(app: AppHandle, window: WindowConfig, background: Color) -> Result<(), String> {
    let mtm = MainThreadMarker::new().ok_or("WebKit setup must run on the main thread")?;
    let store = unsafe { WKContentRuleListStore::defaultStore(mtm) }.ok_or("WebKit has no content-rule store")?;
    let rules = NSString::from_str(&crate::telemetry::allowlist::webview_rules());
    let completed = RcBlock::new(move |list: *mut WKContentRuleList, error: *mut NSError| {
        let result = (|| -> Result<(), String> {
            if list.is_null() || !error.is_null() { return Err("WebKit could not compile the network policy".into()); }
            let mtm = MainThreadMarker::new().ok_or("WebKit completed setup off the main thread")?;
            // All objects are used on AppKit's main thread. WebKit keeps the
            // compiled list alive through this callback; its controller retains it.
            let configuration = unsafe {
                let configuration = WKWebViewConfiguration::new(mtm);
                configuration.userContentController().addContentRuleList(&*list);
                // WebKit paints its own background until the page's first frame
                // (white in Light mode, grey in Dark), over the window's desk.
                // `drawsBackground` is private API, the key wry sets for a
                // transparent window, so only the download build turns it off.
                #[cfg(feature = "webkit-background")]
                {
                    use objc2_foundation::{NSNumber, NSObjectNSKeyValueCoding};
                    configuration.setValue_forKey(Some(&NSNumber::numberWithBool(false)), &NSString::from_str("drawsBackground"));
                }
                configuration
            };
            tauri::WebviewWindowBuilder::from_config(&app, &window).map_err(|e| e.to_string())?
                .with_webview_configuration(configuration)
                .background_color(background)
                .on_navigation(crate::navigation_allowed)
                .build().map_err(|e| e.to_string())?;
            Ok(())
        })();
        if let Err(error) = result {
            eprintln!("Proscenium could not start safely: {error}");
            app.exit(1);
        }
    });
    unsafe {
        store.compileContentRuleListForIdentifier_encodedContentRuleList_completionHandler(
            Some(&NSString::from_str("proscenium-local-only-v1")), Some(&rules), Some(&completed),
        );
    }
    Ok(())
}
