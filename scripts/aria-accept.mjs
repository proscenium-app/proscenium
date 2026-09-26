// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Accept WebKit's accessibility trees from a pipeline run
 * (docs/app/preferences-and-help/accessibility.md#A11Y-16).
 *
 *   node scripts/aria-accept.mjs <run-id>         the run's native trees become
 *                                                 scripts/aria/native/*.yml
 *   node scripts/aria-accept.mjs <run-id> --dry   say what would change, change nothing
 *
 * The native self-test reads each surface's tree in the real app, and only the
 * build host runs it, so a surface that changes on purpose changes its
 * expectation from the run that saw it: the run's `selftest-evidence` keeps
 * every tree the native pass read, per scheme (`native/aria/<surface>.<scheme>.yml`),
 * whether it matched or not. This copies them in, as `<surface>.yml` and a
 * `<surface>.dark.yml` where the dark pass reads the surface otherwise, and
 * removes the files no surface read, so the folder is exactly what one full
 * run of the checks saw. Read the diff
 * before committing it: it is what VoiceOver is now told.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "proscenium-app/backstage";
const run = process.argv[2];
const dry = process.argv.includes("--dry");
if (!run || !/^\d+$/.test(run)) {
  console.error("usage: node scripts/aria-accept.mjs <pipeline run id> [--dry]");
  process.exit(2);
}

const scratch = mkdtempSync(join(tmpdir(), "proscenium-aria-"));
try {
  execFileSync("gh", ["run", "download", run, "-R", REPO, "-n", "selftest-evidence", "-D", scratch], { stdio: "inherit" });
  const from = join(scratch, "native", "aria");
  if (!existsSync(from)) {
    console.error(`run ${run} kept no native trees (native/aria/ is missing from its selftest-evidence)`);
    process.exit(1);
  }
  const report = JSON.parse(readFileSync(join(scratch, "native", "report.json"), "utf8"));
  const unfinished = (report.passes ?? []).some((p) => p.unfinished || p.interrupted) || (report.passes ?? []).length < 2;
  if (unfinished) {
    console.error(`run ${run}'s native pass did not finish both schemes: its trees are not the whole set`);
    process.exit(1);
  }
  const to = join(ROOT, "scripts", "aria", "native");
  // The run keeps each surface's tree per scheme (<name>.light.yml and
  // <name>.dark.yml; older runs, one <name>.yml). The light pass is the file;
  // the dark pass gets its own only where it reads the surface otherwise.
  const kept = readdirSync(from).filter((f) => f.endsWith(".yml"));
  const trees = new Map();
  for (const f of kept) {
    const m = /^(.*?)(?:\.(light|dark))?\.yml$/.exec(f);
    const entry = trees.get(m[1]) ?? {};
    entry[m[2] ?? "light"] = readFileSync(join(from, f), "utf8");
    trees.set(m[1], entry);
  }
  const wanted = new Map();
  for (const [name, { light, dark }] of trees) {
    wanted.set(`${name}.yml`, light ?? dark);
    if (light !== undefined && dark !== undefined && dark !== light) wanted.set(`${name}.dark.yml`, dark);
  }
  const present = existsSync(to) ? readdirSync(to).filter((f) => f.endsWith(".yml")) : [];
  const changed = [...wanted.keys()].filter((f) => !present.includes(f) || readFileSync(join(to, f), "utf8") !== wanted.get(f));
  const gone = present.filter((f) => !wanted.has(f));
  console.log(`${trees.size} surfaces in run ${run}: ${changed.length} files new or changed, ${gone.length} no longer read`);
  for (const f of changed) console.log(`  ${present.includes(f) ? "changed" : "new    "}  ${f}`);
  for (const f of gone) console.log(`  gone     ${f}`);
  if (dry) process.exit(0);
  mkdirSync(to, { recursive: true });
  for (const f of changed) writeFileSync(join(to, f), wanted.get(f));
  for (const f of gone) rmSync(join(to, f));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
