// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The feedback sheet's draft, as the vault client loads, saves and sends it
 * (`feedback` in ipc.ts); src/feedback/model.ts says when one can be sent.
 */
export interface FeedbackDraft {
  message: string;
  email: string;
  includeDetails: boolean;
}
export const emptyDraft = (): FeedbackDraft => ({ message: "", email: "", includeDetails: false });
