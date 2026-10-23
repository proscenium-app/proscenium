// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where a smoke run is, kept on disk as it goes: `.smoke/journal.ndjson`, a
 * line for each act, each launch of the real app, each check and each process
 * smoke ends, every one written before what it names begins, and written
 * synchronously. A run that is ended from outside prints nothing more: its
 * process is gone, and no handler of its own runs. Its journal still says
 * where it was.
 *
 * smoke.mjs writes it. When node returns without the run's own summary,
 * scripts/windows/smoke.ps1 asks this file to say where and how the run
 * stopped, as a FAIL line, so a run that stops is never silence:
 *
 *   node scripts/smoke-journal.mjs said --exit <code>
 *       nothing, and exit 0, when the run finished: its summary said its verdict;
 *       otherwise a FAIL line saying where it stopped and what its exit code
 *       means, the same in one line in stopped.txt beside the journal, and
 *       exit 3 for a run ended from outside, 4 for one its own error ended
 *       (it said the error, and a second run would meet it again)
 *   node scripts/smoke-journal.mjs said --unsaid
 *       the same, for a later step, when nobody has said it yet (the script
 *       that would have said it was ended with node), and nothing where no
 *       run began; always exit 0
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
/** The journal of the run in this checkout. */
export const JOURNAL = join(ROOT, ".smoke", "journal.ndjson");
/** The exit code `said` gives a run ended from outside before its summary. */
export const STOPPED_CODE = 3;
/** And a run that an error of its own ended (`crashed` in its journal). */
export const CRASHED_CODE = 4;

let file = null;

const line = (event) => `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`;

/** A new journal at `path`, its first line the run's start. */
export function openJournal(path, start) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, line({ event: "start", ...start }));
  file = path;
}

/**
 * One line of the open journal, written before this returns. A journal that
 * cannot be written loses its line, never the run.
 */
export function note(event) {
  if (!file) return;
  try {
    appendFileSync(file, line(event));
  } catch {
    /* the run goes on without it */
  }
}

/** A journal's lines, a torn last one (a run ended mid-write) left out. */
export function readJournal(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((text) => {
      try {
        return [JSON.parse(text)];
      } catch {
        return [];
      }
    });
}

/**
 * What a process's exit code says of how it ended, on Windows above all,
 * where an ended process prints nothing. `code` as PowerShell has it (a
 * signed 32-bit number) or as Windows does (unsigned).
 */
export function exitMeaning(code) {
  const n = Number(code);
  if (!Number.isFinite(n)) return `no exit code (${code})`;
  const u = n >>> 0;
  const hex = `0x${u.toString(16).toUpperCase().padStart(8, "0")}`;
  const known = new Map([
    [0, "exit code 0, with no summary"],
    [
      1,
      "exit code 1 with nothing printed: what `taskkill /F` gives a process it ends, and what Node gives an error it could not print",
    ],
    [13, "exit code 13: Node's unsettled top-level await, nothing left to wait for"],
    [134, "exit code 134: Node aborted on a fatal error of its own"],
    [0xffffffff, "exit code -1: what Stop-Process and .NET's Kill give a process they end"],
    [0xc0000005, `${hex}, an access violation`],
    [0xc00000fd, `${hex}, a stack overflow`],
    [0xc0000017, `${hex}, out of memory`],
    [0xc0000142, `${hex}, a DLL that could not start, as on a desktop out of heap`],
    [0xc000013a, `${hex}: Ctrl+C, or its console closed`],
    [0xc0000409, `${hex}, a fail-fast: an abort or a failed security check`],
    [0xe0434352, `${hex}, an unhandled .NET exception`],
  ]);
  return known.get(u) ?? (u > 0xffff ? `exit code ${hex}` : `exit code ${n}`);
}

const seconds = (from, to) => `${((Date.parse(to) - Date.parse(from)) / 1000).toFixed(1)} s`;

/**
 * Where a run stopped, from its journal: `{ finished, said, short, lines }`.
 * Pure. `finished` when the run reached its own verdict (its summary said
 * it); otherwise `short` is one line for a summary and `lines` the FAIL
 * line and what follows it, as smoke's report writes a failing check.
 */
export function whereStopped(events, { exitCode, now = new Date().toISOString() } = {}) {
  const finished = events.some((e) => e.event === "finished");
  const said = events.some((e) => e.event === "said");
  if (finished) return { finished, said, crashed: false, short: null, lines: [] };
  const start = events.find((e) => e.event === "start");
  const last = events.at(-1);
  const crashed = events.filter((e) => e.event === "crashed").at(-1);
  const how =
    exitCode === undefined
      ? "it is not running"
      : crashed
        ? `node stopped on an error of its own, said above (exit code ${exitCode})`
        : `node ${exitMeaning(exitCode)}`;
  if (!start)
    return {
      finished,
      said,
      crashed: false,
      short: `before it began its journal (${how})`,
      lines: [
        "  FAIL  smoke stopped before its summary, and before it began its journal",
        `        ${how}`,
      ],
    };
  // The acts it was in: each begun and not ended (one at a time in the real
  // app; side by side in the browsers).
  const ended = new Set(events.filter((e) => e.event === "act-end").map((e) => e.id));
  const open = events.filter((e) => e.event === "act" && !ended.has(e.id));
  const place = (act) => {
    const mine = events.filter((e) => e.id === act.id);
    const launched = mine.find((e) => e.event === "launched");
    const check = mine.filter((e) => e.event === "check").at(-1);
    const name = `${act.engine} · ${act.act}${act.variant ? ` (${act.variant})` : ""}${act.attempt > 1 ? " (second try)" : ""}`;
    const closing = mine.some((e) => e.event === "closing");
    let where;
    if (closing)
      where = `while it closed${launched ? ` its app (process ${launched.pid})` : ""}, after its last check${check ? ` "${check.check}"` : ""}`;
    else if (check)
      where = `${check.start ? "in its start, " : ""}at the check "${check.check}"${launched ? `; its app was process ${launched.pid}` : ""}`;
    else if (launched)
      where = `after its app started (process ${launched.pid}, port ${launched.port}), before its first check`;
    else
      where = act.engine === "webview2" ? "while its app was starting" : "before its first check";
    return { name, where };
  };
  const places = open.map(place);
  const lastAct = events.filter((e) => e.event === "act").at(-1);
  const between = lastAct
    ? `after the act "${lastAct.act}" ended, before the next began`
    : "before its first act";
  const lines = [
    `  FAIL  ${places[0]?.name ?? "smoke"} · smoke stopped before its summary`,
    `        ${how}`,
    ...(places.length
      ? places.map((p, i) => `        ${i ? `and ${p.name}, ` : "the act stopped "}${p.where}`)
      : [`        it stopped ${between}`]),
    `        its journal's last line was "${last.event}" at ${last.at}, ${seconds(last.at, now)} before this; the run began ${seconds(start.at, now)} before`,
  ];
  if (crashed) lines.push(`        it said why: ${String(crashed.error).split("\n")[0]}`);
  const where = places.length ? `in ${places[0].name}, ${places[0].where}` : between;
  return { finished, said, crashed: !!crashed, short: `${where} (${how})`, lines };
}

// `node scripts/smoke-journal.mjs said …`, from scripts/windows/smoke.ps1.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const value = (flag) => {
    const at = args.indexOf(flag);
    return at < 0 ? undefined : args[at + 1];
  };
  if (args[0] !== "said") {
    console.error("usage: node scripts/smoke-journal.mjs said (--exit <code> | --unsaid)");
    process.exit(2);
  }
  const path = value("--journal") ?? JOURNAL;
  const unsaid = args.includes("--unsaid");
  const exitCode = value("--exit");
  const events = readJournal(path);
  const stop = whereStopped(events, { exitCode });
  // A later step's question, where smoke never began (its build failed): that
  // step's own error said so.
  if (stop.finished || (unsaid && (stop.said || events.length === 0))) process.exit(0);
  for (const l of stop.lines) console.log(l);
  try {
    // The one line, for the step's summary, beside the journal.
    writeFileSync(join(dirname(path), "stopped.txt"), `${stop.short}\n`);
    appendFileSync(path, line({ event: "said" }));
  } catch {
    /* said above, which is what matters */
  }
  process.exit(unsaid ? 0 : stop.crashed ? CRASHED_CODE : STOPPED_CODE);
}
