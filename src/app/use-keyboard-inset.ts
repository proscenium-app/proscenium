// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The soft keyboard's claim on the window, as a CSS length. Without it, the iOS
 * keyboard accessory bar floats over the bottom status bar, and a full soft
 * keyboard covers the page.
 *
 * On iOS the keyboard shrinks the VISUAL viewport while the layout viewport
 * stays full-height — so fixed/flex chrome at the window bottom (the status
 * bar, the docked find bar) ends up underneath the keys unless the layout is
 * told. `visualViewport` is the one honest source for how much was taken;
 * this hook mirrors it into `--kb-inset` on the root element and the shell
 * pads by it (styles.css). On desktop the inset computes to 0 and everything
 * is a no-op — no platform branch, per docs/engineering/cross-platform.md#PLAT-D100's rule.
 *
 * visualViewport's `resize`/`scroll` are plain events, not frame-lifecycle
 * callbacks, so this is testable in the automated harness (the trap recorded
 * for ResizeObserver/matchMedia/IntersectionObserver does not apply); a
 * window `resize` listener rides along anyway, same belt-and-braces as
 * use-zoom.ts.
 */
import { useEffect } from "react";

export function useKeyboardInset(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const apply = () => {
      // Height the keyboard (or anything else) took off the bottom: layout
      // height minus the visual viewport's bottom edge.
      const inset = Math.max(
        0,
        window.innerHeight - vv.height - vv.offsetTop,
      );
      document.documentElement.style.setProperty(
        "--kb-inset",
        `${Math.round(inset)}px`,
      );
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    window.addEventListener("resize", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      window.removeEventListener("resize", apply);
      document.documentElement.style.removeProperty("--kb-inset");
    };
  }, []);
}
