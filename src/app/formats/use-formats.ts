// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The app's one format registry, for React: built-ins at once, the user's
 * formats as soon as the folder has been read, and again after every save,
 * import or delete (`reloadFormats` in src/format/registry.ts).
 */
import { useEffect, useSyncExternalStore } from "react";
import {
  ensureFormatsLoaded,
  formatRegistrySnapshot,
  subscribeFormats,
  type FormatRegistry,
} from "../../format";

export function useFormatRegistry(): FormatRegistry {
  const registry = useSyncExternalStore(
    subscribeFormats,
    formatRegistrySnapshot,
    formatRegistrySnapshot,
  );
  useEffect(() => ensureFormatsLoaded(), []);
  return registry;
}
