// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";

import { fileName, nameMatchesTitle, titleFromFileName, uniqueFileName } from "./filename";

describe("fileName", () => {
  it("keeps the writer's name, spaces and capitals and all", () => {
    // The whole point: what you type is what Finder shows. A slug would have
    // made this "act-two-the-problem".
    expect(fileName("Act two, the problem")).toBe("Act two, the problem");
    expect(fileName("The Weight of Water")).toBe("The Weight of Water");
    expect(fileName("1953")).toBe("1953");
  });

  it("removes only what a filesystem cannot hold", () => {
    expect(fileName("Act 1/2")).toBe("Act 12");
    expect(fileName('who: "why?"')).toBe("who why");
    expect(fileName("a\\b*c<d>e|f")).toBe("abcdef");
  });

  it("never produces a hidden file", () => {
    // A leading dot would hide it from Finder AND from the reconciler, which
    // skips dotfiles — the note would vanish from the binder on the next scan.
    expect(fileName(".idea")).toBe("idea");
    expect(fileName("...")).toBe("Untitled");
  });

  it("normalizes whitespace and refuses to end on a dot or space", () => {
    // Windows drops both silently, which would make the name on disk differ
    // from the name in the binder on a synced copy.
    expect(fileName("  spaced   out  ")).toBe("spaced out");
    expect(fileName("Scene 4.")).toBe("Scene 4");
  });

  it("always yields something openable", () => {
    expect(fileName("")).toBe("Untitled");
    expect(fileName("///")).toBe("Untitled");
    expect(fileName("CON")).toBe("CON-file"); // reserved on Windows
    expect(fileName("x".repeat(400)).length).toBeLessThanOrEqual(120);
  });
});

describe("titleFromFileName", () => {
  it("is the inverse: the stem, verbatim", () => {
    expect(titleFromFileName("notes/Act two, the problem.md")).toBe("Act two, the problem");
    expect(titleFromFileName("Mara.md")).toBe("Mara");
    // Only the LAST extension goes, so a year in the name survives.
    expect(titleFromFileName("research/Notes on 1953.md")).toBe("Notes on 1953");
  });

  it("round-trips any name it produced", () => {
    for (const raw of ["Act two", "who: why?", "  a  b ", "1953", "The Weight of Water"]) {
      const name = fileName(raw);
      expect(titleFromFileName(`dir/${name}.md`)).toBe(name);
    }
  });

  it("keeps a dotfile's name rather than emptying it", () => {
    expect(titleFromFileName(".gitkeep")).toBe(".gitkeep");
  });
});

describe("nameMatchesTitle", () => {
  it("answers whether disk has to move at all", () => {
    expect(nameMatchesTitle("notes/Act two.md", "Act two")).toBe(true);
    // Same title, illegal characters stripped — the file is already right.
    expect(nameMatchesTitle("notes/Act 12.md", "Act 1/2")).toBe(true);
    expect(nameMatchesTitle("notes/act-two.md", "Act two")).toBe(false);
  });
});

describe("uniqueFileName", () => {
  it("counts up past a name that is taken, whatever its case", () => {
    expect(uniqueFileName("Lear", ["Hamlet"])).toBe("Lear");
    expect(uniqueFileName("Lear", ["lear", "Lear 2"])).toBe("Lear 3");
  });

  it("sees a decomposed name on disk as the composed name typed here", () => {
    // A play made from an .fdx titled "Pièce" beside a folder the
    // disk lists decomposed: one name to APFS, so the new play must not
    // land in (and write over) the existing one.
    const onDisk = "Pi\u00e8ce".normalize("NFD");
    const typed = "Pi\u00e8ce".normalize("NFC");
    expect(onDisk === typed).toBe(false);
    expect(uniqueFileName(typed, [onDisk])).toBe(`${typed} 2`);
    expect(uniqueFileName(onDisk, [typed.toUpperCase()])).toBe(`${typed} 2`);
    expect(fileName(onDisk)).toBe(typed);
  });
});

// The stem before the first dot is what Windows reserves.
import { test as a222, expect as a222expect } from "bun:test";
a222("a reserved stem with an extension is still reserved", () => {
  a222expect(fileName("CON.txt")).toBe("CON-file.txt");
  a222expect(fileName("con")).toBe("con-file");
  a222expect(fileName("Console.txt")).toBe("Console.txt");
  a222expect(fileName("Notes on 1953.md")).toBe("Notes on 1953.md");
});
