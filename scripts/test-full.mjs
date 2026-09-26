// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/** One unattended run: every gate in AGENTS.md, then the isolated native
 * self-test. Never installs, launches or quits the writer's real app.
 * `--list` prints the plan without building, testing or opening a window. */
import { execFileSync, spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
if (args.some(arg => arg !== "--list")) {
  console.error("Usage: bun run test:full [--list]");
  process.exit(2);
}
const id = new Date().toISOString().replace(/[:.]/g, "-");
const out = join(root, ".selftest", "full", id);
const app = join(root, "src-tauri/target/release/bundle/macos/Proscenium Self-Test.app");
const steps = [
  ["types", "Type checking", "bun", ["run", "typecheck"]],
  ["layout", "Script layout rules", "bun", ["run", "check:layout"]],
  ["design", "Design tokens", "bun", ["run", "check:design"]],
  ["licenses", "License headers", "bun", ["run", "check:spdx"]],
  ["network", "Network boundaries", "bun", ["run", "check:network"]],
  ["names", "No other writing app named", "bun", ["run", "check:names"]],
  ["docs", "Documentation references", "bun", ["run", "check:docs"]],
  ["version", "Version consistency", "bun", ["run", "check:version"]],
  ["unit", "Application unit tests", "bun", ["test", "./src"]],
  ["rust", "Native unit tests", "cargo", ["test", "--manifest-path", "src-tauri/Cargo.toml"]],
  ["clippy", "Native lints", "cargo", ["clippy", "--manifest-path", "src-tauri/Cargo.toml", "--all-targets", "--", "-D", "warnings"]],
  ["release", "Production build and release isolation", process.execPath, ["scripts/build-app.mjs"]],
  ["webkit", "Safari compatibility of dist/", "bun", ["run", "check:webkit-floor"]],
  ["webkit-network", "Native network boundaries", "bun", ["run", "check:webkit-network"]],
  ["browser", "Complete browser suite in Chromium and WebKit, light and dark", "bun", ["run", "smoke", "--", "--shots"]],
  ["selftest-build", "Build the isolated self-test app", process.execPath, ["scripts/build-app.mjs", "--selftest"]],
  ["negative-control", "Prove the native harness catches a broken layout", process.execPath,
    ["scripts/selftest.mjs", "--app", app, "--break", "flex", "--timeout", "120", "--out", join(out, "negative-control")]],
  ["native", "Complete native UI suite in light and dark", process.execPath,
    ["scripts/selftest.mjs", "--app", app, "--timeout", "900", "--out", join(out, "native")]],
].map(([key, name, command, argv]) => ({ key, name, command, argv, status: "pending", log: `${key}.log` }));

if (args.includes("--list")) {
  console.log("Full test run (preview only; nothing will run):");
  steps.forEach((step, index) => console.log(`${index + 1}. ${step.name}`));
  console.log("Reports and native screenshots: .selftest/full/<timestamp>/; browser screenshots: .smoke/");
  console.log("The native stages need the Mac unlocked and left alone. No installation is performed.");
  process.exit(0);
}
if (process.platform !== "darwin") {
  console.error("This complete bundle includes the macOS native self-test and must run on a Mac.");
  process.exit(2);
}

mkdirSync(out, { recursive: true });
const git = argv => execFileSync("git", argv, { cwd: root, encoding: "utf8" }).trim();
const report = {
  started: new Date().toISOString(), finished: null, status: "running",
  commit: git(["rev-parse", "HEAD"]), dirty: !!git(["status", "--porcelain"]),
  platform: process.platform, arch: process.arch, steps,
};
const reportPath = join(out, "report.json");
function save() {
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  const rows = steps.map(step => `| ${step.name} | ${step.status} | [Log](${step.log}) |`).join("\n");
  writeFileSync(join(out, "report.md"), `# Full test run\n\nStatus: **${report.status}**\n\nCommit: ${report.commit}${report.dirty ? " (with local changes)" : ""}\n\nStarted: ${report.started}\n\n| Check | Result | Details |\n| --- | --- | --- |\n${rows}\n\nBrowser screenshots: .smoke/ (both schemes)\n\nNative UI results: [report](native/report.json)\n\nThe installed app and writing folder are outside this run. Accessibility is held by machine: axe and ARIA snapshots in both browsers, and WebKit's own tree in the native run (docs/app/preferences-and-help/accessibility.md#A11Y-16); no person runs a VoiceOver pass.\n`);
  writeFileSync(join(root, ".selftest/full/latest.json"), JSON.stringify({ report: reportPath, status: report.status }, null, 2) + "\n");
}
save();
console.log(`Full test run: ${out}`);
console.log("Leave the Mac unlocked. Native checks will open the isolated self-test app.");

// Each child owns a new process group. Stopping the run stops only that group,
// including a native self-test launched by its runner, never unrelated apps.
let child = null;
let cancelled = false;
function terminate() {
  if (!child?.pid) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch { /* already exited */ }
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { cancelled = true; terminate(); });
const env = { ...process.env };
// cargo links with the CommandLineTools toolchain unless something chose another (as check-webkit-network.ts).
env.DEVELOPER_DIR ??= "/Library/Developer/CommandLineTools";
// Ambient settings must not turn a full native run into a filtered/broken one.
for (const key of Object.keys(env)) if (key.startsWith("PROSCENIUM_SELFTEST")) delete env[key];

let exitCode = 0;
let awake = null;
try {
  // A step-away run must not lose its display to idle sleep. The assertion
  // ends when this runner exits, even if it cannot execute its finally block.
  awake = spawn('/usr/bin/caffeinate', ['-di', '-w', String(process.pid)], { stdio: 'ignore' });
  await new Promise((resolve, reject) => {
    awake.once('spawn', resolve);
    awake.once('error', reject);
  });
  for (const step of steps) {
    if (cancelled) { exitCode = 130; break; }
    step.status = "running"; step.started = new Date().toISOString(); save();
    console.log(`Running: ${step.name}`);
    const log = openSync(join(out, step.log), "w");
    let timedOut = false;
    try {
      child = spawn(step.command, step.argv, { cwd: root, env, detached: true, stdio: ["ignore", log, log] });
      const timer = setTimeout(() => { timedOut = true; terminate(); }, 20 * 60 * 1000);
      try {
        const result = await new Promise((resolve, reject) => {
          child.once("error", reject);
          child.once("close", (code, signal) => resolve({ code, signal }));
        });
        step.exitCode = result.code; step.signal = result.signal;
        step.status = cancelled ? "cancelled" : timedOut ? "timed out" : result.code === 0 ? "passed"
          : result.code === 3 && ["native", "negative-control"].includes(step.key) ? "inconclusive" : "failed";
      } finally { clearTimeout(timer); }
    } catch (error) {
      step.status = "failed"; step.error = String(error);
    } finally {
      child = null; closeSync(log); step.finished = new Date().toISOString(); save();
    }
    console.log(`${step.status}: ${step.name}`);
    if (step.status !== "passed") {
      exitCode = cancelled ? 130 : step.status === "inconclusive" ? 3 : 1;
      break;
    }
  }
} catch (error) {
  exitCode = 1;
  report.error = String(error);
  console.error(error);
} finally {
  awake?.kill();
  report.finished = new Date().toISOString();
  report.status = cancelled ? "cancelled" : exitCode === 3 ? "inconclusive" : exitCode ? "failed" : "passed";
  for (const step of steps) if (step.status === "pending") step.status = "not run";
  save();
  console.log(`Report: ${join(out, "report.md")}`);
}
process.exitCode = exitCode;
