// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CRASHED_CODE,
  STOPPED_CODE,
  exitMeaning,
  note,
  openJournal,
  readJournal,
  whereStopped,
} from "./smoke-journal.mjs";

const dir = mkdtempSync(join(tmpdir(), "proscenium-journal-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const at = (s: number) => new Date(Date.UTC(2026, 9, 22, 15, 57, s)).toISOString();
const start = { at: at(0), event: "start", pid: 4242, engines: ["webview2"], acts: ["export"] };

test("an exit code says how a process ended, as PowerShell or Windows writes it", () => {
  expect(exitMeaning(1)).toContain("taskkill /F");
  expect(exitMeaning(-1)).toContain("Stop-Process");
  expect(exitMeaning(4294967295)).toContain("Stop-Process");
  // STATUS_ACCESS_VIOLATION, signed as $LASTEXITCODE has it and unsigned.
  expect(exitMeaning(-1073741819)).toBe("0xC0000005, an access violation");
  expect(exitMeaning(3221225477)).toBe("0xC0000005, an access violation");
  expect(exitMeaning("-1073741510")).toContain("Ctrl+C");
  expect(exitMeaning(134)).toContain("aborted");
  expect(exitMeaning(7)).toBe("exit code 7");
  expect(exitMeaning(-2147483645)).toBe("exit code 0x80000003");
  expect(exitMeaning(undefined)).toContain("no exit code");
});

test("a run that reached its verdict needs nothing said", () => {
  const stop = whereStopped([start, { at: at(5), event: "finished", failures: 2 }], {
    exitCode: 1,
  });
  expect(stop.finished).toBe(true);
  expect(stop.lines).toEqual([]);
});

test("a run ended between two acts says which act had ended", () => {
  const events = [
    start,
    { at: at(1), event: "act", id: 9, engine: "webview2", act: "keyboard and sheets", attempt: 1 },
    { at: at(2), event: "launched", id: 9, pid: 8000, port: 9342 },
    { at: at(3), event: "check", id: 9, check: "text fields · writing suggestions" },
    { at: at(4), event: "closing", id: 9 },
    { at: at(5), event: "act-end", id: 9 },
  ];
  const stop = whereStopped(events, { exitCode: 1, now: at(6) });
  expect(stop.finished).toBe(false);
  expect(stop.lines[0]).toBe("  FAIL  smoke · smoke stopped before its summary");
  expect(stop.lines[1]).toContain("node exit code 1 with nothing printed");
  expect(stop.lines[2]).toBe(
    '        it stopped after the act "keyboard and sheets" ended, before the next began',
  );
  expect(stop.lines[3]).toContain('"act-end" at 2026-10-22T15:57:05.000Z, 1.0 s before this');
  expect(stop.short).toContain('after the act "keyboard and sheets" ended');
});

test("a run ended while an act's app started, or in a check, says where", () => {
  const opening = [
    start,
    { at: at(1), event: "act", id: 10, engine: "webview2", act: "export", attempt: 1 },
  ];
  const starting = whereStopped(opening, { exitCode: 1, now: at(2) });
  expect(starting.lines[0]).toBe("  FAIL  webview2 · export · smoke stopped before its summary");
  expect(starting.lines[2]).toBe("        the act stopped while its app was starting");

  const up = [...opening, { at: at(2), event: "launched", id: 10, pid: 8352, port: 9343 }];
  expect(whereStopped(up, { exitCode: 1 }).lines[2]).toBe(
    "        the act stopped after its app started (process 8352, port 9343), before its first check",
  );

  const inStart = [...up, { at: at(3), event: "check", id: 10, check: "welcome", start: true }];
  expect(whereStopped(inStart, { exitCode: 1 }).lines[2]).toBe(
    '        the act stopped in its start, at the check "welcome"; its app was process 8352',
  );

  const closing = [
    ...inStart,
    { at: at(4), event: "check", id: 10, check: "lengths are pages" },
    { at: at(5), event: "closing", id: 10 },
  ];
  expect(whereStopped(closing, { exitCode: 1 }).lines[2]).toBe(
    '        the act stopped while it closed its app (process 8352), after its last check "lengths are pages"',
  );

  const second = [
    start,
    {
      at: at(1),
      event: "act",
      id: 11,
      engine: "webview2",
      act: "tutorials",
      attempt: 2,
      variant: "de",
    },
    { at: at(2), event: "check", id: 11, check: "Keep as a Play" },
    { at: at(3), event: "crashed", what: "an error nothing caught", error: "Error: boom\n  at x" },
  ];
  const stop = whereStopped(second, { exitCode: 1 });
  expect(stop.lines[0]).toBe(
    "  FAIL  webview2 · tutorials (de) (second try) · smoke stopped before its summary",
  );
  expect(stop.lines.at(-1)).toBe("        it said why: Error: boom");
});

test("acts side by side are each named where they stopped", () => {
  const events = [
    { ...start, engines: ["chromium", "webkit"] },
    { at: at(1), event: "act", id: 1, engine: "chromium", act: "editor", attempt: 1 },
    { at: at(1), event: "act", id: 2, engine: "webkit", act: "editor", attempt: 1 },
    { at: at(2), event: "check", id: 1, check: "find" },
    { at: at(2), event: "act-end", id: 2 },
    { at: at(3), event: "act", id: 3, engine: "webkit", act: "export", attempt: 1 },
  ];
  const stop = whereStopped(events, { exitCode: 134 });
  expect(stop.lines.slice(2, 4)).toEqual([
    '        the act stopped at the check "find"',
    "        and webkit · export, before its first check",
  ]);
});

test("the journal is written as it goes, and a torn last line is left out", () => {
  const path = join(dir, "written", "journal.ndjson");
  openJournal(path, { pid: 1 });
  note({ event: "act", id: 1, engine: "webview2", act: "opening", attempt: 1 });
  appendFileSync(path, '{"at":"2026-10-22T15:57:00.000Z","event":"che');
  const events = readJournal(path);
  expect(events.map((e) => e.event)).toEqual(["start", "act"]);
  expect(events[0].pid).toBe(1);
  expect(readJournal(join(dir, "none.ndjson"))).toEqual([]);
});

const said = (path: string, ...args: string[]) =>
  spawnSync(process.execPath, ["scripts/smoke-journal.mjs", "said", "--journal", path, ...args], {
    encoding: "utf8",
  });

test("`said` speaks once for a stopped run, and never for one that finished", () => {
  const path = join(dir, "said", "journal.ndjson");
  openJournal(path, { pid: 2 });
  note({ event: "act", id: 1, engine: "webview2", act: "export", attempt: 1 });
  const first = said(path, "--exit", "1");
  expect(first.status).toBe(STOPPED_CODE);
  expect(first.stdout).toContain("FAIL  webview2 · export · smoke stopped before its summary");
  expect(readFileSync(join(dir, "said", "stopped.txt"), "utf8")).toContain(
    "in webview2 · export, while its app was starting",
  );
  // A later step: already said, so nothing again.
  const later = said(path, "--unsaid");
  expect(later.status).toBe(0);
  expect(later.stdout).toBe("");

  const finished = join(dir, "finished", "journal.ndjson");
  openJournal(finished, { pid: 3 });
  note({ event: "finished", failures: 1 });
  const verdict = said(finished, "--exit", "1");
  expect(verdict.status).toBe(0);
  expect(verdict.stdout).toBe("");

  // A run its own error ended said why, and would meet it again: its own code.
  const crashed = join(dir, "crashed", "journal.ndjson");
  openJournal(crashed, { pid: 4 });
  note({ event: "act", id: 1, engine: "webview2", act: "export", attempt: 1 });
  note({ event: "crashed", what: "an error nothing caught", error: "TypeError: x is undefined" });
  const own = said(crashed, "--exit", "1");
  expect(own.status).toBe(CRASHED_CODE);
  expect(own.stdout).toContain("it said why: TypeError: x is undefined");
  expect(own.stdout).toContain("node stopped on an error of its own, said above (exit code 1)");

  // No run began (its build failed): the later step says nothing.
  const never = join(dir, "never", "journal.ndjson");
  expect(said(never, "--unsaid").stdout).toBe("");
  writeFileSync(join(dir, "empty.ndjson"), "");
  expect(said(join(dir, "empty.ndjson"), "--unsaid").stdout).toBe("");
});
