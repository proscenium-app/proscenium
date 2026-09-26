// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useSettings } from "./store";

/** Existing labels stay available even after the writer changes the list. */
export function useSceneStatusOptions(current: string) {
  const { sceneStatuses } = useSettings();
  const values = [...new Set(["", ...sceneStatuses, ...(current ? [current] : [])])];
  return values.map((value) => ({ value, label: value || "No Status" }));
}
