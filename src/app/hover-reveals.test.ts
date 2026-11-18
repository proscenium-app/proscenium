// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";

/**
 * On an iPad a tap is a hover first, and WebKit holds a tap's click back when
 * its hover shows something (a control fading in, a box made visible): the
 * tap only showed it, and the writer had to tap again
 * (docs/engineering/cross-platform.md#PLAT-70). So whatever a hover reveals
 * is revealed only for a pointer that hovers, `@media (hover: hover)`, and a
 * finger is shown it some other way (touch-controls.css) or not at all.
 * `(any-hover: hover)` is not enough: it is true on an iPad with a trackpad,
 * where a finger still taps.
 */

const SRC = join(import.meta.dir, "..");
/** What changes whether something is seen. */
const REVEALS = /(^|;|\s)(display|visibility|opacity)\s*:/;

interface Rule {
  file: string;
  line: number;
  selector: string;
  body: string;
  within: string[];
}

/** Every plain rule in a sheet, with the at-rules it sits in. */
function rules(file: string, css: string): Rule[] {
  // Comments blanked to spaces, so line numbers hold.
  const text = css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
  const out: Rule[] = [];
  const open: { prelude: string; at: number }[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") {
      open.push({ prelude: text.slice(start, i).trim().replace(/\s+/g, " "), at: i });
      start = i + 1;
    } else if (ch === "}") {
      const block = open.pop();
      start = i + 1;
      if (!block || block.prelude.startsWith("@")) continue;
      const body = text.slice(block.at + 1, i);
      if (body.includes("{")) continue;
      out.push({
        file,
        line: text.slice(0, block.at).split("\n").length,
        selector: block.prelude,
        body,
        within: open.map((o) => o.prelude).filter((p) => p.startsWith("@")),
      });
    } else if (ch === ";" && open.length === 0) {
      start = i + 1;
    }
  }
  return out;
}

const sheets = [...new Glob("**/*.css").scanSync(SRC)].map((path) => ({
  path,
  css: readFileSync(join(SRC, path), "utf8"),
}));

describe("a hover reveals nothing to a finger", () => {
  test("the sheets are read", () => {
    expect(sheets.length).toBeGreaterThan(10);
    expect(sheets.some((s) => s.path.endsWith("touch-controls.css"))).toBe(true);
  });

  test("every :hover that shows something is for a pointer that hovers", () => {
    const ungated = sheets
      .flatMap((s) => rules(s.path, s.css))
      .filter((r) => r.selector.includes(":hover") && REVEALS.test(r.body))
      .filter((r) => !r.within.some((at) => /\(\s*hover\s*:\s*hover\s*\)/.test(at)))
      .map((r) => `${r.file}:${r.line} ${r.selector}`);
    expect(ungated).toEqual([]);
  });

  test("the reader finds a rule inside an at-rule, and the at-rule", () => {
    const found = rules(
      "t.css",
      "a{color:red}\n@media (hover: hover) {\n  .x:hover .y { opacity: 1; }\n}\n.z:hover{opacity:1}",
    );
    expect(found.map((r) => [r.selector, r.within])).toEqual([
      ["a", []],
      [".x:hover .y", ["@media (hover: hover)"]],
      [".z:hover", []],
    ]);
  });
});

/**
 * The same of a component's own hover. A comment card that marked its anchor
 * in the script on `mouseenter` took every tap on the card's Save and actions,
 * since a finger's tap fires the hover first; a menu row that opened its
 * submenu there held its own click back. So a hover in a component goes
 * through `ui/hover.ts`, on pointer events, for a pointer that hovers alone.
 */
const scripts = [...new Glob("**/*.{ts,tsx}").scanSync(SRC)]
  .filter((path) => !/\.test\.tsx?$/.test(path) && !path.endsWith("ui/hover.ts"))
  .map((path) => ({ path, code: readFileSync(join(SRC, path), "utf8") }));
const MOUSE_HOVER =
  /\bon(MouseEnter|MouseLeave|MouseOver|MouseOut)\s*=|addEventListener\(\s*["'`](mouseenter|mouseleave|mouseover|mouseout)["'`]/;

describe("a component's hover runs for a pointer that hovers", () => {
  test("the components are read", () => {
    expect(scripts.length).toBeGreaterThan(50);
    expect(scripts.some((s) => s.path.endsWith("comments/Thread.tsx"))).toBe(true);
  });

  test("no component listens for a mouse's hover itself", () => {
    const raw = scripts.flatMap((s) =>
      s.code
        .split("\n")
        .map((line, i) => ({ line, at: i + 1 }))
        .filter(({ line }) => MOUSE_HOVER.test(line))
        .map(({ at, line }) => `${s.path}:${at} ${line.trim()}`),
    );
    expect(raw).toEqual([]);
  });

  test("the rule sees each way a hover is listened for", () => {
    for (const line of [
      "onMouseEnter={() => go()}",
      "<li onMouseLeave={leave}>",
      "el.addEventListener('mouseover', f)",
      'window.addEventListener("mouseenter", f, true)',
    ])
      expect(MOUSE_HOVER.test(line)).toBe(true);
    for (const line of [
      "{...onHover(go, leave)}",
      'addEventListener("mousemove", f)',
      "onMouseDown={keep}",
    ])
      expect(MOUSE_HOVER.test(line)).toBe(false);
  });
});
