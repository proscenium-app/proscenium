// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The soft keyboard's claim on the window, as a CSS length. Without it, the iOS
 * keyboard accessory bar floats over the bottom status bar, and a full soft
 * keyboard covers the page.
 *
 * The keyboard lays over the page: fixed/flex chrome at the window bottom (the
 * status bar, the docked find bar) ends up underneath the keys unless the
 * layout is told. This hook writes how much is covered into `--kb-inset` on
 * the root element, and the shell pads by it (styles.css).
 *
 * Where the app says, it is the truth (docs/engineering/cross-platform.md#PLAT-77):
 * an iPad reports how much a DOCKED keyboard covers, the screen's keyboard or a
 * hardware keyboard's shortcut bar, as UIKit lays it out, and 0 for a floating
 * or split keyboard, which covers nothing the page can move out from under.
 * The visual viewport, which this read before, gets those wrong: it shrinks
 * for a hardware keyboard's suggestion bar and not at all for a floating
 * keyboard. Once the app has spoken it alone is read; until then, and wherever
 * it never speaks (a browser, a Mac, Windows), the visual viewport is the
 * measure, and on a desktop it computes to 0 — no platform branch, per
 * docs/engineering/cross-platform.md#PLAT-66's rule.
 *
 * visualViewport's `resize`/`scroll` are plain events, not frame-lifecycle
 * callbacks, so this is testable in the automated harness (the trap recorded
 * for ResizeObserver/matchMedia/IntersectionObserver does not apply); a
 * window `resize` listener rides along anyway, same belt-and-braces as
 * use-zoom.ts.
 */
import { useEffect } from "react";
import { keyboard } from "../storage/ipc";
import { insetGate } from "./inset-gate";

export function useKeyboardInset(): void {
  useEffect(() => {
    const root = document.documentElement;
    // Written only when what this measures changes, against what it last
    // wrote: an inset that waited out a touch and comes to nothing new must
    // not write over the property, which it once did, a moment late, after
    // the check that stands a keyboard in had set it.
    let written: string | null = null;
    const write = (inset: number) => {
      const value = `${Math.max(0, Math.round(inset))}px`;
      if (value === written) return;
      written = value;
      root.style.setProperty("--kb-inset", value);
    };
    // What the keyboard covers is written once a touch has had its click
    // (inset-gate.ts): while a finger is down, and for a moment after it
    // lifts, the newest inset waits.
    const gate = insetGate(write, {
      now: () => performance.now(),
      setTimer: (run, ms) => window.setTimeout(run, ms),
      clearTimer: (id) => window.clearTimeout(id),
    });
    const offer = gate.offer;
    const down = (e: PointerEvent) => {
      if (e.pointerType === "touch") gate.touchDown();
    };
    const up = (e: PointerEvent) => {
      if (e.pointerType === "touch") gate.touchUp();
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    let dead = false;
    // The app has said where its keyboard is: from then on, only it is read.
    let native = false;
    const fromApp = (inset: number) => {
      if (dead) return;
      native = true;
      offer(inset);
    };
    const vv = window.visualViewport;
    const fromViewport = () => {
      if (native || !vv) return;
      // Height the keyboard (or anything else) took off the bottom: layout
      // height minus the visual viewport's bottom edge.
      offer(window.innerHeight - vv.height - vv.offsetTop);
    };
    fromViewport();
    vv?.addEventListener("resize", fromViewport);
    vv?.addEventListener("scroll", fromViewport);
    window.addEventListener("resize", fromViewport);
    let stop: (() => void) | undefined;
    void keyboard.onInset(fromApp).then((unlisten) => {
      if (dead) unlisten();
      else stop = unlisten;
    });
    // Where the keyboard is now, for a page that started after the app last
    // said: never over a later report.
    void keyboard.current().then((inset) => {
      if (inset !== null && !native) fromApp(inset);
    });
    return () => {
      dead = true;
      stop?.();
      gate.dispose();
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      vv?.removeEventListener("resize", fromViewport);
      vv?.removeEventListener("scroll", fromViewport);
      window.removeEventListener("resize", fromViewport);
      root.style.removeProperty("--kb-inset");
    };
  }, []);
}
