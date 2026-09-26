// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { decideRecovery, decodeSnapshot, encodeSnapshot, sameScriptText } from "./recovery-policy";
import { parse, serialize } from "../fountain";

const canonical = (text: string) => serialize(parse(text));

describe("recovery: offer, ignore or delete", () => {
  const at = Date.parse("2026-09-12T16:30:05Z");

  it("offers words newer than the file that the file does not have", () => {
    expect(
      decideRecovery({ snapshotAtMs: at, fileModifiedMs: at - 4000, sameContent: false }),
    ).toBe("offer");
  });

  it("deletes a snapshot whose words reached the file after all", () => {
    // Newer, older, unknown — none of it matters once the words are on disk.
    for (const fileModifiedMs of [at - 4000, at + 4000, null]) {
      expect(decideRecovery({ snapshotAtMs: at, fileModifiedMs, sameContent: true })).toBe(
        "delete",
      );
    }
  });

  it("does not speak for a snapshot the file has moved past", () => {
    // A flush landed after the snapshot, or another device wrote the script.
    expect(decideRecovery({ snapshotAtMs: at, fileModifiedMs: at + 1, sameContent: false })).toBe(
      "ignore",
    );
    // The same instant is not newer: an offer has to be earned.
    expect(decideRecovery({ snapshotAtMs: at, fileModifiedMs: at, sameContent: false })).toBe(
      "ignore",
    );
  });

  it("offers when the file's time is unknown, because only the words are known to be at risk", () => {
    expect(decideRecovery({ snapshotAtMs: at, fileModifiedMs: null, sameContent: false })).toBe(
      "offer",
    );
  });
});

describe("recovery: what counts as the same script", () => {
  it("matches identical text", () => {
    expect(sameScriptText("MARA\nIt held.\n", "MARA\nIt held.\n", canonical)).toBe(true);
  });

  it("matches a file the serializer would only tidy, so whitespace is never offered back", () => {
    const file = "Title: The Tide\n\nINT. KITCHEN - NIGHT\n\n\n\nShe waits.   \n";
    const snapshot = canonical(file);
    expect(snapshot).not.toBe(file);
    expect(sameScriptText(snapshot, file, canonical)).toBe(true);
  });

  it("does not match when a word is missing from the file", () => {
    const file = "INT. KITCHEN - NIGHT\n\nShe waits.\n";
    const snapshot = canonical("INT. KITCHEN - NIGHT\n\nShe waits. The sea comes in.\n");
    expect(sameScriptText(snapshot, file, canonical)).toBe(false);
  });

  it("treats a canonicalizer that throws as different, never as the same", () => {
    const boom = () => {
      throw new Error("unparseable");
    };
    expect(sameScriptText("a", "b", boom)).toBe(false);
  });
});

describe("recovery: the snapshot envelope", () => {
  it("round-trips the words, the path and the capture time", () => {
    const s = {
      path: "Scenes/Draft.fountain",
      savedAtMs: Date.parse("2026-09-12T16:30:05.250Z"),
      content: "She waits.\n",
    };
    expect(decodeSnapshot(encodeSnapshot(s))).toEqual(s);
  });

  it("refuses bytes this app did not write", () => {
    expect(decodeSnapshot("")).toBeNull();
    expect(decodeSnapshot("She waits.")).toBeNull();
    expect(
      decodeSnapshot(
        JSON.stringify({ kind: "something/else", content: "x", savedAt: "2026-09-12T00:00:00Z" }),
      ),
    ).toBeNull();
    expect(
      decodeSnapshot(
        JSON.stringify({ kind: "proscenium/recovery", content: "x", savedAt: "not a time" }),
      ),
    ).toBeNull();
  });
});
