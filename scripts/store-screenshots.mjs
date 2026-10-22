// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Mac App Store's screenshots, made by machine from the shipped bundle,
 * and the Microsoft Store's with --pc.
 *
 *   bun run store:screenshots              # builds dist/, writes .store/screenshots/
 *   bun run store:screenshots -- --no-build  # dist/ as it is
 *   bun run store:screenshots -- --only board,export
 *   bun run store:screenshots -- --pc      # the PC's copy, into .store/screenshots-pc/
 *
 * --pc draws the Windows app: the page is given the record the Windows build
 * answers (`__PROSCENIUM_FIXTURE_PC__`, src/storage/ipc.ts), so shortcuts are
 * written Ctrl+…, and File Explorer, the Recycle Bin and this PC are named.
 * It is 1536 × 864 points at 125 percent, a common Windows scale: 1920 × 1080,
 * a size Partner Center takes for the desktop. Chromium on the build host draws
 * the interface in the Mac's system typeface, where Windows draws Segoe UI;
 * the script's own pages, in Courier Prime, are the same on both.
 *
 * It drives dist/ in headless Chromium on the app's own in-memory vault
 * (`__PROSCENIUM_FIXTURE__`), as smoke does, at 1440 × 900 points and twice
 * the pixels: 2880 × 1800, a 16:10 size App Store Connect accepts for the Mac.
 * Every word on a page is synthetic: the sample vault's play, given a fuller
 * draft from scripts/store/ before it is opened. Nothing reads a real play.
 *
 * Each shot is a few steps through the app as a writer takes them, and fails
 * loudly when a step's control is not there, so a release whose screens moved
 * says which shot to mend instead of writing a picture of the wrong screen.
 */
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, normalize } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const args0 = process.argv.slice(2);
const PC = args0.includes("--pc");
const OUT = join(ROOT, ".store", PC ? "screenshots-pc" : "screenshots");
const PLAY = "The Weight of Water";
const DRAFT = readFileSync(join(ROOT, "scripts", "store", `${PLAY}.fountain`), "utf8");

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
const explore = args.includes("--explore");

if (!args.includes("--no-build")) {
  const built = spawnSync("bun", ["run", "build"], { cwd: ROOT, stdio: "inherit" });
  if (built.status !== 0) throw new Error("store-screenshots: the build failed");
}

const CSP = Object.entries(
  JSON.parse(readFileSync(join(ROOT, "src-tauri", "tauri.conf.json"), "utf8")).app.security.csp,
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
  ".dic": "text/plain",
  ".aff": "text/plain",
};

/** dist/ as the webview sees it, under the app's own content security policy. */
function serve() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
      const file = join(DIST, normalize(path === "/" ? "/index.html" : path));
      if (!file.startsWith(DIST)) return res.writeHead(403).end();
      try {
        const body = await readFile(file);
        res.writeHead(200, {
          "content-type": MIME[extname(file)] ?? "application/octet-stream",
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

/** Welcome, the sample Plays folder, the tutorial invitation set aside, the fuller draft. */
async function toPlays(page) {
  await page.waitForSelector(".welcome", { timeout: 15000 });
  await page.getByRole("button", { name: /A folder I choose/ }).click();
  await page.waitForSelector(".vault-list", { timeout: 15000 });
  await page.waitForSelector(".tutorial-invitation");
  await page.getByRole("button", { name: "Skip for Now", exact: true }).click();
  await page.evaluate(
    ([rel, text]) => window.__prosceniumExternalChange(rel, text),
    [`${PLAY}/${PLAY}.fountain`, DRAFT],
  );
}

async function openPlay(page) {
  await toPlays(page);
  await page.locator(".playrow__title", { hasText: new RegExp(`^${PLAY}$`) }).click();
  await page.waitForSelector(".play-page", { timeout: 20000 });
}

/**
 * The page at rest: fonts in, layout settled. The status bar's folder path is
 * hidden, not rewritten: here it is the in-memory fixture's own path
 * ("/dev/sample-vault/…"), which no writer's Mac shows.
 */
async function settle(page) {
  await page.addStyleTag({ content: ".statusbar__path { visibility: hidden; }" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
}

/** A tab in the toolbar's surface switcher. */
async function surface(page, name) {
  await page.getByRole("tab", { name, exact: true }).click();
}

/** The script scrolled to a scene, by its row in the binder. */
async function toScene(page, nth) {
  await page
    .getByRole("treeitem", { name: /^SCENE / })
    .nth(nth)
    .click();
}

/**
 * A line of the script brought near the top of the window, `above` points
 * below the bar, with the caret in the line `caret`. The page view lays out in frames, and
 * a format just chosen moves every line, so it scrolls until the line stays put.
 */
async function scrollTo(page, text, caret, above = 190) {
  const place = () =>
    page.evaluate(
      ([text, above]) => {
        const line = [...document.querySelectorAll(".ProseMirror > *")].find(
          (el) => el.textContent.trim() === text,
        );
        if (!line) return null;
        let box = line.parentElement;
        while (box && box.scrollHeight <= box.clientHeight) box = box.parentElement;
        if (!box) return null;
        const off = line.getBoundingClientRect().top - box.getBoundingClientRect().top - above;
        box.scrollTop += off;
        return Math.abs(off);
      },
      [text, above],
    );
  const line = page.locator(".ProseMirror > *", { hasText: caret }).first();
  for (let i = 0; i < 20; i++) {
    const off = await place();
    if (off === null) throw new Error(`no line of the script reads "${text}"`);
    if (i === 0) await line.click();
    await page.waitForTimeout(250);
    if (off < 2 && i > 0) return;
  }
  throw new Error(`the line "${text}" would not hold still`);
}

/** A command in the play's title menu. */
async function titleMenu(page, item) {
  await page.getByRole("button", { name: PLAY, exact: true }).first().click();
  await page.locator('.menu [role^="menuitem"]', { hasText: item }).first().click();
}

const SHOTS = [
  {
    name: "script",
    async run(page) {
      await openPlay(page);
      await titleMenu(page, "Dramatists Guild — Modern");
      await scrollTo(page, "ACT ONE", "The pipe's been crying all night.");
    },
  },
  {
    name: "board",
    async run(page) {
      await openPlay(page);
      await surface(page, "Board");
    },
  },
  {
    name: "export",
    async run(page) {
      await openPlay(page);
      await titleMenu(page, /^Export PDF/);
      await page.waitForSelector(".sheet");
    },
  },
  {
    name: "formats",
    async run(page) {
      await openPlay(page);
      await titleMenu(page, /^Edit Current Format/);
      await page.waitForSelector(".sheet");
    },
  },
  {
    name: "cast",
    async run(page) {
      await openPlay(page);
      await surface(page, "Cast");
    },
  },
  {
    name: "tutorial",
    async run(page) {
      await openPlay(page);
      await page.getByRole("button", { name: "Help & Tutorials" }).click();
      await page.getByRole("button", { name: /^Start: / }).click();
      await page.getByRole("button", { name: "Show Me", exact: true }).waitFor();
    },
  },
  {
    name: "script-dark",
    scheme: "dark",
    async run(page) {
      await openPlay(page);
      await titleMenu(page, "Dramatists Guild — Modern");
      await scrollTo(page, "ACT TWO", "It's quiet now. I keep listening for it.");
    },
  },
];

const server = await serve();
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
if (!only) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
let failed = 0;
try {
  for (const [i, shot] of SHOTS.entries()) {
    if (only && !only.includes(shot.name)) continue;
    const context = await browser.newContext({
      viewport: PC ? { width: 1536, height: 864 } : { width: 1440, height: 900 },
      deviceScaleFactor: PC ? 1.25 : 2,
      colorScheme: shot.scheme ?? "light",
    });
    // The page reaches nothing but dist/, as in the app.
    await context.route(
      (u) => u.origin !== new URL(url).origin && !["data:", "blob:"].includes(u.protocol),
      (route) => route.abort(),
    );
    const page = await context.newPage();
    await page.addInitScript((pc) => {
      window.__PROSCENIUM_FIXTURE__ = true;
      if (pc) window.__PROSCENIUM_FIXTURE_PC__ = true;
    }, PC);
    const file = join(OUT, `${String(i + 1).padStart(2, "0")}-${shot.name}.png`);
    try {
      await page.goto(url);
      await shot.run(page);
      await settle(page);
      if (explore)
        console.log(
          shot.name,
          "\n",
          await page.locator(".menu, .sheet, main").first().ariaSnapshot(),
        );
      await page.screenshot({ path: file });
      console.log(`store-screenshots: ${file.slice(ROOT.length + 1)}`);
    } catch (e) {
      failed++;
      console.error(`store-screenshots: "${shot.name}" failed: ${String(e).split("\n")[0]}`);
      await page.screenshot({ path: file.replace(/\.png$/, ".failed.png") }).catch(() => {});
    }
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
if (failed) process.exit(1);
