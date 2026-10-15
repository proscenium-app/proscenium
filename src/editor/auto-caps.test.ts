// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Auto-caps on a bare editor state: the schema and the plugin, no DOM. A script
 * is read the way the app reads it (`parse`, then the bridge), a letter is
 * typed, and the page is saved the way the app saves it (the bridge, then
 * `serialize`).
 *
 * The plugin reads the whole document on every change, so what it does to a
 * line nobody touched is the thing to pin
 * (docs/app/writing/editor-ux.md#EDIT-176).
 */
import { describe, expect, it } from "bun:test";
import { getSchema } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { autoCapsPlugin } from "./auto-caps";
import { fromEditorDoc, toEditorDoc } from "./bridge";
import { playExtensions } from "./schema";
import { parse, serialize, type Doc } from "../fountain";

const schema = getSchema(playExtensions);

/** A page with auto-caps on it. */
const onPage = (doc: Doc): EditorState =>
  EditorState.create({ doc: schema.nodeFromJSON(doc), plugins: [autoCapsPlugin()] });

/** The page a script opens as. */
const open = (script: string): EditorState => onPage(toEditorDoc(parse(script).doc));

/** Type `text` at `pos`, and take whatever auto-caps adds to the keystroke. */
const type = (state: EditorState, text: string, pos: number): EditorState =>
  state.applyTransaction(state.tr.insertText(text, pos)).state;

/** Where block `i`'s text begins. */
function startOf(state: EditorState, i: number): number {
  let pos = 1;
  for (let k = 0; k < i; k++) pos += state.doc.child(k).nodeSize;
  return pos;
}

const endOf = (state: EditorState, i: number): number =>
  startOf(state, i) + state.doc.child(i).content.size;

/** The first block that is `kind`. */
function indexOf(state: EditorState, kind: string): number {
  for (let i = 0; i < state.doc.childCount; i++) {
    if (state.doc.child(i).type.name === kind) return i;
  }
  throw new Error(`no ${kind} on the page`);
}

const save = (state: EditorState): string =>
  serialize({ frontMatter: {}, doc: fromEditorDoc(state.doc.toJSON() as Doc) });

/** Every cue on the page, whole: its attributes, its words and its comments. */
const cues = (state: EditorState): unknown[] =>
  (state.doc.toJSON() as Doc).content.filter((block) => block.type === "character");

const forced = (state: EditorState): boolean[] =>
  (cues(state) as { attrs: { forced: unknown } }[]).map((cue) => cue.attrs.forced === true);

describe("a cue read from a script keeps its case (docs/app/writing/editor-ux.md#EDIT-176)", () => {
  // Each script as the app writes it, with a stage direction `A room.` to type
  // in. `which` says which of its cues is the one in mixed case.
  const scripts: Record<string, [script: string, which?: number]> = {
    "alone on its line": ["@McTeague\nAye.\n\nA room.\n"],
    "all in lower case": ["@mcteague\nAye.\n\nA room.\n"],
    "with an extension": ["@McTeague (V.O.)\nAye.\n\nA room.\n"],
    "with an extension in lower case": ["@McTeague (on the radio)\nAye.\n\nA room.\n"],
    // No `@` in the file: the name is in capitals, and the bracket is the
    // cue's too once it is on the page.
    "in capitals, with an extension in lower case": ["HANS (on the radio)\nTwo.\n\nA room.\n"],
    "with a comment": ["@McTeague[[Robin: who is this?]]\nAye.\n\nA room.\n"],
    "with a comment about its name": [
      "@[[{]]McTeague[[}]][[Robin: who is this?]]\nAye.\n\nA room.\n",
    ],
    "with a comment about part of its name": [
      "@Mc[[{]]Teague[[}]][[Robin: one word?]]\nAye.\n\nA room.\n",
    ],
    "with a comment and an extension": [
      "@McTeague[[Robin: who is this?]] (V.O.)\nAye.\n\nA room.\n",
    ],
    "with a comment after its extension": [
      "@McTeague (V.O.)[[Robin: who is this?]]\nAye.\n\nA room.\n",
    ],
    "as the right-hand cue of a pair": ["MARA\nOne.\n\n@McTeague ^\nAye.\n\nA room.\n", 1],
    "as the right-hand cue, with an extension": [
      "MARA\nOne.\n\n@McTeague (O.S.) ^\nAye.\n\nA room.\n",
      1,
    ],
    "as the left-hand cue of a pair": ["@McTeague\nAye.\n\nMARA ^\nOne.\n\nA room.\n"],
    "over a bracketed line": ["@McTeague\n(low)\nAye.\n\nA room.\n"],
    "over a song": ["@McTeague\n~Row, row.\n\nA room.\n"],
    "with no speech under it": ["@McTeague\n  \n\nA room.\n"],
    "with no speech, an extension and a comment": [
      "@McTeague[[Robin: who is this?]] (V.O.)\n  \n\nA room.\n",
    ],
    "with no speech, as the right-hand cue": ["MARA\nOne.\n\n@McTeague ^\n  \n\nA room.\n", 1],
    "with no speech, as the last line of the script": ["A room.\n\n@McTeague\n  \n"],
  };

  for (const [name, [script, which = 0]] of Object.entries(scripts)) {
    it(`${name}: through a keystroke elsewhere, and the next save`, () => {
      // The script is one the app writes, so a save that changed a cue shows.
      expect(serialize(parse(script))).toBe(script);

      const opened = open(script);
      expect(forced(opened)[which]).toBe(true);

      const room = indexOf(opened, "action");
      const typed = type(opened, "x", endOf(opened, room));
      expect(cues(typed)).toEqual(cues(opened));
      expect(save(typed)).toBe(script.replace("A room.", "A room.x"));

      // And once more from the script just saved: the page it opens as is the
      // page it was saved from.
      expect(open(save(typed)).doc.toJSON()).toEqual(typed.doc.toJSON());
    });
  }

  it("through a keystroke above it, and one in its own speech", () => {
    const opened = open("A room.\n\n@McTeague (V.O.)\nAye.\n");
    const above = type(opened, "The ", startOf(opened, 0));
    const speech = type(above, " Aye.", endOf(above, 2));
    expect(cues(speech)).toEqual(cues(opened));
    expect(save(speech)).toBe("The A room.\n\n@McTeague (V.O.)\nAye. Aye.\n");
  });

  it("through typing in the cue itself, which is kept as typed", () => {
    const opened = open("@McTeague\nAye.\n");
    const typed = type(opened, " (on the stair)", endOf(opened, 0));
    expect(typed.doc.child(0).textContent).toBe("McTeague (on the stair)");
    expect(save(typed)).toBe("@McTeague (on the stair)\nAye.\n");
  });

  it("whatever alphabet its lower case is in", () => {
    // What auto-caps would change is what the bridge keeps: the two ask the
    // same question of a letter, and a name outside A to Z shows it if one of
    // them stops.
    for (const name of ["Анна", "Élodie", "Zoë", "STRAßE", "O'Brien"]) {
      const script = serialize({
        frontMatter: {},
        doc: {
          type: "doc",
          content: [
            { type: "character", content: [{ type: "text", text: name }] },
            { type: "dialogue", content: [{ type: "text", text: "Hello." }] },
            { type: "action", content: [{ type: "text", text: "A room." }] },
          ],
        },
      });
      const opened = open(script);
      expect(opened.doc.child(0).textContent).toBe(name);
      const typed = type(opened, "x", endOf(opened, 2));
      expect(typed.doc.child(0).textContent).toBe(name);
      expect(save(typed)).toBe(script.replace("A room.", "A room.x"));
    }
  });

  it("when no parser read it: the bridge asks the letters, not the `@`", () => {
    // A model made by hand, as a change on the board makes one. There was
    // never an `@` to read, and the bridge is the door it comes in through.
    const built: Doc = {
      type: "doc",
      content: [
        { type: "character", content: [{ type: "text", text: "Ivo" }] },
        { type: "dialogue", content: [{ type: "text", text: "Aye." }] },
      ],
    };
    const opened = onPage(toEditorDoc(built));
    const typed = type(opened, "x", endOf(opened, 1));
    expect(typed.doc.child(0).textContent).toBe("Ivo");
    expect(save(typed)).toBe("@Ivo\nAye.x\n");
  });
});

describe("a cue is still upper-cased as it is typed", () => {
  const text = (t: string) => ({ type: "text" as const, text: t });

  it("a new cue typed in lower case, with no `@`", () => {
    let state = onPage({
      type: "doc",
      content: [{ type: "action", content: [text("A room.")] }, { type: "character" }],
    });
    for (const letter of "mara (v.o.)") state = type(state, letter, endOf(state, 1));
    expect(state.doc.child(1).textContent).toBe("MARA (V.O.)");
    expect(forced(state)).toEqual([false]);
    expect(save(state)).toBe("A room.\n\nMARA (V.O.)\n  \n");
  });

  it("a line set to Character", () => {
    const state = onPage({ type: "doc", content: [{ type: "action", content: [text("Ivo")] }] });
    const set = state.applyTransaction(state.tr.setNodeMarkup(0, schema.nodes.character)).state;
    expect(set.doc.child(0).textContent).toBe("IVO");
  });

  it("a cue in capitals read from a script, and typed in", () => {
    for (const script of [
      "MARA\nHello.\n",
      "MARA (V.O.)\nHello.\n",
      "MARA\nOne.\n\nJONAH ^\nTwo.\n",
    ]) {
      const opened = open(script);
      expect(forced(opened).some(Boolean)).toBe(false);
      const typed = type(opened, "x", startOf(opened, 0));
      expect(typed.doc.child(0).textContent.startsWith("XMARA")).toBe(true);
    }
  });

  it("a cue in capitals with a comment in lower case: the comment is not its name", () => {
    const script = "@MARA[[Robin: who is this?]]\nHello.\n";
    const opened = open(script);
    expect(forced(opened)).toEqual([false]);
    const typed = type(opened, "x", startOf(opened, 0) + 4);
    expect(save(typed)).toBe("@MARAX[[Robin: who is this?]]\nHello.\n");
  });

  it("a cue the writer forced this session keeps what is typed, in capitals or not", () => {
    // What typing `@` leaves: an empty cue that is `forced` (input-rules.ts).
    let state = onPage({
      type: "doc",
      content: [{ type: "character", attrs: { forced: true } }],
    });
    for (const letter of "NASA") state = type(state, letter, endOf(state, 0));
    // The script goes out and comes back onto the page, as it does when a
    // scene is moved on the board: the cue is the writer's still.
    const back = onPage(toEditorDoc(fromEditorDoc(state.doc.toJSON() as Doc)));
    expect(forced(back)).toEqual([true]);
    const typed = type(back, "'s man", endOf(back, 0));
    expect(typed.doc.child(0).textContent).toBe("NASA's man");
  });
});

describe("what auto-caps leaves alone and what it does not", () => {
  it("leaves a comment on a heading as written", () => {
    const opened = open("# ACT ONE[[Robin: too soon?]]\n\nA room.\n");
    const typed = type(opened, "x", endOf(opened, 1));
    expect(save(typed)).toBe("# ACT ONE[[Robin: too soon?]]\n\nA room.x\n");
  });

  it("upper-cases a heading and a transition as they are typed", () => {
    for (const kind of ["act", "scene", "transition"]) {
      let state = onPage({ type: "doc", content: [{ type: kind as "act" }] });
      for (const letter of "the end") state = type(state, letter, endOf(state, 0));
      expect(state.doc.child(0).textContent).toBe("THE END");
    }
  });

  /**
   * `ß` is one letter and `SS` is two (docs/app/writing/editor-ux.md#EDIT-178).
   * The first heading grew by one, and the second was then replaced one place
   * off: across its own end, so it came out a stage direction reading
   * `DIE STRASSE WIEDERr`.
   */
  it("keeps its place past a letter that upper-cases to two", () => {
    const opened = open("# Die Straße\n\n## Die Straße wieder\n\n> Zur Straße.\n\nA room.\n");
    const typed = type(opened, "x", endOf(opened, 3));
    expect((typed.doc.toJSON() as Doc).content.map((block) => block.type)).toEqual([
      "act",
      "scene",
      "transition",
      "action",
    ]);
    expect(save(typed)).toBe(
      "# DIE STRASSE\n\n## DIE STRASSE WIEDER\n\n> ZUR STRASSE.\n\nA room.x\n",
    );
  });

  it("and past two of them on one line, either side of a comment", () => {
    const text = (t: string) => ({ type: "text" as const, text: t });
    const state = onPage({
      type: "doc",
      content: [
        {
          type: "character",
          content: [
            text("straße"),
            { type: "note", content: [text("Robin: groß oder klein?")] },
            text(" (auf der straße)"),
          ],
        },
        { type: "dialogue", content: [text("Ja.")] },
      ],
    });
    const typed = type(state, "x", endOf(state, 1));
    expect((typed.doc.toJSON() as Doc).content[0].content).toEqual([
      text("STRASSE"),
      { type: "note", content: [text("Robin: groß oder klein?")] },
      text(" (AUF DER STRASSE)"),
    ]);
  });
});
