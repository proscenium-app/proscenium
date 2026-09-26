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
 *   bun run smoke -- --only import,spell  # a narrowed pass: leaves out the detachable
 *                                   # features' checks not named (smoke-checks.mjs)
 *   bun run smoke -- --update-aria  # rewrite scripts/aria/*.yml from this run
 *   bun run smoke -- --timing <file>  # each check's time, per pass, as JSON
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
 */
import { chromium, webkit } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, normalize as normalizePath } from "node:path";
import {
  AUDIT_TAGS,
  TIME_SCALE,
  recordAudit,
  runAxe,
  selected,
  smokeChecks,
} from "./smoke-checks.mjs";
import { SurfaceNames, firstDifference, forSurface, normalize } from "./aria-snapshots.mjs";
import { holdHostBench } from "./host-bench.mjs";

const STARTED = Date.now();
const DIST = new URL("../dist/", import.meta.url).pathname;
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
/** The features a narrowed pass keeps (smoke-checks.mjs `selected`); none, every check. */
const ONLY = (argValue("--only") ?? "").split(/[,\s]+/).filter(Boolean);
const TIMING = argValue("--timing");
if (ONLY.length && UPDATE_ARIA) {
  console.error(
    "smoke: --update-aria writes every surface's snapshot, so it runs every check; drop --only",
  );
  process.exit(2);
}
const ENGINES = { chromium, webkit };
if (ONE_ENGINE && !ENGINES[ONE_ENGINE]) {
  console.error(`smoke: --engine is chromium or webkit, not ${ONE_ENGINE}`);
  process.exit(2);
}
if (ONE_ENGINE && process.argv.includes("--update-aria")) {
  console.error(
    "smoke: --update-aria writes the shared snapshots from Chromium and WebKit's own where it differs, so it runs both engines",
  );
  process.exit(2);
}
/** Chromium first: its reading is the shared file, WebKit's the exception. */
const ENGINE_ORDER = ONE_ENGINE ? [ONE_ENGINE] : Object.keys(ENGINES);
const OUT = new URL("../.smoke/", import.meta.url).pathname;
const ARIA = new URL("./aria/", import.meta.url).pathname;
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
function newPass(engine) {
  return {
    engine,
    scheme: "light",
    names: new SurfaceNames(),
    darkNames: new SurfaceNames(),
    audits: { findings: [], advisories },
    runningCheck: "",
  };
}

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
      { timeout: 5000 },
    );
    // Two frames, so the new colours are drawn before anything reads them;
    // never longer than a quarter second, should a frame not come.
    await page.evaluate(
      () =>
        new Promise((r) => {
          requestAnimationFrame(() => requestAnimationFrame(r));
          setTimeout(r, 250);
        }),
    );
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
  // A toast is on screen for as long as its timer says, and its words were
  // already said through the announcer: it is timing, not the surface.
  const take = async () => {
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
  };
  await holdText(P, surface, await take(), take);
}

/** How long a snapshot that differs is read again before it fails, as Playwright's toMatchAriaSnapshot waits. */
const SETTLE_MS = 3000;

async function holdText(P, surface, actual, retake) {
  const name = P.names.next(surface);
  const base = name.replace(/--\d+$/, "");
  if (!surfaceChecks.has(base)) surfaceChecks.set(base, new Set());
  surfaceChecks.get(base).add(P.runningCheck);
  // Most particular first: this engine in this scheme, this engine, this
  // scheme, then the shared file. Chromium in light is the shared file; each
  // other reading has a file of its own only where it reads the surface otherwise.
  const firstEngine = P.engine === ENGINE_ORDER[0];
  const firstScheme = P.scheme === "light";
  const candidates = [
    !firstEngine && !firstScheme && `${name}.${P.engine}.${P.scheme}.yml`,
    !firstEngine && `${name}.${P.engine}.yml`,
    !firstScheme && `${name}.${P.scheme}.yml`,
    `${name}.yml`,
  ]
    .filter(Boolean)
    .map((f) => join(ARIA, f));
  const read = (f) => (existsSync(f) ? normalize(readFileSync(f, "utf8")) : null);
  const held = (f) => heldFiles.add(f.slice(ARIA.length));
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
  // read again until it matches or the settle time is up.
  for (
    const until = Date.now() + SETTLE_MS;
    expected !== null && expected !== actual && retake && Date.now() < until;
  ) {
    await new Promise((r) => setTimeout(r, 250));
    actual = await retake();
  }
  if (expected === actual) return;
  const kept = join(OUT, "aria", `${P.engine}-${P.scheme}`, `${name}.yml`);
  mkdirSync(dirname(kept), { recursive: true });
  writeFileSync(kept, `${actual}\n`);
  P.audits.findings.push(
    expected === null
      ? `ARIA snapshot of ${surface}: no expectation in scripts/aria/${name}.yml (\`bun run smoke -- --update-aria\` writes it; this run's is in .smoke/aria/)`
      : `ARIA snapshot of ${surface} (scripts/aria/${file.slice(ARIA.length)}), ${firstDifference(expected, actual)}`,
  );
}
const writtenNow = new Set();

/** The driver a pass hands its checks: `audit` in both schemes, `hold` as the page is. */
function driverFor(P) {
  return {
    async audit(page, surface) {
      if (!(await page.evaluate(() => "axe" in window))) await page.addScriptTag({ url: AXE_PATH });
      const look = async (label) => {
        recordAudit(await page.evaluate(runAxe, AUDIT_TAGS), label, P.audits);
        await holdSnapshot(P, page, surface);
        if (SHOTS && surface.startsWith("Send Feedback")) {
          await page.screenshot({
            animations: "disabled",
            path: shotPath(`${P.engine}-${P.scheme}`, surface),
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

const ALL_CHECKS = smokeChecks(driverFor(newPass(""))).length;
/** Which check audited each surface, so a surface two checks audit is caught (below). */
const surfaceChecks = new Map();
const timing = { passes: [] };

// Two browsers' worth of pages: never beside a native self-test on the same host.
await holdHostBench("smoke");
const server = await serve();
const port = server.address().port;
let failures = 0;

async function runEngine(engine) {
  const P = newPass(engine);
  const CHECKS = smokeChecks(driverFor(P)).filter((c) => selected(c, ONLY));
  if (ONLY.length && engine === ENGINE_ORDER[0]) {
    console.log(
      `  --only ${ONLY.join(", ")}: ${CHECKS.length} of ${ALL_CHECKS} checks${CHECKS.length === ALL_CHECKS ? " (no other feature's checks are detachable yet)" : ""}`,
    );
  }
  const findings = P.audits.findings;
  const scheme = P.scheme;
  const browser = await ENGINES[engine].launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    colorScheme: scheme,
    deviceScaleFactor: 2,
  });
  // Anything the page asks of any other host is stopped before it leaves this
  // machine, and fails the run (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D2).
  const external = [];
  const local = `http://127.0.0.1:${port}`;
  await context.route(
    // data: and blob: URLs are the page's own bytes, and never routed.
    (url) => url.origin !== local && !["data:", "blob:"].includes(url.protocol),
    (route) => {
      external.push(`${route.request().method()} ${route.request().url()}`);
      return route.abort();
    },
  );
  const page = await context.newPage();
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
     rather than a second hand-written one to keep in step. */
  await page.addInitScript(() => {
    window.__PROSCENIUM_FIXTURE__ = true;
    // Fresh once per run, not once per load: "open at launch" reloads the page
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
  await page.goto(`http://127.0.0.1:${port}/`);

  const passTiming = { engine, scheme: "light+dark", startedAt: Date.now(), ms: 0, checks: [] };
  timing.passes.push(passTiming);
  for (const check of CHECKS) {
    P.runningCheck = check.name;
    findings.length = 0;
    Object.assign(waiting, { ms: 0, count: 0 });
    const started = Date.now();
    // A check that failed with a menu or sheet up must not take the next one
    // down with it: close what is open, and only what is open.
    for (let i = 0; i < 4 && (await page.locator(".menu, .sheet, .alert").count()); i++) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(120);
    }
    let failed = false;
    try {
      await check.run(page);
      if (findings.length)
        throw new Error(`accessibility:\n        ${findings.join("\n        ")}`);
      console.log(`  ok    ${engine} · ${check.name} (${Date.now() - started} ms)`);
    } catch (e) {
      failures++;
      failed = true;
      // An accessibility failure lists its findings on the lines below the
      // first; every other failure is one line.
      const text = String(e);
      const shown = text.startsWith("Error: accessibility") ? text : text.split("\n")[0];
      console.log(
        `  FAIL  ${engine} · ${check.name} (${Date.now() - started} ms)\n        ${shown}`,
      );
    }
    passTiming.checks.push({
      name: check.name,
      ms: Date.now() - started,
      ok: !failed,
      waitMs: waiting.ms,
      waits: waiting.count,
    });
    if (SHOTS === "all" || (SHOTS && failed))
      await page.screenshot({ path: shotPath(`${engine}-${P.scheme}`, check.name) });
  }
  passTiming.ms = Date.now() - passTiming.startedAt;

  if (errors.length) {
    failures++;
    console.log(`  FAIL  ${engine} · console\n        ${errors.slice(0, 3).join("\n        ")}`);
  }
  if (external.length) {
    failures++;
    console.log(
      `  FAIL  ${engine} · the page reached outside the app\n        ${[...new Set(external)].slice(0, 5).join("\n        ")}`,
    );
  } else {
    console.log(`  ok    ${engine} · no request left the app`);
  }
  await context.close();
  await browser.close();
}

// Side by side, unless the snapshots are being written: WebKit's own files are
// the ones that differ from what Chromium just wrote.
if (UPDATE_ARIA || process.argv.includes("--serial")) {
  for (const engine of ENGINE_ORDER) await runEngine(engine);
} else {
  await Promise.all(ENGINE_ORDER.map(runEngine));
}

server.close();

// A surface audited by two checks is numbered by the order they ran in, so a
// pass that leaves one out (--only, a narrowed pipeline run) would hold the
// other against the wrong file. One check per surface keeps every pass's
// numbering the same.
if (!ONLY.length) {
  const shared = [...surfaceChecks].filter(([, checks]) => checks.size > 1);
  if (shared.length) {
    failures++;
    console.log(
      `  FAIL  a surface is audited by more than one check; give each its own name\n        ${shared
        .map(([base, checks]) => `${base}: ${[...checks].join(" · ")}`)
        .join("\n        ")}`,
    );
  }
}

// A file no surface was held against is a surface that is gone: it goes, or
// it fails the run, so the folder never describes screens that no longer exist.
// Only a run of every engine and every check can say so.
if (!ONE_ENGINE && !ONLY.length && existsSync(ARIA)) {
  const stale = readdirSync(ARIA).filter((f) => f.endsWith(".yml") && !heldFiles.has(f));
  if (stale.length && UPDATE_ARIA) {
    for (const f of stale) rmSync(join(ARIA, f));
    console.log(
      `  removed ${stale.length} snapshot${stale.length === 1 ? "" : "s"} no surface uses: ${stale.join(", ")}`,
    );
  } else if (stale.length) {
    failures++;
    console.log(
      `  FAIL  scripts/aria/ holds snapshots no surface uses (--update-aria removes them)\n        ${stale.join("\n        ")}`,
    );
  }
}
if (UPDATE_ARIA)
  console.log(
    `  wrote ${writtenNow.size} ARIA snapshot${writtenNow.size === 1 ? "" : "s"} to scripts/aria/`,
  );

if (advisories.size) {
  console.log("\n  advice (best practice, not failing):");
  for (const [id, a] of advisories) {
    console.log(`    ${id}: ${a.help} — ${[...a.surfaces].join(", ")}`);
  }
}

if (TIMING) {
  mkdirSync(dirname(TIMING), { recursive: true });
  writeFileSync(TIMING, `${JSON.stringify({ only: ONLY, ...timing }, null, 2)}\n`);
}
const waited = (p) => Math.round(p.checks.reduce((n, c) => n + c.waitMs, 0) / 1000);
timing.wallMs = Date.now() - STARTED;
console.log(
  `\n  time: ${Math.round(timing.wallMs / 1000)} s — ${timing.passes.map((p) => `${p.engine} ${Math.round(p.ms / 1000)} s (${waited(p)} s of it waiting for selectors)`).join(" · ")}`,
);

if (failures) {
  console.log(`\nsmoke: ${failures} failure${failures === 1 ? "" : "s"}`);
  process.exit(1);
}
console.log("\nsmoke: clean");
