// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { markKey, parseInline, serializeInline } from "./inline";
import type { InlineNode } from "./model";

function marksOf(node: InlineNode): string {
  return node.type === "text" ? markKey(node.marks) : "(note)";
}

describe("parseInline — marks", () => {
  it("plain text", () => {
    expect(parseInline("plain")).toEqual([{ type: "text", text: "plain" }]);
  });

  it("italic / bold / bold-italic / underline", () => {
    expect(marksOf(parseInline("*i*")[0])).toBe("em");
    expect(marksOf(parseInline("**b**")[0])).toBe("strong");
    expect(marksOf(parseInline("***bi***")[0])).toBe("em,strong");
    expect(parseInline("***bi***")[0]).toEqual({
      type: "text",
      text: "bi",
      marks: [{ type: "strong" }, { type: "em" }],
    });
    expect(marksOf(parseInline("_u_")[0])).toBe("underline");
  });

  it("composed emphasis", () => {
    expect(marksOf(parseInline("_*i*_")[0])).toBe("em,underline");
    expect(marksOf(parseInline("**_x_**")[0])).toBe("strong,underline");
  });

  it("emphasis amid plain text", () => {
    const nodes = parseInline("a *b* c");
    expect(nodes.map((n) => (n.type === "text" ? n.text : "N"))).toEqual([
      "a ",
      "b",
      " c",
    ]);
    expect(marksOf(nodes[1])).toBe("em");
  });

  it("inline note", () => {
    const nodes = parseInline("before [[a thought]] after");
    expect(nodes[1]).toEqual({
      type: "note",
      content: [{ type: "text", text: "a thought" }],
    });
  });

  it("backslash escapes are literal, not emphasis", () => {
    expect(parseInline("\\*lit\\*")).toEqual([{ type: "text", text: "*lit*" }]);
    expect(parseInline("a\\_b")).toEqual([{ type: "text", text: "a_b" }]);
  });

  it("unmatched delimiter folds back to literal", () => {
    expect(parseInline("file_name")).toEqual([
      { type: "text", text: "file_name" },
    ]);
  });
});

describe("serializeInline — round-trip", () => {
  const cases = [
    "plain words",
    "*i*",
    "**b**",
    "***bi***",
    "_u_",
    "_*i*_",
    "**_x_**",
    "a *b* c *d*",
    "before [[a thought]] after",
    "a literal \\* star and \\_ underscore",
  ];

  for (const input of cases) {
    it(`stable: ${JSON.stringify(input)}`, () => {
      const once = serializeInline(parseInline(input));
      const twice = serializeInline(parseInline(once));
      // Idempotent after first normalization.
      expect(twice).toBe(once);
      // Structure is preserved through a serialize→parse round-trip.
      expect(parseInline(once)).toEqual(parseInline(twice));
    });
  }

  it("clean corpus stays byte-identical (no needless escaping)", () => {
    expect(serializeInline(parseInline("She turns off the tap."))).toBe(
      "She turns off the tap.",
    );
    expect(serializeInline(parseInline("*i*"))).toBe("*i*");
    expect(serializeInline(parseInline("_*i*_"))).toBe("_*i*_");
  });
});
