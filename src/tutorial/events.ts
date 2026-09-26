// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useSyncExternalStore } from "react";
export function openHelp() {
  window.dispatchEvent(new Event("proscenium:help"));
}
export interface ExportFacts {
  open: boolean;
  range: boolean;
  rangeError: boolean;
  opening: boolean;
  preview: boolean;
}
export const CLOSED_EXPORT: ExportFacts = {
  open: false,
  range: false,
  rangeError: false,
  opening: false,
  preview: false,
};
let facts: ExportFacts = CLOSED_EXPORT;
const listeners = new Set<() => void>();
export function publishExportFacts(next: ExportFacts) {
  if (
    Object.keys(next).every((k) => next[k as keyof ExportFacts] === facts[k as keyof ExportFacts])
  )
    return;
  facts = next;
  listeners.forEach((fn) => fn());
}
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export function useExportFacts() {
  return useSyncExternalStore(subscribe, () => facts);
}
/** The export sheet's facts as they are now, for a wait that runs outside render. */
export const exportFactsNow = () => facts;
/** Show Me for the export steps: the sheet's own setters, registered while it is open. */
export const tutorialActions = new Map<string, () => void>();
