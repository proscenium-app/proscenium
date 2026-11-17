// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Character names in the directions (docs/app/writing/editor-ux.md#EDIT-202
 * to docs/app/writing/editor-ux.md#EDIT-209), on a bare editor state: the schema, the history, auto-caps and
 * this plugin, no DOM. A script is read the way the app reads it (`parse`,
 * then the bridge), keys are typed one at a time the way the view hands them
 * over (`handleTextInput`, then the transaction that types them), and the page
 * is saved the way the app saves it. The dictionary is the app's own.
 */
import { describe, expect, it } from "bun:test";
import { getSchema } from "@tiptap/core";
import { splitBlock } from "@tiptap/pm/commands";
import { history, redo, undo } from "@tiptap/pm/history";
import { EditorState, TextSelection, type Plugin, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import nspell from "nspell";
import { readFileSync } from "node:fs";
import { autoCapsPlugin } from "./auto-caps";
import { fromEditorDoc, toEditorDoc } from "./bridge";
import { confirmActionAs } from "./element-entry";
import {
  CAST_CAPS,
  CAST_KEPT,
  capitalizeChosen,
  castNamesPlugin,
  nameEnding,
  indexNames,
  keptAfter,
  keptName,
  keptStill,
  lineKey,
  namesInDirectionsOn,
  noteEnter,
  noteTyped,
  ordinaryWords,
  scriptOccurrences,
  type CastNamesConfig,
} from "./names-in-directions";
import { playExtensions } from "./schema";
import { namesIn } from "../spell/dictionary-names";
import { STAGE_WORDS } from "../spell";
import { builtinFormats } from "../format";
import { parse, serialize, type Doc } from "../fountain";

const schema = getSchema(playExtensions);

const dic = readFileSync(new URL("../../dictionaries/en.dic", import.meta.url), "utf8");
const aff = readFileSync(new URL("../../dictionaries/en.aff", import.meta.url), "utf8");
const english = nspell(aff, dic);
const ordinary = ordinaryWords(
  { correct: (w) => english.correct(w), names: namesIn(dic) },
  STAGE_WORDS,
);

const CAST = ["CHARLIE", "JUNE", "THE HOST", "IT", "DO", "WILL", "MRS. BRISTOL", "GROß"];
const ON: CastNamesConfig = { on: true, names: CAST, ordinary };

/** A page with the history, auto-caps and the names rule on it. */
function open(script: string, config: CastNamesConfig = ON, plugins: Plugin[] = []): EditorState {
  const doc = schema.nodeFromJSON(toEditorDoc(parse(script).doc));
  const state = EditorState.create({
    doc,
    plugins: [...plugins, castNamesPlugin(config), autoCapsPlugin(), history()],
  });
  return at(state, endOf(state, 0));
}

const at = (state: EditorState, pos: number) =>
  state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));

function startOf(state: EditorState, i: number): number {
  let pos = 1;
  for (let k = 0; k < i; k++) pos += state.doc.child(k).nodeSize;
  return pos;
}
const endOf = (state: EditorState, i: number) =>
  startOf(state, i) + state.doc.child(i).content.size;

/** One key, typed as the view types it. */
function key(state: EditorState, ch: string): EditorState {
  const { from, to } = state.selection;
  if (ch === "\n") {
    noteEnter(state.doc, from);
    let next = state;
    splitBlock(state, (tr: Transaction) => {
      next = state.applyTransaction(tr).state;
    });
    return next;
  }
  noteTyped(state.doc, from, to, ch);
  return state.applyTransaction(state.tr.insertText(ch, from, to)).state;
}

/** Keys typed one at a time; "\n" is Enter. */
const type = (state: EditorState, text: string) => [...text].reduce(key, state);

const line = (state: EditorState, i = 0) => state.doc.child(i).textContent;

const run = (state: EditorState, command: typeof undo): EditorState => {
  let next = state;
  command(state, (tr: Transaction) => {
    next = state.applyTransaction(tr).state;
  });
  return next;
};

/** Backspace, as the view hands it to the plugin's keys first. */
function backspace(state: EditorState): EditorState {
  let next = state;
  const view = {
    state,
    composing: false,
    dispatch: (tr: Transaction) => {
      next = next.applyTransaction(tr).state;
    },
  } as unknown as EditorView;
  const plugin = state.plugins.find((p) => p.spec.props?.handleKeyDown && p.spec.key);
  const handled = plugin?.props.handleKeyDown?.call(plugin, view, {
    key: "Backspace",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
  } as KeyboardEvent);
  if (handled) return next;
  const { from } = state.selection;
  return state.applyTransaction(state.tr.delete(from - 1, from)).state;
}

/** Which of the line's letters carry `mark`, as a string of them. */
function marked(state: EditorState, mark: string, i = 0): string {
  let out = "";
  state.doc.child(i).forEach((node) => {
    if (node.isText && node.marks.some((m) => m.type.name === mark)) out += node.text;
  });
  return out;
}

const save = (state: EditorState) =>
  serialize({ frontMatter: {}, doc: fromEditorDoc(state.doc.toJSON() as Doc) });

describe("a name typed in a direction goes to capitals (docs/app/writing/editor-ux.md#EDIT-202)", () => {
  it("at a space, in a stage direction", () => {
    const page = type(open("A room.\n"), " Charlie enters.");
    expect(line(page)).toBe("A room. CHARLIE enters.");
  });

  it("in a parenthetical", () => {
    const page = open("MARA\n(looks)\nHi.\n");
    const typed = type(at(page, endOf(page, 1)), " at june.");
    expect(line(typed, 1)).toBe("looks at JUNE.");
  });

  for (const boundary of [" ", ",", ".", "!", "?", ";", ":", ")", "—", "\n"]) {
    it(`at ${JSON.stringify(boundary)}`, () => {
      const page = type(open("A room.\n"), ` Charlie${boundary}`);
      expect(line(page)).toBe(`A room. CHARLIE${boundary === "\n" ? "" : boundary}`);
    });
  }

  it("when a keyboard hands over the word and its space at once", () => {
    const page = open("A room.\n");
    const { from } = page.selection;
    noteTyped(page.doc, from, from, " Charlie ");
    const typed = page.applyTransaction(page.tr.insertText(" Charlie ", from)).state;
    expect(line(typed)).toBe("A room. CHARLIE ");
  });

  it("keeps the caret where the writer typed, past a letter that upper-cases to two", () => {
    const page = type(open("A room.\n"), " Groß waits");
    expect(line(page)).toBe("A room. GROSS waits");
    expect(page.selection.head).toBe(endOf(page, 0));
  });
});

describe("what a name is (docs/app/writing/editor-ux.md#EDIT-203)", () => {
  it("is a whole word, never part of one", () => {
    expect(line(type(open("A room.\n"), " Junebug sings."))).toBe("A room. Junebug sings.");
  });

  it("is matched without regard to case", () => {
    expect(line(type(open("A room.\n"), " jUNE sits."))).toBe("A room. JUNE sits.");
  });

  it("leaves a one-word name that is an ordinary word as typed: IT and DO", () => {
    const page = type(open("A room.\n"), " It rains. Do it now, it said.");
    expect(line(page)).toBe("A room. It rains. Do it now, it said.");
  });

  it("takes an ordinary word with a capital for a name when the dictionary knows it as one", () => {
    const page = type(open("A room.\n"), " Will says he will.");
    expect(line(page)).toBe("A room. WILL says he will.");
  });

  it("keeps a possessive in the writer's case", () => {
    expect(line(type(open("A room.\n"), " Charlie's hat."))).toBe("A room. CHARLIE's hat.");
  });

  it("takes a name of several words whole when it is typed whole", () => {
    expect(line(type(open("A room.\n"), " The Host bows."))).toBe("A room. THE HOST bows.");
    expect(line(type(open("A room.\n"), " the host bows."))).toBe("A room. THE HOST bows.");
    expect(line(type(open("A room.\n"), " Mrs. Bristol sits."))).toBe("A room. MRS. BRISTOL sits.");
  });

  it("takes only its last word when that is all that is the name", () => {
    expect(line(type(open("A room.\n"), " the Host bows."))).toBe("A room. the HOST bows.");
    expect(line(type(open("A room.\n"), " a host of lights."))).toBe("A room. a host of lights.");
  });

  it("reads the script's own cues as cast", () => {
    const page = open("ODILE\nHello.\n\nA room.\n", { ...ON, names: [] });
    const typed = type(at(page, endOf(page, 2)), " Odile waves.");
    expect(line(typed, 2)).toBe("A room. ODILE waves.");
  });

  it("finds the name the line ends with", () => {
    const index = indexNames(CAST);
    expect(nameEnding("and then the Host", index, ordinary)).toEqual({ start: 13, end: 17 });
    expect(nameEnding("and then The Host", index, ordinary)).toEqual({ start: 9, end: 17 });
    expect(nameEnding("Charlie's", index, ordinary)).toEqual({ start: 0, end: 7 });
    expect(nameEnding("'Charlie'", index, ordinary)).toEqual({ start: 1, end: 8 });
    expect(nameEnding("Charlie-like", index, ordinary)).toBeNull();
  });

  it("waits for the dictionary before a one-word name", () => {
    const loading = { ...ON, ordinary: null };
    expect(line(type(open("A room.\n", loading), " Charlie sits."))).toBe("A room. Charlie sits.");
    expect(line(type(open("A room.\n", loading), " the Host sits."))).toBe(
      "A room. the HOST sits.",
    );
  });
});

describe("when it fires, and when it never does (docs/app/writing/editor-ux.md#EDIT-204)", () => {
  it("never in a speech, a cue, a heading, a synopsis or a comment", () => {
    const script = "MARA\nCharlie\n\n## SCENE 1\n\n= Charlie\n\nA room [[Charlie]] here.\n";
    const page = open(script);
    for (let i = 0; i < page.doc.childCount; i++) {
      const block = page.doc.child(i);
      if (!block.isTextblock) continue;
      const typed = type(at(page, endOf(page, i)), " june ");
      const text = line(typed, i);
      if (block.type.name === "action") expect(text).toContain("JUNE");
      else expect(text.toUpperCase() === text || !text.includes("JUNE")).toBe(true);
      if (block.type.name === "dialogue" || block.type.name === "synopsis")
        expect(text).toContain("june");
    }
    // Inside the comment's own words.
    let note = -1;
    page.doc.descendants((node, pos) => {
      if (node.type.name === "note") note = pos + 1 + node.content.size;
    });
    const inNote = type(at(page, note), " june ");
    expect(inNote.doc.child(page.doc.childCount - 1).textContent).toContain("june");
  });

  it("never on a paste", () => {
    const page = open("A room.\n");
    const tr = page.tr.insertText(" Charlie ", page.selection.from).setMeta("uiEvent", "paste");
    expect(line(page.applyTransaction(tr).state)).toBe("A room. Charlie ");
  });

  it("never at a key typed after a word already in the script", () => {
    const page = open("Charlie enters.\n");
    // The caret put after the name read from the script, and a boundary typed.
    const typed = type(at(page, startOf(page, 0) + "Charlie".length), ",");
    expect(line(typed)).toBe("Charlie, enters.");
    // And a key typed anywhere else changes no word.
    expect(line(type(open("Charlie enters.\n"), " Then June."))).toBe("Charlie enters. Then JUNE.");
  });

  it("never at a key after a version is put back or a scene moved, whatever was typed before", () => {
    let page = type(open("A room.\n"), " Charli");
    // The page replaced as Versions and the board replace it, off the history.
    const restored = schema.nodeFromJSON(toEditorDoc(parse("A room. Charlie\n").doc));
    const tr = page.tr
      .replaceWith(0, page.doc.content.size, restored.content)
      .setMeta("addToHistory", false);
    page = page.applyTransaction(tr).state;
    page = type(at(page, endOf(page, 0)), " ");
    expect(line(page)).toBe("A room. Charlie ");
  });

  it("never on an undo or a redo", () => {
    let page = type(open("A room.\n"), " Charlie,");
    page = run(run(page, undo), undo); // the capitals, then the typing
    expect(line(page)).toBe("A room.");
    page = run(page, redo); // the typing back, with its comma after the name
    expect(line(page)).toBe("A room. Charlie,");
    page = run(page, redo); // the capitals: the writer asked for them back
    expect(line(page)).toBe("A room. CHARLIE,");
  });

  it("never during a composition", () => {
    const page = open("A room.\n");
    const plugin = page.plugins.find((p) => p.spec.props?.handleTextInput && p.spec.key);
    let state = page;
    for (const ch of " Charlie ") {
      const { from, to } = state.selection;
      const view = { state, composing: true } as unknown as EditorView;
      plugin!.props.handleTextInput!.call(plugin!, view, from, to, ch, () => state.tr);
      state = state.applyTransaction(state.tr.insertText(ch, from, to)).state;
    }
    expect(line(state)).toBe("A room. Charlie ");
  });

  it("is off when the format does not ask, or auto-caps is off", () => {
    const off = { ...ON, on: false };
    expect(line(type(open("A room.\n", off), " Charlie sits."))).toBe("A room. Charlie sits.");
    const formats = Object.fromEntries(builtinFormats().map((f) => [f.id, f]));
    expect(namesInDirectionsOn(true, formats["dg-modern"]!)).toBe(true);
    expect(namesInDirectionsOn(false, formats["dg-modern"]!)).toBe(false);
    expect(namesInDirectionsOn(true, formats["stage-uk"]!)).toBe(false);
  });

  it("is a step of its own after the keystroke", () => {
    let page = type(open("A room.\n"), " Charlie ");
    page = run(page, undo);
    expect(line(page)).toBe("A room. Charlie ");
  });
});

describe("the writer's override (docs/app/writing/editor-ux.md#EDIT-205)", () => {
  const capped = () => type(open("A room.\n"), " Charlie,");

  it("⌘Z straight after puts back the writer's case and keeps the boundary", () => {
    const page = run(capped(), undo);
    expect(line(page)).toBe("A room. Charlie,");
    expect(marked(page, CAST_KEPT)).toBe("Charlie");
  });

  it("Backspace as the very next key does the same; a second one deletes", () => {
    const once = backspace(capped());
    expect(line(once)).toBe("A room. Charlie,");
    expect(marked(once, CAST_KEPT)).toBe("Charlie");
    expect(line(backspace(once))).toBe("A room. Charlie");
  });

  it("Backspace after another key deletes as always", () => {
    const page = type(capped(), " s");
    expect(line(backspace(page))).toBe("A room. CHARLIE, ");
  });

  /** The name's last letter typed again, then a boundary: what would fire it. */
  const finishAgain = (page: EditorState, end: number) => {
    let next = at(page, end);
    next = next.applyTransaction(next.tr.delete(end - 1, end)).state;
    return type(next, "e,");
  };

  it("a declined one stays declined: typing after it, and its last letter typed again", () => {
    let page = type(run(capped(), undo), " smiles.");
    expect(line(page)).toBe("A room. Charlie, smiles.");
    const end = startOf(page, 0) + "A room. Charlie".length;
    page = finishAgain(page, end);
    expect(line(page)).toBe("A room. Charlie,, smiles.");
  });

  it("through a typo fixed inside the name", () => {
    let page = run(capped(), undo);
    const h = startOf(page, 0) + "A room. C".length;
    page = at(page, h + 1);
    page = page.applyTransaction(page.tr.delete(h, h + 1)).state;
    page = type(page, "h");
    expect(line(page)).toBe("A room. Charlie,");
    page = finishAgain(page, startOf(page, 0) + "A room. Charlie".length);
    expect(line(page)).toBe("A room. Charlie,,");
  });

  it("through an undo and a redo of what came after", () => {
    let page = type(run(capped(), undo), " x");
    page = run(run(page, undo), redo);
    expect(marked(page, CAST_KEPT)).toBe("Charlie");
    page = finishAgain(page, startOf(page, 0) + "A room. Charlie".length);
    expect(line(page)).toContain("Charlie,");
  });

  it("through a cut and a paste", () => {
    let page = run(capped(), undo);
    const from = startOf(page, 0) + "A room. ".length;
    const slice = page.doc.slice(from, from + "Charlie".length);
    page = page.applyTransaction(page.tr.delete(from, from + "Charlie".length)).state;
    page = page.applyTransaction(page.tr.replace(startOf(page, 0), startOf(page, 0), slice)).state;
    expect(line(page)).toBe("CharlieA room. ,");
    expect(marked(page, CAST_KEPT)).toBe("Charlie");
    // And the clipboard's HTML says so: the mark is written as the tag its parse rule reads.
    const mark = schema.marks[CAST_KEPT]!;
    const [, attrs] = mark.spec.toDOM!(mark.create(), true) as unknown as [string, object];
    expect(attrs).toEqual({ "data-cast-kept": "" });
    expect(mark.spec.parseDOM?.[0]?.tag).toBe("span[data-cast-kept]");
  });

  it("through a scene moved on the board, which brings the page back through the model", () => {
    const page = run(capped(), undo);
    const back = schema.nodeFromJSON(toEditorDoc(fromEditorDoc(page.doc.toJSON() as Doc)));
    expect(back.toJSON()).toEqual(page.doc.toJSON());
  });

  it("the next occurrence still fires", () => {
    const page = type(run(capped(), undo), " then Charlie.");
    expect(line(page)).toBe("A room. Charlie, then CHARLIE.");
  });

  it("typed over in another case, the name is the writer's", () => {
    let page = capped();
    const from = startOf(page, 0) + "A room. ".length;
    page = page.apply(
      page.tr.setSelection(TextSelection.create(page.doc, from, from + "CHARLIE".length)),
    );
    page = type(page, "Charlie");
    page = type(page, "!");
    expect(line(page)).toBe("A room. Charlie!,");
    expect(marked(page, CAST_CAPS)).toBe("");
  });

  it("its case changed by hand, the name is the writer's", () => {
    let page = capped();
    const end = startOf(page, 0) + "A room. CHARLIE".length;
    page = at(page, end);
    page = page.applyTransaction(page.tr.delete(end - "HARLIE".length, end)).state;
    page = type(page, "harlie;");
    expect(line(page)).toBe("A room. Charlie;,");
  });
});

describe("guards (docs/app/writing/editor-ux.md#EDIT-207)", () => {
  it("a direction made all capitals by the rule stays a direction at Enter", () => {
    const fresh = open("Something.\n");
    const empty = fresh.applyTransaction(fresh.tr.delete(startOf(fresh, 0), endOf(fresh, 0))).state;
    const named = type(at(empty, startOf(empty, 0)), "Charlie.");
    expect(line(named)).toBe("CHARLIE.");
    expect(confirmActionAs(named.doc.child(0))).toBeNull();
    // A cue the writer typed in capitals is still one.
    const cue = type(at(empty, startOf(empty, 0)), "CHARLIE");
    expect(confirmActionAs(cue.doc.child(0))).toBe("character");
  });

  it("and is saved as one, with the `!` that keeps it so after a reopen", () => {
    const fresh = open("Something.\n\nMARA\nHi.\n");
    const empty = fresh.applyTransaction(fresh.tr.delete(startOf(fresh, 0), endOf(fresh, 0))).state;
    const named = type(at(empty, startOf(empty, 0)), "Charlie.");
    const saved = save(named);
    expect(saved.startsWith("!CHARLIE.\n")).toBe(true);
    expect(parse(saved).doc.content[0]?.type).toBe("action");
  });

  it("writes nothing new into the script", () => {
    const declined = run(type(open("A room.\n"), " Charlie, then June."), undo);
    expect(save(declined)).toBe("A room. CHARLIE, then June.\n");
    expect(marked(declined, CAST_KEPT)).toBe("June");
    expect(marked(declined, CAST_CAPS)).toBe("CHARLIE");
  });
});

describe("Capitalize Character Names in Directions… (docs/app/writing/editor-ux.md#EDIT-208)", () => {
  // "charlie" in lower case is an ordinary word (docs/app/writing/editor-ux.md#EDIT-203), so it is not offered.
  const script =
    "Charlie enters, then June.\n\nMARA\n(to june, not charlie)\nHi, June.\n\nIt rains on JUNE.\n";

  it("lists every name the rule would capitalize, with its line", () => {
    const page = open(script);
    const found = scriptOccurrences(page.doc, ON);
    expect(found.map((o) => [o.name, o.line, o.at])).toEqual([
      ["Charlie", "Charlie enters, then June.", 0],
      ["June", "Charlie enters, then June.", 21],
      ["june", "to june, not charlie", 3],
    ]);
  });

  it("capitalizes those ticked and declines the rest, as one undo step", () => {
    const page = open(script);
    const found = scriptOccurrences(page.doc, ON);
    const done = page.applyTransaction(capitalizeChosen(page, found, new Set([0, 2]))).state;
    expect(line(done, 0)).toBe("CHARLIE enters, then June.");
    expect(line(done, 2)).toBe("to JUNE, not charlie");
    expect(marked(done, CAST_KEPT, 0)).toBe("June");
    // Declined: not offered again.
    expect(scriptOccurrences(done.doc, ON)).toEqual([]);
    const undone = run(done, undo);
    expect(undone.doc.toJSON()).toEqual(page.doc.toJSON());
  });
});

describe("names kept from the command, in the play file (docs/app/keeping-work/storage-and-file-format.md#STOR-194)", () => {
  const script = "June waits, and June again.\n\nMARA\nHi.\n\nCharlie sits by June.\n";

  it("keys a line by its words in capitals, so the command's capitals leave it as it was", () => {
    expect(lineKey("June waits")).toBe(lineKey("JUNE  waits"));
    expect(lineKey("June waits")).not.toBe(lineKey("June sits"));
    expect(lineKey("x")).toMatch(/^[0-9a-f]{8}$/);
  });

  it("names which appearance on the line it is, whatever case the others are in", () => {
    const page = open(script);
    const [first, second] = scriptOccurrences(page.doc, ON);
    expect([first!.name, second!.name]).toEqual(["June", "June"]);
    expect(keptName(first!).nth).toBe(0);
    expect(keptName(second!).nth).toBe(1);
    expect(keptName({ ...second!, line: second!.line.replace("June", "JUNE") }).nth).toBe(1);
  });

  it("is not offered again once kept, after a reopen as before it", () => {
    const page = open(script);
    const found = scriptOccurrences(page.doc, ON);
    const kept = keptAfter(page.doc, [], [found[1]!])!;
    expect(kept).toEqual([keptName(found[1]!)]);
    // Reopened: no mark on the page, only the play file's list.
    const again = scriptOccurrences(open(script).doc, ON, kept);
    expect(again.map((o) => [o.name, o.at])).toEqual([
      ["June", 0],
      ["Charlie", 0],
      ["June", 16],
    ]);
  });

  it("still names its place after the other names on its line are capitalized", () => {
    const page = open(script);
    const found = scriptOccurrences(page.doc, ON);
    const kept = keptAfter(page.doc, [], [found[1]!])!;
    const done = page.applyTransaction(capitalizeChosen(page, found, new Set([0, 2, 3]))).state;
    const reopened = open(save(done));
    expect(line(reopened, 0)).toBe("JUNE waits, and June again.");
    expect(scriptOccurrences(reopened.doc, ON, kept)).toEqual([]);
    expect(keptStill(reopened.doc, kept)).toEqual(kept);
  });

  it("forgets an entry whose line is gone, and writes nothing when nothing changed", () => {
    const page = open(script);
    const found = scriptOccurrences(page.doc, ON);
    const kept = keptAfter(page.doc, [], [found[1]!])!;
    expect(keptAfter(page.doc, kept, [])).toBeNull();
    const rewritten = open("June waits.\n\nMARA\nHi.\n\nCharlie sits by June.\n");
    expect(keptStill(rewritten.doc, kept)).toEqual([]);
    expect(keptAfter(rewritten.doc, kept, [])).toEqual([]);
  });
});
