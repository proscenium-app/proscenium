// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The scaffolds a new page before or after the script starts from: the
 * choices of Add Page. A scaffold writes a whole page file
 * (src/layout/page-files.ts) once and lets go. Nothing is generated later and
 * nothing is kept in step with the play, so the page is the writer's from its
 * first keystroke.
 *
 * Each scaffold says where its page usually goes, before the script or after
 * it (docs/app/formatting/formats-and-layout.md#FMT-174), which is how Add
 * Page lists them; the writer may put any of them on the other side, but for
 * the title page, which is the play's first.
 *
 * A page is written as the prose editor writes its words (`toMarkdown`): a
 * centered heading over the page, and on a characters page one paragraph a
 * character with the name in bold, the shape a Characters page has always
 * printed and the shape Cast reads names from. The play's facts are fields
 * (`{TITLE}`, `{author}`), so a title page shows the play's own.
 *
 * A line waiting for words keeps how it is set: a dedication's line is
 * centered before anything is typed on it, and an epigraph's source stands at
 * the right (src/markdown/doc.ts writes a page's empty paragraph that is
 * centered or at the right as a comment of its own). An empty line with no
 * alignment is not in a file at all.
 *
 * `landsAt` says where a new page goes among a play's pages, in the order
 * published plays print them; the writer can drag it anywhere after.
 */
import type { FrontMatter } from "../fountain/model";
import type { FormatSpec } from "../format/spec";
import { toMarkdown, type Node } from "../markdown/doc";
import { layoutFrontPages, type FrontMatterPage } from "./engine";
import { PRODUCTION_NOTES_HEADING } from "./front-pages";
import {
  TITLE_PAGE_FILE,
  frontPagesFor,
  readPageFile,
  writePageFile,
  type PageLayout,
} from "./page-files";

/** What the app knows when a page is made. */
export interface ScaffoldContext {
  /** The play's character names, in the order they first enter. */
  speakers: readonly string[];
}

/** Which side of the script a page prints on. */
export type ScaffoldSide = "front" | "back";

/** Where a scaffold's page usually goes: before the script, after it, or either as readily. */
export type ScaffoldPlace = ScaffoldSide | "either";

export type ScaffoldId =
  | "title-page"
  | "characters-setting"
  | "characters"
  | "note-on-text"
  | "setting"
  | "dedication"
  | "epigraph"
  | "authors-note"
  | "production-notes"
  | "production-history"
  | "musical-numbers"
  | "about-the-author"
  | "acknowledgments"
  | "glossary"
  | "blank";

export interface Scaffold {
  id: ScaffoldId;
  /** Add Page's name for it, and the name its page is given (`pageName`). */
  name: string;
  place: ScaffoldPlace;
  /** What the page is for, in a sentence. */
  description: string;
  /** The whole page file it starts. */
  text(ctx: ScaffoldContext): string;
  /**
   * The page as Add Page pictures it, where the page it starts has no words
   * to picture yet: the same page with a line of what goes on it. Absent, the
   * page it starts is its own picture.
   */
  picture?(ctx: ScaffoldContext): string;
}

/** Add Page's groups, in the order it lists them. */
export const SCAFFOLD_PLACES: readonly { id: ScaffoldPlace; label: string }[] = [
  { id: "front", label: "Before the script" },
  { id: "back", label: "After the script" },
  { id: "either", label: "Either" },
];

const heading = (text: string): Node => ({
  type: "heading",
  attrs: { level: 2, textAlign: "center" },
  content: [{ type: "text", text }],
});

/** A line waiting for words, set as its words will be. */
const empty = (align: "center" | "right" | null = null): Node => ({
  type: "paragraph",
  ...(align ? { attrs: { textAlign: align } } : {}),
});

/** A line of words, for a picture of a page that has none yet. */
const line = (text: string, align: "center" | "right" | null = null, italic = false): Node => ({
  type: "paragraph",
  ...(align ? { attrs: { textAlign: align } } : {}),
  content: [{ type: "text", text, ...(italic ? { marks: [{ type: "italic" }] } : {}) }],
});

/** Each speaker once, in order, with the name in bold. */
function cast(speakers: readonly string[]): Node[] {
  const seen = new Set<string>();
  const out: Node[] = [];
  for (const speaker of speakers) {
    const name = speaker.trim();
    const key = name.toUpperCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push({
      type: "paragraph",
      content: [{ type: "text", text: name, marks: [{ type: "bold" }] }],
    });
  }
  return out;
}

function page(layout: PageLayout, blocks: Node[], exports = true): string {
  return writePageFile(
    { layout, exports },
    toMarkdown({ type: "doc", content: blocks }, { emptyLines: true }),
  );
}

/** A page with nothing on it, and what an id no scaffold has stands for. */
const BLANK: Scaffold = {
  id: "blank",
  name: "Blank Page",
  place: "either",
  description: "A page with nothing on it, for anything else.",
  text: () => page("top", []),
};

/** A page under a heading: the heading alone, pictured with what goes under it. */
function headed(
  id: ScaffoldId,
  name: string,
  place: ScaffoldPlace,
  description: string,
  title: string,
  sample: string,
  exports = true,
): Scaffold {
  return {
    id,
    name,
    place,
    description,
    text: () => page("top", [heading(title)], exports),
    picture: () => page("top", [heading(title), line(sample)]),
  };
}

/** Every scaffold, in Add Page's order: by where its page goes, then as a play prints them. */
export const SCAFFOLDS: readonly Scaffold[] = [
  {
    id: "title-page",
    name: "Title Page",
    place: "front",
    description:
      "The play's title, credit and author, with the contact and draft date at the bottom.",
    text: () => TITLE_PAGE_FILE,
  },
  {
    id: "dedication",
    name: "Dedication",
    place: "front",
    description: "Whom the play is for, a third of the way down the page.",
    text: () => page("third", [empty("center")]),
    picture: () => page("third", [line("For someone", "center")]),
  },
  {
    id: "epigraph",
    name: "Epigraph",
    place: "front",
    description: "A quotation and its source, a third of the way down the page.",
    text: () => page("third", [empty("center"), empty("right")]),
    picture: () =>
      page("third", [
        line("A line you want before the play", "center", true),
        line("Its source", "right"),
      ]),
  },
  {
    id: "characters",
    name: "Characters",
    place: "front",
    description: "The characters, in the order they first enter.",
    text: ({ speakers }) => page("top", [heading("CHARACTERS"), ...cast(speakers)]),
    picture: ({ speakers }) =>
      page("top", [
        heading("CHARACTERS"),
        ...(speakers.length
          ? cast(speakers)
          : [line("Each character, with a few words about them")]),
      ]),
  },
  {
    id: "characters-setting",
    name: "Characters & Setting",
    place: "front",
    description:
      "The characters, then where and when the play happens, on one page, as most submissions ask.",
    text: ({ speakers }) =>
      page("top", [heading("CHARACTERS"), ...cast(speakers), heading("SETTING"), empty()]),
    picture: ({ speakers }) =>
      page("top", [
        heading("CHARACTERS"),
        ...(speakers.length
          ? cast(speakers)
          : [line("Each character, with a few words about them")]),
        heading("SETTING"),
        line("Where and when the play happens"),
      ]),
  },
  headed(
    "setting",
    "Setting",
    "front",
    "Where and when the play happens.",
    "SETTING",
    "Where and when the play happens",
  ),
  headed(
    "note-on-text",
    "A Note on the Text",
    "front",
    "How the script is to be read: its pauses, overlaps and marks.",
    "A NOTE ON THE TEXT",
    "How the script is to be read: its pauses, overlaps and marks",
  ),
  headed(
    "musical-numbers",
    "Musical Numbers",
    "front",
    "The songs, in the order they are sung.",
    "MUSICAL NUMBERS",
    "The songs, in the order they are sung",
  ),
  headed(
    "production-notes",
    "Production Notes",
    "back",
    "Casting, doubling and staging, for a company. An export leaves it out until it is ticked.",
    PRODUCTION_NOTES_HEADING,
    "Casting, doubling and staging, for a company",
    false,
  ),
  headed(
    "production-history",
    "Production History",
    "back",
    "Where and when the play has been produced or read, and by whom.",
    "PRODUCTION HISTORY",
    "Where and when the play has been produced or read, and by whom",
  ),
  headed(
    "authors-note",
    "Author's Note",
    "back",
    "A word from the author to whoever reads the play.",
    "AUTHOR'S NOTE",
    "A word from the author to whoever reads the play",
  ),
  headed(
    "about-the-author",
    "About the Author",
    "back",
    "A short biography. An anonymous copy cannot know to leave it out, so untick it there.",
    "ABOUT THE AUTHOR",
    "A short biography",
  ),
  headed(
    "acknowledgments",
    "Acknowledgments",
    "back",
    "The people and places the play owes something to.",
    "ACKNOWLEDGMENTS",
    "The people and places the play owes something to",
  ),
  headed(
    "glossary",
    "Glossary",
    "back",
    "Words a reader may not know, and how names are said.",
    "GLOSSARY",
    "Words a reader may not know, and how names are said",
  ),
  BLANK,
];

/** The scaffold with this id, if there is one. */
export function scaffoldById(id: string): Scaffold | undefined {
  return SCAFFOLDS.find((scaffold) => scaffold.id === id);
}

/**
 * Where each page stands by convention, earliest first: the title page; then
 * a dedication, an epigraph and the production history; the characters; the
 * setting; a note on the text; and everything else after them.
 */
const RANK: Record<ScaffoldId, number> = {
  "title-page": 0,
  dedication: 1,
  epigraph: 2,
  "production-history": 3,
  "characters-setting": 4,
  characters: 4,
  setting: 5,
  "note-on-text": 6,
  "authors-note": 7,
  "production-notes": 7,
  "musical-numbers": 7,
  "about-the-author": 7,
  acknowledgments: 7,
  glossary: 7,
  blank: 7,
};

/** Where a page already in the play stands by convention, read from its layout and its name. */
function rankOf(page: { name: string; layout: PageLayout }): number {
  const name = page.name.toLowerCase();
  if (page.layout === "title" || /\btitle page\b/.test(name)) return RANK["title-page"];
  if (/\bdedication\b/.test(name)) return RANK.dedication;
  if (/\bepigraph\b/.test(name)) return RANK.epigraph;
  if (/\bproduction history\b/.test(name)) return RANK["production-history"];
  if (/\bcharacters?\b|\bdramatis personae\b/.test(name)) return RANK.characters;
  if (/\bsetting\b/.test(name)) return RANK.setting;
  if (/\bnote on the text\b/.test(name)) return RANK["note-on-text"];
  return RANK.blank;
}

/**
 * The place a new page from this scaffold takes among the play's pages: right
 * after the last page convention puts at or before its own place, or first
 * when there is none. So a title page goes first (after a title page already
 * there), a dedication right after the title page, the characters after
 * those, the setting after a page that names the characters, and an author's
 * note last. An id no scaffold has is a blank page, which goes last.
 */
export function landsAt(
  scaffoldId: string,
  existing: readonly { name: string; layout: PageLayout }[],
): number {
  const rank = RANK[(scaffoldById(scaffoldId) ?? BLANK).id];
  let at = 0;
  existing.forEach((page, i) => {
    if (rankOf(page) <= rank) at = i + 1;
  });
  return at;
}

/**
 * The name a new page from this scaffold takes: the scaffold's, or with " 2",
 * " 3" after it when a page already has that name (in any case, as a file
 * system that ignores case would see it).
 */
export function pageName(scaffoldId: string, existingNames: readonly string[]): string {
  const base = (scaffoldById(scaffoldId) ?? BLANK).name;
  const taken = new Set(existingNames.map((name) => name.trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`.toLowerCase())) n++;
  return `${base} ${n}`;
}

/**
 * Which side of the script a scaffold's page goes on when nothing says
 * otherwise: its own place, and before the script for one that goes either
 * way as readily.
 */
export function sideOf(scaffold: Scaffold): ScaffoldSide {
  return scaffold.place === "back" ? "back" : "front";
}

/**
 * The page a play already has that a scaffold would make again: its title
 * page for the Title Page (a page laid out as one, whatever it is called),
 * and a page of the scaffold's own name for any other. Add Page marks these,
 * and shows the title page a play has in place of making a second.
 */
export function pageAlready(
  scaffold: Scaffold,
  pages: readonly { id: string; name: string; text: string }[],
): { id: string; name: string } | null {
  if (scaffold.id === "blank") return null;
  const wanted = scaffold.name.trim().toLowerCase();
  const found =
    scaffold.id === "title-page"
      ? pages.find(
          (p) => readPageFile(p.text).layout === "title" || p.name.trim().toLowerCase() === wanted,
        )
      : pages.find((p) => p.name.trim().toLowerCase() === wanted);
  return found ? { id: found.id, name: found.name } : null;
}

/**
 * The first sheet a scaffold's page prints in a format, with the play's
 * details in its fields, laid out by the engine as the play's own pages are:
 * Add Page's picture of it. Null when the page prints nothing.
 */
export function scaffoldSheet(
  scaffold: Scaffold,
  ctx: ScaffoldContext,
  details: FrontMatter | null | undefined,
  spec: FormatSpec,
): FrontMatterPage | null {
  const pages = frontPagesFor(
    {
      ...details,
      pages: [
        {
          id: scaffold.id,
          name: scaffold.name,
          text: (scaffold.picture ?? scaffold.text)(ctx),
        },
      ],
    },
    spec.frontMatter,
  );
  return layoutFrontPages(pages, spec)[0] ?? null;
}
