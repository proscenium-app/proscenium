// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import {
  decodeKeptAtQuit,
  encodeKeptAtQuit,
  keptAtQuitMessage,
  type KeptAtQuit,
} from "./quit-note";

const mara: KeptAtQuit = {
  kind: "document",
  name: "Mara",
  folder: "Characters",
  refusal: "locked",
};
const notes: KeptAtQuit = {
  kind: "outline",
  name: "Outline notes",
  folder: "The Tide",
  refusal: null,
};

describe("the note a quit leaves for the play's next open", () => {
  it("reads back what it wrote", () => {
    expect(decodeKeptAtQuit(encodeKeptAtQuit([mara, notes]))).toEqual([mara, notes]);
  });

  it("is no note when it cannot be read, and drops only the entries it cannot (docs/app/keeping-work/storage-and-file-format.md#STOR-107)", () => {
    for (const raw of [
      "",
      "not json",
      "null",
      "[]",
      '{"kept": "Mara"}',
      '{"kept": [null, 3, {}]}',
    ]) {
      expect(decodeKeptAtQuit(raw)).toEqual([]);
    }
    const mixed = JSON.stringify({
      kept: [
        { kind: "document", name: "Mara", folder: "Characters", refusal: "locked" },
        { kind: "spreadsheet", name: "Budget" },
        { kind: "script", name: "", folder: "x" },
        // A refusal from a newer build: the words are still kept, only the reason is unknown here.
        { kind: "script", name: "The Tide", refusal: "cosmic-rays" },
      ],
    });
    expect(decodeKeptAtQuit(mixed)).toEqual([
      mara,
      { kind: "script", name: "The Tide", folder: "", refusal: null },
    ]);
  });

  it("says where the words went, and why, in the refusal's own words", () => {
    expect(keptAtQuitMessage([mara, notes])).toEqual({
      title:
        "What was typed in “Mara”, “Outline notes” before Proscenium quit is kept in Versions, because it couldn't be saved.",
      detail: "“Mara” is locked in Finder.",
      code: "E-SAVE-LOCKED",
    });
    // Behind the "changed somewhere else" choice there is no refusal to name.
    expect(keptAtQuitMessage([notes])).toBe(
      "What was typed in “Outline notes” before Proscenium quit is kept in Versions, because it couldn't be saved.",
    );
    expect(keptAtQuitMessage([])).toBeNull();
  });
});
