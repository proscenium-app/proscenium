// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Writing and PDF language, saved per play independently of page format. */
export const DEFAULT_PLAY_LANGUAGE = "en-US";

export type SpellingLanguage = "en-US" | "en-GB";

/** Never check another language against English. Bare English keeps the
 * existing American dictionary; regional variants need their own word list. */
export function spellingLanguage(value: string): SpellingLanguage | null {
  const canonical = canonicalLanguage(value);
  if (!canonical) return null;
  const locale = new Intl.Locale(canonical);
  if (locale.language !== "en") return null;
  if (locale.region === "GB") return "en-GB";
  if (!locale.region || locale.region === "US") return "en-US";
  return null;
}

export function languageHelp(value: string): string {
  const dictionary = spellingLanguage(value);
  return dictionary
    ? `${dictionary === "en-GB" ? "British" : "American"} spelling, screen readers and PDFs. Saved for this play.`
    : "Screen readers and PDFs use this language. No spelling dictionary is bundled for it.";
}

export function canonicalLanguage(value: string): string | null {
  const code = value.trim();
  if (!code || code.length > 100) return null;
  try {
    return Intl.getCanonicalLocales(code)[0] ?? null;
  } catch {
    return null;
  }
}
