// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the guide says, where it says it, and whether the writer has done it
 * (docs/app/preferences-and-help/tutorials.md#TUT-8, docs/app/preferences-and-help/tutorials.md#TUT-9, docs/app/preferences-and-help/tutorials.md#TUT-D104).
 *
 * `coach` is a pure function of two readings: the play and the window as they
 * are now (`Facts`), and as they were when the step began (`Baseline`). A step
 * is done when its RESULT is there — a new cue with a line under it, a card
 * that moved, a tag on the note — however the writer got there: typing,
 * menus, the keyboard, a paste. Words are never graded. Because every lesson
 * writes the same play (docs/app/preferences-and-help/tutorials.md#TUT-10), results are counted against
 * the baseline rather than looked for anywhere: the exchange from the first
 * lesson must not satisfy the second speaker of a replay.
 *
 * A cue is one instruction pinned to one target. When the play shows a
 * recognisable wrong turn — a name typed in lowercase that became a stage
 * direction, a line whose type was changed, a Return where a Line Break was
 * meant — the cue says so at that line and, where the repair is certain,
 * offers it as a Fix.
 */
import type { Doc } from "../fountain";
import { elementLabel } from "../editor/ElementBar";
import { EXAMPLE, type Task } from "./lessons";

export interface Block {
  type: string;
  text: string;
  marks: number;
}
export interface ScriptFacts {
  blocks: Block[];
  /** The top-level block holding the cursor. */
  caret: number | null;
  /** The type of the block holding a non-empty selection, when there is one. */
  selected: string | null;
  /** Bold or another mark is switched on for the next typing, with nothing selected. */
  storedMarks: boolean;
}
export interface UiFacts {
  /** `data-menu-id` of every row in the menus that are open. */
  menu: string[];
  /** The editor's own element menu (Return or Tab on an empty line). */
  elementMenu: boolean;
  sheet: "export" | "opening-pages" | "other" | null;
  /** The `data-tutorial` id around the focused control, and what it holds. */
  focus: string | null;
  focusText: string;
  /** Single fields on screen, by `data-tutorial` id, with what they hold now: the tag
   *  being typed, Opening Pages' notes before Save. Absent when not on screen. */
  fields: Record<string, string>;
}
export interface Facts {
  script: ScriptFacts;
  /** What the focused pane shows; null for a document. */
  view: string | null;
  saved: boolean;
  /** A save was refused or is waiting on a decision. */
  unsaved: boolean;
  format: string;
  cards: { id: string; heading: string; synopsis: string }[];
  front: { charactersPage: string; characters: string[]; openingNotes: string };
  documents: string[];
  /** The document open in the focused pane. */
  material: { id: string; name: string; text: string; tags: string[] } | null;
  export: {
    open: boolean;
    range: boolean;
    rangeError: boolean;
    opening: boolean;
    preview: boolean;
  };
  ui: UiFacts;
}
export interface Baseline {
  blocks: number;
  cues: number;
  spoken: number;
  finished: number;
  marks: number;
  breaks: number;
  pageBreaks: number;
  format: string;
  cards: string[];
  synopses: Record<string, string>;
  charactersPage: string;
  characters: number;
  openingNotes: string;
  documents: number;
  material: { id: string; name: string; text: string; tags: number } | null;
}

/** Inline pieces of a sentence: plain words, a key to press, text to type, a control's visible name. */
export type Part = string | { key: string } | { type: string } | { ui: string };
export type Target =
  | { kind: "line"; index: number }
  | { kind: "ui"; id: string; card?: number }
  | { kind: "view"; view: string }
  | { kind: "menu"; id: string }
  | { kind: "element"; key: string }
  | { kind: "focus" }
  | { kind: "none" };
export interface Ghost {
  index: number;
  text: string;
  key?: string;
}
export type FixId = "cue" | "character" | "dialogue" | "undo";
export interface Fix {
  id: FixId;
  label: string;
  index?: number;
}
export interface Cue {
  tone: "do" | "fix" | "done";
  say: Part[];
  target: Target;
  /** Faint text drawn in the script where the writer types, and the key that finishes the line. */
  ghost?: Ghost;
  fix?: Fix;
  /** The writer has left the place this step happens; the cue leads back. */
  back?: boolean;
  /** A script line to light as well, when the target is elsewhere (the line a menu will change). */
  line?: number;
}

// --- reading the play ------------------------------------------------------------

const words = (text: string) => !!text.trim();
/** One block per top-level node, with line breaks as "\n" (the bridge's model). */
export function readScript(
  doc: Doc,
  caret: number | null = null,
  selected: string | null = null,
  storedMarks = false,
): ScriptFacts {
  const blocks = doc.content.map((n): Block => {
    const inline = n.content ?? [];
    let text = "",
      marks = 0;
    for (const t of inline)
      if ("text" in t && typeof t.text === "string") {
        text += t.text;
        if ("marks" in t && t.marks?.length) marks++;
      }
    return { type: n.type, text, marks };
  });
  return { blocks, caret, selected, storedMarks };
}
/** Indices of cues with a Dialogue line right under them. */
export function cuePairs(blocks: Block[]): number[] {
  return blocks.flatMap((b, i) =>
    b.type === "character" && words(b.text) && blocks[i + 1]?.type === "dialogue" ? [i] : [],
  );
}
const spokenPairs = (blocks: Block[]) => cuePairs(blocks).filter((i) => words(blocks[i + 1].text));
const finishedPairs = (blocks: Block[]) => spokenPairs(blocks).filter((i) => i + 2 < blocks.length);
const count = (blocks: Block[], test: (b: Block) => number) =>
  blocks.reduce((n, b) => n + test(b), 0);

export function measure(f: Facts): Baseline {
  const b = f.script.blocks;
  return {
    blocks: b.length,
    cues: cuePairs(b).length,
    spoken: spokenPairs(b).length,
    finished: finishedPairs(b).length,
    marks: count(b, (x) => x.marks),
    breaks: count(b, (x) => x.text.split("\n").length - 1),
    pageBreaks: count(b, (x) => (x.type === "pageBreak" ? 1 : 0)),
    format: f.format,
    cards: f.cards.map((c) => c.id),
    synopses: Object.fromEntries(f.cards.map((c) => [c.id, c.synopsis])),
    charactersPage: f.front.charactersPage,
    characters: named(f.front.characters),
    openingNotes: f.front.openingNotes,
    documents: f.documents.length,
    material: f.material && {
      id: f.material.id,
      name: f.material.name,
      text: f.material.text,
      tags: f.material.tags.length,
    },
  };
}
const named = (names: string[]) => names.filter(words).length;

const hasLower = (s: string) => /\p{Ll}/u.test(s);
const allCaps = (s: string) => /\p{Lu}/u.test(s) && !hasLower(s);
/** What a writer types as a name: a word or three, no sentence punctuation. */
export const nameLike = (s: string) =>
  /^\p{L}[\p{L}'’.\- ]{0,30}$/u.test(s.trim()) &&
  !/[.!?]$/.test(s.trim()) &&
  s.trim().split(/\s+/).length <= 3;
/** The part of a suggestion still to type, when the writer is typing it; nothing once they write their own. */
export function ghostRest(suggestion: string, typed: string): string {
  if (!typed) return suggestion;
  return suggestion.toLowerCase().startsWith(typed.toLowerCase())
    ? suggestion.slice(typed.length)
    : "";
}
const label = (type: string) => elementLabel(type) ?? type;
const RETURN = { key: "Return" };

// --- steps -------------------------------------------------------------------------

const done = (say: Part[], target: Target = { kind: "none" }): Cue => ({
  tone: "done",
  say,
  target,
});
const todo = (say: Part[], target: Target, extra: Partial<Cue> = {}): Cue => ({
  tone: "do",
  say,
  target,
  ...extra,
});
const wrong = (say: Part[], target: Target, extra: Partial<Cue> = {}): Cue => ({
  tone: "fix",
  say,
  target,
  ...extra,
});
const menuCue = (id: string, name: string) =>
  todo(["Choose ", { ui: name }, "."], { kind: "menu", id });
const openDocumentMenu = (then: string) =>
  todo(["Open this menu — the play's name — and choose ", { ui: then }, "."], {
    kind: "ui",
    id: "document-menu",
  });

/** A name the writer typed in lowercase and confirmed with Return: it became a stage direction. */
function lowercaseName(s: ScriptFacts, b: Baseline): Cue | null {
  const at = s.caret;
  if (at === null || at < 1 || s.blocks.length <= b.blocks) return null;
  const line = s.blocks[at],
    before = s.blocks[at - 1];
  if (
    words(line.text) ||
    before.type !== "action" ||
    !nameLike(before.text) ||
    !hasLower(before.text)
  )
    return null;
  return wrong(
    ["“", before.text.trim(), "” became a stage direction. A speaker's name is typed in capitals."],
    { kind: "line", index: at - 1 },
    { fix: { id: "cue", label: "Make It a Name", index: at - 1 } },
  );
}

/** Naming a speaker at the end of the script: the first and third steps of the first lesson. */
function nameSpeaker(
  s: ScriptFacts,
  b: Baseline,
  f: Facts,
  suggestion: string,
  second: boolean,
): Cue {
  const pairs = cuePairs(s.blocks);
  if (pairs.length > b.cues) {
    const at = pairs[pairs.length - 1];
    return done(
      [
        second ? "That's the second speaker, " : "That's a character cue: ",
        { type: s.blocks[at].text.trim() },
        ". The line under it is ready for their words.",
      ],
      { kind: "line", index: at },
    );
  }
  if (f.ui.elementMenu)
    return todo(["Choose ", { ui: "Character" }, " in this list."], { kind: "element", key: "c" });
  if (f.ui.menu.includes("line-type:character")) return menuCue("line-type:character", "Character");
  const mistake = lowercaseName(s, b);
  if (mistake) return mistake;
  const end = s.blocks.length - 1;
  const at = s.caret ?? end;
  const line = s.blocks[at];
  if (!line) return todo(["Click at the end of the script."], { kind: "none" });
  if (
    at !== end &&
    !words(s.blocks[end].text) &&
    (s.blocks[end].type === "action" || s.blocks[end].type === "character")
  )
    return todo(
      ["Click this empty line to write here."],
      { kind: "line", index: end },
      { ghost: { index: end, text: suggestion, key: "Return" } },
    );
  if (line.type === "action" && !words(line.text))
    return second
      ? todo(
          [
            "Open the line-type menu and choose ",
            { ui: "Character" },
            " — or press ",
            { key: "Tab" },
            ".",
          ],
          { kind: "ui", id: "line-type" },
          { line: at },
        )
      : todo(
          ["Type ", { type: suggestion }, ", then press ", RETURN, "."],
          { kind: "line", index: at },
          { ghost: { index: at, text: suggestion, key: "Return" } },
        );
  if (line.type === "character" && !words(line.text))
    return todo(
      ["Type ", { type: suggestion }, ", then press ", RETURN, "."],
      { kind: "line", index: at },
      { ghost: { index: at, text: suggestion, key: "Return" } },
    );
  if (
    line.type === "character" ||
    (line.type === "action" && allCaps(line.text) && nameLike(line.text))
  )
    return todo(
      ["Now press ", RETURN, "."],
      { kind: "line", index: at },
      { ghost: { index: at, text: ghostRest(suggestion, line.text.trim()), key: "Return" } },
    );
  if (line.type === "action" && nameLike(line.text) && hasLower(line.text))
    return wrong(
      ["A speaker's name is typed in capitals: ", { type: line.text.trim().toUpperCase() }, "."],
      { kind: "line", index: at },
      { fix: { id: "character", label: "Use Capitals" } },
    );
  if (line.type === "action")
    return wrong(["That's a stage direction. For a speaker, type just their name, in capitals."], {
      kind: "line",
      index: at,
    });
  return wrong(
    [
      "This line is ",
      { ui: label(line.type) },
      ". Choose ",
      { ui: "Character" },
      " in the line-type menu for a name.",
    ],
    { kind: "ui", id: "line-type" },
    { fix: { id: "character", label: "Make It Character" } },
  );
}

/** The speech under the newest cue: the second and fourth steps. */
function speak(s: ScriptFacts, b: Baseline, f: Facts, suggestion: string, reply: boolean): Cue {
  const finished = reply
    ? spokenPairs(s.blocks).length > b.spoken
    : finishedPairs(s.blocks).length > b.finished;
  if (finished)
    return done(
      reply
        ? ["You've written an exchange. The page did the formatting."]
        : ["Your first speech is on the page."],
    );
  const cues = s.blocks.flatMap((x, i) => (x.type === "character" && words(x.text) ? [i] : []));
  const cue = cues[cues.length - 1];
  if (cue === undefined)
    return todo(["Name a speaker first: type a name in capitals and press ", RETURN, "."], {
      kind: "none",
    });
  const name = s.blocks[cue].text.trim();
  const d = cue + 1;
  if (f.ui.elementMenu)
    return wrong(
      [
        "This menu changes what a line is. Press ",
        { key: "Escape" },
        ", then type ",
        name,
        "'s words.",
      ],
      { kind: "element", key: "d" },
    );
  if (s.blocks[d]?.type !== "dialogue")
    return wrong(
      ["The line under ", { type: name }, " isn't Dialogue any more."],
      { kind: "line", index: cue },
      { fix: { id: "dialogue", label: "Make It Dialogue", index: d } },
    );
  const text = s.blocks[d].text;
  if (s.caret !== d)
    return todo(
      [
        words(text)
          ? "Click the end of this speech."
          : "Click the line under " + name + " to write their words.",
      ],
      { kind: "line", index: d },
      {
        ghost: {
          index: d,
          text: ghostRest(suggestion, text.trim()),
          key: reply ? undefined : "Return",
        },
      },
    );
  if (!words(text))
    return todo(
      reply
        ? ["Type ", name, "'s reply. Any words will do."]
        : ["Type what ", name, " says, then press ", RETURN, "."],
      { kind: "line", index: d },
      { ghost: { index: d, text: suggestion, key: reply ? undefined : "Return" } },
    );
  return todo(
    ["Press ", RETURN, " when the line is finished."],
    { kind: "line", index: d },
    { ghost: { index: d, text: ghostRest(suggestion, text.trim()), key: "Return" } },
  );
}

const firstSpeech = (s: ScriptFacts) => {
  const i = s.blocks.findIndex((x) => x.type === "dialogue" && words(x.text));
  return i < 0 ? null : i;
};
const backTo = (view: string, name: string): Cue => ({
  ...todo(["Choose ", { ui: name }, " to come back to this step."], { kind: "view", view }),
  back: true,
});

export function coach(task: Task, f: Facts, b: Baseline): Cue {
  const s = f.script;
  const speech = firstSpeech(s);
  switch (task) {
    case "speaker":
      return nameSpeaker(s, b, f, EXAMPLE.first, false);
    case "line":
      return speak(s, b, f, EXAMPLE.line, false);
    case "speaker-two":
      return nameSpeaker(s, b, f, EXAMPLE.second, true);
    case "reply":
      return speak(s, b, f, EXAMPLE.reply, true);
    case "saved":
      if (f.unsaved)
        return wrong(
          ["Your practice hasn't reached its file yet. The message here says what to do."],
          { kind: "ui", id: "save-status" },
        );
      return f.saved
        ? done(
            ["Saved. Proscenium saves as you write, and this tells you when your words are safe."],
            { kind: "ui", id: "save-status" },
          )
        : todo(["Proscenium saves as you write. Watch this say Saved."], {
            kind: "ui",
            id: "save-status",
          });

    case "emphasis":
      if (count(s.blocks, (x) => x.marks) > b.marks)
        return done(["Those words have emphasis now."]);
      if (s.selected === "character")
        return wrong(
          ["A name's style belongs to the format. Select words in a speech instead."],
          speech === null ? { kind: "none" } : { kind: "line", index: speech },
        );
      if (s.selected)
        return todo(["Now choose ", { ui: "Bold" }, " — or press ", { key: "⌘B" }, "."], {
          kind: "ui",
          id: "bold",
        });
      if (s.storedMarks)
        return wrong(
          ["Bold is on for new typing. To emphasize words already there, select them first."],
          speech === null ? { kind: "none" } : { kind: "line", index: speech },
        );
      return todo(
        ["Select a few words in this speech — drag across them."],
        speech === null ? { kind: "none" } : { kind: "line", index: speech },
      );
    case "line-break": {
      if (count(s.blocks, (x) => x.text.split("\n").length - 1) > b.breaks)
        return done(["The speech goes on, on a new line."]);
      if (s.blocks.length > b.blocks)
        return wrong(
          ["Return started a new line of the script. Line Break stays in the same speech."],
          { kind: "ui", id: "line-break" },
          { fix: { id: "undo", label: "Undo That" } },
        );
      const here = s.caret === null ? null : s.blocks[s.caret];
      if (here && (here.type === "dialogue" || here.type === "action") && words(here.text))
        return todo(
          ["Now choose ", { ui: "Line Break" }, " — or press ", { key: "⇧Return" }, "."],
          { kind: "ui", id: "line-break" },
        );
      return todo(
        ["Click inside this speech, where the new line should start."],
        speech === null ? { kind: "none" } : { kind: "line", index: speech },
      );
    }
    case "page-break":
      if (count(s.blocks, (x) => (x.type === "pageBreak" ? 1 : 0)) > b.pageBreaks)
        return done(["What follows starts on a new page."]);
      return todo(
        [
          "Choose ",
          { ui: "Page Break" },
          " — or press ",
          { key: "⌘Return" },
          ". It goes after the line with the cursor.",
        ],
        { kind: "ui", id: "page-break" },
      );
    case "format":
      if (f.format !== b.format)
        return done(["This practice uses another format now. The words didn't change."]);
      if (f.ui.menu.some((id) => id.startsWith("format:")))
        return todo(["Choose another format."], { kind: "menu", id: "format:other" });
      return openDocumentMenu("a different format");

    case "board":
      return f.view === "corkboard"
        ? done(["Each card is one scene, in the script's order."])
        : todo(["Choose ", { ui: "Board" }, "."], { kind: "view", view: "corkboard" });
    case "scene":
      if (f.cards.length > b.cards.length)
        return done(["A new scene, on the Board and in the script."]);
      if (f.view !== "corkboard") return backTo("corkboard", "Board");
      return todo(["Choose ", { ui: "New Scene" }, "."], { kind: "ui", id: "new-scene" });
    case "summary": {
      if (f.cards.some((c) => words(c.synopsis) && c.synopsis !== (b.synopses[c.id] ?? "")))
        return done(["The summary is saved with its scene."]);
      if (f.view !== "corkboard") return backTo("corkboard", "Board");
      if (f.ui.focus === "scene-summary")
        return words(f.ui.focusText)
          ? todo(["Click outside the card to keep it."], { kind: "focus" })
          : todo(["Write one sentence about what happens."], { kind: "focus" });
      return todo(["Click here and write what happens in this scene."], {
        kind: "ui",
        id: "scene-summary",
        card: Math.max(0, f.cards.length - 1),
      });
    }
    case "move-scene": {
      const now = f.cards.map((c) => c.id);
      if (now.length === b.cards.length && now.some((id, i) => id !== b.cards[i]))
        return done(["The order changed — the scene's words moved with its card."]);
      if (f.view !== "corkboard") return backTo("corkboard", "Board");
      if (f.cards.length < 2)
        return todo(["Choose ", { ui: "New Scene" }, " first, so there are two scenes to order."], {
          kind: "ui",
          id: "new-scene",
        });
      return todo(["Choose ", { ui: "Move Earlier" }, " to move this scene up."], {
        kind: "ui",
        id: "scene-move",
        card: f.cards.length - 1,
      });
    }
    case "outline":
      return f.view === "outliner"
        ? done(["The same scenes in the same order, as a list."])
        : todo(["Choose ", { ui: "Outline" }, "."], { kind: "view", view: "outliner" });

    case "cast":
      return f.view === "cast"
        ? done(["The printed Characters page is at the top, the cast tools below it."])
        : todo(["Choose ", { ui: "Cast" }, "."], { kind: "view", view: "cast" });
    case "characters-page":
      if (words(f.front.charactersPage) && f.front.charactersPage !== b.charactersPage)
        return done(["The printed page keeps your wording now."]);
      if (f.view !== "cast") return backTo("cast", "Cast");
      return todo(
        [
          f.ui.focus === "characters-page"
            ? "Change a word or add a line about them."
            : "Click the Characters page and change a word.",
        ],
        { kind: "ui", id: "characters-page" },
      );
    case "add-character": {
      const names = f.front.characters.filter(words);
      if (names.length > b.characters)
        return done([{ type: names[names.length - 1].trim() }, " is in the cast."]);
      if (f.view !== "cast") return backTo("cast", "Cast");
      if (f.ui.focus === "character-name")
        return words(f.ui.focusText)
          ? todo(["Click outside the row to keep the name."], { kind: "focus" })
          : todo(["Type a name — try ", { type: EXAMPLE.character }, "."], { kind: "focus" });
      return todo(["Choose ", { ui: "Add Character" }, "."], { kind: "ui", id: "add-character" });
    }
    case "opening-notes":
      if (words(f.front.openingNotes) && f.front.openingNotes !== b.openingNotes)
        return done(["Your opening notes are saved in the play."]);
      if (f.ui.sheet === "opening-pages")
        return words(f.ui.fields["opening-notes"] ?? "") &&
          f.ui.fields["opening-notes"] !== b.openingNotes
          ? todo(["Choose ", { ui: "Save" }, "."], { kind: "ui", id: "opening-save" })
          : todo(["Write a line here — a place, a time, a dedication."], {
              kind: "ui",
              id: "opening-notes",
            });
      if (f.ui.menu.includes("opening-pages"))
        return menuCue("opening-pages", "Edit Opening Pages…");
      return openDocumentMenu("Edit Opening Pages…");

    case "document":
      if (f.documents.length > b.documents)
        return done(["A new document, in the Binder beside the script."]);
      if (f.ui.menu.includes("new:document")) return menuCue("new:document", "Document");
      return todo(
        ["Choose ", { ui: "New" }, " at the bottom of the Binder, then ", { ui: "Document" }, "."],
        { kind: "ui", id: "binder-new" },
      );
    case "note": {
      const m = f.material;
      if (m && words(m.text) && m.text !== (b.material?.id === m.id ? b.material.text : ""))
        return done(["Your note is saved beside the script."]);
      if (!m)
        return {
          ...todo(["Open your document from the Binder."], { kind: "ui", id: "material-page" }),
          back: true,
        };
      return todo(["Click the page and write a few words."], { kind: "ui", id: "material-page" });
    }
    case "tags": {
      const m = f.material;
      if (m && m.tags.length > (b.material?.id === m.id ? b.material.tags : 0))
        return done(["The document has a tag."]);
      if (!m)
        return {
          ...todo(["Open your document from the Binder."], { kind: "ui", id: "material-page" }),
          back: true,
        };
      const draft = f.ui.fields["tag-field"];
      if (draft !== undefined)
        return words(draft)
          ? todo(["Choose ", { ui: "Add Tag" }, " — or press ", RETURN, "."], {
              kind: "ui",
              id: "add-tag",
            })
          : todo(["Type a word for the tag — try ", { type: EXAMPLE.tag }, "."], {
              kind: "ui",
              id: "tag-field",
            });
      return todo(["Choose ", { ui: "Edit Tags" }, "."], { kind: "ui", id: "material-tags" });
    }
    case "rename": {
      const m = f.material;
      if (
        m &&
        m.name !== (b.material?.id === m.id ? b.material.name : m.name) &&
        !/^untitled/i.test(m.name)
      )
        return done(["The document has your name for it."]);
      if (!m)
        return {
          ...todo(["Open your document from the Binder."], { kind: "ui", id: "material-page" }),
          back: true,
        };
      return todo(
        [
          f.ui.focus === "material-name"
            ? "Type a name, then press "
            : "Click the name and type a new one, then press ",
          RETURN,
          ".",
        ],
        { kind: "ui", id: "material-name" },
      );
    }

    case "export":
      if (f.export.open) return done(["This preview shows what the PDF would hold."]);
      if (f.ui.menu.includes("export-pdf")) return menuCue("export-pdf", "Export PDF…");
      return openDocumentMenu("Export PDF…");
    case "export-range":
      if (!f.export.open) return { ...openDocumentMenu("Export PDF…"), back: true };
      if (f.export.rangeError)
        return wrong(["That isn't a page of this script. Try ", { type: "1" }, "."], {
          kind: "ui",
          id: "export-range",
        });
      if (f.export.range) return done(["Only the pages you chose go in this copy."]);
      return todo(["Type ", { type: "1" }, " in Pages."], { kind: "ui", id: "export-range" });
    case "export-opening":
      if (!f.export.open) return { ...openDocumentMenu("Export PDF…"), back: true };
      return f.export.opening
        ? done(["The preview follows your choice."])
        : todo(["Turn an opening page on or off."], { kind: "ui", id: "export-opening" });
    case "export-preview":
      if (!f.export.open) return { ...openDocumentMenu("Export PDF…"), back: true };
      return f.export.preview
        ? done(["This is what would print. You can finish here: nothing is saved or printed."], {
            kind: "ui",
            id: "export-preview",
          })
        : todo(["Choose at least one page to see it here."], { kind: "ui", id: "export-range" });
  }
}
/** Plain text of a cue, for the announcer and for tests. */
export const spoken = (say: Part[]) =>
  say
    .map((p) => (typeof p === "string" ? p : "key" in p ? p.key : "type" in p ? p.type : p.ui))
    .join("");
