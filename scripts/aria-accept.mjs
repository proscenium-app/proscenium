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
 * expectation from the run that saw it: the run's evidence, which the build
 * host keeps (scripts/ci-evidence.mjs, `~/.proscenium/ci/evidence/<run>-<attempt>/selftest/`),
 * holds every tree the native pass read, per scheme
 * (`native/aria/<surface>.<scheme>.yml`), whether it matched or not. On the
 * build host it is read in place; anywhere else it is copied over SSH from
 * the host the `mini` git remote names, since this repository names no
 * machine. This copies them in, as `<surface>.yml` and a
 * `<surface>.dark.yml` where the dark pass reads the surface otherwise, and
 * removes the files no surface read, so the folder is exactly what one full
 * run of the checks saw. Read the diff
 * before committing it: it is what VoiceOver is now told.
 *
 * A surface only an Intel Mac shows (its name ends "on an Intel Mac": Settings
 * › Updates, where an Intel Mac takes Stable alone) is read only by the Intel
 * slice, which runs under Rosetta for a stable release or a private run with
 * `-f tier=t2`. Its trees come from that slice's `x86_64/aria/` when the run
 * has one, and are kept as they are when it has not.
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const run = process.argv[2];
const dry = process.argv.includes("--dry");
/** A surface only the Intel slice reads: its name ends "on an Intel Mac". */
const intelOnly = (name) => /-on-an-intel-mac(--\d+)?$/.test(name);
if (!run || !/^\d+$/.test(run)) {
  console.error("usage: node scripts/aria-accept.mjs <pipeline run id> [--dry]");
  process.exit(2);
}

/** The newest attempt's folder of `run` among `names` (`<run>-<attempt>`), or undefined. */
function newestAttempt(names) {
  return names
    .filter((n) => new RegExp(`^${run}-\\d+$`).test(n))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))[0];
}

/** The run's self-test evidence, as the build host keeps it: its folder here. */
function evidence(scratch) {
  const kept = join(
    process.env.PROSCENIUM_CI_DIR || join(homedir(), ".proscenium", "ci"),
    "evidence",
  );
  const here = existsSync(kept) ? newestAttempt(readdirSync(kept)) : undefined;
  if (here) return join(kept, here, "selftest");
  let remote = "";
  try {
    remote = execFileSync("git", ["remote", "get-url", "mini"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    remote = "";
  }
  const host = /^(?:ssh:\/\/)?([^/]+?@[^/:]+)[:/]/.exec(remote)?.[1];
  if (!host) {
    console.error(
      "no `mini` git remote names the build host, where the runs' evidence is kept (git remote add mini <user>@<host>:Dev/playwriter)",
    );
    process.exit(1);
  }
  const ssh = (command, options = {}) =>
    spawnSync("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", host, command], {
      maxBuffer: 1024 ** 3,
      ...options,
    });
  const listed = ssh("ls .proscenium/ci/evidence", { encoding: "utf8" });
  const there = newestAttempt((listed.stdout ?? "").split("\n"));
  if (!there) {
    console.error(
      `the build host keeps no evidence of run ${run} (.proscenium/ci/evidence/${run}-*)`,
    );
    process.exit(1);
  }
  const tar = ssh(`tar -C .proscenium/ci/evidence/${there} -cf - selftest`);
  const untar = spawnSync("tar", ["-xf", "-", "-C", scratch], { input: tar.stdout });
  if (tar.status !== 0 || untar.status !== 0) {
    console.error(`run ${run}'s evidence could not be copied from the build host`);
    process.exit(1);
  }
  return join(scratch, "selftest");
}

const scratch = mkdtempSync(join(tmpdir(), "proscenium-aria-"));
try {
  const kept = evidence(scratch);
  const from = join(kept, "native", "aria");
  if (!existsSync(from)) {
    console.error(`run ${run} kept no native trees (native/aria/ is missing from its evidence)`);
    process.exit(1);
  }
  const report = JSON.parse(readFileSync(join(kept, "native", "report.json"), "utf8"));
  const unfinished =
    (report.passes ?? []).some((p) => p.unfinished || p.interrupted) ||
    (report.passes ?? []).length < 2;
  if (unfinished) {
    console.error(
      `run ${run}'s native pass did not finish both schemes: its trees are not the whole set`,
    );
    process.exit(1);
  }
  const to = join(ROOT, "scripts", "aria", "native");
  // The run keeps each surface's tree per scheme (<name>.light.yml and
  // <name>.dark.yml; older runs, one <name>.yml). The light pass is the file;
  // the dark pass gets its own only where it reads the surface otherwise.
  const trees = new Map();
  const take = (dir, only = () => true) => {
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".yml"))) {
      const m = /^(.*?)(?:\.(light|dark))?\.yml$/.exec(f);
      if (!only(m[1])) continue;
      const entry = trees.get(m[1]) ?? {};
      entry[m[2] ?? "light"] = readFileSync(join(dir, f), "utf8");
      trees.set(m[1], entry);
    }
  };
  take(from);
  // The Intel slice's own surfaces, from its trees when the run has them.
  const intel = join(kept, "x86_64", "aria");
  const hasIntel = existsSync(intel);
  if (hasIntel) take(intel, intelOnly);
  const wanted = new Map();
  for (const [name, { light, dark }] of trees) {
    wanted.set(`${name}.yml`, light ?? dark);
    if (light !== undefined && dark !== undefined && dark !== light)
      wanted.set(`${name}.dark.yml`, dark);
  }
  const present = existsSync(to) ? readdirSync(to).filter((f) => f.endsWith(".yml")) : [];
  const changed = [...wanted.keys()].filter(
    (f) => !present.includes(f) || readFileSync(join(to, f), "utf8") !== wanted.get(f),
  );
  const gone = present.filter(
    (f) => !wanted.has(f) && !(intelOnly(f.replace(/(\.dark)?\.yml$/, "")) && !hasIntel),
  );
  console.log(
    `${trees.size} surfaces in run ${run}: ${changed.length} files new or changed, ${gone.length} no longer read`,
  );
  for (const f of changed) console.log(`  ${present.includes(f) ? "changed" : "new    "}  ${f}`);
  for (const f of gone) console.log(`  gone     ${f}`);
  if (dry) process.exit(0);
  mkdirSync(to, { recursive: true });
  for (const f of changed) writeFileSync(join(to, f), wanted.get(f));
  for (const f of gone) rmSync(join(to, f));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
