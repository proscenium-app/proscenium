// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import {
  playsFolderHint,
  playsFolderRefusal,
  providerKind,
  providerName,
  wherePlaysLive,
  type FolderFacts,
} from "./plays-folder";

const folder = (path: string, patch: Partial<FolderFacts> = {}): FolderFacts => ({
  path,
  isPlay: false,
  insidePlay: null,
  providers: [],
  listable: true,
  ...patch,
});

describe("what may be the Plays folder (docs/app/keeping-work/storage-and-file-format.md#STOR-D2)", () => {
  it("an ordinary folder may", () => {
    expect(playsFolderRefusal(folder("/Users/w/Documents/Plays"), null)).toBeNull();
    expect(
      playsFolderRefusal(folder("/Users/w/Dropbox/Plays", { providers: ["dropbox"] }), null),
    ).toBeNull();
  });

  it("the Plays folder already open may be chosen again", () => {
    expect(
      playsFolderRefusal(folder("/Users/w/Plays"), { path: "/Users/w/Plays/", plays: 4 }),
    ).toBeNull();
  });

  it("refuses a play, pointing at the folder that holds it", () => {
    expect(playsFolderRefusal(folder("/Users/w/Plays/The Tide", { isPlay: true }), null)).toBe(
      "“The Tide” is a play. Choose the folder that holds your plays.",
    );
  });

  it("refuses a folder inside a play", () => {
    const refusal = playsFolderRefusal(
      folder("/Users/w/Plays/The Tide/Research", { insidePlay: "/Users/w/Plays/The Tide" }),
      null,
    );
    expect(refusal).toContain("inside the play “The Tide”");
  });

  it("refuses a folder two providers both keep, naming them", () => {
    const refusal = playsFolderRefusal(
      folder("/Users/w/Library/Mobile Documents/com~apple~CloudDocs/Shared/Plays", {
        providers: ["icloud", "syncthing"],
      }),
      null,
    );
    expect(refusal).toContain("in both iCloud Drive and Syncthing");
    // Writer-facing words only (docs/app/keeping-work/storage-and-file-format.md#STOR-D1).
    expect(refusal).not.toMatch(/sync(?!thing)|vault|conflict/i);
  });

  it("refuses a Plays folder nested in the open one, when nesting is asked about", () => {
    const open = { path: "/Users/w/Plays", plays: 4 };
    const refusal = playsFolderRefusal(folder("/Users/w/Plays/Old"), open);
    expect(refusal).toContain("inside your Plays folder, “Plays”");
    // A folder beside it, or holding it, is not nested in it.
    expect(playsFolderRefusal(folder("/Users/w/Plays 2"), open)).toBeNull();
    expect(playsFolderRefusal(folder("/Users/w"), open)).toBeNull();
  });

  it("lets a folder inside an open Plays folder that holds no plays be chosen", () => {
    // Chosen one level too high: the plays are in a folder inside it, and
    // refusing that folder left no way down to them but a detour.
    const open = { path: "/Users/w/iCloud/Writing", plays: 0 };
    expect(playsFolderRefusal(folder("/Users/w/iCloud/Writing/Plays"), open)).toBeNull();
    // Everything else is still refused inside it.
    expect(
      playsFolderRefusal(folder("/Users/w/iCloud/Writing/Plays/Running", { isPlay: true }), open),
    ).toContain("is a play");
  });
});

describe("a Plays folder chosen one level too high (docs/app/keeping-work/storage-and-file-format.md#STOR-D2, docs/app/keeping-work/storage-and-file-format.md#STOR-D12)", () => {
  it("says where the plays look to be, in one sentence", () => {
    expect(playsFolderHint(0, [{ dir: "Plays", plays: 4 }])).toEqual({
      folders: [{ dir: "Plays", plays: 4 }],
      sentence: "Your plays look like they are in “Plays” inside this folder.",
    });
  });

  it("is a suggestion only where there is something to suggest", () => {
    // An empty folder is a legitimate new Plays folder.
    expect(playsFolderHint(0, [])).toBeNull();
    expect(playsFolderHint(0, [{ dir: "Research", plays: 0 }])).toBeNull();
    // A folder that holds plays is the Plays folder, whatever is inside its folders.
    expect(playsFolderHint(1, [{ dir: "Plays", plays: 4 }])).toBeNull();
  });

  it("offers the folder with the most plays first, then by name", () => {
    const hint = playsFolderHint(0, [
      { dir: "Old", plays: 1 },
      { dir: "Plays", plays: 4 },
      { dir: "Drafts", plays: 1 },
    ]);
    expect(hint?.folders.map((f) => f.dir)).toEqual(["Plays", "Drafts", "Old"]);
    expect(hint?.sentence).toBe(
      "Your plays look like they are in “Plays”, “Drafts”, and “Old” inside this folder.",
    );
    expect(
      playsFolderHint(0, [
        { dir: "B", plays: 2 },
        { dir: "A", plays: 2 },
      ])?.sentence,
    ).toBe("Your plays look like they are in “A” and “B” inside this folder.");
  });

  it("names three folders and counts the rest", () => {
    const below = ["A", "B", "C", "D", "E"].map((dir) => ({ dir, plays: 1 }));
    const hint = playsFolderHint(0, below);
    expect(hint?.folders).toHaveLength(3);
    expect(hint?.sentence).toBe(
      "Your plays look like they are in “A”, “B”, “C”, and 2 other folders inside this folder.",
    );
    expect(playsFolderHint(0, below.slice(0, 4))?.sentence).toContain(
      "“C”, and 1 other folder inside",
    );
    // Writer-facing words only (docs/app/keeping-work/storage-and-file-format.md#STOR-D1).
    expect(hint?.sentence).not.toMatch(/vault|sync|project/i);
  });
});

describe("where the plays live, in one sentence (docs/app/keeping-work/storage-and-file-format.md#STOR-D11)", () => {
  it("says so plainly when they are on this Mac only", () => {
    expect(wherePlaysLive([])).toBe(
      "Your plays live in a folder on this Mac only. They will not appear on other devices.",
    );
    expect(providerKind([])).toBe("local");
  });

  it("names the provider that keeps them", () => {
    expect(wherePlaysLive(["icloud"])).toBe(
      "Your plays live in iCloud Drive and appear on your other devices.",
    );
    expect(wherePlaysLive(["dropbox"])).toContain("in Dropbox");
    expect(wherePlaysLive(["google-drive"])).toContain("in Google Drive");
    expect(wherePlaysLive(["syncthing"])).toContain("Syncthing folder");
    expect(providerKind(["dropbox"])).toBe("dropbox");
  });

  it("names a File Provider it does not know by its own name", () => {
    expect(providerName("pcloud")).toBe("Pcloud");
  });
});
