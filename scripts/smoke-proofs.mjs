// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A new or changed check is proven before it lands: a check that passes once
 * and fails one run in thirty would otherwise make its way to every run.
 *
 * `node scripts/smoke.mjs --prove <check>…` runs each check named 60 times in
 * each engine, some of the runs with the host loaded and some with the clock a
 * day and a year ahead, and writes what it proved here, in
 * `scripts/smoke-proofs.json`: the check's source by hash, the hash of each
 * snapshot it held, and the counts. `bun run land` reads it (scripts/ops/land.mjs):
 * a batch that changes a check, or a snapshot, whose current text no proof
 * names is refused, with the command that proves it.
 *
 * A check's hash is its name and its `run` function's source, so an edit to
 * the check itself needs a proof; an edit to a helper it calls is a change to
 * scripts/smoke-checks.mjs like any other, which every act's run proves.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const PROOFS = "scripts/smoke-proofs.json";
/** Runs per engine a proof takes. */
export const PROOF_RUNS = 60;
/** Of those, how many run with the host loaded, and with the clock moved. */
export const PROOF_LOADED = 10;
export const PROOF_CLOCKS = [
  { label: "+1 day", ms: 24 * 3600_000, runs: 5 },
  { label: "+1 year", ms: 365 * 24 * 3600_000, runs: 5 },
];

const sha = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);

/** A check's hash: its name and its source. */
export function checkHash(check) {
  return sha(`${check.name}\n${check.run.toString()}`);
}

/** A snapshot's hash: its text as the file holds it. */
export const textHash = (text) => sha(text);

/** The proofs file, or an empty one. */
export function readProofs(top) {
  const file = join(top, PROOFS);
  if (!existsSync(file)) return { v: 1, checks: {} };
  return JSON.parse(readFileSync(file, "utf8"));
}

/** Whether a proof entry is whole: every engine run the full count. */
export function whole(entry) {
  return (
    !!entry && (entry.runs?.chromium ?? 0) >= PROOF_RUNS && (entry.runs?.webkit ?? 0) >= PROOF_RUNS
  );
}

/**
 * What a batch changes that no proof names. Pure. `base` and `head` are the
 * checks before and after (objects with `name` and `run`); `snapshots` maps
 * each changed snapshot's slug to its new text; `proofs` is the file.
 * Returns `[{ kind: "check" | "snapshot", name, check? }]`, where a
 * snapshot's `check` is the check a proof last named for it, if any.
 */
export function unproven({ base, head, snapshots, proofs }) {
  const before = new Map(base.map((c) => [c.name, checkHash(c)]));
  const entries = proofs?.checks ?? {};
  const out = [];
  for (const c of head) {
    const hash = checkHash(c);
    if (before.get(c.name) === hash) continue;
    const e = entries[c.name];
    if (!(e && e.hash === hash && whole(e))) out.push({ kind: "check", name: c.name });
  }
  for (const [slug, text] of Object.entries(snapshots)) {
    const h = textHash(text);
    const by = Object.entries(entries).find(([, e]) => whole(e) && e.snapshots?.[slug] === h);
    if (by) continue;
    const last = Object.entries(entries).find(([, e]) => slug in (e.snapshots ?? {}));
    out.push({ kind: "snapshot", name: slug, check: last?.[0] ?? null });
  }
  return out;
}

/** The smoke checks a copy of scripts/ holds, loaded from wherever it is. */
async function checksIn(dir) {
  const m = await import(`${pathToFileURL(join(dir, "smoke-checks.mjs")).href}?at=${Date.now()}`);
  return m.smokeChecks({ audit: async () => {}, hold: async () => {} });
}

/**
 * The batch's unproven checks and snapshots, for `bun run land`: `git` runs
 * git in the worktree `top`, `upstream` is what the batch lands on. Nothing is
 * asked of a batch whose upstream has no proofs file yet: the rule starts on
 * `main` with the commit that brings it.
 */
export async function unprovenInBatch({ git, top, upstream }) {
  const files = git(["diff", "--name-only", "--diff-filter=AM", `${upstream}..HEAD`])
    .out.split("\n")
    .filter(Boolean);
  const checksChanged = files.includes("scripts/smoke-checks.mjs");
  const snapshotFiles = files.filter((f) => /^scripts\/aria\/[^/]+\.yml$/.test(f));
  if (!checksChanged && !snapshotFiles.length) return [];
  if (!git(["cat-file", "-e", `${upstream}:${PROOFS}`]).ok) return [];
  const head = await checksIn(join(top, "scripts"));
  let base = head;
  if (checksChanged) {
    // Inside the checkout, not the system's temporary folder: the checks
    // import packages (pages-sample.mjs, fflate), which resolve only from
    // the checkout's node_modules.
    const dir = mkdtempSync(join(top, "scripts", ".proofs-base-"));
    try {
      for (const f of ["smoke-checks.mjs", "pages-sample.mjs"]) {
        const shown = git(["show", `${upstream}:scripts/${f}`]);
        if (shown.ok) writeFileSync(join(dir, f), `${shown.out}\n`);
      }
      base = existsSync(join(dir, "smoke-checks.mjs")) ? await checksIn(dir) : [];
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const snapshots = Object.fromEntries(
    snapshotFiles.map((f) => [
      f.replace(/^scripts\/aria\//, "").replace(/\.yml$/, ""),
      readFileSync(join(top, f), "utf8"),
    ]),
  );
  return unproven({ base, head, snapshots, proofs: readProofs(top) });
}

/** How a refusal says what to run. */
export function proveCommand(items) {
  const checks = [
    ...new Set(items.map((i) => (i.kind === "check" ? i.name : i.check)).filter(Boolean)),
  ];
  const loose = items.filter((i) => i.kind === "snapshot" && !i.check).map((i) => i.name);
  return [
    checks.length
      ? `node scripts/smoke.mjs --prove ${checks.map((c) => JSON.stringify(c)).join(" ")}`
      : null,
    loose.length ? `and --prove the checks that audit ${loose.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

// `node scripts/smoke-proofs.mjs unproven <upstream>`: the batch's unproven
// checks and snapshots as JSON, for `bun run land`, which runs it as a child
// so that its own steps stay synchronous.
if (process.argv[1] && process.argv[1].endsWith("smoke-proofs.mjs")) {
  const [command, upstream] = process.argv.slice(2);
  if (command !== "unproven" || !upstream) {
    console.error("usage: node scripts/smoke-proofs.mjs unproven <upstream>");
    process.exit(2);
  }
  const { spawnSync } = await import("node:child_process");
  const top = process.cwd();
  const git = (args) => {
    const r = spawnSync("git", args, { cwd: top, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return { ok: r.status === 0, out: (r.stdout ?? "").replace(/\n$/, ""), err: r.stderr ?? "" };
  };
  try {
    console.log(JSON.stringify(await unprovenInBatch({ git, top, upstream })));
  } catch (e) {
    console.error(`smoke-proofs: ${e.message}`);
    process.exit(1);
  }
}
