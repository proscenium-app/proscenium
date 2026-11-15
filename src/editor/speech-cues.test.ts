// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Every line of speech on the page has a cue over it
 * (docs/app/writing/editor-ux.md#EDIT-193). Each gesture runs on a bare editor
 * state with the plugin, and the page it leaves is saved and read back the way
 * the app does it: what the page shows is what the next reopen shows.
 */
import { describe, expect, it } from "bun:test";
import { getSchema } from "@tiptap/core";
import {
  deleteSelection,
  joinBackward,
  joinForward,
  selectNodeBackward,
  selectNodeForward,
} from "@tiptap/pm/commands";
import { type Command, EditorState, TextSelection } from "@tiptap/pm/state";
import { fromEditorDoc, toEditorDoc } from "./bridge";
import { playExtensions } from "./schema";
import { cueStop, cuelessRuns, speechCuesPlugin } from "./speech-cues";
import { parse, serialize, type Doc } from "../fountain";

const schema = getSchema(playExtensions);

type Block = [type: string, text?: string];

function page(...blocks: Block[]): EditorState {
  const doc = {
    type: "doc",
    content: blocks.map(([type, text]) => ({
      type,
      content: text ? [{ type: "text", text }] : [],
    })),
  };
  return EditorState.create({ doc: schema.nodeFromJSON(doc), plugins: [speechCuesPlugin()] });
}

const startOf = (state: EditorState, i: number): number => {
  let pos = 0;
  for (let k = 0; k < i; k++) pos += state.doc.child(k).nodeSize;
  return pos;
};

/** Block `i` set to another element, the way the element bar does it. */
const setTo = (state: EditorState, i: number, type: string): EditorState =>
  state.applyTransaction(state.tr.setNodeMarkup(startOf(state, i), schema.nodes[type])).state;

/** Enter at the end of block `i`: a new empty block of `type` under it. */
const enterAfter = (state: EditorState, i: number, type: string): EditorState => {
  const end = startOf(state, i) + 1 + state.doc.child(i).content.size;
  return state.applyTransaction(state.tr.split(end, 1, [{ type: schema.nodes[type] }])).state;
};

/** Backspace at the start of block `i`: joined into the block above. */
const joinUp = (state: EditorState, i: number): EditorState =>
  state.applyTransaction(state.tr.join(startOf(state, i))).state;

const blocks = (state: EditorState): Block[] =>
  (state.doc.toJSON() as Doc).content.map((b) => [
    b.type,
    (b.content ?? []).map((n) => ("text" in n ? n.text : "")).join(""),
  ]);

const reopened = (state: EditorState): Block[] => {
  const script = serialize({ frontMatter: {}, doc: fromEditorDoc(state.doc.toJSON() as Doc) });
  const again = schema.nodeFromJSON(toEditorDoc(parse(script).doc));
  return blocks(EditorState.create({ doc: again }));
};

/**
 * The elements in order, two lines of speech or of brackets in a row as one:
 * the script holds them as one block's lines, and that is how they come back.
 */
const shape = (all: Block[]): string[] =>
  all
    .map(([type]) => type)
    .filter(
      (type, i, types) =>
        !(type === types[i - 1] && (type === "dialogue" || type === "parenthetical")),
    );

/** The page is what its next reopen will be. */
function expectKept(state: EditorState): void {
  expect(cuelessRuns(state.doc)).toEqual([]);
  expect(shape(reopened(state))).toEqual(shape(blocks(state)));
}

describe("a line of speech always has a cue over it", () => {
  it("names the speaker again over speech that follows a direction", () => {
    let state = page(
      ["character", "CHARLIE"],
      ["dialogue", "Well."],
      ["action", "His hands twitch."],
      ["action", "There they go again."],
    );
    state = setTo(state, 3, "dialogue");
    expect(blocks(state)).toEqual([
      ["character", "CHARLIE"],
      ["dialogue", "Well."],
      ["action", "His hands twitch."],
      ["character", "CHARLIE"],
      ["dialogue", "There they go again."],
    ]);
    expectKept(state);
  });

  it("names the speaker when a direction is opened inside a speech", () => {
    let state = page(["character", "MARA"], ["dialogue", "One."], ["dialogue", "Two."]);
    state = enterAfter(state, 1, "action");
    expect(blocks(state).map(([t]) => t)).toEqual([
      "character",
      "dialogue",
      "action",
      "character",
      "dialogue",
    ]);
    expect(blocks(state)[3]).toEqual(["character", "MARA"]);
    state = state.applyTransaction(state.tr.insertText("She sits.", startOf(state, 2) + 1)).state;
    expect(blocks(state)[2]).toEqual(["action", "She sits."]);
    expectKept(state);
  });

  it("names the speaker when a paragraph of a speech becomes a direction", () => {
    let state = page(
      ["character", "MARA"],
      ["dialogue", "One."],
      ["dialogue", "She sits."],
      ["parenthetical", "quietly"],
      ["dialogue", "Three."],
    );
    state = setTo(state, 2, "action");
    expect(blocks(state)).toEqual([
      ["character", "MARA"],
      ["dialogue", "One."],
      ["action", "She sits."],
      ["character", "MARA"],
      ["parenthetical", "quietly"],
      ["dialogue", "Three."],
    ]);
    expectKept(state);
  });

  it("takes the cue the speech had, not the last one above it", () => {
    let state = page(
      ["character", "EVA"],
      ["dialogue", "Hello."],
      ["character", "MARA"],
      ["dialogue", "One."],
      ["dialogue", "A pause."],
      ["dialogue", "Two."],
    );
    state = setTo(state, 4, "action");
    expect(blocks(state)[5]).toEqual(["character", "MARA"]);
    expectKept(state);
  });

  it("keeps a speaker's own case", () => {
    const state0 = EditorState.create({
      doc: schema.nodeFromJSON({
        type: "doc",
        content: [
          {
            type: "character",
            attrs: { forced: true },
            content: [{ type: "text", text: "McTeague" }],
          },
          { type: "dialogue", content: [{ type: "text", text: "Aye." }] },
          { type: "action", content: [{ type: "text", text: "A pause." }] },
          { type: "action", content: [{ type: "text", text: "Aye again." }] },
        ],
      }),
      plugins: [speechCuesPlugin()],
    });
    const state = setTo(state0, 3, "dialogue");
    expect(blocks(state)[3]).toEqual(["character", "McTeague"]);
    expect(state.doc.child(3).attrs.forced).toBe(true);
    expectKept(state);
  });

  it("leaves the extension off the repeated name", () => {
    let state = page(
      ["character", "MARA (O.S.)"],
      ["dialogue", "One."],
      ["action", "A door."],
      ["action", "Two."],
    );
    state = setTo(state, 3, "dialogue");
    expect(blocks(state)[3]).toEqual(["character", "MARA"]);
    expectKept(state);
  });

  it("makes a speech a direction when its cue becomes one", () => {
    let state = page(
      ["action", "A room."],
      ["character", "MARA"],
      ["parenthetical", "softly"],
      ["dialogue", "Hello."],
    );
    state = setTo(state, 1, "action");
    expect(blocks(state)).toEqual([
      ["action", "A room."],
      ["action", "MARA"],
      ["action", "(softly)"],
      ["action", "Hello."],
    ]);
    expectKept(state);
  });

  it("makes a speech a direction when its cue is joined into the line above", () => {
    let state = page(["action", "A room."], ["character", "MARA"], ["dialogue", "Hello."]);
    state = joinUp(state, 1);
    expect(blocks(state)).toEqual([
      ["action", "A room.MARA"],
      ["action", "Hello."],
    ]);
    expectKept(state);
  });

  it("finds no speaker across a scene heading", () => {
    let state = page(
      ["character", "MARA"],
      ["dialogue", "Hello."],
      ["sceneHeading", "INT. HALL - NIGHT"],
      ["action", "Someone speaks."],
    );
    state = setTo(state, 3, "dialogue");
    expect(blocks(state)[3]).toEqual(["action", "Someone speaks."]);
    expectKept(state);
  });

  it("leaves a cue with no name yet alone, and the speech under it", () => {
    let state = page(["character", "MARA"], ["dialogue", "Hello."]);
    state = state.applyTransaction(state.tr.delete(1, 5)).state;
    expect(blocks(state)).toEqual([
      ["character", ""],
      ["dialogue", "Hello."],
    ]);
  });

  it("lets a lyric stand with no cue", () => {
    let state = page(["action", "A room."], ["lyric", "La la."]);
    state = state.applyTransaction(state.tr.insertText("!", 2)).state;
    expect(blocks(state).map(([t]) => t)).toEqual(["action", "lyric"]);
  });

  it("changes nothing on a page where every speech has its cue", () => {
    const script = "INT. ROOM\n\nA lamp.\n\nMARA\n(softly)\nHello.\n\nEVA\nHi.\n\n~La la\n";
    const doc = schema.nodeFromJSON(toEditorDoc(parse(script).doc));
    let state = EditorState.create({ doc, plugins: [speechCuesPlugin()] });
    const before = blocks(state);
    state = state.applyTransaction(state.tr.insertText("x", startOf(state, 1) + 1)).state;
    expect(blocks(state).length).toBe(before.length);
    expect(blocks(state).map(([t]) => t)).toEqual(before.map(([t]) => t));
  });
});

describe("no gesture leaves speech with no cue", () => {
  const TYPES = ["character", "dialogue", "parenthetical", "action", "lyric"];
  const TEXT: Record<string, string> = {
    character: "MARA",
    dialogue: "Words.",
    parenthetical: "beat",
    action: "A door.",
    lyric: "La.",
  };

  /** Every page of one to three blocks that holds no cueless speech to begin with. */
  function* pages(): Generator<Block[]> {
    for (let n = 1; n <= 3; n++) {
      const total = TYPES.length ** n;
      for (let code = 0; code < total; code++) {
        const types: string[] = [];
        let rest = code;
        for (let k = 0; k < n; k++) {
          types.push(TYPES[rest % TYPES.length]);
          rest = Math.floor(rest / TYPES.length);
        }
        const blocks = types.map((t): Block => [t, TEXT[t]]);
        if (cuelessRuns(page(...blocks).doc).length === 0) yield blocks;
      }
    }
  }

  const hasLoneCue = (state: EditorState): boolean =>
    blocks(state).some(
      ([type], i, all) =>
        type === "character" &&
        !["dialogue", "parenthetical", "lyric"].includes(all[i + 1]?.[0] ?? ""),
    );

  it("setting any block to any element, or joining it up, keeps every speech under a cue", () => {
    let tried = 0;
    for (const start of pages()) {
      for (let i = 0; i < start.length; i++) {
        for (const type of TYPES) {
          const state = setTo(page(...start), i, type);
          expect(cuelessRuns(state.doc)).toEqual([]);
          // A cue with nothing under it comes back with an empty speech
          // (docs/engineering/fountain-model.md#EDIT-175).
          if (!hasLoneCue(state)) expectKept(state);
          tried++;
        }
        if (i > 0) {
          const state = joinUp(page(...start), i);
          expect(cuelessRuns(state.doc)).toEqual([]);
          tried++;
        }
      }
    }
    expect(tried).toBeGreaterThan(500);
  });
});

/** The caret at the start or the end of block `i`. */
function caret(state: EditorState, i: number, where: "start" | "end"): EditorState {
  const at = startOf(state, i) + 1 + (where === "end" ? state.doc.child(i).content.size : 0);
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)));
}

/** The empty block the caret is in, taken away (the editor's Delete in an empty line). */
const deleteCurrentNode: Command = (state, dispatch) => {
  const { $cursor } = state.selection as TextSelection;
  if ($cursor?.depth !== 1 || $cursor.parent.content.size > 0) return false;
  if (dispatch) dispatch(state.tr.delete($cursor.before(), $cursor.after()));
  return true;
};

/** The editor's own Backspace and Delete, each command in the order the editor tries them. */
const KEYS: Record<"Backspace" | "Delete", Command[]> = {
  Backspace: [cueStop(-1), deleteSelection, joinBackward, selectNodeBackward],
  Delete: [cueStop(1), deleteSelection, deleteCurrentNode, joinForward, selectNodeForward],
};

function press(state: EditorState, key: "Backspace" | "Delete"): EditorState {
  let next = state;
  for (const command of KEYS[key]) {
    if (command(state, (tr) => (next = state.applyTransaction(tr).state))) return next;
  }
  // No command took the key: the browser has it, and deletes a letter.
  const { $cursor } = state.selection as TextSelection;
  if (!$cursor) return state;
  const at = $cursor.pos;
  if (key === "Backspace" && $cursor.parentOffset > 0) {
    return state.applyTransaction(state.tr.delete(at - 1, at)).state;
  }
  if (key === "Delete" && $cursor.parentOffset < $cursor.parent.content.size) {
    return state.applyTransaction(state.tr.delete(at, at + 1)).state;
  }
  return state;
}

/** Where the caret stands: the block and the offset in it. */
const caretAt = (state: EditorState): [number, number] => {
  const { $head } = state.selection;
  return [$head.index(0), $head.parentOffset];
};

// docs/app/writing/editor-ux.md#EDIT-210
describe("Backspace and Delete stop at a cue", () => {
  const speech: Block[] = [
    ["action", "Pause."],
    ["character", "CHARLIE"],
    ["dialogue", "You're not going to say anything."],
    ["parenthetical", "beat"],
    ["dialogue", "No, I know."],
  ];

  it("Backspace at the start of a name leaves the name and its speech as they were", () => {
    const state = press(caret(page(...speech), 1, "start"), "Backspace");
    expect(blocks(state)).toEqual(speech);
    expect(caretAt(state)).toEqual([1, 0]);
  });

  it("Delete at the end of the line above a name leaves them as they were", () => {
    const state = press(caret(page(...speech), 0, "end"), "Delete");
    expect(blocks(state)).toEqual(speech);
  });

  it("a name taken back letter by letter, and one Backspace more, leaves an empty cue over its speech", () => {
    let state = caret(page(...speech), 1, "end");
    for (let k = 0; k < "CHARLIE".length + 3; k++) state = press(state, "Backspace");
    expect(blocks(state)).toEqual([speech[0], ["character", ""], ...speech.slice(2)]);
    expect(caretAt(state)).toEqual([1, 0]);
    state = state.applyTransaction(state.tr.insertText("MAX")).state;
    expect(blocks(state)).toEqual([speech[0], ["character", "MAX"], ...speech.slice(2)]);
    expectKept(state);
  });

  it("leaves a cue with no name yet at the top of the script over its speech", () => {
    const start = page(["character", ""], ["dialogue", "Hello."]);
    expect(cueStop(-1)(caret(start, 0, "start"))).toBe(true);
    expect(cueStop(-1)(caret(page(["character", ""]), 0, "start"))).toBe(false);
    expect(cueStop(-1)(caret(page(["action", ""], ["action", "Hi."]), 0, "start"))).toBe(false);
  });

  it("Delete in a cue with no name yet leaves it over its speech", () => {
    const start = page(["action", "Pause."], ["character", ""], ["dialogue", "Hello."]);
    expect(blocks(press(caret(start, 1, "start"), "Delete"))).toEqual(blocks(start));
    expect(blocks(press(caret(start, 2, "start"), "Backspace"))).toEqual(blocks(start));
  });

  it("never runs the first line of a speech into its name", () => {
    expect(blocks(press(caret(page(...speech), 2, "start"), "Backspace"))).toEqual(speech);
    expect(blocks(press(caret(page(...speech), 1, "end"), "Delete"))).toEqual(speech);
  });

  it("never gives a speech to the speaker above it", () => {
    const start: Block[] = [
      ["character", "ANDREW"],
      ["dialogue", "Unless."],
      ["character", "CHARLIE"],
      ["dialogue", "You're not going to say anything."],
    ];
    expect(blocks(press(caret(page(...start), 2, "start"), "Backspace"))).toEqual(start);
    expect(blocks(press(caret(page(...start), 1, "end"), "Delete"))).toEqual(start);
  });

  it("takes an empty line next to a cue away, as it takes any empty line", () => {
    const start = page(["action", "Pause."], ["action", ""], ...speech.slice(1));
    expect(blocks(press(caret(start, 2, "start"), "Backspace"))).toEqual(speech);
    expect(blocks(press(caret(start, 1, "start"), "Delete"))).toEqual(speech);
    expect(blocks(press(caret(start, 0, "end"), "Delete"))).toEqual(speech);
  });

  it("takes back the empty line Enter opened under a name, then the name, then the cue", () => {
    let state = caret(
      page(["action", "Pause."], ["character", "MARA"], ["dialogue", ""]),
      2,
      "start",
    );
    state = press(state, "Backspace");
    expect(blocks(state)).toEqual([
      ["action", "Pause."],
      ["character", "MARA"],
    ]);
    expect(caretAt(state)).toEqual([1, 4]);
    for (let k = 0; k < 5; k++) state = press(state, "Backspace");
    expect(blocks(state)).toEqual([["action", "Pause."]]);
    expect(caretAt(state)).toEqual([0, 6]);
  });

  it("takes an empty line under a cue with no name yet, and keeps the cue over the rest", () => {
    const start = page(["character", ""], ["dialogue", ""], ["dialogue", "Two."]);
    for (const state of [
      press(caret(start, 1, "start"), "Backspace"),
      press(caret(start, 0, "start"), "Delete"),
    ]) {
      expect(blocks(state)).toEqual([
        ["character", ""],
        ["dialogue", "Two."],
      ]);
      expect(caretAt(state)).toEqual([0, 0]);
    }
  });

  it("makes the same speaker twice in a row one speech", () => {
    const start = page(
      ["character", "CHARLIE"],
      ["dialogue", "One."],
      ["character", "CHARLIE"],
      ["dialogue", "Two."],
    );
    for (const state of [
      press(caret(start, 2, "start"), "Backspace"),
      press(caret(start, 1, "end"), "Delete"),
    ]) {
      expect(blocks(state)).toEqual([
        ["character", "CHARLIE"],
        ["dialogue", "One."],
        ["dialogue", "Two."],
      ]);
      expect(caretAt(state)).toEqual([1, 4]);
      expectKept(state);
    }
  });

  it("keeps a name a direction stands before, though the speaker is the same", () => {
    const start: Block[] = [
      ["character", "CHARLIE"],
      ["dialogue", "One."],
      ["action", "He sits."],
      ["character", "CHARLIE"],
      ["dialogue", "Two."],
    ];
    expect(blocks(press(caret(page(...start), 3, "start"), "Backspace"))).toEqual(start);
  });

  it("joins every other line as it always has", () => {
    const directions = page(["action", "A door."], ["action", "It opens."]);
    expect(blocks(press(caret(directions, 1, "start"), "Backspace"))).toEqual([
      ["action", "A door.It opens."],
    ]);
    const lines = page(["character", "MARA"], ["dialogue", "One."], ["dialogue", "Two."]);
    expect(blocks(press(caret(lines, 2, "start"), "Backspace"))).toEqual([
      ["character", "MARA"],
      ["dialogue", "One.Two."],
    ]);
    expect(blocks(press(caret(lines, 1, "end"), "Delete"))).toEqual([
      ["character", "MARA"],
      ["dialogue", "One.Two."],
    ]);
  });

  it("leaves the keys to the browser inside a line", () => {
    const inside = caret(page(...speech), 1, "end");
    expect(cueStop(-1)(inside)).toBe(false);
    expect(cueStop(1)(caret(page(...speech), 1, "start"))).toBe(false);
  });

  it("no Backspace or Delete at a line's edge leaves a speech without its cue", () => {
    const TYPES = ["character", "dialogue", "parenthetical", "action", "lyric"];
    const TEXT: Record<string, string> = {
      character: "MARA",
      dialogue: "Words.",
      parenthetical: "beat",
      action: "A door.",
      lyric: "La.",
    };
    const VARIANTS = TYPES.flatMap((type): Block[] => [
      [type, TEXT[type]],
      [type, ""],
    ]);
    // The keys alone, with no page put right after them: what they leave is
    // what the writer has.
    const bare = (all: Block[]): EditorState =>
      EditorState.create({
        doc: schema.nodeFromJSON({
          type: "doc",
          content: all.map(([type, text]) => ({
            type,
            content: text ? [{ type: "text", text }] : [],
          })),
        }),
      });
    const names = (state: EditorState): Set<string> =>
      new Set(
        blocks(state).flatMap(([type, text]) => (type === "character" && text ? [text] : [])),
      );
    let tried = 0;
    for (let n = 2; n <= 4; n++) {
      const total = VARIANTS.length ** n;
      for (let code = 0; code < total; code++) {
        const start: Block[] = [];
        let rest = code;
        for (let k = 0; k < n; k++) {
          start.push(VARIANTS[rest % VARIANTS.length]);
          rest = Math.floor(rest / VARIANTS.length);
        }
        const before = bare(start);
        if (cuelessRuns(before.doc).length > 0) continue;
        for (let i = 0; i < n - 1; i++) {
          for (const state of [
            press(caret(before, i + 1, "start"), "Backspace"),
            press(caret(before, i, "end"), "Delete"),
          ]) {
            expect(cuelessRuns(state.doc)).toEqual([]);
            // No name ran into another line, and no line into a name.
            expect(names(state)).toEqual(names(before));
            tried++;
          }
        }
      }
    }
    expect(tried).toBeGreaterThan(20000);
  });
});
