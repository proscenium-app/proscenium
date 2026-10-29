// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What a release's clock reads about a build over a window
 * (docs/engineering/services-and-feedback.md#SERV-280): how many copies checked
 * for updates from it, the crash reports from it, and the feedback from copies
 * on it, less the messages already cleared.
 *
 * Not part of the Worker, and bundled into nothing: the stand-in's reader
 * (test/standin-evidence.ts) and the live one read the same queries, and each
 * source's answer becomes the same evidence here. No imports, so Bun and Node
 * both load it as it is.
 */

/** A build's version, its window, and the feedback ids already cleared. */
export interface Window {
  version: string;
  from: string;
  until: string;
  cleared: readonly string[];
}
/** Crash reports of one kind: the exception's first line, and how many. */
export interface CrashKind {
  said: string;
  count: number;
}
export interface Evidence {
  copies: number | null;
  crashes: number;
  crashSaid: string | null;
  feedback: { total: number; unmarked: number };
}

const BUILD =
  /^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})(?:-(?:alpha|beta)\.(0|[1-9]\d{0,8}))?$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DAY = 86_400_000;
/** The longest `crashSaid`: a sentence of the clock's. */
const SAID = 300;

/** The window, checked: a build's version, two times with their zones, the first before the second, and ids. */
export function window(
  version: string,
  from: string,
  until: string,
  cleared: readonly string[] = [],
): Window {
  if (!BUILD.test(version)) throw new Error(`${version} is not a build's version`);
  for (const t of [from, until])
    if (!TIME.test(t) || Number.isNaN(Date.parse(t)))
      throw new Error(`${t} is not a time (ISO 8601, with its zone)`);
  if (!(Date.parse(from) < Date.parse(until))) throw new Error("--from is not before --until");
  for (const id of cleared) if (!ID.test(id)) throw new Error(`${id} is not a feedback id`);
  return { version, from, until, cleared };
}
const dayOf = (ms: number) => new Date(Math.floor(ms / DAY) * DAY).toISOString().slice(0, 10);
/**
 * The UTC days the window touches, as D1 keeps its days: the first, and the day
 * after the last. A count or a message says only its day, so every day the
 * window touches counts.
 */
export function days(w: Window): { start: string; end: string } {
  return {
    start: dayOf(Date.parse(w.from)),
    end: dayOf(Date.parse(w.until) - 1 + DAY),
  };
}
/**
 * A query from services/edge/queries, its bindings written in as literals:
 * `?1` the first day, `?2` the day after the last, `?3` the version. Wrangler
 * takes no bindings with a command, so each value is one checked above, and
 * whole-line comments go, or Wrangler reads a leading `--` as a flag.
 */
export function bound(sql: string, w: Window): string {
  const { start, end } = days(w);
  const values: Record<string, string> = { "1": start, "2": end, "3": w.version };
  return sql
    .split("\n")
    .filter((line) => !/^\s*--/.test(line))
    .join("\n")
    .trim()
    .replace(/\?([1-9])\b/g, (_, n: string) => {
      if (!(n in values)) throw new Error(`?${n} is not a binding this reader gives`);
      return `'${values[n]}'`;
    });
}
/**
 * Whether a crash report falls in the window. A report says the UTC day it
 * happened, never the hour (its `timestamp` is that day's midnight), so it
 * counts in every window its day touches, the day's either side of a boundary.
 */
export function crashIn(timestamp: number, w: Window): boolean {
  const at = timestamp * 1000;
  return at < Date.parse(w.until) && at + DAY > Date.parse(w.from);
}
/**
 * The one line the clock says of the crash reports, or null when there are
 * none: how many, then their kinds, the most first, within 300 characters.
 */
export function crashSaid(
  version: string,
  total: number,
  kinds: readonly CrashKind[],
): string | null {
  if (total === 0) return null;
  const head = `${total} crash report${total === 1 ? "" : "s"} from ${version}`;
  const listed = [...kinds].sort((a, b) => b.count - a.count || a.said.localeCompare(b.said));
  let line = head;
  let told = 0;
  for (const [i, k] of listed.entries()) {
    const next = `${line}${i === 0 ? ": " : "; "}${k.said} (${k.count})`;
    if (next.length > SAID - 12) break;
    line = next;
    told += k.count;
  }
  return `${line}${total > told ? `${told ? ";" : ":"} ${total - told} more` : ""}.`;
}
/** The evidence, from what the sources said: the copies, the feedback ids, and the crash reports. */
export function evidence(
  w: Window,
  copies: number | null,
  feedbackIds: readonly string[],
  crashes: { total: number; kinds: readonly CrashKind[] },
): Evidence {
  return {
    copies,
    crashes: crashes.total,
    crashSaid: crashSaid(w.version, crashes.total, crashes.kinds),
    feedback: {
      total: feedbackIds.length,
      unmarked: feedbackIds.filter((id) => !w.cleared.includes(id)).length,
    },
  };
}
/** The rows of `wrangler d1 execute --json`: one statement's results. */
export function rows(output: string): Record<string, unknown>[] {
  const parsed: unknown = JSON.parse(output);
  const first = Array.isArray(parsed) ? parsed[0] : null;
  if (!first || first.success !== true || !Array.isArray(first.results))
    throw new Error("D1 did not answer with results");
  return first.results;
}
/** The one row's `copies`: a number, or null when the service counted no check those days. */
export function copiesOf(results: Record<string, unknown>[]): number | null {
  const copies = results[0]?.copies;
  if (copies === null) return null;
  if (typeof copies !== "number" || !Number.isInteger(copies) || copies < 0)
    throw new Error("D1 answered no count of copies");
  return copies;
}
/** The feedback ids, each checked. */
export function idsOf(results: Record<string, unknown>[]): string[] {
  return results.map((r) => {
    if (typeof r.id !== "string" || !ID.test(r.id))
      throw new Error("D1 answered a bad feedback id");
    return r.id;
  });
}
