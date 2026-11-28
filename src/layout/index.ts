// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Layout/pagination engine — the single source of truth for page breaks.
 * The paginated editor view and the PDF exporter both consume paginate()'s
 * output, so their page counts can never disagree.
 */
export {
  blocksFromDoc,
  frontSheetMetrics,
  buildLayoutBlock,
  paginate,
  paginateDoc,
  paginateBackMatter,
  paginateFrontMatter,
  printOffsetToSrc,
  PRODUCTION_NOTES_HEADING,
  wrapText,
} from "./engine";
export { openingParagraphs } from "./opening-prose";
export { fountainWithPages } from "./fountain-with-pages";
export {
  CHARACTERS_PAGE_FILE,
  FIELDS,
  FOOT_MARK,
  backPageList,
  backPagesFor,
  fieldValue,
  frontPageList,
  legacyBlockAt,
  legacyPageFiles,
  namedOnPage,
  namesOnPages,
  pageBlockAt,
  readPageFile,
  writePageFile,
  type Field,
  type PageLayout,
} from "./page-files";
export {
  movePageBlock,
  pageSpots,
  shownDetails,
  stepPageBlock,
  type MoveStep,
  type MoveTo,
  type Moved,
  type PageGrid,
  type PageSpot,
  type PageSpots,
} from "./page-move";
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
export {
  contentsBothFor,
  contentsFor,
  contentsWidth,
  contentsEntries,
  contentsLines,
  listsCast,
  listsContents,
  type ContentsEntry,
} from "./contents";
export {
  SCAFFOLDS,
  SCAFFOLD_PLACES,
  pageAlready,
  sideOf,
  landsAt,
  pageName,
  pageSheet,
  retemplate,
  scaffoldById,
  scaffoldOf,
  scaffoldSheet,
  type Scaffold,
  type ScaffoldId,
  type ScaffoldPlace,
  type ScaffoldSide,
  speakersListed,
} from "./scaffolds";
