// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { vault } from "../storage";
import { tutorials, type PracticeSource } from "../storage/ipc";
import { fileName, uniqueFileName } from "../workspace/filename";
import { readPlayFile, serializePlay } from "../workspace/play-file";
import { ulid } from "../workspace/ulid";

/** Capture only after every practice buffer has landed, while its vault is open. */
export const copyPractice = {
  async capture(manifestPath: string): Promise<{files: Map<string, string | null>; manifestPath: string}> {
    const files = new Map<string, string | null>();
    async function walk(dir: string) {
      for (const entry of await vault.list(dir)) {
        if (entry.isSyncArtifact) continue;
        if (entry.isDir) await walk(entry.relPath);
        else files.set(entry.relPath, null);
      }
    }
    await walk("");
    const loaded = await readPlayFile(manifestPath);
    if (loaded.status !== "valid") throw new Error("Practice details could not be read. The original is kept.");
    // New identity: the retained original and portable copy must never share recovery history.
    files.set(manifestPath, serializePlay({ ...loaded.data, id: ulid() }));
    return {files, manifestPath};
  },
  async install(source: PracticeSource, title: string, captured: {files: Map<string, string | null>; manifestPath: string}): Promise<string> {
    const {files, manifestPath} = captured;
    const dir = uniqueFileName(fileName(title.trim() || "My Practice"), (await vault.list("")).map((e) => e.name));
    const manifest = files.get(manifestPath);
    if (!manifest) throw new Error("The practice has no play details. Nothing was copied.");
    await tutorials.reserveCopy(dir);
    for (const [relative] of files) {
      if (relative === manifestPath) continue;
      await tutorials.copyFile(source, relative, `${dir}/${relative}`);
    }
    // Discovery signal last, using the normal play-folder contract.
    await vault.create(`${dir}/${dir}.proscenium`, manifest);
    if ((await vault.read(`${dir}/${dir}.proscenium`)).content !== manifest) throw new Error("The copy could not be verified. Your original practice is kept.");
    return dir;
  },
};
