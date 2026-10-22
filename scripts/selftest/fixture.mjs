// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The in-memory vault's test hooks, in the real app
 * (docs/engineering/release-engineering.md#REL-129).
 *
 * Smoke's checks stage faults through hooks on `window`: `__prosceniumGate`
 * holds or refuses a vault call, `__prosceniumPeek` reads what the disk holds,
 * and so on (src/storage/dev-mock.ts defines them for a browser). In a test
 * build the same names stand in for the same things, done by the Rust vault
 * (src-tauri/src/selftest_fixture.rs), so one check, written once, proves a
 * failure path in Chromium, in WebKit, in the Mac app and in the Windows app.
 *
 * Every hook here answers through IPC, so each answers a promise where the
 * in-memory vault's answers at once: a check awaits what it reads
 * (`await window.__prosceniumHeld("write")`), which works with both.
 *
 * Self-contained, with no import and nothing closed over: smoke's WebView2
 * driver hands the function itself to the page (scripts/smoke-webview2.mjs),
 * and the Mac's harness calls it (scripts/selftest/harness.mjs). A page
 * without the app's IPC, a browser's, is left as it is.
 *
 * `newPage`: called as a page is made, before the app's own scripts run. A
 * reload stands in for a relaunch, or a crash, as it does for the in-memory
 * vault, which a reload makes afresh: so a new page tells the app, which lets
 * go of what the last page held (its gates, its quit, its recovery owners), as
 * a process ending would. Called on a page that is already running, it does not.
 */
export function installFixture(newPage = false) {
  const internals = window.__TAURI_INTERNALS__;
  if (window.__prosceniumFixture) return;
  if (!internals) {
    // On a new page an injected script can run before the app's own IPC is
    // there: once the page is parsed, it is asked again, by then a page that
    // runs, whose recovery owners are its own.
    if (document.readyState === "loading")
      document.addEventListener("DOMContentLoaded", () => installFixture(false), { once: true });
    return;
  }
  const call = (op, args = {}) => internals.invoke("selftest_fixture", { call: { op, ...args } });
  if (newPage) call("pageLoaded");
  Object.assign(window, {
    __prosceniumFixture: true,
    __prosceniumGate: (kind, rel, opts = {}) =>
      call("gate", { kind, rel: rel ?? null, fail: opts.fail ?? null }),
    __prosceniumHeld: (kind) => call("held", { kind }),
    __prosceniumFailed: (kind) => call("failed", { kind }),
    __prosceniumOpenGates: (kind) => call("open", { kind: kind ?? null }),
    __prosceniumPeek: (rel) => call("peek", { rel }),
    __prosceniumPeekKey: (key) => call("peekKey", { key }),
    __prosceniumStoreKeys: () => call("storeKeys"),
    __prosceniumExternalChange: (rel, content) => call("externalChange", { rel, content }),
    __prosceniumExternalAlias: (rel, event, content) =>
      call("externalAlias", { rel, event, content }),
    __prosceniumExternalRemove: (rel) => call("externalRemove", { rel }),
    __prosceniumQuietWrite: (key, content) => call("quietWrite", { key, content }),
    __prosceniumWatcherHealth: (status) => call("watcherHealth", { status }),
    __prosceniumSavedCopy: (rel, content) => call("savedCopy", { rel, content }),
    __prosceniumVersionsWith: (text) => call("versionsWith", { text }),
    __prosceniumRecoveryWith: (text) => call("recoveryWith", { text }),
    __prosceniumFolderAccess: () => call("folderAccess"),
    __prosceniumQuit: () => call("quit"),
    __prosceniumQuitGone: () => call("quitGone"),
    __prosceniumKeptAtQuit: () => call("keptAtQuit"),
    __prosceniumWhere: (path) => call("where", { path }),
    __prosceniumNextPick: (path) => call("nextPick", { path }),
    __prosceniumExported: () => call("exported"),
    __prosceniumPrinted: () => call("printed"),
    __prosceniumTutorialProgress: (content) =>
      call("tutorialProgress", { content: content ?? null }),
    __prosceniumTutorialFiles: (files) => call("tutorialFiles", { files: files ?? null }),
    __prosceniumPreservedProgress: () => call("preservedProgress"),
    __prosceniumOpenFiles: (paths) => call("openFiles", { paths }),
    __prosceniumOutsideFile: (path, base64) => call("outsideFile", { path, base64 }),
    __prosceniumTelemetry: () => call("telemetry"),
    __prosceniumFeedback: () => call("feedback"),
    __prosceniumFeedbackOffline: (on) => call("feedbackOffline", { on }),
    __prosceniumDetailsUnavailable: (on) => call("detailsUnavailable", { on }),
    __prosceniumUpdate: (finish = false) => call("update", { finish }),
    __prosceniumUpdateState: (state) => call("updateState", { state }),
    __prosceniumUpdateHeld: () => call("updateHeld"),
    __prosceniumMenu: (id) => call("menu", { id }),
    __prosceniumAnalyticsKey: (on) => call("analyticsKey", { on: on ?? null }),
    // Stored as the app stores it, and in the page's mirror of the settings,
    // which a launch reads before the app answers.
    __prosceniumNoticeSeen: async (seen) => {
      const stored = await call("noticeSeen", { seen: seen ?? null });
      if (seen != null) {
        const mirror = JSON.parse(localStorage.getItem("proscenium:settings") ?? "{}");
        localStorage.setItem(
          "proscenium:settings",
          JSON.stringify({ ...mirror, privacyNoticeSeen: seen }),
        );
      }
      return stored;
    },
    // The system's settings, then the page asked again, as when the window
    // comes forward.
    __prosceniumSystemAccent: async (hex) => {
      await call("systemAccent", { hex: hex ?? null });
      window.dispatchEvent(new Event("proscenium:system-accent"));
    },
    __prosceniumSteadyCaret: async (on) => {
      await call("steadyCaret", { on });
      window.dispatchEvent(new Event("proscenium:system-caret"));
    },
  });
}
