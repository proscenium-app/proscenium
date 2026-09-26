// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The guide's judgement, step by step (docs/app/preferences-and-help/tutorials.md#TUT-9): where it points,
 * what it says, when a result counts as done, and which wrong turns it names.
 * Every step of every lesson is here in each state the writer can reach.
 */
import { describe, expect, test } from "bun:test";
import { parse } from "../fountain";
import {
  coach,
  cuePairs,
  ghostRest,
  measure,
  nameLike,
  readScript,
  spoken,
  type Baseline,
  type Cue,
  type Facts,
  type ScriptFacts,
  type UiFacts,
} from "./coach";
import { LESSONS, type Task } from "./lessons";

type Line = [type: string, text?: string, marks?: number];
const S = (
  lines: Line[],
  caret: number | null = lines.length - 1,
  extra: Partial<ScriptFacts> = {},
): ScriptFacts => ({
  blocks: lines.map(([type, text = "", marks = 0]) => ({ type, text, marks })),
  caret,
  selected: null,
  storedMarks: false,
  ...extra,
});
const F = (over: Partial<Omit<Facts, "ui">> & { ui?: Partial<UiFacts> } = {}): Facts => ({
  script: S([["scene", "SCENE 1"], ["action"]]),
  view: "script",
  saved: true,
  unsaved: false,
  format: "stage-us-modern",
  cards: [{ id: "a", heading: "SCENE 1", synopsis: "" }],
  front: { charactersPage: "", characters: [], openingNotes: "" },
  documents: [],
  material: null,
  export: { open: false, range: false, rangeError: false, opening: false, preview: false },
  ...over,
  ui: {
    menu: [],
    elementMenu: false,
    sheet: null,
    focus: null,
    focusText: "",
    fields: {},
    ...over.ui,
  },
});
/** The cue for `task` in `now`, measured against `before` (by default, the same play before anything happened). */
const cue = (task: Task, now: Facts, before: Facts | Baseline = F()): Cue =>
  coach(
    task,
    now,
    "blocks" in before && typeof before.blocks === "number"
      ? (before as Baseline)
      : measure(before as Facts),
  );
const says = (c: Cue) => spoken(c.say);

const opening = S([["scene", "SCENE 1"], ["action"]]);
const named = S([["scene", "SCENE 1"], ["character", "MARA"], ["dialogue"]]);
const spokenOnce = S([
  ["scene", "SCENE 1"],
  ["character", "MARA"],
  ["dialogue", "You're early."],
  ["action"],
]);
const second = S([
  ["scene", "SCENE 1"],
  ["character", "MARA"],
  ["dialogue", "You're early."],
  ["character", "IVO"],
  ["dialogue"],
]);
const exchange = S(
  [
    ["scene", "SCENE 1"],
    ["character", "MARA"],
    ["dialogue", "You're early."],
    ["character", "IVO"],
    ["dialogue", "I was hoping you wouldn't notice."],
  ],
  2,
);

describe("reading the play", () => {
  test("a parsed script becomes blocks with their marks and line breaks", () => {
    const s = readScript(
      parse("## SCENE 1\n\nMARA\nYou're **early**.\n\nIVO\nWell,\nhello.\n").doc,
      2,
    );
    expect(s.blocks.map((b) => b.type)).toEqual([
      "scene",
      "character",
      "dialogue",
      "character",
      "dialogue",
    ]);
    expect(s.blocks[2].marks).toBe(1);
    expect(s.blocks[4].text).toBe("Well,\nhello.");
    expect(s.caret).toBe(2);
    expect(cuePairs(s.blocks)).toEqual([1, 3]);
  });
  test("a baseline counts each result the lessons look for", () => {
    expect(measure(F({ script: exchange })).finished).toBe(1);
    const b = measure(
      F({
        script: S([
          ...exchange.blocks.map((x) => [x.type, x.text, x.marks] as Line),
          ["pageBreak"],
        ]),
      }),
    );
    expect([b.cues, b.spoken, b.finished, b.pageBreaks]).toEqual([2, 2, 2, 1]);
  });
  test("a name is a word or three, without sentence punctuation", () => {
    for (const n of ["mara", "Mara", "MARA", "Old Man", "JEAN-PAUL", "Dr. Who"])
      expect(nameLike(n)).toBe(true);
    for (const n of ["The door opens.", "a b c d", "Why?", "", "  "])
      expect(nameLike(n)).toBe(false);
  });
  test("the suggestion shows only what is left to type, and disappears for the writer's own words", () => {
    expect(ghostRest("MARA", "")).toBe("MARA");
    expect(ghostRest("MARA", "ma")).toBe("RA");
    expect(ghostRest("MARA", "JUNIPER")).toBe("");
    expect(ghostRest("You're early.", "You're")).toBe(" early.");
  });
});

describe("Write Your First Exchange", () => {
  test("Name the speaker: shows where and what to type, then the key", () => {
    const c = cue("speaker", F({ script: opening }));
    expect(c.tone).toBe("do");
    expect(c.target).toEqual({ kind: "line", index: 1 });
    expect(c.ghost).toEqual({ index: 1, text: "MARA", key: "Return" });
    expect(says(c)).toBe("Type MARA, then press Return.");
    const typing = cue(
      "speaker",
      F({
        script: S([
          ["scene", "SCENE 1"],
          ["action", "MA"],
        ]),
      }),
    );
    expect(says(typing)).toBe("Now press Return.");
    expect(typing.ghost).toEqual({ index: 1, text: "RA", key: "Return" });
  });
  test("Name the speaker: any name in capitals, confirmed by Return, is done", () => {
    for (const name of ["MARA", "JUNIPER", "OLD MAN"]) {
      const c = cue(
        "speaker",
        F({ script: S([["scene", "SCENE 1"], ["character", name], ["dialogue"]]) }),
        F({ script: opening }),
      );
      expect(c.tone).toBe("done");
      expect(says(c)).toContain(name);
    }
  });
  test("Name the speaker: a lowercase name is caught while typing, with a fix", () => {
    const c = cue(
      "speaker",
      F({
        script: S([
          ["scene", "SCENE 1"],
          ["action", "Mara"],
        ]),
      }),
    );
    expect(c.tone).toBe("fix");
    expect(says(c)).toContain("MARA");
    expect(c.fix?.id).toBe("character");
  });
  test("Name the speaker: a lowercase name confirmed with Return is named where it happened", () => {
    const c = cue(
      "speaker",
      F({ script: S([["scene", "SCENE 1"], ["action", "mara"], ["action"]]) }),
      F({ script: opening }),
    );
    expect(c.tone).toBe("fix");
    expect(c.target).toEqual({ kind: "line", index: 1 });
    expect(c.fix).toEqual({ id: "cue", label: "Make It a Name", index: 1 });
    expect(says(c)).toContain("became a stage direction");
  });
  test("Name the speaker: menus opened on the way are followed to the right row", () => {
    expect(cue("speaker", F({ script: opening, ui: { elementMenu: true } })).target).toEqual({
      kind: "element",
      key: "c",
    });
    expect(
      cue(
        "speaker",
        F({ script: opening, ui: { menu: ["line-type:action", "line-type:character"] } }),
      ).target,
    ).toEqual({ kind: "menu", id: "line-type:character" });
  });
  test("Name the speaker: a cursor elsewhere is led back to the empty line", () => {
    const c = cue("speaker", F({ script: S([["scene", "SCENE 1"], ["action"]], 0) }));
    expect(c.target).toEqual({ kind: "line", index: 1 });
    expect(says(c)).toContain("Click this empty line");
  });
  test("Name the speaker: a line of another type is named and can be changed", () => {
    const c = cue(
      "speaker",
      F({
        script: S([
          ["scene", "SCENE 1"],
          ["parenthetical", "(quietly)"],
        ]),
      }),
    );
    expect(c.tone).toBe("fix");
    expect(says(c)).toContain("Parenthetical");
    expect(c.target).toEqual({ kind: "ui", id: "line-type" });
  });
  test("Name the speaker: a replay in the same play waits for a NEW cue", () => {
    const before = F({
      script: S([...exchange.blocks.map((x) => [x.type, x.text] as Line), ["action"]]),
    });
    expect(cue("speaker", before, before).tone).toBe("do");
    const after = F({
      script: S([
        ...exchange.blocks.map((x) => [x.type, x.text] as Line),
        ["character", "ROWAN"],
        ["dialogue"],
      ]),
    });
    expect(cue("speaker", after, before).tone).toBe("done");
  });

  test("Give them a line: the speech line with its suggestion, then Return", () => {
    const c = cue("line", F({ script: named }), F({ script: named }));
    expect(c.target).toEqual({ kind: "line", index: 2 });
    expect(c.ghost).toEqual({ index: 2, text: "You're early.", key: "Return" });
    expect(says(c)).toBe("Type what MARA says, then press Return.");
    const typed = cue(
      "line",
      F({
        script: S([
          ["scene", "SCENE 1"],
          ["character", "MARA"],
          ["dialogue", "Hello"],
        ]),
      }),
      F({ script: named }),
    );
    expect(says(typed)).toBe("Press Return when the line is finished.");
    expect(typed.ghost?.text).toBe("");
  });
  test("Give them a line: done after Return, whatever the words", () => {
    expect(cue("line", F({ script: spokenOnce }), F({ script: named })).tone).toBe("done");
    expect(
      cue(
        "line",
        F({
          script: S([
            ["scene", "SCENE 1"],
            ["character", "MARA"],
            ["dialogue", "Morning, all."],
            ["character"],
          ]),
        }),
        F({ script: named }),
      ).tone,
    ).toBe("done");
  });
  test("Give them a line: a speech whose type was changed gets a fix", () => {
    const c = cue(
      "line",
      F({
        script: S([
          ["scene", "SCENE 1"],
          ["character", "MARA"],
          ["action", "You're early."],
        ]),
      }),
      F({ script: named }),
    );
    expect(c.tone).toBe("fix");
    expect(c.fix).toEqual({ id: "dialogue", label: "Make It Dialogue", index: 2 });
  });
  test("Give them a line: Return on the empty speech opens a menu, and the guide says how out", () => {
    const c = cue("line", F({ script: named, ui: { elementMenu: true } }), F({ script: named }));
    expect(c.tone).toBe("fix");
    expect(says(c)).toContain("Escape");
  });
  test("Give them a line: a cursor elsewhere is shown the speech line", () => {
    const c = cue(
      "line",
      F({
        script: S(
          named.blocks.map((x) => [x.type, x.text] as Line),
          0,
        ),
      }),
      F({ script: named }),
    );
    expect(c.target).toEqual({ kind: "line", index: 2 });
    expect(says(c)).toContain("Click the line under MARA");
  });

  test("Choose the next speaker: the line-type menu first, lighting the line it will change", () => {
    const c = cue("speaker-two", F({ script: spokenOnce }), F({ script: spokenOnce }));
    expect(c.target).toEqual({ kind: "ui", id: "line-type" });
    expect(c.line).toBe(3);
    expect(says(c)).toContain("Tab");
    expect(
      cue(
        "speaker-two",
        F({ script: spokenOnce, ui: { menu: ["line-type:character"] } }),
        F({ script: spokenOnce }),
      ).target,
    ).toEqual({ kind: "menu", id: "line-type:character" });
  });
  test("Choose the next speaker: then the name, then Return", () => {
    const empty = S([
      ...spokenOnce.blocks.slice(0, 3).map((x) => [x.type, x.text] as Line),
      ["character"],
    ]);
    expect(cue("speaker-two", F({ script: empty }), F({ script: spokenOnce })).ghost).toEqual({
      index: 3,
      text: "IVO",
      key: "Return",
    });
    const typed = S([
      ...spokenOnce.blocks.slice(0, 3).map((x) => [x.type, x.text] as Line),
      ["character", "IV"],
    ]);
    expect(says(cue("speaker-two", F({ script: typed }), F({ script: spokenOnce })))).toBe(
      "Now press Return.",
    );
    expect(cue("speaker-two", F({ script: second }), F({ script: spokenOnce })).tone).toBe("done");
  });
  test("Choose the next speaker: the wrong choice in the menu is named", () => {
    const wrongType = S([
      ...spokenOnce.blocks.slice(0, 3).map((x) => [x.type, x.text] as Line),
      ["parenthetical"],
    ]);
    const c = cue("speaker-two", F({ script: wrongType }), F({ script: spokenOnce }));
    expect(c.tone).toBe("fix");
    expect(says(c)).toContain("This line is Parenthetical");
    expect(c.fix?.id).toBe("character");
  });

  test("Write the reply: its line, a suggestion without a key, done on any words", () => {
    const c = cue("reply", F({ script: second }), F({ script: second }));
    expect(c.target).toEqual({ kind: "line", index: 4 });
    expect(c.ghost).toEqual({
      index: 4,
      text: "I was hoping you wouldn't notice.",
      key: undefined,
    });
    expect(says(c)).toContain("IVO's reply");
    expect(
      cue(
        "reply",
        F({
          script: S([
            ...second.blocks.slice(0, 4).map((x) => [x.type, x.text] as Line),
            ["dialogue", "Hi."],
          ]),
        }),
        F({ script: second }),
      ).tone,
    ).toBe("done");
  });

  test("See that it's saved: waits for a real save and names a failed one", () => {
    expect(cue("saved", F({ saved: false })).tone).toBe("do");
    expect(cue("saved", F({ saved: true })).tone).toBe("done");
    const failed = cue("saved", F({ saved: false, unsaved: true }));
    expect(failed.tone).toBe("fix");
    expect(failed.target).toEqual({ kind: "ui", id: "save-status" });
  });
});

describe("Format the Script", () => {
  const play = F({ script: exchange });
  test("Emphasize a phrase: select, then Bold", () => {
    expect(cue("emphasis", play, play).target).toEqual({ kind: "line", index: 2 });
    const selected = F({ script: { ...exchange, selected: "dialogue" } });
    expect(cue("emphasis", selected, play).target).toEqual({ kind: "ui", id: "bold" });
    expect(cue("emphasis", F({ script: { ...exchange, selected: "character" } }), play).tone).toBe(
      "fix",
    );
    expect(cue("emphasis", F({ script: { ...exchange, storedMarks: true } }), play).tone).toBe(
      "fix",
    );
    const bold = S(
      exchange.blocks.map((x, i) => [x.type, x.text, i === 2 ? 1 : 0] as Line),
      2,
    );
    expect(cue("emphasis", F({ script: bold }), play).tone).toBe("done");
  });
  test("Stay in the same speech: Line Break, not Return", () => {
    expect(cue("line-break", play, play).target).toEqual({ kind: "ui", id: "line-break" });
    expect(cue("line-break", F({ script: { ...exchange, caret: 0 } }), play).target).toEqual({
      kind: "line",
      index: 2,
    });
    const split = F({
      script: S([...exchange.blocks.map((x) => [x.type, x.text] as Line), ["action"]]),
    });
    const c = cue("line-break", split, play);
    expect(c.tone).toBe("fix");
    expect(c.fix?.id).toBe("undo");
    const broken = S(
      exchange.blocks.map((x, i) => [x.type, i === 2 ? "You're early.\nCome in." : x.text] as Line),
      2,
    );
    expect(cue("line-break", F({ script: broken }), play).tone).toBe("done");
  });
  test("Start a new page", () => {
    expect(cue("page-break", play, play).target).toEqual({ kind: "ui", id: "page-break" });
    expect(
      cue(
        "page-break",
        F({
          script: S([
            ...exchange.blocks.map((x) => [x.type, x.text] as Line),
            ["pageBreak"],
            ["action"],
          ]),
        }),
        play,
      ).tone,
    ).toBe("done");
  });
  test("Choose a format: the menu, a different row, done", () => {
    expect(cue("format", play, play).target).toEqual({ kind: "ui", id: "document-menu" });
    expect(
      cue("format", F({ ui: { menu: ["format:stage-us-modern", "format:dg-modern"] } }), play)
        .target,
    ).toEqual({ kind: "menu", id: "format:other" });
    expect(cue("format", F({ format: "dg-modern" }), play).tone).toBe("done");
  });
});

describe("Arrange Scenes on the Board", () => {
  const two = [
    { id: "a", heading: "SCENE 1", synopsis: "" },
    { id: "b", heading: "SCENE 2", synopsis: "" },
  ];
  const board = F({ view: "corkboard", cards: two });
  test("Open the Board", () => {
    expect(cue("board", F()).target).toEqual({ kind: "view", view: "corkboard" });
    expect(cue("board", board).tone).toBe("done");
  });
  test("Add a scene: led back to the Board, then New Scene, then done", () => {
    expect(cue("scene", F({ cards: two }), board).back).toBe(true);
    expect(cue("scene", board, board).target).toEqual({ kind: "ui", id: "new-scene" });
    expect(
      cue(
        "scene",
        F({ view: "corkboard", cards: [...two, { id: "c", heading: "SCENE 3", synopsis: "" }] }),
        board,
      ).tone,
    ).toBe("done");
  });
  test("Describe a scene: the newest card's summary, then click away", () => {
    expect(cue("summary", board, board).target).toEqual({
      kind: "ui",
      id: "scene-summary",
      card: 1,
    });
    expect(
      says(
        cue(
          "summary",
          F({
            view: "corkboard",
            cards: two,
            ui: { focus: "scene-summary", focusText: "They meet." },
          }),
          board,
        ),
      ),
    ).toContain("Click outside");
    expect(
      cue(
        "summary",
        F({ view: "corkboard", cards: [two[0], { ...two[1], synopsis: "They meet." }] }),
        board,
      ).tone,
    ).toBe("done");
  });
  test("Change the order: the last card's Move Earlier, and any change of order counts", () => {
    expect(cue("move-scene", board, board).target).toEqual({
      kind: "ui",
      id: "scene-move",
      card: 1,
    });
    expect(cue("move-scene", F({ view: "corkboard", cards: [two[1], two[0]] }), board).tone).toBe(
      "done",
    );
    expect(
      cue(
        "move-scene",
        F({ view: "corkboard", cards: [two[0]] }),
        F({ view: "corkboard", cards: [two[0]] }),
      ).target,
    ).toEqual({ kind: "ui", id: "new-scene" });
  });
  test("Compare the Outline", () => {
    expect(cue("outline", board).target).toEqual({ kind: "view", view: "outliner" });
    expect(cue("outline", F({ view: "outliner" })).tone).toBe("done");
  });
});

describe("Characters and Opening Pages", () => {
  const cast = F({
    view: "cast",
    front: { charactersPage: "", characters: ["MARA", "IVO"], openingNotes: "" },
  });
  test("Open Cast", () => {
    expect(cue("cast", F()).target).toEqual({ kind: "view", view: "cast" });
    expect(cue("cast", cast).tone).toBe("done");
  });
  test("Make the printed page yours", () => {
    expect(cue("characters-page", cast, cast).target).toEqual({
      kind: "ui",
      id: "characters-page",
    });
    expect(cue("characters-page", F({ front: cast.front }), cast).back).toBe(true);
    expect(
      cue(
        "characters-page",
        F({
          view: "cast",
          front: { ...cast.front, charactersPage: "# Characters\n\nMARA, early.\n" },
        }),
        cast,
      ).tone,
    ).toBe("done");
  });
  test("Add someone to the cast: an empty row does not count", () => {
    expect(cue("add-character", cast, cast).target).toEqual({ kind: "ui", id: "add-character" });
    const row = F({
      view: "cast",
      front: { ...cast.front, characters: ["MARA", "IVO", ""] },
      ui: { focus: "character-name", focusText: "" },
    });
    expect(cue("add-character", row, cast).tone).toBe("do");
    expect(says(cue("add-character", row, cast))).toContain("ROWAN");
    const done = cue(
      "add-character",
      F({ view: "cast", front: { ...cast.front, characters: ["MARA", "IVO", "ROWAN"] } }),
      cast,
    );
    expect(done.tone).toBe("done");
    expect(says(done)).toContain("ROWAN");
  });
  test("Write opening notes: menu, item, the notes, Save", () => {
    expect(cue("opening-notes", cast, cast).target).toEqual({ kind: "ui", id: "document-menu" });
    expect(
      cue("opening-notes", F({ ui: { menu: ["opening-pages", "export-pdf"] } }), cast).target,
    ).toEqual({ kind: "menu", id: "opening-pages" });
    expect(
      cue(
        "opening-notes",
        F({ ui: { sheet: "opening-pages", fields: { "opening-notes": "" } } }),
        cast,
      ).target,
    ).toEqual({ kind: "ui", id: "opening-notes" });
    expect(
      cue(
        "opening-notes",
        F({ ui: { sheet: "opening-pages", fields: { "opening-notes": "A kitchen." } } }),
        cast,
      ).target,
    ).toEqual({ kind: "ui", id: "opening-save" });
    expect(
      cue("opening-notes", F({ front: { ...cast.front, openingNotes: "A kitchen." } }), cast).tone,
    ).toBe("done");
  });
});

describe("Organize Files and Tags", () => {
  const doc = { id: "d", name: "Untitled", text: "", tags: [] as string[] };
  const open = F({ view: null, documents: ["d"], material: doc });
  test("Create a document", () => {
    expect(cue("document", F(), F()).target).toEqual({ kind: "ui", id: "binder-new" });
    expect(cue("document", F({ ui: { menu: ["new:document", "new:character"] } })).target).toEqual({
      kind: "menu",
      id: "new:document",
    });
    expect(cue("document", F({ documents: ["d"] }), F()).tone).toBe("done");
  });
  test("Write a note", () => {
    expect(cue("note", open, open).target).toEqual({ kind: "ui", id: "material-page" });
    const away = cue("note", F({ documents: ["d"] }), open);
    expect(away.back).toBe(true);
    expect(away.target).toEqual({ kind: "ui", id: "material-page" });
    expect(
      cue("note", F({ view: null, documents: ["d"], material: { ...doc, text: "Rain." } }), open)
        .tone,
    ).toBe("done");
  });
  test("Add a tag", () => {
    expect(cue("tags", open, open).target).toEqual({ kind: "ui", id: "material-tags" });
    expect(
      cue("tags", F({ view: null, material: doc, ui: { fields: { "tag-field": "" } } }), open)
        .target,
    ).toEqual({ kind: "ui", id: "tag-field" });
    expect(
      cue("tags", F({ view: null, material: doc, ui: { fields: { "tag-field": "rain" } } }), open)
        .target,
    ).toEqual({ kind: "ui", id: "add-tag" });
    expect(cue("tags", F({ view: null, material: { ...doc, tags: ["rain"] } }), open).tone).toBe(
      "done",
    );
  });
  test("Name the document: another Untitled does not count", () => {
    expect(cue("rename", open, open).target).toEqual({ kind: "ui", id: "material-name" });
    expect(
      cue("rename", F({ view: null, material: { ...doc, name: "Untitled 2" } }), open).tone,
    ).toBe("do");
    expect(
      cue("rename", F({ view: null, material: { ...doc, name: "Rehearsal Notes" } }), open).tone,
    ).toBe("done");
  });
});

describe("Prepare a PDF or Print", () => {
  const sheet = F({
    export: { open: true, range: false, rangeError: false, opening: false, preview: true },
  });
  test("Open the preview", () => {
    expect(cue("export", F()).target).toEqual({ kind: "ui", id: "document-menu" });
    expect(cue("export", F({ ui: { menu: ["export-pdf"] } })).target).toEqual({
      kind: "menu",
      id: "export-pdf",
    });
    expect(cue("export", sheet).tone).toBe("done");
  });
  test("Choose the pages, with a wrong page named", () => {
    expect(cue("export-range", F()).back).toBe(true);
    expect(cue("export-range", sheet).target).toEqual({ kind: "ui", id: "export-range" });
    expect(cue("export-range", F({ export: { ...sheet.export, rangeError: true } })).tone).toBe(
      "fix",
    );
    expect(cue("export-range", F({ export: { ...sheet.export, range: true } })).tone).toBe("done");
  });
  test("Choose opening sheets", () => {
    expect(cue("export-opening", sheet).target).toEqual({ kind: "ui", id: "export-opening" });
    expect(cue("export-opening", F({ export: { ...sheet.export, opening: true } })).tone).toBe(
      "done",
    );
  });
  test("Review the result: a look, finished at the preview", () => {
    const c = cue("export-preview", sheet);
    expect(c.tone).toBe("done");
    expect(c.target).toEqual({ kind: "ui", id: "export-preview" });
    expect(cue("export-preview", F({ export: { ...sheet.export, preview: false } })).tone).toBe(
      "do",
    );
  });
});

test("every step of every lesson has something to say, and a done state it can reach", () => {
  const seen = new Set<string>();
  for (const l of LESSONS)
    for (const s of l.steps) {
      expect(seen.has(s.id)).toBe(false);
      seen.add(s.id);
      expect(s.help.length).toBeGreaterThan(30);
      const c = cue(s.id, F({ script: exchange }), F({ script: exchange }));
      expect(says(c).length).toBeGreaterThan(4);
      expect(["do", "fix", "done"]).toContain(c.tone);
    }
  expect(seen.size).toBe(26);
});
test("no cue grades the writer's words: other names and speeches count the same", () => {
  const theirs = S([["scene", "SCENE 1"], ["character", "Z"], ["dialogue", "…"], ["action"]]);
  expect(
    cue(
      "line",
      F({ script: theirs }),
      F({ script: S([["scene", "SCENE 1"], ["character", "Z"], ["dialogue"]]) }),
    ).tone,
  ).toBe("done");
});
