// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Open Send Feedback, from anywhere: a window event the feedback sheet listens
 * for, so that a surface that offers feedback (the Help menu, the tutorial's
 * catalogue) needs nothing of the feedback feature itself. `formats` names the
 * format files a message is about, when it is about one.
 */
export function openFeedback(formats: string[] = []): void {
  window.dispatchEvent(new CustomEvent("proscenium:feedback", { detail: formats }));
}
