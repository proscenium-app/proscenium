// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from "bun:test";
import { canonicalLanguage } from "./language";

test("docs/app/preferences-and-help/accessibility.md#A11Y-13: export language accepts canonical BCP 47 codes and rejects invalid input", () => {
  expect(canonicalLanguage(" fr-ca ")).toBe("fr-CA");
  expect(canonicalLanguage("zh-Hant-TW")).toBe("zh-Hant-TW");
  for (const code of ["", "English (US)", "fr_CA", "e", "en-".repeat(100)]) {
    expect(canonicalLanguage(code)).toBeNull();
  }
});
