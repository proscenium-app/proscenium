// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Smoke's third engine: the real Windows app (docs/engineering/cross-platform.md#PLAT-62).
 *
 *   bun scripts/smoke.mjs --engine webview2 --app <proscenium.exe>
 *
 * On a Mac nothing can drive WebKit inside an app, which is why its native
 * pass is a harness inside the page. WebView2 can be driven from outside, as
 * Microsoft and Playwright document: the test build (`build-app.mjs
 * --selftest` on Windows) opens WebView2's DevTools port on the loopback
 * address when `PROSCENIUM_SELFTEST_DEVTOOLS` names one, and this attaches
 * Playwright to the page, which then runs smoke's own checks, acts and
 * snapshots against the real app and the real Rust vault.
 *
 * Each act is a first launch, as a new browser context is in the other
 * engines: the app is started with a scratch home (its settings and
 * WebView2's profile wiped, under the test build's own identifier), a fresh
 * copy of sample-vault/ as the folder "A folder I choose…" picks, and a
 * folder for what its save panel would have written. It is closed by its
 * process when the act ends.
 *
 * Keys. The checks press a Mac's keys; this presses the PC's: a chord through
 * the app's own table (src/ui/keys.ts PC_CHORDS), and a Mac's text keys as
 * Windows has them (⌘↓ is Ctrl+End, ⌘→ is End, ⌥← is Ctrl+←).
 *
 * Run it in the signed-in session, not over SSH: WebView2 draws nothing in a
 * service's session.
 */
import { chromium } from "playwright";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
/** When the copied sample plays were last changed, for every act on every machine. */
const FIXTURE_DATE = new Date("2026-01-05T15:00:00Z");
/** The test build's identifier (scripts/build-app.mjs --selftest): never a writer's. */
const IDENTIFIER = "org.habiby.proscenium.selftest";
/**
 * The first act's DevTools port; each act after it takes the next, since the
 * last act's WebView2 can hold its port a moment after the app has gone.
 */
const FIRST_PORT = Number(process.env.PROSCENIUM_WEBVIEW2_PORT ?? 9333);

const { PC_CHORDS } = await import("../src/ui/keys.ts");

/** A Mac's text keys as Windows has them, by the key and whether ⌘ or ⌥ held it. */
const TEXT_KEYS = {
  "Meta+ArrowUp": "Control+Home",
  "Meta+ArrowDown": "Control+End",
  "Meta+ArrowLeft": "Home",
  "Meta+ArrowRight": "End",
  "Meta+Home": "Control+Home",
  "Meta+End": "Control+End",
  "Alt+ArrowLeft": "Control+ArrowLeft",
  "Alt+ArrowRight": "Control+ArrowRight",
  "Alt+ArrowUp": "Control+ArrowUp",
  "Alt+ArrowDown": "Control+ArrowDown",
  "Alt+Backspace": "Control+Backspace",
  "Alt+Delete": "Control+Delete",
  "Meta+Backspace": "Shift+Home Backspace",
};

const GLYPH = { Meta: "⌘", Alt: "⌥", Shift: "⇧", Control: "⌃" };
const KEY_GLYPH = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Enter: "⏎",
  Backspace: "⌫",
  Comma: ",",
  Slash: "/",
  Semicolon: ";",
  Period: ".",
};
const PRESS_KEY = {
  "↑": "ArrowUp",
  "↓": "ArrowDown",
  "←": "ArrowLeft",
  "→": "ArrowRight",
  "⏎": "Enter",
  "⌦": "Delete",
  "⌫": "Backspace",
};

/**
 * A Mac's key press, as Playwright writes it (`Meta+Alt+KeyM`), as a PC's
 * (`Control+KeyM`): Windows' text keys first, then the app's chord table,
 * and otherwise ⌘ as Ctrl. A press of several keys is space-separated.
 */
export function pcPress(combo) {
  const parts = combo.split("+");
  const key = parts.pop();
  const mods = new Set(parts);
  const shift = mods.has("Shift");
  const plain = [...mods].filter((m) => m !== "Shift");
  const text = TEXT_KEYS[[...plain, key].join("+")];
  if (text)
    return shift ? text.replace(/(^| )(Control\+)?/, (m, s, c) => `${s}${c ?? ""}Shift+`) : text;
  if (!mods.has("Meta")) return combo;
  const name = /^Key[A-Z]$/.test(key)
    ? key.slice(3)
    : /^Digit\d$/.test(key)
      ? key.slice(5)
      : (KEY_GLYPH[key] ?? (key.length === 1 ? key.toUpperCase() : key));
  const glyphs = ["Control", "Alt", "Shift", "Meta"]
    .filter((m) => mods.has(m))
    .map((m) => GLYPH[m]);
  const spellings = [
    glyphs.join(""),
    [...glyphs].reverse().join(""),
    glyphs
      .filter((g) => g !== "⌘")
      .concat("⌘")
      .join(""),
    ["⌘", ...glyphs.filter((g) => g !== "⌘")].join(""),
  ];
  const mapped = spellings.map((s) => PC_CHORDS[s + name]).find((c) => c !== undefined);
  if (mapped === undefined) {
    // Not in the table: ⌘ is Ctrl, the rest as pressed.
    return [
      ...(mods.has("Control") || mods.has("Meta") ? ["Control"] : []),
      ...["Alt", "Shift"].filter((m) => mods.has(m)),
      key,
    ].join("+");
  }
  // The table's chord, back into Playwright's words; the key as pressed where it is the same.
  const mappedMods = [...mapped].filter((c) => "⌃⌥⇧⌘".includes(c));
  const mappedKey = [...mapped].filter((c) => !"⌃⌥⇧⌘".includes(c)).join("");
  const outKey =
    mappedKey === name
      ? key
      : (PRESS_KEY[mappedKey] ?? (/^[A-Z]$/.test(mappedKey) ? `Key${mappedKey}` : mappedKey));
  const out = [
    mappedMods.includes("⌘") || mappedMods.includes("⌃") ? "Control" : null,
    mappedMods.includes("⌥") ? "Alt" : null,
    mappedMods.includes("⇧") ? "Shift" : null,
    outKey,
  ].filter(Boolean);
  return out.join("+");
}

/**
 * Wait for the app's page to be listed on the DevTools port, or throw after
 * `ms`. The port answers before the page exists, and a page that appears
 * after Playwright attaches, in WebView2's own profile, is never announced to
 * it: so it attaches once the page is there.
 */
async function pageUp(port, ms) {
  const until = Date.now() + ms;
  for (;;) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (r.ok && (await r.json()).some((t) => t.type === "page" && /tauri\.localhost/.test(t.url)))
        return;
    } catch {
      /* not yet */
    }
    if (Date.now() > until) throw new Error(`WebView2's port ${port} never listed the app's page`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

function kill(pid) {
  if (pid) spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
}

/** WebView2's processes for one act's profile, which can outlive its app: stopped. */
function stopWebView(run) {
  const folder = run.replaceAll("'", "''");
  spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -like '*${folder}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
    ],
    { stdio: "ignore" },
  );
}

/** Every copy of the test build, whatever started it. */
function killAll() {
  spawnSync("taskkill", ["/IM", "proscenium.exe", "/T", "/F"], { stdio: "ignore" });
}

export const webview2 = {
  /** The engine: one app at a time, each act its own launch. */
  async launch({ app, brk } = {}) {
    const exe = app ?? join(ROOT, "src-tauri", "target", "release", "proscenium.exe");
    if (!existsSync(exe))
      throw new Error(
        `no test build at ${exe}: build one with \`node scripts/build-app.mjs --selftest\``,
      );
    const runs = join(ROOT, ".smoke", "webview2");
    let launches = 0;
    killAll();
    return {
      /**
       * One act's app: a first launch on scratch folders, Playwright attached
       * to its page. `close()` ends the process.
       */
      async openAct({ colorScheme }) {
        const run = join(runs, String(++launches));
        const port = FIRST_PORT + (launches % 200);
        // Windows can take a moment to let go of a file the last act's app
        // held: asked again.
        const wipe = (path) =>
          rmSync(path, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 });
        wipe(run);
        for (const base of [process.env.APPDATA, process.env.LOCALAPPDATA])
          if (base) wipe(join(base, IDENTIFIER));
        const plays = join(run, "plays");
        mkdirSync(join(run, "exports"), { recursive: true });
        cpSync(join(ROOT, "sample-vault"), plays, { recursive: true });
        // One date for every file, whatever the checkout's: a fresh clone's
        // files are today's, and the Plays screen says "Today" of them.
        for (const file of readdirSync(plays, { recursive: true }))
          utimesSync(join(plays, String(file)), FIXTURE_DATE, FIXTURE_DATE);
        const child = spawn(exe, [], {
          // The test build opens the port, and keeps WebView2's profile in the
          // act's own folder, itself: an elevated process, as a hosted
          // runner's is, ignores WebView2's own variables.
          env: {
            ...process.env,
            PROSCENIUM_SELFTEST_DEVTOOLS: String(port),
            PROSCENIUM_SELFTEST_WEBVIEW: join(run, "webview"),
            PROSCENIUM_SELFTEST_FOLDER: plays,
            PROSCENIUM_SELFTEST_EXPORTS: join(run, "exports"),
          },
          stdio: "ignore",
          windowsHide: false,
        });
        const exited = new Promise((r) => child.once("exit", r));
        try {
          await Promise.race([
            pageUp(port, 30000),
            exited.then((code) => {
              throw new Error(`the app exited (${code}) before WebView2 opened its port`);
            }),
          ]);
          // Playwright can attach a moment before it holds the page: it is
          // asked again, and attached again, before the act gives up.
          let browser = null;
          let page = null;
          for (let attempt = 0; attempt < 5 && !page; attempt++) {
            browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
            for (const until = Date.now() + 5000; !page && Date.now() < until; ) {
              page =
                browser
                  .contexts()
                  .flatMap((c) => c.pages())
                  .find((p) => /tauri\.localhost/.test(p.url())) ?? null;
              if (!page) await new Promise((r) => setTimeout(r, 200));
            }
            if (!page) await browser.close().catch(() => {});
          }
          if (!page)
            throw new Error("Playwright attached five times, and never held the app's page");
          await page.setViewportSize({ width: 1280, height: 800 });
          // The page behaves as the focused one, as in smoke's own browsers:
          // the test machine's screen may be locked, and then no window is
          // ever in front, so a blur would come of every focus moved.
          const cdp = await page.context().newCDPSession(page);
          await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
          // A freshly launched WebView2 can drop the first mouse press it is
          // sent: the pointer is moved once, and the page draws, before any
          // check presses anything.
          await page.mouse.move(1, 1);
          await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done())));
          if (brk === "flex") {
            // The negative control: the blank window that once shipped,
            // `.editor-frame { flex: 1 }` swallowed by a stylesheet edit. A
            // run that passes with it is not looking at the screen. A sheet
            // made in script, which the app's policy does not stop, on this
            // page and every page after it.
            const breakFlex = () => {
              const apply = () => {
                const sheet = new CSSStyleSheet();
                sheet.replaceSync(".editor-frame { flex: initial !important; }");
                document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
              };
              if (document.readyState === "loading")
                document.addEventListener("DOMContentLoaded", apply);
              else apply();
            };
            await page.addInitScript(breakFlex);
            await page.evaluate(breakFlex);
          }
          await page.emulateMedia({ colorScheme });
          const keyboard = page.keyboard;
          const press = keyboard.press.bind(keyboard);
          keyboard.press = async (combo, options) => {
            for (const k of pcPress(combo).split(" ")) await press(k, options);
          };
          return {
            page,
            plays,
            // The test build's own app data, where a practice play lives.
            appData: process.env.APPDATA ? join(process.env.APPDATA, IDENTIFIER) : null,
            pid: child.pid,
            context: {
              close: async () => {
                await browser.close().catch(() => {});
                kill(child.pid);
                await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
                stopWebView(run);
              },
            },
          };
        } catch (e) {
          kill(child.pid);
          stopWebView(run);
          throw e;
        }
      },
      async close() {
        killAll();
      },
    };
  },
};
