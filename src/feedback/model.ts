// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { FeedbackDraft } from "../storage/feedback-draft";
// The draft's shape is the vault client's, which loads, saves and sends it.
export { emptyDraft, type FeedbackDraft } from "../storage/feedback-draft";
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
export const characters = (text: string): number => [...segmenter.segment(text)].length;
/** The most characters a message may hold. */
export const MESSAGE_LIMIT = 10000;
export const hasDraft = (draft: FeedbackDraft): boolean =>
  !!(draft.message || draft.email || draft.includeDetails);
export function validEmail(text: string): boolean {
  const email = text.trim();
  return (
    !email ||
    (email.length <= 254 &&
      /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(
        email,
      ))
  );
}
export const canSend = (draft: FeedbackDraft): boolean =>
  !!draft.message.trim() && characters(draft.message) <= MESSAGE_LIMIT && validEmail(draft.email);
