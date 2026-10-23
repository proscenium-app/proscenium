// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What this system calls the things a writer is told about
 * (docs/engineering/cross-platform.md#PLAT-35): Finder or File Explorer, the
 * Trash or the Recycle Bin, this Mac or this PC. From the capability record,
 * given to the page at boot (main.tsx), so a component says
 * `systemWords().fileManager` and never asks which system it is on.
 */

import { keys } from "./keys";

export interface SystemWords {
  /** `Mac` or `PC`. */
  machine: string;
  /** `macOS` or `Windows`. */
  system: string;
  /** `Finder` or `File Explorer`. */
  fileManager: string;
  /** `Trash` or `Recycle Bin`. */
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

/** Whether the words are a Mac's: the phrases below keep a Mac's own exactly. */
const onMac = () => words.machine === "Mac";

/** The button that moves something there: "Move to Trash", "Move to the Recycle Bin". */
export const moveToTrash = (): string => (onMac() ? "Move to Trash" : "Move to the Recycle Bin");

/** Where it went: "the Trash", "the Recycle Bin". */
export const theTrash = (): string => (onMac() ? "the Trash" : "the Recycle Bin");

/** Where it can be found again: "the Finder's Trash", "the Recycle Bin". */
export const trashPlace = (): string => (onMac() ? "the Finder's Trash" : "the Recycle Bin");

/** The accent and scheme that follow the system: "Follow Mac", "Follow Windows". */
export const followSystem = (): string => (onMac() ? "Follow Mac" : "Follow Windows");

/** An accent's name: the one that follows the system says which system. */
export const accentName = (accent: { id: string; name: string }): string =>
  accent.id === "system" ? followSystem() : accent.name;

/** Where the system's accent is chosen. */
export const accentSettings = (): string =>
  onMac() ? "your Mac’s Appearance settings" : "Windows’ Personalization › Colors settings";

/** The system's own folder panel. */
export const folderPanel = (): string =>
  onMac() ? "the Mac’s folder panel" : "Windows’ folder picker";

/** The system's own Save and Print windows, together. */
export const saveAndPrintWindows = (): string =>
  onMac() ? "the Mac's Save window" : "Windows' Save window";

/** A chip as the system names it: "Apple silicon" or "Intel", "Arm64" or "x64". */
export function chipName(arch: string): string | null {
  if (arch === "aarch64") return onMac() ? "Apple silicon" : "Arm64";
  if (arch === "x86_64") return onMac() ? "Intel" : "x64";
  return null;
}

/** The store that updates a store's copy. */
export const storeName = (): string => (onMac() ? "the App Store" : "the Microsoft Store");

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
 * A sentence written for a Mac, as this system says it, at render: on a Mac
 * it is returned as written; on a PC its chords are written in words
 * (ui/keys.ts), Return is Enter, and a phrase only a Mac says is the PC's.
 */
export function forThisSystem(text: string): string {
  if (onMac()) return text;
  let out = text;
  for (const [mac, pc] of PC_PHRASES) out = out.split(mac).join(pc);
  return out
    .replace(/[⌃⌥⇧⌘]+(?:Return|[^\s,.;:)·]+)/g, (chordText) =>
      keys(chordText.replace("Return", "⏎")),
    )
    .replace(/Shift–Return/g, "Shift–Enter")
    .replace(/\bReturn\b/g, "Enter");
}

/** Whether the words are a Mac's, for a sentence whose shape differs. */
export const onMacWords = (): boolean => onMac();
