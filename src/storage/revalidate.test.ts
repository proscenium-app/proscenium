// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "bun:test";
import { revalidateFiles } from "./revalidate";

test("docs/app/keeping-work/storage-and-file-format.md#STOR-86: foreground revalidates script, manifest, sheets and outline once", async () => {
  const events: { relPath: string; hash: string | null }[] = [];
  const paths = ["A.fountain", "Play.proscenium", "Mara.md", "Outline.md", "Mara.md"];
  await revalidateFiles(paths, async (path) => ({ hash: path }), (event) => events.push(event), () => true);
  expect(events.map((event) => event.relPath)).toEqual(paths.slice(0, 4));
});

test("docs/app/keeping-work/storage-and-file-format.md#STOR-86: a missing file is reported; a placeholder or unreadable file stays untouched", async () => {
  const events: { relPath: string; hash: string | null }[] = [];
  await revalidateFiles(["missing", "remote", "locked"], async (path) => {
    throw new Error(path === "missing" ? "ENOENT" : path === "remote" ? "This file is in iCloud and has not finished downloading yet." : "EACCES");
  }, (event) => events.push(event), () => true);
  expect(events).toEqual([{ relPath: "missing", hash: null }]);
});

test("docs/app/keeping-work/storage-and-file-format.md#STOR-86: a workspace change cancels remaining reads and late delivery", async () => {
  let current = true;
  const read: string[] = [];
  await revalidateFiles(["A", "B"], async (path) => { read.push(path); current = false; return { hash: "late" }; },
    () => { throw new Error("delivered a stale read"); }, () => current);
  expect(read).toEqual(["A"]);
});
