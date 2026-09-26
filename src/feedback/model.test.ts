// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from "bun:test";
import { canSend, characters, emptyDraft, hasDraft, validEmail } from "./model";
test("feedback counts graphemes and preserves the pasted value beyond the limit", () => {
  const text = "👩🏽‍💻e\u0301".repeat(5000);
  expect(characters(text)).toBe(10000);
  expect(canSend({ ...emptyDraft(), message: text })).toBe(true);
  const draft = { ...emptyDraft(), message: text + "x" };
  expect(canSend(draft)).toBe(false);
  expect(draft.message).toBe(text + "x");
});
test("only words are required; email is checked only when supplied", () => {
  expect(canSend(emptyDraft())).toBe(false);
  expect(canSend({ ...emptyDraft(), message: " \n\t" })).toBe(false);
  expect(canSend({ ...emptyDraft(), message: "An idea" })).toBe(true);
  for (const email of ["", " ", "writer@example.org", "a+b@example.org"])
    expect(validEmail(email)).toBe(true);
  for (const email of ["bad", "a@b", "a@b.c\nBcc:x@y.z", "a@-bad.org"])
    expect(validEmail(email)).toBe(false);
});
test("any entered field keeps a draft, including the checkbox", () => {
  expect(hasDraft(emptyDraft())).toBe(false);
  for (const patch of [{ message: " " }, { email: "a" }, { includeDetails: true }])
    expect(hasDraft({ ...emptyDraft(), ...patch })).toBe(true);
});
