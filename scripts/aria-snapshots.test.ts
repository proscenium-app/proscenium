// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import {
  acceptPlan,
  keepTree,
  keepVariantTree,
  normalize,
  renderWebKitTree,
} from "./aria-snapshots.mjs";

describe("a run's trees, kept as --update-aria would write the folder", () => {
  test("the light reading is the surface's file; the dark one has a file only where it differs", () => {
    const kept = new Map<string, string>();
    expect(keepTree(kept, ["about.yml"], "- heading")).toBe("about.yml");
    expect(keepTree(kept, ["about.dark.yml", "about.yml"], "- heading")).toBe("about.yml");
    expect(keepTree(kept, ["export.yml"], "- dialog")).toBe("export.yml");
    expect(keepTree(kept, ["export.dark.yml", "export.yml"], "- dialog [dark]")).toBe(
      "export.dark.yml",
    );
    expect([...kept]).toEqual([
      ["about.yml", "- heading"],
      ["export.yml", "- dialog"],
      ["export.dark.yml", "- dialog [dark]"],
    ]);
  });

  test("taking them writes what is new or changed, and removes only after a whole run", () => {
    const present = new Map([
      ["about.yml", "old"],
      ["binder.yml", "same"],
      ["gone.yml", "x"],
    ]);
    const wanted = new Map([
      ["about.yml", "new"],
      ["binder.yml", "same"],
      ["cast.yml", "first"],
    ]);
    expect(acceptPlan(present, wanted, { whole: true })).toEqual({
      changed: ["about.yml", "cast.yml"],
      gone: ["gone.yml"],
    });
    expect(acceptPlan(present, wanted, { whole: false }).gone).toEqual([]);
  });

  test("a variant's own files go only when that variant read every surface it could", () => {
    const present = new Map([
      ["plays.yml", "x"],
      ["plays.de.yml", "x"],
      ["plays.ja.yml", "x"],
    ]);
    const wholeFor = (f: string) => f.endsWith(".de.yml");
    expect(acceptPlan(present, new Map(), { whole: false, wholeFor })).toEqual({
      changed: [],
      gone: ["plays.de.yml"],
    });
  });
});

describe("a variant pass's trees, kept only where the variant reads a surface otherwise", () => {
  const isVariant = (f: string) => /\.de(\.dark)?\.yml$/.test(f);

  test("a reading the PC copy's own file already says is kept as nothing new", () => {
    const kept = new Map<string, string>();
    const plain = new Map([["about.yml", "- heading"]]);
    const readPlain = (f: string) => plain.get(f);
    expect(
      keepVariantTree(kept, ["about.de.yml", "about.yml"], "- heading", { isVariant, readPlain }),
    ).toBe("about.yml");
    expect(
      keepVariantTree(
        kept,
        ["about.de.dark.yml", "about.de.yml", "about.dark.yml", "about.yml"],
        "- heading",
        {
          isVariant,
          readPlain,
        },
      ),
    ).toBe("about.yml");
    expect([...kept]).toEqual([]);
  });

  test("a reading of its own is the variant's file, and its dark reading inherits it", () => {
    const kept = new Map<string, string>();
    const readPlain = (f: string) => (f === "plays.yml" ? "- row: Jan 5" : undefined);
    expect(
      keepVariantTree(kept, ["plays.de.yml", "plays.yml"], "- row: 5. Jan.", {
        isVariant,
        readPlain,
      }),
    ).toBe("plays.de.yml");
    expect(
      keepVariantTree(
        kept,
        ["plays.de.dark.yml", "plays.de.yml", "plays.dark.yml", "plays.yml"],
        "- row: 5. Jan.",
        {
          isVariant,
          readPlain,
        },
      ),
    ).toBe("plays.de.yml");
    expect([...kept]).toEqual([["plays.de.yml", "- row: 5. Jan."]]);
  });
});

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

  test("the folder a launch's Plays folder sits in reads as the in-memory vault's /dev", () => {
    const home = "/private/var/folders/_h/xyz/T/proscenium-selftest-17230";
    const text = [
      `- button "${home}/4/dev/plays-4/The Weight of Water"`,
      `- button "${home}/4/dev/plays-4"`,
      `- paragraph: ${home}/4/dev/outside/Draft.fountain`,
      `- button "${home}/12/dev"`,
    ].join("\n");
    expect(normalize(text).split("\n")).toEqual([
      '- button "<plays folder>/The Weight of Water"',
      '- button "<plays folder>"',
      "- paragraph: /dev/outside/Draft.fountain",
      '- button "/dev"',
    ]);
  });

  test("a burst from outside is its row, not how many saves the system told apart", () => {
    const said = (line: string) => normalize(line);
    // The same burst, as two runs of a real Mac heard it.
    expect(said('- button "Changed somewhere else 9:02 PM Jonah · 3 saves 2 words cut"')).toBe(
      said('- button "Changed somewhere else 9:02 PM Jonah · 4 saves 1 word cut"'),
    );
    expect(
      said(
        "- 'button \"Changed somewhere else New 9:02 PM The Weight of Water · 3 saves ACT ONE: SCENE 1 4 words added and 1 cut\"' [current=true]",
      ),
    ).toBe(
      "- 'button \"Changed somewhere else New <time> The Weight of Water · <a burst of saves>\"' [current=true]",
    );
    // One change on its own, and the writer's own sittings, keep their words.
    expect(
      said('- button "Changed somewhere else New 9:02 PM Mara 20 words added and 8 cut"'),
    ).toBe('- button "Changed somewhere else New <time> Mara 20 words added and 8 cut"');
    expect(said('- button "You wrote 9:02 PM The Weight of Water · 3 saves 1 word added"')).toBe(
      '- button "You wrote <time> The Weight of Water · 3 saves 1 word added"',
    );
  });

  test("a date and a time in German or Japanese read as they do in English", () => {
    const said = (lines: string[]) => normalize(lines.join("\n")).split("\n");
    const english = said([
      '- cell "Jan 5, 2026, 9:00 AM"',
      "- text: Saved · 10:10 PM",
      '- button "Saved copy of Outline.md 10/15/2026, 10:15:06 PM"',
      '- button "You wrote 10:14 PM The Weight of Water"',
      "- paragraph: Version 1.0.2",
    ]);
    for (const [date, at, copy] of [
      ["5. Jan. 2026, 9:00", "22:10", "15.10.2026, 22:15:06"],
      ["5. Sept. 2026, 9:00", "22:10", "15.10.2026, 22:15:06"],
      ["2026年1月5日 9:00", "22:10", "2026/10/15 22:15:06"],
    ])
      expect(
        said([
          `- cell "${date}"`,
          `- text: Saved · ${at}`,
          `- button "Saved copy of Outline.md ${copy}"`,
          `- button "You wrote ${at} The Weight of Water"`,
          "- paragraph: Version 1.0.2",
        ]),
      ).toEqual(english);
  });

  test("About's version line holds no chip, so one tree serves both of a system's", () => {
    const lines = ["x64", "Arm64", "Apple silicon", "Intel"].map(
      (chip) => `    - paragraph: Version 1.0.2-alpha.799 · ${chip}`,
    );
    expect(new Set(normalize(lines.join("\n")).split("\n"))).toEqual(
      new Set(["    - paragraph: Version <version> · <chip>"]),
    );
    // The browser's preview is no chip, and stays as it reads.
    expect(normalize("    - paragraph: Version 1.0.2 · browser preview")).toBe(
      "    - paragraph: Version <version> · browser preview",
    );
  });
});

test("the sandboxed self-test's home, in its container under its own bundle id, reads as the unsandboxed one's (docs/engineering/release-engineering.md#REL-56)", () => {
  const sandboxed =
    '- button "/Users/x/Library/Containers/org.habiby.proscenium.sandbox.selftest/Data/tmp/proscenium-selftest-68651/home/Library/Application Support/org.habiby.proscenium.sandbox.selftest/tutorials"';
  const unsandboxed =
    '- button "/private/var/folders/_h/l0c5sd/T/proscenium-selftest-412/home/Library/Application Support/org.habiby.proscenium.selftest/tutorials"';
  expect(normalize(sandboxed)).toBe(normalize(unsandboxed));
  expect(normalize(sandboxed)).toBe(
    '- button "<self-test home>/home/Library/Application Support/org.habiby.proscenium.selftest/tutorials"',
  );
});
