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
 *   bun run smoke -- --shots        # also writes PNGs to .smoke/
 *   bun run smoke -- --engine webkit  # one engine only (chromium or webkit)
 *   bun run smoke -- --update-aria  # rewrite scripts/aria/*.yml from this run
 *
 * **It also asserts that things can be REACHED** (docs/app/preferences-and-help/accessibility.md#A11Y-15). Every surface
 * it opens is scanned with axe-core against WCAG 2.2 A and AA, and a critical
 * or serious finding fails the run. A scanner cannot press keys, though, and
 * the worst accessibility bugs this app had were key bugs no scanner sees —
 * ⏎ on Cancel saving the sheet, Escape in a popup closing the sheet under it,
 * a Go to Scene field that never had focus. Those are asserted by pressing
 * the keys, in the checks named "keyboard".
 *
 * **In two engines** (docs/app/preferences-and-help/accessibility.md#A11Y-15). Every check
 * runs in Chromium and again in Playwright's WebKit, in both schemes. Playwright's
 * WebKit is a WebKit, built from WebKit's own source, but it is not Apple's
 * WKWebView and it is not the macOS floor's Safari: it catches a page that
 * works in one engine and not the other, not an old engine's gaps
 * (check:webkit-floor does that) and not the app's webview (the native
 * self-test does that).
 *
 * **And the tree a screen reader is given** (docs/app/preferences-and-help/accessibility.md#A11Y-15).
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
import { AUDIT_TAGS, recordAudit, runAxe, smokeChecks } from "./smoke-checks.mjs";
import { SurfaceNames, firstDifference, forSurface, normalize } from "./aria-snapshots.mjs";

const DIST = new URL("../dist/", import.meta.url).pathname;
const SHOTS = process.argv.includes("--shots");
const UPDATE_ARIA = process.argv.includes("--update-aria");
const ONE_ENGINE = process.argv.includes("--engine") ? process.argv[process.argv.indexOf("--engine") + 1] : null;
const ENGINES = { chromium, webkit };
if (ONE_ENGINE && !ENGINES[ONE_ENGINE]) {
  console.error(`smoke: --engine is chromium or webkit, not ${ONE_ENGINE}`);
  process.exit(2);
}
if (ONE_ENGINE && process.argv.includes("--update-aria")) {
  console.error("smoke: --update-aria writes the shared snapshots from Chromium and WebKit's own where it differs, so it runs both engines");
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
  JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8")).app.security.csp,
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
 * This file is the Chromium driver: it serves dist/, loads axe into the page,
 * and runs every check in both colour schemes.
 */
const audits = { findings: [], advisories: new Map() };
const findings = audits.findings;
const advisories = audits.advisories;

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

/** Which pass is running, for the snapshot files and the report lines. */
const pass = { engine: "", scheme: "", names: new SurfaceNames() };
/** Every snapshot file this run held a surface against (or wrote). */
const heldFiles = new Set();

/**
 * The surface's ARIA snapshot against scripts/aria/<name>.yml, or against
 * <name>.<engine>.yml where one engine honestly reads a surface otherwise.
 * `--update-aria` writes the file from the first pass that meets the surface,
 * and the passes after it are held to it as usual.
 */
async function holdSnapshot(page, surface) {
  // Playwright computes the snapshot itself, and it reads the same in both
  // engines; held twice, it only doubles the chances that a tab an earlier
  // check left open, or WebKit's timing, fails the run. Chromium holds each
  // surface; WebKit runs every check, axe and the checks that hold the tree
  // (hold, below), and the native self-test holds WebKit's own tree.
  if (pass.engine !== ENGINE_ORDER[0]) return pass.names.next(surface);
  // A toast is on screen for as long as its timer says, and its words were
  // already said through the announcer: it is timing, not the surface.
  const take = async () => {
    await page.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.setAttribute("data-smoke-hidden", t.getAttribute("aria-hidden") ?? "") || t.setAttribute("aria-hidden", "true")));
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
  await holdText(surface, await take(), take);
}

/** What a check read off the tree (the driver's `hold`), held the same way. */
async function hold(_page, name, text) {
  await holdText(name, normalize(text));
}

/** How long a snapshot that differs is read again before it fails, as Playwright's toMatchAriaSnapshot waits. */
const SETTLE_MS = 3000;

async function holdText(surface, actual, retake) {
  const name = pass.names.next(surface);
  // Most particular first: this engine in this scheme, this engine, this
  // scheme, then the shared file. Chromium in light is the shared file; each
  // other pass has a file of its own only where it reads the surface otherwise.
  const firstEngine = pass.engine === ENGINE_ORDER[0];
  const firstScheme = pass.scheme === "light";
  const candidates = [
    !firstEngine && !firstScheme && `${name}.${pass.engine}.${pass.scheme}.yml`,
    !firstEngine && `${name}.${pass.engine}.yml`,
    !firstScheme && `${name}.${pass.scheme}.yml`,
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
  for (const until = Date.now() + SETTLE_MS; expected !== null && expected !== actual && retake && Date.now() < until; ) {
    await new Promise((r) => setTimeout(r, 250));
    actual = await retake();
  }
  if (expected === actual) return;
  const kept = join(OUT, "aria", `${pass.engine}-${pass.scheme}`, `${name}.yml`);
  mkdirSync(dirname(kept), { recursive: true });
  writeFileSync(kept, `${actual}\n`);
  findings.push(
    expected === null
      ? `ARIA snapshot of ${surface}: no expectation in scripts/aria/${name}.yml (\`bun run smoke -- --update-aria\` writes it; this run's is in .smoke/aria/)`
      : `ARIA snapshot of ${surface} (scripts/aria/${file.slice(ARIA.length)}), ${firstDifference(expected, actual)}`,
  );
}
const writtenNow = new Set();

async function audit(page, surface) {
  if (!(await page.evaluate(() => "axe" in window))) await page.addScriptTag({ url: AXE_PATH });
  recordAudit(await page.evaluate(runAxe, AUDIT_TAGS), surface, audits);
  await holdSnapshot(page, surface);
  if (SHOTS && surface.startsWith("Send Feedback")) {
    const dark = await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches);
    await page.screenshot({ animations: "disabled", path: shotPath(`${pass.engine}-${dark ? "dark" : "light"}`, surface) });
  }
}

const CHECKS = smokeChecks({ audit, hold });

const server = await serve();
const port = server.address().port;
let failures = 0;

for (const engine of ENGINE_ORDER) {
const browser = await ENGINES[engine].launch();
for (const scheme of ["light", "dark"]) {
  Object.assign(pass, { engine, scheme });
  pass.names.reset();
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

  for (const check of CHECKS) {
    findings.length = 0;
    // A check that failed with a menu or sheet up must not take the next one
    // down with it: close what is open, and only what is open.
    for (let i = 0; i < 4 && (await page.locator(".menu, .sheet, .alert").count()); i++) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(120);
    }
    try {
      await check.run(page);
      if (findings.length) throw new Error(`accessibility:\n        ${findings.join("\n        ")}`);
      console.log(`  ok    ${engine} · ${scheme} · ${check.name}`);
    } catch (e) {
      failures++;
      // An accessibility failure lists its findings on the lines below the
      // first; every other failure is one line.
      const text = String(e);
      const shown = text.startsWith("Error: accessibility") ? text : text.split("\n")[0];
      console.log(`  FAIL  ${engine} · ${scheme} · ${check.name}\n        ${shown}`);
    }
    if (SHOTS) await page.screenshot({ path: shotPath(`${engine}-${scheme}`, check.name) });
  }

  if (errors.length) {
    failures++;
    console.log(`  FAIL  ${engine} · ${scheme} · console\n        ${errors.slice(0, 3).join("\n        ")}`);
  }
  if (external.length) {
    failures++;
    console.log(`  FAIL  ${engine} · ${scheme} · the page reached outside the app\n        ${[...new Set(external)].slice(0, 5).join("\n        ")}`);
  } else {
    console.log(`  ok    ${engine} · ${scheme} · no request left the app`);
  }
  await context.close();
}
await browser.close();
}

server.close();

// A file no surface was held against is a surface that is gone: it goes, or
// it fails the run, so the folder never describes screens that no longer exist.
// Only a run of every engine can say so.
if (!ONE_ENGINE && existsSync(ARIA)) {
  const stale = readdirSync(ARIA).filter((f) => f.endsWith(".yml") && !heldFiles.has(f));
  if (stale.length && UPDATE_ARIA) {
    for (const f of stale) rmSync(join(ARIA, f));
    console.log(`  removed ${stale.length} snapshot${stale.length === 1 ? "" : "s"} no surface uses: ${stale.join(", ")}`);
  } else if (stale.length) {
    failures++;
    console.log(`  FAIL  scripts/aria/ holds snapshots no surface uses (--update-aria removes them)\n        ${stale.join("\n        ")}`);
  }
}
if (UPDATE_ARIA) console.log(`  wrote ${writtenNow.size} ARIA snapshot${writtenNow.size === 1 ? "" : "s"} to scripts/aria/`);

if (advisories.size) {
  console.log("\n  advice (best practice, not failing):");
  for (const [id, a] of advisories) {
    console.log(`    ${id}: ${a.help} — ${[...a.surfaces].join(", ")}`);
  }
}

if (failures) {
  console.log(`\nsmoke: ${failures} failure${failures === 1 ? "" : "s"}`);
  process.exit(1);
}
console.log("\nsmoke: clean");
