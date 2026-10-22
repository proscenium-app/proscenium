// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import type { JSONContent } from "@tiptap/core";
import { getSchema } from "@tiptap/core";
import { Redline, RedlineAdd, RedlineDel } from "./redline";
import { REDLINE_ADD, REDLINE_DEL, scriptRedline } from "./redline-doc";
import { playExtensions } from "./schema";

const SCRIPT = `Title: The Weight of Water

# ACT ONE

## SCENE 1

AT RISE: A kitchen, just before dawn.

MARA
The pipe's been crying all night.

She turns off the tap. It keeps dripping.

JONAH
(from the doorway, half asleep)
You and that pipe.

MARA
You weren't supposed to come.

## SCENE 2

Morning. Coffee between them, untouched.

MARA
It's quiet now.

JONAH
Is it.

MARA
I keep listening for it.

JONAH
Then stop.

MARA
I can't.
`;

/** A block as text: [-cut-] and {+added+} around its words, its kind and state in front. */
function shown(block: JSONContent): string {
  const text = (block.content ?? [])
    .map((node) => {
      const t =
        node.type === "text" ? (node.text ?? "") : node.type === "lineBreak" ? "\\n" : "‹note›";
      const marks = (node.marks ?? []).map((m) => m.type);
      if (marks.includes(REDLINE_DEL)) return `[-${t}-]`;
      if (marks.includes(REDLINE_ADD)) return `{+${t}+}`;
      return t;
    })
    .join("");
  const state = block.attrs?.redline ? `${block.attrs.redline} ` : "";
  return `${state}${block.type}: ${text}`;
}

function redline(before: string, after: string): string[] {
  return (scriptRedline(before, after).doc?.content ?? []).map(shown);
}

describe("scriptRedline", () => {
  test("a reworded speech stays one speech, under its cue", () => {
    const lines = redline(
      SCRIPT,
      SCRIPT.replace("The pipe's been crying all night.", "The pipe has been weeping all night."),
    );
    expect(lines).toContain("character: MARA");
    expect(lines).toContain(
      "mod dialogue: The [-pipe's-]{+pipe has+} been [-crying-]{+weeping+} all night.",
    );
  });

  test("a cut direction is put back where it stood, struck through", () => {
    const lines = redline(
      SCRIPT,
      SCRIPT.replace("She turns off the tap. It keeps dripping.\n\n", ""),
    );
    const at = lines.indexOf("del action: [-She turns off the tap. It keeps dripping.-]");
    expect(at).toBeGreaterThan(0);
    expect(lines[at - 1]).toBe("dialogue: The pipe's been crying all night.");
    expect(lines[at + 1]).toBe("character: JONAH");
  });

  test("an added exchange is added, cue and speech", () => {
    const lines = redline(SCRIPT, SCRIPT.replace("Is it.\n", "Is it.\n\nMARA\nDon't.\n"));
    expect(lines).toContain("add character: {+MARA+}");
    expect(lines).toContain("add dialogue: {+Don't.+}");
  });

  test("a cue that gains an extension is that cue, the extension added", () => {
    const lines = redline(SCRIPT, SCRIPT.replace("JONAH\n(from", "JONAH (O.S.)\n(from"));
    expect(lines).toContain("mod character: JONAH{+ (O.S.)+}");
  });

  test("a comment added to a line is one added thing", () => {
    const lines = redline(
      SCRIPT,
      SCRIPT.replace("supposed to come.", "supposed to come. [[tonight, or ever?]]"),
    );
    expect(lines).toContain("mod dialogue: You weren't supposed to come.{+ +}{+‹note›+}");
  });

  test("a speech is never shown without its cue, nor a cue without its speech", () => {
    // Three elements of context above the change end on Jonah's "Is it."; its cue comes with it.
    const { doc } = scriptRedline(SCRIPT, SCRIPT.replace("I can't.", "I can't, Jonah."));
    const blocks = doc?.content ?? [];
    blocks.forEach((block, i) => {
      if (block.type !== "dialogue") return;
      expect(["character", "parenthetical", "dialogue"]).toContain(blocks[i - 1]?.type ?? "");
    });
    expect(blocks.map(shown)).toContain("mod dialogue: I can't{+, Jonah+}.");
  });

  test("what is left out says how much, and where the next change is", () => {
    const { doc } = scriptRedline(SCRIPT, SCRIPT.replace("I can't.", "I can't, Jonah."));
    const first = doc?.content?.[0];
    expect(first?.attrs?.redlineSkipBefore).toEqual({
      count: expect.any(Number),
      label: "ACT ONE · SCENE 2",
    });
  });

  test("a heading on show is not said again above it", () => {
    const { doc } = scriptRedline(SCRIPT, SCRIPT.replace("Morning. Coffee", "Noon. Coffee"));
    const labels = (doc?.content ?? []).map((b) => b.attrs?.redlineSkipBefore?.label ?? null);
    expect(labels.filter(Boolean)).toEqual(["ACT ONE · SCENE 1"]);
  });

  test("the same script has no redline; a changed title page is said, not drawn", () => {
    expect(scriptRedline(SCRIPT, SCRIPT)).toEqual({ doc: null, changes: 0, openingPages: false });
    const retitled = scriptRedline(SCRIPT, SCRIPT.replace("The Weight of Water", "Salt"));
    expect(retitled.doc).toBeNull();
    expect(retitled.openingPages).toBe(true);
  });

  test("every redline loads into the schema the read-only editor draws it with", () => {
    const schema = getSchema([...playExtensions, RedlineAdd, RedlineDel, Redline]);
    const after = SCRIPT.replace("The pipe's been crying", "The pipe has been weeping")
      .replace("She turns off the tap. It keeps dripping.\n\n", "")
      .replace(
        "Is it.\n",
        "Is it. [[really?]]\n\n===\n\n/* cut for now */\n\nMARA\nGo home.\n\nJONAH ^\nMake me.\n",
      )
      .replace("JONAH\n(from", "JONAH (O.S.)\n(from");
    for (const [a, b] of [
      [SCRIPT, after],
      [after, SCRIPT],
    ]) {
      const { doc, changes } = scriptRedline(a, b);
      expect(changes).toBeGreaterThan(4);
      const node = schema.nodeFromJSON(doc);
      expect(() => node.check()).not.toThrow();
    }
  });
});
