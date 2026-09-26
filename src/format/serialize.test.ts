// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the designer writes must read back as what it meant. Every built-in
 * goes spec → file → validate → spec, and a format with every field moved off
 * its default does too.
 */
import { describe, expect, it } from "bun:test";

import dgModernRaw from "../../formats/dg-modern.json";
import { builtinFormats } from "./registry";
import { formatFileObject, formatFileText, formatIdFromName } from "./serialize";
import { FORMAT_ELEMENT_KEYS, type FormatSpec } from "./spec";
import { validateFormatSpec } from "./validate";

function reread(spec: FormatSpec): FormatSpec {
  const result = validateFormatSpec(JSON.parse(formatFileText(spec)));
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.spec;
}

describe("format files", () => {
  it("round-trips every built-in exactly", () => {
    for (const spec of builtinFormats()) expect(reread(spec)).toEqual(spec);
  });

  it("round-trips a format with every field off its default", () => {
    const base = builtinFormats()[0];
    const spec: FormatSpec = structuredClone(base);
    spec.id = "everything";
    spec.name = "Everything Moved";
    spec.page = { size: "a4", margins: { left: 1.25, top: 0.75, right: 0.9, bottom: 1.1 } };
    spec.type = { family: base.type.family, size: 11, lineHeight: 1.2 };
    spec.header = {
      content: { left: "{title}", center: "— {page} —" },
      position: 0.6,
      suppressOnFirstPage: false,
    };
    spec.footer = {
      content: { right: "{act} / {scene}" },
      position: 0.4,
      suppressOnFirstPage: true,
    };
    for (const key of FORMAT_ELEMENT_KEYS) {
      spec.elements[key] = {
        indentFromMargin: 0.3,
        maxWidth: 4.25,
        align: "right",
        textTransform: "uppercase",
        fontStyle: "bold-italic",
        letterSpacing: 0.05,
        spacingBefore: 2,
        spacingAfter: 3,
        keepWithNext: true,
        parenWrap: true,
        besideNext: true,
        runInNext: true,
        standaloneIndentFromMargin: 0,
        suffix: ":",
        underline: true,
        startsNewPage: true,
        tightStack: true,
        print: key !== "synopsis",
      };
    }
    spec.pagination = {
      continuedMarker: " (MORE)",
      repeatCharacterOnSplit: false,
      minDialogueLinesBeforeBreak: 3,
      minDialogueLinesAfterBreak: 4,
      minActionLinesEitherSide: 5,
    };
    spec.dualDialogue = { gutterIn: 0.35 };
    expect(reread(spec)).toEqual(spec);
  });

  it("leaves defaults out, the way the built-ins are written", () => {
    const [dg] = builtinFormats();
    const file = formatFileObject(dg) as { elements: Record<string, Record<string, unknown>> };
    // dg-modern's own file names these on its cue; the rest are defaults.
    expect(file.elements.character).toEqual({
      indentFromMargin: 2.5,
      textTransform: "uppercase",
      spacingBefore: 1,
      keepWithNext: true,
    });
    // A printed element that changes nothing still has its (required) key…
    expect(file.elements.dialogue).toEqual({});
    // …and a non-printing one that matches its preset has none.
    expect("synopsis" in file.elements).toBe(false);
    expect((dgModernRaw as { elements: Record<string, unknown> }).elements.character).toMatchObject(
      file.elements.character,
    );
  });

  it("writes the same bytes for the same format", () => {
    const [dg] = builtinFormats();
    expect(formatFileText(structuredClone(dg))).toBe(formatFileText(dg));
    expect(formatFileText(dg).endsWith("}\n")).toBe(true);
  });
});

describe("formatIdFromName", () => {
  it("makes the ids validation accepts", () => {
    expect(formatIdFromName("Dramatists Guild — Modern")).toBe("dramatists-guild-modern");
    expect(formatIdFromName("  Théâtre de l'Œuvre 2026 ")).toBe("theatre-de-l-uvre-2026");
    expect(formatIdFromName("UK / International")).toBe("uk-international");
    for (const name of ["A", "x y z", "Élan", "9 to 5", "---Hmm---"]) {
      expect(formatIdFromName(name)).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    }
  });

  it("is empty when a name has nothing to make an id of", () => {
    expect(formatIdFromName("")).toBe("");
    expect(formatIdFromName("— — —")).toBe("");
    expect(formatIdFromName("日本語")).toBe("");
  });
});
