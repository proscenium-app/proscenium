// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The format module: declarative script formats (docs/app/formatting/formats-and-layout.md#SCHEMA-D100).
 * Renderer + pagination engine consume a resolved FormatSpec from here;
 * neither holds layout constants of its own.
 */
export {
  FORMAT_ELEMENT_KEYS,
  HEADER_TOKENS,
  OPTIONAL_FORMAT_ELEMENT_PRESETS,
  PAGE_SIZES,
  REQUIRED_FORMAT_ELEMENTS,
  elementColumnIn,
  linePitchIn,
  maxLinesPerPage,
  pageSizeIn,
  textBlockHeightIn,
  textBlockWidthIn,
} from "./spec";
export type {
  ElementAlign,
  ElementFontStyle,
  ElementFormat,
  ElementTransform,
  FormatSpec,
  FrontMatterSpec,
  HeaderFooterSlot,
  HeaderToken,
  HeaderFooterSpec,
  PageMargins,
  PageSizeName,
  PageSpec,
  PaginationRules,
  TypeSpec,
} from "./spec";
export { formatCssVars, formatToCss } from "./css";
export { MONO_ADVANCE_EM, charAdvanceIn, charsPerLine, inchesToCh } from "./metrics";
export {
  DEFAULT_DUAL_DIALOGUE,
  DEFAULT_ELEMENT,
  DEFAULT_HEADER_FOOTER,
  DEFAULT_PAGINATION,
  parseFormatFile,
  validateFormatSpec,
} from "./validate";
export type { FormatValidation } from "./validate";
export { formatFileObject, formatFileText, formatIdFromName } from "./serialize";
export {
  DEFAULT_FORMAT_ID,
  FormatRegistry,
  builtinFormats,
  ensureFormatsLoaded,
  formatRegistrySnapshot,
  loadFormatRegistry,
  reloadFormats,
  subscribeFormats,
} from "./registry";
export type { FormatOrigin, FormatProblem } from "./registry";
