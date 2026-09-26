// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
export interface FeedbackDraft {
  message: string;
  email: string;
  includeDetails: boolean;
}
export const emptyDraft = (): FeedbackDraft => ({ message: "", email: "", includeDetails: false });
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
export const characters = (text: string): number => [...segmenter.segment(text)].length;
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
  !!draft.message.trim() && characters(draft.message) <= 10000 && validEmail(draft.email);
