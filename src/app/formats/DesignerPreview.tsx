// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The designer's preview: the layout engine's pages, drawn by the Export
 * dialog's own page renderer (`PreviewPage`). Nothing here decides where a line
 * goes — the engine does — so a format that looks right here prints the same.
 *
 * The pages are as wide as the pane allows: this is the thing the designer
 * exists to show, so it gets the width and the form gets a column.
 *
 * Each page carries its text alternative, and the lines the last change moved
 * are marked on the page, so a writer sees WHAT a value did as well as that
 * something changed.
 */
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { pageSizeIn, type FormatSpec } from "../../format";
import type { LayoutResult } from "../../layout";
import { BlankSheet, PreviewPage } from "../ExportPanel";
import { measurePxPerInch } from "../use-zoom";
import { describePage, lineKey } from "./preview";

/** Air around each sheet inside the pane. Chrome, not layout. */
const GUTTER_PX = 28;
/** Never larger than print: past that it is a magnifier, not a preview. */
const MAX_SCALE = 1;
/** How far below the fold a page is built before it scrolls into view. */
const LOOKAHEAD_PX = 900;

export function DesignerPreview(props: {
  layout: LayoutResult;
  spec: FormatSpec;
  moved: Set<string>;
  /** What the preview is of: the sampler, or the open play. */
  source: string;
}) {
  const { layout, spec, moved } = props;
  const pane = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.6);
  const [builtThrough, setBuiltThrough] = useState(2);
  const { widthIn } = pageSizeIn(spec);
  const total = layout.pages.length;

  const solve = useCallback(() => {
    const el = pane.current;
    if (!el) return;
    const next = (el.clientWidth - GUTTER_PX * 2) / (widthIn * measurePxPerInch());
    if (next > 0) setScale(Math.min(MAX_SCALE, Math.round(next * 100) / 100));
  }, [widthIn]);

  // A plain resize listener beside the observer, as the Export preview does:
  // observers are silent in a window that is not being painted.
  useLayoutEffect(() => {
    solve();
    const el = pane.current;
    if (!el) return;
    const ro = new ResizeObserver(solve);
    ro.observe(el);
    window.addEventListener("resize", solve);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", solve);
    };
  }, [solve]);

  const raise = useCallback(() => {
    const el = pane.current;
    if (!el) return;
    const limit = el.scrollTop + el.clientHeight + LOOKAHEAD_PX;
    let last = 0;
    for (const child of el.children) {
      if ((child as HTMLElement).offsetTop - el.offsetTop > limit) break;
      last++;
    }
    setBuiltThrough((prev) => Math.max(prev, last));
  }, []);
  useLayoutEffect(raise, [raise, scale, total]);

  return (
    <div className="designer__preview">
      {/* Focusable, so arrows and Space scroll the pages without a pointer. */}
      <div
        className="designer__pane"
        ref={pane}
        tabIndex={0}
        role="region"
        aria-label={`Preview: ${props.source}, ${total} ${total === 1 ? "page" : "pages"}`}
        onScroll={raise}
      >
        {layout.pages.map((page, i) => (
          <div
            key={page.pageNumber}
            className="designer__page"
            role="img"
            aria-label={describePage(page, total, spec)}
          >
            {i <= builtThrough ? (
              <PreviewPage
                page={page}
                spec={spec}
                scale={scale}
                lineClassName={(line) =>
                  moved.has(lineKey(line, page.pageNumber)) ? "is-moved" : undefined
                }
              />
            ) : (
              <BlankSheet spec={spec} scale={scale} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
