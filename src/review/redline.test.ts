// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import {
  compactRedline,
  lineUnits,
  redlineChanges,
  redlineRows,
  tokenize,
  type RedlineRow,
  type RedlineUnit,
} from "./redline";

/** A rewritten row as text: [-cut-] and {+added+} around the words. */
function shown(row: RedlineRow, a: RedlineUnit[], b: RedlineUnit[]): string {
  const all = (u: RedlineUnit) => u.tokens.map((t) => t.key).join("");
  if (row.state === "same") return all(b[row.b]);
  if (row.state === "add") return `{+${all(b[row.b])}+}`;
  if (row.state === "del") return `[-${all(a[row.a])}-]`;
  return row.parts
    .map((part) =>
      part.state === "del"
        ? `[-${part.a.map((i) => a[row.a].tokens[i].key).join("")}-]`
        : part.state === "add"
          ? `{+${part.b.map((i) => b[row.b].tokens[i].key).join("")}+}`
          : part.b.map((i) => b[row.b].tokens[i].key).join(""),
    )
    .join("");
}

function redline(before: string, after: string): string[] {
  const a = lineUnits(before);
  const b = lineUnits(after);
  return redlineRows(a, b).map((row) => shown(row, a, b));
}

describe("tokenize", () => {
  test("words keep their apostrophes; spaces and punctuation stand alone", () => {
    expect(tokenize("Don't go, Mara.").map((t) => t.key)).toEqual([
      "Don't",
      " ",
      "go",
      ",",
      " ",
      "Mara",
      ".",
    ]);
    expect(tokenize("Don't go.").map((t) => t.word)).toEqual([true, false, true, false]);
  });

  test("every character of the text is in a token", () => {
    const text = "  Wait — «quoi»?\tNo… 3 a.m.";
    expect(
      tokenize(text)
        .map((t) => t.key)
        .join(""),
    ).toBe(text);
  });
});

describe("redlineRows", () => {
  test("a reworded line is one line, the cut words before the ones that took their place", () => {
    expect(
      redline("The pipe's been crying all night.", "The pipe has been weeping all night long."),
    ).toEqual(["The [-pipe's-]{+pipe has+} been [-crying-]{+weeping+} all night{+ long+}."]);
  });

  test("two changed words with a space between them are one change, not two", () => {
    expect(redline("the quick brown fox jumps", "the slow red fox jumps")).toEqual([
      "the [-quick brown-]{+slow red+} fox jumps",
    ]);
  });

  test("a line rewritten past recognition is struck whole, the new one after it", () => {
    expect(redline("You and that pipe.", "Go back to bed, Jonah.")).toEqual([
      "[-You and that pipe.-]{+Go back to bed, Jonah.+}",
    ]);
  });

  test("a line added above a reworded one does not take its place", () => {
    expect(
      redline(
        "first\nI keep listening for it.\nlast",
        "first\nQuiet.\nI keep on listening for it.\nlast",
      ),
    ).toEqual(["first", "{+Quiet.+}", "I keep {+on +}listening for it.", "last"]);
  });

  test("lines cut and lines added with nothing in common stay apart, the cut ones first", () => {
    expect(redline("a\nred lorry\nyellow lorry\nz", "a\nsix sick hicks\nz")).toEqual([
      "a",
      "[-red lorry-]",
      "[-yellow lorry-]",
      "{+six sick hicks+}",
      "z",
    ]);
  });

  test("the same text is all kept, and counts no change", () => {
    const a = lineUnits("one\ntwo");
    const rows = redlineRows(a, lineUnits("one\ntwo"));
    expect(rows.map((r) => r.state)).toEqual(["same", "same"]);
    expect(redlineChanges(rows)).toBe(0);
  });

  test("a block is only read word against word with one of its kind", () => {
    const cue: RedlineUnit = { kind: "character", tokens: tokenize("MARA") };
    const line: RedlineUnit = { kind: "dialogue", tokens: tokenize("Mara, wait") };
    expect(redlineRows([cue], [line]).map((r) => r.state)).toEqual(["del", "add"]);
  });

  test("the same words in another kind of block are that block, changed", () => {
    const action: RedlineUnit = { kind: "action", tokens: tokenize("She waits.") };
    const speech: RedlineUnit = { kind: "dialogue", tokens: tokenize("She waits.") };
    const rows = redlineRows([action], [speech]);
    expect(rows.map((r) => r.state)).toEqual(["mod"]);
    expect(rows[0].state === "mod" && rows[0].parts.every((p) => p.state === "same")).toBe(true);
  });

  test("a block marked whole is never read word against word", () => {
    const was: RedlineUnit = {
      kind: "boneyard",
      whole: true,
      tokens: [{ key: "old cut", word: true }],
    };
    const is: RedlineUnit = {
      kind: "boneyard",
      whole: true,
      tokens: [{ key: "old cut scene", word: true }],
    };
    expect(redlineRows([was], [is]).map((r) => r.state)).toEqual(["del", "add"]);
  });
});

describe("compactRedline", () => {
  const rows = (states: string): RedlineRow[] =>
    [...states].map((s, i) =>
      s === "+"
        ? { state: "add", b: i }
        : s === "-"
          ? { state: "del", a: i }
          : { state: "same", a: i, b: i },
    );
  const shape = (items: ReturnType<typeof compactRedline>) =>
    items.map((item) => (item.kind === "skip" ? `skip ${item.count}` : item.index)).join(" ");

  test("unchanged rows far from a change are left out, counted", () => {
    expect(shape(compactRedline(rows("......+......"), 2))).toBe("skip 4 4 5 6 7 8 skip 4");
  });

  test("nothing changed is nothing to show", () => {
    expect(compactRedline(rows("....."), 2)).toEqual([]);
  });

  test("one row is never left out alone", () => {
    expect(shape(compactRedline(rows(".+...+."), 1))).toBe("0 1 2 3 4 5 6");
  });

  test("rows that belong together are shown together", () => {
    // Row 3 is the last of the context; it cannot be shown without row 4, nor 4 without 5.
    const items = compactRedline(rows("+........."), 3, (i) => i === 3 || i === 4);
    expect(shape(items)).toBe("0 1 2 3 4 5 skip 4");
  });

  test("a skip says which row comes after it", () => {
    const items = compactRedline(rows("....+"), 1);
    expect(items[0]).toEqual({ kind: "skip", count: 3, next: 3 });
  });
});
