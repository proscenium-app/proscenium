// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * FormatSpec → editor stylesheet. This is the ONLY source of script-layout
 * numbers for the editing surface: stage-format.css keeps chrome (toolbars,
 * chips, page shadow), and everything the format owns — page geometry, type,
 * per-element columns, rhythm — is emitted here from the active spec.
 *
 * Two invariants keep the DOM and the layout engine in agreement:
 *  - element columns are emitted in `ch` units (one `ch` = one Courier cell),
 *    so the browser wraps on exactly the engine's character grid;
 *  - vertical rhythm is emitted in multiples of the line pitch, and CSS
 *    margin collapsing (max of adjacent margins) reproduces the engine's
 *    max(spacingAfter, spacingBefore) gap rule.
 */
import { inchesToCh } from "./metrics";
import {
  FORMAT_ELEMENT_KEYS,
  PAGE_SIZES,
  elementColumnIn,
  textBlockWidthIn,
  type ElementAlign,
  type ElementFormat,
  type FormatSpec,
} from "./spec";

function n(value: number): string {
  // Trim float noise (25.000000000000004 → 25) without losing real precision.
  return String(Math.round(value * 1e4) / 1e4);
}

function fontRules(el: ElementFormat): string[] {
  const rules: string[] = [];
  if (el.fontStyle === "italic" || el.fontStyle === "bold-italic")
    rules.push("font-style: italic;");
  if (el.fontStyle === "bold" || el.fontStyle === "bold-italic") rules.push("font-weight: 700;");
  return rules;
}

/**
 * An EMPTY paren-wrapped block: "()" on one line, the caret between
 * (docs/app/writing/editor-ux.md#EDIT-58).
 *
 * The block holds only ProseMirror's trailing break, which would push ")" onto
 * a line of its own, so it is hidden. With nothing to draw against, WebKit and
 * Chromium both put the caret where an empty line of that alignment begins:
 * the left edge, the centre, the right edge. Centred, that is already between
 * the parens. Left or right it was outside them, and dg-modern's parentheticals
 * are left-aligned: the caret sat in front of the "(".
 *
 * So the line begins one character inward on that side, and the paren there is
 * pulled back over the gap. Each paren stays where a written line puts it, and
 * the caret lands between them. The page is set in ch on a monospace face, so
 * one ch is one paren. Checked by snapshotting the painted caret in WebKit and
 * in Chromium, all three alignments, before and after.
 */
function emptyParenWrap(sel: string, align: ElementAlign): string[] {
  const hidden = `${sel} > br.ProseMirror-trailingBreak:only-child { display: none; }`;
  const empty = `${sel}:has(> br.ProseMirror-trailingBreak:only-child)`;
  if (align === "left") {
    return [hidden, `${empty} { text-indent: 1ch; }`, `${empty}::before { margin-left: -1ch; }`];
  }
  if (align === "right") {
    return [
      hidden,
      `${empty} { position: relative; left: -1ch; padding-right: 1ch; }`,
      `${empty}::after { margin-right: -1ch; }`,
    ];
  }
  return [hidden];
}

/**
 * The format's physical geometry as custom properties — the page frame, the
 * margins, the header line, the line pitch.
 *
 * The generated stylesheet sets these on the editor surface. Anything else that
 * has to draw a sheet outside the editor (the export dialog's preview) sets the
 * same map inline, so there is still exactly one place these numbers come from.
 */
export function formatCssVars(spec: FormatSpec): Record<string, string> {
  const { widthIn, heightIn } = PAGE_SIZES[spec.page.size];
  const m = spec.page.margins;
  return {
    "--fmt-page-width": `${n(widthIn)}in`,
    "--fmt-page-height": `${n(heightIn)}in`,
    "--fmt-block-height": `${n(heightIn - m.top - m.bottom)}in`,
    "--fmt-margin-left": `${n(m.left)}in`,
    "--fmt-margin-right": `${n(m.right)}in`,
    "--fmt-margin-top": `${n(m.top)}in`,
    "--fmt-margin-bottom": `${n(m.bottom)}in`,
    "--fmt-header-pos": `${n(spec.header.position)}in`,
    "--fmt-footer-pos": `${n(spec.footer.position)}in`,
    "--fmt-line": `${n(spec.type.size * spec.type.lineHeight)}pt`,
  };
}

/** The complete per-format stylesheet, injected as a <style> by the editor. */
export function formatToCss(spec: FormatSpec): string {
  const out: string[] = [];

  // Page frame + the variables the page-view chrome positions itself with.
  out.push(
    `.editor-surface {`,
    ...Object.entries(formatCssVars(spec)).map(([k, v]) => `  ${k}: ${v};`),
    `}`,
    `.play-page {`,
    `  width: var(--fmt-page-width);`,
    `  padding: var(--fmt-margin-top) var(--fmt-margin-right) var(--fmt-margin-bottom) var(--fmt-margin-left);`,
    `  font-family: ${spec.type.family};`,
    `  font-size: ${n(spec.type.size)}pt;`,
    `  line-height: ${n(spec.type.lineHeight)};`,
    `}`,
  );

  for (const key of FORMAT_ELEMENT_KEYS) {
    const el = spec.elements[key];
    const col = elementColumnIn(spec, key);
    const sel = `.play-page .pl-${key}`;
    const rules: string[] = [];
    if (col.leftIn > 0) rules.push(`margin-left: ${n(inchesToCh(spec, col.leftIn))}ch;`);
    rules.push(`max-width: ${n(inchesToCh(spec, col.widthIn))}ch;`);
    if (el.spacingBefore > 0)
      rules.push(`margin-top: calc(${n(el.spacingBefore)} * var(--fmt-line));`);
    if (el.spacingAfter > 0)
      rules.push(`margin-bottom: calc(${n(el.spacingAfter)} * var(--fmt-line));`);
    if (el.align !== "left") rules.push(`text-align: ${el.align};`);
    if (el.textTransform !== "none") rules.push(`text-transform: ${el.textTransform};`);
    rules.push(...fontRules(el));
    if (el.underline) rules.push("text-decoration: underline;");
    if (el.letterSpacing > 0) rules.push(`letter-spacing: ${n(el.letterSpacing)}em;`);
    out.push(`${sel} {`, ...rules.map((r) => `  ${r}`), `}`);
    if (el.standaloneIndentFromMargin !== null) {
      const standalone = elementColumnIn(spec, key, true);
      out.push(
        `${sel}:not(.pm-beside-body) { margin-left: ${n(inchesToCh(spec, standalone.leftIn))}ch; max-width: ${n(inchesToCh(spec, standalone.widthIn))}ch; }`,
      );
    }
    if (el.parenWrap) {
      out.push(`${sel}::before { content: "("; }`, `${sel}::after { content: ")"; }`);
      out.push(...emptyParenWrap(sel, el.align));
    }
    if (el.suffix)
      out.push(
        `${sel}::after { content: ${JSON.stringify((el.parenWrap ? ")" : "") + el.suffix)}; }`,
      );
    if (el.besideNext) {
      out.push(
        `${sel}.pm-beside { float: left; width: ${n(inchesToCh(spec, col.widthIn))}ch; margin-top: 0; margin-bottom: 0; }`,
      );
    }
    if (el.tightStack) {
      out.push(`.play-page .pl-${key} + .pl-${key} { margin-top: 0; }`);
    }
    // A page break inside a block (a speech or direction split across sheets)
    // draws its chrome INSIDE that block, in its column — so the next sheet's
    // header and this sheet's footer would start at the element's indent. Pull
    // them back out to the text block's own edges.
    const rightGapIn = textBlockWidthIn(spec) - col.leftIn - col.widthIn;
    if (col.leftIn > 1e-9 || rightGapIn > 1e-9) {
      const outward = (inches: number) =>
        inches > 1e-9 ? `-${n(inchesToCh(spec, inches))}ch` : "0";
      out.push(
        `${sel} .pgchrome__header, ${sel} .pgchrome__footer {`,
        `  left: ${outward(col.leftIn)};`,
        `  right: ${outward(rightGapIn)};`,
        `}`,
      );
    }
    if (!el.print) {
      // Page view is print-faithful: non-printing elements collapse there
      // (edit them in the galley), so DOM geometry matches the engine's.
      out.push(`.play-page.is-paginated .pl-${key} { display: none; }`);
    }
  }

  // Inline notes are print-invisible (fountain [[ ]]): hidden in page view so
  // line wrapping matches the engine, which strips them from print text.
  out.push(`.play-page.is-paginated .pl-note { display: none; }`);

  // A block whose only content is comments (a standalone [[ ]] line) prints
  // nothing at all — the engine skips the whole block — so page view hides the
  // whole block too, trailing-break height included (docs/app/writing/comments.md#COMM-D4). The
  // class is a node decoration from the Comments plugin, chrome not document.
  out.push(`.play-page.is-paginated .pl-commentonly { display: none; }`);
  out.push(`.play-page .pm-beside-clear { clear: both; height: 0; }`);
  out.push(`.play-page .pm-beside-gap { clear: both; }`);
  out.push(`.play-page .pm-beside-body { margin-top: 0; }`);
  out.push(`.play-page .pm-before-beside { margin-bottom: 0; }`);
  out.push(
    `.play-page .pm-run-in { float: left; margin-top: 0; margin-bottom: 0; margin-right: 1ch; }`,
  );
  out.push(`.play-page .pm-run-in-body { margin-top: 0; }`);
  // Continued cues already contain the engine's final print text, including
  // the marker's own case. Do not transform or punctuate them a second time.
  out.push(`.play-page .pgchrome__contd { text-transform: none; }`);
  out.push(
    `.play-page .pgchrome__contd::before, .play-page .pgchrome__contd::after { content: none; }`,
  );

  return out.join("\n");
}
