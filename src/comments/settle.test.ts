// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The fields open on an editor: settled when the script is left
 * (docs/app/writing/comments.md#COMM-76), and a new comment taken over, with
 * its words, by the surface it is typed in now (docs/app/writing/comments.md#COMM-79).
 */
import { describe, expect, test } from "bun:test";
import type { Editor } from "@tiptap/core";
import { holdOpenComment, settleOpenComments, takeNewComment, type OpenField } from "./settle";

const anEditor = (destroyed = false) => ({ isDestroyed: destroyed }) as unknown as Editor;

/** A surface's field, making the new comment `making` with `draft`, or nothing. */
function surface(making: string | null, draft = "", name = "") {
  const seen = { settled: 0, open: making };
  const field: OpenField = {
    settle: () => {
      seen.settled++;
    },
    handOver: (id) => {
      if (seen.open !== id) return null;
      seen.open = null;
      return { draft, name };
    },
  };
  return { field, seen };
}

describe("a new comment taken over by another surface", () => {
  test("comes with its words and name, and its field closes where it was", () => {
    const editor = anEditor();
    const card = surface("comment-7", "is this earned?", "Robin");
    const feed = surface(null);
    holdOpenComment(editor, card.field);
    holdOpenComment(editor, feed.field);
    expect(takeNewComment(editor, "comment-7")).toEqual({
      draft: "is this earned?",
      name: "Robin",
    });
    expect(card.seen.open).toBeNull();
    // Taken once: the field it came from is closed, so the comment has one.
    expect(takeNewComment(editor, "comment-7")).toBeNull();
  });

  test("is nothing to take when no surface is making it", () => {
    const editor = anEditor();
    holdOpenComment(editor, surface("comment-1", "words").field);
    expect(takeNewComment(editor, "comment-2")).toBeNull();
    expect(takeNewComment(anEditor(), "comment-1")).toBeNull();
  });

  test("a field let go is not asked", () => {
    const editor = anEditor();
    const card = surface("comment-3", "kept");
    const release = holdOpenComment(editor, card.field);
    release();
    expect(takeNewComment(editor, "comment-3")).toBeNull();
    expect(card.seen.open).toBe("comment-3");
  });
});

describe("leaving the script", () => {
  test("settles every open field, and none of a destroyed editor", () => {
    const editor = anEditor();
    const a = surface("comment-1");
    const b = surface(null);
    holdOpenComment(editor, a.field);
    holdOpenComment(editor, b.field);
    settleOpenComments(editor);
    expect([a.seen.settled, b.seen.settled]).toEqual([1, 1]);
    const gone = anEditor(true);
    const c = surface("comment-2");
    holdOpenComment(gone, c.field);
    settleOpenComments(gone);
    expect(c.seen.settled).toBe(0);
  });
});
