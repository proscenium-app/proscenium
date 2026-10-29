// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! The page's network fence on Windows (docs/engineering/cross-platform.md#PLAT-62).
//!
//! The content security policy keeps the page on its own origin; this keeps
//! it there in the webview itself, as WebKit's content rules do on a Mac
//! (webview_policy.rs), so the policy is never the only fence. WebView2's
//! resource filter sees every request the page makes, from the document, a
//! worker or a frame, and answers each one
//! `telemetry::allowlist::webview2_allows` refuses with a 403 that never leaves
//! the machine. Tauri's own handler still serves the page's origin and its
//! IPC; this one answers nothing else.
//!
//! It is installed as the window is made, before the page has asked for
//! anything a writer's play could put in it.
//!
//! The same hook turns off WebView2's browser keys (F5 and Ctrl+R reload the
//! page, Ctrl+F and Ctrl+P open the browser's own find and print, Ctrl+Shift+I
//! its tools): the app is not a browser, and a reload in the middle of a
//! sentence is a page that has to start again. The page still gets every key,
//! and binds its own (src/ui/keys.ts).

use tauri::WebviewWindow;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2, ICoreWebView2Settings3, ICoreWebView2_2, ICoreWebView2_22,
    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL, COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
};
use webview2_com::{take_pwstr, WebResourceRequestedEventHandler};
use windows::core::{Interface, HSTRING, PWSTR};

pub fn install(window: &WebviewWindow) -> Result<(), String> {
    window
        .with_webview(|platform| {
            // SAFETY: COM calls on the webview's own thread, where Tauri runs
            // this closure, on the controller it hands over.
            let fenced = unsafe {
                platform
                    .controller()
                    .CoreWebView2()
                    .and_then(|w| fence(&w).and_then(|()| no_browser_keys(&w)))
            };
            // Without its fence the page must not run: say why, and stop.
            if let Err(error) = fenced {
                eprintln!("Proscenium could not start safely: the page's network fence: {error}");
                std::process::exit(1);
            }
        })
        .map_err(|e| e.to_string())
}

/// WebView2's browser keys, off (above).
unsafe fn no_browser_keys(webview: &ICoreWebView2) -> windows::core::Result<()> {
    webview
        .Settings()?
        .cast::<ICoreWebView2Settings3>()?
        .SetAreBrowserAcceleratorKeysEnabled(false)
}

unsafe fn fence(webview: &ICoreWebView2) -> windows::core::Result<()> {
    let environment = webview.cast::<ICoreWebView2_2>()?.Environment()?;
    let every = HSTRING::from("*");
    match webview.cast::<ICoreWebView2_22>() {
        Ok(webview) => webview.AddWebResourceRequestedFilterWithRequestSourceKinds(
            &every,
            COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
            COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
        )?,
        Err(_) => {
            webview.AddWebResourceRequestedFilter(&every, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL)?
        }
    }
    let refused_reason = HSTRING::from("Forbidden");
    let no_headers = HSTRING::new();
    let mut token: i64 = 0;
    webview.add_WebResourceRequested(
        &WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else { return Ok(()) };
            let mut uri = PWSTR::null();
            args.Request()?.Uri(&mut uri)?;
            if crate::telemetry::allowlist::webview2_allows(&take_pwstr(uri)) {
                return Ok(());
            }
            let refused =
                environment.CreateWebResourceResponse(None, 403, &refused_reason, &no_headers)?;
            args.SetResponse(&refused)
        })),
        &mut token,
    )
}
