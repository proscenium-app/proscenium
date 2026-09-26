// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Material schemas and the app-maintained sections inside them.
 */
export {
  SCHEMAS,
  LEGACY_TYPES,
  UNIVERSAL_FIELDS,
  MANAGED_MARK,
  defaultDirFor,
  normalizeType,
  renderTemplate,
  schemaFor,
} from "./schema";
export type { FieldSpec, MaterialSchema, SectionSpec } from "./schema";

export { hasManagedSection, renderAppearances, writeManagedSection } from "./managed";

export { inferType } from "./infer";

export { syncAppearances } from "./appearances-sync";
export type { AppearanceSyncResult } from "./appearances-sync";
