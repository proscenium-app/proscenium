// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Modals mount in layer order. Their host is inside the accessible dialog,
 * beside the painted panel, so its animation/filter cannot trap fixed menus. */
export function portalHost(): HTMLElement {
  const hosts = document.querySelectorAll<HTMLElement>("[data-modal-portal]");
  return hosts[hosts.length - 1] ?? document.body;
}
