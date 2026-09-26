// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * "Is there room for the rails beside a page?"
 *
 * Measured, not assumed. The binder and inspector rails are a fixed 624px between
 * them, and a US Letter sheet is 816px at 96dpi — so on an iPad in portrait
 * (834pt) the script pane is left with about 210px and the page is clipped on
 * both sides. Landscape (1194pt) leaves 560px, which still overflows; that case
 * is solved by fit-width zoom rather than by hiding anything (see use-zoom.ts).
 *
 * This hook answers only the narrow case, where no amount of scaling makes a
 * three-pane layout worth looking at. It is a **viewport** question, not a
 * platform one — a narrow desktop window gets the same treatment, and gets the
 * same benefit, so there is no platform branch here to violate
 * docs/engineering/cross-platform.md#PLAT-D100's rule.
 */
import { useEffect, useState } from "react";

/**
 * Below this, the rails collapse to their thin strips. 1000px sits between the
 * two iPad orientations (834 portrait / 1194 landscape) with room to spare on
 * each side, so a rotation lands cleanly on one side or the other rather than
 * flickering at the boundary.
 */
const NARROW_MAX_PX = 1000;

const QUERY = `(max-width: ${NARROW_MAX_PX - 1}px)`;

export function useNarrowLayout(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia(QUERY).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const sync = () => setNarrow(mq.matches);

    // Belt and braces, for the same reason use-zoom.ts keeps a `window.resize`
    // listener beside its ResizeObserver: `matchMedia`'s change event did not
    // fire under the automated browser harness (the query itself evaluated
    // `true` at 834px while the listener stayed silent), so a rail collapse
    // looked broken and could not be tested. `resize` is a plain event and is
    // delivered either way; re-reading `mq.matches` from it keeps one source of
    // truth and makes a double-fire a harmless no-op.
    mq.addEventListener("change", sync);
    window.addEventListener("resize", sync);
    // And once on mount: the viewport may have changed between the initial
    // state and this effect (a rotation during startup).
    sync();

    return () => {
      mq.removeEventListener("change", sync);
      window.removeEventListener("resize", sync);
    };
  }, []);

  return narrow;
}
