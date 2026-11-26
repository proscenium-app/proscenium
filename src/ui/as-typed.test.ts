// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";
import { AS_TYPED } from "./as-typed";

/**
 * A field that holds a word as the writer spells it takes no capital and no
 * correction of the system's (docs/engineering/cross-platform.md#PLAT-71).
 * A field that turned the capital off and left autocorrection on had a word
 * added to the dictionary in lower case come back capitalized on an iPad, as
 * Return took the word iPadOS had learned in its place.
 */

const SRC = join(import.meta.dir, "..");

/** Each such field: its file, and a line of its element only it has. */
const FIELDS: [string, string][] = [
  ["app/settings/Writing.tsx", 'aria-label="Word or name to add"'],
  ["app/settings/StatusList.tsx", 'aria-label="New status"'],
  ["app/settings/StatusList.tsx", 'className="field statuslist__field"'],
  ["app/SheetInspector.tsx", 'aria-label="New tag"'],
  ["app/VaultScreen.tsx", 'aria-label="Search plays"'],
  ["workspace/BinderView.tsx", 'aria-label="Filter the binder"'],
  ["editor/FindBar.tsx", 'placeholder="Find in the script…"'],
  ["editor/FindBar.tsx", 'placeholder="Replace with…"'],
  ["app/LanguageSheet.tsx", 'aria-label="Language code"'],
];

/** The JSX element around `marker`: from its `<input` to the `/>` that closes it. */
function elementAround(text: string, marker: string): string {
  const at = text.indexOf(marker);
  if (at < 0) throw new Error(`no ${marker}`);
  const start = text.lastIndexOf("<input", at);
  const end = text.indexOf("/>", at);
  if (start < 0 || end < 0) throw new Error(`no <input … /> around ${marker}`);
  return text.slice(start, end);
}

describe("a word kept as the writer typed it", () => {
  test("asks for no capital and no correction", () => {
    expect(AS_TYPED).toEqual({ autoCapitalize: "none", autoCorrect: "off" });
  });

  test.each(FIELDS)("%s, the field with %s, is spread with AS_TYPED", (file, marker) => {
    const element = elementAround(readFileSync(join(SRC, file), "utf8"), marker);
    expect(element).toContain("{...AS_TYPED}");
  });

  test("no field turns the capital off and leaves the correction on", () => {
    const alone: string[] = [];
    for (const file of new Glob("**/*.tsx").scanSync(SRC)) {
      const text = readFileSync(join(SRC, file), "utf8");
      for (const hit of text.matchAll(/autoCapitalize="(none|off)"/g)) {
        const start = text.lastIndexOf("<", hit.index);
        const end = text.indexOf("/>", hit.index);
        if (!/autoCorrect="off"/.test(text.slice(start, end)))
          alone.push(`${file}:${text.slice(0, hit.index).split("\n").length}`);
      }
    }
    expect(alone).toEqual([]);
  });
});
