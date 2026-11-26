// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, mock } from "bun:test";

// The play's file, as the vault holds it. Every write is written down, so a
// test can say that nothing was written at all.
const store = new Map<string, string>();
const writes: string[] = [];
const hashOf = (s: string) =>
  `${s.length}:${[...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)}`;

mock.module("../storage", () => ({
  vault: {
    async read(rel: string) {
      const content = store.get(rel);
      if (content === undefined) throw new Error(`ENOENT ${rel}`);
      return { content, hash: hashOf(content) };
    },
    async write(rel: string, content: string) {
      writes.push(rel);
      store.set(rel, content);
      return { status: "ok" as const, hash: hashOf(content) };
    },
  },
  formats: { listUser: async () => [] },
}));

const { commitPlay, readPlayFile, serializePlay } = await import("./play-file");
type PlayFile = Parameters<typeof serializePlay>[0];

const REL = "Tide/Tide.proscenium";
const NOW = "2026-11-04T23:00:00.000Z";

function play(): PlayFile {
  return {
    kind: "proscenium/play",
    id: "p1",
    schemaVersion: 1,
    created: "2026-10-14T00:00:00Z",
    modified: "2026-10-14T00:00:00Z",
    generator: { app: "Proscenium", version: "1.0.0" },
    settings: {},
    scripts: {},
    binder: [{ id: "i1", type: "script", path: "Tide.fountain" }],
  } as PlayFile;
}

describe("a play's file is never written in a shape its reader refuses", () => {
  it("leaves the file as it was when a change would give the binder an absolute path", async () => {
    store.set(REL, serializePlay(play()));
    writes.length = 0;
    const before = store.get(REL);
    const base = await readPlayFile(REL);
    if (base.status !== "valid") throw new Error("the test's play must read as valid");

    // What an iPad wrote: its own absolute path for a folder the binder knows.
    const out = await commitPlay(
      REL,
      base,
      (prior) =>
        ({
          ...prior,
          binder: [
            ...(prior?.binder ?? []),
            {
              id: "i2",
              type: "folder",
              path: "/var/mobile/Library/Mobile Documents/com~apple~CloudDocs/Plays/Tide/Notes",
            },
          ],
        }) as PlayFile,
      NOW,
    );

    expect(out.status).toBe("stale");
    expect(writes).toEqual([]);
    expect(store.get(REL)).toBe(before);
    expect((await readPlayFile(REL)).status).toBe("valid");
  });

  it("still writes a change whose binder stays inside the play", async () => {
    store.set(REL, serializePlay(play()));
    writes.length = 0;
    const base = await readPlayFile(REL);
    if (base.status !== "valid") throw new Error("the test's play must read as valid");

    const out = await commitPlay(
      REL,
      base,
      (prior) =>
        ({
          ...prior,
          binder: [...(prior?.binder ?? []), { id: "i2", type: "folder", path: "Notes" }],
        }) as PlayFile,
      NOW,
    );

    expect(out.status).toBe("ok");
    expect(writes).toEqual([REL]);
  });
});
