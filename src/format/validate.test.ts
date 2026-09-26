// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";

import dgModernRaw from "../../formats/dg-modern.json";
import stageUsModernRaw from "../../formats/stage-us-modern.json";
import {
  elementColumnIn,
  linePitchIn,
  maxLinesPerPage,
  textBlockHeightIn,
  textBlockWidthIn,
  type FormatSpec,
} from "./spec";
import { parseFormatFile, validateFormatSpec } from "./validate";

function mustValidate(raw: unknown): FormatSpec {
  const result = validateFormatSpec(raw);
  if (!result.ok) throw new Error(`expected valid, got:\n${result.errors.join("\n")}`);
  return result.spec;
}

function mustFail(raw: unknown): string[] {
  const result = validateFormatSpec(raw);
  if (result.ok) throw new Error("expected validation errors, got a valid spec");
  return result.errors;
}

/** A mutable copy of the dg-modern file for error-injection tests. */
function dgCopy(): Record<string, unknown> {
  return structuredClone(dgModernRaw) as Record<string, unknown>;
}

describe("shipped format files", () => {
  it("dg-modern validates", () => {
    const spec = mustValidate(dgModernRaw);
    expect(spec.id).toBe("dg-modern");
  });

  it("stage-us-modern validates", () => {
    const spec = mustValidate(stageUsModernRaw);
    expect(spec.id).toBe("stage-us-modern");
  });

  it("dg-modern geometry matches the known Courier-12 page arithmetic", () => {
    const spec = mustValidate(dgModernRaw);
    // 8.5" − 1.5" − 1.0" = 6.0" text block; at Courier's 10 cpi that is
    // 60 characters per line (the brief's sanity constant).
    expect(textBlockWidthIn(spec)).toBeCloseTo(6.0, 10);
    expect(Math.floor(textBlockWidthIn(spec) * 10)).toBe(60);
    // 11" − 1" − 1" = 9.0" tall; 12/14.4pt = 5 lines/inch = 45 lines.
    expect(textBlockHeightIn(spec)).toBeCloseTo(9.0, 10);
    expect(linePitchIn(spec)).toBeCloseTo(1 / 5, 10);
    expect(maxLinesPerPage(spec)).toBe(45);
  });

  it("stage-us-modern reading pitch (1.2 line height) fits 45 lines", () => {
    const spec = mustValidate(stageUsModernRaw);
    expect(maxLinesPerPage(spec)).toBe(45);
  });

  it("dg-modern carries the DG-PDF-calibrated indents", () => {
    const spec = mustValidate(dgModernRaw);
    // Measured from modernformat-New.pdf: cue fixed at 4.03" from the paper
    // edge = 2.5" from the 1.5" margin; wryly 0.5" left of the cue; block
    // directions share the cue indent and run to the right margin.
    expect(spec.elements.character.indentFromMargin).toBe(2.5);
    expect(spec.elements.parenthetical.indentFromMargin).toBe(2.0);
    expect(elementColumnIn(spec, "action")).toEqual({ leftIn: 2.5, widthIn: 3.5 });
    // The defining stage-play trait: dialogue is margin-to-margin.
    expect(elementColumnIn(spec, "dialogue")).toEqual({ leftIn: 0, widthIn: 6.0 });
  });

  it("dg-modern spacing welds cue→dialogue and puts one blank line between speeches", () => {
    const spec = mustValidate(dgModernRaw);
    expect(spec.elements.character.spacingBefore).toBe(1);
    expect(spec.elements.character.spacingAfter).toBe(0);
    expect(spec.elements.parenthetical.spacingBefore).toBe(0);
    expect(spec.elements.dialogue.spacingBefore).toBe(0);
    expect(spec.elements.dialogue.spacingAfter).toBe(0);
  });

  it("fills defaults: unstated fields resolve to the documented values", () => {
    const spec = mustValidate(dgModernRaw);
    expect(spec.elements.character.align).toBe("left");
    expect(spec.elements.character.print).toBe(true);
    expect(spec.elements.dialogue.maxWidth).toBe("full");
    expect(spec.elements.act.startsNewPage).toBe(true);
    expect(spec.elements.act.letterSpacing).toBe(0);
  });

  it("non-printing presets apply when entries are omitted", () => {
    const raw = dgCopy();
    const elements = raw.elements as Record<string, unknown>;
    delete elements.synopsis;
    delete elements.pageBreak;
    delete elements.boneyard;
    const spec = mustValidate(raw);
    expect(spec.elements.synopsis.print).toBe(false);
    expect(spec.elements.boneyard.print).toBe(false);
    expect(spec.elements.pageBreak.print).toBe(false);
    expect(spec.elements.pageBreak.startsNewPage).toBe(true);
  });
});

describe("validation errors", () => {
  it("docs/app/formatting/formats-and-layout.md#FMT-115: only stacks headed by the embedded face are accepted", () => {
    for (const family of ["Arial", "Courier New", "monospace", "Courier Prime, fantasy", "Courier Prime,, Courier"]) {
      expect(mustFail({ ...dgModernRaw, type: { ...dgModernRaw.type, family } }).join("\n")).toContain("type.family");
    }
    for (const family of ["Courier Prime", "'Courier Prime', monospace", '"Courier Prime", "Courier New", Courier, monospace']) {
      expect(mustValidate({ ...dgModernRaw, type: { ...dgModernRaw.type, family } }).type.family).toBe(family);
    }
  });
  it("rejects a missing required element, naming it", () => {
    const raw = dgCopy();
    delete (raw.elements as Record<string, unknown>).dialogue;
    expect(mustFail(raw).join("\n")).toContain("elements.dialogue: missing");
  });

  it("rejects an unknown element key (typo guard)", () => {
    const raw = dgCopy();
    (raw.elements as Record<string, unknown>).dialog = {};
    expect(mustFail(raw).join("\n")).toContain("elements.dialog");
  });

  it("rejects an unknown field inside an element", () => {
    const raw = dgCopy();
    ((raw.elements as Record<string, unknown>).character as Record<string, unknown>).indent = 2;
    expect(mustFail(raw).join("\n")).toContain("elements.character.indent");
  });

  it("rejects a bad enum value", () => {
    const raw = dgCopy();
    ((raw.elements as Record<string, unknown>).character as Record<string, unknown>).align =
      "middle";
    expect(mustFail(raw).join("\n")).toContain("elements.character.align");
  });

  it("rejects a negative indent", () => {
    const raw = dgCopy();
    ((raw.elements as Record<string, unknown>).character as Record<string, unknown>)
      .indentFromMargin = -1;
    expect(mustFail(raw).join("\n")).toContain("elements.character.indentFromMargin");
  });

  it("rejects an unknown header token", () => {
    const raw = dgCopy();
    (raw.header as Record<string, unknown>).content = { right: "{pge}." };
    expect(mustFail(raw).join("\n")).toContain("unknown token {pge}");
  });

  it("rejects margins that consume the page", () => {
    const raw = dgCopy();
    (raw.page as Record<string, unknown>).margins = { left: 5, top: 1, right: 4, bottom: 1 };
    expect(mustFail(raw).join("\n")).toContain("page.margins");
  });

  it("rejects zero/negative pagination minimums", () => {
    const raw = dgCopy();
    (raw.pagination as Record<string, unknown>).minDialogueLinesBeforeBreak = 0;
    expect(mustFail(raw).join("\n")).toContain("pagination.minDialogueLinesBeforeBreak");
  });

  it("rejects a malformed id", () => {
    const raw = dgCopy();
    raw.id = "DG Modern!";
    expect(mustFail(raw).join("\n")).toContain("id:");
  });

  it("rejects an unknown top-level key", () => {
    const raw = dgCopy();
    raw.paper = "letter";
    expect(mustFail(raw).join("\n")).toContain("format.paper");
  });

  it("rejects non-object input", () => {
    expect(mustFail("dg-modern").join("\n")).toContain("expected an object");
  });

  it("collects every problem in one pass, not just the first", () => {
    const raw = dgCopy();
    raw.id = "Bad Id";
    delete (raw.elements as Record<string, unknown>).dialogue;
    (raw.pagination as Record<string, unknown>).minActionLinesEitherSide = 0;
    expect(mustFail(raw).length).toBeGreaterThanOrEqual(3);
  });
});

describe("parseFormatFile", () => {
  it("prefixes JSON syntax errors with the file name", () => {
    const result = parseFormatFile("broken.json", "{ not json");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain("broken.json");
  });

  it("prefixes validation errors with the file name", () => {
    const result = parseFormatFile("bad.json", JSON.stringify({ id: "x" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.every((e) => e.startsWith("bad.json:"))).toBe(true);
  });
});

// A font family is names, not a stylesheet: it goes into the editor's CSS verbatim.
import { test as a105, expect as a105expect } from "bun:test";
import dgModern from "../../formats/dg-modern.json";
a105("CSS syntax in type.family is refused, and the built-in families pass", () => {
  const injected = JSON.parse(JSON.stringify(dgModern)) as { type: { family: string } };
  injected.type.family =
    'monospace; } body::before { content: "A1 CSS INJECTION"; position:fixed; inset:0; z-index:2147483647; background:white; color:black; } .a1 { font-family: monospace';
  const bad = validateFormatSpec(injected);
  a105expect(bad.ok).toBe(false);
  if (!bad.ok) a105expect(bad.errors.some((e) => e.startsWith("type.family"))).toBe(true);
  const good = validateFormatSpec(dgModern);
  a105expect(good.ok).toBe(true);
});
