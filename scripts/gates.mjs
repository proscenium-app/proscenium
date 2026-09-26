// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The fast gates, before every push: `bun run gates`.
 *
 * Unit tests (the app's and the scripts'), the typecheck, and every `check:*`
 * script in package.json, about half a minute on a warm checkout. Each runs even
 * after another fails, so one pass says everything that is wrong; the exit code
 * is 1 if any failed. Smoke, the Rust tests and the native self-test are the
 * pipeline's: they take minutes, and the pipeline runs them for the files a
 * push changed.
 *
 *   bun run gates             all of them
 *   bun run gates -- --list   the commands, without running them
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The gates, in the order a failure is most useful first. */
export function gateCommands(pkg) {
  const checks = Object.keys(pkg.scripts ?? {})
    .filter((name) => name.startsWith("check:"))
    // Not a gate: a probe of the webview's own network stack, run by hand.
    .filter((name) => name !== "check:webkit-network")
    .sort();
  return [
    ["bun test ./src", ["bun", "test", "./src"]],
    ["bun test ./scripts", ["bun", "test", "./scripts"]],
    ["typecheck", ["bun", "run", "typecheck"]],
    ...checks.map((name) => [name, ["bun", "run", name]]),
  ];
}

function main() {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const gates = gateCommands(pkg);
  if (process.argv.includes("--list")) {
    for (const [, argv] of gates) console.log(argv.join(" "));
    return;
  }
  const results = [];
  const started = Date.now();
  for (const [name, argv] of gates) {
    const t = Date.now();
    const r = spawnSync(argv[0], argv.slice(1), { cwd: ROOT, encoding: "utf8" });
    const ok = r.status === 0;
    results.push({ name, ok, seconds: (Date.now() - t) / 1000 });
    console.log(`  ${ok ? "ok  " : "FAIL"}  ${name} (${((Date.now() - t) / 1000).toFixed(1)} s)`);
    if (!ok) {
      const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n");
      console.log(out.slice(-30).map((l) => `        ${l}`).join("\n"));
    }
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\ngates: ${failed.length ? `${failed.length} failed (${failed.map((f) => f.name).join(", ")})` : "clean"} in ${Math.round((Date.now() - started) / 1000)} s`);
  process.exit(failed.length ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
