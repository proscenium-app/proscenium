// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * "Export PDF" and "Print": paginate with THE layout engine (the same call the
 * editor's page view makes), render those pages 1:1, then deliver — through
 * the platform save dialog, or to the platform print panel (a browser download
 * or tab in plain-browser dev). Page counts cannot disagree with the editor
 * because there is only one paginator, and a print cannot disagree with an
 * export because they are the same bytes.
 *
 * A subset can be asked for — printed page numbers, chosen in the export
 * dialog. The pages are still laid out as a whole play and then filtered, so
 * an excerpt breaks exactly where the full script breaks and keeps its own
 * page numbers (pages 12–20 arrive numbered 12–20).
 */
import { type FormatSpec } from "../format";
import type { Doc, FrontMatter } from "../fountain";
import { paginateDoc, type LayoutMeta } from "../layout";
import { exporter } from "../storage";
import { loadPdfFonts } from "./fonts";
import { selectPages, type FrontSheet } from "./plan";
import { renderPdf } from "./render";

export { renderPdf } from "./render";
export type { PdfFontBytes } from "./render";
export {
  FRONT_SHEET_LABEL,
  defaultFrontSheets,
  formatPageRange,
  frontKindsOf,
  frontSheetsFor,
  pageRangeLabel,
  pagerText,
  parsePageRange,
  planSheets,
  resolveFocus,
  selectFrontMatter,
  selectPages,
  styleSegments,
} from "./plan";
export type { FrontSheet, PageSelection, PlannedSheet, SheetPlan, StyleSegment } from "./plan";

export interface ScriptPdfArgs {
  doc: Doc;
  spec: FormatSpec;
  meta: LayoutMeta;
  frontMatter?: FrontMatter | null;
  /** The kinds of front sheet to put before the pages; null/omitted puts every one. */
  frontSheets?: readonly FrontSheet[] | null;
  language?: string;
  /** Printed page numbers to include; null/omitted exports the whole script. */
  pages?: number[] | null;
}

/** The finished file, whatever happens to it next. */
export async function renderScriptPdf(args: ScriptPdfArgs): Promise<Uint8Array> {
  const meta = { ...args.meta, frontMatter: args.frontMatter === undefined ? args.meta.frontMatter : args.frontMatter };
  const layout = selectPages(paginateDoc(args.doc, args.spec, meta), args.pages);
  if (!layout.pages.length) throw new Error("No pages selected.");
  const fonts = await loadPdfFonts();
  return renderPdf({
    layout,
    spec: args.spec,
    meta: args.meta,
    frontMatter: args.frontMatter,
    frontSheets: args.frontSheets,
    language: args.language,
    fonts,
  });
}

export async function exportScriptPdf(
  args: ScriptPdfArgs & { suggestedName: string },
): Promise<string | null> {
  return exporter.saveFile(args.suggestedName, await renderScriptPdf(args));
}

/**
 * Print the same PDF an export would save. The platform's print panel does the
 * rest — printer, copies, paper — and resolves once it is up, not when the
 * printing is done.
 */
export async function printScriptPdf(args: ScriptPdfArgs & { jobTitle: string }): Promise<void> {
  await exporter.print(args.jobTitle, await renderScriptPdf(args));
}
