// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import { normalize, renderWebKitTree } from "./aria-snapshots.mjs";

const radio = (label: string, checked: unknown) => ({ role: "radio", label, states: { checked } });

describe("WebKit's tree, as the native pass writes it", () => {
  test("a radio is checked only when WebKit says it is", () => {
    const tree = {
      role: "radiogroup",
      label: "Card colour",
      children: [radio("Unmarked", "false"), radio("Setup", "true"), radio("Turns", "mixed")],
    };
    expect(renderWebKitTree(tree).split("\n")).toEqual([
      '- radiogroup "Card colour"',
      '  - radio "Unmarked"',
      '  - radio "Setup" [checked]',
      '  - radio "Turns" [checked=mixed]',
    ]);
  });

  test("a boolean checked state reads the same as the word", () => {
    const tree = { role: "checkbox", label: "Show", states: { checked: true } };
    expect(renderWebKitTree(tree)).toBe('- checkbox "Show" [checked]');
  });
});

describe("what a tree's text leaves out", () => {
  test("the vault's copy for a launch is the plays folder, whatever its number", () => {
    const home = "/private/var/folders/_h/xyz/T/proscenium-selftest-17230";
    const text = [
      `- button "${home}/plays-18/The Weight of Water"`,
      `- button "${home}/plays-light"`,
      '- heading "plays-55" [level=1]',
    ].join("\n");
    expect(normalize(text).split("\n")).toEqual([
      '- button "<plays folder>/The Weight of Water"',
      '- button "<plays folder>"',
      '- heading "<plays folder name>" [level=1]',
    ]);
  });
});
