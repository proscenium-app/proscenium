// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useSyncExternalStore } from "react";
import { Sheet } from "../ui";

let locked = false;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const updateIsInstalling = () => locked;

/** Synchronous protection before saving starts, including any sheet already
 * open. The progress sheet portals outside these inert background nodes. */
export function lockForUpdate(): () => void {
  locked = true;
  const focus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const background = [...document.body.children].filter((el): el is HTMLElement => el instanceof HTMLElement && !el.inert);
  for (const el of background) el.inert = true;
  const prevent = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
  for (const type of ["beforeinput", "paste", "drop"]) window.addEventListener(type, prevent, true);
  for (const listener of listeners) listener();
  return () => {
    for (const el of background) el.inert = false;
    for (const type of ["beforeinput", "paste", "drop"]) window.removeEventListener(type, prevent, true);
    locked = false;
    for (const listener of listeners) listener();
    requestAnimationFrame(() => { if (focus?.isConnected) focus.focus({ preventScroll: true }); });
  };
}

export function UpdateInstallSheet() {
  const installing = useSyncExternalStore(subscribe, updateIsInstalling, () => false);
  if (!installing) return null;
  return <Sheet title="Saving and installing the update…" width={520} labelledBy="update-install-title" onClose={() => {}}>
    <div className="sheet-copy"><p>Proscenium will reopen when the update is installed.</p></div>
  </Sheet>;
}
