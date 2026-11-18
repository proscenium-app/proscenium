// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A page before the script written as a Markdown file: what the play's Front
 * Matter folder holds, one file a page, in the binder's order.
 *
 * A file is the page's words as the prose editor writes them, under an
 * optional header that says how the page sits on its sheet:
 *
 *   ---
 *   layout: title        (title | top | third; top when there is no header)
 *   export: false        (an export starts with the page unticked)
 *   ---
 *
 * `top` starts the page at the format's section top, as every opening page
 * did; `third` starts it a third of the paper down, as a title page written
 * freely did; `title` lays it out as a title page: a third down, a level-one
 * heading in the format's title style, the format's title gap between its
 * paragraphs, and after a `<!-- proscenium:foot -->` line, a foot set at the
 * bottom of the sheet in the format's contact alignment.
 *
 * Facts stay in the script's Fountain title page, where every Fountain app
 * reads them, and a page shows them as fields: `{title}`, `{TITLE}` (in
 * capitals), `{credit}`, `{author}`, `{contact}`, `{draftDate}` and `{source}`
 * (a header or footer uses the same words: docs/app/formatting/formats-and-layout.md#FMT-101,
 * docs/app/formatting/formats-and-layout.md#FMT-140). A paragraph
 * that is `{contact}` alone prints each contact line, a blank one as a blank
 * row, as the title page's contact block always has.
 *
 * `legacyPageFiles` writes today's front matter as such files, so a play's
 * pages can move into its folder and print exactly as they did
 * (src/layout/page-files.test.ts).
 */
import type { FrontMatter } from "../fountain/model";
import type { FrontMatterSpec } from "../format/spec";
import { toMarkdown, type Node } from "../markdown/doc";
import type { FrontSheetKind, StyleRun } from "./engine";
import {
  PRODUCTION_NOTES_HEADING,
  frontPagesOf,
  type FrontBlock,
  type FrontPage,
} from "./front-pages";
import { openingParagraphs } from "./opening-prose";

/** How a page written as Markdown sits on its sheet. */
export type PageLayout = "title" | "top" | "third";

/** The line in a title page's file after which its foot begins. */
export const FOOT_MARK = "<!-- proscenium:foot -->";

/** A page file's header, read: its layout, whether an export starts with it, and its words. */
export interface PageFile {
  layout: PageLayout;
  exports: boolean;
  body: string;
}

const HEADER = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/;

/** A page file's header and words. A file with no header is a page from the section top. */
export function readPageFile(text: string): PageFile {
  const source = text.replace(/\r\n?/g, "\n");
  const header = HEADER.exec(source);
  const keys: Record<string, string> = {};
  for (const line of header?.[1]?.split("\n") ?? []) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv) keys[kv[1]!.toLowerCase()] = kv[2]!.trim();
  }
  const layout = keys.layout === "title" || keys.layout === "third" ? keys.layout : "top";
  return {
    layout,
    exports: keys.export !== "false",
    body: header ? source.slice(header[0].length).replace(/^\n+/, "") : source,
  };
}

/** A page file's text: a header only when it says something, then the words. */
export function writePageFile(
  page: { layout: PageLayout; exports?: boolean },
  body: string,
): string {
  const keys = [
    page.layout === "top" ? "" : `layout: ${page.layout}`,
    page.exports === false ? "export: false" : "",
  ].filter(Boolean);
  const words = `${body.replace(/\s+$/, "")}\n`;
  return keys.length ? `---\n${keys.join("\n")}\n---\n\n${words}` : words;
}

/** The fields a page can show, by the word it writes between braces. */
export const FIELDS = [
  "TITLE",
  "title",
  "credit",
  "author",
  "contact",
  "draftDate",
  "source",
] as const;
export type Field = (typeof FIELDS)[number];
const TOKEN = new RegExp(`\\{(${FIELDS.join("|")})\\}`, "g");
const ALONE = new RegExp(`^\\{(${FIELDS.join("|")})\\}$`);

/** What a field shows: the play's detail, as the title page's fields have always printed it. */
export function fieldValue(field: Field, fm: FrontMatter): string {
  switch (field) {
    case "TITLE":
      return (fm.title ?? "").toUpperCase();
    case "title":
      return fm.title ?? "";
    case "credit":
      return fm.credit ?? (fm.authors?.length ? "by" : "");
    case "author":
      return (fm.authors ?? []).join(", ");
    case "contact":
      return (fm.contact ?? []).join("\n");
    case "draftDate":
      return fm.draftDate ?? "";
    case "source":
      return fm.source ?? "";
  }
}

/** A paragraph's words with every field filled in, its emphasis moved to match. */
export function fillFields(
  text: string,
  runs: readonly StyleRun[],
  fm: FrontMatter,
): { text: string; runs: StyleRun[] } {
  // Stretches of the old text and where each now stands: words keep their
  // offsets one for one, a field's braces become its whole value.
  const parts: { from: number; to: number; at: number; length: number; field: boolean }[] = [];
  let out = "";
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const start = match.index ?? 0;
    if (start > last) {
      parts.push({ from: last, to: start, at: out.length, length: start - last, field: false });
      out += text.slice(last, start);
    }
    const value = fieldValue(match[1] as Field, fm);
    parts.push({
      from: start,
      to: start + match[0].length,
      at: out.length,
      length: value.length,
      field: true,
    });
    out += value;
    last = start + match[0].length;
  }
  if (!parts.length) return { text, runs: [...runs] };
  if (last < text.length) {
    parts.push({
      from: last,
      to: text.length,
      at: out.length,
      length: text.length - last,
      field: false,
    });
    out += text.slice(last);
  }
  const startOf = (pos: number) => {
    const part = parts.find((p) => pos >= p.from && pos < p.to);
    if (!part) return out.length;
    return part.field ? part.at : part.at + (pos - part.from);
  };
  const endOf = (pos: number) => {
    const part = parts.find((p) => pos > p.from && pos <= p.to);
    if (!part) return 0;
    return part.field ? part.at + part.length : part.at + (pos - part.from);
  };
  return {
    text: out,
    runs: runs
      .map((r) => ({ ...r, start: startOf(r.start), end: endOf(r.end) }))
      .filter((r) => r.end > r.start),
  };
}

/**
 * A page file as the blocks the engine lays out: its layout's gaps and styles,
 * its fields filled in from the play's details. Paragraph ids are the page's
 * id and the paragraph's place among the file's paragraphs (`${id}-3`).
 */
export function pageFromFile(
  kind: string,
  id: string,
  text: string,
  fm: FrontMatter,
  policy: FrontMatterSpec,
): FrontPage {
  const { layout, body } = readPageFile(text);
  const lines = body.split("\n");
  const at = lines.findIndex((line) => line.trim() === FOOT_MARK);
  const main = at < 0 ? body : lines.slice(0, at).join("\n");
  const foot = at < 0 ? "" : lines.slice(at + 1).join("\n");
  let index = 0;
  const read = (markdown: string, area: "main" | "foot"): FrontBlock[] => {
    const out: FrontBlock[] = [];
    // In the foot the first block with words takes no gap and every later one
    // the format's gap, as the contact block and the date under it always
    // have; a field's blank lines at its end go to the gap of what follows.
    let printed = false;
    let carried = 0;
    const between = layout === "title" ? policy.titleGapRows : policy.fieldGapRows;
    openingParagraphs(markdown).forEach((p, i) => {
      const n = index++;
      const title = layout === "title" && p.heading && p.level === 1;
      const style = {
        role: p.heading ? ("heading" as const) : ("paragraph" as const),
        align: area === "foot" && p.align === "left" ? policy.contactAlign : p.align,
        fontStyle: title
          ? policy.titleFontStyle
          : p.heading
            ? policy.headingFontStyle
            : policy.bodyFontStyle,
        keepWithNext: p.heading && !title,
        ...(title ? { titleStyle: true as const } : {}),
      };
      const gap = () =>
        area === "foot" ? (printed ? policy.fieldGapRows + carried : 0) : i ? between : 0;
      if (ALONE.exec(p.text.trim())?.[1] === "contact") {
        let blanks = 0;
        let first = true;
        for (const line of fm.contact ?? []) {
          if (!line.trim()) {
            blanks++;
            continue;
          }
          out.push({
            ...style,
            text: line,
            runs: [],
            id: `${id}-${n}`,
            gap: (first ? gap() : 0) + blanks,
          });
          printed = true;
          carried = 0;
          first = false;
          blanks = 0;
        }
        carried += blanks;
        return;
      }
      const filled = fillFields(p.text, p.runs, fm);
      // A field with no value is no paragraph at all, as a title page from its
      // fields printed no draft date when it had none; one of spaces still
      // takes its gap at the foot, as that page's did.
      if (!filled.text) return;
      out.push({ ...style, text: filled.text, runs: filled.runs, id: `${id}-${n}`, gap: gap() });
      if (filled.text.trim()) {
        printed = true;
        carried = 0;
      }
    });
    return out;
  };
  return {
    kind,
    top: layout === "top" ? "section" : "title",
    blocks: read(main, "main"),
    foot: read(foot, "foot"),
  };
}

/**
 * The pages a front matter prints: its page files, in the folder's order, when
 * the play keeps its pages as files; its fields and texts when it does not.
 * The first title page among the files is the play's title page (`title`),
 * which a click in page view opens as one; every other file is its own kind,
 * named by its file. An inline format flows them as one opening, the format's
 * gap between one page and the next.
 */
export function frontPagesFor(
  fm: FrontMatter | null | undefined,
  policy: FrontMatterSpec,
): FrontPage[] {
  if (!fm?.pages) return frontPagesOf(fm, policy);
  let titled = false;
  const pages = fm.pages.map((source): FrontPage => {
    const title = !titled && readPageFile(source.text).layout === "title";
    if (title) titled = true;
    const kind = title ? "title" : `page:${source.id}`;
    return { ...pageFromFile(kind, source.id, source.text, fm, policy), label: source.name };
  });
  if (policy.placement !== "inline") return pages;
  return [
    {
      kind: "title",
      top: "section",
      blocks: pages.flatMap((page, i) =>
        [...page.blocks, ...page.foot].map((block, j) =>
          i && !j ? { ...block, gap: policy.fieldGapRows } : block,
        ),
      ),
      foot: [],
    },
  ];
}

/** A file the folder will hold for a page today's front matter prints. */
export interface LegacyPageFile {
  kind: FrontSheetKind;
  name: string;
  text: string;
}

/** A title page from its fields, as a page file: the fields, where they always stood. */
export const TITLE_PAGE_FILE = writePageFile(
  { layout: "title" },
  [
    "<!-- proscenium:align=center -->",
    "",
    "# {TITLE}",
    "",
    "<!-- proscenium:align=center -->",
    "",
    "{credit}",
    "",
    "<!-- proscenium:align=center -->",
    "",
    "{author}",
    "",
    FOOT_MARK,
    "",
    "{contact}",
    "",
    "{draftDate}",
  ].join("\n"),
);

const centered = (node: Node): Node => ({
  ...node,
  attrs: { ...(node.attrs ?? {}), textAlign: "center" },
});
const heading = (text: string, level = 2): Node => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});

/**
 * Today's front matter as the page files that print it, in the order it
 * prints them: the title page (from its fields, or as written), the Characters
 * page (from the cast list, or as written), the opening notes (or the old
 * Setting, Time and Place fields), and the production notes. A page the play
 * does not print makes no file.
 */
export function legacyPageFiles(fm: FrontMatter | null | undefined): LegacyPageFile[] {
  if (!fm) return [];
  const files: LegacyPageFile[] = [];
  if (fm.titlePage !== undefined) {
    if (fm.titlePage.trim())
      files.push({
        kind: "title",
        name: "Title Page",
        text: writePageFile({ layout: "third" }, fm.titlePage),
      });
  } else if (fm.title?.trim())
    files.push({ kind: "title", name: "Title Page", text: TITLE_PAGE_FILE });
  const notes = fm.openingNotes;
  const notesFile = (text: string): LegacyPageFile => ({
    kind: "setting",
    name: "Opening Notes",
    text: writePageFile({ layout: "top" }, text),
  });
  if (fm.openingNotesBeforeCharacters && notes?.trim()) files.push(notesFile(notes));
  if (fm.charactersPage !== undefined) {
    if (fm.charactersPage.trim())
      files.push({
        kind: "characters",
        name: "Characters",
        text: writePageFile({ layout: "top" }, fm.charactersPage),
      });
  } else if (fm.characters?.length)
    files.push({
      kind: "characters",
      name: "Characters",
      text: writePageFile(
        { layout: "top" },
        toMarkdown({
          type: "doc",
          content: [
            centered(heading("CHARACTERS")),
            ...fm.characters.map(
              (c): Node => ({
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: c.description
                      ? `${c.name.toUpperCase()} — ${c.description}`
                      : c.name.toUpperCase(),
                  },
                ],
              }),
            ),
          ],
        }),
      ),
    });
  if (notes !== undefined) {
    if (!fm.openingNotesBeforeCharacters && notes.trim()) files.push(notesFile(notes));
  } else {
    // The fields the opening notes replaced: each label over its words, with
    // nothing between, as their sheet printed them.
    const fields = (
      [
        ["SETTING", fm.setting],
        ["TIME", fm.time],
        ["PLACE", fm.place],
      ] as const
    ).filter(([, value]) => value?.trim());
    if (fields.length)
      files.push({
        kind: "setting",
        name: "Setting",
        text: writePageFile(
          { layout: "top" },
          toMarkdown({
            type: "doc",
            content: fields.map(
              ([label, value]): Node => ({
                type: "paragraph",
                content: [
                  { type: "text", text: label, marks: [{ type: "bold" }] },
                  { type: "hardBreak" },
                  ...value!
                    .split("\n")
                    .flatMap((line, i): Node[] => [
                      ...(i ? [{ type: "hardBreak" }] : []),
                      ...(line ? [{ type: "text", text: line }] : []),
                    ]),
                ],
              }),
            ),
          }),
        ),
      });
  }
  if (
    fm.productionNotes?.trim() &&
    openingParagraphs(fm.productionNotes).some((p) => p.text.trim())
  )
    files.push({
      kind: "production",
      name: "Production Notes",
      text: writePageFile(
        { layout: "top" },
        `${toMarkdown({ type: "doc", content: [centered(heading(PRODUCTION_NOTES_HEADING))] }).replace(/\s+$/, "")}\n\n${fm.productionNotes}`,
      ),
    });
  return files;
}
