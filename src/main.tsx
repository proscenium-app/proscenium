// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { isTauri } from "@tauri-apps/api/core";
import { applyStoredAccent } from "./ui/use-accent";
import { startSystemAccent } from "./app/settings/system-accent";
import { pageErrorSignal } from "./diagnostics/page-error";
import { platform, telemetry } from "./storage/ipc";
import "./app/styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

// Before the first paint, not inside a mount effect: the accent decides the
// colour of every selection and fill on screen, and a frame of the wrong one is
// the kind of flash you see once and then cannot stop seeing.
applyStoredAccent();
// Follow Mac asks the Mac for its accent now, and again whenever the window comes forward.
startSystemAccent();

/*
 * macOS draws its traffic lights OVER the toolbar (`titleBarStyle: Overlay` in
 * tauri.conf.json), so the toolbar's left group holds 70px clear for them.
 *
 * Gated on BOTH the platform and the native shell. A media query cannot ask
 * "is this macOS", and browser dev runs in Chrome on the same Mac — where
 * there is no overlay and the reserve would be a 70px hole with nothing in it.
 */
if (isTauri() && /Mac/i.test(navigator.platform || navigator.userAgent)) {
  document.documentElement.classList.add("is-macos");
}

/*
 * A boot failure has to say so.
 *
 * An uncaught error before or during the first render leaves a window that is
 * simply blank — no message, no console in a release build, nothing to act on.
 * This puts the error where it can be read: on screen, for the writer.
 *
 * The diagnostics log keeps it as E-BOOT (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D5) — the
 * code, never the message, which can hold a path.
 */
function reportBootFailure(what: string, detail: string) {
  // Before React has drawn anything, #root holds only index.html's own launch
  // screen, which says nothing: that counts as blank.
  if (root && (root.childElementCount === 0 || root.querySelector(":scope > .launch-screen"))) {
    telemetry.record({ name: "error_shown", code: "E-BOOT" });
    root.innerHTML = "";
    const box = document.createElement("pre");
    box.setAttribute("role", "alert");
    box.style.cssText =
      "margin:0;padding:24px;font:12px/1.5 ui-monospace,monospace;" +
      "white-space:pre-wrap;color:#1f2933;background:#f4ecd8;height:100%;" +
      "box-sizing:border-box;overflow:auto";
    box.textContent = `Proscenium could not start.\n\n${what}\n${detail}`;
    root.appendChild(box);
  }
}

/*
 * Every uncaught error is also a crash signal (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D4): its
 * name and the top frame of its stack go to a crash file through IPC, never its
 * message. An `error` event with no Error behind it — a ResizeObserver notice,
 * a script another origin threw — says nothing about this app, and is skipped.
 */
window.addEventListener("error", (e) => {
  if (e.error instanceof Error) {
    const signal = pageErrorSignal(e.error, e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : "");
    telemetry.pageError(signal.name, signal.frames);
  }
  reportBootFailure(String(e.message), e.error?.stack ?? `${e.filename}:${e.lineno}`);
});
window.addEventListener("unhandledrejection", (e) => {
  const signal = pageErrorSignal(e.reason, "", "UnhandledRejection");
  telemetry.pageError(signal.name, signal.frames);
  reportBootFailure("Unhandled rejection", String((e.reason as Error)?.stack ?? e.reason));
});

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

/*
 * Two frames on, the page has painted: WebKit may draw its own background
 * again. It is off from the window's first instant so that instant is the
 * desk rather than WebKit's grey or white (src-tauri/src/window_color.rs), and
 * back on after because a window left off would show that bare desk, not the
 * page, for a moment each time it comes back from behind another app's. A
 * window opened behind others gets no frames at all, so a timer stands in.
 */
let painted = false;
const pagePainted = () => {
  if (painted) return;
  painted = true;
  void platform.pagePainted().catch(() => {});
};
requestAnimationFrame(() => requestAnimationFrame(pagePainted));
window.setTimeout(pagePainted, 1000);
