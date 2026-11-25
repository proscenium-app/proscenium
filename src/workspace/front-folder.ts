// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A script's pages before the script, kept as files
 * (docs/app/formatting/formats-and-layout.md#FMT-169): one Markdown file per
 * page in a binder folder the play file names against the script
 * (`scripts[<id>].frontMatter.folder`). The folder's own name means nothing
 * (docs/app/keeping-work/storage-and-file-format.md#STOR-27): the writer may
 * rename it or move it, and its files, in binder order, are the pages.
 *
 * Until a script has a folder its pages print from its title page's keys, as
 * they always did. The first edit of one writes them as files and takes the
 * keys out of the script (`withoutPageKeys`), and nothing is written before
 * that edit (docs/app/keeping-work/storage-and-file-format.md#STOR-75).
 */
import type { FrontMatter, FrontPageSource } from "../fountain/model";
import { findItem, titleOf } from "./binder";
import { scriptDataFor, type BinderItem, type PlayFile } from "./play-file";

/** The title page's keys that held pages; the script keeps the facts (title, credit, authors…). */
const PAGE_KEYS = [
  "titlePage",
  "charactersPage",
  "openingNotes",
  "openingNotesBeforeCharacters",
  "productionNotes",
  "characters",
  "setting",
  "time",
  "place",
] as const satisfies readonly (keyof FrontMatter)[];

/** Whether the script's title page still holds a page, or a key that only a page used. */
export function hasPageKeys(fm: FrontMatter): boolean {
  return PAGE_KEYS.some((key) => fm[key] !== undefined);
}

/** The front matter without the keys that held pages: what the script keeps once its pages are files. */
export function withoutPageKeys(fm: FrontMatter): FrontMatter {
  const next: FrontMatter = { ...fm };
  for (const key of PAGE_KEYS) delete next[key];
  return next;
}

/**
 * Which side of the script a folder's pages print on: before it, or after it
 * (docs/app/formatting/formats-and-layout.md#FMT-174).
 */
export type PageSide = "front" | "back";

/** What a folder of pages is called when the app makes one, and in what it says of it. */
export const SIDE_NAME: Record<PageSide, string> = {
  front: "Front Matter",
  back: "Back Matter",
};

/** The binder id of the folder that holds a script's pages, if the play file names one. */
export function frontFolderId(play: PlayFile | null, scriptId: string | null): string | undefined {
  if (!play || !scriptId) return undefined;
  return scriptDataFor(play, scriptId).frontMatter?.folder;
}

/** The binder id of the folder that holds a script's pages after the script, if the play file names one. */
export function backFolderId(play: PlayFile | null, scriptId: string | null): string | undefined {
  if (!play || !scriptId) return undefined;
  return scriptDataFor(play, scriptId).backMatter?.folder;
}

/** The folder of a script's pages on one side, if the play file names one. */
export function pageFolderId(
  play: PlayFile | null,
  scriptId: string | null,
  side: PageSide,
): string | undefined {
  return side === "front" ? frontFolderId(play, scriptId) : backFolderId(play, scriptId);
}

/**
 * Whose pages a binder folder holds, and on which side of that script they
 * print: null for a folder no script names as its pages'.
 */
export function pageFolderOf(
  play: PlayFile | null,
  folderId: string,
): { scriptId: string; side: PageSide } | null {
  for (const [scriptId, data] of Object.entries(play?.scripts ?? {})) {
    if (data.frontMatter?.folder === folderId) return { scriptId, side: "front" };
    if (data.backMatter?.folder === folderId) return { scriptId, side: "back" };
  }
  return null;
}

/** A row the page list reads: a Markdown file. A folder inside, or any other file, is not a page. */
function isPage(item: BinderItem): boolean {
  return !item.children && /\.md$/i.test(item.path);
}

/**
 * The pages a script's folder holds, in binder order: none when the folder
 * has gone (the writer removed it, and with it the pages). `undefined` when
 * the script has no folder: its pages are still its title page's keys.
 */
export function frontPageItems(
  binder: BinderItem[],
  play: PlayFile | null,
  scriptId: string | null,
): BinderItem[] | undefined {
  const id = frontFolderId(play, scriptId);
  if (id === undefined) return undefined;
  return (findItem(binder, id)?.item.children ?? []).filter(isPage);
}

/**
 * The pages a script's Back Matter folder holds, in binder order: none when
 * the script names no such folder, or the folder has gone.
 */
export function backPageItems(
  binder: BinderItem[],
  play: PlayFile | null,
  scriptId: string | null,
): BinderItem[] {
  const id = backFolderId(play, scriptId);
  if (id === undefined) return [];
  return (findItem(binder, id)?.item.children ?? []).filter(isPage);
}

/** A page as the layout takes it. */
export function frontPageSource(item: BinderItem, text: string): FrontPageSource {
  return { id: item.id, name: titleOf(item), text };
}
