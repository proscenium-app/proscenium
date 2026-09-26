// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { captureDocumentScope, type DocumentContext, type DocumentIO } from "./document-scope";
import { oneAtATime } from "./one-at-a-time";

describe("document I/O belongs to its captured play", () => {
  it("rejects queued old-play writes even when the next play uses the same path", async () => {
    let current: DocumentContext = { playId: "first", generation: 1, changes: null };
    const disk = new Map<string, string>();
    const io: DocumentIO = {
      read: async () => ({ content: "", hash: "before" }),
      write: async (path, content) => {
        disk.set(`${current.playId}/${path}`, content);
        return { status: "ok", hash: content };
      },
    };
    const line = oneAtATime();
    let release!: () => void;
    const waiting = line(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await Promise.resolve();
    const first = captureDocumentScope(() => current, io);
    const staleWrite = line(() => first.io.write("Notes/Outline.md", "first play words", "before"));
    current = { playId: "second", generation: 2, changes: null };
    release();
    await waiting;
    await expect(staleWrite).rejects.toThrow("play that has closed");
    expect(disk.size).toBe(0);
    const second = captureDocumentScope(() => current, io);
    await line(() => second.io.write("Notes/Outline.md", "second play words", "before"));
    expect([...disk]).toEqual([["second/Notes/Outline.md", "second play words"]]);
  });

  it("invalidates a pending read after reopening the same play", async () => {
    let current: DocumentContext = { playId: "play", generation: 1, changes: null };
    let finish!: (value: { content: string; hash: string }) => void;
    const scope = captureDocumentScope(() => current, {
      read: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      write: async () => ({ status: "ok", hash: "unused" }),
    });
    const read = scope.io.read("Characters/Mara.md");
    current = { ...current, generation: 2 };
    finish({ content: "old read", hash: "old" });
    await read;
    expect(scope.isCurrent()).toBe(false);
    expect(() => scope.io.read("Characters/Mara.md")).toThrow("play that has closed");
  });

  it("does not grant document I/O on the Plays screen", () => {
    let calls = 0;
    const scope = captureDocumentScope(() => ({ playId: null, generation: 0, changes: null }), {
      read: async () => {
        calls++;
        return { content: "", hash: "" };
      },
      write: async () => {
        calls++;
        return { status: "ok", hash: "" };
      },
    });
    expect(() => scope.io.write("note.md", "words", null)).toThrow("play that has closed");
    expect(calls).toBe(0);
  });
});
