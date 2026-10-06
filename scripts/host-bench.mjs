// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * One heavy run at a time on a host that runs a timing-sensitive native test
 * beside other work. A host like that names, in `PROSCENIUM_BENCH_MODULE`, a
 * module (relative to the repository root) whose `holdBench(what)` waits for
 * its bench and holds it until the process exits; smoke and an app build call
 * it before their heavy part. Anywhere that names no module, nothing waits.
 *
 * Why: a native self-test's accessibility-tree reads share the host's cores.
 * Smoke loops run by hand beside a CI self-test once stretched one read past
 * its budget, and five of eight runs failed on passing code.
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

export async function holdHostBench(what) {
  const name = process.env.PROSCENIUM_BENCH_MODULE;
  if (!name) return;
  // Named and missing is a host set up wrong: say so, rather than run unguarded.
  const { holdBench } = await import(pathToFileURL(resolve(ROOT, name)).href);
  await holdBench(what);
}

/**
 * `node scripts/host-bench.mjs "<what>" -- <command…>`: the command, run
 * holding the bench, so a heavy step the pipeline runs directly (cargo's)
 * never shares the host with a native self-test, whose tree reads a heavy
 * build beside it once stretched past their budget. Its exit code is the
 * command's.
 */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf("--");
  const what = process.argv[2];
  const command = at > 0 ? process.argv.slice(at + 1) : [];
  if (!what || what === "--" || command.length === 0) {
    console.error('usage: node scripts/host-bench.mjs "<what>" -- <command…>');
    process.exit(2);
  }
  await holdHostBench(what);
  const child = spawn(command[0], command.slice(1), { stdio: "inherit" });
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}
