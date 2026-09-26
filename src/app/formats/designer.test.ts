// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The designer's promises that do not need a screen: its working copy round-
 * trips through the format file and validation, it reports problems at the
 * field they belong to, the sampler exercises everything a format decides,
 * and the preview's "moved" flags and page descriptions follow the engine.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

import {
  REQUIRED_FORMAT_ELEMENTS,
  builtinFormats,
  formatFileText,
  validateFormatSpec,
} from "../../format";
import { paginateDoc } from "../../layout";
import { changedParts, checkDraft, draftFromSpec, draftToRaw, ELEMENT_LABELS, listInWords } from "./draft";
import { describeMoves, describePage, lineKey, movedLines } from "./preview";
import { formatSampler } from "./sampler";

const [DG, STAGE] = builtinFormats();

describe("the designer's working copy", () => {
  it("round-trips: draft → format file → validate → the same draft, for every built-in", () => {
    for (const spec of builtinFormats()) {
      const draft = draftFromSpec(spec);
      const checked = checkDraft(draft);
      expect(checked.errors.size).toBe(0);
      const file = formatFileText(checked.spec!);
      const reread = validateFormatSpec(JSON.parse(file));
      if (!reread.ok) throw new Error(reread.errors.join("\n"));
      expect(draftFromSpec(reread.spec)).toEqual(draft);
    }
  });

  it("accepts a value as it is being typed only once it is a number", () => {
    const draft = draftFromSpec(DG);
    for (const [typed, ok] of [["2.", true], ["2.75", true], [".5", true], ["", false], ["two", false], ["2.5in", false]] as const) {
      draft.elements.character.indentFromMargin = typed;
      const { spec, errors } = checkDraft(draft);
      expect(!!spec).toBe(ok);
      if (!ok) expect(errors.get("elements.character.indentFromMargin")).toBe("Enter a number.");
    }
  });

  it("reports validate.ts's own rules at the field, in plain words", () => {
    const draft = draftFromSpec(DG);
    draft.page.margins.left = "-1";
    draft.pagination.minDialogueLinesAfterBreak = "1.5";
    draft.header.right = "{page} of {pages}";
    draft.name = " ";
    const { spec, errors } = checkDraft(draft);
    expect(spec).toBeNull();
    expect(errors.get("page.margins.left")).toBe("Enter 0 or more.");
    expect(errors.get("pagination.minDialogueLinesAfterBreak")).toBe("Enter a whole number.");
    expect(errors.get("header.content.right")).toContain("{pages}");
    expect(errors.get("name")).toBe("Give the format a name.");
  });

  it("says when margins leave no room", () => {
    const draft = draftFromSpec(DG);
    draft.page.margins.left = "4.5";
    draft.page.margins.right = "4";
    expect(checkDraft(draft).errors.get("page.margins")).toBe(
      "The left and right margins leave no room for text.",
    );
  });

  it("keeps an unsaved draft valid without an id, and a full-width element full", () => {
    const draft = draftFromSpec(DG);
    draft.id = "";
    expect(checkDraft(draft).spec?.id).toBe("");
    expect((draftToRaw(draft).elements as Record<string, { maxWidth: unknown }>).dialogue.maxWidth).toBe("full");
  });

  it("names what changed", () => {
    const before = draftFromSpec(DG);
    const after = structuredClone(before);
    after.page.margins.left = "1.25";
    after.elements.character.indentFromMargin = "3";
    after.header.center = "{title}";
    expect(changedParts(before, before)).toEqual([]);
    expect(listInWords(changedParts(before, after))).toBe("the margins, the header and Character");
  });

  it("names every printed element the way the element bar does", () => {
    const bar = readFileSync(new URL("../../editor/ElementBar.tsx", import.meta.url), "utf8");
    for (const key of REQUIRED_FORMAT_ELEMENTS) {
      expect(bar).toContain(`{ type: "${key}", label: "${ELEMENT_LABELS[key]}"`);
    }
  });
});

describe("the format sampler", () => {
  const { doc, meta } = formatSampler();

  it("holds every printed element, a dual pair and a title page", () => {
    const types = new Set(doc.content.map((b) => b.type));
    for (const key of REQUIRED_FORMAT_ELEMENTS) expect(types.has(key)).toBe(true);
    expect(doc.content.some((b) => b.type === "character" && b.attrs?.dual === true)).toBe(true);
    expect(doc.content.some((b) => b.type === "character" && typeof b.attrs?.extension === "string")).toBe(true);
    expect(meta.title).toBe("The Prompt Book");
    expect(meta.author).toBe("Proscenium");
  });

  it("splits a speech across a page, with its (CONT'D), under every built-in", () => {
    for (const spec of builtinFormats()) {
      const { pages } = paginateDoc(doc, spec, meta);
      expect(pages.length).toBeGreaterThan(2);
      expect(pages.some((p) => p.breakBefore?.contd?.includes("NELL"))).toBe(spec.pagination.repeatCharacterOnSplit);
    }
  });
});

describe("the preview", () => {
  const { doc, meta } = formatSampler();

  it("flags only the lines a change moved", () => {
    const before = { layout: paginateDoc(doc, DG, meta), spec: DG };
    expect(movedLines(before, before).lines.size).toBe(0);
    expect(movedLines(null, before).lines.size).toBe(0);

    // Centre the transition: those lines move, the dialogue does not.
    const spec = structuredClone(DG);
    spec.elements.transition = { ...spec.elements.transition, align: "center" };
    const after = { layout: paginateDoc(doc, spec, meta), spec };
    const moves = movedLines(before, after);
    expect(moves.elements).toEqual(["transition"]);
    const dialogue = after.layout.pages[0].lines.find((l) => l.type === "dialogue")!;
    expect(moves.lines.has(lineKey(dialogue, 1))).toBe(false);
    expect(describeMoves(moves, after.layout.pages.length, before.layout.pages.length)).toMatch(/^Transition moved\./);
  });

  it("counts a margin change as moving the page", () => {
    const before = { layout: paginateDoc(doc, DG, meta), spec: DG };
    const spec = structuredClone(DG);
    spec.page.margins.left = 1.25;
    spec.page.margins.right = 1.25;
    const after = { layout: paginateDoc(doc, spec, meta), spec };
    expect(movedLines(before, after).lines.size).toBeGreaterThan(20);
  });

  it("describes a page by where its elements sit", () => {
    const layout = paginateDoc(doc, DG, meta);
    const second = layout.pages[1];
    const text = describePage(second, layout.pages.length, DG);
    expect(text).toMatch(new RegExp(`^Page 2 of ${layout.pages.length}\\.`));
    expect(text).toContain("Header right: 2.");
    // dg-modern's cue sits 2.5" into a 1.5" margin: 4 inches from the edge.
    if (second.lines.some((l) => l.type === "character" && l.kind === "text")) {
      expect(text).toContain("Character at 4 inches from the left edge");
    }
    const stage = paginateDoc(doc, STAGE, meta);
    expect(describePage(stage.pages[0], stage.pages.length, STAGE)).toContain("Character at 4 inches from the left edge");
  });
});
