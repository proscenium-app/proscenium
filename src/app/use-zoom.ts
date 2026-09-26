// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Editor zoom.
 *
 * Still a pure VIEW transform — the format spec, the layout engine's geometry
 * and therefore every page break are identical at every level, which is the
 * invariant zoom was built on. All this adds is more ways to choose the level, and
 * one that chooses itself.
 *
 * **Fit width is the one that matters.** With the binder and inspector rails open on
 * a laptop the pane is narrower than a US Letter sheet, so the default state of
 * the app was a page cut off at the right edge with a horizontal scrollbar under
 * it, correctable only by hand-driving ⌘− every time the layout changed. A fit
 * mode solves for the pane and re-solves whenever the pane resizes — opening a
 * rail, splitting the view, resizing the window, switching to a wider format.
 *
 * The page's size comes from the active format (`pageSizeIn`), never a constant
 * here, and pixels-per-inch is measured rather than assumed.
 *
 * **A fit solves against the page on screen.** Zoom is one level, shared by the
 * script's page and every sheet (MaterialEditor), so the two stay the same width;
 * but the pane it is solved for is whichever holds a page right now — the
 * script's, or when no pane shows the script, the sheet in the focused pane
 * (`findFitTarget`). It used to be the script's pane only, so with a note alone
 * on screen Fit Width and Fit Page did nothing at all, and a resize re-fitted
 * nothing.
 *
 * Fit Page also counts what each surface keeps around its page: a sheet's header
 * and format bar above it, the script's element bar above it and page map
 * pinned under it. A level solved for the bare pane ran a note's page
 * about 48px off the bottom, and the script's first page under its strip. Those
 * rows are measured, not assumed: they wrap in a narrow pane and change with the
 * view.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { pageSizeIn, type FormatSpec } from "../format";

export type ZoomMode =
  | { kind: "manual"; level: number }
  | { kind: "fit-width" }
  | { kind: "fit-page" };

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;
export const ZOOM_STEP = 0.1;
/** The percentages worth one click, the way every document app offers them. */
export const ZOOM_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

const ZOOM_KEY = "proscenium:zoomMode";
/** The first zoom stored a bare number here; read it once so nobody's zoom resets. */
const LEGACY_KEY = "proscenium:zoom";

export function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));
}

/**
 * The default when nothing has been chosen yet.
 *
 * A touch device gets **fit width**. This is not a platform check dressed up: a
 * coarse pointer is precisely the condition that makes 100% the wrong default —
 * there is no ⌘−, the pane is narrower than a sheet in either orientation (an
 * iPad in landscape leaves 560px for an 816px page), and a writer who lands on a
 * clipped page has no obvious way off it. With a mouse and a keyboard, 100% and
 * ⌘− remain the familiar default.
 *
 * Only the *default* differs. A stored preference always wins, and the mode
 * stays fully switchable on either kind of device.
 */
function defaultMode(): ZoomMode {
  try {
    if (window.matchMedia("(pointer: coarse)").matches) return { kind: "fit-width" };
  } catch {
    /* matchMedia absent (tests, SSR) — fall through to 100% */
  }
  return { kind: "manual", level: 1 };
}

function loadMode(): ZoomMode {
  try {
    const raw = localStorage.getItem(ZOOM_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ZoomMode;
      if (parsed?.kind === "fit-width" || parsed?.kind === "fit-page") return parsed;
      if (parsed?.kind === "manual" && Number.isFinite(parsed.level)) {
        return { kind: "manual", level: clampZoom(parsed.level) };
      }
    }
    const legacy = Number(localStorage.getItem(LEGACY_KEY));
    if (Number.isFinite(legacy) && legacy > 0) {
      return { kind: "manual", level: clampZoom(legacy) };
    }
  } catch {
    /* chrome preference only */
  }
  return defaultMode();
}

/**
 * CSS pixels per inch. It is 96 everywhere in practice, but the sheet's width is
 * declared in inches by the generated stylesheet, so measuring keeps this honest
 * if a platform ever disagrees. (Shared with the export dialog, which scales
 * its preview sheets against the same measurement.)
 */
export function measurePxPerInch(): number {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:absolute;top:-9999px;left:-9999px;width:1in;height:0;visibility:hidden";
  document.body.appendChild(probe);
  const px = probe.getBoundingClientRect().width;
  probe.remove();
  return px > 0 ? px : 96;
}

/** Breathing room kept around the sheet so a fit never butts the pane edges. */
const GUTTER_PX = 28;

/** What a fit solves against: the pane holding the page, and what of it isn't the page's. */
export interface FitTarget {
  /** The pane's scroller. Its client box is the room a fit has. */
  pane: HTMLElement;
  /**
   * From the top of the pane's content to the top of the sheet: the chrome and
   * the desk above the page where the surface starts, in px. Only the sheet is
   * zoomed, so this is the same at every level.
   */
  above: number;
  /** Chrome pinned to the pane's foot, over the page, in px. */
  below: number;
}

/**
 * The level a fit lands on, clamped.
 *
 * Fit width: the sheet's width with a gutter either side. Fit page: that, or
 * less if the page would run off the bottom where its surface starts — a whole
 * page under what sits above the sheet (never less than a gutter), clear of what
 * is pinned below it by a gutter. `page` is the unzoomed sheet, in px.
 */
export function fitLevel(
  kind: "fit-width" | "fit-page",
  room: { width: number; height: number; above: number; below: number },
  page: { width: number; height: number },
): number {
  const byWidth = (room.width - GUTTER_PX * 2) / page.width;
  if (kind === "fit-width") return clampZoom(byWidth);
  const tall = room.height - Math.max(room.above, GUTTER_PX) - room.below - GUTTER_PX;
  return clampZoom(Math.min(byWidth, tall / page.height));
}

/** Where a box sits along its pane's content, whatever the pane is scrolled to. */
function topInPane(el: Element, pane: HTMLElement): number {
  return el.getBoundingClientRect().top - pane.getBoundingClientRect().top - pane.clientTop + pane.scrollTop;
}

/** A computed length in px, or 0 where there is none. */
function px(value: string): number {
  return parseFloat(value) || 0;
}

/**
 * The pane a fit solves against right now: the script's while a pane shows the
 * script, otherwise the sheet in the focused pane, or else the first sheet on
 * screen. Null when no pane holds a page, which leaves the level where it is.
 *
 * Measured off boxes that are never zoomed. WebKit reports a zoomed box's rect
 * divided by its own zoom — position as well as size — so the sheet itself
 * cannot say where it is; the desk it lies on and the chrome above it can.
 * Chrome that comes and goes (the find bar, the first-run card) is left out: a
 * page that changed size when find opened would be worse than one that briefly
 * sits lower.
 */
export function findFitTarget(
  scriptPane: HTMLElement | null,
  paneRoot: HTMLElement | null,
): FitTarget | null {
  if (scriptPane) {
    // PlayEditor: the element bar, the surface's gap, then the page; the
    // page map pinned under it. The mount's desk inset is the
    // surface's own top.
    const surface = scriptPane.querySelector(".editor-surface");
    if (!surface) return null;
    let above = topInPane(surface, scriptPane);
    let below = 0;
    for (const child of surface.children) {
      if (child.classList.contains("elementbar")) {
        above += child.getBoundingClientRect().height + px(getComputedStyle(surface).rowGap);
      } else if (child.classList.contains("rts")) {
        below = child.getBoundingClientRect().height;
      }
    }
    return { pane: scriptPane, above, below };
  }
  // MaterialEditor: the header, the format bar in Page, then the desk, whose
  // inset is the last thing above the sheet.
  const desk =
    paneRoot?.querySelector(".pane.is-focused .material__desk") ??
    paneRoot?.querySelector(".material__desk");
  const pane = desk?.closest<HTMLElement>(".pane__body");
  if (!desk || !pane) return null;
  return { pane, above: topInPane(desk, pane) + px(getComputedStyle(desk).paddingTop), below: 0 };
}

export interface UseZoomResult {
  /** The level to apply to the sheet. */
  zoom: number;
  mode: ZoomMode;
  setMode: (mode: ZoomMode) => void;
  /** Nudge by a step — leaves a fit mode, starting from where the fit landed. */
  zoomBy: (delta: number) => void;
  /** Back to 100% (⌘0). */
  reset: () => void;
  /** "120%", or "Fit width · 84%". */
  label: string;
  /**
   * Solve again now, in a fit mode. For a surface whose rows above the sheet
   * changed where nothing else would notice — a sheet switching Page and Source.
   */
  refit: () => void;
}

export function useZoom(args: {
  /** Practice fits beside its guide without changing the writer's saved zoom. */
  temporary?: boolean;
  /**
   * The pane the page is in and what of it the page may use (`findFitTarget`),
   * asked at every solve, since which pane holds the page changes with the tabs.
   */
  target: () => FitTarget | null;
  format: FormatSpec;
  /** False while no script is open — nothing to measure against. */
  active: boolean;
  /**
   * Any value that changes when the pane's geometry could have changed — a rail
   * opening, the split toggling, the divider moving — or when a different pane
   * could now hold the page: a tab switched, another pane focused.
   *
   * Belt and braces on purpose. A ResizeObserver is the right mechanism and
   * covers cases nobody enumerated, but it delivers its callbacks in the frame
   * lifecycle, so it is silent wherever `requestAnimationFrame` is (a
   * backgrounded tab — which is exactly the state the automated browser harness
   * drives the app in, where a fit would look broken and be untestable). This
   * token gives a synchronous, verifiable re-solve for the changes the app
   * already knows about.
   */
  layout?: unknown;
}): UseZoomResult {
  const { format, active, layout } = args;
  const targetRef = useRef(args.target);
  targetRef.current = args.target;
  const [personalMode, setModeState] = useState<ZoomMode>(loadMode);
  const [practiceMode, setPracticeMode] = useState<ZoomMode>({kind:"fit-width"});
  const mode = args.temporary ? practiceMode : personalMode;
  useEffect(() => {if(!args.temporary) setPracticeMode({kind:"fit-width"});},[args.temporary]);
  const [fit, setFit] = useState(1);
  const pxPerInRef = useRef(0);
  /** The observer on the pane the last solve used, which follows the page to its next one. */
  const watchRef = useRef<{ observer: ResizeObserver; pane: HTMLElement | null } | null>(null);

  const setMode = useCallback((next: ZoomMode) => {
    if(args.temporary) {setPracticeMode(next);return;}
    setModeState(next);
    try {
      localStorage.setItem(ZOOM_KEY, JSON.stringify(next));
    } catch {
      /* chrome preference only */
    }
  }, [args.temporary]);

  const { widthIn, heightIn } = pageSizeIn(format);

  // Solve for the pane holding the page. Runs before paint on a layout change
  // and on every resize of that pane, so opening a rail or dragging the split
  // divider re-fits at once.
  const solve = useCallback(() => {
    if (!active || mode.kind === "manual") return;
    const target = targetRef.current();
    if (!target) return;
    // The general case — anything else that resizes the pane — on whichever
    // pane this is. Observing the pane the hook first saw left a fit watching
    // a scroller that had since left the screen.
    const watch = (watchRef.current ??= {
      observer: new ResizeObserver(() => solveRef.current()),
      pane: null,
    });
    if (watch.pane !== target.pane) {
      if (watch.pane) watch.observer.unobserve(watch.pane);
      watch.observer.observe(target.pane);
      watch.pane = target.pane;
    }
    if (!pxPerInRef.current) pxPerInRef.current = measurePxPerInch();
    const pxPerIn = pxPerInRef.current;
    setFit(
      fitLevel(
        mode.kind,
        {
          width: target.pane.clientWidth,
          height: target.pane.clientHeight,
          above: target.above,
          below: target.below,
        },
        { width: widthIn * pxPerIn, height: heightIn * pxPerIn },
      ),
    );
  }, [active, mode.kind, widthIn, heightIn]);
  const solveRef = useRef(solve);
  solveRef.current = solve;
  const refit = useCallback(() => solveRef.current(), []);

  // On mount, on a mode or format change, and on any layout change the app
  // knows about. Before paint, so a fit never shows a wrong size for a frame.
  // And once more after the level moves: in a narrow pane a sheet's format bar
  // wraps differently at the new width, and the second answer is the one that
  // holds — at a fit the sheet is never wider than its pane, so there is no third.
  useLayoutEffect(() => {
    solve();
  }, [solve, layout, fit]);

  // Window resizes: a plain event, so it works with or without a frame loop.
  useEffect(() => {
    if (!active || mode.kind === "manual") return;
    const onResize = () => solveRef.current();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [active, mode.kind]);

  useEffect(
    () => () => {
      watchRef.current?.observer.disconnect();
      watchRef.current = null;
    },
    [],
  );

  const zoom = mode.kind === "manual" ? mode.level : fit;

  const zoomBy = useCallback(
    (delta: number) => {
      // Stepping out of a fit continues from what the fit produced, so ⌘+ after
      // a fit nudges the page you are looking at rather than jumping to 110%.
      const from = mode.kind === "manual" ? mode.level : fit;
      setMode({kind:"manual",level:clampZoom(from+delta)});
    },
    [fit,mode,setMode],
  );

  const reset = useCallback(() => setMode({ kind: "manual", level: 1 }), [setMode]);

  const pct = `${Math.round(zoom * 100)}%`;
  const label =
    mode.kind === "fit-width"
      ? `Fit width · ${pct}`
      : mode.kind === "fit-page"
        ? `Fit page · ${pct}`
        : pct;

  return { zoom, mode, setMode, zoomBy, reset, label, refit };
}
