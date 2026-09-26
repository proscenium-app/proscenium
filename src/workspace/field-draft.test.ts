// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { draftToCommit } from "./field-draft";

describe("a field over a value the store owns", () => {
  it("commits nothing when the writer only clicked in and out", () => {
    // The synopsis changed in the script after the field first rendered; the
    // field still showing the old one must not write it back.
    expect(draftToCommit(false, "Morning. The truce.", "Morning. They talk.")).toBeNull();
  });

  it("commits what was typed, and nothing that matches the store already", () => {
    expect(draftToCommit(true, "Morning. They argue.", "Morning. They talk.")).toBe("Morning. They argue.");
    expect(draftToCommit(true, "Morning. They talk.", "Morning. They talk.")).toBeNull();
  });
});
