// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { getSchema } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { confirmActionAs, enterDecision } from "./element-entry";
import { playExtensions } from "./schema";
import { serialize } from "../fountain";
import type { Doc } from "../fountain";
import { fromEditorDoc } from "./bridge";
import { LEADER_ELEMENTS } from "./leader-key";

// Headless: the confirm decision is a pure function of the block, so it needs
// the schema but no DOM.
const schema = getSchema(playExtensions);

/** An action block whose lines are separated by soft breaks (Shift+Enter). */
function action(...lines: string[]): PMNode {
  const content: unknown[] = [];
  lines.forEach((line, i) => {
    if (i > 0) content.push({ type: "lineBreak" });
    if (line) content.push({ type: "text", text: line });
  });
  return schema.nodeFromJSON({ type: "action", content });
}

describe("Enter-time confirmers on an action block", () => {
  it("promotes a single ALL-CAPS line to a character cue", () => {
    expect(confirmActionAs(action("MARA"))).toBe("character");
  });

  it("promotes a `… TO:` line to a transition", () => {
    expect(confirmActionAs(action("CUT TO:"))).toBe("transition");
    expect(confirmActionAs(action("FADE OUT."))).toBe("transition");
  });

  /**
   * The stage vocabulary, which docs/app/writing/editor-ux.md#EDIT-D100's element table names as the
   * Transition examples. Before this, "BLACKOUT." was ALL CAPS and matched
   * nothing, so Enter made a character called BLACKOUT.
   */
  it("promotes the stage transitions, not just the screen ones", () => {
    for (const line of [
      "BLACKOUT",
      "BLACKOUT.",
      "CURTAIN",
      "END OF ACT ONE",
      "END OF PLAY",
      "END OF SCENE 2",
    ]) {
      expect(confirmActionAs(action(line))).toBe("transition");
    }
  });

  it("still reads a plain ALL-CAPS name as a cue", () => {
    // The words above are specific lines, not a rule about caps.
    expect(confirmActionAs(action("BLACKOUT THE STAGE MANAGER"))).toBe("character");
    expect(confirmActionAs(action("CURTAINS"))).toBe("character");
  });

  it("leaves a slug line alone (the input rule owns scene headings)", () => {
    expect(confirmActionAs(action("INT. KITCHEN - NIGHT"))).toBeNull();
  });

  it("leaves ordinary prose alone", () => {
    expect(confirmActionAs(action("She crosses to the window."))).toBeNull();
  });

  it("leaves an empty block alone", () => {
    expect(confirmActionAs(action(""))).toBeNull();
  });

  /**
   * The regression. `textContent` concatenates across soft breaks, so a
   * multi-line ALL-CAPS stage direction looked like one caps line and Enter
   * turned the whole block into a cue.
   */
  it("does NOT promote a multi-line ALL-CAPS stage direction to a cue", () => {
    const twoLines = action("LIGHTS UP.", "A DOOR SLAMS OFFSTAGE.");
    // The trap: read as one string it is indistinguishable from a name.
    expect(twoLines.textContent).toBe("LIGHTS UP.A DOOR SLAMS OFFSTAGE.");
    expect(confirmActionAs(twoLines)).toBeNull();
  });

  it("does NOT promote a multi-line block whose last line ends TO:", () => {
    expect(confirmActionAs(action("SHE WAITS.", "CUT TO:"))).toBeNull();
  });

  /**
   * Why it mattered: a cue is a single Fountain line, so a multi-line character
   * block serializes as a cue followed by a second line — which re-parses as
   * that character's dialogue. The stage direction became a speech.
   */
  it("shows what a multi-line cue would have serialized to", () => {
    const asCue: Doc = {
      type: "doc",
      content: [
        {
          type: "character",
          content: [
            { type: "text", text: "LIGHTS UP." },
            { type: "lineBreak" },
            { type: "text", text: "A DOOR SLAMS OFFSTAGE." },
          ] as never,
        },
      ],
    };
    const text = serialize({ frontMatter: {}, doc: fromEditorDoc(asCue) });
    expect(text).toBe("LIGHTS UP.\nA DOOR SLAMS OFFSTAGE.\n");
    // …and Fountain reads that second line as dialogue under the cue.
  });
});

/** A block of any element, empty unless given words. */
function block(type: string, text = ""): PMNode {
  return schema.nodeFromJSON({ type, content: text ? [{ type: "text", text }] : [] });
}

describe("Enter (docs/app/writing/editor-ux.md#EDIT-29)", () => {
  /** A double Enter is where a writer reaches for the element picker. */
  it("opens the element menu on an empty line, the second Enter of a pair", () => {
    for (const type of [
      "action",
      "dialogue",
      "character",
      "parenthetical",
      "lyric",
      "sceneHeading",
      "transition",
      "act",
      "scene",
    ]) {
      expect(enterDecision(block(type)).kind).toBe("menu");
    }
  });

  it("opens it on the element Enter alone used to make, so a third Enter takes that", () => {
    expect(enterDecision(block("action"))).toEqual({ kind: "menu", suggested: "character" });
    expect(enterDecision(block("dialogue"))).toEqual({ kind: "menu", suggested: "action" });
    expect(enterDecision(block("character"))).toEqual({ kind: "menu", suggested: "action" });
    expect(enterDecision(block("parenthetical"))).toEqual({ kind: "menu", suggested: "dialogue" });
    expect(enterDecision(block("lyric"))).toEqual({ kind: "menu", suggested: "action" });
    expect(enterDecision(block("act"))).toEqual({ kind: "menu", suggested: "scene" });
  });

  it("only ever suggests an element the menu has a row for", () => {
    const rows = new Set(Object.values(LEADER_ELEMENTS));
    for (const type of [
      "action",
      "dialogue",
      "character",
      "parenthetical",
      "lyric",
      "sceneHeading",
      "transition",
      "act",
      "scene",
      "synopsis",
      "centered",
    ]) {
      const decision = enterDecision(block(type));
      if (decision.kind !== "menu") throw new Error(`${type}: ${decision.kind}`);
      expect(rows.has(decision.suggested)).toBe(true);
    }
  });

  it("still advances from a line with words in it", () => {
    expect(enterDecision(block("character", "MARA"))).toEqual({ kind: "advance", to: "dialogue" });
    expect(enterDecision(block("dialogue", "Stay."))).toEqual({ kind: "advance", to: "action" });
    expect(enterDecision(block("parenthetical", "beat"))).toEqual({
      kind: "advance",
      to: "dialogue",
    });
    expect(enterDecision(block("action", "She waits."))).toEqual({ kind: "advance", to: "action" });
  });

  it("confirms an ALL-CAPS action as a cue before anything else", () => {
    expect(enterDecision(action("MARA"))).toEqual({ kind: "confirm", as: "character" });
    expect(enterDecision(action("BLACKOUT."))).toEqual({ kind: "confirm", as: "transition" });
  });

  /** "I do not want to lose shift enter making line spaces, very important." */
  it("treats a line holding only a Shift+Enter break as written in, not empty", () => {
    expect(enterDecision(action("", ""))).toEqual({ kind: "advance", to: "action" });
  });
});
