// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { ERROR_CODES, workspaceErrorCode } from "../diagnostics/error-codes";
import {
  saveProblem,
  saveRefusal,
  VaultWriteError,
  type SaveRefusal,
  type SaveSubject,
} from "./save-failure";

it("docs/app/keeping-work/storage-and-file-format.md#STOR-84: an unfinished exchange asks for recovery instead of promising automatic retries", () => {
  const refusal = saveRefusal(
    new VaultWriteError("unfinished-save: the displaced copy is still being kept"),
  );
  expect(refusal).toBe("unfinished-save");
  const problem = saveProblem(refusal, { kind: "script", name: "Hamlet", folder: "Plays" });
  expect(problem.detail).toContain("Reopen the play");
});

const vaultRs = readFileSync(new URL("../../src-tauri/src/vault/mod.rs", import.meta.url), "utf8");

const REFUSALS: SaveRefusal[] = [
  "locked",
  "folder-locked",
  "no-permission",
  "not-allowed",
  "disk-full",
  "read-only",
  "folder-gone",
  "unreachable",
  "unknown",
];

const hamlet: SaveSubject = { kind: "script", name: "Hamlet", folder: "Hamlet" };
const mara: SaveSubject = { kind: "document", name: "Mara", folder: "Characters" };
const outline: SaveSubject = { kind: "outline", name: "Outline", folder: "Hamlet" };

describe("why a save was refused", () => {
  it("reads the lock the vault saw in front of the OS's words", () => {
    // What the app once showed, and what the vault says now.
    expect(saveRefusal("Operation not permitted (os error 1)")).toBe("not-allowed");
    expect(saveRefusal("locked: Operation not permitted (os error 1)")).toBe("locked");
    expect(saveRefusal("folder-locked: Operation not permitted (os error 1)")).toBe(
      "folder-locked",
    );
    expect(saveRefusal("folder-gone: entity not found")).toBe("folder-gone");
  });

  it("knows every name vault/mod.rs puts in front of an error", () => {
    const block = /pub mod refused \{([\s\S]*?)\n\}/.exec(vaultRs)?.[1] ?? "";
    const names = [...block.matchAll(/pub const \w+: &str = "([a-z-]+)";/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(2);
    for (const name of names) {
      const read = saveRefusal(`${name}: Operation not permitted (os error 1)`);
      expect([name, read]).toEqual([name, name as SaveRefusal]);
    }
  });

  it("reads the common failures by their number", () => {
    const cases: [string, SaveRefusal][] = [
      ["Permission denied (os error 13)", "no-permission"],
      ["No space left on device (os error 28)", "disk-full"],
      ["Disc quota exceeded (os error 69)", "disk-full"],
      ["Read-only file system (os error 30)", "read-only"],
      ["No such file or directory (os error 2)", "folder-gone"],
      ["Not a directory (os error 20)", "folder-gone"],
      ["Input/output error (os error 5)", "unreachable"],
      ["Operation timed out (os error 60)", "unreachable"],
      ["Socket is not connected (os error 57)", "unreachable"],
      ["Stale NFS file handle (os error 70)", "unreachable"],
      ["File name too long (os error 63)", "unknown"],
    ];
    for (const [said, refusal] of cases) expect([said, saveRefusal(said)]).toEqual([said, refusal]);
  });

  it("reads the words when there is no number, and admits what it cannot read", () => {
    expect(saveRefusal("no space left on device")).toBe("disk-full");
    expect(saveRefusal("Read-only file system")).toBe("read-only");
    expect(saveRefusal("no vault is open")).toBe("unknown");
    expect(saveRefusal("path escapes the vault")).toBe("unknown");
    expect(saveRefusal(undefined)).toBe("unknown");
  });

  it("reads the error as the mock and IPC hand it over, wrapped or not", () => {
    // The dev mock's gate rejects with an Error; Tauri rejects with the string.
    const mock = new Error("No space left on device (os error 28)");
    expect(saveRefusal(mock)).toBe("disk-full");
    expect(saveRefusal(new VaultWriteError(mock))).toBe("disk-full");
    expect(saveRefusal(new VaultWriteError("locked: Operation not permitted (os error 1)"))).toBe(
      "locked",
    );
  });

  it("leaves String(e) where it has not been replaced exactly as it was", () => {
    const said = "Operation not permitted (os error 1)";
    const wrapped = new VaultWriteError(said);
    expect(String(wrapped)).toBe(said);
    expect(String(new VaultWriteError(new Error(said)))).toBe(said);
    expect(workspaceErrorCode(String(wrapped))).toBe(workspaceErrorCode(said));
    expect(wrapped).toBeInstanceOf(Error);
  });
});

describe("what the writer reads", () => {
  it("says a locked script plainly, that the words are safe, and how it will save", () => {
    expect(saveProblem("locked", hamlet)).toEqual({
      title: "“Hamlet” is locked in Finder.",
      detail:
        "Your words are still here, and a copy is being kept. It will save once you unlock it in Finder's Get Info window.",
      code: "E-SAVE-LOCKED",
    });
    expect(saveProblem("disk-full", hamlet)).toEqual({
      title: "The disk is full.",
      detail:
        "Your words are still here, in this window. “Hamlet” will save once there is room on the disk.",
      code: "E-SAVE-DISK-FULL",
    });
  });

  it("gives every refusal, for every kind of words, one sentence of its own and a code", () => {
    const titles = new Set<string>();
    for (const refusal of REFUSALS) {
      const shown = saveProblem(refusal, mara);
      expect(ERROR_CODES).toContain(shown.code);
      expect(shown.title.endsWith(".")).toBe(true);
      titles.add(shown.title);
      for (const subject of [hamlet, mara, outline]) {
        for (const what of ["saving", "change", "quitting"] as const) {
          const { title, detail } = saveProblem(refusal, subject, what);
          // The folder or the words' own name, so the writer knows which file.
          expect(`${title} ${detail}`).toMatch(new RegExp(`“(${subject.name}|${subject.folder})”`));
          expect(detail).not.toMatch(/\s\s|\.\./);
        }
      }
    }
    expect(titles.size).toBe(REFUSALS.length);
  });

  it("gives a code to each refusal, and one only a lock shares", () => {
    const codes = REFUSALS.map((r) => saveProblem(r, hamlet).code);
    expect(new Set(codes).size).toBe(REFUSALS.length - 1);
    expect(saveProblem("folder-locked", hamlet).code).toBe(saveProblem("locked", hamlet).code);
    expect(saveProblem("unknown", hamlet).code).toBe("E-SAVE");
  });

  it("promises a copy only where the recovery snapshot makes one", () => {
    for (const refusal of REFUSALS) {
      const script = saveProblem(refusal, hamlet).detail;
      expect(script.startsWith("Your words are still here")).toBe(true);
      expect(script.includes("a copy is being kept")).toBe(refusal !== "disk-full");
      for (const subject of [mara, outline]) {
        const detail = saveProblem(refusal, subject).detail;
        expect(detail.startsWith("Your words are still here")).toBe(true);
        expect(detail.includes("copy is being kept")).toBe(refusal !== "disk-full");
      }
      expect(
        saveProblem(refusal, hamlet, "change").detail.startsWith(
          "Nothing in “Hamlet” was changed.",
        ),
      ).toBe(true);
    }
  });

  it("tells a quit what it would lose, never that the words are safe (src/app/quit.ts)", () => {
    // Asked only when the words could be kept nowhere, the recovery copy
    // included: nothing may promise a copy, or that the window still has them
    // once it has gone.
    for (const refusal of REFUSALS) {
      for (const subject of [hamlet, mara, outline]) {
        const detail = saveProblem(refusal, subject, "quitting").detail;
        expect(detail.startsWith("If Proscenium quits now, what was typed is lost.")).toBe(true);
        expect(detail).not.toMatch(/copy is being kept|still here/);
      }
    }
    expect(saveProblem("disk-full", mara, "quitting")).toEqual({
      title: "The disk is full.",
      detail:
        "If Proscenium quits now, what was typed is lost. “Mara” will save once there is room on the disk.",
      code: "E-SAVE-DISK-FULL",
    });
  });

  it("never shows the OS's words or the app's internal ones (docs/app/keeping-work/storage-and-file-format.md#STOR-D1)", () => {
    const internal =
      /os error|errno|EPERM|EACCES|ENOSPC|not permitted|permission denied|vault|workspace|project|manifest|material|conflict|sync|snapshot|collision|atomic|temp|IPC/i;
    for (const refusal of REFUSALS) {
      for (const subject of [hamlet, mara, outline]) {
        for (const what of ["saving", "change", "quitting"] as const) {
          const { title, detail } = saveProblem(refusal, subject, what);
          expect([refusal, `${title} ${detail}`.match(internal)?.[0] ?? null]).toEqual([
            refusal,
            null,
          ]);
        }
      }
    }
  });
});
