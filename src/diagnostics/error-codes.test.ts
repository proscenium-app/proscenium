// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { playsFolderRefusal } from "../workspace/plays-folder";
import { ERROR_CODES, workspaceErrorCode } from "./error-codes";

const rust = readFileSync(new URL("../../src-tauri/src/telemetry/events.rs", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../app/useWorkspace.ts", import.meta.url), "utf8");

/** A template literal's text from just past its opening backtick, `${…}` as "X". */
function readTemplate(src: string, i: number): [string, number] {
  let text = "";
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") {
      text += src[i + 1];
      i += 2;
    } else if (c === "`") {
      return [text, i + 1];
    } else if (c === "$" && src[i + 1] === "{") {
      i = skipExpression(src, i + 2);
      text += "X";
    } else {
      text += c;
      i++;
    }
  }
  return [text, i];
}

/** Past the `}` closing an expression that may hold strings and templates of its own. */
function skipExpression(src: string, i: number): number {
  let depth = 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'") i = readString(src, i + 1, c)[1];
    else if (c === "`") i = readTemplate(src, i + 1)[1];
    else {
      if (c === "{") depth++;
      if (c === "}" && --depth === 0) return i + 1;
      i++;
    }
  }
  return i;
}

function readString(src: string, i: number, quote: string): [string, number] {
  let text = "";
  while (i < src.length && src[i] !== quote) {
    text += src[i] === "\\" ? src[++i] : src[i];
    i++;
  }
  return [text, i + 1];
}

/** The sentences inside each `setError(…)` call: its string and template literals. */
function setErrorSentences(source: string): string[] {
  const sentences: string[] = [];
  let at = source.indexOf("setError(");
  while (at !== -1) {
    let i = at + "setError(".length;
    let depth = 1;
    while (i < source.length && depth > 0) {
      const c = source[i];
      if (c === '"' || c === "'" || c === "`") {
        const [text, next] = c === "`" ? readTemplate(source, i + 1) : readString(source, i + 1, c);
        // A sentence has spaces; `"still-changing"` in a comparison does not.
        if (text.includes(" ")) sentences.push(text);
        i = next;
        continue;
      }
      if (c === "(") depth++;
      if (c === ")") depth--;
      i++;
    }
    at = source.indexOf("setError(", i);
  }
  return sentences;
}

describe("error codes", () => {
  it("are the list telemetry/events.rs accepts, in its order", () => {
    const declared = [...rust.matchAll(/^\s*\w+ => "(E-[A-Z-]+)":/gm)].map((m) => m[1]);
    expect(declared).toEqual([...ERROR_CODES]);
  });

  it("give every sentence the workspace writes a code of its own", () => {
    const sentences = setErrorSentences(workspace);
    // The extraction itself works: the workspace writes a couple of dozen.
    expect(sentences.length).toBeGreaterThan(15);
    const uncoded = sentences.filter((s) => workspaceErrorCode(s) === "E-WORKSPACE");
    expect(uncoded).toEqual([]);
  });

  it("read the sentences for what went wrong, not where", () => {
    const cases: [string, string][] = [
      ["PDF export failed: Error: could not load embedded font /assets/CourierPrime.ttf: 404", "E-EXPORT-FONT"],
      ["PDF export failed: TypeError: x is undefined", "E-EXPORT-PDF"],
      ["Printing failed: Error: could not load embedded font /assets/CourierPrime.ttf: 404", "E-EXPORT-FONT"],
      ["Printing failed: another panel is already open on this window", "E-PRINT"],
      [".docx export failed: Error: No pages selected.", "E-OTHER"],
      [".odt export failed: TypeError: x is undefined", "E-OTHER"],
      ["“Hamlet” couldn't be saved to “Act One”, so it is kept in Versions.", "E-SAVE"],
      ["Your version couldn't be kept in Versions, so nothing was replaced.", "E-VERSIONS"],
      ["Couldn't save the change — the play changed on disk.", "E-CHANGED-ON-DISK"],
      ["The scenes changed while that change was being saved, so it wasn't made. Make it again.", "E-ACTION-STALE"],
      ['"Hamlet" could not be opened.', "E-PLAY-OPEN"],
      ["“Hamlet” isn't in your Plays folder any more.", "E-PLAY-MISSING"],
      ["iCloud Drive isn't available. Choose a folder instead.", "E-ICLOUD"],
      ["Permission denied (os error 13)", "E-VAULT-PERMISSION"],
      ["ENOENT Hamlet/Hamlet.fountain", "E-VAULT-READ"],
      ["that folder was not chosen or opened in Proscenium", "E-FOLDER-OPEN"],
      ["something nobody has seen before", "E-WORKSPACE"],
    ];
    for (const [sentence, code] of cases) expect([sentence, workspaceErrorCode(sentence)]).toEqual([sentence, code]);
  });

  it("know a Plays folder the app refuses, in every way it refuses one", () => {
    const facts = { path: "/p/Hamlet", isPlay: false, insidePlay: null, providers: [] as string[], listable: true };
    const refusals = [
      playsFolderRefusal({ ...facts, isPlay: true }, null),
      playsFolderRefusal({ ...facts, insidePlay: "/p/Hamlet" }, null),
      playsFolderRefusal({ ...facts, providers: ["icloud", "dropbox"] }, null),
      playsFolderRefusal({ ...facts, path: "/p/Plays/Drafts" }, { path: "/p/Plays", plays: 3 }),
    ];
    for (const refusal of refusals) {
      expect(refusal).not.toBeNull();
      expect(workspaceErrorCode(refusal!)).toBe("E-FOLDER-REFUSED");
    }
  });
});
