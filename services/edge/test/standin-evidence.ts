// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What a release's clock reads about a build, from the stand-in
 * (docs/engineering/services-and-feedback.md#SERV-280):
 *
 *   bun test/standin-evidence.ts --version <v> --from <iso> --until <iso> [--cleared id,id]
 *
 * prints `{ copies, crashes, crashSaid, feedback: { total, unmarked } }` as
 * JSON: the copies and the feedback from the stand-in's local D1, by the same
 * queries the live reader runs on production's, and the crash reports from the
 * Sentry stand-in's file, counted as Sentry counts its events. Local only.
 */
import { existsSync, readFileSync } from "node:fs";
import {
  bound,
  copiesOf,
  evidence,
  idsOf,
  rows,
  window,
  crashIn,
  type CrashKind,
  type Evidence,
  type Window,
} from "../src/evidence.ts";
import type { Received } from "./sentry-standin.ts";
import { EDGE, localWrangler, SENTRY_LOG, standInConfig } from "./standin.ts";

const query = (name: string) => readFileSync(`${EDGE}queries/${name}.sql`, "utf8");

/** The crash reports in the window, from the Sentry stand-in's lines, by kind. */
export function crashesIn(log: string, w: Window): { total: number; kinds: CrashKind[] } {
  const kinds = new Map<string, number>();
  let total = 0;
  for (const line of log.split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line) as Received;
    if (r.release !== w.version || !crashIn(r.timestamp, w)) continue;
    total++;
    kinds.set(r.exception, (kinds.get(r.exception) ?? 0) + 1);
  }
  return { total, kinds: [...kinds].map(([said, count]) => ({ said, count })) };
}
/** The evidence from the stand-in: `d1` runs a query on its database, `sentry` is its Sentry stand-in's file. */
export function standInEvidence(
  w: Window,
  d1: (sql: string) => Record<string, unknown>[],
  sentry: string,
): Evidence {
  return evidence(
    w,
    copiesOf(d1(bound(query("copies-by-version"), w))),
    idsOf(d1(bound(query("feedback-by-version"), w))),
    crashesIn(sentry, w),
  );
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const opt = (name: string) => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args[i + 1];
  };
  const [version, from, until] = ["--version", "--from", "--until"].map(opt);
  if (!version || !from || !until)
    throw new Error("usage: --version <v> --from <iso> --until <iso> [--cleared id,id]");
  const w = window(version, from, until, (opt("--cleared") ?? "").split(",").filter(Boolean));
  const database = standInConfig().d1_databases[0].database_name;
  const d1 = (sql: string) =>
    rows(localWrangler(["d1", "execute", database, "--json", `--command=${sql}`]));
  const sentry = existsSync(SENTRY_LOG) ? readFileSync(SENTRY_LOG, "utf8") : "";
  console.log(JSON.stringify(standInEvidence(w, d1, sentry)));
}
