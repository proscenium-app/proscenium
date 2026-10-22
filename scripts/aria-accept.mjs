// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Accept WebKit's accessibility trees from a pipeline run
 * (docs/app/preferences-and-help/accessibility.md#A11Y-16).
 *
 *   node scripts/aria-accept.mjs <run-id>         the run's native trees become
 *                                                 scripts/aria/native/*.yml
 *   node scripts/aria-accept.mjs <run-id> --dry   say what would change, change nothing
 *   node scripts/aria-accept.mjs --windows <run-id> [--dry]
 *                                                 a Windows check's trees of the real
 *                                                 Windows app become scripts/aria/windows/*.yml
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
 *
 * `--windows`: the trees Playwright read of the real Windows app, the PC
 * copy's (scripts/aria/windows/). The Windows check of a commit runs smoke's
 * acts in the app on its test machine with `--aria-out`, which keeps every
 * tree the run read, matched or not, laid out as `--update-aria` would write
 * the folder (scripts/smoke.mjs). It keeps them on that machine, in
 * `C:\proscenium-runner\evidence\<run>-<attempt>\aria\`, and uploads nothing.
 * On that machine they are read in place; anywhere else they are copied over
 * SSH from the host the `nuc` git remote names. Files new or changed are
 * written; a file the run read nothing for is removed only when every act ran
 * to its end (`kept.json`'s `whole`). Read the diff before committing it: it
 * is what the PC copy's tree now says.
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
import { acceptPlan } from "./aria-snapshots.mjs";
import { variantOfFile } from "./smoke-variants.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const run = process.argv.slice(2).find((a) => !a.startsWith("--"));
const dry = process.argv.includes("--dry");
const windows = process.argv.includes("--windows");
/** A surface only the Intel slice reads: its name ends "on an Intel Mac". */
const intelOnly = (name) => /-on-an-intel-mac(--\d+)?$/.test(name);
if (!run || !/^\d+$/.test(run)) {
  console.error(
    "usage: node scripts/aria-accept.mjs <pipeline run id> [--dry]\n       node scripts/aria-accept.mjs --windows <Windows check run id> [--dry]",
  );
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

/** Where the Windows check keeps a run's evidence, on its test machine. */
const WINDOWS_EVIDENCE = "C:\\proscenium-runner\\evidence";

/** The Windows check's kept trees of `run` (scripts/smoke.mjs --aria-out): their folder here. */
function windowsTrees(scratch) {
  if (process.platform === "win32" && existsSync(WINDOWS_EVIDENCE)) {
    const here = newestAttempt(readdirSync(WINDOWS_EVIDENCE));
    if (here) return join(WINDOWS_EVIDENCE, here, "aria");
  }
  let remote = "";
  try {
    remote = execFileSync("git", ["remote", "get-url", "nuc"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    remote = "";
  }
  // `nuc:C:/Dev/playwriter`, `user@host:path` or `ssh://host/path`.
  const host = /^(?:ssh:\/\/)?((?:[^@/:]+@)?[^@/:]+)[:/]/.exec(remote)?.[1];
  if (!host) {
    console.error(
      "no `nuc` git remote names the Windows check's host, where its runs' evidence is kept (git remote add nuc <host>:C:/Dev/playwriter)",
    );
    process.exit(1);
  }
  const options = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10"];
  const listed = spawnSync(
    "ssh",
    [...options, host, `Get-ChildItem -Name ${WINDOWS_EVIDENCE.replaceAll("\\", "/")}`],
    { encoding: "utf8" },
  );
  if (listed.status !== 0) {
    console.error(
      `the Windows check's host (${host}) could not be asked for its evidence: ${(listed.stderr ?? "").trim().split("\n")[0] || `ssh exited ${listed.status}`}`,
    );
    process.exit(1);
  }
  const there = newestAttempt((listed.stdout ?? "").split(/\r?\n/).map((l) => l.trim()));
  if (!there) {
    console.error(
      `the Windows check's host keeps no evidence of run ${run} (${WINDOWS_EVIDENCE}\\${run}-*)`,
    );
    process.exit(1);
  }
  const copied = spawnSync(
    "scp",
    [
      ...options,
      "-q",
      "-r",
      `${host}:${WINDOWS_EVIDENCE.replaceAll("\\", "/")}/${there}/aria`,
      scratch,
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  if (copied.status !== 0 || !existsSync(join(scratch, "aria"))) {
    console.error(
      `run ${run}'s Windows trees could not be copied from the Windows check's host (its aria\\ is missing: smoke never finished there)`,
    );
    process.exit(1);
  }
  return join(scratch, "aria");
}

/** `--windows`: the run's trees of the real Windows app become scripts/aria/windows/. */
function acceptWindows() {
  const scratch = mkdtempSync(join(tmpdir(), "proscenium-aria-"));
  try {
    const from = windowsTrees(scratch);
    const manifest = join(from, "kept.json");
    if (!existsSync(manifest)) {
      console.error(`run ${run} kept no Windows trees (aria\\kept.json is missing)`);
      process.exit(1);
    }
    const { whole, unfinished = [], variants = [] } = JSON.parse(readFileSync(manifest, "utf8"));
    // A variant's own files go only when that variant read every surface it
    // could (scripts/smoke-variants.mjs); the PC copy's own when the plain pass did.
    const wholeFor = (f) => {
      const v = variantOfFile(f);
      return v ? variants.includes(v) : whole;
    };
    const ymls = (dir) =>
      existsSync(dir)
        ? new Map(
            readdirSync(dir)
              .filter((f) => f.endsWith(".yml"))
              .map((f) => [f, readFileSync(join(dir, f), "utf8")]),
          )
        : new Map();
    const to = join(ROOT, "scripts", "aria", "windows");
    const wanted = ymls(from);
    const present = ymls(to);
    const { changed, gone } = acceptPlan(present, wanted, { whole, wholeFor });
    console.log(
      `${wanted.size} trees in run ${run}'s Windows check: ${changed.length} files new or changed, ${gone.length} no longer read${whole ? "" : `; the run did not read every surface${unfinished.length ? ` (unfinished: ${unfinished.join(", ")})` : ""}, so nothing is removed`}`,
    );
    for (const f of changed) console.log(`  ${present.has(f) ? "changed" : "new    "}  ${f}`);
    for (const f of gone) console.log(`  gone     ${f}`);
    if (dry) return;
    mkdirSync(to, { recursive: true });
    for (const f of changed) writeFileSync(join(to, f), wanted.get(f));
    for (const f of gone) rmSync(join(to, f));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (windows) {
  acceptWindows();
  process.exit(0);
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
  // A store build's own reading (`<name>.store.yml`) comes from the sandboxed
  // self-test's run, never the download build's: it is kept as it is.
  const gone = present.filter(
    (f) =>
      !wanted.has(f) &&
      !/\.store(\.dark)?\.yml$/.test(f) &&
      !(intelOnly(f.replace(/(\.dark)?\.yml$/, "")) && !hasIntel),
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
