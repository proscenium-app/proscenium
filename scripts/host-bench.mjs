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
 * On 2026-09-26, smoke loops run by hand beside a CI self-test stretched one
 * read past its budget, and five of eight runs failed on passing code.
 */
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
