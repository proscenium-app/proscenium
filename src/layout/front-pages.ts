// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The pages before the script, as a list of pages of blocks
 * (docs/app/formatting/formats-and-layout.md#EDIT-D103).
 *
 * What a play's front matter holds becomes pages here, and nothing else: which
 * pages, in what order, and which paragraphs each prints, with the format's
 * gaps, styles and alignment already chosen. Where those paragraphs land on
 * the sheet is the engine's alone (`layoutFrontPages`, src/layout/engine.ts),
 * one loop for every page, so a page a writer adds is laid out by the same
 * rules as the title page.
 *
 * `frontPagesOf` reads today's front matter: the title page from its fields or
 * written freely, the Characters page from the cast list or written freely,
 * the opening notes (or the Setting, Time and Place fields they replaced) and
 * the production notes, in the order and the shape each has always printed.
 * Each block keeps the paragraph id the editor, the PDF's tags and the .docx
 * styles find it by (`cast-1`, `characters-prose-3`, `production-heading`).
 */
import type { FrontMatter } from "../fountain/model";
import type { ElementAlign, ElementFontStyle, FrontMatterSpec } from "../format/spec";
import type { FrontMatterLine, FrontSheetKind, StyleRun } from "./engine";
import { openingParagraphs } from "./opening-prose";

/** The heading the production notes page prints over the writer's notes
 * (docs/app/formatting/formats-and-layout.md#FMT-160). */
export const PRODUCTION_NOTES_HEADING = "PRODUCTION NOTES";

/** One paragraph of a page before the script, as the engine places it. */
export interface FrontBlock {
  text: string;
  /** Bold and italic over spans of `text`. */
  runs: StyleRun[];
  /** The id a printed line keeps, which the editor, the tags and the styles read. */
  id: string;
  role: FrontMatterLine["role"];
  align: ElementAlign;
  fontStyle: ElementFontStyle;
  /** Blank rows above it, when a line of the page already stands on its sheet. */
  gap: number;
  /** A heading: it goes to the next sheet with the line under it, never ends one. */
  keepWithNext: boolean;
  /** Set in the format's title style: a title page's own title, written as a page file. */
  titleStyle?: true;
}

/** A page before the script: its blocks, where its first sheet starts, and its foot. */
export interface FrontPage {
  /** One of the four pages the fields and texts print, or a page file's own kind. */
  kind: string;
  /** A page file's name, which the sheets carry for an export to name them by. */
  label?: string;
  /** The first sheet's first row: a third of the paper down, or the format's section top. */
  top: "title" | "section";
  blocks: FrontBlock[];
  /**
   * Blocks set at the foot of the sheet, under the rest after at least the
   * format's gap: the title page's contact and draft date.
   */
  foot: FrontBlock[];
}

/** Today's front matter, as the pages it prints, in the order it prints them. */
export function frontPagesOf(
  fm: FrontMatter | null | undefined,
  policy: FrontMatterSpec,
): FrontPage[] {
  if (!fm) return [];
  const block = (
    text: string,
    id: string,
    role: FrontMatterLine["role"] = "paragraph",
    align: ElementAlign = "left",
    fontStyle: ElementFontStyle = policy.bodyFontStyle,
    gap = 0,
    keepWithNext = false,
    runs: StyleRun[] = [],
  ): FrontBlock => ({ text, runs, id, role, align, fontStyle, gap, keepWithNext });
  const page = (
    kind: FrontSheetKind,
    blocks: FrontBlock[],
    top: FrontPage["top"] = "section",
    foot: FrontBlock[] = [],
  ): FrontPage => ({ kind, top, blocks, foot });

  /** A page written freely: its Markdown's paragraphs, the format's gap between each. */
  const prose = (value: string, kind: FrontSheetKind): FrontBlock[] =>
    openingParagraphs(value).map((p, i) =>
      block(
        p.text,
        `${kind}-prose-${i}`,
        p.heading ? "heading" : "paragraph",
        p.align,
        p.heading ? policy.headingFontStyle : policy.bodyFontStyle,
        i ? policy.fieldGapRows : 0,
        p.heading,
        p.runs,
      ),
    );

  /**
   * The production notes, under their heading. Each paragraph's id keeps its
   * place among the notes' paragraphs, which is how a double-click finds it in
   * the editor (docs/app/formatting/formats-and-layout.md#FMT-161).
   */
  const production = (separate: boolean): FrontBlock[] => {
    const notes = (fm.productionNotes?.trim() ? openingParagraphs(fm.productionNotes) : [])
      .map((p, index) => ({ ...p, index }))
      .filter((p) => p.text.trim());
    if (!notes.length) return [];
    return [
      block(
        PRODUCTION_NOTES_HEADING,
        "production-heading",
        "heading",
        separate ? "center" : "left",
        policy.headingFontStyle,
        policy.fieldGapRows,
        true,
      ),
      ...notes.map((p, i) =>
        block(
          p.text,
          `production-prose-${p.index}`,
          p.heading ? "heading" : "paragraph",
          p.align,
          p.heading ? policy.headingFontStyle : policy.bodyFontStyle,
          i ? policy.fieldGapRows : policy.headingGapRows,
          p.heading,
          p.runs,
        ),
      ),
    ];
  };

  // A compact opening on the first numbered page: one run of blocks
  // (docs/app/formatting/formats-and-layout.md#FMT-103).
  if (policy.placement === "inline") {
    const blocks: FrontBlock[] = [];
    if (fm.titlePage !== undefined) {
      if (fm.titlePage.trim()) blocks.push(...prose(fm.titlePage, "title"));
    } else {
      blocks.push(
        block(fm.title?.toUpperCase() ?? "", "title", "heading", "left", policy.titleFontStyle),
      );
      const credit = fm.credit ?? (fm.authors?.length ? "by" : "");
      blocks.push(
        block(
          [credit, fm.authors?.join(", ")].filter(Boolean).join(" "),
          "authors",
          "paragraph",
          "left",
          policy.bodyFontStyle,
          policy.titleGapRows,
        ),
        block(fm.draftDate ?? "", "draft-date"),
        ...(fm.contact ?? []).map((text, i) => block(text, `contact-${i}`)),
      );
    }
    const notes = fm.openingNotes;
    if (fm.openingNotesBeforeCharacters && notes?.trim()) blocks.push(...prose(notes, "setting"));
    if (fm.charactersPage !== undefined) {
      if (fm.charactersPage.trim()) blocks.push(...prose(fm.charactersPage, "characters"));
    } else if (fm.characters?.length) {
      const cast = fm.characters
        .map((c) => (c.description ? `${c.name} (${c.description})` : c.name))
        .join(", ");
      blocks.push(
        block(
          `Characters: ${cast}`,
          "characters",
          "paragraph",
          "left",
          policy.bodyFontStyle,
          policy.fieldGapRows,
        ),
      );
    }
    if (notes !== undefined) {
      if (!fm.openingNotesBeforeCharacters && notes.trim()) blocks.push(...prose(notes, "setting"));
    } else
      for (const [label, value] of [
        ["Setting", fm.setting],
        ["Time", fm.time],
        ["Place", fm.place],
      ] as const)
        if (value?.trim()) blocks.push(block(`${label}: ${value}`, label));
    blocks.push(...production(false));
    return [page("title", blocks)];
  }

  const pages: FrontPage[] = [];
  if (fm.titlePage !== undefined) {
    if (fm.titlePage.trim()) pages.push(page("title", prose(fm.titlePage, "title"), "title"));
  } else if (fm.title?.trim()) {
    // The contact lines, and the draft date under them, at the foot: a blank
    // contact line is a blank row there, and the date stands the format's gap
    // below the last of them.
    const foot: FrontBlock[] = [];
    let blanks = 0;
    (fm.contact ?? []).forEach((text, i) => {
      if (text.trim()) {
        foot.push(
          block(
            text,
            `contact-${i}`,
            "paragraph",
            policy.contactAlign,
            policy.bodyFontStyle,
            blanks,
          ),
        );
        blanks = 0;
      } else blanks++;
    });
    if (fm.draftDate)
      foot.push(
        block(
          fm.draftDate,
          "draft-date",
          "paragraph",
          policy.contactAlign,
          policy.bodyFontStyle,
          foot.length ? blanks + policy.fieldGapRows : 0,
        ),
      );
    pages.push(
      page(
        "title",
        [
          block(fm.title.toUpperCase(), "title", "heading", "center", policy.titleFontStyle),
          block(
            fm.credit ?? (fm.authors?.length ? "by" : ""),
            "credit",
            "paragraph",
            "center",
            policy.bodyFontStyle,
            policy.titleGapRows,
          ),
          block(
            fm.authors?.join(", ") ?? "",
            "authors",
            "paragraph",
            "center",
            policy.bodyFontStyle,
            policy.titleGapRows,
          ),
        ],
        "title",
        foot,
      ),
    );
  }
  const notes = fm.openingNotes;
  if (fm.openingNotesBeforeCharacters && notes?.trim())
    pages.push(page("setting", prose(notes, "setting")));
  if (fm.charactersPage !== undefined) {
    if (fm.charactersPage.trim())
      pages.push(page("characters", prose(fm.charactersPage, "characters")));
  } else if (fm.characters?.length)
    pages.push(
      page("characters", [
        block(
          "CHARACTERS",
          "characters-heading",
          "heading",
          "center",
          policy.headingFontStyle,
          0,
          true,
        ),
        ...fm.characters.map((character, i) =>
          block(
            character.description
              ? `${character.name.toUpperCase()} — ${character.description}`
              : character.name.toUpperCase(),
            `cast-${i}`,
            "cast",
            "left",
            policy.bodyFontStyle,
            i ? policy.castGapRows : policy.headingGapRows,
          ),
        ),
      ]),
    );
  if (notes !== undefined) {
    if (!fm.openingNotesBeforeCharacters && notes.trim())
      pages.push(page("setting", prose(notes, "setting")));
  } else {
    const fields = (
      [
        ["SETTING", fm.setting],
        ["TIME", fm.time],
        ["PLACE", fm.place],
      ] as const
    ).filter(([, value]) => value?.trim());
    if (fields.length)
      pages.push(
        page(
          "setting",
          fields.flatMap(([label, value]) => [
            block(
              label,
              `${label}-heading`,
              "heading",
              "left",
              policy.headingFontStyle,
              policy.fieldGapRows,
              true,
            ),
            block(value ?? "", label),
          ]),
        ),
      );
  }
  const productionBlocks = production(true);
  if (productionBlocks.length) pages.push(page("production", productionBlocks));
  return pages;
}
