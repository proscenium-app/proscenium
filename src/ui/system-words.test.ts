// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, test } from "bun:test";
import { setKeyStyle } from "./keys";
import { setOwnTrashDays } from "../storage/own-trash";
import {
  accentName,
  accentSettings,
  chipChoices,
  chipName,
  chooseFolderNote,
  folderPanel,
  followSystem,
  forThisSystem,
  moveToTrash,
  movedToTrash,
  openSpellingMenu,
  saveAndPrintWindows,
  setSystemWords,
  storeName,
  theTrash,
  trashKeepsIt,
  trashPlace,
  trashedDetail,
  yourOtherMachines,
  type SystemWords,
} from "./system-words";

/** As src-tauri/src/lib.rs `capabilities` answers on each system. */
const MAC: SystemWords = { machine: "Mac", system: "macOS", fileManager: "Finder", trash: "Trash" };
const PC: SystemWords = {
  machine: "PC",
  system: "Windows",
  fileManager: "File Explorer",
  trash: "Recycle Bin",
};
const IPAD: SystemWords = {
  machine: "iPad",
  system: "iPadOS",
  fileManager: "Files",
  trash: "Proscenium’s Trash",
};

/** Every phrase the words make, as one system says them. */
function phrases(): string[] {
  return [
    moveToTrash(),
    movedToTrash("Practice"),
    theTrash(),
    trashPlace(),
    trashedDetail(),
    trashKeepsIt(),
    followSystem(),
    accentSettings() ?? "",
    folderPanel(),
    saveAndPrintWindows(),
    chipName("aarch64") ?? "",
    chipChoices(),
    storeName(),
    chooseFolderNote(),
    yourOtherMachines(),
    openSpellingMenu(),
  ];
}

afterEach(() => {
  setSystemWords(MAC);
  setOwnTrashDays(null);
  setKeyStyle("mac");
});

describe("a Mac's words", () => {
  test("are what the page has always said", () => {
    expect(moveToTrash()).toBe("Move to Trash");
    expect(movedToTrash("Practice")).toBe("Practice moved to Trash.");
    expect(theTrash()).toBe("the Trash");
    expect(trashedDetail()).toBe("It's in the Finder's Trash if you need it later.");
    expect(trashKeepsIt()).toBe("It goes to the Trash, where you can put it back.");
    expect(followSystem()).toBe("Follow Mac");
    expect(accentSettings()).toBe("your Mac’s Appearance settings");
    expect(chooseFolderNote()).toBe("Dropbox, an external drive, or just this Mac.");
    expect(yourOtherMachines()).toBe("your other Macs");
    expect(chipName("x86_64")).toBe("Intel");
    expect(chipChoices()).toBe("Apple silicon or Intel");
  });
});

describe("a PC's words", () => {
  test("are a PC's, as before the iPad had words of its own", () => {
    setSystemWords(PC);
    expect(moveToTrash()).toBe("Move to the Recycle Bin");
    expect(movedToTrash("Practice")).toBe("Practice moved to the Recycle Bin.");
    expect(trashedDetail()).toBe("It's in the Recycle Bin if you need it later.");
    expect(followSystem()).toBe("Follow Windows");
    expect(storeName()).toBe("the Microsoft Store");
    expect(chipName("aarch64")).toBe("Arm64");
    expect(chooseFolderNote()).toBe("Dropbox, an external drive, or just this PC.");
  });
});

describe("an iPad's words (docs/engineering/cross-platform.md#PLAT-35)", () => {
  test("call the ring a delete goes to Proscenium’s Trash, never the system's", () => {
    setSystemWords(IPAD);
    setOwnTrashDays(30);
    expect(moveToTrash()).toBe("Move to Proscenium’s Trash");
    expect(movedToTrash("Practice")).toBe("Practice moved to Proscenium’s Trash.");
    expect(theTrash()).toBe("Proscenium’s Trash");
    expect(trashPlace()).toBe("Proscenium’s Trash, on this iPad");
    // Where the writer opens it, and how long it keeps things (IOS-27).
    expect(trashedDetail()).toBe(
      "Proscenium’s Trash, on the Plays screen, keeps it for 30 days if you need it later.",
    );
    expect(trashKeepsIt()).toBe(
      "It goes to Proscenium’s Trash, on the Plays screen, where you can put it back within 30 days.",
    );
  });

  test("say no span the record did not give", () => {
    setSystemWords(IPAD);
    expect(trashedDetail()).toBe(
      "Proscenium’s Trash, on the Plays screen, keeps it if you need it later.",
    );
    expect(trashKeepsIt()).toBe(
      "It goes to Proscenium’s Trash, on the Plays screen, where you can put it back.",
    );
  });

  test("name the iPad's own places and store", () => {
    setSystemWords(IPAD);
    expect(chooseFolderNote()).toBe("iCloud Drive, On My iPad, or another place in Files.");
    expect(yourOtherMachines()).toBe("your other devices");
    expect(storeName()).toBe("the App Store");
    expect(folderPanel()).toBe("the Files picker");
    expect(chipName("aarch64")).toBe("Apple silicon");
    expect(followSystem()).toBe("Follow iPad");
    expect(openSpellingMenu()).toContain("tap an underlined word");
    expect(openSpellingMenu()).toContain("⌘;");
  });

  test("offer no accent to follow: iPadOS has none of its own", () => {
    setSystemWords(IPAD);
    expect(accentSettings()).toBeNull();
    // Light and dark still follow the iPad.
    expect(accentName({ id: "system", name: "Follow Mac" })).toBe("Follow iPad");
  });

  test("never name a Mac, macOS, Finder, a PC or Windows", () => {
    setSystemWords(IPAD);
    for (const said of phrases()) {
      // A lock is undone in Finder on a Mac (storage/save-failure.ts), but no
      // phrase here sends an iPad writer to a Mac's place.
      expect([said, /\bMacs?\b|macOS|Finder|\bPCs?\b|Windows|Recycle Bin/.test(said)]).toEqual([
        said,
        false,
      ]);
    }
  });

  test("keep a sentence's chords a Mac's, and change only what is a Mac's", () => {
    setSystemWords(IPAD);
    const mac =
      "Bold, Italic and Underline are also ⌘B, ⌘I and ⌘U. ⌘Return is the shortcut. Shift–Return too; Return ends it.";
    expect(forThisSystem(mac)).toBe(mac);
    expect(forThisSystem("Every practice play is kept on this Mac.")).toBe(
      "Every practice play is kept on this iPad.",
    );
    expect(
      forThisSystem(
        "Export PDF… opens the Mac's Save window and Print… its Print window; Cancel in either comes back here. Neither happens unless you choose it.",
      ),
    ).toBe(
      "Export PDF… opens the share sheet and Print… the print options; closing either comes back here. Neither happens unless you choose it.",
    );
  });
});
