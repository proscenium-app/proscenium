// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
export function openFeedback(formats: string[] = []): void {
  window.dispatchEvent(new CustomEvent("proscenium:feedback", { detail: formats }));
}
