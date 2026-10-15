// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { parse } from "../fountain";
import {
  COMMENT_NAME_MAX,
  anchorSpan,
  cleanCommentName,
  collectComments,
  commentNameInput,
  isAnchorNoteText,
  isCommentOnlyBlock,
  joinsThread,
  parseCommentText,
  signComment,
} from "./model";

describe("anchorSpan", () => {
  const painted = (text: string) => {
    const span = anchorSpan(text);
    return span ? text.slice(span.start, span.end) : null;
  };

  it("paints the phrase the comment follows, back to the clause before it", () => {
    expect(painted("She turns off the tap. It keeps crying ")).toBe("It keeps crying");
  });

  it("paints a short run whole", () => {
    expect(painted("You and that pipe.")).toBe("You and that pipe.");
  });

  it("has nothing to paint when the comment opens the block", () => {
    expect(anchorSpan("")).toBeNull();
    expect(anchorSpan("   ")).toBeNull();
  });

  it("never reaches back an essay, and never starts mid-word", () => {
    const long = "word ".repeat(40);
    const span = anchorSpan(long)!;
    const painted = long.slice(span.start, span.end);
    expect(painted.length).toBeLessThanOrEqual(64);
    expect(painted.startsWith("word")).toBe(true);
  });
});

describe("parseCommentText", () => {
  it("reads a leading Name: token as attribution", () => {
    expect(parseCommentText("Robin: is this beat earned?")).toEqual({
      author: "Robin",
      todo: false,
      body: "is this beat earned?",
    });
    expect(parseCommentText("Sam: repeats the sc. 3 argument")).toEqual({
      author: "Sam",
      todo: false,
      body: "repeats the sc. 3 argument",
    });
  });

  it("treats todo: as a flag, not an author", () => {
    expect(parseCommentText("todo: verify tide times")).toEqual({
      author: null,
      todo: true,
      body: "verify tide times",
    });
    expect(parseCommentText("TODO: caps too")).toEqual({
      author: null,
      todo: true,
      body: "caps too",
    });
  });

  it("leaves an unprefixed comment unattributed, body verbatim", () => {
    expect(parseCommentText("  just a thought  ")).toEqual({
      author: null,
      todo: false,
      body: "just a thought",
    });
  });

  it("does not read a sentence with a colon as attribution", () => {
    // The token grammar caps at 24 chars before the colon.
    const p = parseCommentText("What I mean by all of this here: unclear");
    expect(p.author).toBeNull();
    expect(p.body).toBe("What I mean by all of this here: unclear");
  });

  it("keeps multi-line bodies", () => {
    const p = parseCommentText("Robin: line one\nline two");
    expect(p.author).toBe("Robin");
    expect(p.body).toBe("line one\nline two");
  });
});

describe("isAnchorNoteText", () => {
  it("recognizes the embedded scene anchor and nothing else", () => {
    expect(isAnchorNoteText("id:01J9ZA1F2G3H4J5K6M7M8N9P0Q")).toBe(true);
    expect(isAnchorNoteText(" id:01j9za1f2g3h4j5k6m7m8n9p0q ")).toBe(true);
    expect(isAnchorNoteText("id: not a ulid")).toBe(false);
    expect(isAnchorNoteText("ideas: brainstorm")).toBe(false);
  });
});

const SCRIPT = [
  "# ACT ONE",
  "",
  "## SCENE 1",
  "",
  "She pauses [[Robin: too long?]] at the door.",
  "",
  "[[todo: verify tide times]]",
  "",
  "MARA",
  "The water is rising. [[Sam: repeats the sc. 3 argument]]",
  "",
  "## SCENE 2",
  "",
  "[[id:01J9ZA1F2G3H4J5K6M7M8N9P0Q]]",
  "",
  "Jonah arrives [[unattributed thought]] late.",
].join("\n");

describe("collectComments", () => {
  const doc = parse(SCRIPT).doc;
  const comments = collectComments(doc);

  it("finds every comment in script order, skipping scene anchors", () => {
    expect(comments.map((c) => c.text)).toEqual([
      "Robin: too long?",
      "todo: verify tide times",
      "Sam: repeats the sc. 3 argument",
      "unattributed thought",
    ]);
  });

  it("carries act and scene context", () => {
    expect(comments[0].act).toBe("ACT ONE");
    expect(comments[0].scene).toBe("SCENE 1");
    expect(comments[3].scene).toBe("SCENE 2");
  });

  it("marks the standalone comment line and not the inline ones", () => {
    expect(comments.map((c) => c.standalone)).toEqual([false, true, false, false]);
  });

  it("parses attribution per entry", () => {
    expect(comments[0].parsed.author).toBe("Robin");
    expect(comments[1].parsed.todo).toBe(true);
    expect(comments[3].parsed.author).toBeNull();
  });
});

describe("isCommentOnlyBlock", () => {
  const doc = parse(SCRIPT).doc;

  it("is true only for the note-only action", () => {
    const flags = doc.content.map(isCommentOnlyBlock);
    expect(flags.filter(Boolean).length).toBe(2); // the todo line + the anchor line
  });

  it("is false for a genuinely empty block and for mixed content", () => {
    expect(isCommentOnlyBlock({ type: "action", content: [] })).toBe(false);
    expect(isCommentOnlyBlock({ type: "action" })).toBe(false);
  });
});

describe("names in any script", () => {
  it("docs/app/writing/comments.md#COMM-51: reads a name written with letters beyond ASCII", () => {
    expect(parseCommentText("Zoë: too fast").author).toBe("Zoë");
    expect(parseCommentText("José María: otra vez").author).toBe("José María");
    expect(parseCommentText("O’Brien: cut this").author).toBe("O’Brien");
    expect(parseCommentText("李: 好").author).toBe("李");
  });

  it("still opens on a letter and still stops at 24 characters", () => {
    expect(parseCommentText("3 things: one, two").author).toBeNull();
    expect(parseCommentText("What I mean by all of this here: unclear").author).toBeNull();
  });

  it("docs/app/writing/comments.md#COMM-51: keeps whose to-do it is", () => {
    expect(parseCommentText("Robin: todo: verify tide times")).toEqual({
      author: "Robin",
      todo: true,
      body: "verify tide times",
    });
  });
});

describe("the name comments are signed with", () => {
  it("holds, while it is typed, only what a signature can carry", () => {
    expect(commentNameInput("Robin: [[x]]")).toBe("Robin x");
    expect(commentNameInput("Mary Ann ")).toBe("Mary Ann ");
    expect(commentNameInput("a".repeat(40))).toHaveLength(COMMENT_NAME_MAX);
  });

  it("settles to a name that reads back as the author, or to nothing", () => {
    expect(cleanCommentName("  Mary   Ann  ")).toBe("Mary Ann");
    expect(cleanCommentName("3PO")).toBe("PO");
    expect(cleanCommentName(" - ")).toBe("");
    expect(cleanCommentName("todo")).toBe("");
    for (const name of ["Robin", "Zoë", "Mary Ann O'Neil-Park", "J. R."]) {
      expect(cleanCommentName(name)).toBe(name);
      expect(parseCommentText(signComment("is this earned?", name)).author).toBe(name);
    }
  });
});

describe("signComment", () => {
  it("docs/app/writing/comments.md#COMM-52: signs what the composer writes, when the writer has a name", () => {
    expect(signComment("too long?", "Robin")).toBe("Robin: too long?");
    expect(signComment("  too long?  ", "")).toBe("too long?");
    // A colon in the comment is not somebody else's signature.
    expect(signComment("Note: this drags", "Robin")).toBe("Robin: Note: this drags");
    // A flag keeps whose it is.
    expect(parseCommentText(signComment("todo: check the tide", "Robin"))).toEqual({
      author: "Robin",
      todo: true,
      body: "check the tide",
    });
  });

  it("does not sign twice, and signs nothing empty", () => {
    expect(signComment("Robin: too long?", "Robin")).toBe("Robin: too long?");
    expect(signComment("   ", "Robin")).toBe("");
  });
});

describe("threads", () => {
  const threadsOf = (script: string) => collectComments(parse(script).doc).map((c) => c.thread);

  it("docs/app/writing/comments.md#COMM-50: a comment directly after another answers it", () => {
    expect(threadsOf("She pauses [[Robin: too long?]][[Sam: no]] at the door.")).toEqual([0, 0]);
    expect(threadsOf("She pauses [[Robin: too long?]] [[Sam: no]][[Robin: ok]] here.")).toEqual([
      0, 0, 0,
    ]);
  });

  it("white space between them leaves them one conversation; a word does not", () => {
    expect(threadsOf("Before.\n\n[[Robin: a thought]]\n[[Sam: agreed]]\n\nAfter.")).toEqual([0, 0]);
    expect(threadsOf("One [[a]] two [[b]] three.")).toEqual([0, 1]);
    expect(joinsThread("")).toBe(true);
    expect(joinsThread(" \n ")).toBe(true);
    expect(joinsThread(" and ")).toBe(false);
  });

  it("starts again in the next block", () => {
    expect(threadsOf("One. [[a]][[b]]\n\nTwo. [[c]][[d]]")).toEqual([0, 0, 2, 2]);
  });

  it("docs/app/writing/comments.md#COMM-50: a comment and its reply on a line of their own are two comments", () => {
    // The tokenizer reads such a line as ONE note holding `a]][[b`.
    const script = "Before.\n\n[[Robin: a thought]][[Sam: agreed]]\n\nAfter.";
    const comments = collectComments(parse(script).doc);
    expect(comments.map((c) => c.text)).toEqual(["Robin: a thought", "Sam: agreed"]);
    expect(comments.map((c) => c.thread)).toEqual([0, 0]);
    expect(comments.every((c) => c.standalone)).toBe(true);
  });
});
