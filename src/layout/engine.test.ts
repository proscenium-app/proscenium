// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";

import dgModernRaw from "../../formats/dg-modern.json";
import stageUsModernRaw from "../../formats/stage-us-modern.json";
import type { BlockNode, Doc } from "../fountain/model";
import { charAdvanceIn } from "../format/metrics";
import { validateFormatSpec } from "../format/validate";
import type { FormatSpec } from "../format/spec";
import { paginateDoc, wrapText } from "./engine";

function spec(raw: unknown = dgModernRaw): FormatSpec {
  const v = validateFormatSpec(raw);
  if (!v.ok) throw new Error(v.errors.join("\n"));
  return v.spec;
}

// A fixed six-lines-per-inch fixture keeps boundary cases independent of
// evolving published presets; published.test.ts verifies the shipped geometry.
const DG = spec();
DG.type.lineHeight = 1;

function b(type: BlockNode["type"], text = "", attrs?: Record<string, unknown>): BlockNode {
  return {
    type,
    ...(attrs ? { attrs } : {}),
    content: text ? [{ type: "text", text }] : [],
  };
}

function doc(...blocks: BlockNode[]): Doc {
  return { type: "doc", content: blocks };
}

/** N explicit lines in one block (each shorter than any column). */
function multiline(n: number, tag = "line"): string {
  return Array.from({ length: n }, (_, i) => `${tag} ${i + 1}`).join("\n");
}

/** Prose that wraps to many lines at 60 cpl (words of 7 chars + space). */
function prose(words: number): string {
  return Array.from({ length: words }, (_, i) => `word${String(i % 100).padStart(3, "0")}`).join(
    " ",
  );
}

describe("wrapText", () => {
  it("wraps greedily at spaces on the character grid", () => {
    const lines = wrapText("aaaa bbbb cccc", 9);
    // "aaaa bbbb" hangs its break space; "cccc" on line 2.
    expect(lines.length).toBe(2);
    expect(lines[0].start).toBe(0);
    expect(lines[1].end).toBe(14);
  });

  it("hard-breaks a word longer than the column", () => {
    const lines = wrapText("abcdefghij", 4);
    expect(lines.length).toBe(3); // abcd | efgh | ij
  });

  it("breaks after hyphens like the browser", () => {
    // Units: "well-" (5), "known-" (6), "fact" (4); none pair within 8 cols.
    const lines = wrapText("well-known-fact", 8);
    expect(lines.length).toBe(3);
    expect(lines.map((l) => "well-known-fact".slice(l.start, l.end))).toEqual([
      "well-",
      "known-",
      "fact",
    ]);
  });

  it("honors explicit newlines", () => {
    expect(wrapText("a\nb\nc", 60).length).toBe(3);
  });

  it("represents an empty block as one empty line", () => {
    expect(wrapText("", 60)).toEqual([{ start: 0, end: 0 }]);
  });
});

describe("acceptance 1 — page capacity", () => {
  it("a page holds exactly 54 rows at Courier 12/12", () => {
    const { pages, maxRows } = paginateDoc(doc(b("dialogue", multiline(200))), DG);
    expect(maxRows).toBe(54);
    expect(pages[0].lines).toHaveLength(54);
    expect(pages[0].lines[pages[0].lines.length - 1]?.row).toBe(53);
    // 200 = 54 + 53+1(contd-less…) — no cue, so no CONT'D line, pure 54s.
    expect(pages.map((p) => p.lines.length)).toEqual([54, 54, 54, 38]);
    for (const page of pages) {
      for (const line of page.lines) expect(line.row).toBeLessThan(maxRows);
    }
  });
});

describe("acceptance 2 — a cue is never stranded at a page bottom", () => {
  it("moves cue + dialogue to the next page when <2 dialogue lines would fit", () => {
    // 52 action lines fill rows 0..51; gap 1 puts the cue at row 53 — the
    // last row — leaving no room for even one dialogue line.
    const d = doc(
      b("action", multiline(52)),
      b("character", "MARA"),
      b("dialogue", multiline(4, "speech")),
    );
    const { pages } = paginateDoc(d, DG);
    expect(pages).toHaveLength(2);
    expect(pages[0].lines.every((l) => l.type === "action")).toBe(true);
    expect(pages[1].lines[0].type).toBe("character");
    expect(pages[1].lines[0].row).toBe(0);
    // Welded: dialogue starts on the very next row.
    expect(pages[1].lines[1].type).toBe("dialogue");
    expect(pages[1].lines[1].row).toBe(1);
  });

  it("splits the speech when the minimums CAN be satisfied", () => {
    // 49 action rows + gap(1) → cue at row 50, dialogue rows 51,52,53 = 3
    // lines fit ≥ minBefore(2); remainder 7 ≥ minAfter(2) → split.
    const d = doc(
      b("action", multiline(49)),
      b("character", "MARA"),
      b("dialogue", multiline(10, "speech")),
    );
    const { pages } = paginateDoc(d, DG);
    expect(pages).toHaveLength(2);
    const p1Dialogue = pages[0].lines.filter((l) => l.type === "dialogue" && l.kind === "text");
    expect(p1Dialogue).toHaveLength(3);
    expect(pages[0].breakBefore).toBeUndefined();
    expect(pages[1].breakBefore?.contd).toBe("MARA (CONT'D)");
  });
});

describe("acceptance 3 — a long monologue splits with (CONT'D)", () => {
  it("re-prints the cue and honors both minimums", () => {
    const d = doc(b("character", "Mara"), b("dialogue", multiline(60, "speech")));
    const { pages } = paginateDoc(d, DG);
    expect(pages).toHaveLength(2);
    // Page 1: cue row 0 (uppercased by the format), 53 dialogue lines.
    expect(pages[0].lines[0].text).toBe("MARA");
    expect(pages[0].lines.filter((l) => l.type === "dialogue")).toHaveLength(53);
    // Page 2 opens with the synthetic cue, then the remaining 7 lines.
    const contd = pages[1].lines[0];
    expect(contd.kind).toBe("contd");
    expect(contd.text).toBe("MARA (CONT'D)");
    expect(contd.row).toBe(0);
    const rest = pages[1].lines.filter((l) => l.kind === "text");
    expect(rest).toHaveLength(7);
    expect(rest[0].row).toBe(1); // welded under the re-printed cue
    expect(rest.length).toBeGreaterThanOrEqual(2); // minAfter
  });

  it("chains CONT'D across three pages for a very long speech", () => {
    const d = doc(b("character", "EVA"), b("dialogue", multiline(140, "speech")));
    const { pages } = paginateDoc(d, DG);
    expect(pages).toHaveLength(3);
    expect(pages[0].lines[0].text).toBe("EVA");
    expect(pages[1].lines[0].text).toBe("EVA (CONT'D)");
    expect(pages[2].lines[0].text).toBe("EVA (CONT'D)");
    // Every dialogue line prints exactly once: 53 + 53 + 34 = 140.
    const dialogueLines = pages.flatMap((p) =>
      p.lines.filter((l) => l.type === "dialogue" && l.kind === "text"),
    );
    expect(dialogueLines).toHaveLength(140);
  });
});

describe("acceptance 4 — switching formats never mutates the document", () => {
  it("re-paginates with different page counts, identical document", () => {
    const d = doc(
      b("act", "ACT ONE"),
      b("scene", "SCENE 1"),
      ...Array.from({ length: 30 }, (_, i) => [
        b("character", `VOICE ${i}`),
        b("dialogue", prose(60)),
      ]).flat(),
    );
    const before = JSON.stringify(d);
    const dg = paginateDoc(d, DG);
    const house = paginateDoc(d, spec(stageUsModernRaw));
    expect(JSON.stringify(d)).toBe(before); // document untouched
    expect(dg.maxRows).toBe(54);
    expect(house.maxRows).toBe(45); // 1.2 line height → fewer rows/page
    expect(house.pages.length).toBeGreaterThan(dg.pages.length);
  });
});

describe('acceptance 5 — dialogue wraps at the full 6.0" block', () => {
  it("uses 60 columns, not a screenplay-width column", () => {
    const { pages } = paginateDoc(doc(b("dialogue", prose(120))), DG);
    const lines = pages[0].lines;
    for (const line of lines) expect(line.text.replace(/ +$/, "").length).toBeLessThanOrEqual(60);
    // Greedy fill of 7-char words at 60 cpl → 56-char lines. A 35-column
    // (screenplay) wrap could never produce lines this long.
    expect(Math.max(...lines.map((l) => l.text.trim().length))).toBeGreaterThan(48);
    expect(lines[0].xIn).toBe(0); // starts at the left margin
  });
});

describe("acceptance 6 — blank-line rhythm", () => {
  it("one blank line between speeches, zero inside a speech", () => {
    const d = doc(
      b("character", "MARA"),
      b("dialogue", "The pipe's been crying all night."),
      b("character", "JONAH"),
      b("parenthetical", "half asleep"),
      b("dialogue", "You and that pipe."),
    );
    const { pages } = paginateDoc(d, DG);
    const rows = pages[0].lines.map((l) => [l.text, l.row] as const);
    expect(rows).toEqual([
      ["MARA", 0],
      ["The pipe's been crying all night.", 1],
      ["JONAH", 3], // exactly one blank row between speeches
      ["(half asleep)", 4], // wryly welded, parens from the format
      ["You and that pipe.", 5],
    ]);
  });

  it("puts one blank line before and after stage directions", () => {
    const d = doc(
      b("character", "BOSS"),
      b("dialogue", "Anybody outside?"),
      b("action", "She opens her purse."),
      b("character", "EVA"),
      b("dialogue", "Yes. That woman."),
    );
    const { pages } = paginateDoc(d, DG);
    expect(pages[0].lines.map((l) => l.row)).toEqual([0, 1, 3, 5, 6]);
  });
});

describe("structure and chrome", () => {
  it("acts force a new page; the first page suppresses its header", () => {
    const d = doc(b("action", "A dark stage."), b("act", "ACT TWO"), b("scene", "SCENE 1"));
    const { pages } = paginateDoc(d, DG);
    expect(pages).toHaveLength(2);
    expect(pages[0].header).toBeNull(); // suppressOnFirstPage
    expect(pages[1].header?.right).toBe("2.");
    expect(pages[1].lines[0].text).toBe("ACT TWO");
    expect(pages[1].lines[0].row).toBe(0);
    // act spacingAfter 1 / scene spacingBefore 2 collapse to 2 blank rows.
    expect(pages[1].lines[1].row).toBe(3);
  });

  it("pageBreak elements force a break and print nothing", () => {
    const d = doc(b("action", "Before."), b("pageBreak"), b("action", "After."));
    const { pages } = paginateDoc(d, DG);
    expect(pages).toHaveLength(2);
    expect(pages[0].lines.map((l) => l.text)).toEqual(["Before."]);
    expect(pages[1].lines.map((l) => l.text)).toEqual(["After."]);
  });

  it("skips non-printing elements (synopsis, boneyard) entirely", () => {
    const d = doc(
      b("synopsis", "Mara finds the leak."),
      b("action", "AT RISE: a kitchen."),
      b("boneyard", "cut scene"),
    );
    const { pages } = paginateDoc(d, DG);
    expect(pages[0].lines.map((l) => l.text)).toEqual(["AT RISE: a kitchen."]);
  });

  it("splits long stage directions with min lines on both sides", () => {
    const d = doc(b("action", multiline(50)), b("action", multiline(5, "direction")));
    const { pages } = paginateDoc(d, DG);
    // Block 2 starts at row 51 (50 rows + 1 blank); 3 rows fit, 2 carry over.
    expect(pages).toHaveLength(2);
    const p1Second = pages[0].lines.filter((l) => l.text.startsWith("direction"));
    const p2Second = pages[1].lines.filter((l) => l.text.startsWith("direction"));
    expect(p1Second).toHaveLength(3);
    expect(p2Second).toHaveLength(2);
    expect(pages[1].breakBefore?.contd).toBeNull(); // no CONT'D for action
  });

  it("resolves header tokens from the page-start state", () => {
    const raw = structuredClone(dgModernRaw) as Record<string, unknown>;
    (raw.header as Record<string, unknown>).content = {
      left: "{title} — {act}",
      right: "{page}.",
    };
    const custom = spec(raw);
    const d = doc(b("act", "ACT ONE"), b("scene", "SCENE 1"), b("action", multiline(60)));
    const { pages } = paginateDoc(d, custom, { title: "Tideline" });
    expect(pages).toHaveLength(2);
    expect(pages[1].header?.left).toBe("Tideline — ACT ONE");
    expect(pages[1].header?.right).toBe("2.");
  });

  describe("act-scene-page numbers (docs/app/formatting/formats-and-layout.md#FMT-141)", () => {
    const numbered = (template: string) => {
      const raw = structuredClone(dgModernRaw) as Record<string, unknown>;
      raw.header = { content: { right: template }, position: 0.85, suppressOnFirstPage: false };
      const s = spec(raw);
      s.type.lineHeight = 1;
      return s;
    };
    const roman = numbered("{actRoman}-{sceneNumber}-{page}");
    const rights = (d: Doc, s = roman) => paginateDoc(d, s).pages.map((p) => p.header?.right);

    it("numbers each page by the act and scene it begins in", () => {
      const d = doc(
        b("act", "ACT ONE"),
        b("scene", "SCENE 1"),
        b("action", multiline(60)),
        b("scene", "SCENE 2"),
        b("action", "Short."),
        b("act", "ACT TWO"),
        b("scene", "SCENE 1"),
        b("action", "The end."),
      );
      // Page 2 begins in scene 1 and scene 2 starts part-way down it; ACT TWO
      // opens page 3, so page 3 is in Act Two from its first line.
      expect(rights(d)).toEqual(["I-1-1", "I-1-2", "II-1-3"]);
    });

    it("gives SCENE TBD the next number, and a PROLOGUE none", () => {
      const scenesOwnPage = numbered("{actNumber}-{sceneNumber}-{page}");
      scenesOwnPage.elements.scene.startsNewPage = true;
      const d = doc(
        b("act", "ACT ONE"),
        b("scene", "PROLOGUE"),
        b("action", "A voice."),
        b("scene", "SCENE 1"),
        b("action", "A room."),
        b("scene", "SCENE TBD - THE DORM"),
        b("action", "A dorm."),
      );
      expect(rights(d, scenesOwnPage)).toEqual(["1-1", "1-1-2", "1-2-3"]);
    });

    it("drops the act from a one-act and the scene from a play without scenes", () => {
      expect(rights(doc(b("scene", "SCENE 3"), b("action", multiline(60))))).toEqual([
        "3-1",
        "3-2",
      ]);
      expect(rights(doc(b("action", multiline(60))))).toEqual(["1", "2"]);
    });

    it("numbers a heading pushed to the next page once", () => {
      // The unnumbered scene lands at the bottom of page 1, travels to page 2
      // with its speech, and is still scene 2 — not 3.
      const d = doc(
        b("scene", "SCENE 1"),
        b("action", multiline(48)),
        b("scene", "SCENE TBD"),
        b("character", "MARA"),
        b("dialogue", "Hello."),
      );
      expect(rights(d)).toEqual(["1-1", "2-2"]);
    });
  });

  it("puts the act that opens a page in that page's header", () => {
    const raw = structuredClone(dgModernRaw) as Record<string, unknown>;
    raw.header = {
      content: { left: "{act}", right: "{scene}" },
      position: 0.85,
      suppressOnFirstPage: false,
    };
    const d = doc(
      b("act", "ACT ONE"),
      b("scene", "SCENE 4"),
      b("action", "Lights."),
      b("act", "ACT TWO"),
      b("action", "Before any scene."),
    );
    const { pages } = paginateDoc(d, spec(raw));
    expect(pages.map((p) => [p.header?.left, p.header?.right])).toEqual([
      ["ACT ONE", "SCENE 4"],
      // A new act has no scene until one is named.
      ["ACT TWO", undefined],
    ]);
  });

  it("appends a character extension to the printed cue", () => {
    const d = doc(b("character", "Mara", { extension: "(O.S.)" }), b("dialogue", "Jonah?"));
    const { pages } = paginateDoc(d, DG);
    expect(pages[0].lines[0].text).toBe("MARA (O.S.)");
  });

  it("prints an extension held as text exactly like the attribute (docs/engineering/fountain-model.md#EDIT-124)", () => {
    // The page view reads the editor, where a cue's extension is text; the PDF
    // reads the model, where it is the attribute. They must be the same pages.
    const lines = (d: Doc) => paginateDoc(d, DG).pages.map((p) => p.lines.map((l) => l.text));
    const asText = doc(b("character", "Mara (O.S.)"), b("dialogue", multiline(60, "speech")));
    const asAttr = doc(
      b("character", "Mara", { extension: "(O.S.)" }),
      b("dialogue", multiline(60, "speech")),
    );
    const text = lines(asText);
    expect(text[0][0]).toBe("MARA (O.S.)");
    expect(text[1][0]).toBe("MARA (CONT'D)");
    expect(text).toEqual(lines(asAttr));
  });

  it("does not read a cue that starts with a bracket as an extension", () => {
    const { pages } = paginateDoc(doc(b("character", "(beat)"), b("dialogue", "Hm.")), DG);
    expect(pages[0].lines[0].text).toBe("(BEAT)");
  });

  it("centers and right-aligns on the column (scene centered, transition right)", () => {
    const d = doc(b("scene", "SCENE 1"), b("transition", "Blackout."));
    const { pages } = paginateDoc(d, DG);
    const scene = pages[0].lines[0];
    // Center/right alignment uses the embedded face's exact character advance.
    expect(scene.xIn).toBeCloseTo((6 - 7 * charAdvanceIn(DG)) / 2, 5);
    const transition = pages[0].lines[1];
    expect(transition.text).toBe("BLACKOUT.");
    expect(transition.xIn).toBeCloseTo(6 - 9 * charAdvanceIn(DG), 5);
  });
});

describe("dual dialogue (docs/app/formatting/formats-and-layout.md#FMT-100)", () => {
  // dg-modern: 6.0" block, 0.2" gutter → halves 2.9" at 0 and 3.1".
  const RIGHT_HALF_X = 3.1;

  it("lays a pair side by side; the taller side sets the height", () => {
    const d = doc(
      b("character", "MARA"),
      b("dialogue", multiline(2, "la")),
      b("character", "JONAH", { dual: true }),
      b("dialogue", multiline(4, "ra")),
      b("action", "After."),
    );
    const { pages } = paginateDoc(d, DG);
    expect(pages).toHaveLength(1);
    const lines = pages[0].lines;

    const cues = lines.filter((l) => l.type === "character");
    expect(cues).toHaveLength(2);
    // Both cues on the SAME row, one per half (dg cues are left-aligned, so
    // they sit at their half's left edge).
    expect(cues[0].row).toBe(cues[1].row);
    expect(Math.min(cues[0].xIn, cues[1].xIn)).toBeCloseTo(0, 5);
    expect(Math.max(cues[0].xIn, cues[1].xIn)).toBeCloseTo(RIGHT_HALF_X, 5);

    const rightLines = lines.filter((l) => l.xIn >= RIGHT_HALF_X - 1e-9);
    expect(rightLines).toHaveLength(5); // cue + 4 dialogue lines
    const leftDialogue = lines.filter((l) => l.type === "dialogue" && l.xIn < RIGHT_HALF_X - 1e-9);
    expect(leftDialogue).toHaveLength(2);

    // The block after the pair clears BOTH halves: base 0 + max(3,5) rows +
    // collapsed gap max(dialogue.after=0, action.before=1) = row 6.
    const after = lines.find((l) => l.type === "action");
    expect(after?.row).toBe(6);
    expect(after?.xIn).toBeCloseTo(2.5, 5); // full-measure indent resumes
  });

  it("never splits a pair: a pair that misses the page bottom moves whole", () => {
    const d = doc(
      b("action", multiline(50)),
      b("character", "MARA"),
      b("dialogue", multiline(2, "la")),
      b("character", "JONAH", { dual: true }),
      b("dialogue", multiline(4, "ra")),
    );
    const { pages } = paginateDoc(d, DG);
    expect(pages).toHaveLength(2);
    expect(pages[0].lines.every((l) => l.type === "action")).toBe(true);
    const cueRows = pages[1].lines.filter((l) => l.type === "character").map((l) => l.row);
    expect(cueRows).toEqual([0, 0]); // both halves restart together at the top
  });

  it("falls back to sequential full-measure layout when a pair exceeds a page", () => {
    const d = doc(
      b("character", "MARA"),
      b("dialogue", multiline(2, "la")),
      b("character", "JONAH", { dual: true }),
      b("dialogue", multiline(60, "ra")),
    );
    const { pages } = paginateDoc(d, DG);
    expect(pages.length).toBeGreaterThan(1);
    // Sequential: nothing sits in the right half, and the long speech splits
    // with the normal re-printed cue.
    for (const page of pages) {
      for (const line of page.lines) {
        expect(line.xIn).toBeLessThan(RIGHT_HALF_X - 1e-9);
      }
    }
    expect(pages.some((p) => p.lines.some((l) => l.kind === "contd"))).toBe(true);
  });

  it("an unpaired ^ cue lays out sequentially at full measure", () => {
    const d = doc(b("character", "JONAH", { dual: true }), b("dialogue", "Hi."));
    const { pages } = paginateDoc(d, DG);
    expect(pages).toHaveLength(1);
    const cue = pages[0].lines.find((l) => l.type === "character");
    expect(cue?.xIn).toBeCloseTo(2.5, 5); // full-measure indent, not a half
  });
});

describe("first-page header (docs/app/formatting/formats-and-layout.md#FMT-69)", () => {
  it("renders on page 1 for formats that don't suppress it", () => {
    const raw = structuredClone(dgModernRaw) as { header: { suppressOnFirstPage: boolean } };
    raw.header.suppressOnFirstPage = false;
    const s = spec(raw);
    const { pages } = paginateDoc(doc(b("action", "Hello.")), s, { title: "T" });
    expect(pages[0].header).toEqual({ right: "1." });
  });

  it("stays suppressed on page 1 with the shipped dg-modern", () => {
    const { pages } = paginateDoc(doc(b("action", multiline(120))), DG);
    expect(pages[0].header).toBeNull();
    expect(pages[1].header).toEqual({ right: "2." });
  });
});

/**
 * Shift+Enter is a single line break: the next line sits directly under this
 * one, in the same block, single-spaced. Air between two beats comes from
 * Enter (a new block, which the format spaces) — not from this key. Assert
 * what prints, in both formats, since that is what the writer sees.
 */
describe("Shift+Enter is single-spaced", () => {
  const STAGE = spec(stageUsModernRaw);

  /** Blank lines between the row carrying `first` and the row carrying `second`. */
  const blankLinesBetween = (d: Doc, s: FormatSpec, first: string, second: string): number => {
    const { pages } = paginateDoc(d, s);
    const lines = pages.flatMap((p) => p.lines);
    const a = lines.find((l) => l.text.includes(first));
    const b2 = lines.find((l) => l.text.includes(second));
    if (!a || !b2) throw new Error(`missing line: ${!a ? first : second}`);
    return b2.row - a.row - 1;
  };

  it("a break in a speech puts the next line directly under, in both formats", () => {
    const d = doc(b("character", "MARA"), b("dialogue", "One.\nTwo."));
    expect(blankLinesBetween(d, DG, "One.", "Two.")).toBe(0);
    expect(blankLinesBetween(d, STAGE, "One.", "Two.")).toBe(0);
  });

  it("a break in a stage direction does the same", () => {
    const d = doc(b("action", "She crosses.\nShe opens it."));
    expect(blankLinesBetween(d, DG, "crosses", "opens")).toBe(0);
    expect(blankLinesBetween(d, STAGE, "crosses", "opens")).toBe(0);
  });

  it("many breaks stay single-spaced — no gap creeps in", () => {
    const d = doc(b("action", "One.\nTwo.\nThree."));
    expect(blankLinesBetween(d, DG, "One.", "Two.")).toBe(0);
    expect(blankLinesBetween(d, DG, "Two.", "Three.")).toBe(0);
  });

  /** The contrast: air between beats is Enter's job, and it is one line. */
  it("two separate directions (what Enter makes) DO sit one line apart", () => {
    const d = doc(b("action", "She crosses."), b("action", "She opens it."));
    expect(blankLinesBetween(d, DG, "crosses", "opens")).toBe(1);
    expect(blankLinesBetween(d, STAGE, "crosses", "opens")).toBe(1);
  });
});

/**
 * A speech that runs over a page break re-prints its cue as "NAME (CONT'D)".
 * That cue must sit in the character column exactly like a real one — in
 * dg-modern the column is indented from the margin, which is what makes a cue
 * read as centred on the page, and a continued cue that ignores it slams
 * against the left margin instead. (The editor's page view had that bug via a
 * blanket `margin: 0` on the chrome; this pins the engine, and with it the PDF.)
 */
describe("continued cue keeps the character column", () => {
  const STAGE = spec(stageUsModernRaw);
  const split = doc(b("character", "MARA"), b("dialogue", multiline(120)));

  const cues = (s: FormatSpec) => {
    const { pages } = paginateDoc(split, s);
    const lines = pages.flatMap((p) => p.lines);
    const real = lines.find((l) => l.kind === "text" && l.type === "character");
    const contd = lines.find((l) => l.kind === "contd");
    if (!real || !contd) throw new Error("expected both a real cue and a continued one");
    return { real, contd };
  };

  it("re-prints the cue at all when a speech splits", () => {
    const { contd } = cues(DG);
    expect(contd.text).toBe("MARA (CONT'D)");
  });

  it("indented column (dg-modern): same left edge as a real cue", () => {
    const { real, contd } = cues(DG);
    expect(contd.xIn).toBeCloseTo(real.xIn, 6);
    expect(contd.xIn).toBeGreaterThan(0); // i.e. it is NOT flush to the margin
  });

  it("a custom centred column: same centre as a real cue", () => {
    const centered = structuredClone(STAGE);
    centered.elements.character.align = "center";
    const { real, contd } = cues(centered);
    const adv = charAdvanceIn(STAGE);
    const centre = (l: { xIn: number; text: string }) => l.xIn + (l.text.length * adv) / 2;
    expect(centre(contd)).toBeCloseTo(centre(real), 6);
    // Longer text, so a shared centre means a different left edge — the proof
    // it is really being centred rather than coincidentally aligned.
    expect(contd.xIn).toBeLessThan(real.xIn);
  });
});

describe("comments are print-invisible in full (docs/app/writing/comments.md#COMM-D4)", () => {
  /** An action whose only content is a note — a standalone `[[ ]]` line. */
  const commentOnly = (text: string): BlockNode => ({
    type: "action",
    content: [{ type: "note", content: [{ type: "text", text }] }],
  });

  it("a standalone comment contributes no block at all", () => {
    const withOut = doc(b("action", "Before."), b("action", "After."));
    const withIn = doc(b("action", "Before."), commentOnly("Robin: flat?"), b("action", "After."));
    const a = paginateDoc(withOut, DG);
    const c = paginateDoc(withIn, DG);
    expect(c.pages.length).toBe(a.pages.length);
    expect(c.pages[0].lines.map((l) => l.text)).toEqual(a.pages[0].lines.map((l) => l.text));
    expect(c.pages[0].lines.map((l) => l.row)).toEqual(a.pages[0].lines.map((l) => l.row));
  });

  it("an inline note contributes no width but keeps its line", () => {
    const d = doc({
      type: "action",
      content: [
        { type: "text", text: "She waits " },
        { type: "note", content: [{ type: "text", text: "beat" }] },
        { type: "text", text: "then speaks." },
      ],
    });
    const { pages } = paginateDoc(d, DG);
    expect(pages[0].lines.map((l) => l.text).join("\n")).toContain("She waits then speaks.");
  });

  it("a genuinely empty action still holds its line (the caret's row)", () => {
    const empty = doc(b("action", "Before."), b("action"), b("action", "After."));
    const flat = doc(b("action", "Before."), b("action", "After."));
    const e = paginateDoc(empty, DG);
    const f = paginateDoc(flat, DG);
    expect(e.pages[0].lines.length).toBeGreaterThan(f.pages[0].lines.length);
  });
});
