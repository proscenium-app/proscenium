// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The course (docs/app/preferences-and-help/tutorials.md#TUT-D5, docs/app/preferences-and-help/tutorials.md#TUT-10): six lessons that write ONE practice
 * play, in this order. Each lesson begins where the one before it left that
 * play, so the list is a sequence and not a menu of separate exercises. A
 * lesson opened out of order is still whole: the controller supplies what
 * the earlier lessons would have left there, in the same play, and never by
 * removing anything the writer wrote.
 *
 * Nothing here says what to show or when a step is done. That is coach.ts,
 * which reads the actual state of the play and the window.
 */
export type Task =
  | "speaker"
  | "line"
  | "speaker-two"
  | "reply"
  | "saved"
  | "emphasis"
  | "line-break"
  | "page-break"
  | "format"
  | "board"
  | "scene"
  | "summary"
  | "move-scene"
  | "outline"
  | "cast"
  | "characters-page"
  | "add-character"
  | "opening-notes"
  | "document"
  | "note"
  | "tags"
  | "rename"
  | "export"
  | "export-range"
  | "export-opening"
  | "export-preview";
export type Area = "script" | "corkboard" | "outliner" | "cast" | "document" | "export";

export interface Step {
  id: Task;
  title: string;
  /** More Help: the longer explanation, shown in the card only when asked for. */
  help: string;
  area: Area;
  /** An observe step: its result is there to be seen, so the writer moves on with Next or Finish. */
  look?: boolean;
  /** How long a result must hold, unchanged, before the guide moves on (ms). */
  settle?: number;
  /** The result may still be growing (a speech being typed): wait for a pause in the typing. */
  idle?: boolean;
  /** Later steps build on this result, so Skip performs it rather than leaving a hole. */
  carries?: boolean;
}
export interface Lesson {
  id: string;
  revision: number;
  title: string;
  outcome: string;
  minutes: number;
  steps: Step[];
  /** A lesson that works on a speech needs one; opened first, it gets the bundled exchange. */
  needsExchange?: boolean;
}

/** The practice play every lesson writes, as it is before the first lesson. */
export const COURSE_SEED = "Title: Practice Play\n\n## SCENE 1\n\n";
/** Bundled teaching text: what the first lesson suggests, and what a later lesson supplies when opened first. */
export const EXAMPLE = {
  first: "MARA",
  line: "You're early.",
  second: "IVO",
  reply: "I was hoping you wouldn't notice.",
  more: "Come in.",
  summary: "A friend arrives earlier than expected.",
  character: "ROWAN",
  notes: "A quiet room. Early morning. Rain at the window.",
  note: "Remember the sound of the rain.",
  tag: "rehearsal",
  name: "Rehearsal Notes",
} as const;

const step = (
  id: Task,
  title: string,
  area: Area,
  help: string,
  extra: Partial<Step> = {},
): Step => ({ id, title, area, help, ...extra });

export const LESSONS: Lesson[] = [
  {
    id: "first-exchange",
    revision: 2,
    minutes: 3,
    title: "Write Your First Exchange",
    outcome: "Name two speakers and give each a line. The page formats as you write.",
    steps: [
      step(
        "speaker",
        "Name the speaker",
        "script",
        "A name typed in capitals becomes a character cue when you press Return, and the next line is ready for their words. You can also choose Character from the line-type menu above the page first. Any name works.",
        { carries: true },
      ),
      step(
        "line",
        "Give them a line",
        "script",
        "Type what they say. The words wrap at the edge of the page by themselves; Return finishes the speech and starts the next line.",
        { carries: true },
      ),
      step(
        "speaker-two",
        "Choose the next speaker",
        "script",
        "The line-type menu above the page shows what the current line is. Choose Character there, or press Tab on the empty line for the same list.",
        { carries: true },
      ),
      step(
        "reply",
        "Write the reply",
        "script",
        "Any words count. You don't need to press Return at the end.",
        { idle: true, settle: 1600 },
      ),
      step(
        "saved",
        "See that it's saved",
        "script",
        "Proscenium saves as you write. This says Saved once your words have reached the file. If a save needs attention, its warning stays until it is resolved.",
        { look: true },
      ),
    ],
  },
  {
    id: "format",
    revision: 2,
    minutes: 3,
    needsExchange: true,
    title: "Format the Script",
    outcome:
      "Emphasize words, keep a speech going on a new line, start a new page and try another format.",
    steps: [
      step(
        "emphasis",
        "Emphasize a phrase",
        "script",
        "Drag across the words, or hold Shift and use the arrow keys. Bold, Italic and Underline are also ⌘B, ⌘I and ⌘U. A character's name is styled by the format, not by hand.",
      ),
      step(
        "line-break",
        "Stay in the same speech",
        "script",
        "Line Break moves down a line inside the same speech. Return would start a new part of the script instead. Shift–Return is the shortcut.",
      ),
      step(
        "page-break",
        "Start a new page",
        "script",
        "A page break makes what follows start on a fresh page. It goes after the line the cursor is in. ⌘Return is the shortcut.",
      ),
      step(
        "format",
        "Choose a format",
        "script",
        "A format decides how the page is laid out and printed. Changing it keeps every word. All Formats in the same menu has the rest.",
      ),
    ],
  },
  {
    id: "scene-cards",
    revision: 2,
    minutes: 3,
    title: "Arrange Scenes on the Board",
    outcome:
      "Add a scene, describe it and change the order, then see the same scenes as an outline.",
    steps: [
      step(
        "board",
        "Open the Board",
        "corkboard",
        "Each card on the Board is one scene of the script, in the script's order.",
      ),
      step(
        "scene",
        "Add a scene",
        "corkboard",
        "New Scene adds a scene heading to the end of the script and a card for it here.",
        { carries: true },
      ),
      step(
        "summary",
        "Describe a scene",
        "corkboard",
        "A summary says what happens. It is for you and is not printed. Details on the card holds separate notes and a label.",
      ),
      step(
        "move-scene",
        "Change the order",
        "corkboard",
        "Moving a card moves that scene's words in the script too. The arrows work from the keyboard; the card can also be dragged.",
      ),
      step(
        "outline",
        "Compare the Outline",
        "outliner",
        "The Outline lists the same scenes in the same order, with room for summaries and notes.",
      ),
    ],
  },
  {
    id: "characters",
    revision: 2,
    minutes: 3,
    needsExchange: true,
    title: "Characters and Opening Pages",
    outcome:
      "Make the printed Characters page your own, add someone to the cast and write opening notes.",
    steps: [
      step(
        "cast",
        "Open Cast",
        "cast",
        "Cast has the printed Characters page at the top and the cast tools below it.",
      ),
      step(
        "characters-page",
        "Make the printed page yours",
        "cast",
        "You can change the page's words, order and emphasis. Once you have, changes to the cast list no longer replace your wording.",
      ),
      step(
        "add-character",
        "Add someone to the cast",
        "cast",
        "Type any name. Move Up and Move Down change the order; Add Notes opens a private document about them.",
      ),
      step(
        "opening-notes",
        "Write opening notes",
        "script",
        "Opening notes hold the setting, a time, a place or a dedication. You choose whether they print before or after the Characters page. Cancel closes the window without saving.",
      ),
    ],
  },
  {
    id: "files",
    revision: 2,
    minutes: 3,
    title: "Organize Files and Tags",
    outcome: "Add a document to the play, write in it, tag it and name it.",
    steps: [
      step(
        "document",
        "Create a document",
        "document",
        "The list on the left is the Binder: the script, notes and folders. A new document opens beside the script, ready for words.",
        { carries: true },
      ),
      step(
        "note",
        "Write a note",
        "document",
        "A document is prose, separate from the script. It saves as you type and has its own headings and emphasis.",
      ),
      step(
        "tags",
        "Add a tag",
        "document",
        "Tags are your own labels. Remove one with the × that appears while you edit tags.",
      ),
      step(
        "rename",
        "Name the document",
        "document",
        "The name above the page is the file's name. Renaming keeps its words and tags. The Binder's row menu can rename it too.",
      ),
    ],
  },
  {
    id: "export",
    revision: 2,
    minutes: 3,
    needsExchange: true,
    title: "Prepare a PDF or Print",
    outcome:
      "Choose pages and opening sheets, then look at the real preview. Saving or printing is up to you.",
    steps: [
      step(
        "export",
        "Open the preview",
        "export",
        "Opening the preview makes no file and prints nothing.",
      ),
      step(
        "export-range",
        "Choose the pages",
        "export",
        "Page numbers count script pages, not the opening sheets. A range such as 1–2 works too.",
      ),
      step(
        "export-opening",
        "Choose opening sheets",
        "export",
        "The title page and the Characters page are chosen apart from the script pages. The preview follows.",
      ),
      step(
        "export-preview",
        "Review the result",
        "export",
        "Export PDF… opens the Mac's Save window and Print… its Print window; Cancel in either comes back here. Neither happens unless you choose it.",
        { look: true },
      ),
    ],
  },
];

export const lessonById = (id: string | undefined) => LESSONS.find((l) => l.id === id) ?? null;
/** The lesson after this one in the course, if any. */
export const nextLesson = (id: string) =>
  LESSONS[LESSONS.findIndex((l) => l.id === id) + 1] ?? null;
