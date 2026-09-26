// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The footer. Every format file could always describe one, and no surface drew
 * it; now the engine resolves it the way it resolves the header, and a footer
 * lives in the bottom margin — so it must never move a line.
 */
import { describe, expect, it } from "bun:test";

import dgModernRaw from "../../formats/dg-modern.json";
import type { BlockNode, Doc } from "../fountain/model";
import { formatToCss } from "../format/css";
import type { FormatSpec } from "../format/spec";
import { validateFormatSpec } from "../format/validate";
import { paginateDoc } from "./engine";

function spec(mutate: (raw: Record<string, any>) => void = () => {}): FormatSpec {
  const raw = structuredClone(dgModernRaw) as Record<string, any>;
  mutate(raw);
  const v = validateFormatSpec(raw);
  if (!v.ok) throw new Error(v.errors.join("\n"));
  return v.spec;
}

const block = (type: BlockNode["type"], text: string): BlockNode => ({
  type,
  content: [{ type: "text", text }],
});

/** Three pages of play: an act, a scene, a long direction and a long speech. */
const PLAY: Doc = {
  type: "doc",
  content: [
    block("act", "ACT ONE"),
    block("scene", "SCENE 1"),
    block("action", Array.from({ length: 70 }, (_, i) => `beat ${i}`).join("\n")),
    block("character", "MARA"),
    block("dialogue", Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n")),
  ],
};

describe("footer", () => {
  it("resolves its slots and tokens from the page's own state", () => {
    const s = spec((raw) => {
      raw.footer = { content: { left: "{title}", center: "{page}", right: "{act}" }, position: 0.5 };
    });
    const { pages } = paginateDoc(PLAY, s, { title: "Tideline" });
    expect(pages.length).toBeGreaterThan(2);
    expect(pages[1].footer).toEqual({ left: "Tideline", center: "2", right: "ACT ONE" });
  });

  it("is null when it says nothing, and when page one suppresses it", () => {
    expect(paginateDoc(PLAY, spec()).pages.every((p) => p.footer === null)).toBe(true);
    const s = spec((raw) => {
      raw.footer = { content: { center: "{page}" }, position: 0.5, suppressOnFirstPage: true };
    });
    const { pages } = paginateDoc(PLAY, s);
    expect(pages[0].footer).toBeNull();
    expect(pages[1].footer).toEqual({ center: "2" });
  });

  it("moves no line: pages are identical with and without one", () => {
    const withFooter = spec((raw) => {
      raw.footer = { content: { left: "{title}", center: "— {page} —", right: "{scene}" }, position: 0.3 };
    });
    const strip = (pages: ReturnType<typeof paginateDoc>["pages"]) =>
      pages.map((p) => ({ lines: p.lines, usedRows: p.usedRows, fillRows: p.fillRows }));
    expect(strip(paginateDoc(PLAY, withFooter).pages)).toEqual(strip(paginateDoc(PLAY, spec()).pages));
  });

  it("reaches the stylesheet: its position, and chrome pulled back out of indented blocks", () => {
    const css = formatToCss(spec((raw) => (raw.footer.position = 0.4)));
    expect(css).toContain("--fmt-footer-pos: 0.4in;");
    // dg-modern indents action 2.5" (25.0163 Courier Prime cells).
    expect(css).toContain(
      ".play-page .pl-action .pgchrome__header, .play-page .pl-action .pgchrome__footer {\n  left: -25.0163ch;\n  right: 0;",
    );
    // Dialogue sits margin to margin, so its chrome needs no correction.
    expect(css).not.toContain(".play-page .pl-dialogue .pgchrome__header");
  });
});
