// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The guide's own edits, on a real editor state with the play's schema
 * (docs/app/preferences-and-help/tutorials.md#TUT-10, docs/app/keeping-work/storage-and-file-format.md#STOR-176): the whole course written
 * into ONE play by Show Me, each result recognised by the coach, each lesson
 * picking up where the last left the play, and no word ever removed.
 */
import { describe, expect, test } from "bun:test";
import { getSchema } from "@tiptap/core";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import { playExtensions } from "../editor/schema";
import { ensureNonEmpty, fromEditorDoc, toEditorDoc } from "../editor/bridge";
import { parse, serialize, type Doc } from "../fountain";
import { coach, measure, readScript, type Baseline, type Facts } from "./coach";
import { COURSE_SEED, EXAMPLE, type Task } from "./lessons";
import { blockPos, decorationsFor } from "./ghost";
import * as edits from "./perform";

const schema = getSchema(playExtensions);
const stateOf = (fountain: string) => EditorState.create({schema, doc: schema.nodeFromJSON(toEditorDoc(ensureNonEmpty(parse(fountain).doc)))});
const apply = (s: EditorState, tr: Transaction | null) => {expect(tr).not.toBeNull(); return s.apply(tr!);};
const model = (s: EditorState) => fromEditorDoc(s.doc.toJSON() as Doc);
const facts = (s: EditorState): Facts => ({
  script: readScript(model(s), s.selection.$head.depth >= 1 ? s.selection.$head.index(0) : null, !s.selection.empty ? s.selection.$from.parent.type.name : null),
  view: "script", saved: true, unsaved: false, format: "stage-us-modern", cards: [], front: {charactersPage: "", characters: [], openingNotes: ""},
  documents: [], material: null, export: {open: false, range: false, rangeError: false, opening: false, preview: false},
  ui: {menu: [], elementMenu: false, sheet: null, focus: null, focusText: "", fields: {}},
});
const text = (s: EditorState) => serialize({doc: model(s), frontMatter: {}});
/** Every word the writer had is still there (a cue may have been capitalised). */
const words = (s: EditorState) => new Set(model(s).content.flatMap(b => (b.content ?? []).flatMap(t => "text" in t ? t.text.toUpperCase().split(/[\s\n]+/).filter(Boolean) : [])));
const keeps = (before: EditorState, after: EditorState) => {for (const w of words(before)) expect(words(after).has(w)).toBe(true);};
const caretType = (s: EditorState) => s.selection.$head.parent.type.name;

/** Show Me for one step: its edit, then the coach's verdict against the step's own start. */
function show(s: EditorState, task: Task, edit: (s: EditorState) => Transaction | null): {s: EditorState; before: Baseline} {
  const before = measure(facts(s));
  expect(coach(task, facts(s), before).tone).not.toBe("done");
  const next = apply(s, edit(s));
  keeps(s, next);
  expect(coach(task, facts(next), before).tone).toBe("done");
  return {s: next, before};
}

describe("one practice play, written by the whole course", () => {
  test("the first lesson's four results, each recognised, each where the last one left off", () => {
    let s = apply(stateOf(COURSE_SEED), edits.endLineTr(stateOf(COURSE_SEED)));
    expect(caretType(s)).toBe("action");
    expect(coach("speaker", facts(s), measure(facts(s))).ghost).toEqual({index: 1, text: "MARA", key: "Return"});
    s = show(s, "speaker", st => edits.nameTr(st, EXAMPLE.first)).s;
    expect(caretType(s)).toBe("dialogue");
    s = show(s, "line", st => edits.speakTr(st, EXAMPLE.line, true)).s;
    expect(caretType(s)).toBe("action");
    // The next step starts where this one ended: on the empty line, pointing at the menu.
    expect(coach("speaker-two", facts(s), measure(facts(s))).target).toEqual({kind: "ui", id: "line-type"});
    s = show(s, "speaker-two", st => edits.nameTr(st, EXAMPLE.second)).s;
    s = show(s, "reply", st => edits.speakTr(st, EXAMPLE.reply, false)).s;
    expect(text(s)).toContain("MARA\nYou're early.\n\nIVO\nI was hoping you wouldn't notice.");
  });

  test("the second lesson formats that same exchange, and a page break goes after it", () => {
    let s = stateOf(COURSE_SEED + "MARA\nYou're early.\n\nIVO\nI was hoping you wouldn't notice.\n");
    s = show(s, "emphasis", edits.emphasisTr).s;
    expect(text(s)).toContain("**You're** early.");
    s = show(s, "line-break", edits.lineBreakTr).s;
    expect(text(s)).toContain("You're** early.\nCome in.");
    const {s: paged} = show(s, "page-break", edits.pageBreakAtEndTr);
    expect(paged.doc.child(paged.doc.childCount - 2).type.name).toBe("pageBreak");
    expect(caretType(paged)).toBe("action");
    expect(text(paged)).toContain("I was hoping you wouldn't notice.\n\n===");
  });

  test("a lesson opened first gets the exchange it needs, after what is there", () => {
    const fresh = apply(stateOf(COURSE_SEED), edits.endLineTr(stateOf(COURSE_SEED)));
    const s = apply(fresh, edits.exchangeTr(fresh));
    expect(text(s)).toContain("## SCENE 1\n\nMARA\nYou're early.\n\nIVO\nI was hoping you wouldn't notice.");
    const written = stateOf(COURSE_SEED + "The door opens.\n");
    const more = apply(written, edits.exchangeTr(written));
    keeps(written, more);
    expect(text(more).indexOf("The door opens.")).toBeLessThan(text(more).indexOf("MARA"));
  });
});

describe("preparing a step", () => {
  test("an empty line at the end, reused when there is one, typed onto when asked", () => {
    const s = stateOf(COURSE_SEED + "The door opens.\n");
    const once = apply(s, edits.endLineTr(s));
    expect(once.doc.childCount).toBe(s.doc.childCount + 1);
    const twice = apply(once, edits.endLineTr(once));
    expect(twice.doc.childCount).toBe(once.doc.childCount);
    const cue = apply(twice, edits.endLineTr(twice, "character"));
    expect(caretType(cue)).toBe("character");
  });
  test("the newest cue's speech: found, made, or converted from an empty line — never another line", () => {
    const bare = stateOf(COURSE_SEED);
    const withCue = apply(bare, edits.nameTr(bare, "ROWAN"));
    const back = apply(withCue, edits.speechTr(withCue));
    expect(caretType(back)).toBe("dialogue");
    expect(back.doc.childCount).toBe(withCue.doc.childCount);
    expect(edits.speechTr(stateOf("The door opens.\n"))).toBeNull();
  });
  test("a name already typed on the end line is the one used, in capitals", () => {
    const s = stateOf(COURSE_SEED + "rowan\n");
    const next = apply(s, edits.nameTr(s, EXAMPLE.first));
    expect(text(next)).toContain("ROWAN\n");
    expect(text(next)).not.toContain(EXAMPLE.first);
  });
  test("a sentence on the end line is kept, and the speaker goes after it", () => {
    const s = stateOf(COURSE_SEED + "The door opens.\n");
    const next = apply(s, edits.nameTr(s, EXAMPLE.first));
    keeps(s, next);
    expect(text(next)).toContain("The door opens.\n\nMARA");
  });
  test("a speech that already has words gets no suggestion typed over it", () => {
    const s = stateOf(COURSE_SEED + "MARA\nMy own words.\n");
    const next = apply(s, edits.speakTr(s, EXAMPLE.line, false));
    expect(text(next)).toContain("My own words.");
    expect(text(next)).not.toContain(EXAMPLE.line);
  });
});

describe("fixes the guide offers", () => {
  test("Make It a Name: the lowercase line becomes the cue, the empty line under it the speech", () => {
    // The step began on an empty line; the writer typed "mara" there and pressed Return.
    const seed = stateOf(COURSE_SEED);
    const start = measure(facts(apply(seed, edits.endLineTr(seed))));
    const s = stateOf(COURSE_SEED + "mara\n");
    const split = apply(s, edits.endLineTr(s));
    const mistake = coach("speaker", facts(split), start);
    expect(mistake.fix).toEqual({id: "cue", label: "Make It a Name", index: 1});
    const fixed = apply(split, edits.cueFixTr(split, 1));
    keeps(split, fixed);
    expect(text(fixed)).toContain("MARA\n");
    expect(caretType(fixed)).toBe("dialogue");
    expect(coach("speaker", facts(fixed), start).tone).toBe("done");
  });
  test("Make It Dialogue and Use Capitals: the line's type, and nothing else", () => {
    const s = stateOf(COURSE_SEED + "MARA\n\nYou're early.\n");
    const at = s.doc.childCount - 1;
    const fixed = apply(s, edits.retypeTr(s, at, "dialogue"));
    expect(fixed.doc.child(at).type.name).toBe("dialogue");
    expect(fixed.doc.child(at).textContent).toBe("You're early.");
    expect(edits.retypeTr(s, 99, "dialogue")).toBeNull();
  });
});

describe("the lit line and its suggestion", () => {
  test("a line decoration on the block, and the suggestion at its end", () => {
    const s = stateOf(COURSE_SEED + "MA\n");
    const set = decorationsFor(s, {line: 1, ghost: {index: 1, text: "RA", key: "Return"}});
    const found = set.find();
    expect(found.length).toBe(2);
    const at = blockPos(s, 1)!;
    const line = found.find(d => d.from === at)!;
    expect(line.to).toBe(at + s.doc.child(1).nodeSize);
    const widget = found.find(d => d.from === d.to)!;
    expect(widget.from).toBe(at + 1 + s.doc.child(1).content.size);
    expect((widget.spec as {key: string}).key).toBe("tutorial-ghost:RA:Return");
  });
  test("nothing drawn for a line that does not exist, or with nothing to show", () => {
    const s = stateOf(COURSE_SEED);
    expect(decorationsFor(s, {line: 40, ghost: {index: 40, text: "X"}}).find().length).toBe(0);
    expect(decorationsFor(s, {line: null, ghost: {index: 0, text: ""}}).find().length).toBe(0);
    expect(blockPos(s, -1)).toBeNull();
  });
  test("decorations never change the document or its words", () => {
    const s = stateOf(COURSE_SEED + "MA\n");
    decorationsFor(s, {line: 1, ghost: {index: 1, text: "RA", key: "Return"}});
    expect(text(s)).toContain("MA\n");
    expect(text(s)).not.toContain("MARA");
  });
});
