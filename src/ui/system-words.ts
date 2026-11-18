// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What this system calls the things a writer is told about
 * (docs/engineering/cross-platform.md#PLAT-35): Finder, File Explorer or Files,
 * the Trash, the Recycle Bin or Proscenium’s own, this Mac, this PC or this
 * iPad. From the capability record, given to the page at boot (main.tsx), so a
 * component says `systemWords().fileManager` and never asks which system it is
 * on.
 */

import { keys } from "./keys";
import { ownTrashDays } from "../storage/own-trash";

export interface SystemWords {
  /** `Mac`, `PC` or `iPad`. */
  machine: string;
  /** `macOS`, `Windows` or `iPadOS`. */
  system: string;
  /** `Finder`, `File Explorer` or `Files`. */
  fileManager: string;
  /**
   * `Trash`, `Recycle Bin`, or `Proscenium’s Trash`: an iPad has no system
   * trash, so a delete goes to a ring the app keeps on the device.
   */
  trash: string;
}

const MAC: SystemWords = {
  machine: "Mac",
  system: "macOS",
  fileManager: "Finder",
  trash: "Trash",
};

let words: SystemWords = MAC;

export function setSystemWords(next: SystemWords): void {
  words = next;
}

export function systemWords(): SystemWords {
  return words;
}

/** How long Proscenium’s Trash keeps things, " for 30 days", or nothing where the record did not say. */
const span = (word: "for" | "within"): string => {
  const days = ownTrashDays();
  return days === null ? "" : ` ${word} ${days} days`;
};

/**
 * Whose words these are, by the record's machine. Anything that is neither a
 * Mac nor an iPad says a PC's, as every system but a Mac did before the iPad
 * had words of its own.
 */
const kind = (): "mac" | "pc" | "ipad" =>
  words.machine === "Mac" ? "mac" : words.machine === "iPad" ? "ipad" : "pc";

/** One phrase as each system says it. */
function said<T>(mac: T, pc: T, ipad: T): T {
  return { mac, pc, ipad }[kind()];
}

/** What a delete moves something to: "Trash", "the Recycle Bin", "Proscenium’s Trash". */
const trashName = (): string => said("Trash", "the Recycle Bin", "Proscenium’s Trash");

/** The button that moves something there: "Move to Trash", "Move to the Recycle Bin". */
export const moveToTrash = (): string => `Move to ${trashName()}`;

/** That it went there, said aloud: "Practice moved to Trash." */
export const movedToTrash = (what: string): string => `${what} moved to ${trashName()}.`;

/** Where it went: "the Trash", "the Recycle Bin", "Proscenium’s Trash". */
export const theTrash = (): string => said("the Trash", "the Recycle Bin", "Proscenium’s Trash");

/**
 * Where it can be found again: "the Finder's Trash", "the Recycle Bin", or on
 * an iPad "Proscenium’s Trash, on this iPad", which is no system's and is never
 * synced to another device.
 */
export const trashPlace = (): string =>
  said("the Finder's Trash", "the Recycle Bin", "Proscenium’s Trash, on this iPad");

/**
 * The second line of a delete's toast: where it went. An iPad's says where
 * Proscenium’s Trash is opened, and how long it keeps things, since it is no
 * system's and the writer will not find it anywhere else.
 */
export const trashedDetail = (): string =>
  said(
    `It's in ${trashPlace()} if you need it later.`,
    `It's in ${trashPlace()} if you need it later.`,
    `Proscenium’s Trash, on the Plays screen, keeps it${span("for")} if you need it later.`,
  );

/** What moving a copy there does, for the question that asks first. */
export const trashKeepsIt = (): string =>
  said(
    "It goes to the Trash, where you can put it back.",
    "It goes to the Recycle Bin, where you can put it back.",
    `It goes to Proscenium’s Trash, on the Plays screen, where you can put it back${span("within")}.`,
  );

/** The scheme, and the accent, that follow the system: "Follow Mac", "Follow Windows", "Follow iPad". */
export const followSystem = (): string => said("Follow Mac", "Follow Windows", "Follow iPad");

/** An accent's name: the one that follows the system says which system. */
export const accentName = (accent: { id: string; name: string }): string =>
  accent.id === "system" ? followSystem() : accent.name;

/**
 * Where the system's accent is chosen, or null where there is none to follow:
 * iPadOS has no accent of its own (src-tauri/src/accent.rs answers nothing off
 * a Mac and a PC), so Appearance offers no Follow iPad accent.
 */
export const accentSettings = (): string | null =>
  said("your Mac’s Appearance settings", "Windows’ Personalization › Colors settings", null);

/** The system's own folder panel. */
export const folderPanel = (): string =>
  said("the Mac’s folder panel", "Windows’ folder picker", "the Files picker");

/** The system's own Save and Print windows, together. */
export const saveAndPrintWindows = (): string =>
  said("the Mac's Save window", "Windows' Save window", "the share sheet");

/** A chip as the system names it: "Apple silicon" or "Intel", "Arm64" or "x64". */
export function chipName(arch: string): string | null {
  if (arch === "aarch64") return said("Apple silicon", "Arm64", "Apple silicon");
  if (arch === "x86_64") return said("Intel", "x64", null);
  return null;
}

/** The chips an update check tells apart, for the sentence that says what it sends. */
export const chipChoices = (): string =>
  said("Apple silicon or Intel", "an x64 or an Arm64 chip", "Apple silicon");

/** The store that updates a store's copy. */
export const storeName = (): string =>
  said("the App Store", "the Microsoft Store", "the App Store");

/**
 * The Welcome screen's note under "A folder I choose…": the places a writer
 * would choose. On an iPad every place is somewhere in Files.
 */
export const chooseFolderNote = (): string =>
  said(
    "Dropbox, an external drive, or just this Mac.",
    "Dropbox, an external drive, or just this PC.",
    "iCloud Drive, On My iPad, or another place in Files.",
  );

/** Where else a play in iCloud Drive appears: "your other Macs", "your other devices". */
export const yourOtherMachines = (): string =>
  said("your other Macs", "your other PCs", "your other devices");

/** How a misspelled word's corrections are opened in a script: on an iPad, a tap. */
export const openSpellingMenu = (): string =>
  said(
    "Control-click an underlined word",
    "Control-click an underlined word",
    "tap an underlined word, or press ⌘; for the next one,",
  );

/** Whole phrases a Mac's text says that a PC's says otherwise. */
const PC_PHRASES: ReadonlyArray<readonly [string, string]> = [
  [
    "opens the Mac's Save window and Print… its Print window",
    "opens Windows' Save window, and Print… opens the PDF in your PDF app",
  ],
  ["on your other Macs", "on your other PCs"],
  ["this Mac", "this PC"],
];

/**
 * The same for an iPad, where an export goes out through the share sheet and
 * printing through the print panel, and neither has a Cancel of the Save
 * window's kind.
 */
const IPAD_PHRASES: ReadonlyArray<readonly [string, string]> = [
  [
    "opens the Mac's Save window and Print… its Print window; Cancel in either comes back here",
    "opens the share sheet and Print… the print options; closing either comes back here",
  ],
  ["on your other Macs", "on your other devices"],
  ["this Mac", "this iPad"],
];

function swapped(text: string, phrases: ReadonlyArray<readonly [string, string]>): string {
  let out = text;
  for (const [mac, theirs] of phrases) out = out.split(mac).join(theirs);
  return out;
}

/**
 * A sentence written for a Mac, as this system says it, at render: on a Mac
 * it is returned as written. An iPad's keys are a Mac's but for the chords
 * iPadOS keeps (ui/keys.ts), so its phrases change, and those chords. On a
 * PC its chords are written in words (ui/keys.ts), Return is Enter, and a
 * phrase only a Mac says is the PC's.
 */
export function forThisSystem(text: string): string {
  const system = kind();
  if (system === "mac") return text;
  if (system === "ipad")
    return swapped(text, IPAD_PHRASES).replace(/[⌃⌥⇧⌘]+[^\s,.;:)·]+/g, (chordText) =>
      keys(chordText),
    );
  return swapped(text, PC_PHRASES)
    .replace(/[⌃⌥⇧⌘]+(?:Return|[^\s,.;:)·]+)/g, (chordText) =>
      keys(chordText.replace("Return", "⏎")),
    )
    .replace(/Shift–Return/g, "Shift–Enter")
    .replace(/\bReturn\b/g, "Enter");
}
