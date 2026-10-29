// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Run the native self-test and judge what it reports (docs/engineering/release-engineering.md#REL-D4).
 *
 *   node scripts/selftest.mjs                   the self-test app built last
 *   node scripts/selftest.mjs --app <.app>      a particular one (CI passes the download)
 *   node scripts/selftest.mjs --break flex      the negative control: it must FAIL
 *   node scripts/selftest.mjs --arch x86_64     the Intel slice; under Rosetta on Apple silicon
 *   node scripts/selftest.mjs --out <dir>       report and screenshots (default .selftest/<run>)
 *   node scripts/selftest.mjs --only <text>     only the checks whose names contain <text>, for
 *                                               chasing one failure; never a verdict on the app
 *   node scripts/selftest.mjs --acts "a,b"      only those acts (scripts/smoke-checks.mjs ACTS), each
 *                                               from a fresh first launch; none is every act
 *   node scripts/selftest.mjs --features a,b    the acts those features choose, as a run's plan does
 *   node scripts/selftest.mjs --order reverse   the acts' order: reverse, or shuffle:<seed> (the
 *                                               independence proof)
 *   node scripts/selftest.mjs --no-retry        a failed act is not tried again from its start
 *   node scripts/selftest.mjs --aria a,b        surfaces (snapshot names) a commit declared changed:
 *                                               their WebKit trees are recorded, not held
 *   node scripts/selftest.mjs --quarantine <f>  the build host's quarantine: its checks' failures
 *                                               are reported and fail nothing
 *   node scripts/selftest.mjs --sandbox         the sandboxed build (build-app.mjs --selftest --sandbox),
 *                                               the Mac App Store's app under the App Sandbox; any app
 *                                               signed into the sandbox is run as one (selftest/sandbox.mjs)
 *
 * Build the app first: `bun run build:selftest` (universal, what CI runs) or
 * `node scripts/build-app.mjs --selftest` (this Mac's slice, faster).
 *
 * The app opens a window and takes keyboard focus for a couple of minutes —
 * it has to, since keys go to the key window. Leave the Mac alone while it runs.
 *
 * Judged here rather than trusted from the exit code alone:
 *   - both colour passes ran, and every check in them passed;
 *   - the slice that ran is the one this Mac should run natively — an Intel
 *     runner that quietly ran the arm64 slice under Rosetta would prove nothing
 *     about Intel (a universal binary on Intel has no Rosetta to fall back on,
 *     so this mostly guards the `--arch` case and the report's honesty);
 *   - with `--break flex`, the run failed, and failed ON the collapsed frame.
 *     A self-test that still passes with `.editor-frame` collapsed is not
 *     looking at the screen, which is the one thing it exists to do.
 *
 * Exits 0 clean, 1 failed, 2 could not run, and 3 INCONCLUSIVE: someone used the
 * Mac mid-run (took the keyboard, locked the screen, hid the window), so the
 * run stopped and proves nothing about the app either way. Run it again.
 */
import { execFileSync, spawn } from "node:child_process";
import { ACTS, actNamed, actRunsIn, actsFor } from "./smoke-checks.mjs";
import { isSandboxed, sandboxDriver } from "./selftest/sandbox.mjs";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const BREAK = opt("--break");
const ONLY = opt("--only");
const FEATURES = opt("--features");
/** The acts each pass runs, in their order: each from a fresh first launch and its own start. */
const RUN_ACTS = (() => {
  const named = (opt("--acts") ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
  // An act the Mac's own WebKit cannot run (one that stages a PC's files) is
  // said, and left out.
  const here = (name) => {
    const act = actNamed(name);
    if (actRunsIn(act, "native")) return true;
    console.log(`selftest: skip ${name} (${act.elsewhere})`);
    return false;
  };
  const list = (
    named.length
      ? named.map((n) => actNamed(n).name)
      : FEATURES
        ? actsFor(FEATURES.split(/[,\s]+/).filter(Boolean))
        : ACTS.map((a) => a.name)
  ).filter(here);
  const order = opt("--order");
  if (!order) return list;
  if (order === "reverse") return [...list].reverse();
  const m = /^shuffle:(\d+)$/.exec(order);
  if (!m) {
    console.error(`selftest: --order is reverse or shuffle:<seed>, not ${order}`);
    process.exit(2);
  }
  // The same seeded shuffle as smoke's, so one seed is one order in both.
  let seed = Number(m[1]) || 1;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
})();
// Every act asked for runs only elsewhere: nothing to run here, and nothing failed.
if (!RUN_ACTS.length) {
  console.log("selftest: none of the acts asked for runs in the Mac's own WebKit: nothing to run");
  process.exit(0);
}
const QUARANTINE = opt("--quarantine");
const ARCH = opt("--arch");
/** Seconds an act may go without reporting back (the app's own watchdog). */
const TIMEOUT = Number(opt("--timeout") ?? 300);

function findApp() {
  const explicit = opt("--app");
  if (explicit) return resolve(explicit);
  const name = args.includes("--sandbox") ? "Proscenium Sandbox Self-Test" : "Proscenium Self-Test";
  const candidates = [
    `src-tauri/target/universal-apple-darwin/release/bundle/macos/${name}.app`,
    `src-tauri/target/release/bundle/macos/${name}.app`,
  ]
    .map((p) => join(ROOT, p))
    .filter(existsSync)
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return candidates[0];
}

const app = findApp();
if (!app || !existsSync(join(app, "Contents/Info.plist"))) {
  console.error("selftest: no Proscenium Self-Test.app — build one with `bun run build:selftest`");
  process.exit(2);
}
const plist = (key) =>
  execFileSync(
    "/usr/libexec/PlistBuddy",
    ["-c", `Print :${key}`, join(app, "Contents/Info.plist")],
    {
      encoding: "utf8",
    },
  ).trim();
if (!plist("CFBundleIdentifier").endsWith(".selftest")) {
  console.error(`selftest: ${app} is not a self-test build — refusing to run it with test data`);
  process.exit(2);
}
const exe = join(app, "Contents/MacOS", plist("CFBundleExecutable"));
/** Signed into the App Sandbox: the driver stands in for the system's panels. */
const SANDBOXED = isSandboxed(app);

const hardware = (() => {
  try {
    return execFileSync("sysctl", ["-n", "hw.optional.arm64"], { encoding: "utf8" }).trim() === "1"
      ? "aarch64"
      : "x86_64";
  } catch {
    return "x86_64"; // the key does not exist on Intel
  }
})();
const expectArch = ARCH === "x86_64" ? "x86_64" : hardware;
const expectTranslated = expectArch !== hardware;

const out = resolve(
  opt("--out") ??
    join(
      ROOT,
      ".selftest",
      `${expectArch}${SANDBOXED ? "-sandbox" : ""}${BREAK ? `-break-${BREAK}` : ""}`,
    ),
);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const reportPath = join(out, "report.json");

const command = ARCH === "x86_64" && hardware !== "x86_64" ? ["arch", ["-x86_64", exe]] : [exe, []];
console.log(
  `selftest: ${app}\n          slice ${expectArch}${expectTranslated ? " (Rosetta)" : ""}${SANDBOXED ? " · App Sandbox" : ""}${BREAK ? ` · break=${BREAK}` : ""} · out ${out}`,
);
const sandbox = SANDBOXED
  ? sandboxDriver({
      bundleId: plist("CFBundleIdentifier"),
      out,
      root: ROOT,
      say: (line) => console.log(`selftest: sandbox: ${line}`),
    })
  : null;
if (expectTranslated) {
  // The notice this run causes has been read as a fault in the app.
  console.log(
    "          macOS 26 answers a Rosetta run with “Support Ending for Intel-based Apps” for the\n" +
      "          self-test app, and may count it later among “apps that still rely on Rosetta”.\n" +
      "          That is this run: the shipped app never runs translated (src-tauri/Info.plist).",
  );
}

/**
 * Launch the app once and wait for it: `env` beside the run's own. Its lines
 * go to this one's stdout; a sandboxed app's asks are answered instead.
 */
async function launch(env, acts) {
  const child = spawn(command[0], command[1], {
    // The sandboxed app asks its driver on stdout and is answered on stdin.
    stdio: [SANDBOXED ? "pipe" : "ignore", "pipe", "inherit"],
    env: {
      ...process.env,
      ...(sandbox?.env ?? {}),
      PROSCENIUM_SELFTEST: reportPath,
      PROSCENIUM_SELFTEST_TIMEOUT: String(TIMEOUT),
      // Where each surface's expected accessibility tree is (scripts/aria-snapshots.mjs).
      PROSCENIUM_SELFTEST_ARIA: join(ROOT, "scripts/aria/native"),
      ...(BREAK ? { PROSCENIUM_SELFTEST_BREAK: BREAK } : {}),
      ...(ONLY ? { PROSCENIUM_SELFTEST_ONLY: ONLY } : {}),
      ...(FEATURES ? { PROSCENIUM_SELFTEST_FEATURES: FEATURES } : {}),
      PROSCENIUM_SELFTEST_ACTS: JSON.stringify(acts),
      PROSCENIUM_SELFTEST_ARIA_DECLARED: JSON.stringify(
        (opt("--aria") ?? "").split(/[,\s]+/).filter(Boolean),
      ),
      ...(args.includes("--no-retry") ? { PROSCENIUM_SELFTEST_RETRY: "0" } : {}),
      ...env,
    },
  });
  // The app has its own watchdog, which an act that stops reporting trips; this
  // one is for an app that cannot even start, or has stopped saying anything: a
  // minute past the app's own limit with no line from it, it is killed.
  let killer;
  const quiet = () => {
    clearTimeout(killer);
    killer = setTimeout(
      () => {
        console.error(`selftest: nothing from the app for ${TIMEOUT + 60}s — killing it`);
        child.kill("SIGKILL");
      },
      (TIMEOUT + 60) * 1000,
    );
  };
  quiet();
  const ASK = "[selftest:ask] ";
  let partial = "";
  child.stdout.on("data", (chunk) => {
    quiet();
    if (!sandbox) {
      process.stdout.write(chunk);
      return;
    }
    partial += chunk;
    for (let at = partial.indexOf("\n"); at >= 0; at = partial.indexOf("\n")) {
      const line = partial.slice(0, at + 1);
      partial = partial.slice(at + 1);
      if (line.startsWith(ASK)) sandbox.answer(line.slice(ASK.length), child.stdin);
      else process.stdout.write(line);
    }
  });
  // A sandboxed app that has gone answers nothing more.
  child.stdin?.on("error", () => {});
  const code = await new Promise((r) =>
    child.on("exit", (c, signal) => r(c ?? (signal ? 128 : 1))),
  );
  clearTimeout(killer);
  if (partial) process.stdout.write(partial);
  return code;
}

/**
 * The relaunch proof (`--reopen`, sandboxed only): the opening act alone,
 * whose launches pick the Plays folder through the folder panel's grant and
 * keep its bookmark, its home kept; then a second process given that home and
 * no grant, which must reopen the folder with the bookmark alone
 * (src-tauri/src/selftest.rs `begin_reopen`).
 */
const REOPEN = args.includes("--reopen");
if (REOPEN && (!SANDBOXED || BREAK || ONLY || ARCH)) {
  console.error("selftest: --reopen is the sandboxed build's relaunch proof, alone");
  process.exit(2);
}
const code = await launch(
  REOPEN ? { PROSCENIUM_SELFTEST_KEEP: "1" } : {},
  REOPEN ? ["opening"] : RUN_ACTS,
);
const reopenPath = join(out, "reopen.json");
let reopened = null;
if (REOPEN && existsSync(reportPath)) {
  const home = JSON.parse(readFileSync(reportPath, "utf8")).home;
  console.log(`selftest: the relaunch, with ${home} and the bookmark it holds`);
  const again = await launch(
    { PROSCENIUM_SELFTEST: reopenPath, PROSCENIUM_SELFTEST_REOPEN: home },
    ["opening"],
  );
  reopened = existsSync(reopenPath) ? JSON.parse(readFileSync(reopenPath, "utf8")) : null;
  if (!reopened)
    reopened = { ok: false, failures: [`the relaunch wrote no report (exit ${again})`] };
  // The first launch's scratch folder, in the container, kept for this.
  if (home) rmSync(dirname(home), { recursive: true, force: true });
}

const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, "utf8")) : null;
const problems = [];
if (!report) problems.push(`the app wrote no report (exit ${code})`);

if (sandbox) {
  if (report)
    problems.push(
      ...sandbox.judge(report, REOPEN ? ["opening"] : RUN_ACTS).map((p) => `sandbox: ${p}`),
    );
  const kinds = {};
  for (const g of sandbox.grants) kinds[g.why] = (kinds[g.why] ?? 0) + 1;
  console.log(
    `selftest: sandbox: ${
      Object.entries(kinds)
        .map(([why, n]) => `${n} from ${why}`)
        .join(", ") || "no grant asked for"
    }`,
  );
  if (reopened && !reopened.ok) problems.push(...reopened.failures.map((f) => `relaunch: ${f}`));
  if (reopened?.ok)
    console.log(
      `selftest: relaunch: refused before (${reopened.before}), reopened ${reopened.lastVault} from its bookmark`,
    );
  sandbox.finish();
}

if (report) {
  if (report.app.arch !== expectArch)
    problems.push(`ran the ${report.app.arch} slice, expected ${expectArch}`);
  if (report.app.translated !== expectTranslated) {
    problems.push(
      `translated=${report.app.translated}, expected ${expectTranslated} — ${expectTranslated ? "not under Rosetta" : "ran under Rosetta"}`,
    );
  }
}

// A run the Mac's owner interrupted is not a verdict on the app, in either
// direction: not a failure to go and fix, and not a pass.
const interrupted = report?.passes?.map((p) => p.interrupted).find(Boolean);

let verdict;
if (interrupted) {
  problems.push(
    interrupted === "keyboard"
      ? "another app took the keyboard mid-run — someone was using the Mac"
      : "the window stopped being visible mid-run — the screen locked, or the window was hidden",
    // Shown, but not judged: a key that went to another app can fail a check
    // before the harness notices the keyboard is gone.
    ...(report.failures ?? []).map((f) => `as it stopped: ${f}`),
  );
  verdict = "INCONCLUSIVE — run it again with the Mac left alone";
} else if (BREAK) {
  // The negative control passes only by failing, on the frame it broke.
  // The collapsed frame, named by the box assertion that exists to catch it.
  const caught = report?.failures?.some((f) =>
    /\.editor-frame|invisible on screen|not rendered at all/.test(f),
  );
  if (code === 0 || report?.ok)
    problems.push(
      `--break ${BREAK} and the self-test still PASSED — it is not looking at the screen`,
    );
  else if (!caught)
    problems.push(
      `--break ${BREAK} failed, but not on a box assertion: ${report?.failures?.[0] ?? "no report"}`,
    );
  verdict = problems.length ? "FAIL" : "ok — the deliberate break was caught";
} else {
  // The quarantine's checks, whose failure already has an owner, fail nothing: reported apart.
  const held = (() => {
    if (!QUARANTINE || !existsSync(QUARANTINE)) return new Set();
    try {
      const now = Date.now();
      return new Set(
        (JSON.parse(readFileSync(QUARANTINE, "utf8")).checks ?? [])
          .filter((q) => Date.parse(q.until) > now)
          .map((q) => q.check),
      );
    } catch {
      return new Set();
    }
  })();
  const counted = (report?.failed ?? []).filter((f) => !held.has(f.check));
  const quarantinedFailing = (report?.failed ?? []).filter((f) => held.has(f.check));
  // For the triage's ledger: what failed under quarantine, and counted nothing.
  if (report)
    writeFileSync(
      join(out, "judged.json"),
      `${JSON.stringify(
        {
          v: 1,
          quarantined: quarantinedFailing.map((f) => ({
            scheme: f.scheme,
            act: f.act,
            check: f.check,
          })),
        },
        null,
        2,
      )}\n`,
    );
  if (quarantinedFailing.length)
    console.log(
      `  quarantined, and failing (reported, not counted): ${quarantinedFailing.map((f) => `${f.scheme} · ${f.check}`).join("; ")}`,
    );
  if (code !== 0 && counted.length === (report?.failed ?? []).length)
    problems.push(`exited ${code}`);
  if (report && !report.ok) {
    const quiet = new Set(quarantinedFailing.map((f) => `${f.scheme} · ${f.check}`));
    problems.push(
      ...report.failures.filter((line) => ![...quiet].some((q) => line.startsWith(`${q}:`))),
    );
  }
  if (report && report.passes?.length !== 2)
    problems.push(`${report.passes?.length ?? 0} of 2 passes ran`);
  verdict = problems.length
    ? "FAIL"
    : ONLY
      ? `ok for the checks matching "${ONLY}" — a partial run, not a verdict`
      : REOPEN
        ? "clean — the opening act, and the relaunch from its bookmark"
        : RUN_ACTS.length < ACTS.filter((a) => actRunsIn(a, "native")).length
          ? `clean, for ${RUN_ACTS.length} of ${ACTS.filter((a) => actRunsIn(a, "native")).length} acts`
          : "clean";
}

if (report) {
  // An act's start is said as it passes, for the flake rule; it is not one of the act's checks.
  const checks = report.passes.flatMap((p) => p.checks ?? []).filter((c) => !c.start);
  // A check skipped is reported as skipped: counted with the passes, it would
  // read as proof it never gave.
  // Left out by --only or --features: not run here by choice, and not counted.
  const unselected = checks.filter((c) => /^not (selected|in this run)/.test(c.skipped ?? ""));
  const skipped = checks.filter((c) => c.skipped && !unselected.includes(c));
  const passed = checks.filter((c) => c.ok && !c.skipped);
  console.log(
    `\nselftest: ${report.app.macos} · ${report.app.arch}${report.app.translated ? " (Rosetta)" : ""} · ` +
      `${passed.length}/${checks.length - skipped.length - unselected.length} checks` +
      `${unselected.length ? ` · ${unselected.length} not selected` : ""}` +
      `${skipped.length ? ` · ${skipped.length} skipped (${[...new Set(skipped.map((c) => c.name))].join(", ")})` : ""}` +
      ` · ${Math.round(report.durationMs / 1000)}s`,
  );
}
for (const f of report?.flakes ?? [])
  console.log(
    `  flake  ${f.scheme} · ${f.act} · ${f.check}: failed once, then green from the act's start: ${f.first}`,
  );
for (const p of problems) console.log(`  ${interrupted ? "STOP" : "FAIL"}  ${p}`);
console.log(`selftest: ${verdict}`);
process.exit(interrupted ? 3 : problems.length ? 1 : 0);
