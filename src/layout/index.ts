// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Layout/pagination engine — the single source of truth for page breaks.
 * The paginated editor view and the PDF exporter both consume paginate()'s
 * output, so their page counts can never disagree.
 */
export {
  blocksFromDoc,
  buildLayoutBlock,
  paginate,
  paginateDoc,
  paginateFrontMatter,
  printOffsetToSrc,
  wrapText,
} from "./engine";
export {
  pageCountLabel,
  pageRangeLabel,
  scenePageMap,
} from "./scene-pages";
export type { ActPages, ScenePageMap, ScenePages } from "./scene-pages";
export type {
  HeaderText,
  FrontSheetKind,
  FrontMatterLine,
  FrontMatterPage,
  LayoutBlock,
  LayoutLine,
  LayoutMeta,
  LayoutPage,
  LayoutResult,
  PageBreakInfo,
  RawPiece,
  SourceSegment,
  StyleRun,
  WrappedLine,
} from "./engine";
