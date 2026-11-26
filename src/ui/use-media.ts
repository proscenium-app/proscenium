// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Whether a media query matches now, kept current: a window resized, an iPad
 * turned, a trackpad attached.
 *
 * A question about the window and the pointer, never the platform
 * (docs/engineering/cross-platform.md#PLAT-D100): a narrow window gets the
 * narrow chrome on any system, and a finger gets a finger's on any system.
 * Read again on `resize` as well as on the query's own `change`, which did
 * not fire under the automated browser harness (use-narrow-layout.ts says
 * the same of its own query).
 */
import { useEffect, useState } from "react";

export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const sync = () => setMatches(mq.matches);
    mq.addEventListener("change", sync);
    window.addEventListener("resize", sync);
    sync();
    return () => {
      mq.removeEventListener("change", sync);
      window.removeEventListener("resize", sync);
    };
  }, [query]);
  return matches;
}

/** A finger is the pointer: an iPad's screen, not a trackpad. */
export const COARSE = "(pointer: coarse)";

/**
 * How much of the window's top bar folds away (docs/engineering/design-system.md#UI-65):
 *
 *  - `wide`: everything in its place, as on a Mac.
 *  - `folded`: on a finger, below 1000 points, where 44-point controls no
 *    longer fit beside the view switcher: Help, Feedback, Settings and the
 *    changes switch go into More.
 *  - `compact`: below 700 points on any pointer (a third of a Split View, a
 *    small Stage Manager window): the view switcher is a pop-up, and the
 *    split and the inspector join More.
 *
 * A Mac's window is never under 820 points, and its pointer is never a
 * finger, so a Mac's bar never folds.
 */
export type ToolbarFold = "wide" | "folded" | "compact";

/** Below this many points, a finger's bar folds. */
export const FOLDED_BELOW = 1000;
/** Below this many points, any bar is compact. */
export const COMPACT_BELOW = 700;

/** The fold for a window this wide, on a finger or a pointer. */
export function toolbarFold(finger: boolean, width: number): ToolbarFold {
  if (width < COMPACT_BELOW) return "compact";
  return finger && width < FOLDED_BELOW ? "folded" : "wide";
}

export function useToolbarFold(): ToolbarFold {
  const finger = useMedia(COARSE);
  const narrow = useMedia(`(max-width: ${FOLDED_BELOW - 1}px)`);
  const compact = useMedia(`(max-width: ${COMPACT_BELOW - 1}px)`);
  return toolbarFold(finger, compact ? 0 : narrow ? COMPACT_BELOW : FOLDED_BELOW);
}
