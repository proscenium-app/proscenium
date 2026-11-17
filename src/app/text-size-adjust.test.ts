// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const base = readFileSync(join(import.meta.dir, "styles", "base.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

describe("the page's words zoom with the page (docs/app/writing/editor-ux.md#EDIT-196)", () => {
  test("the document asks iPadOS's text autosizing to leave its type alone", () => {
    // Autosizing set a zoomed element's type back to its unzoomed size, so on
    // an iPad the script's sheet zoomed and its words did not. Only `none`
    // stops it: a percentage still resets the type.
    const html = /(^|\})\s*html\s*\{([^}]*)\}/.exec(base);
    expect(html?.[2] ?? "").toMatch(/-webkit-text-size-adjust:\s*none\s*;/);
  });

  test("nothing in the base sheet sets it back", () => {
    const all = [...base.matchAll(/-webkit-text-size-adjust:\s*([^;]+);/g)].map((m) => m[1]);
    expect(all).toEqual(["none"]);
  });
});
