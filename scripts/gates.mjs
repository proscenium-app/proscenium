// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The fast gates, before every push: `bun run gates`.
 *
 * Unit tests (the app's and the scripts'), the typecheck, the lint and the
 * format check, and every `check:*` script in package.json, about half a
 * minute on a warm checkout. Each runs even
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

/**
 * How long one test of the scripts' suite may take, in milliseconds.
 *
 * Bun's own limit is five seconds. About two dozen of these test files drive a
 * real git over scratch repositories: around a second a test while the build
 * host is idle, and several times that while other work there has the
 * processor. On 2026-10-06 three of them ran past five seconds beside another
 * job on the host, were cut off in the middle of a push, and failed a
 * release's test run; the unit tests and the typecheck that followed took
 * about ten times their usual time. Ten times the suite's slowest test, about
 * two seconds idle, is under half a minute, and this is twice that. A test
 * that hangs still fails, a minute in.
 *
 * It rides on the command because bun 1.3 has no other place that reaches
 * every file: bunfig.toml has no key for it, and `setDefaultTimeout` reaches
 * one file only, whether a test file, a module the files share or a preload
 * calls it. A file's own `setDefaultTimeout` also wins over the command's, so
 * no test file here calls it; a test that needs longer says so as `test`'s
 * third argument.
 */
export const SCRIPT_TEST_LIMIT_MS = 60_000;

/** The scripts' own tests, as everything that runs the whole suite runs them. */
export const SCRIPT_TESTS = ["bun", "test", "./scripts", "--timeout", String(SCRIPT_TEST_LIMIT_MS)];

/** The gates, in the order a failure is most useful first. */
export function gateCommands(pkg) {
  const checks = Object.keys(pkg.scripts ?? {})
    .filter((name) => name.startsWith("check:"))
    // Not a gate: a probe of the webview's own network stack, run by hand.
    .filter((name) => name !== "check:webkit-network")
    .sort();
  return [
    ["bun test ./src", ["bun", "test", "./src"]],
    ["bun test ./scripts", SCRIPT_TESTS],
    ["typecheck", ["bun", "run", "typecheck"]],
    // Biome's rules and its formatting, and rustfmt's (docs/engineering/release-engineering.md#REL-102).
    ["lint", ["bun", "run", "lint"]],
    ["format:check", ["bun", "run", "format:check"]],
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
      console.log(
        out
          .slice(-30)
          .map((l) => `        ${l}`)
          .join("\n"),
      );
    }
  }
  const failed = results.filter((r) => !r.ok);
  console.log(
    `\ngates: ${failed.length ? `${failed.length} failed (${failed.map((f) => f.name).join(", ")})` : "clean"} in ${Math.round((Date.now() - started) / 1000)} s`,
  );
  process.exit(failed.length ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
