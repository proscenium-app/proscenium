// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * How much shorter than the format's pitch this engine draws a line of the
 * script (docs/app/writing/editor-ux.md#EDIT-197).
 *
 * The layout engine counts a page in rows of the format's exact pitch, and the
 * page view draws each page's blank remainder in those rows (`lh`,
 * pagination.ts). Chromium cuts a line only to its layout unit, a sixty-fourth
 * of a pixel (19.1875 for 19.2), less than a pixel a page, but Apple's WebKit,
 * in the Mac app as in the iPad's, draws each line a whole pixel tall, the
 * pitch cut down (19 for 19.2 at 100%, 10 for 10.944 at 57%), whether the line
 * height is a ratio or a length, in the editor or out of it. So a full page
 * came out short of its format, up to 5% at the zoom's floor. The page measures what a
 * line loses, once for each pitch, and each remainder takes back as much for
 * every row of text above it, so a page is its format's height however its
 * lines are drawn.
 */

/** Lines in the probe: enough that a cut of a hundredth of a pixel shows. */
const PROBE_LINES = 10;

/**
 * What each line is drawn short by, from the pitch a line should take and the
 * height `lines` of them were drawn: 0 where they take it, and never less.
 */
export function lineShortfall(pitchPx: number, drawnPx: number, lines: number): number {
  if (!(pitchPx > 0) || !(drawnPx > 0) || !(lines >= 1)) return 0;
  const each = pitchPx - drawnPx / lines;
  return each > 0.0005 ? Math.round(each * 10000) / 10000 : 0;
}

/**
 * Measures a line of the page as this engine draws it, with a hidden line of
 * Action on the page itself (so it has the page's type and pitch, and none of
 * the editor's), and sets `--line-shortfall` on the page for its remainders.
 * Returns the shortfall, in CSS pixels.
 */
export function measureLineShortfall(page: HTMLElement): number {
  const probe = document.createElement("div");
  probe.className = "pl pl-action";
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText =
    "position:absolute;left:0;top:0;margin:0;padding:0;visibility:hidden;pointer-events:none;white-space:pre";
  probe.textContent = Array.from({ length: PROBE_LINES }, () => "x").join("\n");
  page.appendChild(probe);
  const drawn = probe.getBoundingClientRect().height;
  const pitch = Number.parseFloat(getComputedStyle(probe).lineHeight);
  probe.remove();
  const shortfall = lineShortfall(pitch, drawn, PROBE_LINES);
  page.style.setProperty("--line-shortfall", `${shortfall}px`);
  return shortfall;
}

/**
 * A page's blank remainder, as its widget's height: its blank rows of the
 * format's pitch, and what each of its rows of text was drawn short by.
 */
export function remainderHeight(fillRows: number, textRows: number): string {
  const rows = Math.max(0, fillRows);
  return textRows > 0 ? `calc(${rows}lh + ${textRows} * var(--line-shortfall, 0px))` : `${rows}lh`;
}

/** The rows of a page that hold text: a dual pair's two halves share theirs. */
export function textRowsOf(lines: ReadonlyArray<{ row: number }>): number {
  return new Set(lines.map((line) => line.row)).size;
}
