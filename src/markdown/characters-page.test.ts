// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Characters page and the cast list in step both ways
 * (docs/app/formatting/formats-and-layout.md#FMT-166).
 */
import { describe, expect, it } from "bun:test";
import { castFromPage, charactersPageText, pageWithCast } from "./characters-page";

const cast = [
  { name: "MARA", description: "a hydrologist, 40s" },
  { name: "JONAH", description: "her brother, 30s" },
];

describe("the page to the cast list", () => {
  it("reads the page the cast list makes", () => {
    expect(castFromPage(charactersPageText(cast))).toEqual(cast);
  });

  it("reads a cast list typed on the page, with any dash, a colon or a comma", () => {
    const page = [
      "# Characters",
      "",
      "**MARA** — a hydrologist, 40s",
      "",
      "**JONAH** - her brother",
      "",
      "**EDDA**: their aunt",
      "",
      "**PIP**, a boy",
      "",
      "**VOICE**",
    ].join("\n");
    expect(castFromPage(page)).toEqual([
      { name: "MARA", description: "a hydrologist, 40s" },
      { name: "JONAH", description: "her brother" },
      { name: "EDDA", description: "their aunt" },
      { name: "PIP", description: "a boy" },
      { name: "VOICE" },
    ]);
  });

  it("finds no cast on a page of the writer's own prose", () => {
    expect(castFromPage("# Characters\n\nThree women and a ghost.")).toBeNull();
  });

  it("leaves out what is not a character's line", () => {
    const page = "# Characters\n\nThe family:\n\n**MARA** — the eldest\n\n*Doubling is possible.*";
    expect(castFromPage(page)).toEqual([{ name: "MARA", description: "the eldest" }]);
  });
});

describe("the cast list to the page", () => {
  const page = [
    "# Characters",
    "",
    "The family:",
    "",
    "**MARA** — a hydrologist, *40s*",
    "",
    "**JONAH** — her brother, 30s",
    "",
    "Doubling is possible.",
  ].join("\n");

  it("leaves a page that already shows the list as it is", () => {
    expect(
      pageWithCast(page, [{ name: "MARA", description: "a hydrologist, 40s" }, cast[1]!]),
    ).toBe(page);
  });

  it("changes a description, keeps the other line's emphasis and the writer's prose", () => {
    const next = pageWithCast(page, [
      { name: "MARA", description: "a hydrologist, 40s" },
      { name: "JONAH", description: "her younger brother" },
    ])!;
    expect(next).toContain("The family:");
    expect(next).toContain("Doubling is possible.");
    expect(next).toContain("_40s_");
    expect(next).toContain("**JONAH** — her younger brother");
    expect(castFromPage(next)?.[1]).toEqual({ name: "JONAH", description: "her younger brother" });
  });

  it("puts a new character after the last line, and takes a removed one out", () => {
    const next = pageWithCast(page, [cast[1]!, { name: "EDDA", description: "their aunt" }])!;
    expect(castFromPage(next)).toEqual([cast[1], { name: "EDDA", description: "their aunt" }]);
    expect(next.indexOf("EDDA")).toBeLessThan(next.indexOf("Doubling is possible."));
    expect(next).not.toContain("MARA");
  });

  it("follows a new order", () => {
    const next = pageWithCast(page, [
      cast[1]!,
      { name: "MARA", description: "a hydrologist, 40s" },
    ])!;
    expect(castFromPage(next)?.map((c) => c.name)).toEqual(["JONAH", "MARA"]);
  });

  it("leaves a page with no cast on it alone", () => {
    expect(pageWithCast("# Characters\n\nThree women and a ghost.", cast)).toBeNull();
  });
});
