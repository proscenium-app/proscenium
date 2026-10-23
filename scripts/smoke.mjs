// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The shipped-bundle smoke test.
 *
 * `bun run dev` is not the app. It runs unminified React with
 * `import.meta.env.DEV` true, which switches the storage layer to the in-memory
 * dev vault — so a whole class of failure (a production-only bundle problem, a
 * surface that only renders on the real IPC path) never appears there. And the
 * native window cannot be driven at all: `tauri-driver` is Linux and Windows
 * only, because macOS's safaridriver will not attach to an in-app WKWebView.
 *
 * So this drives the PRODUCTION bundle out of `dist/` in a real browser, on the
 * app's own in-memory vault (`__PROSCENIUM_FIXTURE__`, fenced behind
 * `!isTauri()` in ipc.ts). It is the closest thing to the shipped app that can
 * be checked without a person looking at a screen.
 *
 * **It asserts that things are VISIBLE, not that they exist.** The bug this was
 * written for was a stylesheet edit that swallowed `.editor-frame { flex: 1 }`:
 * every element was in the DOM, every selector matched, and the window was
 * blank because the frame had collapsed to zero height. A test that clicks by
 * selector passes straight through that — which is how it shipped.
 *
 *   bun run smoke                   # headless, fails loudly
 *   bun run smoke -- --shots        # a PNG in .smoke/ of each check that fails
 *   bun run smoke -- --shots=all    # ... and of every check that passes
 *   bun run smoke -- --engine webkit  # one engine only (chromium or webkit)
 *   SMOKE_TIME_SCALE=3 bun run smoke  # a slow host: every wait may take three times as long
 *   bun run smoke -- --serial       # the engines one after the other, not side by side
 *   bun run smoke -- --acts editor,spelling  # named acts only (smoke-checks.mjs ACTS)
 *   bun run smoke -- --features spell  # the opening act and spell's acts; a run's plan first adds
 *                                      # every feature that uses spell (ci-plan.mjs explain names its acts)
 *   bun run smoke -- --order reverse  # another order: reverse, or shuffle:<seed>
 *   bun run smoke -- --no-retry     # a failed act is not run again from its start
 *   bun run smoke -- --quarantine <file>  # the build host's quarantine: reported, not failing
 *   bun run smoke -- --update-aria  # rewrite scripts/aria/*.yml from this run
 *   node scripts/smoke.mjs --engine webview2 --app <exe> --aria-out <dir>
 *                                   # the real Windows app: every tree it read kept in <dir>,
 *                                   # as --update-aria would write scripts/aria/windows/ (below)
 *   bun run smoke -- --timing <file>  # each check's time, per pass, as JSON
 *   node scripts/smoke.mjs --prove "<check>" …  # prove a new or changed check (below)
 *   node scripts/smoke.mjs --engine webview2 --app <exe> --prove "<check>"
 *                                   # a check whose act runs only in the real Windows app, on a PC
 *
 * **Behaviour once, the look in both schemes.** One pass per engine runs every
 * check, in the light scheme. At each surface a check audits, the page is
 * switched to dark and audited and held again, then switched back: a scheme
 * changes contrast and what a surface says, not what a key or a save does. The
 * dark audit sees exactly the page the light one saw. A whole second pass in
 * dark cost as long as the first; running only the auditing checks in it
 * changed the page under them, because the checks stand on each other's state
 * (31 of them then failed).
 *
 * **It also asserts that things can be REACHED** (docs/app/preferences-and-help/accessibility.md#A11Y-19). Every surface
 * it opens is scanned with axe-core against WCAG 2.2 A and AA, and a critical
 * or serious finding fails the run. A scanner cannot press keys, though, and
 * the worst accessibility bugs this app had were key bugs no scanner sees —
 * ⏎ on Cancel saving the sheet, Escape in a popup closing the sheet under it,
 * a Go to Scene field that never had focus. Those are asserted by pressing
 * the keys, in the checks named "keyboard".
 *
 * **In two engines** (docs/app/preferences-and-help/accessibility.md#A11Y-19). Every check
 * runs in Chromium and again in Playwright's WebKit, in both schemes. Playwright's
 * WebKit is a WebKit, built from WebKit's own source, but it is not Apple's
 * WKWebView and it is not the macOS floor's Safari: it catches a page that
 * works in one engine and not the other, not an old engine's gaps
 * (check:webkit-floor does that) and not the app's webview (the native
 * self-test does that).
 *
 * **And the tree a screen reader is given** (docs/app/preferences-and-help/accessibility.md#A11Y-19).
 * At every surface it audits, Chromium takes Playwright's ARIA snapshot of the
 * page — roles, names, states, the live regions — and holds it against
 * scripts/aria/<surface>.yml in both schemes (scripts/aria-snapshots.mjs). The
 * checks that read the tree themselves (a text box's words, what was
 * announced, the order Tab takes) hold it in both engines, each engine's own
 * file where they differ. A change to what a surface says to VoiceOver
 * is a change to that file, reviewed like code: `--update-aria` writes it.
 *
 * **And that the page reaches nothing** (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D2). dist/ is
 * served under the content security policy tauri.conf.json gives the app, so a
 * script, style or fetch the policy would block in the app is blocked, and
 * reported, here; and every request the page makes to anywhere but this server
 * is stopped and fails the run.
 *
 * **A new or changed check is proven before it lands** (scripts/smoke-proofs.mjs).
 * `--prove` runs the act of each check named 60 times in each engine, never a
 * second try: ten runs with every core of the host kept busy, five with the
 * page's clock a day ahead and five a year ahead, the rest as a pass runs. A
 * check that passed every run is written to scripts/smoke-proofs.json with its
 * source's hash and the hash of every snapshot it held.
 */
import { chromium, webkit } from "playwright";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { availableParallelism } from "node:os";
import { dirname, extname, join, normalize as normalizePath } from "node:path";
import {
  ACTS,
  AUDIT_TAGS,
  SETTLE_TIMEOUT_MS,
  TIME_SCALE,
  actNamed,
  actRunsIn,
  actsFor,
  actsOf,
  pageSettles,
  proofEngines,
  recordAudit,
  runAxe,
  setSmokeSystem,
  smokeChecks,
  startOf,
} from "./smoke-checks.mjs";
import {
  SurfaceNames,
  firstDifference,
  forSurface,
  keepTree,
  keepVariantTree,
  normalize,
} from "./aria-snapshots.mjs";
import { variantNames, variantOfFile, variantsFrom } from "./smoke-variants.mjs";
import { holdHostBench } from "./host-bench.mjs";
import { JOURNAL, note, openJournal } from "./smoke-journal.mjs";
import { pcHost } from "./smoke-pc-host.mjs";
import {
  PROOF_CLOCKS,
  PROOF_LOADED,
  PROOF_RUNS,
  PROOFS,
  checkHash,
  readProofs,
  textHash,
} from "./smoke-proofs.mjs";

const STARTED = Date.now();
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
const argValue = (name) =>
  process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null;
/** "failures": a PNG of each failing check; "all": of every check too. */
const SHOTS = process.argv.includes("--shots=all")
  ? "all"
  : process.argv.includes("--shots")
    ? "failures"
    : null;
const UPDATE_ARIA = process.argv.includes("--update-aria");
const ONE_ENGINE = argValue("--engine");
/** The checks `--prove` names: every argument after it up to the next option. */
const PROVE = (() => {
  const at = process.argv.indexOf("--prove");
  if (at < 0) return null;
  const names = [];
  for (const a of process.argv.slice(at + 1)) {
    if (a.startsWith("--")) break;
    names.push(a);
  }
  const unknown = names.filter((n) => !ACTS.some((a) => a.checks.includes(n)));
  if (!names.length || unknown.length) {
    console.error(
      names.length
        ? `smoke: no check is named ${unknown.map((n) => JSON.stringify(n)).join(", ")}`
        : "smoke: --prove names the checks it proves",
    );
    process.exit(2);
  }
  for (const other of ["--acts", "--features", "--order", "--update-aria", "--quarantine"])
    if (process.argv.includes(other)) {
      console.error(`smoke: --prove runs its checks' acts in both engines, alone; drop ${other}`);
      process.exit(2);
    }
  // A check is proven in the engines its act runs in (smoke-checks.mjs
  // proofEngines): smoke's two, or the one of them it runs in, with
  // `--engine`; the real Windows app's for an act that runs only there, which
  // is proven on a PC with `--engine webview2`.
  const engine = argValue("--engine");
  for (const name of names) {
    const act = ACTS.find((a) => a.checks.includes(name));
    const wanted = proofEngines(act);
    const given = engine ? [engine] : ["chromium", "webkit"];
    if (wanted.join() !== given.join()) {
      const how = wanted.includes("webview2")
        ? ", on a PC: --prove it with --engine webview2 there"
        : wanted.length === 1
          ? `: --prove it with --engine ${wanted[0]}`
          : ": drop --engine";
      console.error(`smoke: "${name}" is proven in ${wanted.join(" and ")}${how}`);
      process.exit(2);
    }
  }
  return names;
})();
/**
 * The acts to run (smoke-checks.mjs ACTS), by name, comma-separated; none is
 * every act. `--features a,b` chooses the opening act and every act of those
 * features; a run's plan first adds every feature that uses them, so its acts
 * are what `node scripts/ci-plan.mjs explain` names.
 */
const ACT_NAMES = (() => {
  const named = (argValue("--acts") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const features = (argValue("--features") ?? "").split(/[,\s]+/).filter(Boolean);
  if (named.length && features.length) {
    console.error("smoke: --acts or --features, not both");
    process.exit(2);
  }
  if (PROVE) return [...new Set(PROVE.map((c) => ACTS.find((a) => a.checks.includes(c)).name))];
  if (features.length) return actsFor(features);
  for (const n of named) actNamed(n);
  return named;
})();
/** The acts' order: as named, `reverse`, or `shuffle:<seed>`, as the proof that each act stands on its own start runs them. */
const ORDER = argValue("--order");
/** Acts run at once in each engine: each has a browser context of its own. */
const WORKERS =
  UPDATE_ARIA || ONE_ENGINE === "webview2" ? 1 : Math.max(1, Number(argValue("--workers") ?? 3));
/** An act with a failing check runs once more from its start; a check green then is a flake. */
const RETRY = !process.argv.includes("--no-retry") && !PROVE;
/** The build host's quarantine, checks whose failure already has an owner: they run and are reported, and fail nothing. Never on a tag's run. */
const QUARANTINE = argValue("--quarantine");
const TIMING = argValue("--timing");
if (ACT_NAMES.length && UPDATE_ARIA) {
  console.error(
    "smoke: --update-aria writes every surface's snapshot, so it runs every act; drop --acts",
  );
  process.exit(2);
}
/**
 * The real Windows app, by `--engine webview2` alone, on Windows
 * (scripts/smoke-webview2.mjs): its snapshots are the PC copy's, in
 * scripts/aria/windows/.
 */
const WEBVIEW2 = ONE_ENGINE === "webview2";
const ENGINES = {
  chromium,
  webkit,
  ...(WEBVIEW2 ? { webview2: (await import("./smoke-webview2.mjs")).webview2 } : {}),
};
if (WEBVIEW2) setSmokeSystem("pc");
if (ONE_ENGINE && !ENGINES[ONE_ENGINE]) {
  console.error(`smoke: --engine is chromium, webkit or webview2, not ${ONE_ENGINE}`);
  process.exit(2);
}
if (ONE_ENGINE && !WEBVIEW2 && process.argv.includes("--update-aria")) {
  console.error(
    "smoke: --update-aria writes the shared snapshots from Chromium and WebKit's own where it differs, so it runs both engines",
  );
  process.exit(2);
}
/**
 * `--aria-out <dir>`, the real Windows app alone: every tree the run read is
 * kept in <dir>, laid out as `--update-aria` would have written
 * scripts/aria/windows/, while each is still held against the checked-in
 * file. A test machine's run may not write the checkout's own folder, so it
 * keeps them as its evidence, and `node scripts/aria-accept.mjs --windows
 * <run>` takes them in. Written once the acts have run, with `kept.json`
 * saying whether every act ran to its end, the one case in which a file the
 * run read nothing for is one no surface uses.
 */
const ARIA_OUT = argValue("--aria-out");
if (ARIA_OUT && (!WEBVIEW2 || UPDATE_ARIA || PROVE)) {
  console.error(
    "smoke: --aria-out keeps the real Windows app's trees: with --engine webview2, and not with --update-aria or --prove",
  );
  process.exit(2);
}
/**
 * `--variants <names>|all`, the real Windows app alone: after its acts, the
 * acts each variant names, again, as a writer's PC is set up otherwise
 * (scripts/smoke-variants.mjs): its display's scale, forced colours, its
 * display language. A failure names its act and its variant: "editor (de)".
 */
const VARIANT_LIST = variantsFrom(argValue("--variants"));
if (VARIANT_LIST.length && (!WEBVIEW2 || UPDATE_ARIA || PROVE)) {
  console.error(
    "smoke: --variants are the real Windows app's: with --engine webview2, and not with --update-aria or --prove",
  );
  process.exit(2);
}
/** Chromium first: its reading is the shared file, WebKit's the exception. */
const ENGINE_ORDER = ONE_ENGINE ? [ONE_ENGINE] : Object.keys(ENGINES);
const OUT = fileURLToPath(new URL("../.smoke/", import.meta.url));
const ARIA = fileURLToPath(new URL(WEBVIEW2 ? "./aria/windows/" : "./aria/", import.meta.url));
/** The folder as a message names it. */
const ARIA_SAID = WEBVIEW2 ? "scripts/aria/windows/" : "scripts/aria/";
// Each run's shots are its own. The CI runner keeps ignored files between
// runs, so a folder never emptied held every older run's shots, stale names
// and names the artifact upload refuses among them.
if (SHOTS) rmSync(OUT, { recursive: true, force: true });
const AXE = await readFile(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
/** Where the page loads axe from: a file of this server's, since the policy refuses inline scripts. */
const AXE_PATH = "/__smoke__/axe.min.js";

/** The app's own policy, as the webview receives it (tauri.conf.json `app.security.csp`). */
const CSP = Object.entries(
  JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8")).app
    .security.csp,
)
  .map(([directive, sources]) => `${directive} ${sources}`)
  .join("; ");

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".svg": "image/svg+xml",
  ".map": "application/json",
  ".dic": "text/plain",
  ".aff": "text/plain",
};

/** Serve dist/ exactly as the webview sees it: absolute /assets/… paths. */
function serve() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
      if (path === AXE_PATH) {
        res.writeHead(200, { "content-type": "text/javascript" });
        res.end(AXE);
        return;
      }
      const file = join(DIST, normalizePath(path === "/" ? "/index.html" : path));
      if (!file.startsWith(DIST)) {
        res.writeHead(403).end();
        return;
      }
      try {
        const body = await readFile(file);
        res.writeHead(200, {
          "content-type": MIME[extname(file)] ?? "application/octet-stream",
          // The app's policy: what it blocks in the app, it blocks here.
          "content-security-policy": CSP,
        });
        res.end(body);
      } catch {
        res.writeHead(404).end("not found");
      }
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

/*
 * The checks themselves live in scripts/smoke-checks.mjs, shared with the
 * native self-test that runs them inside the real app (docs/engineering/release-engineering.md#REL-D4).
 * This file is the browser driver: it serves dist/, loads axe into the page,
 * and runs every check once per engine, auditing each surface in both colour
 * schemes. The engines run side by side, each in its own browser, since
 * nothing one does reaches the other; `--update-aria` runs them one after the
 * other, because WebKit's files are written against Chromium's.
 */
const advisories = new Map();

/**
 * Where a `--shots` screenshot goes, named for its engine, scheme and its check
 * or surface. Those names quote keys, markup and docs paths, and
 * actions/upload-artifact refuses a whole artifact over one `"` `:` `<` `>`
 * `|` `*` `?` or line break in any path, which is how a failing run in CI
 * came to keep no screenshots at all; a `/` or `\` would file the shot in a
 * folder. Each run of those and of spaces becomes one `-`, and the rest (`·`,
 * `⌘`, `#`) stays, so the file still reads as its check. APFS allows a name
 * 255 bytes.
 */
function shotPath(scheme, name) {
  mkdirSync(OUT, { recursive: true });
  let file = `${scheme}-${name}`.replace(/[\s":<>|*?\\/]+/g, "-");
  while (Buffer.byteLength(`${file}.png`) > 255) file = Array.from(file).slice(0, -1).join("");
  return join(OUT, `${file}.png`);
}

/**
 * One engine's pass: which engine, which scheme the page is in right now, the
 * snapshot names counted in each scheme, and the findings of the check running.
 */
function newPass(engine, variant = null) {
  return {
    engine,
    /** The variant pass this is (scripts/smoke-variants.mjs), by name, or null. */
    variant: variant?.name ?? null,
    /** The axe rules a variant leaves to something else. */
    axeDisable: variant?.axe?.disable ?? [],
    scheme: "light",
    names: new SurfaceNames(),
    darkNames: new SurfaceNames(),
    audits: { findings: [], advisories },
    runningCheck: "",
    /** The trees this pass read, as `--aria-out` keeps them (keepTree). */
    kept: new Map(),
  };
}

/** The next frame the page draws. */
const nextFrame = (page) =>
  page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done())));

/**
 * The page in the other scheme for `fn`, then back. The app follows the
 * scheme through a matchMedia listener (src/ui/use-accent.ts) when its
 * appearance follows the Mac; with a fixed appearance nothing changes, as in
 * a pass that booted in that scheme.
 */
async function inScheme(P, page, scheme, fn) {
  const saved = { scheme: P.scheme, names: P.names };
  const settle = async (want) => {
    await page.emulateMedia({ colorScheme: want });
    await page.waitForFunction(
      (w) =>
        document.documentElement.dataset.appearance !== "system" ||
        document.documentElement.dataset.theme === w,
      want,
      // A loaded PC, its page's clock moved, can take a moment to follow.
      { timeout: 10000 },
    );
    // Two frames, so the new colours are drawn before anything reads them.
    // What they set moving is the audit gate's to wait for (settled, below).
    await nextFrame(page);
    await nextFrame(page);
  };
  await settle(scheme);
  Object.assign(P, { scheme, names: P.darkNames });
  try {
    return await fn();
  } finally {
    Object.assign(P, saved);
    await settle(saved.scheme);
  }
}
/** Every snapshot file this run held a surface against (or wrote). */
const heldFiles = new Set();

/**
 * The tree a surface is held to: Playwright's ARIA snapshot of the page. A
 * toast is on screen for as long as its timer says, and its words were already
 * said through the announcer: it is timing, not the surface, and is left out.
 */
async function surfaceTree(page) {
  await page.evaluate(() =>
    document
      .querySelectorAll(".toast")
      .forEach(
        (t) =>
          t.setAttribute("data-smoke-hidden", t.getAttribute("aria-hidden") ?? "") ||
          t.setAttribute("aria-hidden", "true"),
      ),
  );
  try {
    return forSurface(await page.locator("body").ariaSnapshot());
  } finally {
    await page.evaluate(() =>
      document.querySelectorAll("[data-smoke-hidden]").forEach((t) => {
        const was = t.getAttribute("data-smoke-hidden");
        if (was) t.setAttribute("aria-hidden", was);
        else t.removeAttribute("aria-hidden");
        t.removeAttribute("data-smoke-hidden");
      }),
    );
  }
}

/**
 * The audit gate: the page has settled before axe reads it and its tree is
 * held. Its fonts are loaded and no animation that will end is still running
 * (pageSettles, which lets one that never ends, a spinner, run on: runAxe holds
 * it at its end while axe reads), and two readings of its tree, a frame apart,
 * are the same. It waits for exactly that, never for a time, and says what
 * never settled as a finding of the check, rather than audit a page in motion.
 */
async function settled(P, page, label) {
  const timeout = SETTLE_TIMEOUT_MS * TIME_SCALE;
  const deadline = Date.now() + timeout;
  try {
    await page.evaluate(pageSettles, timeout);
    let last = await surfaceTree(page);
    for (;;) {
      await nextFrame(page);
      const now = await surfaceTree(page);
      if (now === last) return;
      if (Date.now() > deadline)
        throw new Error(
          `its tree still changing after ${timeout}ms, ${firstDifference(last, now)}`,
        );
      last = now;
      // What changed the tree may have started an animation: let it land too.
      await page.evaluate(pageSettles, Math.max(1, deadline - Date.now()));
    }
  } catch (e) {
    P.audits.findings.push(`${label} · the page never settled for its audit: ${e.message}`);
  }
}

/**
 * The surface's ARIA snapshot against scripts/aria/<name>.yml, or against
 * <name>.<engine>.yml where one engine honestly reads a surface otherwise.
 * `--update-aria` writes the file from the first pass that meets the surface,
 * and the passes after it are held to it as usual.
 */
async function holdSnapshot(P, page, surface) {
  // Playwright computes the snapshot itself, and it reads the same in both
  // engines; held twice, it only doubles the chances that a tab an earlier
  // check left open, or WebKit's timing, fails the run. Chromium holds each
  // surface; WebKit runs every check, axe and the checks that hold the tree
  // (hold, below), and the native self-test holds WebKit's own tree.
  if (P.engine !== ENGINE_ORDER[0]) return P.names.next(surface);
  await holdText(P, surface, await surfaceTree(page), async () => {
    await nextFrame(page);
    return surfaceTree(page);
  });
}

/**
 * How long a snapshot that differs is read again, a frame at a time, before it
 * fails, as Playwright's toMatchAriaSnapshot reads until it matches: a page
 * settled for its audit can still take a change a moment later (an
 * announcement made on a timer), which the expectation was recorded after.
 */
const MATCH_MS = 3000;

async function holdText(P, surface, actual, retake) {
  const name = P.names.next(surface);
  // The real app's Plays folder is where this act's launch put it; the file
  // holds where it stands, never which act's folder it was.
  if (P.unrun) {
    actual = P.unrun(actual);
    if (retake) {
      const again = retake;
      retake = async () => P.unrun(await again());
    }
  }
  const base = name.replace(/--\d+$/, "");
  if (!surfaceChecks.has(base)) surfaceChecks.set(base, new Set());
  surfaceChecks.get(base).add(P.runningCheck);
  // Most particular first: this engine in this scheme, this engine, this
  // scheme, then the shared file. Chromium in light is the shared file; each
  // other reading has a file of its own only where it reads the surface otherwise.
  const firstEngine = P.engine === ENGINE_ORDER[0];
  const firstScheme = P.scheme === "light";
  const plain = [
    !firstEngine && !firstScheme && `${name}.${P.engine}.${P.scheme}.yml`,
    !firstEngine && `${name}.${P.engine}.yml`,
    !firstScheme && `${name}.${P.scheme}.yml`,
    `${name}.yml`,
  ].filter(Boolean);
  // A variant pass: the variant's own file first, where it reads the surface otherwise.
  const names = P.variant ? variantNames(name, P.variant, P.scheme, plain) : plain;
  const candidates = names.map((f) => join(ARIA, f));
  const read = (f) => (existsSync(f) ? normalize(readFileSync(f, "utf8")) : null);
  const held = (f) => {
    heldFiles.add(f.slice(ARIA.length));
    if (!heldBy.has(P.runningCheck)) heldBy.set(P.runningCheck, new Set());
    heldBy.get(P.runningCheck).add(f.slice(ARIA.length));
  };
  if (UPDATE_ARIA) {
    const [own, ...wider] = candidates;
    const inherited = wider.find(existsSync);
    if (!wider.length || (inherited ? read(inherited) !== actual : true)) {
      if (!writtenNow.has(own)) {
        mkdirSync(ARIA, { recursive: true });
        writeFileSync(own, `${actual}\n`);
        writtenNow.add(own);
        return held(own);
      }
    } else {
      if (existsSync(own) && !writtenNow.has(own)) rmSync(own);
      return held(inherited);
    }
  }
  const file = candidates.find(existsSync) ?? candidates[candidates.length - 1];
  held(file);
  const expected = read(file);
  // Still settling (an announcement, a hover, a pane finishing its render):
  // read again, each frame, until it matches or the time to match is up.
  for (
    const until = Date.now() + MATCH_MS;
    expected !== null && expected !== actual && retake && Date.now() < until;
  ) {
    actual = await retake();
  }
  // What the run read, kept whether it matched or not: a changed surface is
  // accepted from it.
  if (ARIA_OUT) {
    if (P.variant)
      keepVariantTree(P.kept, names, actual, {
        isVariant: (f) => variantOfFile(f) !== null,
        readPlain: (f) => keptTrees.get(f) ?? read(join(ARIA, f)),
      });
    else keepTree(P.kept, names, actual);
  }
  if (expected === actual) return;
  const kept = join(OUT, "aria", `${P.engine}-${P.scheme}`, `${name}.yml`);
  mkdirSync(dirname(kept), { recursive: true });
  writeFileSync(kept, `${actual}\n`);
  P.audits.findings.push(
    expected === null
      ? `ARIA snapshot of ${surface}: no expectation in ${ARIA_SAID}${name}.yml (${ARIA_OUT ? "kept with the run's trees, which `node scripts/aria-accept.mjs --windows <run>` takes" : "`bun run smoke -- --update-aria` writes it"}; this run's is in .smoke/aria/)`
      : `ARIA snapshot of ${surface} (${ARIA_SAID}${file.slice(ARIA.length)}), ${firstDifference(expected, actual)}`,
  );
}
const writtenNow = new Set();
/** The snapshot files each check held, for a proof. */
const heldBy = new Map();
/** `--aria-out`: every tree the run read, by its file's name, and the acts that never ran to their end. */
const keptTrees = new Map();
const unfinishedActs = [];
/** Each variant's acts that ran to their end, as `<variant>\n<act>`. */
const variantActsRan = new Set();

/** The driver a pass hands its checks: `audit` in both schemes, `hold` as the page is. */
function driverFor(P) {
  return {
    async audit(page, surface) {
      // The app's policy refuses a script from anywhere but itself; Playwright's
      // own evaluation is not a script the page loads.
      if (!(await page.evaluate(() => "axe" in window)))
        await (WEBVIEW2 ? page.evaluate(AXE) : page.addScriptTag({ url: AXE_PATH }));
      const look = async (label) => {
        await settled(P, page, label);
        recordAudit(
          await page.evaluate(runAxe, { tags: AUDIT_TAGS, disable: P.axeDisable }),
          label,
          P.audits,
        );
        await holdSnapshot(P, page, surface);
        // Every surface in both schemes with --shots=all, and a variant's
        // under its own name (smoke-variants.mjs).
        if (SHOTS === "all" || (SHOTS && surface.startsWith("Send Feedback"))) {
          await page.screenshot({
            animations: "disabled",
            path: shotPath(`${P.engine}${P.variant ? `-${P.variant}` : ""}-${P.scheme}`, surface),
          });
        }
      };
      await look(surface);
      await inScheme(P, page, "dark", () => look(`${surface} (dark)`));
    },
    /** What a check read off the tree, held the same way. */
    async hold(_page, name, text) {
      await holdText(P, name, normalize(text));
    },
  };
}

/**
 * Every failing check, each engine's, for the pipeline's triage: only a
 * check that failed is named here (scripts/ci-triage.mjs). Screenshots are
 * evidence; some are taken of surfaces that passed. Flakes (a check that
 * failed once, in an act that then passed from its start) and quarantined
 * checks are named apart: neither fails the run.
 */
const failedChecks = [];
const flakes = [];
const quarantinedFailures = [];
/** Which check audited each surface, so a surface two checks audit is caught (below). */
const surfaceChecks = new Map();
const timing = { acts: [] };

/** The checks the quarantine holds, when this run takes it. */
const quarantined = (() => {
  if (!QUARANTINE || !existsSync(QUARANTINE)) return new Set();
  try {
    const now = Date.now();
    return new Set(
      (JSON.parse(readFileSync(QUARANTINE, "utf8")).checks ?? [])
        .filter((q) => Date.parse(q.until) > now)
        .map((q) => q.check),
    );
  } catch (e) {
    console.log(`  smoke: the quarantine could not be read (${e.message}): nothing is quarantined`);
    return new Set();
  }
})();

/** The acts in the order asked for: as named (every act by default), reversed, or shuffled by a seed. */
function ordered(names) {
  const list = names.length ? [...names] : ACTS.map((a) => a.name);
  if (!ORDER) return list;
  if (ORDER === "reverse") return list.reverse();
  const m = /^shuffle:(\d+)$/.exec(ORDER);
  if (!m) {
    console.error(`smoke: --order is reverse or shuffle:<seed>, not ${ORDER}`);
    process.exit(2);
  }
  // A small, seeded generator: the same seed is the same order, on any host.
  let seed = Number(m[1]) || 1;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}
const RUN_ACTS = ordered(ACT_NAMES);
/** A whole run: every act. Only a whole run may say a snapshot no surface uses is stale. */
const WHOLE = RUN_ACTS.length === ACTS.length;

// Where the run is, on disk as it goes (scripts/smoke-journal.mjs): a run
// ended from outside prints nothing more, and its journal still says where it
// was. A run that ends by an error of its own says so as a failure, where it was.
openJournal(JOURNAL, {
  pid: process.pid,
  node: process.version,
  engines: ENGINE_ORDER,
  acts: RUN_ACTS,
  prove: PROVE ? PROVE.length : 0,
});
let actIds = 0;
const stoppedBy = (what) => (e) => {
  const text = String(e?.stack ?? e);
  note({ event: "crashed", what, error: text.slice(0, 4000) });
  console.log(
    `  FAIL  smoke stopped: ${what}\n        ${text.split("\n").slice(0, 12).join("\n        ")}`,
  );
  console.log("\nsmoke: stopped before its summary");
  process.exit(1);
};
process.on("uncaughtException", stoppedBy("an error nothing caught"));
process.on("unhandledRejection", stoppedBy("a promise that failed with nothing waiting on it"));

// Two browsers' worth of pages: never beside a native self-test on the same host.
await holdHostBench("smoke");
const server = await serve();
const port = server.address().port;
let failures = 0;

/**
 * One act, once: a fresh browser context, the act's start (the opening's
 * checks, quietly), then its checks. Returns what each check said.
 */
async function runAct(browser, engine, name, attempt, { clockMs = 0, variant = null } = {}) {
  const id = ++actIds;
  note({ event: "act", id, engine, act: name, attempt, variant: variant?.name ?? null });
  const P = newPass(engine, variant);
  const act = actsOf(smokeChecks(driverFor(P)), [name])[0];
  const start = startOf(act, smokeChecks({ audit: async () => {}, hold: async () => {} }));
  const external = [];
  let context;
  let page;
  if (engine === "webview2") {
    // A first launch of the real app (smoke-webview2.mjs). Its own fence
    // stops what the page asks of any other host; anything asked is said here.
    let plays;
    let cloud;
    let appData;
    let pid;
    let devtools;
    try {
      ({
        context,
        page,
        plays,
        cloud,
        appData,
        pid,
        port: devtools,
      } = await browser.openAct({
        colorScheme: P.scheme,
        launch: { ...actNamed(name).launch, ...variant?.launch },
        emulate: variant?.emulate,
      }));
    } catch (e) {
      // A launch that never came up fails its act, which may be tried again,
      // not the run.
      note({ event: "act-end", id, launch: "failed" });
      return {
        name,
        attempt,
        results: [
          { check: "the app's launch", start: true, ok: false, error: String(e).split("\n")[0] },
        ],
        timing: { engine, act: name, attempt, startMs: 0, ms: 0, checks: [] },
      };
    }
    note({ event: "launched", id, pid, port: devtools });
    // The run's own folders, as the tree writes them and as YAML escapes a
    // backslash: where this act's launch put them, never which act's they were,
    // and never the test machine's home (scripts/public-tree.mjs). The folder
    // the Plays folder sits in reads as the in-memory vault's "/dev".
    const forms = [
      [plays, "<plays>"],
      [dirname(plays), "/dev"],
      ...(appData ? [[appData, "<app data>"]] : []),
    ].flatMap(([path, said]) => [
      [path, said],
      [path.replaceAll("\\", "\\\\"), said],
    ]);
    P.unrun = (text) => forms.reduce((t, [f, said]) => t.split(f).join(said), text);
    // The PC around the app, for the acts that stage what a PC does to a
    // writer's files (scripts/smoke-pc-host.mjs).
    page.host = pcHost({ plays, cloud });
    // A proof's run with the page's clock moved, the date ahead and time still
    // flowing, in a page already up.
    if (clockMs) await page.clock.setSystemTime(Date.now() + clockMs);
    page.on("request", (r) => {
      const url = new URL(r.url());
      if (["data:", "blob:"].includes(url.protocol)) return;
      if (!["tauri.localhost", "ipc.localhost"].includes(url.hostname))
        external.push(`${r.method()} ${r.url()}`);
    });
  } else {
    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      colorScheme: P.scheme,
      deviceScaleFactor: 2,
    });
    // Anything the page asks of any other host is stopped before it leaves this
    // machine, and fails the act (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D2).
    const local = `http://127.0.0.1:${port}`;
    await context.route(
      // data: and blob: URLs are the page's own bytes, and never routed.
      (url) => url.origin !== local && !["data:", "blob:"].includes(url.protocol),
      (route) => {
        external.push(`${route.request().method()} ${route.request().url()}`);
        return route.abort();
      },
    );
    // A proof's run with the page's clock moved: the date ahead, time still flowing.
    if (clockMs) await context.clock.setSystemTime(Date.now() + clockMs);
    page = await context.newPage();
  }
  // A slow host's every wait stretched alike (smoke-checks.mjs's TIME_SCALE).
  page.setDefaultTimeout(30000 * TIME_SCALE);
  // Time spent waiting for selectors, for --timing: Playwright polls at 0, 20,
  // 70, 170 and 270 ms, then every 500 ms, so a wait can outlast what it waits for.
  const waiting = { ms: 0, count: 0 };
  const waitForSelector = page.waitForSelector.bind(page);
  page.waitForSelector = async (selector, options = {}) => {
    const t = Date.now();
    try {
      return await waitForSelector(selector, {
        ...options,
        timeout: (options.timeout ?? 30000) * TIME_SCALE,
      });
    } finally {
      waiting.ms += Date.now() - t;
      waiting.count++;
    }
  };
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("websocket", (socket) => external.push(`WebSocket ${socket.url()}`));

  /* The app's OWN in-memory vault (src/storage/dev-mock.ts), which seeds from
     sample-vault/ — a faithful fixture that 794 unit tests already exercise,
     rather than a second hand-written one to keep in step. A context of its
     own is a first launch: nothing remembered, an untouched vault. */
  if (engine !== "webview2")
    await page.addInitScript(() => {
      window.__PROSCENIUM_FIXTURE__ = true;
      // Fresh once per act, not once per load: "open at launch" reloads the page
      // and has to find the settings and the last folder it left behind.
      try {
        if (!sessionStorage.getItem("smoke:fresh")) {
          localStorage.clear();
          sessionStorage.setItem("smoke:fresh", "1");
        }
      } catch {
        /* a fresh profile has nothing to clear */
      }
    });
  const started = Date.now();
  const actTiming = { engine, act: name, attempt, startMs: 0, ms: 0, checks: [] };
  const results = [];
  try {
    if (engine !== "webview2") await page.goto(`http://127.0.0.1:${port}/`);
    // The act's start: the opening's checks, quietly.
    for (const check of start) {
      note({ event: "check", id, check: check.name, start: true });
      try {
        await check.run(page);
        // Said, and not printed: a check that failed here in a first try and
        // passes in the second is a flake.
        results.push({ check: check.name, start: true, quiet: true, ok: true });
      } catch (e) {
        results.push({
          check: check.name,
          start: true,
          ok: false,
          error: `the act's start failed at "${check.name}": ${String(e).split("\n")[0]}`,
        });
        return { name, attempt, results, timing: actTiming, page, context };
      }
    }
    actTiming.startMs = Date.now() - started;
    for (const check of act.checks) {
      note({ event: "check", id, check: check.name });
      P.runningCheck = check.name;
      P.audits.findings.length = 0;
      Object.assign(waiting, { ms: 0, count: 0 });
      const t = Date.now();
      // A check that failed with a menu or sheet up must not take the next one
      // down with it: close what is open, and only what is open.
      for (let i = 0; i < 4; i++) {
        const open = await page.locator(".menu, .sheet, .alert").count();
        if (!open) break;
        await page.keyboard.press("Escape");
        // One layer fewer, or, where the key closed nothing, on to the next press.
        await page
          .waitForFunction(
            (open) => document.querySelectorAll(".menu, .sheet, .alert").length < open,
            open,
            { timeout: 1000 },
          )
          .catch(() => {});
      }
      let error = null;
      try {
        await check.run(page);
        if (P.audits.findings.length)
          throw new Error(`accessibility:\n        ${P.audits.findings.join("\n        ")}`);
      } catch (e) {
        // An accessibility failure lists its findings on the lines below the
        // first; every other failure is one line.
        const text = String(e);
        error = text.startsWith("Error: accessibility") ? text : text.split("\n")[0];
      }
      results.push({ check: check.name, ok: !error, error, ms: Date.now() - t });
      actTiming.checks.push({
        name: check.name,
        ms: Date.now() - t,
        ok: !error,
        waitMs: waiting.ms,
        waits: waiting.count,
      });
      // A picture, where the page is still there to take one of: a check that
      // failed because the app went must not take the run down with it.
      if (SHOTS === "all" || (SHOTS && error))
        await page
          .screenshot({
            path: shotPath(
              `${engine}${P.variant ? `-${P.variant}` : ""}-${P.scheme}`,
              `${name}-${attempt}-${check.name}`,
            ),
          })
          .catch(() => {});
    }
    // The page's own checks, passed quietly too, so that a second try clean of
    // what the first found makes the first's a flake.
    results.push(
      errors.length
        ? { check: "console", ok: false, error: errors.slice(0, 3).join(" · ") }
        : { check: "console", quiet: true, ok: true },
    );
    results.push(
      external.length
        ? {
            check: "the page reached outside the app",
            ok: false,
            error: [...new Set(external)].slice(0, 5).join(" · "),
          }
        : { check: "the page reached outside the app", quiet: true, ok: true },
    );
  } finally {
    actTiming.ms = Date.now() - started;
    timing.acts.push(actTiming);
    // A file a check still holds is let go before its app is closed.
    note({ event: "closing", id });
    await page.host?.dispose().catch(() => {});
    await context.close().catch(() => {});
    note({ event: "act-end", id });
  }
  // Run to its end: every check had its turn, so its trees are the act's
  // whole set (an attempt that stopped at its launch or its start is not).
  return { name, attempt, results, timing: actTiming, kept: P.kept, complete: true };
}

/** Say what an act's attempt found, one line a check. */
function report(engine, outcome) {
  for (const r of outcome.results) {
    if (r.quiet && r.ok) continue;
    const label = `${engine} · ${outcome.name}${outcome.attempt > 1 ? " (second try)" : ""} · ${r.check}`;
    if (r.ok) console.log(`  ok    ${label} (${r.ms} ms)`);
    else console.log(`  FAIL  ${label}${r.ms != null ? ` (${r.ms} ms)` : ""}\n        ${r.error}`);
  }
}

async function runEngine(engine) {
  const browser = await ENGINES[engine].launch(
    WEBVIEW2 ? { app: argValue("--app"), brk: argValue("--break") } : undefined,
  );
  // The acts, then each variant's (the real Windows app alone), in order.
  const queue = [
    ...RUN_ACTS.map((name) => ({ name, variant: null })),
    ...(engine === "webview2"
      ? VARIANT_LIST.flatMap((v) =>
          v.acts.filter((a) => RUN_ACTS.includes(a)).map((name) => ({ name, variant: v })),
        )
      : []),
  ];
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const { name, variant } = job;
      // An act that cannot run in this engine says why, and runs nothing.
      const act = actNamed(name);
      if (!actRunsIn(act, engine)) {
        console.log(`  skip  ${engine} · ${name} (${act.elsewhere})`);
        continue;
      }
      // What a line, a flake or a failure calls this act: with its variant's name.
      const shown = variant ? `${name} (${variant.name})` : name;
      const said = (outcome) => ({ ...outcome, name: shown });
      let outcome = await runAct(browser, engine, name, 1, { variant });
      report(engine, said(outcome));
      const failedFirst = outcome.results.filter((r) => !r.ok);
      if (failedFirst.length && RETRY) {
        // Once more from its start, and only the second try counts: a check
        // that failed in the first and passed in the second is a flake, named
        // and failing nothing, whatever else the second found (as in the app).
        const second = await runAct(browser, engine, name, 2, { variant });
        report(engine, said(second));
        for (const r of failedFirst)
          if (second.results.some((x) => x.check === r.check && x.ok))
            flakes.push({
              engine,
              act: shown,
              check: r.check,
              first: String(r.error).slice(0, 400),
            });
        outcome = second;
      }
      // The trees of the attempt that counts: a second try's, when there was one.
      if (ARIA_OUT) {
        for (const [file, text] of outcome.kept ?? []) keptTrees.set(file, text);
        if (!outcome.complete) unfinishedActs.push(shown);
      }
      if (variant && outcome.complete) variantActsRan.add(`${variant.name}\n${name}`);
      for (const r of outcome.results.filter((x) => !x.ok)) {
        const entry = {
          engine,
          scheme: "light",
          act: shown,
          check: r.check,
          error: String(r.error).slice(0, 2000),
        };
        if (quarantined.has(r.check)) quarantinedFailures.push(entry);
        else {
          failures++;
          failedChecks.push(entry);
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(WORKERS, queue.length) }, worker));
  await browser.close();
  console.log(
    `  ok    ${engine} · the acts ran: ${RUN_ACTS.length}${VARIANT_LIST.length && engine === "webview2" ? `, and ${VARIANT_LIST.map((v) => `${v.name}'s ${v.acts.filter((a) => RUN_ACTS.includes(a)).length}`).join(", ")}` : ""}`,
  );
}

/**
 * Every core of the host kept busy, for a proof's loaded runs: a child per
 * core spinning. Returns the function that stops them.
 */
function loadHost() {
  const children = Array.from({ length: availableParallelism() }, () =>
    spawn(process.execPath, ["-e", "for (;;) {}"], { stdio: "ignore" }),
  );
  return () => {
    for (const c of children) c.kill("SIGKILL");
  };
}

/** `--prove`: each check's act, PROOF_RUNS times in each engine; what passed every run is written. */
async function prove() {
  const phases = [
    { label: "loaded", runs: PROOF_LOADED, load: true },
    ...PROOF_CLOCKS.map((c) => ({ label: `clock ${c.label}`, runs: c.runs, clockMs: c.ms })),
  ];
  phases.push({
    label: "as a pass runs",
    runs: PROOF_RUNS - phases.reduce((n, p) => n + p.runs, 0),
  });
  const passed = new Map(
    PROVE.map((c) => [c, Object.fromEntries(ENGINE_ORDER.map((e) => [e, 0]))]),
  );
  const failed = [];
  const browsers = Object.fromEntries(
    await Promise.all(
      ENGINE_ORDER.map(async (e) => [
        e,
        await ENGINES[e].launch(WEBVIEW2 ? { app: argValue("--app") } : undefined),
      ]),
    ),
  );
  for (const phase of phases) {
    const stop = phase.load ? loadHost() : () => {};
    try {
      await Promise.all(
        ENGINE_ORDER.map(async (engine) => {
          const queue = RUN_ACTS.flatMap((act) => Array.from({ length: phase.runs }, () => act));
          const worker = async () => {
            for (let act = queue.shift(); act; act = queue.shift()) {
              const outcome = await runAct(browsers[engine], engine, act, 1, phase);
              for (const check of PROVE) {
                const r = outcome.results.find((x) => x.check === check);
                // A check its act never reached, a start that failed, failed.
                const startFailed = outcome.results.find((x) => x.start && !x.ok);
                if (r?.ok && !startFailed) passed.get(check)[engine]++;
                else if (ACTS.find((a) => a.name === act).checks.includes(check))
                  failed.push({
                    engine,
                    phase: phase.label,
                    check,
                    // An accessibility failure's label, its first finding, and
                    // the first element the finding names.
                    error: String(r?.error ?? startFailed?.error ?? "never ran")
                      .split("\n")
                      .slice(0, 3)
                      .map((l) => l.trim())
                      .join(" "),
                  });
              }
            }
          };
          await Promise.all(Array.from({ length: WORKERS }, worker));
        }),
      );
    } finally {
      stop();
    }
    console.log(
      `  proof · ${phase.label}: ${PROVE.map((c) => `${c} ${ENGINE_ORDER.map((e) => `${e} ${passed.get(c)[e]}`).join(", ")}`).join(" · ")}`,
    );
  }
  for (const b of Object.values(browsers)) await b.close();
  server.close();

  const proofs = readProofs(ROOT);
  const checks = smokeChecks({ audit: async () => {}, hold: async () => {} });
  const today = new Date().toISOString().slice(0, 10);
  let unprovenCount = 0;
  for (const name of PROVE) {
    const runs = passed.get(name);
    const mine = failed.filter((f) => f.check === name);
    if (mine.length || ENGINE_ORDER.some((e) => runs[e] < PROOF_RUNS)) {
      unprovenCount++;
      console.log(
        `  FAIL  not proven: ${name}: ${ENGINE_ORDER.map((e) => `${e} ${runs[e]}/${PROOF_RUNS}`).join(", ")}${mine
          .slice(0, 5)
          .map((f) => `\n        ${f.engine} · ${f.phase}: ${f.error}`)
          .join("")}`,
      );
      continue;
    }
    const files = [...(heldBy.get(name) ?? [])].sort();
    proofs.checks[name] = {
      hash: checkHash(checks.find((c) => c.name === name)),
      runs,
      loaded: PROOF_LOADED,
      clocks: Object.fromEntries(PROOF_CLOCKS.map((c) => [c.label, c.runs])),
      // The PC copy's trees are named by their folder, apart from the shared ones.
      snapshots: Object.fromEntries(
        files.map((f) => [
          `${WEBVIEW2 ? "windows/" : ""}${f.replace(/\.yml$/, "")}`,
          textHash(readFileSync(join(ARIA, f), "utf8")),
        ]),
      ),
      provenAt: today,
    };
    console.log(
      `  ok    proven: ${name}: ${ENGINE_ORDER.map((e) => `${e} ${runs[e]}/${PROOF_RUNS}`).join(", ")}${files.length ? `, holding ${files.join(", ")}` : ""}`,
    );
  }
  const file = join(ROOT, PROOFS);
  const sorted = Object.fromEntries(
    Object.entries(proofs.checks).sort(([a], [b]) => a.localeCompare(b)),
  );
  writeFileSync(file, `${JSON.stringify({ v: 1, checks: sorted }, null, 2)}\n`);
  console.log(`\n  time: ${Math.round((Date.now() - STARTED) / 1000)} s`);
  note({ event: "finished", unproven: unprovenCount });
  if (unprovenCount) {
    console.log(`\nsmoke: ${unprovenCount} check${unprovenCount === 1 ? "" : "s"} not proven`);
    process.exit(1);
  }
  console.log(`\nsmoke: proven, written to ${PROOFS}`);
  process.exit(0);
}

if (PROVE) await prove();
if (ACT_NAMES.length || ORDER) console.log(`  acts: ${RUN_ACTS.join(" · ")}`);
// Side by side, unless the snapshots are being written: WebKit's own files are
// the ones that differ from what Chromium just wrote.
if (UPDATE_ARIA || process.argv.includes("--serial")) {
  for (const engine of ENGINE_ORDER) await runEngine(engine);
} else {
  await Promise.all(ENGINE_ORDER.map(runEngine));
}

server.close();

// A surface audited by two checks is numbered by the order they ran in, so a
// pass that leaves one out (--acts, a narrowed pipeline run) would hold the
// other against the wrong file. One check per surface keeps every pass's
// numbering the same.
if (WHOLE) {
  const shared = [...surfaceChecks].filter(([, checks]) => checks.size > 1);
  if (shared.length) {
    failures++;
    failedChecks.push({
      engine: "both",
      scheme: "light",
      check: "a surface audited by more than one check",
      error: shared
        .map(([b]) => b)
        .join(", ")
        .slice(0, 2000),
    });
    console.log(
      `  FAIL  a surface is audited by more than one check; give each its own name\n        ${shared
        .map(([base, checks]) => `${base}: ${[...checks].join(" · ")}`)
        .join("\n        ")}`,
    );
  }
}

// A file no surface was held against is a surface that is gone: it goes, or
// it fails the run, so the folder never describes screens that no longer exist.
// Only a run of every engine and every check can say so, and of a variant's
// own files, a run of every act that variant names.
const variantsWhole = new Set(
  VARIANT_LIST.filter((v) => v.acts.every((a) => variantActsRan.has(`${v.name}\n${a}`))).map(
    (v) => v.name,
  ),
);
const judged = (f) => {
  const v = variantOfFile(f);
  return v ? variantsWhole.has(v) : WHOLE;
};
if ((!ONE_ENGINE || WEBVIEW2) && existsSync(ARIA)) {
  const stale = readdirSync(ARIA).filter(
    (f) => f.endsWith(".yml") && !heldFiles.has(f) && judged(f),
  );
  if (stale.length && UPDATE_ARIA) {
    for (const f of stale) rmSync(join(ARIA, f));
    console.log(
      `  removed ${stale.length} snapshot${stale.length === 1 ? "" : "s"} no surface uses: ${stale.join(", ")}`,
    );
  } else if (stale.length) {
    failures++;
    failedChecks.push({
      engine: "both",
      scheme: "light",
      check: "snapshots no surface uses",
      error: stale.join(", ").slice(0, 2000),
    });
    console.log(
      `  FAIL  ${ARIA_SAID} holds snapshots no surface uses (--update-aria removes them)\n        ${stale.join("\n        ")}`,
    );
  }
}
if (UPDATE_ARIA)
  console.log(
    `  wrote ${writtenNow.size} ARIA snapshot${writtenNow.size === 1 ? "" : "s"} to ${ARIA_SAID}`,
  );
if (ARIA_OUT) {
  // Every act, run to its end: then a file of the folder this run read
  // nothing for is one no surface uses, as --update-aria would remove it.
  const whole = WHOLE && unfinishedActs.length === 0;
  rmSync(ARIA_OUT, { recursive: true, force: true });
  mkdirSync(ARIA_OUT, { recursive: true });
  for (const [file, text] of keptTrees) writeFileSync(join(ARIA_OUT, file), `${text}\n`);
  writeFileSync(
    join(ARIA_OUT, "kept.json"),
    `${JSON.stringify({ v: 1, engine: ONE_ENGINE, whole, acts: RUN_ACTS, variants: [...variantsWhole], unfinished: unfinishedActs, trees: keptTrees.size }, null, 2)}\n`,
  );
  console.log(
    `  kept ${keptTrees.size} tree${keptTrees.size === 1 ? "" : "s"} in ${ARIA_OUT}${whole ? ", every surface's" : `, not every surface's (${unfinishedActs.length ? `unfinished: ${unfinishedActs.join(", ")}` : "some acts only"})`}`,
  );
}

if (advisories.size) {
  console.log("\n  advice (best practice, not failing):");
  for (const [id, a] of advisories) {
    console.log(`    ${id}: ${a.help} — ${[...a.surfaces].join(", ")}`);
  }
}

// Written on every run, so an old list never outlives the run that made it.
mkdirSync(OUT, { recursive: true });
writeFileSync(
  join(OUT, "failed.json"),
  `${JSON.stringify({ v: 2, acts: RUN_ACTS, failed: failedChecks, flakes, quarantined: quarantinedFailures }, null, 2)}\n`,
);

if (TIMING) {
  mkdirSync(dirname(TIMING), { recursive: true });
  writeFileSync(TIMING, `${JSON.stringify({ acts: RUN_ACTS, ...timing }, null, 2)}\n`);
}
const waited = (list) =>
  Math.round(list.reduce((n, a) => n + a.checks.reduce((m, c) => m + c.waitMs, 0), 0) / 1000);
timing.wallMs = Date.now() - STARTED;
console.log(
  `\n  time: ${Math.round(timing.wallMs / 1000)} s — ${ENGINE_ORDER.map((e) => {
    const mine = timing.acts.filter((a) => a.engine === e);
    return `${e} ${mine.length} acts, ${Math.round(mine.reduce((n, a) => n + a.ms, 0) / 1000)} s of act time (${waited(mine)} s of it waiting for selectors)`;
  }).join(" · ")}`,
);
if (flakes.length)
  console.log(
    `\n  flakes (failed once, then green from the act's start):\n${flakes.map((f) => `    ${f.engine} · ${f.act} · ${f.check}: ${f.first.split("\n")[0]}`).join("\n")}`,
  );
if (quarantinedFailures.length)
  console.log(
    `\n  quarantined, and failing (reported, not counted):\n${quarantinedFailures.map((f) => `    ${f.engine} · ${f.act} · ${f.check}`).join("\n")}`,
  );

// The verdict is reached: whatever happens after this line, the summary says it.
note({ event: "finished", failures });
if (failures) {
  console.log(`\nsmoke: ${failures} failure${failures === 1 ? "" : "s"}`);
  process.exit(1);
}
console.log("\nsmoke: clean");
