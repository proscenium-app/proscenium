// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What `bun run smoke` checks, written once and run by two drivers.
 *
 *   scripts/smoke.mjs            Playwright, headless Chromium, the dev-mock vault
 *   scripts/selftest/harness.mjs the real app: WKWebView, the Rust vault, native
 *                                key and mouse events (docs/engineering/release-engineering.md#REL-D4)
 *
 * The two used to be one file, and the app's own engine had never run a line of
 * it: nothing had launched below macOS 26.6, and nothing had rendered the
 * bundle in WebKit at all. A second copy of the checks for the native run would
 * have drifted from the first inside a month, and the point of running them in
 * WebKit is that they are the SAME checks. So every check takes a `page` and
 * uses only this much of Playwright's Page API, which the harness implements
 * against the real DOM:
 *
 *   page.waitForSelector(sel, { timeout, state: "detached" })
 *   page.locator(sel, { hasText }) · .first() · .click() · .count() · .focus()
 *        .fill(v) · .innerText() · .inputValue() · .boundingBox()
 *        .allInnerTexts() · .getAttribute(name)
 *   page.getByRole(role, { name }) · .click()
 *   page.keyboard.press("Meta+Shift+KeyJ") · page.keyboard.type(text)
 *   page.evaluate(fn, arg) · page.waitForTimeout(ms)
 *   page.reload() — only as a check's LAST statement: in the real app it
 *                   replaces the page the harness runs in, which resumes at
 *                   the next check
 *
 * Plain CSS selectors only: Playwright's own selector engines (`>> text=`) have
 * no WebKit counterpart. A check that needs more than this list extends the
 * harness in the same commit.
 *
 * A check marked `devMock: true` drives the in-memory vault's own test hooks —
 * an outside write to the script, Finder's open event, a crash that keeps a
 * recovery snapshot in sessionStorage — which the real app does not have. The
 * harness reports it as skipped, never as a pass.
 */

import { harborPackage, harborPackageZip, harborPages, toBase64 } from "./pages-sample.mjs";

export const AUDIT_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * How much longer every wait may take on a slow host: `SMOKE_TIME_SCALE`, 1 by
 * default. GitHub's hosted macOS runner sets it (public-repo/github/workflows/ci.yml):
 * its WebKit takes several times the build host's for the same check. It
 * stretches the deadlines only; a check never waits longer than what it waits for.
 */
export const TIME_SCALE = Math.max(1, Number(globalThis.process?.env?.SMOKE_TIME_SCALE) || 1);

/**
 * A check's feature tags: the part of the app it is about, named as
 * ci/features.json names the folders of src/. A pipeline run whose changes
 * all sit in leaf features leaves out the DETACHABLE blocks it did not touch;
 * `smoke.mjs --only` and `selftest.mjs --features` take the same names.
 * A check with no tag runs in every pass, however narrowed: those set the
 * stage the others stand on (the Welcome screen, the Plays screen, a play
 * open, the writer's play back after the tutorials).
 */
export function checkFeatures(check) {
  return check.feature == null ? [] : [].concat(check.feature);
}

/**
 * The features whose checks a narrowed pass may leave out: none yet.
 *
 * Checks run in one page, in order, and most stand on what the ones before
 * them left: which play is open, which panes show, what a sheet remembers. A
 * surface's accessibility tree is the whole page, so leaving out a check that
 * changes any of that changes what every later check holds, and a pass that
 * left it out would fail, or pass, against a page no full pass ever sees. A
 * feature joins this list only when a full pass with its checks left out is
 * green in both engines and both schemes: its block then leaves the app as it
 * found it. A Chromium pass with the tutorial, feedback, wordproc, spell and
 * import checks left out had 63 failures after them in its two schemes, the
 * first because the tutorials leave a pane empty that is otherwise showing a
 * document.
 */
export const DETACHABLE = [];

/**
 * Whether a check runs in a pass narrowed to `features`; no list is every
 * check. A check runs when it is untagged, when one of its features is asked
 * for, or when one of them is not DETACHABLE.
 */
export function selected(check, features, detachable = DETACHABLE) {
  if (!features?.length) return true;
  const tags = checkFeatures(check);
  return tags.length === 0 || tags.some((t) => features.includes(t) || !detachable.includes(t));
}

/**
 * @param {{
 *   audit: (page: any, surface: string) => Promise<void>,
 *   hold: (page: any, name: string, text: string) => Promise<void>,
 * }} driver `audit` scans the surface (axe) and holds its accessibility tree
 *   against its checked-in expectation; `hold` holds any other text a check
 *   reads off the tree against one (scripts/aria-snapshots.mjs)
 */
export function smokeChecks({ audit, hold }) {
  /** Every check is about what a person would SEE, not what the DOM contains. */
  return [
    {
      // First run, nothing remembered — the one question a new download asks
      // (docs/app/keeping-work/storage-and-file-format.md#STOR-D12).
      name: "welcome",
      async run(page) {
        await page.waitForSelector(".welcome", { timeout: 15000 });
        await visible(page, ".editor-frame", { minWidth: 400, minHeight: 300 });
        await visible(page, ".welcome", { minWidth: 200, minHeight: 150 });
        await visible(page, ".empty-card__icon", { minWidth: 40, minHeight: 40 });
        await visible(page, ".welcome__choice", { minWidth: 200, minHeight: 40 });
        await visible(page, ".toolbar", { minHeight: 40 });
        await visible(page, ".statusbar", { minHeight: 20 });

        // The question has to READ as a question, and each answer has to say what
        // it means — a bare pair of buttons was the thing this replaced.
        const heading = await page.locator(".empty-card__title").innerText();
        if (!/where should your plays live/i.test(heading)) {
          throw new Error(`welcome heading reads "${heading}"`);
        }
        const notes = await page.locator(".welcome__choiceNote").count();
        const choices = await page.locator(".welcome__choice").count();
        if (notes !== choices) throw new Error(`${choices} choices but ${notes} explanations`);
        // The window moves by its top bar, on every screen.
        if ((await dragsWindow(page, ".toolbar")) !== true) {
          throw new Error("pressing the empty toolbar does not drag the window");
        }
        // Once, one sentence: reports are sent, never the writing, and where
        // to switch them off (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D3). It waits for the
        // launch to finish looking for a last Plays folder.
        await page.waitForSelector(".welcome__privacy", { timeout: 5000 });
        await visible(page, ".welcome__privacy", { minWidth: 200, minHeight: 12 });
        const notice = await page.locator(".welcome__privacy").innerText();
        if (!/anonymous usage and crash reports, never your writing/.test(notice)) {
          throw new Error(`the Welcome screen's notice reads "${notice}"`);
        }
        await audit(page, "welcome");
        // Its link is Settings › Privacy, and closing Settings leaves the notice
        // where it was: remembered as seen, not taken away mid-sentence.
        await page.getByRole("link", { name: "Privacy settings" }).click();
        await page.waitForSelector(".prefs", { timeout: 5000 });
        const chosen = await page.locator('.prefs__nav [aria-selected="true"]').innerText();
        if (chosen !== "Privacy")
          throw new Error(`the notice opened Settings on ${chosen}, not Privacy`);
        await page.keyboard.press("Escape");
        await page.waitForSelector(".sheet", { state: "detached", timeout: 5000 });
        await visible(page, ".welcome__privacy", { minWidth: 200, minHeight: 12 });
      },
    },
    {
      name: "plays screen",
      async run(page) {
        await page.getByRole("button", { name: /A folder I choose/ }).click();
        await page.waitForSelector(".vault-list", { timeout: 15000 });
        // Two plays, each a directory holding a `.proscenium` file (docs/app/keeping-work/storage-and-file-format.md#STOR-D3).
        // The rows can come after the list: the native vault is still reading
        // the folder when the screen is first drawn.
        await until(
          page,
          "the fixture's two plays",
          () => document.querySelectorAll(".playrow--play").length === 2,
        ).catch(async () => {
          throw new Error(
            `expected 2 plays in the fixture, saw ${await page.locator(".playrow--play").count()}`,
          );
        });
        await visible(page, ".vault-screen", { minWidth: 400, minHeight: 300 });
        await visible(page, ".vault-list", { minHeight: 40 });
        await page.waitForSelector(".tutorial-invitation");
        await visible(page, ".tutorial-invitation", { minWidth: 250, minHeight: 80 });
        await audit(page, "optional tutorial invitation");
        await page.getByRole("button", { name: "Skip for Now", exact: true }).click();
        await until(page, "invitation dismissal saved without practice", async () => {
          const raw = window.__TAURI_INTERNALS__
            ? (await window.__TAURI_INTERNALS__.invoke("tutorials_read")).content
            : localStorage.getItem("proscenium:dev:tutorial-progress");
          const state = raw && JSON.parse(raw);
          return state?.invitation === "dismissed" && state.attempts.length === 0;
        });
        await visible(page, ".playrow--play", { minWidth: 300, minHeight: 20 });
        await visible(page, ".vault-screen__bar", { minHeight: 40 });
        // Where the plays live, in one sentence (docs/app/keeping-work/storage-and-file-format.md#STOR-D11).
        await visible(page, ".vault-screen__where", { minWidth: 200 });
        const where = await page.locator(".vault-screen__where").innerText();
        if (!/^Your plays live /.test(where)) throw new Error(`the Plays screen says "${where}"`);
        // The picker's own controls, which the toolbar variant carries.
        await visible(page, ".vault-screen__search", { minWidth: 100 });
        await visible(page, ".btn--primary", { minWidth: 60 });
        // Both bars move the window from their empty space, and New Play is
        // still a button rather than a handle.
        if ((await dragsWindow(page, ".toolbar")) !== true) {
          throw new Error("pressing the empty toolbar does not drag the window");
        }
        if ((await dragsWindow(page, ".vault-screen__spacer")) !== true) {
          throw new Error("pressing the Plays bar's empty middle does not drag the window");
        }
        if ((await dragsWindow(page, ".vault-screen__bar .btn--primary")) !== false) {
          throw new Error("pressing New Play would drag the window instead of pressing it");
        }
        // Progress is pages, counted behind the rows (docs/app/keeping-work/storage-and-file-format.md#STOR-121): a dash, then
        // the count. It was scenes and "3 locked", read off the card records.
        const headers = await page.locator('.vault-list [role="columnheader"]').allInnerTexts();
        if (headers.join("|") !== "Play|Progress|Status|Modified")
          throw new Error(`the Plays table's headers read ${headers.join(" · ")}`);
        const counts = await until(page, "every play's pages to be counted", () => {
          const cells = [...document.querySelectorAll(".playrow--play .playrow__progress")].map(
            (c) => c.textContent.trim(),
          );
          return cells.length === 2 && cells.every((c) => /^\d+ pages?$/.test(c)) ? cells : null;
        });
        if (counts.some((c) => /scene|locked/.test(c)))
          throw new Error(`Progress still counts scenes: ${counts.join(", ")}`);
        await audit(page, "plays screen");
      },
    },
    {
      // File › New Play… is ⌘N, which the New Play button's own menu shows
      // beside Blank Play. In the app the chord goes to the menu bar first and
      // its item reaches the page; in a browser the window answers the chord
      // itself. Either way the Plays screen names a blank play, as the button
      // does, with the keyboard in the title field. It used to stop at the
      // Plays screen it was already on, so ⌘N made nothing.
      name: "plays screen · ⌘N names a new play",
      feature: "app",
      async run(page) {
        await page.locator(".vault-screen__search input").focus();
        await page.keyboard.press("Meta+KeyN");
        await page.waitForSelector(".playrow--naming input", { timeout: 5000 });
        await visible(page, ".playrow--naming", { minWidth: 200, minHeight: 20 });
        const held = await page.evaluate(
          () => document.activeElement?.getAttribute("aria-label") ?? null,
        );
        if (held !== "Title of the new play")
          throw new Error(`⌘N named a play, but the keyboard is on ${held ?? "nothing"}`);
        // Escape gives the play up and puts the keyboard back where it was.
        await page.keyboard.press("Escape");
        await page.waitForSelector(".playrow--naming", { state: "detached", timeout: 5000 });
        const back = await page.evaluate(
          () => document.activeElement?.getAttribute("aria-label") ?? null,
        );
        if (back !== "Search plays")
          throw new Error(
            `after Escape the keyboard is on ${back ?? "nothing"}, not the search field it came from`,
          );
      },
    },
    {
      // A Plays folder chosen one level too high (docs/app/keeping-work/storage-and-file-format.md#STOR-D12). "/dev" holds the
      // sample Plays folder and no plays of its own; two of its folders hold
      // plays. The screen says where they look to be and offers those folders.
      // It offers the sample play only once that is answered: the sample play
      // once went into such a folder from this screen.
      name: "plays screen · a Plays folder one level too high",
      feature: "storage",
      devMock: true,
      async run(page) {
        const choose = async (path) => {
          await page.evaluate((p) => window.__prosceniumNextPick(p), path);
          await page.keyboard.press("Meta+Comma");
          await page.waitForSelector(".prefs", { timeout: 5000 });
          await page.locator('.prefs__nav [role="tab"]', { hasText: "General" }).click();
          await page.getByRole("button", { name: /^Change…$/ }).click();
        };
        const rows = () => page.evaluate(() => document.querySelectorAll(".playrow--play").length);
        const showing = (name) =>
          until(
            page,
            `the Plays screen for “${name}”`,
            (n) => document.querySelector(".vault-screen__vault")?.textContent === n,
            name,
          );
        /** Whether New Play's menu offers the sample play right now (↓ opens it). */
        const sampleOffered = async () => {
          await page.locator(".vault-screen__bar .btn--pulldown").focus();
          await page.keyboard.press("ArrowDown");
          await page.waitForSelector(".menu", { timeout: 5000 });
          const enabled = await page.evaluate(
            () =>
              [...document.querySelectorAll(".menu .menu__item")].find((b) =>
                b.textContent?.includes("Open the Sample Play"),
              )?.disabled === false,
          );
          await page.keyboard.press("Escape");
          await page.waitForSelector(".menu", { state: "detached", timeout: 5000 });
          return enabled;
        };

        // A folder iCloud has not brought down yet: the look inside "/dev" is
        // held on one listing. The screen settles anyway and offers no sample
        // play while it looks, and the next choice does not wait for it either.
        await page.evaluate(() => window.__prosceniumGate("list", "The Lighthouse"));
        try {
          await choose("/dev");
          await showing("dev");
          await until(
            page,
            "the look inside held on a listing",
            () => window.__prosceniumHeld("list") > 0,
          );
          await absent(
            page,
            ".vault-screen__firstrun",
            "the sample play was offered while the folders inside were being looked into",
          );
          if (await sampleOffered())
            throw new Error(
              "New Play offered the sample play while the folders inside were being looked into",
            );
          await choose("/dev/outside");
          await showing("outside");
          await page.waitForSelector(".vault-screen__firstrun", { timeout: 5000 });
        } finally {
          await page.evaluate(() => window.__prosceniumOpenGates("list"));
        }
        // The held answer was about "/dev", and never shows up under another folder.
        await page.waitForTimeout(500);
        await absent(
          page,
          ".vault-screen__ask",
          "a question about the folder left behind showed under the next one",
        );

        await choose("/dev");
        await page.waitForSelector(".vault-screen__ask", { timeout: 10000 });
        await visible(page, ".vault-screen__ask", { minWidth: 200, minHeight: 40 });
        await visible(page, ".vault-screen__askactions .btn--primary", {
          minWidth: 60,
          minHeight: 20,
        });
        const said = await page.locator(".vault-screen__asktext").innerText();
        if (
          said !==
          "Your plays look like they are in “sample-vault” and “elsewhere” inside this folder."
        ) {
          throw new Error(`the Plays screen says "${said}"`);
        }
        await absent(
          page,
          ".vault-screen__firstrun",
          "the sample play was offered before the question was answered",
        );
        if (await sampleOffered())
          throw new Error("New Play offered the sample play before the question was answered");
        if ((await rows()) !== 0)
          throw new Error("the folder above the Plays folder listed plays of its own");
        await audit(page, "plays screen · one level too high");

        // The folder with the most plays is the primary answer; one click uses it.
        await page.getByRole("button", { name: /^Use “sample-vault”$/ }).click();
        await until(
          page,
          "the sample Plays folder's two plays",
          () => document.querySelectorAll(".playrow--play").length === 2,
        );
        await absent(page, ".vault-screen__ask", "the question stayed after it was answered");
        await until(page, "focus on the Plays heading, not <body>", () =>
          document.activeElement?.classList.contains("vault-screen__title"),
        );

        // Keeping the folder is an answer too, given by keyboard: the question
        // goes, and only then is the sample play offered.
        await choose("/dev");
        await page.waitForSelector(".vault-screen__ask", { timeout: 10000 });
        await page
          .locator(".vault-screen__askactions .btn", { hasText: "Keep This Folder" })
          .focus();
        await page.keyboard.press("Enter");
        await page.waitForSelector(".vault-screen__firstrun", { timeout: 5000 });
        await absent(page, ".vault-screen__ask", "the question stayed after Keep This Folder");
        await until(page, "focus on the Plays heading after Keep This Folder", () =>
          document.activeElement?.classList.contains("vault-screen__title"),
        );
        if (!(await sampleOffered()))
          throw new Error("New Play still held the sample play back after Keep This Folder");

        // A Plays folder with no plays has nothing to nest under: the panel takes
        // a folder inside it instead of refusing it as nested.
        await choose("/dev/sample-vault");
        await until(
          page,
          "the sample Plays folder again",
          () => document.querySelectorAll(".playrow--play").length === 2,
        );
        await absent(
          page,
          ".toast--error",
          "choosing the folder inside an empty Plays folder was refused",
        );
      },
    },
    {
      name: "a damaged play opens its protected original file",
      feature: "storage",
      devMock: true,
      async run(page) {
        const key = "The Lighthouse/The Lighthouse.proscenium";
        const original = await page.evaluate((key) => window.__prosceniumPeekKey(key), key);
        const raw = '{"kind":"proscenium/play","logline":"UNIQUE RECOVERABLE WORDS';
        await page.evaluate(({ key, raw }) => window.__prosceniumQuietWrite(key, raw), {
          key,
          raw,
        });
        await page.locator(".playrow__title", { hasText: "The Lighthouse" }).click();
        await page.waitForSelector('textarea[aria-label="Original play file"]', { timeout: 10000 });
        await visible(page, ".sheet", { minWidth: 400, minHeight: 250 });
        await visible(page, 'textarea[aria-label="Original play file"]', {
          minWidth: 300,
          minHeight: 150,
        });
        const field = await page.evaluate(() => {
          const el = document.querySelector('textarea[aria-label="Original play file"]');
          return { value: el.value, readOnly: el.readOnly, focused: document.activeElement === el };
        });
        if (field.value !== raw || !field.readOnly || !field.focused)
          throw new Error("the original file was not protected and focusable");
        await audit(page, "damaged play original");
        await page.getByRole("button", { name: "Close", exact: true }).click();
        await page.waitForSelector(".sheet", { state: "detached", timeout: 5000 });
        if ((await page.locator(".playrow__title", { hasText: "The Lighthouse" }).count()) !== 1)
          throw new Error("the damaged play disappeared");
        if ((await page.evaluate((key) => window.__prosceniumPeekKey(key), key)) !== raw)
          throw new Error("opening the damaged play changed its bytes");
        await page.locator(".playrow__title", { hasText: "The Lighthouse" }).click();
        await page.waitForSelector('textarea[aria-label="Original play file"]', { timeout: 10000 });
        await page.getByRole("button", { name: "Show in Folder", exact: true }).click();
        await page.getByRole("button", { name: "Try Again", exact: true }).click();
        await until(
          page,
          "damaged play remains protected on retry",
          () => !!document.querySelector('textarea[aria-label="Original play file"]'),
        );
        await page.getByRole("button", { name: "Close", exact: true }).click();
        await page.waitForSelector(".sheet", { state: "detached", timeout: 5000 });
        await page.evaluate(({ key, original }) => window.__prosceniumQuietWrite(key, original), {
          key,
          original,
        });
      },
    },
    {
      name: "Plays search announces empty and restored results",
      feature: "app",
      async run(page) {
        if (!(await page.locator('[data-announcer="polite"]').count()))
          throw new Error("search has no premounted announcer");
        await page.getByRole("textbox", { name: "Search plays" }).fill("A619 no such play");
        await until(
          page,
          "no matching plays to be spoken",
          () =>
            document.querySelector('[data-announcer="polite"]')?.textContent ===
            "No plays match your search.",
        );
        await page.getByRole("textbox", { name: "Search plays" }).fill("");
        await until(
          page,
          "the restored play count to be spoken",
          () =>
            document.querySelector('[data-announcer="polite"]')?.textContent ===
            "2 plays in this folder.",
        );
        await audit(page, "Plays search results");
      },
    },
    {
      name: "document import · window chrome, source guides and enlarged text",
      feature: "import",
      async run(page) {
        await page.getByRole("button", { name: "Import a Draft…", exact: true }).click();
        await page.waitForSelector(".import-desk__choose");
        // Browser smoke also exercises the native title-bar layout. Restore
        // its platform marker so the rest of the suite retains its own shell.
        const hadMac = await page.evaluate(() => {
          const had = document.documentElement.classList.contains("is-macos");
          document.documentElement.classList.add("is-macos");
          return had;
        });
        try {
          if ((await dragsWindow(page, ".modal-scrim__windowbar")) !== true)
            throw new Error("the modal covers the native window drag surface");
          if ((await dragsWindow(page, ".sheet__title")) !== true)
            throw new Error("the sheet heading swallows window-drag events");
          if (!(await page.locator(".import-desk__choose").count()))
            throw new Error("pressing the title bar cancelled import");
          const layout = await page.evaluate(() => {
            const sheet = document.querySelector(".sheet").getBoundingClientRect();
            const bar = document.querySelector(".modal-scrim__windowbar").getBoundingClientRect();
            const body = document.querySelector(".sheet__body");
            return {
              top: sheet.top,
              barBottom: bar.bottom,
              bottom: sheet.bottom,
              height: innerHeight,
              scroll: body.scrollHeight - body.clientHeight,
              size: getComputedStyle(document.querySelector(".import-desk")).fontSize,
            };
          });
          if (layout.top < layout.barBottom || layout.bottom > layout.height)
            throw new Error(`sheet overlaps window chrome: ${JSON.stringify(layout)}`);
          if (layout.scroll > 2 || layout.size !== "13px")
            throw new Error(`the opening import screen is oversized: ${JSON.stringify(layout)}`);
          await page.getByRole("button", { name: "Source App: Pages", exact: true }).click();
          await page.getByRole("menuitemradio", { name: "Scrivener", exact: true }).click(); // names: import tool
          if (
            !(await page.locator(".import-desk__guidance").innerText()).includes("File › Compile")
          )
            throw new Error("the chosen source app has no export instructions");
          await audit(page, "document import · compact source guide");
          // The same preference the Appearance panel applies, without opening
          // a second modal over the transaction being measured.
          const prior = await page.evaluate(() => {
            const root = document.documentElement;
            const saved = {
              scale: root.style.getPropertyValue("--ui-scale"),
              large: root.getAttribute("data-large-text"),
            };
            root.style.setProperty("--ui-scale", "2");
            root.setAttribute("data-large-text", "true");
            return saved;
          });
          try {
            const clipped = await page.evaluate(() => {
              const sheet = document.querySelector(".sheet"),
                body = document.querySelector(".sheet__body"),
                foot = document.querySelector(".sheet__foot");
              return (
                sheet.scrollWidth > sheet.clientWidth + 2 ||
                body.scrollWidth > body.clientWidth + 2 ||
                foot.getBoundingClientRect().bottom > innerHeight ||
                [...document.querySelectorAll(".sheet__foot .btn, .import-desk .popupbtn")].some(
                  (el) =>
                    el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2,
                )
              );
            });
            if (clipped) throw new Error("enlarged import text clips its controls or footer");
            await audit(page, "document import · enlarged text");
          } finally {
            await page.evaluate((saved) => {
              const root = document.documentElement;
              if (saved.scale) root.style.setProperty("--ui-scale", saved.scale);
              else root.style.removeProperty("--ui-scale");
              if (saved.large === null) root.removeAttribute("data-large-text");
              else root.setAttribute("data-large-text", saved.large);
            }, prior);
          }
        } finally {
          if (!hadMac)
            await page.evaluate(() => document.documentElement.classList.remove("is-macos"));
          await page.keyboard.press("Escape");
        }
      },
    },
    {
      name: "document import · review, correction, cancellation and export guidance",
      feature: "import",
      async run(page) {
        await page.getByRole("button", { name: "Import a Draft…", exact: true }).click();
        await page.waitForSelector(".import-desk__choose");
        await audit(page, "document import · choose");
        const load = async (name, text) =>
          page.evaluate(
            ({ name, text }) => {
              const input = document.querySelector('.import-desk input[type="file"]');
              const transfer = new DataTransfer();
              transfer.items.add(new File([text], name));
              input.files = transfer.files;
              input.dispatchEvent(new Event("change", { bubbles: true }));
            },
            { name, text },
          );
        await load(
          "Harbor.rtf",
          String.raw`{\rtf1\ansi ACT ONE\par Scene 1\par MARA\par Stay here.\par She waits.}`,
        );
        await page.waitForSelector(".import-desk__review", { timeout: 10000 });
        if ((await page.locator(".import-desk__line").count()) !== 5)
          throw new Error("import preview lost paragraphs");
        await page.getByRole("button", { name: /^Paragraph 5,/ }).click();
        await page.getByRole("button", { name: "Element: Dialogue", exact: true }).click();
        await page.getByRole("menuitemradio", { name: "Stage Direction", exact: true }).click();
        if (!(await page.getByRole("button", { name: /^Paragraph 5, Stage Direction/ }).count()))
          throw new Error("correction did not reach the preview");
        await page.getByRole("button", { name: "Element: Stage Direction", exact: true }).click();
        await page.keyboard.press("Escape");
        if (!(await page.locator(".import-desk__review").count()))
          throw new Error("closing the element menu cancelled import");
        await audit(page, "document import · review");
        await page.keyboard.press("Escape");
        await page.waitForSelector(".import-desk", { state: "detached" });
        if ((await page.locator(".playrow--play").count()) !== 2)
          throw new Error("cancelled import created a play");
        await page.getByRole("button", { name: "Import a Draft…", exact: true }).click();
        await load("Harbor.doc", "not a Word file");
        await page.waitForSelector(".import-desk__error");
        if (!(await page.locator(".import-desk__error").innerText()).includes(".docx"))
          throw new Error("a legacy Word file has no actionable export guidance");
        await audit(page, "document import · export required");
        // A damaged .pages is unreadable rather than export-first: it says so,
        // and names the Word route (docs/app/importing/document-import.md#IMPT-90).
        await load("Harbor.pages", "not a Pages document");
        await until(page, "the damaged Pages document's next step", () =>
          /Harbor\.pages[\s\S]*Export To › Word/.test(
            document.querySelector(".import-desk__error")?.textContent ?? "",
          ),
        );
        await page.keyboard.press("Escape");
      },
    },
    {
      // docs/app/importing/document-import.md#IMPT-87: a .pages document, and a
      // package-form one as the web view hands it over (Name.pages.zip), reach
      // the same review; the playwright's own styles are the reading.
      name: "document import · a Pages document reads directly, in either form",
      feature: "import",
      async run(page) {
        await page.getByRole("button", { name: "Import a Draft…", exact: true }).click();
        await page.waitForSelector(".import-desk__choose");
        if (
          !(await page.locator(".import-desk__choose .import-desk__hint").innerText()).includes(
            "Pages",
          )
        )
          throw new Error("the direct formats do not name Pages");
        if (
          !(await page.locator(".import-desk__guidance").innerText()).includes(
            "Choose your .pages document",
          )
        )
          throw new Error("the Pages guide still sends the writer to Word first");
        const choose = (name, base64) =>
          page.evaluate(
            ({ name, base64 }) => {
              const input = document.querySelector('.import-desk input[type="file"]');
              const transfer = new DataTransfer();
              transfer.items.add(
                new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], name),
              );
              input.files = transfer.files;
              input.dispatchEvent(new Event("change", { bubbles: true }));
            },
            { name, base64 },
          );
        for (const [name, bytes] of [
          ["Harbor.pages", harborPages()],
          ["Harbor.pages.zip", harborPackageZip()],
        ]) {
          // The sheet's file input stays mounted through review, so the
          // second document replaces the first the way Choose Different Files does.
          await choose(name, toBase64(bytes));
          await until(
            page,
            `${name} under review`,
            (expected) => document.querySelector(".sheet__sub")?.textContent === expected,
            `${name} · Pages`,
          );
          await page.waitForSelector(".import-desk__review", { timeout: 10000 });
          if ((await page.locator(".import-desk__line").count()) !== 13)
            throw new Error(`${name}: the preview lost paragraphs`);
          if ((await page.locator("#import-play-title").inputValue()) !== "Harbor")
            throw new Error(`${name}: the play is not named for the document`);
          // A cue in the writer's Character style is read as one, with nothing to review.
          await page.getByRole("button", { name: /^Paragraph 5, Character: MARA$/ }).click();
          if (
            (await page.locator(".import-desk__reason").innerText()) !== "Source style: Character"
          )
            throw new Error(`${name}: the cue was not read from its style`);
          if (await page.getByRole("button", { name: /inferred or unrecognized/ }).count())
            throw new Error(`${name}: a styled line was left to guess`);
          if (name === "Harbor.pages") await audit(page, "document import · Pages review");
        }
        await page.keyboard.press("Escape");
        await page.waitForSelector(".import-desk", { state: "detached" });
      },
    },
    {
      name: "one play open",
      async run(page) {
        // The Weight of Water rather than whichever row sorts first: it is the
        // fixture with cards, acts, and a folder per material home, so the
        // checks below are about a play rather than about an empty one.
        //
        // ONE click opens it: a Plays row once
        // needed a second click in browser dev. The native self-test's click is
        // a single NSEvent that is never repeated, so on every run, natively
        // and under Rosetta, this is the first click on a row, in the real app.
        await page.locator(".playrow__title", { hasText: /^The Weight of Water$/ }).click();
        await page.waitForSelector(".play-page", { timeout: 20000 });
        await visible(page, ".toolbar", { minHeight: 40 });
        await visible(page, ".doctitle", { minWidth: 60 });
        await visible(page, ".toolbar__centre .seg", { minWidth: 200 });
        // The toolbar between its controls moves the window; the title is still
        // the document menu.
        if ((await dragsWindow(page, ".toolbar__right", { x: 0.05, y: 0.5 })) !== true) {
          throw new Error("pressing the toolbar between its controls does not drag the window");
        }
        if ((await dragsWindow(page, ".doctitle")) !== false) {
          throw new Error(
            "pressing the play's title would drag the window instead of opening its menu",
          );
        }
        await visible(page, ".binder", { minWidth: 200, minHeight: 300 });
        // The binder IS the folder (docs/app/keeping-work/storage-and-file-format.md#STOR-D3): every directory in the play
        // shows, including the ones that used to be skipped by name.
        const binderText = await page.locator(".binder").innerText();
        for (const folder of ["Characters", "Notes", "Research", "Loglines"]) {
          if (!binderText.includes(folder)) {
            throw new Error(
              `the binder does not list ${folder}: ${binderText.replace(/\n/g, " · ")}`,
            );
          }
        }
        await visible(page, ".paneroot", { minWidth: 300, minHeight: 300 });
        await visible(page, ".play-page", { minWidth: 300, minHeight: 300 });
        await visible(page, ".elementbar", { minHeight: 24 });
        await visible(page, ".statusbar", { minHeight: 20 });

        // The element bar is the dropdown and NOTHING else: the expanded row and
        // its chevron were deleted, so a stray one here means the trap is back.
        await visible(page, ".elementbar__what", { minWidth: 60 });
        await absent(page, ".elementbar__toggle", "the expanded palette was deleted");

        // One tab, so no strip — and the toolbar's "+" is the way to a second.
        await absent(page, ".pane__tabs", "a lone tab needs no strip to choose from");
        await visible(page, ".viewswitch .iconbtn", { minWidth: 16 });

        // Opening one makes the strip appear, which is the whole contract.
        await page.locator(".viewswitch .iconbtn").click();
        await page.locator('[role="menu"] .menu__item', { hasText: "Board" }).first().click();
        await page.waitForSelector(".pane__tabs", { timeout: 10000 });
        await visible(page, ".pane__tabs", { minHeight: 20 });
        const tabs = await page.locator(".pane__tab").count();
        if (tabs !== 2) throw new Error(`expected 2 tabs after adding one, saw ${tabs}`);

        // And a segment SWITCHES rather than stacking another tab.
        await page.locator(".toolbar__centre .seg__btn", { hasText: "Outline" }).click();
        const after = await page.locator(".pane__tab").count();
        if (after !== 2) throw new Error(`the switcher added a tab: ${after} after switching`);

        // Back to the script, and the page map must FOLLOW THE SCROLL.
        // It tracked the caret, which does not move while you
        // read, so the marker sat on the last scene you typed in — the bug was
        // invisible to every check that only asked whether the strip rendered.
        await page.locator(".toolbar__centre .seg__btn", { hasText: "Script" }).click();
        await page.waitForSelector(".rts", { timeout: 10000 });
        await visible(page, ".rts", { minWidth: 200 });
        const marked = async () =>
          page.evaluate(() =>
            [...document.querySelectorAll(".rts__seg")].findIndex((s) =>
              s.classList.contains("is-here"),
            ),
          );
        const top = await marked();
        if (top !== 0) throw new Error(`strip marks ${top} at the top of the play, expected 0`);
        await page.evaluate(() => {
          const sc = document.querySelector(".pane__body");
          sc.scrollTop = sc.scrollHeight - sc.clientHeight;
        });
        await page.waitForTimeout(300);
        const bottom = await marked();
        if (bottom <= top) {
          throw new Error(`strip did not follow the scroll: ${top} at top, ${bottom} at bottom`);
        }
        await audit(page, "script");
      },
    },
    {
      // Reveal in Finder, pressed rather than inferred: the status
      // bar's path, then a binder row's Reveal in Finder, one click each. In
      // the native self-test the app keeps what it asked Finder to show (the
      // build host is given no Finder windows), and that must be the open
      // play's folder, then the row's own file, on disk. What Finder then draws
      // is Finder's. The browser has no Finder: there this proves only that
      // both controls are there and pressing them says nothing wrong.
      name: "reveal in Finder · the status bar's path and a binder row",
      feature: "app",
      async run(page) {
        const native = await page.evaluate(() => !!window.__TAURI_INTERNALS__);
        const reveals = () =>
          native ? page.evaluate(() => window.__TAURI_INTERNALS__.invoke("selftest_reveals")) : [];
        const next = (count, what) =>
          until(
            page,
            what,
            (n) =>
              window.__TAURI_INTERNALS__
                .invoke("selftest_reveals")
                .then((r) => (r.length > n ? r[r.length - 1] : null)),
            count,
          );
        const bare = (p) => p.replace(/^\/private(?=\/var\/)/, "").replace(/\/+$/, "");

        const shown = await page.locator(".statusbar__path").first().innerText();
        let count = (await reveals()).length;
        await page.locator(".statusbar__path").first().click();
        if (native) {
          const asked = await next(count, "the status bar's reveal");
          if (asked.how !== "open" || !asked.isDir)
            throw new Error(
              `the status bar's path asked Finder for ${JSON.stringify(asked)}, not a folder`,
            );
          if (!bare(asked.path).endsWith(bare(shown).replace(/^~/, "")))
            throw new Error(`the status bar shows ${shown} and revealed ${asked.path}`);
          count++;
        }

        // A row's Actions button shows only under the pointer; ⇧F10 is its key
        // (docs/app/preferences-and-help/accessibility.md#A11Y-8).
        // The browser's vault reveals nothing, so a row offers no Reveal in
        // Finder there (capabilities().canReveal): this half is the app's.
        if (native) {
          await page.locator('.binder [role="treeitem"]').first().focus();
          await page.keyboard.press("Shift+F10");
          await page.waitForSelector(".menu", { timeout: 5000 });
          await page.locator(".menu .menu__item", { hasText: "Reveal in Finder" }).first().click();
          await page.waitForSelector(".menu", { state: "detached", timeout: 5000 });
          const asked = await next(count, "the binder row's reveal");
          if (asked.how !== "open -R" || !asked.exists || asked.isDir)
            throw new Error(
              `a binder row's Reveal in Finder asked for ${JSON.stringify(asked)}, not its own file`,
            );
          if (
            !bare(asked.path).startsWith(bare(shown).replace(/^~/, "")) &&
            !bare(asked.path).includes(bare(shown).replace(/^~/, ""))
          ) {
            throw new Error(
              `a binder row revealed ${asked.path}, outside the open play at ${shown}`,
            );
          }
        }
      },
    },
    {
      name: "alternate watcher spelling reaches the open script and keeps its identity",
      feature: "storage",
      devMock: true,
      async run(page) {
        const path = "The Weight of Water.fountain";
        await until(page, "the script to settle", () =>
          /^Saved/.test(document.querySelector(".savestatus")?.textContent ?? ""),
        );
        const original = await page.evaluate((rel) => window.__prosceniumPeek(rel), path);
        const binder = await page.evaluate(
          () => JSON.parse(window.__prosceniumPeek("The Weight of Water.proscenium")).binder,
        );
        try {
          await page.evaluate(
            ({ rel, text }) =>
              window.__prosceniumExternalAlias(
                rel,
                rel.toUpperCase(),
                text + "\n\nA220 alternate spelling marker.\n",
              ),
            { rel: path, text: original },
          );
          await until(page, "the alternate spelling's edit to reach the open buffer", () =>
            document
              .querySelector(".ProseMirror")
              ?.textContent.includes("A220 alternate spelling marker"),
          );
          await page.waitForTimeout(500);
          const after = await page.evaluate(
            () => JSON.parse(window.__prosceniumPeek("The Weight of Water.proscenium")).binder,
          );
          if (JSON.stringify(after) !== JSON.stringify(binder))
            throw new Error("an alternate event spelling split a binder identity");
        } finally {
          await page.evaluate(({ rel, text }) => window.__prosceniumExternalChange(rel, text), {
            rel: path,
            text: original,
          });
          await until(
            page,
            "the alias fixture to be removed",
            () =>
              !document
                .querySelector(".ProseMirror")
                ?.textContent.includes("A220 alternate spelling marker"),
          );
          await page.locator(".seg__btn", { hasText: "Changes" }).first().click();
          await page.waitForSelector(".changes");
          await page.waitForTimeout(300);
          const keep = page.locator(".changes button", { hasText: /^Keep$/ });
          for (let count = await keep.count(); count > 0; count = await keep.count()) {
            await keep.first().click();
            await until(
              page,
              "the alias comparison to settle",
              (before) =>
                [...document.querySelectorAll(".changes button")].filter(
                  (b) => b.textContent.trim() === "Keep",
                ).length < before,
              count,
            );
          }
          await page.locator(".seg__btn", { hasText: "Script" }).first().click();
        }
      },
    },
    {
      name: "a typed sheet's embedded identity follows an external move",
      feature: "storage",
      devMock: true,
      async run(page) {
        const from = "Characters/Mara.md",
          to = "Research/Mara moved.md";
        const text = await page.evaluate((rel) => window.__prosceniumPeek(rel), from);
        const order = await page.evaluate(() => {
          const walk = (rows) => rows.flatMap((row) => [row, ...walk(row.children ?? [])]);
          return walk(JSON.parse(window.__prosceniumPeek("The Weight of Water.proscenium")).binder)
            .find((row) => row.path === "Characters")
            .children.map((row) => row.id);
        });
        const id = /^id: (.+)$/m.exec(text)?.[1];
        if (!id) throw new Error("the sample sheet has no embedded identity");
        const at = ({ id, path }) => {
          const walk = (rows) => rows.flatMap((row) => [row, ...walk(row.children ?? [])]);
          const rows = walk(
            JSON.parse(window.__prosceniumPeek("The Weight of Water.proscenium")).binder,
          );
          return (
            rows.filter((row) => row.id === id).length === 1 &&
            rows.find((row) => row.id === id)?.path === path
          );
        };
        try {
          await page.evaluate(
            async ({ from, to, text }) => {
              window.__prosceniumExternalRemove(from);
              await window.__prosceniumExternalChange(to, text);
            },
            { from, to, text },
          );
          await until(page, "the character's original identity at its new path", at, {
            id,
            path: to,
          });
          if ((await page.evaluate((rel) => window.__prosceniumPeek(rel), from)) !== null)
            throw new Error("reconciliation recreated the old path");
        } finally {
          await page.evaluate(
            async ({ from, to, text }) => {
              window.__prosceniumExternalRemove(to);
              await window.__prosceniumExternalChange(from, text);
            },
            { from, to, text },
          );
          await until(page, "the sample character restored under its original identity", at, {
            id,
            path: from,
          });
          // An external relocation is appended to its destination by design.
          // Restore this fixture's original sibling order for later key checks.
          await page.evaluate(async (order) => {
            const name = "The Weight of Water.proscenium";
            const play = JSON.parse(window.__prosceniumPeek(name));
            const walk = (rows) => rows.flatMap((row) => [row, ...walk(row.children ?? [])]);
            const parent = walk(play.binder).find((row) => row.path === "Characters");
            parent.children.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
            await window.__prosceniumExternalChange(name, JSON.stringify(play));
          }, order);
          await page.waitForTimeout(350);
        }
      },
    },
    {
      name: "watcher · foreground catches a missed edit and health stays visible",
      feature: "storage",
      devMock: true,
      async run(page) {
        const script = "The Weight of Water.fountain";
        await until(page, "the displayed script to finish saving", () =>
          /^Saved/.test(document.querySelector(".savestatus")?.textContent ?? ""),
        );
        const original = await page.evaluate((rel) => window.__prosceniumPeek(rel), script);
        await page.evaluate(
          async ({ rel, content }) => {
            await window.__prosceniumQuietWrite(
              "The Weight of Water/" + rel,
              content + "\n\nThe floor carries a foreground revalidation marker.\n",
            );
            window.dispatchEvent(new Event("focus"));
          },
          { rel: script, content: original },
        );
        await until(page, "a missed edit to reach the displayed script", () =>
          [...document.querySelectorAll(".ProseMirror")].some((editor) =>
            editor.textContent.includes("foreground revalidation marker"),
          ),
        );
        await page.evaluate(() => window.__prosceniumWatcherHealth("unavailable"));
        await until(page, "watcher health in the status bar", () =>
          document
            .querySelector("[data-watcher-status]")
            ?.textContent.includes("Checking file changes"),
        );
        await visible(page, "[data-watcher-status]", { minWidth: 100, minHeight: 12 });
        await audit(page, "file watcher status");
        await page.waitForTimeout(300);
        await until(page, "the reloaded script to settle", () =>
          /^Saved/.test(document.querySelector(".savestatus")?.textContent ?? ""),
        );
        await page.evaluate(
          async ({ rel, content }) => {
            await window.__prosceniumQuietWrite("The Weight of Water/" + rel, content);
            window.__prosceniumWatcherHealth("watching");
          },
          { rel: script, content: original },
        );
        await until(
          page,
          "the recovered watcher to revalidate the file",
          () =>
            ![...document.querySelectorAll(".ProseMirror")].some((editor) =>
              editor.textContent.includes("foreground revalidation marker"),
            ),
        );
        await until(
          page,
          "the file-checking status to clear",
          () => document.querySelector("[data-watcher-status]")?.textContent === "",
        );
        // Settle the two deliberate fixture edits through the normal review
        // action, so later surface checks begin without pending change marks.
        await page.locator(".seg__btn", { hasText: "Changes" }).first().click();
        await page.waitForSelector(".changes");
        await page.waitForTimeout(500);
        const keep = page.locator(".changes").getByRole("button", { name: "Keep", exact: true });
        for (let count = await keep.count(); count > 0; count = await keep.count()) {
          await keep.first().click();
          await until(
            page,
            "the reviewed change to settle",
            (before) =>
              [...document.querySelectorAll(".changes button")].filter(
                (button) => button.textContent.trim() === "Keep",
              ).length < before,
            count,
          );
        }
        await page.locator(".seg__btn", { hasText: "Script" }).first().click();
        await page.waitForSelector(".play-page");
      },
    },
    {
      name: "inspector",
      feature: "app",
      async run(page) {
        await page.locator('.iconbtn[aria-label*="inspector" i]').click();
        await visible(page, ".inspector", { minWidth: 200, minHeight: 300 });
        await visible(page, ".inspector__head .seg", { minWidth: 100 });
        await visible(page, ".insp", { minWidth: 200, minHeight: 100 });
        await audit(page, "inspector");
      },
    },
    {
      // The element bar fits its pane (docs/app/writing/editor-ux.md#EDIT-171).
      // With the inspector open the pane is narrower than the bar used to be
      // (963px, most of it hidden badges), and for three weeks everything past
      // Line Break ran off the pane, the sheet with it — at the app's default
      // window. Every check before this one ran where it happened to fit.
      name: "element bar · fits its pane at every width",
      feature: "editor",
      async run(page) {
        await page.waitForSelector(".inspector", { timeout: 5000 });
        const settled = (what) =>
          until(page, what, elementBarFacts, true).catch(async () => {
            const facts = await page.evaluate(elementBarFacts);
            throw new Error(
              `${what}: ${facts.problems.join("; ")} (fit "${facts.fit}", ${facts.width}px)`,
            );
          });
        await settled("the element bar to fit beside the inspector");

        // Holding ⌘ shows every shortcut and moves nothing: a badge that took
        // room would push the row about, and a hidden one took room for nothing.
        const lefts = () =>
          page.evaluate(() =>
            [...document.querySelectorAll(".elementbar button")]
              .map((b) => Math.round(b.getBoundingClientRect().left))
              .join(),
          );
        const before = await lefts();
        await page.evaluate(() =>
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "Meta" })),
        );
        try {
          await until(page, "every shown button's shortcut on ⌘-hold", () => {
            const keys = [
              ...document.querySelectorAll(".elementbar button .elementbar__badge"),
            ].filter((k) => k.getClientRects().length);
            return (
              keys.length > 0 &&
              keys.every((k) => {
                const r = k.getBoundingClientRect();
                return getComputedStyle(k).opacity === "1" && r.left >= 0 && r.right <= innerWidth;
              })
            );
          });
          if ((await lefts()) !== before)
            throw new Error("holding ⌘ moved the element bar's buttons");
        } finally {
          await page.evaluate(() =>
            window.dispatchEvent(new KeyboardEvent("keyup", { key: "Meta" })),
          );
        }

        // Narrower, a step at a time, down to a split pane on a small window.
        // Each step has to settle into a fit with nothing clipped, nothing
        // overlapping and the page count on screen.
        try {
          for (const width of [640, 520, 420, 340, 280]) {
            await page.evaluate((w) => {
              document.querySelector(".paneroot").style.flex = `0 0 ${w}px`;
            }, width);
            await settled(`the element bar to fit a ${width}px pane`);
          }
          const fit = (await page.evaluate(elementBarFacts)).fit;
          if (!/fold-marks/.test(fit))
            throw new Error(`a 280px pane left the bar at "${fit}", not its last fit`);

          // Find and replace wraps in a pane this narrow, and the element bar
          // sticks under it however tall it grows: at fixed offsets its
          // buttons went under the find bar.
          await page.locator(".ProseMirror").first().focus();
          await page.keyboard.press("Meta+Alt+KeyF");
          await page.waitForSelector(".findbar--replace", { timeout: 5000 });
          await page.locator('.findbar__field[aria-label="Find"]').fill("the");
          await until(page, "the element bar under a wrapped find bar", () => {
            const find = document.querySelector(".findbar")?.getBoundingClientRect();
            const bar = document.querySelector(".elementbar")?.getBoundingClientRect();
            return !!find && !!bar && find.height > 40 && bar.top >= find.bottom - 0.5;
          });
          await settled("the element bar to fit under the find bar");
          await audit(page, "find bar · narrow pane");
          await page.locator('.findbar__field[aria-label="Find"]').focus();
          await page.keyboard.press("Escape");
          await page.waitForSelector(".findbar", { state: "detached", timeout: 5000 });
          // Closing find hands the keyboard back to the script a frame later
          // (TipTap focuses in a requestAnimationFrame). Let it land, or it
          // lands on More's open menu below and takes the key from it.
          await scriptFocused(page);
          await audit(page, "element bar · folded");

          // Everything folded is one key away: More opens on ⏎ with every
          // action the row gave up, and Escape hands the key back to More.
          await page.locator(".elementbar__more").focus();
          await until(page, "More to have the keyboard", () =>
            document.activeElement?.classList.contains("elementbar__more"),
          );
          await page.keyboard.press("Enter");
          await page.waitForSelector(".menu", { timeout: 5000 });
          const rows = (await page.locator(".menu .menu__item").allInnerTexts()).map((t) =>
            t.split("\n")[0].trim(),
          );
          for (const want of [
            "Bold",
            "Italic",
            "Underline",
            "Line Break",
            "Page Break",
            "Comment",
          ]) {
            if (!rows.includes(want))
              throw new Error(`More does not offer ${want}: ${rows.join(" · ")}`);
          }
          if (!rows.some((r) => /^Comments/.test(r)))
            throw new Error(`More does not offer Comments: ${rows.join(" · ")}`);
          await audit(page, "element bar · More");
          await page.keyboard.press("Escape");
          await page.waitForSelector(".menu", { state: "detached", timeout: 5000 });
          const back = await focused(page);
          if (!/elementbar__more/.test(back.desc))
            throw new Error(`closing More left focus on ${back.desc}`);
        } finally {
          await page.evaluate(() => {
            document.querySelector(".paneroot").style.flex = "";
          });
        }
        await settled("the element bar to fit its pane again");
      },
    },
    {
      name: "document menu",
      feature: "app",
      async run(page) {
        await page.locator(".doctitle").click();
        await page.waitForSelector(".menu", { timeout: 5000 });
        await visible(page, ".menu", { minWidth: 180, minHeight: 100 });
        await visible(page, ".menu__item", { minWidth: 150, minHeight: 18 });
        await audit(page, "document menu");
        await page.keyboard.press("Escape");
        await page.waitForSelector(".menu", { state: "detached", timeout: 5000 });
      },
    },
    {
      // The highlight is DOM focus, so a screen reader can follow it; closing
      // hands focus back to the control that opened the menu.
      name: "keyboard · menu",
      feature: "ui",
      async run(page) {
        await page.locator(".doctitle").focus();
        await page.keyboard.press("Enter");
        await page.waitForSelector(".menu", { timeout: 5000 });
        const first = await focused(page);
        if (!/^menuitem/.test(first.role ?? "")) {
          throw new Error(`menu opened with focus on ${first.desc}, expected its first row`);
        }
        await page.keyboard.press("ArrowDown");
        const second = await focused(page);
        if (second.text === first.text || !/^menuitem/.test(second.role ?? "")) {
          throw new Error(`↓ left focus on ${second.desc}`);
        }
        await page.keyboard.press("Escape");
        await page.waitForSelector(".menu", { state: "detached", timeout: 5000 });
        if (!(await page.evaluate(() => document.activeElement?.classList.contains("doctitle")))) {
          throw new Error(
            `Escape left focus on ${(await focused(page)).desc}, not the title button`,
          );
        }
      },
    },
    {
      // Only the TOP layer acts on a key, and Tab cannot walk out of a sheet.
      name: "keyboard · sheet",
      feature: "ui",
      async run(page) {
        await openFromDocumentMenu(page, /Export PDF/);
        await page.waitForSelector(".sheet", { timeout: 10000 });
        await audit(page, "export sheet");
        for (let i = 0; i < 25; i++) {
          await page.keyboard.press("Tab");
          // A Tab WebKit moves to <body> fires no focusin, so the sheet pulls
          // it back on the next frame (ui/Sheet.tsx): inside by then is inside.
          const inside = await until(
            page,
            "focus back inside the sheet",
            () => !!document.activeElement?.closest(".sheet"),
            undefined,
            1000,
          ).catch(() => false);
          if (!inside)
            throw new Error(
              `Tab ${i + 1} walked out of the sheet to ${(await focused(page)).desc}`,
            );
        }
        await page.locator(".sheet .popupbtn").first().focus();
        await page.keyboard.press("ArrowDown");
        await page.waitForSelector(".menu", { timeout: 5000 });
        // Drawn ABOVE the sheet it belongs to — it opened underneath for weeks.
        await onTop(page, ".menu");
        await page.keyboard.press("Escape");
        await page.waitForSelector(".menu", { state: "detached", timeout: 5000 });
        if ((await page.locator(".sheet").count()) !== 1) {
          throw new Error("Escape in a popup closed the sheet underneath it");
        }
        if (!(await page.evaluate(() => document.activeElement?.classList.contains("popupbtn")))) {
          throw new Error(`closing the popup left focus on ${(await focused(page)).desc}`);
        }
        await page.keyboard.press("Escape");
        await page.waitForSelector(".sheet", { state: "detached", timeout: 5000 });
      },
    },
    {
      // Launch to export in one run (docs/engineering/release-engineering.md#REL-121): the open
      // play, exported through the Export sheet's own button, and the file that
      // landed read back as a PDF with its pages, its title and its language
      // (docs/app/preferences-and-help/accessibility.md#A11Y-13). In the native self-test the
      // save panel's answer is the run's own folder and the Rust writer puts the
      // file on disk, so under Rosetta it is the Intel slice that wrote it; in
      // smoke it is the page's download.
      name: "export · a PDF written and read back",
      feature: "pdf",
      async run(page) {
        const native = await page.evaluate(() => !!window.__TAURI_INTERNALS__);
        if (!native) {
          await page.evaluate(() => {
            window.__exportCreateURL = URL.createObjectURL;
            window.__exportPdf = null;
            URL.createObjectURL = function (blob) {
              if (blob.type === "application/pdf") window.__exportPdf = blob;
              return window.__exportCreateURL(blob);
            };
          });
        }
        const before = native
          ? await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("selftest_exported"))
          : null;
        let file;
        try {
          await openFromDocumentMenu(page, /Export PDF/);
          await page.waitForSelector(".exportpanel__body", { timeout: 10000 });
          await page.getByRole("button", { name: "Export PDF…", exact: true }).click();
          await page.waitForSelector(".sheet", { state: "detached", timeout: 30000 });
          file = native
            ? await until(
                page,
                "the PDF on disk",
                (earlier) =>
                  window.__TAURI_INTERNALS__
                    .invoke("selftest_exported")
                    .then((f) => (f && f.base64 !== earlier?.base64 ? f : null)),
                before,
                30000,
              )
            : await until(
                page,
                "the exported PDF",
                async () => {
                  if (!window.__exportPdf) return null;
                  const all = new Uint8Array(await window.__exportPdf.arrayBuffer());
                  let text = "";
                  for (let i = 0; i < all.length; i += 0x8000)
                    text += String.fromCharCode(...all.subarray(i, i + 0x8000));
                  return { name: "download", base64: btoa(text) };
                },
                undefined,
                30000,
              );
        } finally {
          if (!native) {
            await page.evaluate(() => {
              URL.createObjectURL = window.__exportCreateURL;
              delete window.__exportCreateURL;
              delete window.__exportPdf;
            });
          }
        }
        const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
        if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-")
          throw new Error(`${file.name} is not a PDF`);
        const { PDFDocument, PDFName } = await import("pdf-lib");
        const pdf = await PDFDocument.load(bytes);
        if (pdf.getPageCount() < 1) throw new Error(`${file.name} has no pages`);
        const title = pdf.getTitle() ?? "";
        const heading = await page.locator(".doctitle").first().innerText();
        if (!title || !heading.toLowerCase().includes(title.toLowerCase()))
          throw new Error(`${file.name} is titled "${title}", and the play open is "${heading}"`);
        if (!/en|fr|[a-z]{2}/i.test(String(pdf.catalog.get(PDFName.of("Lang")) ?? "")))
          throw new Error(`${file.name} does not say its language`);
        if (native) {
          const slice = await page.evaluate(() =>
            window.__TAURI_INTERNALS__.invoke("selftest_slice"),
          );
          await page.evaluate(
            (line) => window.__TAURI_INTERNALS__.invoke("selftest_log", { line }),
            `export · ${file.name}: ${pdf.getPageCount()} pages, "${title}", written by the ${slice.arch} slice${slice.translated ? " under Rosetta" : ""}`,
          );
        }
      },
    },
    {
      name: "export validates the play language before saving",
      feature: "pdf",
      async run(page) {
        await openFromDocumentMenu(page, /Export PDF/);
        await page.waitForSelector(".exportpanel__language");
        const field = page.getByRole("textbox", { name: "Play language" });
        await field.fill("English (US)");
        await until(
          page,
          "invalid language feedback",
          () =>
            document.querySelector('[aria-label="Play language"]')?.getAttribute("aria-invalid") ===
              "true" &&
            [...document.querySelectorAll(".sheet button")].some(
              (b) => b.textContent === "Export PDF…" && b.disabled,
            ),
        );
        await field.fill("fr-CA");
        await until(
          page,
          "a valid language to enable export",
          () =>
            document.querySelector('[aria-label="Play language"]')?.getAttribute("aria-invalid") ===
              "false" &&
            [...document.querySelectorAll(".sheet button")].some(
              (b) => b.textContent === "Export PDF…" && !b.disabled,
            ),
        );
        await audit(page, "export play language");
        await page.keyboard.press("Escape");
      },
    },
    {
      name: "exported bytes carry tags and the saved per-play language",
      feature: "pdf",
      devMock: true,
      async run(page) {
        // Capture the browser's actual download Blob; no alternate renderer or
        // test-only export implementation. Native Save panels stay a human check.
        await page.evaluate(() => {
          window.__a623CreateURL = URL.createObjectURL;
          window.__a623Pdf = null;
          URL.createObjectURL = function (blob) {
            if (blob.type === "application/pdf") window.__a623Pdf = blob;
            return window.__a623CreateURL(blob);
          };
        });
        try {
          const otherBefore = await page.evaluate(() =>
            window.__prosceniumPeekKey("The Lighthouse/The Lighthouse.proscenium"),
          );
          await openFromDocumentMenu(page, /Export PDF/);
          await page.getByRole("textbox", { name: "Play language" }).fill("fr-ca");
          await page.evaluate(() =>
            window.__prosceniumGate("write", "The Weight of Water.proscenium", {
              fail: "A623 language save unavailable",
            }),
          );
          await page.getByRole("button", { name: "Export PDF…", exact: true }).click();
          await until(page, "a refused language save to keep export open", () =>
            /could not be saved/.test(
              document.querySelector("#export-language-help")?.textContent ?? "",
            ),
          );
          if (await page.evaluate(() => !!window.__a623Pdf))
            throw new Error("a refused language save exported anyway");
          await page.evaluate(() => window.__prosceniumOpenGates("write"));
          await page.getByRole("button", { name: "Export PDF…", exact: true }).click();
          await until(page, "the exported PDF", () => !!window.__a623Pdf);
          const bytes = await page.evaluate(async () => [
            ...new Uint8Array(await window.__a623Pdf.arrayBuffer()),
          ]);
          const { PDFDocument, PDFDict, PDFName } = await import("pdf-lib");
          const pdf = await PDFDocument.load(Uint8Array.from(bytes));
          if (!String(pdf.catalog.get(PDFName.of("Lang"))).includes("fr-CA"))
            throw new Error("export lost the play language");
          const tree = pdf.catalog.lookup(PDFName.of("StructTreeRoot"), PDFDict);
          if (!tree.get(PDFName.of("ParentTree")))
            throw new Error("export has no linked reading structure");
          const stored = await page.evaluate(
            () =>
              JSON.parse(window.__prosceniumPeek("The Weight of Water.proscenium")).settings
                .language,
          );
          if (stored !== "fr-CA") throw new Error("the play file did not retain its language");
          if (
            (await page.evaluate(() =>
              window.__prosceniumPeekKey("The Lighthouse/The Lighthouse.proscenium"),
            )) !== otherBefore
          )
            throw new Error("export changed another play's settings");
          await openFromDocumentMenu(page, /Export PDF/);
          if ((await page.getByRole("textbox", { name: "Play language" }).inputValue()) !== "fr-CA")
            throw new Error("language was not saved for the next export");
          await page.getByRole("textbox", { name: "Play language" }).fill("en-US");
          await page.getByRole("button", { name: "Export PDF…", exact: true }).click();
          await until(
            page,
            "the language reset to finish exporting",
            () => !document.querySelector(".sheet"),
          );
        } finally {
          await page.evaluate(() => window.__prosceniumOpenGates("write"));
          await page.evaluate(() => {
            URL.createObjectURL = window.__a623CreateURL;
            delete window.__a623CreateURL;
            delete window.__a623Pdf;
          });
        }
      },
    },
    {
      // The same dialog, on a word processor's file: named by extension in the
      // menu, the title and the button, with the File type choice working from
      // the keyboard and Print still the PDF's
      // (docs/app/formatting/formats-and-layout.md#FMT-145).
      name: "docs/app/formatting/formats-and-layout.md#FMT-145 · Export .docx and .odt from the document menu",
      feature: "wordproc",
      async run(page) {
        await openFromDocumentMenu(page, /Export \.docx/);
        await page.waitForSelector(".exportpanel__body");
        await until(
          page,
          "the dialog to name the .docx",
          () =>
            document.querySelector(".sheet")?.textContent?.includes("Export .docx") &&
            [...document.querySelectorAll(".sheet button")].some(
              (b) => b.textContent === "Export .docx…",
            ),
        );
        await visible(page, ".exportpanel__typefield .popupbtn", { minWidth: 40, minHeight: 18 });
        const hint = await page.locator(".exportpanel__foothint").innerText();
        if (!/sets its own page breaks/.test(hint))
          throw new Error(`the .docx dialog's hint says "${hint}"`);
        await audit(page, "export · .docx");
        await page.locator(".exportpanel__typefield .popupbtn").focus();
        await page.keyboard.press("ArrowDown");
        await page.waitForSelector(".menu");
        await onTop(page, ".menu");
        for (let i = 0; i < 6 && !(await focused(page)).text.includes(".odt"); i++)
          await page.keyboard.press("ArrowDown");
        if (!(await focused(page)).text.includes(".odt"))
          throw new Error(
            `the File type menu never reached .odt; focus is on ${(await focused(page)).desc}`,
          );
        await page.keyboard.press("Enter");
        await until(page, "the export button to name the .odt", () =>
          [...document.querySelectorAll(".sheet button")].some(
            (b) => b.textContent === "Export .odt…",
          ),
        );
        if (!(await page.getByRole("button", { name: "Print…", exact: true }).count()))
          throw new Error("the .odt dialog lost Print");
        await page.keyboard.press("Escape");
        await page.waitForSelector(".sheet", { state: "detached", timeout: 5000 });
      },
    },
    {
      // The shipped bundle's own files, caught as the downloads browser dev
      // makes of them: a .docx and an .odt whose parts hold the play's words in
      // its styles, and the embedded type (docs/app/formatting/formats-and-layout.md#FMT-157).
      name: "docs/app/formatting/formats-and-layout.md#FMT-157 · the .docx and .odt downloads hold the play in its styles",
      feature: "wordproc",
      devMock: true,
      async run(page) {
        await page.evaluate(() => {
          window.__wpCreateURL = URL.createObjectURL;
          window.__wpFiles = [];
          URL.createObjectURL = function (blob) {
            if (/wordprocessingml|opendocument/.test(blob.type)) window.__wpFiles.push(blob);
            return window.__wpCreateURL(blob);
          };
        });
        try {
          for (const [row, type, count] of [
            [/Export \.docx/, "docx", 1],
            [/Export \.odt/, "odt", 2],
          ]) {
            await openFromDocumentMenu(page, row);
            await page.waitForSelector(".exportpanel__body");
            await page.getByRole("button", { name: `Export .${type}…`, exact: true }).click();
            await until(page, `the .${type} download`, (n) => window.__wpFiles.length >= n, count);
            await page.waitForSelector(".sheet", { state: "detached", timeout: 10000 });
          }
          const files = await page.evaluate(async () =>
            Promise.all(
              window.__wpFiles.map(async (blob) => [...new Uint8Array(await blob.arrayBuffer())]),
            ),
          );
          const { unzipSync, strFromU8 } = await import("fflate");
          const docx = unzipSync(Uint8Array.from(files[0]));
          const body = strFromU8(docx["word/document.xml"]);
          const styles = strFromU8(docx["word/styles.xml"]);
          if (!body.includes('<w:pStyle w:val="Character"/>') || !body.includes("crying all night"))
            throw new Error("the .docx lost the play's cues or words");
          if (
            !styles.includes('<w:name w:val="Dialogue"/>') ||
            !/<w:lang w:val="[a-zA-Z-]+"/.test(styles)
          )
            throw new Error("the .docx has no Dialogue style or no language");
          if (!docx["word/fonts/font1.odttf"])
            throw new Error("the .docx carries no embedded type");
          const odtBytes = Uint8Array.from(files[1]);
          if (strFromU8(odtBytes.slice(30, 38)) !== "mimetype")
            throw new Error("the .odt does not start with its media type");
          const odt = unzipSync(odtBytes);
          if (!strFromU8(odt["content.xml"]).includes("crying all night"))
            throw new Error("the .odt lost the play's words");
          if (!strFromU8(odt["styles.xml"]).includes('style:display-name="Character"'))
            throw new Error("the .odt has no Character style");
          if (!odt["Fonts/CourierPrime-Regular.ttf"])
            throw new Error("the .odt carries no embedded type");
        } finally {
          await page.evaluate(() => {
            URL.createObjectURL = window.__wpCreateURL;
            delete window.__wpCreateURL;
            delete window.__wpFiles;
          });
        }
      },
    },
    {
      // A writer who sets a page range sees only those pages in the preview,
      // and can put a cover and cast page on any export. The
      // fixture play is two pages behind a title, cast and setting sheet.
      name: "export · the preview holds only what goes out, front sheets included",
      feature: "pdf",
      async run(page) {
        const shown = () =>
          page.evaluate(() =>
            [...document.querySelectorAll(".exportpanel__pane [data-sheet]")]
              .map((el) => el.dataset.sheet)
              .join(" "),
          );
        await openFromDocumentMenu(page, /Export PDF/);
        await page.waitForSelector(".exportpanel__pane [data-sheet]");
        const whole = await shown();
        if (whole !== "front-0 front-1 front-2 page-1 page-2")
          throw new Error(`the whole script previews as "${whole}"`);
        await visible(page, '.exportpanel__pane [data-sheet="front-0"] .exportpanel__paper', {
          minWidth: 200,
          minHeight: 250,
        });

        await page.getByRole("textbox", { name: "Pages to export" }).fill("2");
        await until(
          page,
          "the preview to hold page 2 alone",
          () =>
            [...document.querySelectorAll(".exportpanel__pane [data-sheet]")]
              .map((el) => el.dataset.sheet)
              .join(" ") === "page-2",
        );
        // The rail still offers every sheet; only the preview is the file.
        const offered = await page.locator(".exportpanel__rail [data-sheet]").count();
        if (offered !== 5) throw new Error(`the rail offers ${offered} sheets, not all 5`);
        await visible(page, '.exportpanel__pane [data-sheet="page-2"] .exportpanel__paper', {
          minWidth: 200,
          minHeight: 250,
        });

        // A cover and a cast page on the excerpt, in stage order whatever order
        // they were ticked in, and the preview moves to the sheet just added.
        await page.locator('.exportpanel__front [aria-label="Characters page"]').click();
        await page.locator('.exportpanel__front [aria-label="Title page"]').click();
        await until(
          page,
          "the title and cast pages before page 2",
          () =>
            [...document.querySelectorAll(".exportpanel__pane [data-sheet]")]
              .map((el) => el.dataset.sheet)
              .join(" ") === "front-0 front-1 page-2",
        );
        await until(
          page,
          "the pager to name the sheet in view",
          () =>
            document.querySelector(".exportpanel__pagernow")?.textContent ===
            "Title page · sheet 1 of 3",
        );
        await visible(page, '.exportpanel__pane [data-sheet="front-1"] .exportpanel__paper', {
          minWidth: 200,
          minHeight: 250,
        });

        // An anonymous copy: the title page keeps the title and loses the
        // byline and the contact block, and the dialog says nothing else names
        // the writer (docs/app/formatting/formats-and-layout.md#FMT-143,
        // docs/app/formatting/formats-and-layout.md#FMT-144).
        const titleSheet = () =>
          page.evaluate(
            () =>
              document.querySelector('.exportpanel__pane [data-sheet="front-0"]')?.textContent ??
              "",
          );
        if (!/A\. Playwright/.test(await titleSheet()))
          throw new Error("the title page does not name its author to begin with");
        await page.locator('.exportpanel__anonymous [aria-label="Anonymous copy"]').focus();
        await page.keyboard.press("Space");
        await until(page, "the title page without the writer", () => {
          const text =
            document.querySelector('.exportpanel__pane [data-sheet="front-0"]')?.textContent ?? "";
          return /THE WEIGHT OF WATER/.test(text) && !/Playwright|@|a play by/.test(text);
        });
        const clean = await page.locator("#export-anonymous-help").innerText();
        if (clean !== "No name or contact details on any page, or in the file.") {
          throw new Error(`an anonymous copy of the fixture says "${clean}"`);
        }
        await visible(page, ".exportpanel__anonymous", { minWidth: 100, minHeight: 16 });
        await audit(page, "export · an anonymous copy");
        await page.keyboard.press("Space");
        await until(page, "the author back on the title page", () =>
          /A\. Playwright/.test(
            document.querySelector('.exportpanel__pane [data-sheet="front-0"]')?.textContent ?? "",
          ),
        );

        // A page left out can't be previewed; the pager says why instead of
        // silently not moving.
        await page
          .locator('.exportpanel__thumb[data-sheet="page-1"] .exportpanel__thumbsheet')
          .click();
        await until(page, "the note about the left-out page", () =>
          /^Page 1 is left out/.test(
            document.querySelector(".exportpanel__pagernow")?.textContent ?? "",
          ),
        );
        await audit(page, "export · an excerpt with front sheets");
        await page.keyboard.press("Escape");
        await page.waitForSelector(".sheet", { state: "detached", timeout: 5000 });

        // ⌘P is the same dialog, printing by default. Natively that key is the
        // menu bar's accelerator, so this presses the File ▸ Print… route there.
        await page.keyboard.press("Meta+KeyP");
        await page.waitForSelector(".exportpanel__pane", { timeout: 10000 });
        const title = await page.locator(".sheet__title").innerText();
        const primary = await page.locator(".sheet__foot .btn--primary").innerText();
        await page.keyboard.press("Escape");
        await page.waitForSelector(".sheet", { state: "detached", timeout: 5000 });
        if (title !== "Print" || primary !== "Print…")
          throw new Error(`⌘P opened "${title}" with "${primary}" as its default`);
      },
    },
    {
      // Print hands the export's own bytes on. Natively they go to PDFKit's
      // print panel, which takes the Mac, so that stays a human check; the
      // browser build opens them in a tab instead, and this reads what it opened.
      name: "print · Print… sends exactly the sheets the preview showed",
      feature: "pdf",
      devMock: true,
      async run(page) {
        await page.evaluate(() => {
          window.__printCreateURL = URL.createObjectURL;
          window.__printOpen = window.open;
          window.__printPdf = null;
          window.__printOpened = [];
          window.__printDownloads = 0;
          URL.createObjectURL = function (blob) {
            if (blob.type === "application/pdf") window.__printPdf = blob;
            return window.__printCreateURL(blob);
          };
          window.open = (url) => {
            window.__printOpened.push(String(url));
            return null;
          };
          // The export's download link is never attached, so its click is
          // counted where it is made rather than where it would bubble.
          window.__printAnchorClick = HTMLAnchorElement.prototype.click;
          HTMLAnchorElement.prototype.click = function () {
            if (this.download) window.__printDownloads++;
            return window.__printAnchorClick.call(this);
          };
        });
        try {
          await page.keyboard.press("Meta+KeyP");
          await page.waitForSelector(".exportpanel__pane [data-sheet]", { timeout: 10000 });
          await page.getByRole("textbox", { name: "Pages to print" }).fill("2");
          await page.locator('.exportpanel__front [aria-label="Characters page"]').click();
          await until(
            page,
            "the cast page before page 2",
            () =>
              [...document.querySelectorAll(".exportpanel__pane [data-sheet]")]
                .map((el) => el.dataset.sheet)
                .join(" ") === "front-1 page-2",
          );
          await audit(page, "print sheet");
          await page.getByRole("button", { name: "Print…", exact: true }).click();
          await until(
            page,
            "the PDF handed to the print route",
            () => !!window.__printPdf && window.__printOpened.length === 1,
          );
          await until(
            page,
            "the sheet to close on the way out",
            () => !document.querySelector(".sheet"),
          );
          if (await page.evaluate(() => window.__printDownloads))
            throw new Error("printing saved a download");
          const bytes = await page.evaluate(async () => [
            ...new Uint8Array(await window.__printPdf.arrayBuffer()),
          ]);
          const { PDFDocument } = await import("pdf-lib");
          const pdf = await PDFDocument.load(Uint8Array.from(bytes));
          if (pdf.getPageCount() !== 2)
            throw new Error(`printed ${pdf.getPageCount()} pages, not the cast page and page 2`);
        } finally {
          await page.evaluate(() => {
            URL.createObjectURL = window.__printCreateURL;
            window.open = window.__printOpen;
            HTMLAnchorElement.prototype.click = window.__printAnchorClick;
            for (const key of [
              "__printCreateURL",
              "__printOpen",
              "__printPdf",
              "__printOpened",
              "__printDownloads",
              "__printAnchorClick",
            ])
              delete window[key];
          });
        }
      },
    },
    {
      name: "long front matter continues on bounded sheets and export counts them",
      feature: "layout",
      devMock: true,
      async run(page) {
        const path = "The Weight of Water.fountain";
        await until(page, "the script to finish saving", () =>
          /^Saved/.test(document.querySelector(".savestatus")?.textContent ?? ""),
        );
        const original = await page.evaluate((rel) => window.__prosceniumPeek(rel), path);
        const cast = Array.from(
          { length: 40 },
          (_, i) => `    ACTOR ${i + 1} — a person in this play`,
        ).join("\n");
        const fixture = original
          .replace(/Characters:[\s\S]*?\n\n/, `Characters:\n${cast}\n\n`)
          .replace(/^Setting:.*$/m, "Setting: " + "The coast beyond the kitchen. ".repeat(180));
        try {
          await page.evaluate(({ rel, text }) => window.__prosceniumExternalChange(rel, text), {
            rel: path,
            text: fixture,
          });
          await until(page, "the final cast entry on a continuation sheet", () =>
            [...document.querySelectorAll('[data-front-kind="characters"] .frontsheet__line')].some(
              (el) => el.textContent.includes("ACTOR 40"),
            ),
          );
          // Reload restores the caret over two renders. Let that restoration
          // finish before a modal takes focus over the newly inserted sheets.
          await page.waitForTimeout(250);
          const count = await page.evaluate(() => {
            const sheets = [...document.querySelectorAll("[data-front-kind]")];
            for (const kind of ["characters", "setting"])
              if (sheets.filter((s) => s.dataset.frontKind === kind).length < 2)
                throw new Error(`${kind} did not continue`);
            for (const sheet of sheets) {
              const box = sheet.getBoundingClientRect();
              for (const line of sheet.querySelectorAll(".frontsheet__line")) {
                const r = line.getBoundingClientRect();
                if (
                  r.top < box.top - 1 ||
                  r.bottom > box.bottom + 1 ||
                  r.left < box.left - 1 ||
                  r.right > box.right + 1
                )
                  throw new Error(`front matter escaped its sheet: ${line.textContent}`);
              }
            }
            return sheets.length;
          });
          await openFromDocumentMenu(page, /Export PDF/);
          await page.waitForSelector(".exportpanel__rail");
          // Every sheet the editor draws is one the export can include, and the
          // whole script starts with all of them going (docs/app/formatting/formats-and-layout.md#FMT-60).
          const railed = await page.locator('.exportpanel__rail [data-sheet^="front-"]').count();
          const going = await page.locator('.exportpanel__pane [data-sheet^="front-"]').count();
          if (railed !== count || going !== count)
            throw new Error(
              `the editor has ${count} front sheets but export offers ${railed} and sends ${going}`,
            );
          const options = await page.locator(".exportpanel__front").innerText();
          if (!/Characters page \(\d+ sheets\)/.test(options))
            throw new Error(`a cast list over several sheets is not counted: ${options}`);
          await audit(page, "long front-matter export");
          await page.keyboard.press("Escape");
          await page.waitForSelector(".sheet", { state: "detached" });
          await until(page, "the front-matter fixture to settle before restoration", () =>
            /^Saved/.test(document.querySelector(".savestatus")?.textContent ?? ""),
          );
        } catch (error) {
          console.log(`long front matter fixture check failed before cleanup: ${String(error)}`);
          throw error;
        } finally {
          await page.evaluate(({ rel, text }) => window.__prosceniumExternalChange(rel, text), {
            rel: path,
            text: original,
          });
          await until(
            page,
            "the original front matter to return",
            () =>
              ![
                ...document.querySelectorAll('[data-front-kind="characters"] .frontsheet__line'),
              ].some((el) => el.textContent.includes("ACTOR 40")),
          );
          await page.locator(".seg__btn", { hasText: "Changes" }).first().click();
          await page.waitForSelector(".changes");
          await page.waitForTimeout(300);
          const keep = page.locator(".changes").getByRole("button", { name: "Keep", exact: true });
          for (let n = await keep.count(); n > 0; n = await keep.count()) {
            await keep.first().click();
            await until(
              page,
              "the restored fixture's review to settle",
              (before) =>
                [...document.querySelectorAll(".changes button")].filter(
                  (button) => button.textContent.trim() === "Keep",
                ).length < before,
              n,
            );
          }
          await page.locator(".seg__btn", { hasText: "Script" }).first().click();
        }
      },
    },
    {
      // A cue's extension is TEXT on the page (docs/engineering/fountain-model.md#EDIT-124). It used to live in
      // an attribute nothing drew: a reopened script read "MARA", retyping the
      // missing "(V.O.)" wrote it twice, and renaming the cue carried one nobody
      // could see. The reload is the file's own reading, the parser's; the typing
      // is what makes the next save write the whole script back.
      name: "a cue's extension stays on the page and is written once",
      feature: "editor",
      devMock: true,
      async run(page) {
        const path = "The Weight of Water.fountain";
        const settled = () =>
          until(page, "the script to finish saving", () =>
            /^Saved/.test(document.querySelector(".savestatus")?.textContent ?? ""),
          );
        await settled();
        const original = await page.evaluate((rel) => window.__prosceniumPeek(rel), path);
        const fixture = original.replace(/^MARA$/m, "MARA (V.O.)");
        if (fixture === original)
          throw new Error("the sample play has no MARA cue to put in voice-over");
        try {
          await page.evaluate(({ rel, text }) => window.__prosceniumExternalChange(rel, text), {
            rel: path,
            text: fixture,
          });
          await until(page, "MARA (V.O.) on the page", () =>
            [...document.querySelectorAll(".play-page .pl-character")].some(
              (el) => el.textContent === "MARA (V.O.)",
            ),
          );
          await settled();
          // Showing the extension is not an edit: nothing may be written for it.
          await page.waitForTimeout(800);
          if ((await page.evaluate((rel) => window.__prosceniumPeek(rel), path)) !== fixture) {
            throw new Error("opening a cue with an extension rewrote the script");
          }
          await page.evaluate(() => {
            const cue = [...document.querySelectorAll(".play-page .pl-character")].find(
              (el) => el.textContent === "MARA (V.O.)",
            );
            let speech = cue?.nextElementSibling ?? null;
            while (speech && !speech.classList.contains("pl-dialogue"))
              speech = speech.nextElementSibling;
            if (!speech) throw new Error("no speech under MARA (V.O.)");
            const walker = document.createTreeWalker(speech, NodeFilter.SHOW_TEXT);
            let last = null;
            for (let n = walker.nextNode(); n; n = walker.nextNode()) last = n;
            if (!last) throw new Error("the speech under MARA (V.O.) has no text");
            speech.closest(".ProseMirror").focus();
            const range = document.createRange();
            range.setStart(last, last.textContent.length);
            range.collapse(true);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
          });
          await page.waitForTimeout(100);
          await page.keyboard.type(" Again.");
          await until(
            page,
            "the typed words to reach the file",
            (rel) => !!window.__prosceniumPeek(rel)?.includes("Again."),
            path,
          );
          const saved = await page.evaluate((rel) => window.__prosceniumPeek(rel), path);
          if (!/^MARA \(V\.O\.\)$/m.test(saved))
            throw new Error("the saved script lost MARA's extension");
          if (saved.includes("(V.O.) (V.O.)"))
            throw new Error("the saved script doubled MARA's extension");
          if (
            !(await page.evaluate(() =>
              [...document.querySelectorAll(".play-page .pl-character")].some(
                (el) => el.textContent === "MARA (V.O.)",
              ),
            ))
          ) {
            throw new Error("MARA's extension left the page after the save");
          }
          await settled();
        } finally {
          await page.evaluate(({ rel, text }) => window.__prosceniumExternalChange(rel, text), {
            rel: path,
            text: original,
          });
          await until(
            page,
            "the sample's own cue to return",
            () =>
              ![...document.querySelectorAll(".play-page .pl-character")].some(
                (el) => el.textContent === "MARA (V.O.)",
              ),
          );
          await page.locator(".seg__btn", { hasText: "Changes" }).first().click();
          await page.waitForSelector(".changes");
          await page.waitForTimeout(300);
          const keep = page.locator(".changes").getByRole("button", { name: "Keep", exact: true });
          for (let n = await keep.count(); n > 0; n = await keep.count()) {
            await keep.first().click();
            await until(
              page,
              "the fixture's review to settle",
              (before) =>
                [...document.querySelectorAll(".changes button")].filter(
                  (button) => button.textContent.trim() === "Keep",
                ).length < before,
              n,
            );
          }
          await page.locator(".seg__btn", { hasText: "Script" }).first().click();
          await page.waitForSelector(".play-page");
        }
      },
    },
    {
      name: "dialog menus and announcements stay in the active modal scope",
      feature: "ui",
      async run(page) {
        await openFromDocumentMenu(page, /Export PDF/);
        await page.waitForSelector(".exportpanel__body");
        const mounted = await page.evaluate(() => {
          const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
          const host = dialog?.querySelector("[data-modal-portal]");
          return (
            !!host?.querySelector('[data-announcer="polite"]') &&
            !!host?.querySelector('[data-announcer="assertive"]')
          );
        });
        if (!mounted) throw new Error("dialog announcers were not mounted before its first action");
        await page.locator(".sheet .popupbtn").first().focus();
        await page.keyboard.press("ArrowDown");
        await page.waitForSelector(".menu");
        if (
          !(await page.evaluate(() =>
            document
              .querySelector('[aria-modal="true"]')
              ?.contains(document.querySelector(".menu")),
          ))
        ) {
          throw new Error("the export popup is outside its dialog accessibility tree");
        }
        await onTop(page, ".menu");
        await audit(page, "popup inside export dialog");
        await page.keyboard.press("Escape");
        if (
          !(await page.locator(".sheet").count()) ||
          !(await page.evaluate(() => document.activeElement?.matches(".popupbtn")))
        ) {
          throw new Error("Escape failed to return from the menu to its sheet control");
        }
        await page.keyboard.press("Escape");
        await page.keyboard.press("Meta+Comma");
        await page.waitForSelector(".prefs");
        await page.locator('.prefs__nav [role="tab"]', { hasText: "Formats" }).click();
        await page.getByRole("button", { name: "Duplicate “Dramatists Guild — Modern”" }).click();
        await page.waitForSelector(".designer");
        await page.locator("#dz-name").fill("Announcement sample");
        try {
          await page.locator('[aria-controls="dz-el-character"]').click();
          await page.locator("#dz-character-indent").fill("3");
          await page.locator("#dz-character-indent").focus();
          await until(page, "the format's effect to speak inside its dialog", () => {
            const modal = document.querySelector(".designer")?.closest('[aria-modal="true"]');
            return /Character moved/.test(
              modal?.querySelector('[data-announcer="polite"]')?.textContent ?? "",
            );
          });
          if ((await focused(page)).id !== "dz-character-indent")
            throw new Error("speaking the preview moved field focus");
          await page.getByRole("button", { name: "Insert into Footer center" }).click();
          await page.waitForSelector(".menu");
          if (
            !(await page.evaluate(() =>
              document
                .querySelector(".designer")
                ?.closest('[aria-modal="true"]')
                ?.contains(document.querySelector(".menu")),
            ))
          ) {
            throw new Error("the token menu escaped the format designer's modal scope");
          }
          await onTop(page, ".menu");
          await page.keyboard.press("Escape");
        } finally {
          await closeDesigner(page);
        }
      },
    },
    {
      // ⏎ on a focused control presses THAT control. It used to run the sheet's
      // default everywhere but a textarea, so ⏎ on Cancel saved.
      name: "keyboard · cancel means cancel",
      feature: "ui",
      async run(page) {
        await openFromDocumentMenu(page, /Edit Opening Pages/);
        await page.waitForSelector("#tp-title", { timeout: 5000 });
        if ((await focused(page)).id !== "tp-title") {
          throw new Error(`Title Page opened with focus on ${(await focused(page)).desc}`);
        }
        await audit(page, "title page sheet");
        const before = await page.locator("#tp-draft").inputValue();
        await page.locator("#tp-draft").fill("SMOKE — must not be saved");
        await page.locator(".sheet__foot .btn", { hasText: "Cancel" }).focus();
        await page.keyboard.press("Enter");
        await page.waitForSelector(".sheet", { state: "detached", timeout: 5000 });
        await openFromDocumentMenu(page, /Edit Opening Pages/);
        await page.waitForSelector("#tp-draft", { timeout: 5000 });
        const after = await page.locator("#tp-draft").inputValue();
        await page.keyboard.press("Escape");
        await page.waitForSelector(".sheet", { state: "detached", timeout: 5000 });
        if (after !== before) throw new Error(`⏎ on Cancel saved the Title Page ("${after}")`);
      },
    },
    {
      // A menu with a field keeps focus in the field: Space types, ↓ picks.
      name: "keyboard · go to scene",
      feature: "app",
      async run(page) {
        await page.locator(".ProseMirror").first().focus();
        await page.keyboard.press("Meta+Shift+KeyJ");
        await page.waitForSelector(".gotoscene__field", { timeout: 5000 });
        if (
          !(await page.evaluate(() =>
            document.activeElement?.classList.contains("gotoscene__field"),
          ))
        ) {
          throw new Error(`Go to Scene opened with focus on ${(await focused(page)).desc}`);
        }
        await page.keyboard.type("a b");
        const value = await page.locator(".gotoscene__field").inputValue();
        if (value !== "a b") throw new Error(`typing "a b" into Go to Scene left "${value}"`);
        await page.keyboard.press("Escape");
        await page.waitForSelector(".gotoscene__field", { state: "detached", timeout: 5000 });

        // No match, then ⏎ and →: the menu stays up and says so, rather than
        // throwing on a row that is not there.
        await page.locator(".ProseMirror").first().focus();
        await page.keyboard.press("Meta+Shift+KeyJ");
        await page.waitForSelector(".gotoscene__field", { timeout: 5000 });
        await page.keyboard.type("zzzz no such scene");
        await page.keyboard.press("Enter");
        await page.keyboard.press("ArrowRight");
        await page.waitForTimeout(100);
        if ((await page.locator(".gotoscene__field").count()) !== 1) {
          throw new Error("⏎ on an empty Go to Scene closed or broke the menu");
        }
        const hint = await page.locator(".menu__hint").first().innerText();
        if (!/No scene matches/i.test(hint)) throw new Error(`the empty state reads "${hint}"`);
        await page.keyboard.press("Escape");
        await page.waitForSelector(".gotoscene__field", { state: "detached", timeout: 5000 });
      },
    },
    {
      name: "Go to Scene connects its combobox to selectable listbox results",
      feature: "app",
      async run(page) {
        await page.locator(".ProseMirror").first().focus();
        await page.keyboard.press("Meta+Shift+KeyJ");
        await page.waitForSelector(".gotoscene__field");
        const relationship = () =>
          page.evaluate(() => {
            const field = document.querySelector(".gotoscene__field");
            const list = document.getElementById(field.getAttribute("aria-controls"));
            const active = document.getElementById(field.getAttribute("aria-activedescendant"));
            return {
              valid:
                field.getAttribute("role") === "combobox" &&
                list?.getAttribute("role") === "listbox" &&
                !list.contains(field) &&
                list.contains(active) &&
                active.getAttribute("role") === "option" &&
                active.getAttribute("aria-selected") === "true",
              id: active?.id,
            };
          });
        const before = await relationship();
        if (!before.valid) throw new Error("Go to Scene has an invalid combobox relationship");
        await page.keyboard.press("ArrowDown");
        const after = await relationship();
        if (!after.valid || before.id === after.id)
          throw new Error("Down did not identify the next option");
        await audit(page, "scene combobox");
        await page.keyboard.press("Enter");
        await page.waitForSelector(".gotoscene__field", { state: "detached" });
        await until(
          page,
          "scene choice to return to the script",
          () => !!document.activeElement?.closest(".ProseMirror"),
        );
      },
    },
    {
      // The element bar's buttons are buttons: ⏎ on one does what a click does
      // (the action lived on mouse-down, so the keyboard got
      // nothing).
      name: "keyboard · element bar",
      feature: "editor",
      async run(page) {
        await page.locator(".ProseMirror").first().focus();
        await page.keyboard.press("Meta+ArrowDown");
        const breaks = () =>
          page.evaluate(() => document.querySelectorAll(".ProseMirror .pl-pageBreak").length);
        const before = await breaks();
        await page.locator(".elementbar__btn", { hasText: "Page Break" }).first().focus();
        await page.keyboard.press("Enter");
        await page.waitForTimeout(150);
        const after = await breaks();
        if (after !== before + 1)
          throw new Error(`⏎ on Page Break made ${after - before} page breaks`);
        await page.locator(".ProseMirror").first().focus();
        await page.keyboard.press("Meta+KeyZ");
        await page.waitForTimeout(150);
        if ((await breaks()) !== before) throw new Error("⌘Z did not take the page break back");
      },
    },
    {
      // Focus mode hides the chrome from the keyboard too:
      // ⌃⇥ used to land on a collapsed, invisible toolbar control.
      name: "keyboard · focus mode",
      feature: "editor",
      async run(page) {
        await page.locator(".ProseMirror").first().focus();
        await page.keyboard.press("Control+Meta+KeyF");
        await page.waitForSelector(".app-shell.is-focus", { timeout: 5000 });
        await page.waitForTimeout(100);
        for (let i = 0; i < 4; i++) {
          await page.keyboard.press("Control+Tab");
          const where = await page.evaluate(() => {
            const el = document.activeElement;
            if (!(el instanceof HTMLElement)) return "nothing";
            const box = el.getBoundingClientRect();
            const collapsed = [
              ...(function* up(n) {
                for (let e = n; e; e = e.parentElement) yield e;
              })(el),
            ].some(
              (a) =>
                a instanceof HTMLElement &&
                a.getBoundingClientRect().height === 0 &&
                a !== document.body,
            );
            return `${el.tagName.toLowerCase()}.${[...el.classList].join(".")}${collapsed || box.height === 0 ? " (collapsed)" : ""}`;
          });
          if (where.includes("(collapsed)")) throw new Error(`⌃⇥ in focus mode landed on ${where}`);
        }
        await page.keyboard.press("Escape");
        await page.waitForSelector(".app-shell.is-focus", { state: "detached", timeout: 5000 });
        await page.locator(".ProseMirror").first().focus();
      },
    },
    {
      // Tab in the script cycles the element, so ⌃⇥ is the way out — without it
      // the page is a keyboard trap.
      name: "keyboard · areas",
      feature: "app",
      async run(page) {
        await page.locator(".ProseMirror").first().focus();
        await page.keyboard.press("Control+Tab");
        const away = await page.evaluate(() => !document.activeElement?.closest(".ProseMirror"));
        if (!away) throw new Error("⌃⇥ left focus in the script");
        await page.keyboard.press("Control+Shift+Tab");
        const back = await page.evaluate(() => !!document.activeElement?.closest(".ProseMirror"));
        if (!back)
          throw new Error(`⌃⇧⇥ did not come back to the script: ${(await focused(page)).desc}`);
      },
    },
    {
      // Filing without a pointer: ⌃⌘↓ moves a binder row, ⌃⌘↑ puts it back.
      name: "keyboard · binder",
      feature: "workspace",
      async run(page) {
        const order = () =>
          page.evaluate(() =>
            [...document.querySelectorAll('.binder [role="treeitem"][aria-level="1"]')].map(
              (r) => r.querySelector(".binder__label")?.textContent ?? "",
            ),
          );
        const before = await order();
        if (before.length < 3) throw new Error(`the binder shows ${before.length} top-level rows`);
        await page.locator(".binder__scroll").focus();
        await page.keyboard.press("Home");
        await page.keyboard.type(before[1]);
        await page.keyboard.press("Control+Meta+ArrowDown");
        await page.waitForTimeout(400);
        const moved = await order();
        if (moved[1] !== before[2] || moved[2] !== before[1]) {
          throw new Error(`⌃⌘↓ did not move "${before[1]}": ${moved.slice(0, 4).join(" · ")}`);
        }
        await page.keyboard.press("Control+Meta+ArrowUp");
        await page.waitForTimeout(400);
        const restored = await order();
        if (restored.join("|") !== before.join("|")) {
          throw new Error(`⌃⌘↑ did not put it back: ${restored.slice(0, 4).join(" · ")}`);
        }
      },
    },
    {
      name: "binder Move files by folder and position without dragging",
      feature: "workspace",
      async run(page) {
        const title = "1953 North Sea Flood";
        const rowId = await page.evaluate(
          (name) =>
            [...document.querySelectorAll(".binder__row")].find(
              (row) => row.querySelector(".binder__label")?.textContent === name,
            )?.dataset.row,
          title,
        );
        if (!rowId) throw new Error("move fixture is missing from the binder");
        const open = async (name) => {
          await page
            .locator(".binder__label", { hasText: new RegExp(`^${name}$`) })
            .first()
            .click();
          await page.getByRole("button", { name: `Actions for “${name}”` }).click();
          await page.getByRole("menuitem", { name: "Move…", exact: true }).click();
          await page.waitForSelector(".binder-move");
        };
        await open(title);
        await page.getByRole("button", { name: /^Folder:/ }).click();
        await page.getByRole("menuitemradio", { name: "Characters", exact: true }).click();
        await page.getByRole("button", { name: /^Position:/ }).click();
        await page.getByRole("menuitemradio", { name: "Before Mara", exact: true }).click();
        await audit(page, "binder Move");
        await page.locator(".sheet__foot .btn", { hasText: /^Move$/ }).click();
        const isFiled = (args) => {
          const row = document.querySelector(`[data-row="${args.id}"]`);
          const list = row?.closest("li")?.parentElement;
          const folder = list?.closest("li")?.querySelector(".binder__label")?.textContent;
          return folder === args.folder && (!args.first || list?.firstElementChild?.contains(row));
        };
        await until(page, "the document before Mara in Characters", isFiled, {
          id: rowId,
          folder: "Characters",
          first: true,
        });
        if (
          !(await page.evaluate(
            (id) => document.activeElement?.closest(`[data-row="${id}"]`) !== null,
            rowId,
          ))
        ) {
          throw new Error("Move did not return focus to the moved binder row");
        }
        await open(title);
        await page.getByRole("button", { name: /^Folder:/ }).click();
        await page.getByRole("menuitemradio", { name: "Research", exact: true }).click();
        await page.locator(".sheet__foot .btn", { hasText: /^Move$/ }).click();
        await until(page, "the document back in Research", isFiled, {
          id: rowId,
          folder: "Research",
          first: true,
        });
        // A folder cannot choose itself or anything below itself.
        await open("Characters");
        await page.getByRole("button", { name: /^Folder:/ }).click();
        if (await page.getByRole("menuitemradio", { name: /^Characters(?:$| \/)/ }).count()) {
          throw new Error("Move offered a folder its own subtree");
        }
        await page.keyboard.press("Escape");
        await page.keyboard.press("Escape");
        await page.locator(".binder__label", { hasText: "The Weight of Water" }).first().click();
        await page.waitForSelector(".play-page");
      },
    },
    {
      name: "binder arrows reach and activate scenes without filing them",
      feature: "workspace",
      async run(page) {
        const sceneIds = await page.evaluate(() =>
          [...document.querySelectorAll(".binder__row--scene")].map((row) => row.id),
        );
        if (sceneIds.length < 2 || sceneIds.some((id) => !id))
          throw new Error("scene rows lack stable identities");
        await page.locator('.binder__row[aria-level="1"]').first().focus();
        for (const id of sceneIds) {
          await page.keyboard.press("ArrowDown");
          if ((await page.evaluate(() => document.activeElement?.id)) !== id)
            throw new Error("the tree skipped a scene");
        }
        await page.keyboard.press("ArrowLeft");
        if (
          await page.evaluate(() =>
            document.activeElement?.classList.contains("binder__row--scene"),
          )
        )
          throw new Error("Left did not return to the script");
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("Delete");
        await page.keyboard.press("F2");
        await page.keyboard.press("Control+Meta+ArrowDown");
        if (await page.locator(".binder__rename").count())
          throw new Error("a scene was offered a file rename");
        const after = await page.evaluate(() =>
          [...document.querySelectorAll(".binder__row--scene")].map((row) => row.id),
        );
        if (after.join("|") !== sceneIds.join("|"))
          throw new Error("file commands changed scene rows");
        await page.keyboard.press("Enter");
        await until(
          page,
          "scene activation to focus the script",
          () => !!document.activeElement?.closest(".ProseMirror"),
        );
        await audit(page, "binder scenes");
      },
    },
    {
      // The window's keys wait for a menu or sheet (docs/app/preferences-and-help/accessibility.md#A11Y-3): ⌘2 used to
      // switch the pane behind the Export sheet. In the app ⌘2 is the menu
      // bar's accelerator, so this presses the menu route there.
      name: "keyboard · window keys wait for a menu or sheet",
      feature: "ui",
      async run(page) {
        const onBoard = () => page.evaluate(() => !!document.querySelector(".board"));
        if (await onBoard()) throw new Error("the board was already showing");
        await openFromDocumentMenu(page, /Export PDF/);
        await page.waitForSelector(".sheet", { timeout: 10000 });
        await page.keyboard.press("Meta+2");
        await page.waitForTimeout(300);
        const underSheet = await onBoard();
        await page.keyboard.press("Escape");
        await page.waitForSelector(".sheet", { state: "detached", timeout: 5000 });

        await page.locator(".doctitle").click();
        await page.waitForSelector(".menu", { timeout: 5000 });
        await page.keyboard.press("Meta+2");
        await page.waitForTimeout(300);
        const underMenu = await onBoard();
        await page.keyboard.press("Escape");
        await page.waitForSelector(".menu", { state: "detached", timeout: 5000 });

        // ⌘/ still closes the overlay it opened, which is itself a layer.
        await page.keyboard.press("Meta+Slash");
        await page.waitForSelector(".keysheet", { timeout: 5000 });
        await page.keyboard.press("Meta+Slash");
        await page.waitForSelector(".keysheet", { state: "detached", timeout: 5000 });

        if (underSheet) throw new Error("⌘2 switched to the board behind the Export sheet");
        if (underMenu) throw new Error("⌘2 switched to the board behind the document menu");
        // With nothing up, the key still does its job.
        await page.keyboard.press("Meta+2");
        await page.waitForSelector(".board", { timeout: 5000 });
        await page.keyboard.press("Meta+1");
        await page.waitForSelector(".play-page", { timeout: 5000 });
      },
    },
    {
      // A key for the last toast's action (docs/app/preferences-and-help/accessibility.md#A11Y-18): after Move to Trash,
      // ⌃⇥ lands on Undo from wherever the writer is, ⏎ undoes it, and focus
      // goes back to the binder it came from. Dev-mock only: in the app it
      // would put a fixture document in the Trash of whoever runs the self-test.
      name: "keyboard · a key reaches Undo",
      feature: "editor",
      devMock: true,
      async run(page) {
        const labels = () =>
          page.evaluate(() =>
            [...document.querySelectorAll(".binder .binder__label")].map((l) => l.textContent),
          );
        const cursorLabel = () =>
          page.evaluate(() => {
            return (
              document.activeElement?.closest('[role="treeitem"]')?.querySelector(".binder__label")
                ?.textContent ?? ""
            );
          });
        await page.locator(".binder__scroll").focus();
        await page.keyboard.press("Home");
        await page.keyboard.type("Loglines");
        await page.waitForTimeout(150);
        for (let i = 0; i < 4 && (await cursorLabel()) !== "Logline"; i++) {
          await page.keyboard.press(
            (await cursorLabel()) === "Loglines" ? "ArrowRight" : "ArrowDown",
          );
          await page.waitForTimeout(120);
        }
        if ((await cursorLabel()) !== "Logline") {
          throw new Error(
            `could not reach the Logline document: cursor on "${await cursorLabel()}"`,
          );
        }
        await page.keyboard.press("Delete");
        await page.waitForSelector(".toast [data-toast-action]", { timeout: 5000 });
        const trashed = !(await labels()).includes("Logline");
        await audit(page, "undo toast");
        await page.keyboard.press("Control+Tab");
        const onUndo = await page.evaluate(
          () => document.activeElement?.hasAttribute("data-toast-action") ?? false,
        );
        await page.keyboard.press("Enter");
        await until(page, "Logline to come back", () =>
          [...document.querySelectorAll(".binder .binder__label")].some(
            (l) => l.textContent === "Logline",
          ),
        );
        const backInBinder = await page.evaluate(
          () => !!document.activeElement?.closest(".binder"),
        );
        if (!trashed) throw new Error("Delete did not move Logline to the Trash");
        if (!onUndo)
          throw new Error(`⌃⇥ with an Undo toast up went to ${(await focused(page)).desc}`);
        if (!backInBinder)
          throw new Error(`after Undo, focus was on ${(await focused(page)).desc}`);
      },
    },
    {
      // A misspelling is reachable from the keyboard: ⌘; selects it and opens
      // its corrections on the shared menu, with focus on a suggestion. The
      // menu goes when the page moves under it, and not for a scroll event
      // that moved nothing: the typing's own scroll event, delivered a frame
      // late on a busy machine, used to shut it as it opened.
      name: "keyboard · spelling",
      feature: "spell",
      async run(page) {
        await page.locator(".ProseMirror").first().focus();
        await page.keyboard.press("Meta+ArrowDown");
        await page.keyboard.type(" wrold");
        await page.waitForSelector(".pl-misspelled", { timeout: 10000 });
        await page.keyboard.press("Meta+Home");
        await page.keyboard.press("Meta+Semicolon");
        await page.waitForSelector(".menu", { timeout: 5000 });
        await audit(page, "spelling menu");
        const row = await focused(page);
        if (!/^menuitem/.test(row.role ?? "")) {
          throw new Error(`the spelling menu opened with focus on ${row.desc}`);
        }
        const scrollScript = (by) =>
          page.evaluate((px) => {
            const pane = document.querySelector(".ProseMirror")?.closest(".pane__body");
            if (!pane) throw new Error("no scroller around the script");
            pane.scrollTop -= px;
            pane.dispatchEvent(new Event("scroll"));
          }, by);
        await scrollScript(0);
        await page.waitForTimeout(150);
        if (!(await page.locator(".menu").count())) {
          throw new Error("a scroll event that moved nothing shut the spelling menu");
        }
        await page.keyboard.press("Escape");
        await page.waitForSelector(".menu", { state: "detached", timeout: 5000 });
        const back = await page.evaluate(() => !!document.activeElement?.closest(".ProseMirror"));
        if (!back) throw new Error("closing the spelling menu did not return to the script");
        await page.keyboard.press("Meta+Semicolon");
        await page.waitForSelector(".menu", { timeout: 5000 });
        await scrollScript(120);
        await page.waitForSelector(".menu", { state: "detached", timeout: 5000 });
        // Take the typing back out, so the checks after this read the fixture.
        await page.locator(".ProseMirror").first().focus();
        for (let i = 0; i < 3; i++) await page.keyboard.press("Meta+KeyZ");
      },
    },
    {
      // A sigil belongs to a LINE (docs/app/writing/editor-ux.md#EDIT-D111): `@` typed after
      // ⇧⏎ starts a forced cue there. It used to stay a literal at sign.
      name: "keyboard · sigil after a soft break",
      feature: "editor",
      async run(page) {
        const blocks = () =>
          page.evaluate(() =>
            [...document.querySelectorAll(".ProseMirror [data-pl]")].map(
              (b) => `${b.getAttribute("data-pl")}:${b.textContent}`,
            ),
          );
        const before = await blocks();
        await page.locator(".ProseMirror").first().focus();
        // Establish the fixture's caret explicitly. This check exercises the
        // real Shift+Enter and typed sigil, not an OS end-of-document gesture
        // whose async selectionchange can race a preceding menu restoration.
        await page.evaluate(() => {
          const editor = document.querySelector(".ProseMirror")?.editor;
          if (!editor) throw new Error("script editor unavailable");
          editor.commands.setTextSelection(editor.state.doc.content.size - 1);
        });
        await page.keyboard.press("Shift+Enter");
        await page.keyboard.type("@Sam");
        await page.waitForTimeout(300);
        const after = await blocks();
        await page.keyboard.press("Escape"); // the cue autocomplete, if it opened
        for (let i = 0; i < 8 && (await blocks()).join("|") !== before.join("|"); i++) {
          await page.keyboard.press("Meta+KeyZ");
          await page.waitForTimeout(60);
        }
        const tail = after.slice(-2).join(" · ");
        if (after[after.length - 1] !== "character:Sam") {
          throw new Error(`@ after a soft break left ${tail}, expected a cue reading "Sam"`);
        }
        if (after.some((b) => b.includes("@Sam")))
          throw new Error(`the sigil was typed as text: ${tail}`);
        if ((await blocks()).join("|") !== before.join("|")) {
          throw new Error("undo did not take the cue back out");
        }
      },
    },
    {
      // Replace leaves comments alone and says so (docs/app/writing/comments.md#COMM-D9) — and the find
      // bar, which smoke never opened before, gets its accessibility scan.
      name: "find · replace leaves comments alone",
      feature: "editor",
      async run(page) {
        const script = () =>
          page.evaluate(() => document.querySelector(".ProseMirror")?.textContent ?? "");
        const before = await script();
        await page.locator(".ProseMirror").first().focus();
        await page.keyboard.press("Meta+ArrowDown");
        await page.keyboard.type(" Tide. [[tide on the stair]]");
        await page.waitForSelector(".ProseMirror .pl-note", { state: "attached", timeout: 5000 });
        await page.keyboard.press("Meta+Alt+KeyF");
        await page.waitForSelector(".findbar__field", { timeout: 5000 });
        await page.locator('.findbar__field[aria-label="Find"]').fill("tide");
        await page.waitForSelector(".findbar__note", { timeout: 5000 });
        const note = await page.locator(".findbar__note").innerText();
        // The inspector counts the scene's comments when the app next draws
        // after the edit, not at once: wait for it to count the one just
        // typed, so the surface is audited in one state whenever it is read
        // (in both schemes, the dark reading comes a moment later). Where the
        // window is too narrow for the inspector, there is nothing to wait for.
        await until(page, "the inspector to count the comment just typed", () => {
          const label = [...document.querySelectorAll(".insp__group .seclabel")].find(
            (l) => l.textContent === "Comments here",
          );
          return (
            !label ||
            /^1 in this scene/.test(
              label.parentElement?.querySelector(".insp__row span")?.textContent ?? "",
            )
          );
        });
        await audit(page, "find bar");
        if (!/1 in a comment — left alone/.test(note)) {
          throw new Error(`the find bar said "${note}", not that it left a comment alone`);
        }
        await page.locator('.findbar__field[aria-label="Replace with"]').fill("Ebb");
        await page.locator(".findbar__btn", { hasText: "Replace All" }).click();
        await page.waitForTimeout(200);
        const replaced = await script();
        await page.locator(".findbar__close").click();
        await page.locator(".ProseMirror").first().focus();
        for (let i = 0; i < 10 && (await script()) !== before; i++) {
          await page.keyboard.press("Meta+KeyZ");
          await page.waitForTimeout(60);
        }
        if (!replaced.includes("Ebb.") || !replaced.includes("tide on the stair")) {
          throw new Error(
            `Replace All left "${replaced.slice(-40)}" — the script should read Ebb, the comment tide`,
          );
        }
        if ((await script()) !== before) throw new Error("undo did not restore the script");
      },
    },
    {
      name: "comment actions retain focus and announce the remaining count",
      feature: "comments",
      async run(page) {
        const hadInspector = (await page.locator(".inspector").count()) > 0;
        const hadBinder = (await page.locator(".binder").count()) > 0;
        if (hadInspector) await page.locator('.iconbtn[aria-label*="inspector" i]').click();
        // The margin deliberately stands down when the desk is narrow.
        // Give this fixture room to exercise the margin before the feed: the
        // side panels closed, and smoke's width. The app's own window opens
        // narrower, 1100 wide, where the margin stands down even so.
        if (hadBinder) await page.locator('.iconbtn[aria-label*="binder" i]').click();
        const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
        if (size.width < 1280)
          await page.setViewportSize({ width: 1280, height: Math.max(size.height, 800) });
        await page.locator(".ProseMirror").first().focus();
        await page.keyboard.press("Meta+ArrowDown");
        await until(page, "the editor selection at the end", () => {
          const editor = document.querySelector(".ProseMirror")?.editor;
          return editor && editor.state.selection.to === editor.state.doc.content.size - 1;
        });
        await page.keyboard.type(" First [[A607 first]] Second [[A607 second]]");
        await page.waitForSelector(".comment-card", { timeout: 10000 });
        const expectAction = async (action, count, scope, id) => {
          await until(
            page,
            "comment focus to return",
            ({ scope, id }) => {
              const active = document.activeElement;
              return id
                ? active?.getAttribute("aria-label") === "Edit comment" &&
                    active.closest("[data-comment-id]")?.getAttribute("data-comment-id") === id
                : !!active?.matches(`${scope} [data-comment-fallback]`);
            },
            { scope, id },
          );
          // A delayed element-kind announcement must not overwrite the result
          // after focus has returned to the comment's Edit control.
          await page.waitForTimeout(300);
          await until(
            page,
            `${action}, ${count} remaining, to be announced`,
            ({ action, count }) =>
              [...document.querySelectorAll('[data-announcer="polite"]')].some(
                (el) =>
                  el.textContent ===
                  `${action}. ${count} comment${count === 1 ? "" : "s"} remaining.`,
              ),
            { action, count },
          );
        };
        // Margin Save and Cancel return to the same comment's Edit control.
        let row = page.locator(".comment-card", { hasText: "A607 first" }).first();
        const firstId = await row.getAttribute("data-comment-id");
        let scope = ".comments-margin",
          currentId = firstId;
        await page
          .locator(`${scope} [data-comment-id="${currentId}"] button[aria-label="Edit comment"]`)
          .click();
        await page
          .locator(`${scope} [data-comment-id="${currentId}"] textarea`)
          .fill("A607 first edited");
        await page
          .locator(`${scope} [data-comment-id="${currentId}"] button`, { hasText: /^Save$/ })
          .click();
        await expectAction("Comment saved", 2, ".comments-margin", firstId);
        await page
          .locator(`${scope} [data-comment-id="${currentId}"] button[aria-label="Edit comment"]`)
          .click();
        await page.keyboard.press("Escape");
        await expectAction("Comment edit cancelled", 2, ".comments-margin", firstId);
        const secondId = await page
          .locator(".comment-card", { hasText: "A607 second" })
          .first()
          .getAttribute("data-comment-id");
        await page
          .locator(`${scope} [data-comment-id="${currentId}"] button[aria-label="Resolve comment"]`)
          .click();
        await expectAction("Comment resolved", 1, ".comments-margin", secondId);
        await audit(page, "comment margin");
        // The feed uses the same identities and has a durable final destination.
        await page.keyboard.press("Meta+Shift+KeyC");
        await page.waitForSelector(".commentsfeed");
        scope = ".commentsfeed";
        currentId = secondId;
        await page
          .locator(`${scope} [data-comment-id="${currentId}"] button[aria-label="Edit comment"]`)
          .click();
        await page.keyboard.press("Escape");
        await expectAction("Comment edit cancelled", 1, ".commentsfeed", secondId);
        await page
          .locator(`${scope} [data-comment-id="${currentId}"] button[aria-label="Edit comment"]`)
          .click();
        await page
          .locator(`${scope} [data-comment-id="${currentId}"] textarea`)
          .fill("A607 second edited");
        await page
          .locator(`${scope} [data-comment-id="${currentId}"] button`, { hasText: /^Save$/ })
          .click();
        await expectAction("Comment saved", 1, ".commentsfeed", secondId);
        await page
          .locator(`${scope} [data-comment-id="${currentId}"] button[aria-label="Resolve comment"]`)
          .click();
        await expectAction("Comment resolved", 0, ".commentsfeed", null);
        await audit(page, "empty comments feed");
        await page.keyboard.press("Meta+Shift+KeyC");
        // Restore the exact script in one undo history walk.
        await page.locator(".ProseMirror").first().focus();
        for (let i = 0; i < 20; i++) {
          if (
            !(await page.evaluate(() =>
              /A607| First | Second /.test(
                document.querySelector(".ProseMirror")?.textContent ?? "",
              ),
            ))
          )
            break;
          await page.keyboard.press("Meta+KeyZ");
          await page.waitForTimeout(60);
        }
        if (size.width < 1280) await page.setViewportSize(size);
        if (hadBinder) await page.locator('.iconbtn[aria-label*="binder" i]').click();
        if (hadInspector) await page.locator('.iconbtn[aria-label*="inspector" i]').click();
      },
    },
    {
      // What the line IS reaches a screen reader: Enter's guess and a Tab through
      // the ring are each spoken through the announcer's polite region.
      name: "screen reader · element kind",
      feature: "editor",
      async run(page) {
        const said = () =>
          page.evaluate(
            () => document.querySelector('[data-announcer="polite"]')?.textContent ?? "",
          );
        const kinds =
          /^(Act|Scene|Scene Heading|Action|Character|Parenthetical|Dialogue|Transition|Lyric|Centered Text|Scene Summary \(Not Printed\)|Comment)$/;
        await page.locator(".ProseMirror").first().focus();
        await page.keyboard.press("Meta+ArrowDown");
        // The announcer speaks once the guess has settled, and how long that takes
        // is the machine's: wait for the words, never for a fixed half second.
        const spoken = async (unlike) => {
          try {
            return await until(
              page,
              "an element kind to be announced",
              ({ source, unlike }) => {
                const text = document.querySelector('[data-announcer="polite"]')?.textContent ?? "";
                return new RegExp(source).test(text) && text !== unlike ? text : null;
              },
              { source: kinds.source, unlike },
              5000,
            );
          } catch {
            return { missed: await said() };
          }
        };
        // Words an earlier check left in the region must not stand in for Enter's.
        await page.evaluate(() => {
          const region = document.querySelector('[data-announcer="polite"]');
          if (region) region.textContent = "";
        });
        await page.keyboard.press("Enter");
        const first = await spoken(null);
        // A character first: Tab on an EMPTY line opens the element menu
        // (docs/app/writing/editor-ux.md#EDIT-58), which speaks its alphabet instead of a kind.
        await page.keyboard.type("x");
        await page.keyboard.press("Tab");
        const second = await spoken(first);
        for (let i = 0; i < 4; i++) await page.keyboard.press("Meta+KeyZ");
        if (typeof first !== "string")
          throw new Error(`Enter announced "${first.missed}", not an element kind`);
        if (typeof second !== "string")
          throw new Error(`Tab announced "${second.missed}" after "${first}"`);
      },
    },
    {
      // What VoiceOver is given, asked of the accessibility tree itself
      // (docs/app/preferences-and-help/accessibility.md#A11Y-19, docs/app/preferences-and-help/accessibility.md#A11Y-16):
      // Playwright's in smoke, WebKit's own in the native self-test. The script
      // is a text box whose value is what was just typed, and a kind announced
      // through ui/announce.ts is the live region's words in the tree, not only
      // in the DOM.
      name: "accessibility tree · the script is a text box that follows typing, and says the kind",
      feature: "editor",
      async run(page) {
        const editor = page.locator(".editor-surface .ProseMirror").first();
        const before = await editor.innerText();
        await editor.focus();
        await page.keyboard.press("Meta+ArrowDown");
        await page.waitForTimeout(100);
        await page.keyboard.press("Enter");
        await page.keyboard.type("Zephyrine");
        try {
          const tree = await editor.ariaSnapshot();
          if (!/^- textbox "[^"]+"/.test(tree))
            throw new Error(
              `the script is not a named text box in the tree: ${tree.split("\n")[0]}`,
            );
          // WebKit's tree holds the text box's words (the native self-test).
          // Playwright's snapshot gives an editable element no value at all —
          // it keeps only CSS content — so in smoke the words are read from
          // the element that is the text box.
          const native = await page.evaluate(() => !!window.__TAURI_INTERNALS__);
          const value = native ? tree : await editor.innerText();
          if (!value.includes("Zephyrine"))
            throw new Error(
              `the script's text box does not hold what was typed: ${(native ? tree.split("\n")[0] : value).slice(-160)}`,
            );

          await page.evaluate(() => {
            const region = document.querySelector('[data-announcer="polite"]');
            if (region) region.textContent = "";
          });
          await page.keyboard.press("Tab");
          const kind = await until(
            page,
            "the new kind to be announced",
            () => document.querySelector('[data-announcer="polite"]')?.textContent || null,
            undefined,
            5000,
          );
          const region = await page.locator('[data-announcer="polite"]').first().ariaSnapshot();
          if (!/^- status\b/.test(region) || !region.includes(kind)) {
            throw new Error(
              `"${kind}" was announced, but the live region reads ${JSON.stringify(region)} in the tree`,
            );
          }
        } finally {
          for (let i = 0; i < 10 && (await editor.innerText()) !== before; i++) {
            await page.keyboard.press("Meta+KeyZ");
            await page.waitForTimeout(60);
          }
        }
        if ((await editor.innerText()) !== before)
          throw new Error("undo did not put the script back as it was");
      },
    },
    {
      // Where Tab goes, in order, as the tree names each stop
      // (docs/app/preferences-and-help/accessibility.md#A11Y-19): through the Settings sheet until it
      // comes back round (docs/app/preferences-and-help/accessibility.md#A11Y-5 keeps it inside), held
      // against a checked-in list. WebKit's Tab reaches fewer controls than
      // Chromium's while the Mac's Keyboard Navigation is off, so each engine's
      // order is its own file where they differ.
      name: "accessibility tree · focus order under Tab",
      feature: "app",
      async run(page) {
        await page.keyboard.press("Meta+Comma");
        await page.waitForSelector(".prefs", { timeout: 5000 });
        await page.locator('.prefs__nav [role="tab"]', { hasText: "General" }).click();
        const stops = [];
        const stop = () =>
          page.evaluate(() => {
            const el = document.activeElement;
            if (!el || el === document.body) return "(nothing)";
            const role =
              el.getAttribute("role") ??
              {
                BUTTON: "button",
                A: "link",
                INPUT: el.type === "checkbox" ? "checkbox" : "textbox",
                SELECT: "combobox",
                TEXTAREA: "textbox",
              }[el.tagName] ??
              el.localName;
            const labelled = el
              .getAttribute("aria-labelledby")
              ?.split(/\s+/)
              .map((id) => document.getElementById(id)?.textContent ?? "")
              .join(" ");
            const name = (
              el.getAttribute("aria-label") ||
              labelled ||
              el.labels?.[0]?.textContent ||
              el.textContent ||
              ""
            )
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 60);
            return `${role} "${name}"`;
          });
        stops.push(await stop());
        for (let i = 0; i < 30; i++) {
          await page.keyboard.press("Tab");
          // A Tab WebKit moves to <body> comes back on the next frame (ui/Sheet.tsx).
          await until(
            page,
            "focus back inside the sheet",
            () => !!document.activeElement?.closest(".sheet"),
            undefined,
            1000,
          ).catch(() => {});
          const here = await stop();
          if (here === stops[0]) break;
          stops.push(here);
        }
        if (
          !(await page.evaluate(() =>
            document.querySelector(".sheet")?.contains(document.activeElement),
          ))
        ) {
          throw new Error(`Tab left the Settings sheet: ${stops.at(-1)}`);
        }
        await hold(page, "focus order · settings", stops.map((s) => `- ${s}`).join("\n"));
        await page.keyboard.press("Escape");
        await page.waitForSelector(".sheet", { state: "detached", timeout: 5000 });
      },
    },
    {
      name: "caret popups activate with clicks and conventional menu keys",
      feature: "editor",
      async run(page) {
        const before = await page.locator(".ProseMirror").first().innerText();
        await page.locator(".ProseMirror").first().focus();
        await page.keyboard.press("Meta+ArrowDown");
        await page.waitForTimeout(100);
        await page.keyboard.press("Enter");
        await page.keyboard.press("Escape");
        await page.keyboard.press("Meta+Alt+KeyA");
        await page.keyboard.type(";");
        await page.waitForSelector('.pl-elementmenu [role="menuitem"]');
        await page.keyboard.press("Home");
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("ArrowDown");
        if (!(await focused(page)).text.includes("Dialogue"))
          throw new Error("menu arrows did not focus Dialogue");
        await audit(page, "semicolon menu");
        await page.keyboard.press("Enter");
        if (
          !(await page.evaluate(
            () =>
              document.querySelector(".ProseMirror").editor.state.selection.$from.parent.type
                .name === "dialogue" && document.activeElement?.matches(".ProseMirror"),
          ))
        ) {
          throw new Error("Enter did not choose Dialogue and return to the script");
        }
        await page.keyboard.type(";");
        await page.waitForSelector('.pl-elementmenu [role="menuitem"]');
        // A click with no preceding mouse-down is how assistive activation can arrive.
        await page.evaluate(() => document.querySelector('.pl-elementmenu [data-key="c"]').click());
        await page.waitForSelector('.pl-autocomplete [role="option"]');
        const selected = await page.evaluate(() => {
          const owner = document.querySelector(".ProseMirror");
          const list = document.getElementById(owner.getAttribute("aria-controls"));
          const item = document.getElementById(owner.getAttribute("aria-activedescendant"));
          return (
            document.activeElement === owner &&
            list?.getAttribute("role") === "listbox" &&
            list.contains(item) &&
            item?.getAttribute("aria-selected") === "true"
          );
        });
        if (!selected)
          throw new Error("character suggestions are not linked to the focused script");
        await page.keyboard.press("ArrowDown");
        await audit(page, "character suggestions");
        const candidate = await page.locator('.pl-autocomplete [aria-selected="true"]').innerText();
        await page.evaluate(() =>
          document.querySelector('.pl-autocomplete [aria-selected="true"]').click(),
        );
        if (
          !(await page.evaluate(
            (name) =>
              document.querySelector(".ProseMirror").editor.state.selection.$from.parent
                .textContent === name,
            candidate,
          ))
        ) {
          throw new Error("synthetic click did not insert the selected character");
        }
        await page.keyboard.press("Escape");
        if (await page.locator(".ProseMirror[aria-activedescendant]").count())
          throw new Error("dismissed suggestion left a stale active descendant");
        // Unrecognized printable keys still type the withheld semicolon and key.
        await page.keyboard.press("Enter");
        await page.keyboard.type(";x");
        if (
          !(await page.evaluate(
            () =>
              document.querySelector(".ProseMirror").editor.state.selection.$from.parent
                .textContent === ";x",
          ))
        ) {
          throw new Error("literal semicolon fallthrough lost a typed key");
        }
        for (
          let i = 0;
          i < 20 && (await page.locator(".ProseMirror").first().innerText()) !== before;
          i++
        ) {
          await page.keyboard.press("Meta+KeyZ");
          await page.waitForTimeout(60);
        }
        await page.keyboard.press("Escape");
        if ((await page.locator(".ProseMirror").first().innerText()) !== before)
          throw new Error("caret popup smoke did not restore the script");
      },
    },
    // Guided tutorials (docs/app/preferences-and-help/tutorials.md): the guide is a card AT the work, it
    // notices results and wrong turns by itself, and every lesson writes one play.
    {
      name: "tutorials · the guide shows where to type, catches a wrong turn and moves on by itself",
      feature: "tutorial",
      async run(page) {
        await walkIntoPlay(page);
        await page.keyboard.press("Meta+Digit1");
        await page.keyboard.press("Meta+s");
        await until(page, "personal writing saved before practice", () =>
          document.querySelector(".savestatus")?.textContent.startsWith("Saved"),
        );
        const original = await scriptLines(page);
        const personalFiles = await page.evaluate(() =>
          window.__prosceniumStoreKeys
            ? JSON.stringify(
                window
                  .__prosceniumStoreKeys()
                  .filter((k) => k.endsWith(".fountain"))
                  .map((k) => [k, window.__prosceniumPeekKey(k)]),
              )
            : null,
        );
        const personalZoom = await page.evaluate(() => localStorage.getItem("proscenium:zoomMode"));
        await recordAnnouncements(page);
        await tutorialStart(page, "Write Your First Exchange");
        // No panel of instructions: one card, beside the line to type on.
        if (await page.locator(".help-panel, aside.help-panel").count())
          throw new Error("a Help panel came back");
        await cueStep(page, 1, 5);
        await until(
          page,
          "the empty line shows what to type",
          () =>
            document.querySelector(".editor-surface .tutorial-line .tutorial-ghost__text")
              ?.textContent === "MARA" &&
            document
              .querySelector(".editor-surface .tutorial-line .tutorial-ghost__key")
              ?.textContent.includes("Return"),
        );
        await beside(page, "the lit line");
        if (
          !(await page.evaluate(() =>
            document.activeElement?.matches(".editor-surface .ProseMirror"),
          ))
        )
          throw new Error("the lesson did not put the cursor on the line to type on");
        await announced(page, "Write Your First Exchange, step 1 of 5");
        await audit(page, "tutorial · type here");
        // A lowercase name is caught as it is typed, and again where it landed after Return.
        await page.keyboard.type("mara");
        await cueTone(page, "fix");
        await cueSays(page, "capitals");
        await audit(page, "tutorial · a correction");
        await page.keyboard.press("Enter");
        await cueSays(page, "became a stage direction");
        await beside(page, "the mistaken line");
        await page
          .locator(".tutorial-cue")
          .getByRole("button", { name: "Make It a Name", exact: true })
          .click();
        // The fix makes the result the step wanted, and the guide moves on by itself.
        await cueStep(page, 2, 5);
        await until(
          page,
          "the speech line shows its suggestion",
          () =>
            document.querySelector(".editor-surface .tutorial-line .tutorial-ghost__text")
              ?.textContent === "You're early.",
        );
        await scriptFocused(page);
        await page.keyboard.type("You're early.");
        await page.keyboard.press("Enter");
        await cueStep(page, 3, 5);
        // Moving on never takes the keyboard from the page.
        await noFocusTheft(page);
        // Pages added above the script as it grows (the Characters page) push the new line down;
        // brought back, it keeps the exchange before it in view, not under the toolbar.
        await until(page, "the exchange so far in view above the new line", () => {
          const bar = document.querySelector(".elementbar")?.getBoundingClientRect();
          const cue = [...document.querySelectorAll('.editor-surface [data-pl="character"]')]
            .find((n) => n.textContent === "MARA")
            ?.getBoundingClientRect();
          const lit = document
            .querySelector(".editor-surface .tutorial-line")
            ?.getBoundingClientRect();
          return !!bar && !!cue && !!lit && cue.top >= bar.bottom && lit.bottom <= innerHeight;
        });
        await until(page, "the line-type menu is ringed", () => {
          const r = document.querySelector(".tutorial-ring");
          const t = document.querySelector('[data-tutorial="line-type"]')?.getBoundingClientRect();
          return (
            !!r &&
            getComputedStyle(r).display !== "none" &&
            !!t &&
            Math.abs(r.getBoundingClientRect().left - (t.left - 3)) < 2
          );
        });
        await beside(page, "the line-type menu");
        await page.locator(".elementbar__what").click();
        await cueSays(page, "Choose Character");
        await beside(page, "the Character row");
        await audit(page, "tutorial · inside a menu");
        await page.getByRole("menuitemradio", { name: /^Character(?:\s|$)/ }).click();
        await until(
          page,
          "the cue line shows its suggestion",
          () =>
            document.querySelector(".editor-surface .tutorial-line .tutorial-ghost__text")
              ?.textContent === "IVO",
        );
        await until(page, "script has keyboard focus", () =>
          document.activeElement?.matches(".editor-surface .ProseMirror"),
        );
        await page.keyboard.type("IVO");
        await page.keyboard.press("Enter");
        await cueStep(page, 4, 5);
        await page.keyboard.type("Only by a minute.");
        // The reply needs no Return: after a pause in the typing, the guide goes to the save indicator.
        await cueStep(page, 5, 5);
        await cueSays(page, "Saved");
        await beside(page, "the save indicator");
        await page
          .locator(".tutorial-cue")
          .getByRole("button", { name: "Finish Lesson", exact: true })
          .click();
        await until(page, "lesson finished", () =>
          document.querySelector(".tutorial-cue")?.textContent.includes("Lesson finished"),
        );
        await audit(page, "tutorial · lesson finished");
        const firstPlay = (await tutorialProgress(page)).course.id;
        // The next lesson picks up in the same play, where this one left it.
        await page
          .locator(".tutorial-cue")
          .getByRole("button", { name: "Next Lesson", exact: true })
          .click();
        await cueStep(page, 1, 4);
        if ((await tutorialProgress(page)).course.id !== firstPlay)
          throw new Error("the next lesson opened another play");
        if (!(await scriptLines(page)).includes("Only by a minute."))
          throw new Error("the next lesson lost the exchange it continues");
        await tutorialStop(page);
        await until(
          page,
          "original script restored",
          (text) =>
            JSON.stringify(
              [...document.querySelectorAll(".editor-surface [data-pl]")].map((n) => [
                n.dataset.pl,
                n.textContent,
              ]),
            ) === text,
          original,
        );
        if (
          personalFiles !== null &&
          (await page.evaluate(() =>
            JSON.stringify(
              window
                .__prosceniumStoreKeys()
                .filter((k) => k.endsWith(".fountain"))
                .map((k) => [k, window.__prosceniumPeekKey(k)]),
            ),
          )) !== personalFiles
        )
          throw new Error("Practice wrote to a personal script");
        if (
          (await page.evaluate(() => localStorage.getItem("proscenium:zoomMode"))) !== personalZoom
        )
          throw new Error("Practice changed the personal zoom preference");
      },
    },
    {
      name: "tutorials · every lesson, by hand, continues the same play",
      feature: "tutorial",
      async run(page) {
        await tutorialStart(page, "Format the Script");
        const play = (await tutorialProgress(page)).course.id;
        // Format the Script: the exchange from the first lesson, selected with the keyboard.
        await cueStep(page, 1, 4);
        await page.locator('.editor-surface [data-pl="dialogue"]').first().click();
        await page.keyboard.press("Home");
        for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowRight");
        await until(page, "Bold is pointed at", () =>
          document.querySelector(".tutorial-cue__say")?.textContent.includes("Bold"),
        );
        await beside(page, "Bold");
        await page.locator('[data-tutorial="bold"]').click();
        await cueStep(page, 2, 4);
        await page.locator('.editor-surface [data-pl="dialogue"]').first().click();
        await page.keyboard.press("End");
        await page.locator('[data-tutorial="line-break"]').click();
        await cueStep(page, 3, 4);
        await page.locator('[data-tutorial="page-break"]').click();
        await cueStep(page, 4, 4);
        await page.locator('[data-tutorial="document-menu"]').click();
        await cueSays(page, "Choose another format");
        await page.locator('.menu [data-menu-id^="format:"][aria-checked="false"]').first().click();
        await lessonFinished(page);
        await nextLesson(page);
        // Arrange Scenes on the Board.
        await cueStep(page, 1, 5);
        await page.locator('.viewswitch [data-seg="corkboard"]').click();
        await cueStep(page, 2, 5);
        await beside(page, "New Scene");
        await page.locator('[data-tutorial="new-scene"]').click();
        await cueStep(page, 3, 5);
        await page
          .locator('[data-tutorial-card="1"] [data-tutorial="scene-summary"]')
          .fill("The last visitor arrives.");
        await page.locator(".tutorial-cue__say").click();
        await cueStep(page, 4, 5);
        await beside(page, "Move Earlier on the new scene");
        await page.locator('[data-tutorial-card="1"] [data-tutorial="scene-move"]').click();
        await cueStep(page, 5, 5);
        await page.locator('.viewswitch [data-seg="outliner"]').click();
        await lessonFinished(page);
        await nextLesson(page);
        // Characters and Opening Pages.
        await cueStep(page, 1, 4);
        await page.locator('.viewswitch [data-seg="cast"]').click();
        await cueStep(page, 2, 4);
        await page.locator('[data-tutorial="characters-page"] .ProseMirror').click();
        await page.keyboard.press("Meta+ArrowDown");
        await page.keyboard.type(" Old friends.");
        await cueStep(page, 3, 4);
        await settledOn(page, '[data-tutorial="add-character"]', "Add Character");
        await page.locator('[data-tutorial="add-character"]').click();
        await until(page, "the new name has focus", () =>
          document.activeElement?.matches('[data-tutorial="character-name"]'),
        );
        await cueSays(page, "Type a name");
        await page.keyboard.type("ROWAN");
        await page.locator(".tutorial-cue__say").click();
        await cueStep(page, 4, 4);
        await page.locator('[data-tutorial="document-menu"]').click();
        await page.locator('.menu [data-menu-id="opening-pages"]').click();
        await page.waitForSelector(".modal-scrim .tutorial-cue");
        await beside(page, "the opening notes, inside the sheet");
        await audit(page, "tutorial · inside a sheet");
        await page.locator('.sheet [data-tutorial="opening-notes"] .ProseMirror').click();
        await page.keyboard.type("A quiet room. Early morning.");
        await until(page, "Save is pointed at", () =>
          document.querySelector(".modal-scrim .tutorial-cue__say")?.textContent.includes("Save"),
        );
        await page.locator('[data-tutorial="opening-save"]').click();
        await lessonFinished(page);
        await nextLesson(page);
        // Organize Files and Tags.
        await cueStep(page, 1, 4);
        await page.locator('[data-tutorial="binder-new"]').click();
        await page.locator('.menu [data-menu-id="new:document"]').click();
        await cueStep(page, 2, 4);
        // The guide brings the note's page into view once, as it first points
        // at it. In a pane shorter than the page (the app's own 1100×760
        // window) that aligns the page's top with the pane's and leaves the
        // first line under the format bar. The native click scrolls its target
        // into view once, so a click sent before the guide's scroll was
        // scrolled back under the bar and met .fmt__btn (CI run 35936208466).
        await beside(page, "the new note");
        await still(page, ".material .ProseMirror");
        await page.locator(".material .ProseMirror").click();
        await page.keyboard.type("Remember the sound of the rain.");
        await page.keyboard.press("Meta+s");
        await cueStep(page, 3, 4);
        await page.locator('[data-tutorial="material-tags"]').click();
        await page.locator('[data-tutorial="tag-field"]').fill("rehearsal");
        await page.keyboard.press("Enter");
        await cueStep(page, 4, 4);
        await page.locator('[data-tutorial="material-name"]').fill("Rehearsal Notes");
        await page.keyboard.press("Enter");
        await lessonFinished(page);
        await nextLesson(page);
        // Prepare a PDF or Print: inside the export sheet, finished without a file.
        await cueStep(page, 1, 4);
        await page.locator('[data-tutorial="document-menu"]').click();
        await page.locator('.menu [data-menu-id="export-pdf"]').click();
        await cueStep(page, 2, 4);
        await page.waitForSelector(".modal-scrim .tutorial-cue");
        await page.getByRole("textbox", { name: "Pages to export", exact: true }).fill("1");
        await cueStep(page, 3, 4);
        await page.locator('.exportpanel__front [role="checkbox"]').first().click();
        await cueStep(page, 4, 4);
        await page
          .locator(".modal-scrim .tutorial-cue")
          .getByRole("button", { name: "Finish at Preview", exact: true })
          .click();
        await page.waitForSelector(".sheet", { state: "detached" });
        await until(page, "the course is finished", () =>
          document.querySelector(".tutorial-cue")?.textContent.includes("That's the whole course"),
        );
        // One play holds every lesson's work, and the guide recorded each step as the writer's own.
        const progress = await tutorialProgress(page);
        if (progress.course.id !== play) throw new Error("a lesson moved to another play");
        const course = progress.attempts.filter((a) => a.id === play);
        for (const lesson of ["format", "scene-cards", "characters", "files", "export"]) {
          const a = course.find((x) => x.lesson === lesson);
          if (a?.status !== "finished" || Object.values(a.outcomes).some((o) => o !== "tried"))
            throw new Error(`${lesson} was not finished by hand: ${JSON.stringify(a)}`);
        }
        const script = await tutorialRead(page, "Practice Play.fountain");
        for (const piece of [
          "MARA",
          "**",
          "===",
          "The last visitor arrives.",
          "A quiet room. Early morning.",
          "ROWAN",
        ])
          if (!script.includes(piece)) throw new Error(`the play lacks ${piece}: ${script}`);
        const manifest = JSON.parse(await tutorialRead(page, "Practice Play.proscenium"));
        const docs = JSON.stringify(manifest.binder);
        if (!docs.includes("Rehearsal Notes")) throw new Error("the named note is not in the play");
        await page
          .locator(".tutorial-cue")
          .getByRole("button", { name: "Return to My Play", exact: true })
          .click();
        await page.waitForSelector(".tutorial-cue", { state: "detached" });
      },
    },
    {
      name: "tutorials · a new note's first line stays clear of its format bar in the app's own window",
      feature: "tutorial",
      async run(page) {
        // At the app's own 1100×760 a new note's page is taller than its pane.
        // The guide brought it into view by its bottom, which put the page's
        // top, and the line the writer starts on, under the note's header and
        // format bar (docs/app/preferences-and-help/tutorials.md#TUT-D103). At
        // 75 % the page's top margin is shorter than those bars, so the line
        // is hidden as it was at 62 %; at practice's own Fit Width the card was
        // left over the page instead. Practice's zoom goes when the tutorial
        // does. The size is put back as it was: the native window's own is
        // 1100×760.
        const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
        await page.setViewportSize({ width: 1100, height: 760 });
        try {
          await tutorialStart(page, "Organize Files and Tags");
          await cueStep(page, 1, 4);
          await page.locator(".zoomctl__label").click();
          await page.locator(".menu__item", { hasText: "75%" }).first().click();
          await page.waitForSelector(".menu", { state: "detached" });
          await page.locator('[data-tutorial="binder-new"]').click();
          await page.locator('.menu [data-menu-id="new:document"]').click();
          await cueStep(page, 2, 4);
          await beside(page, "the new note, in the app's own window");
          await still(page, ".material .ProseMirror");
          await onTop(page, ".material .ProseMirror > :first-child");
          // A page brought in by its top from further down comes to rest below
          // the bars as well: the note's pane counts them as scroll padding.
          // Its top is read off the desk, which is never zoomed (use-zoom.ts).
          const under = await page.evaluate(() => {
            const pane = document.querySelector(".material").closest(".pane__body");
            pane.scrollTop = pane.scrollHeight;
            document
              .querySelector('[data-tutorial="material-page"]')
              .scrollIntoView({ block: "start" });
            const desk = document.querySelector(".material__desk");
            return (
              document.querySelector(".fmt").getBoundingClientRect().bottom -
              desk.getBoundingClientRect().top -
              parseFloat(getComputedStyle(desk).paddingTop)
            );
          });
          if (under > 1)
            throw new Error(
              `brought in by its top, the page starts ${Math.round(under)}px under the format bar`,
            );
          await still(page, ".material .ProseMirror");
          await onTop(page, ".material .ProseMirror > :first-child");
          await tutorialStop(page);
        } finally {
          await page.setViewportSize(size);
        }
      },
    },
    {
      name: "tutorials · Show Me and Skip work at every step, in place, and keep the writer's words",
      feature: "tutorial",
      async run(page) {
        await tutorialOpen(page);
        await page.getByRole("button", { name: "Start Over in a New Play", exact: true }).click();
        await cueStep(page, 1, 5);
        const before = (await tutorialProgress(page)).course.id;
        await scriptFocused(page);
        await page.keyboard.type("JUNIPER");
        await page.keyboard.press("Enter");
        await cueStep(page, 2, 5);
        for (const [lesson, count] of [
          ["first-exchange", 5],
          ["format", 4],
          ["scene-cards", 5],
          ["characters", 4],
          ["files", 4],
          ["export", 4],
        ]) {
          for (let step = 1; step <= count; step++) {
            if (lesson === "first-exchange" && step === 1) continue;
            await cueStep(page, step, count);
            const card = ".tutorial-cue";
            // The count changes a moment before the card's buttons do: whether this step
            // offers Show Me is read once it offers something.
            await until(
              page,
              `${lesson} step ${step} offers a way on`,
              (sel) =>
                [...document.querySelectorAll(sel + " button")].some(
                  (b) =>
                    !b.disabled &&
                    /^(Show Me|Next|Finish Lesson|Finish at Preview)$/.test(b.textContent),
                ),
              card,
              15000,
            );
            // Show Me is looked for and pressed in one turn of the page: a step that completes
            // itself (See That It's Saved, when the save lands) takes the button away, and a
            // click that waited for it again would wait out its timeout.
            if (
              await page.evaluate((sel) => {
                const b = [...document.querySelectorAll(sel + " button")].find(
                  (b) => b.textContent === "Show Me" && !b.disabled,
                );
                b?.click();
                return !!b;
              }, card)
            ) {
              await until(
                page,
                `${lesson} step ${step} shown`,
                (sel) =>
                  [...document.querySelectorAll(sel + " button")].some((b) =>
                    /^(Next|Finish Lesson|Finish at Preview)$/.test(b.textContent),
                  ),
                card,
                15000,
              );
            }
            // A speaker joins the cast at the next autosave, and speakers found in
            // one autosave go in by weight: so whether IVO's line lands before
            // JUNIPER is saved decided the cast's order, and the Cast view's tree,
            // run to run in the real app. Each speaker is in the saved cast before
            // the next line is written, so the order is the order they spoke.
            if (lesson === "first-exchange")
              await until(
                page,
                `${lesson} step ${step}: every speaker in the saved cast`,
                async () => {
                  const text =
                    (window.__TAURI_INTERNALS__
                      ? (
                          await window.__TAURI_INTERNALS__.invoke("vault_read", {
                            rel: "Practice Play.fountain",
                          })
                        ).content
                      : window.__prosceniumPeek("Practice Play.fountain")) ?? "";
                  const [first, ...rest] = text.split(/\n[ \t]*\n/);
                  // A title page is `Key: value` lines at the very top, or nothing yet.
                  const titled = /^[ \t]*[A-Za-z][A-Za-z ]*:/.test(first);
                  const titlePage = titled ? first : "";
                  const script = (titled ? rest : [first, ...rest]).join("\n\n");
                  return ["JUNIPER", "IVO"].every(
                    (name) =>
                      !new RegExp(`^${name}[ \t]*\n[ \t]*[^\s(]`, "m").test(script) ||
                      titlePage.includes(name),
                  );
                },
                undefined,
                15000,
              );
            if (step === 2) await audit(page, `tutorial · ${lesson} shown`);
            const next =
              step === count
                ? lesson === "export"
                  ? "Finish at Preview"
                  : "Finish Lesson"
                : "Next";
            await page.locator(card).getByRole("button", { name: next, exact: true }).click();
          }
          await until(page, `${lesson} finished`, () =>
            document.querySelector(".tutorial-cue")?.textContent.includes("Lesson finished"),
          );
          if (lesson !== "export") await nextLesson(page);
        }
        const progress = await tutorialProgress(page);
        if (progress.course.id === before) {
          /* expected: one play */
        } else throw new Error("Show Me moved to another play");
        const shown = progress.attempts.filter((a) => a.id === before);
        if (shown.length !== 6 || shown.some((a) => a.status !== "finished"))
          throw new Error("not every lesson finished in the one play");
        if (
          shown.find((a) => a.lesson === "first-exchange").outcomes.speaker !== "tried" ||
          shown.find((a) => a.lesson === "first-exchange").outcomes.line !== "demonstrated"
        )
          throw new Error("outcomes do not tell tried from shown");
        const script = await tutorialRead(page, "Practice Play.fountain");
        if (!script.includes("JUNIPER")) throw new Error("Show Me removed the writer's own word");
        for (const piece of [
          "**You're** early.",
          "IVO",
          "Come in.",
          "===",
          "A friend arrives earlier than expected.",
          "ROWAN",
          "A quiet room.",
        ])
          if (!script.includes(piece)) throw new Error(`Show Me left out ${piece}: ${script}`);
        await page
          .locator(".tutorial-cue")
          .getByRole("button", { name: "Return to My Play", exact: true })
          .click();
        await page.waitForSelector(".tutorial-cue", { state: "detached" });
        // Skip performs what later steps build on, and records it as skipped.
        await tutorialOpen(page);
        await page.getByRole("button", { name: "Start Over in a New Play", exact: true }).click();
        await cueStep(page, 1, 5);
        for (let step = 1; step <= 3; step++) {
          await cueStep(page, step, 5);
          await page
            .locator(".tutorial-cue")
            .getByRole("button", { name: "Skip Step", exact: true })
            .click();
        }
        await cueStep(page, 4, 5);
        await until(
          page,
          "the reply line is ready after skipping",
          () => document.querySelector(".editor-surface .tutorial-line")?.dataset.pl === "dialogue",
        );
        await scriptFocused(page);
        await page.keyboard.type("Then we can go.");
        await cueStep(page, 5, 5);
        const skipped = (await tutorialProgress(page)).attempts.at(-1).outcomes;
        if (
          skipped.speaker !== "skipped" ||
          skipped["speaker-two"] !== "skipped" ||
          skipped.reply !== "tried"
        )
          throw new Error(`skips recorded wrongly: ${JSON.stringify(skipped)}`);
        // A later lesson opened first gets the exchange it needs, in this same play.
        await tutorialStart(page, "Characters and Opening Pages");
        await cueStep(page, 1, 4);
        await page.locator('.viewswitch [data-seg="cast"]').click();
        await cueStep(page, 2, 4);
        await tutorialStop(page);
      },
    },
    {
      name: "tutorials · stop returns to the play, Continue returns to the same place, and the keyboard reaches the guide",
      feature: "tutorial",
      async run(page) {
        await walkIntoPlay(page);
        const launch = await page.evaluate(() => ({
          root: localStorage.getItem("proscenium:dev:lastVault"),
          play: JSON.parse(localStorage.getItem("proscenium:dev:settings") ?? "{}").lastPlay,
        }));
        await tutorialOpen(page);
        await page.getByRole("button", { name: "Start Over in a New Play", exact: true }).click();
        await cueStep(page, 1, 5);
        await scriptFocused(page);
        await page.keyboard.type("RESUME");
        await page.keyboard.press("Enter");
        await cueStep(page, 2, 5);
        const play = (await tutorialProgress(page)).course.id;
        // ⌃⇥ reaches the guide, a named region; Escape inside it stops the tutorial.
        for (
          let i = 0;
          i < 8 && !(await page.evaluate(() => !!document.activeElement?.closest(".tutorial-cue")));
          i++
        )
          await page.keyboard.press("Control+Tab");
        if (
          !(await page.evaluate(
            () => !!document.activeElement?.closest('aside.tutorial-cue[aria-label="Tutorial"]'),
          ))
        )
          throw new Error("the keyboard cannot reach the guide");
        await audit(page, "tutorial · keyboard in the guide");
        await page.keyboard.press("Escape");
        await page.waitForSelector(".tutorial-cue", { state: "detached" });
        await until(
          page,
          "back in the real play",
          () => document.querySelector(".doctitle__label")?.textContent === "The Weight of Water",
        );
        const after = await page.evaluate(() => ({
          root: localStorage.getItem("proscenium:dev:lastVault"),
          play: JSON.parse(localStorage.getItem("proscenium:dev:settings") ?? "{}").lastPlay,
        }));
        if (JSON.stringify(launch) !== JSON.stringify(after))
          throw new Error("Practice changed the personal launch destination");
        await tutorialOpen(page);
        await page
          .getByRole("button", { name: /^Continue: Write Your First Exchange · Step 2 of 5$/ })
          .click();
        await cueStep(page, 2, 5);
        if ((await tutorialProgress(page)).course.id !== play)
          throw new Error("Continue opened another play");
        await until(
          page,
          "the same words and the same line",
          () =>
            document
              .querySelector(".editor-surface .ProseMirror")
              ?.textContent.includes("RESUME") &&
            document.querySelector(".editor-surface .tutorial-line")?.dataset.pl === "dialogue",
        );
        await tutorialStop(page);
      },
    },
    {
      name: "tutorials · Stop gives the keyboard back to the play's script, at the writer's place",
      feature: "tutorial",
      async run(page) {
        await walkIntoPlay(page);
        await until(
          page,
          "the writer's own play",
          () => document.querySelector(".doctitle__label")?.textContent === "The Weight of Water",
        );
        // The writer's place: the end of their script, remembered once the caret rests there.
        await page.locator(".editor-surface .ProseMirror").focus();
        await page.keyboard.press("Meta+ArrowDown");
        const place = await page.evaluate(
          () => document.querySelector(".editor-surface .ProseMirror").editor.state.selection.from,
        );
        await page.waitForTimeout(900);
        // By pointer, by the keyboard inside the card, and from Help & Tutorials,
        // whose sheet hands the keyboard to its own button as it closes.
        const stops = [
          [
            "its ×",
            () =>
              page
                .locator(".tutorial-cue")
                .getByRole("button", { name: "Stop Tutorial", exact: true })
                .click(),
          ],
          [
            "Escape in the card",
            async () => {
              await page.locator(".tutorial-cue [data-tutorial-heading]").focus();
              await page.keyboard.press("Escape");
            },
          ],
          [
            "Return to My Play",
            async () => {
              await tutorialOpen(page);
              await page.getByRole("button", { name: "Return to My Play", exact: true }).click();
            },
          ],
        ];
        for (const [how, stop] of stops) {
          await tutorialStart(page, "Write Your First Exchange");
          await stop();
          await page.waitForSelector(".tutorial-cue", { state: "detached" });
          await keyboardBackInScript(page, how, place);
        }
      },
    },
    {
      // Stop's card takes the button that had the keyboard with it, so for a moment the
      // keyboard is on <body>. The native self-test twice saw ⌘⇧O pressed then change
      // nothing; this asks whether a ⌘ chord is lost there, first with <body> made so on
      // purpose, then in the moment itself. allPlays says what became of the key.
      name: "tutorials · ⌘⇧O reaches All Plays with the keyboard on <body>, as it is when Stop's card goes",
      feature: "tutorial",
      async run(page) {
        await walkIntoPlay(page);
        await until(
          page,
          "the writer's own play",
          () => document.querySelector(".doctitle__label")?.textContent === "The Weight of Water",
        );
        const back = async () => {
          await page.locator(".playrow__title", { hasText: /^The Weight of Water$/ }).click();
          await until(
            page,
            "the writer's own play back",
            () =>
              document.querySelector(".doctitle__label")?.textContent === "The Weight of Water" &&
              !!document.querySelector(".pane.is-focused .editor-surface .ProseMirror"),
          );
        };
        await page.evaluate(() => {
          const b = document.createElement("button");
          b.textContent = "Gone";
          document.body.append(b);
          b.focus();
          b.remove();
        });
        if (!(await page.evaluate(() => document.activeElement === document.body)))
          throw new Error(
            `removing the focused button left the keyboard on ${(await focused(page)).desc}, not <body>`,
          );
        await allPlays(page);
        await back();
        await tutorialStart(page, "Write Your First Exchange");
        await page
          .locator(".tutorial-cue")
          .getByRole("button", { name: "Stop Tutorial", exact: true })
          .focus();
        await page.keyboard.press("Enter");
        await page.waitForSelector(".tutorial-cue", { state: "detached" });
        await allPlays(page);
        await back();
      },
    },
    {
      // Stop's card goes once the play is back, and its script may still be reading, as a
      // script still coming down from iCloud does. The native self-test's two misses were
      // ⌘⇧O in that moment: the window keymap left it for want of a script, and behind the
      // locked screen the menu bar never got it back. All Plays wants a play, not a script.
      name: "tutorials · ⌘⇧O reaches All Plays while the play Stop returned to is still reading its script",
      devMock: true,
      feature: "tutorial",
      async run(page) {
        await walkIntoPlay(page);
        await until(
          page,
          "the writer's own play",
          () => document.querySelector(".doctitle__label")?.textContent === "The Weight of Water",
        );
        // Named while the play is open: the dev vault keys a gate by the folder open then.
        await page.evaluate(() => window.__prosceniumGate("read", "The Weight of Water.fountain"));
        try {
          await tutorialStart(page, "Write Your First Exchange");
          await tutorialStop(page);
          await until(
            page,
            "the script's read held",
            () =>
              window.__prosceniumHeld("read") > 0 &&
              !!document.querySelector(".paneroot") &&
              !document.querySelector(".doctitle__label"),
          );
          await allPlays(page);
        } finally {
          await page.evaluate(() => window.__prosceniumOpenGates());
        }
        await page.locator(".playrow__title", { hasText: /^The Weight of Water$/ }).click();
        await until(
          page,
          "the writer's own play back",
          () => document.querySelector(".doctitle__label")?.textContent === "The Weight of Water",
        );
      },
    },
    {
      name: "tutorials · narrow windows keep the guide on screen and its target clear, and a failed save waits",
      devMock: true,
      feature: "tutorial",
      async run(page) {
        await tutorialOpen(page);
        await page.getByRole("button", { name: "Start Over in a New Play", exact: true }).click();
        await cueStep(page, 1, 5);
        // The narrowest window the app has (src-tauri/tauri.conf.json: minWidth 820). At the
        // 640 this used to ask for, which no window can be, the toolbar's centre switcher
        // lies over "Hide the binder": Playwright's WebKit measured what was left of it at
        // 18.5px and axe failed it (docs/app/preferences-and-help/accessibility.md#A11Y-11).
        await page.setViewportSize({ width: 820, height: 600 });
        await page.waitForTimeout(300);
        await beside(page, "the lit line, in a narrow window");
        await audit(page, "tutorial · narrow");
        await page
          .locator(".tutorial-cue")
          .getByRole("button", { name: "More Help", exact: true })
          .click();
        await beside(page, "the lit line, with More Help open");
        await page.setViewportSize({ width: 1280, height: 800 });
        await page
          .locator(".tutorial-cue")
          .getByRole("button", { name: "Skip Step", exact: true })
          .click();
        await page
          .locator(".tutorial-cue")
          .getByRole("button", { name: "Skip Step", exact: true })
          .click();
        await page
          .locator(".tutorial-cue")
          .getByRole("button", { name: "Skip Step", exact: true })
          .click();
        await cueStep(page, 4, 5);
        await scriptFocused(page);
        await page.evaluate(() =>
          window.__prosceniumGate(
            "write",
            document.querySelector(".statusbar__path").textContent.split("/").pop() + ".fountain",
            { fail: "Tutorial save test" },
          ),
        );
        await page.keyboard.type("A reply that cannot save yet.");
        await until(
          page,
          "save failure is surfaced",
          () => document.querySelector(".savestatus")?.textContent === "Not saved",
        );
        await page.waitForTimeout(2500);
        if (
          (await page.evaluate(
            () => document.querySelector(".tutorial-cue__count")?.textContent,
          )) !== "4 of 5"
        )
          throw new Error("A failed save moved the lesson on");
        await page.evaluate(() => window.__prosceniumOpenGates("write"));
        await page.keyboard.press("Meta+s");
        await until(
          page,
          "the refused save lands",
          () => document.querySelector(".savestatus")?.textContent.startsWith("Saved"),
          undefined,
          20000,
        );
        await cueStep(page, 5, 5);
        await tutorialStop(page);
      },
    },
    // Retained practice (docs/app/keeping-work/storage-and-file-format.md#STOR-170 to docs/app/keeping-work/storage-and-file-format.md#STOR-176), through the catalogue.
    {
      name: "tutorials · reset keeps every practice play, and Saved Practice opens them",
      feature: "tutorial",
      async run(page) {
        await tutorialOpen(page);
        await page.getByRole("button", { name: "Start Over in a New Play", exact: true }).click();
        await cueStep(page, 1, 5);
        await tutorialType(page, "RETAINED");
        const original = await tutorialRead(page, "Practice Play.fountain");
        const first = (await tutorialProgress(page)).attempts.at(-1);
        await page
          .locator(".tutorial-cue")
          .getByRole("button", { name: "Show Me", exact: true })
          .click();
        await until(page, "shown in the same play", () =>
          [...document.querySelectorAll(".tutorial-cue button")].some(
            (b) => b.textContent === "Next",
          ),
        );
        await tutorialOpen(page);
        await page.getByRole("button", { name: "Reset Progress…", exact: true }).click();
        await audit(page, "reset preserves practice");
        await page
          .locator(".sheet__foot")
          .getByRole("button", { name: "Reset Progress", exact: true })
          .click();
        await until(page, "reset done", () => !!document.querySelector(".tutorials"));
        const reset = await tutorialProgress(page);
        if (
          reset.invitation !== "dismissed" ||
          reset.attempts.some((a) => a.status !== "archived" || Object.keys(a.outcomes).length)
        )
          throw new Error("Reset kept lesson marks or reset the invitation");
        if (reset.course?.id !== first.id) throw new Error("Reset forgot the practice play");
        await page.getByRole("button", { name: /^Saved Practice/ }).click();
        const rows = await page.locator(".tutorials__saved > li").count();
        if (rows < 1) throw new Error("Reset lost saved practice");
        await page.evaluate(
          (id) =>
            [...document.querySelectorAll(".tutorials__saved > li")]
              .find((li) => li.textContent.includes("Write Your First Exchange"))
              ?.querySelector("button")
              ?.click(),
          first.id,
        );
        await until(page, "retained practice opens", () =>
          document.querySelector(".editor-surface .ProseMirror")?.textContent.includes("RETAINED"),
        );
        // Its words arrive before it takes typing; the audit reads the play the writer can use.
        await until(
          page,
          "retained practice editable",
          () =>
            document
              .querySelector(".editor-surface .ProseMirror")
              ?.getAttribute("contenteditable") === "true",
        );
        if (!(await tutorialRead(page, "Practice Play.fountain")).includes("RETAINED"))
          throw new Error("Reset changed the earlier practice");
        void original;
        await audit(page, "retained practice after reset");
        await tutorialOpen(page);
        await page.getByRole("button", { name: "Return to My Play", exact: true }).click();
        await page.waitForSelector(".paneroot");
      },
    },
    {
      name: "tutorials · Keep as a Play makes a complete same-name copy with its own identity",
      feature: "tutorial",
      async run(page) {
        await walkIntoPlay(page);
        await page.keyboard.press("Meta+s");
        await until(page, "personal copy baseline saved", () =>
          document.querySelector(".savestatus")?.textContent.startsWith("Saved"),
        );
        const realOriginal = await tutorialRead(page, "The Weight of Water.fountain");
        await tutorialStart(page, "Organize Files and Tags", "Write a note");
        await page.waitForSelector(".material .ProseMirror");
        await page.locator(".material .ProseMirror").focus();
        await until(
          page,
          "the note has the keyboard",
          () => !!document.activeElement?.closest(".material .ProseMirror"),
        );
        await page.keyboard.press("Meta+ArrowDown");
        await page.keyboard.type("A note kept beside the script.");
        await page.keyboard.press("Meta+s");
        // The note has its own save state; the status bar's is the script's.
        await until(
          page,
          "note saved",
          () =>
            document.querySelector(".material__save")?.textContent === "Saved" &&
            document.querySelector(".savestatus")?.textContent.startsWith("Saved"),
          undefined,
          15000,
        );
        const manifest = JSON.parse(await tutorialRead(page, "Practice Play.proscenium"));
        const flatten = (items) => items.flatMap((i) => [i, ...flatten(i.children ?? [])]);
        const note = flatten(manifest.binder).find((i) => i.type === "document");
        const noteText = await tutorialRead(page, note.path);
        const script = await tutorialRead(page, "Practice Play.fountain");
        const attempt = (await tutorialProgress(page)).attempts.at(-1);
        await page
          .locator(".tutorial-cue")
          .getByRole("button", { name: /^Organize Files and Tags/ })
          .click();
        await page.getByRole("menuitem", { name: "Keep as a Play…", exact: true }).click();
        await page
          .getByRole("textbox", { name: "Play title", exact: true })
          .fill("The Weight of Water");
        await audit(page, "keep practice as a play");
        await page
          .locator(".sheet__foot")
          .getByRole("button", { name: "Keep Copy", exact: true })
          .click();
        await until(
          page,
          "copy kept",
          () =>
            document
              .querySelector('.tutorials__dialog [role="status"]')
              ?.textContent.includes("is saved in your Plays folder"),
          undefined,
          15000,
        );
        if ((await tutorialRead(page, "Practice Play.fountain")) !== script)
          throw new Error("Keeping a copy changed the retained script");
        if (JSON.parse(await tutorialRead(page, "Practice Play.proscenium")).id !== manifest.id)
          throw new Error("Keeping a copy replaced the original practice");
        await page.getByRole("button", { name: "Open Copy", exact: true }).click();
        await page.waitForSelector(".sheet", { state: "detached" });
        await until(
          page,
          "copy opens by explicit choice",
          () =>
            document
              .querySelector(".binder__project")
              ?.textContent.startsWith("The Weight of Water") &&
            document.querySelector(".binder__project")?.textContent !== "The Weight of Water",
        );
        const copiedName = await page.locator(".binder__project").innerText();
        if (
          (await tutorialRead(page, "Practice Play.fountain")) !== script ||
          (await tutorialRead(page, note.path)) !== noteText
        )
          throw new Error("Copy lost script or document bytes");
        if (JSON.parse(await tutorialRead(page, copiedName + ".proscenium")).id === manifest.id)
          throw new Error("The copy shares its original play identity");
        await tutorialOpen(page);
        await page.getByRole("button", { name: /^Continue: Organize Files and Tags/ }).click();
        await until(
          page,
          "original practice ready",
          () =>
            document.querySelector(".binder__project")?.textContent === "Practice Play" &&
            !!document.querySelector(".tutorial-cue__count"),
        );
        if (JSON.parse(await tutorialRead(page, "Practice Play.proscenium")).id !== attempt.id)
          throw new Error("Resume did not reopen the original practice");
        if ((await tutorialRead(page, note.path)) !== noteText)
          throw new Error("Copying consumed the original document");
        await tutorialStop(page);
        // A writer presses All Plays once the play Stop returned to is in front of them,
        // not in the moment the card goes.
        await until(
          page,
          "the kept copy back in place",
          () =>
            !!document.querySelector(".paneroot") &&
            /^The Weight of Water \d/.test(
              document.querySelector(".binder__project")?.textContent ?? "",
            ) &&
            !/\/tutorials\//.test(document.querySelector(".statusbar__path")?.textContent ?? ""),
        );
        await allPlays(page);
        await page.locator(".playrow__title", { hasText: /^The Weight of Water$/ }).click();
        await until(
          page,
          "original real play reopened",
          () => document.querySelector(".doctitle__label")?.textContent === "The Weight of Water",
        );
        if ((await tutorialRead(page, "The Weight of Water.fountain")) !== realOriginal)
          throw new Error("Same-name copy replaced personal writing");
      },
    },
    {
      name: "tutorials · retained practice waits for an explicit resume after relaunch",
      feature: "tutorial",
      async run(page) {
        // Old versions keyed the cursor by this shared filename. A new attempt
        // must not inherit another attempt's position in the scene heading.
        await page.evaluate(() =>
          localStorage.setItem("proscenium:caret:Practice Play.fountain", "1"),
        );
        await tutorialOpen(page);
        await page.getByRole("button", { name: "Start Over in a New Play", exact: true }).click();
        await cueStep(page, 1, 5);
        await tutorialType(page, "AFTER RELOAD");
        await page.keyboard.press("Enter");
        await page.keyboard.press("Meta+s");
        await until(page, "empty speech saved", () =>
          document.querySelector(".savestatus")?.textContent.startsWith("Saved"),
        );
        const pausedScript = await tutorialRead(page, "Practice Play.fountain");
        if (!pausedScript.includes("\n## SCENE 1\n"))
          throw new Error("A prior practice moved the new exercise cursor into its scene heading");
        await page.evaluate(
          (text) => sessionStorage.setItem("tutorial:resume-script", text),
          pausedScript,
        );
        const state = await tutorialProgress(page);
        await page.evaluate(
          (id) => sessionStorage.setItem("tutorial:resume-id", id),
          state.course.id,
        );
        await tutorialStop(page);
        await page.reload();
      },
    },
    {
      name: "tutorials · relaunch resumes the same play without another invitation",
      feature: "tutorial",
      async run(page) {
        await walkIntoPlay(page);
        if (await page.locator(".tutorial-cue, .tutorial-invitation, .tutorials").count())
          throw new Error("Relaunch forced a tutorial open");
        await tutorialOpen(page);
        await page.getByRole("button", { name: /^Continue: Write Your First Exchange/ }).click();
        await until(page, "saved session words resumed", () =>
          document
            .querySelector(".editor-surface .ProseMirror")
            ?.textContent.includes("AFTER RELOAD"),
        );
        await cueReady(page);
        await page.keyboard.press("Meta+s");
        await until(page, "empty speech saved", () =>
          document.querySelector(".savestatus")?.textContent.startsWith("Saved"),
        );
        if (
          (await tutorialRead(page, "Practice Play.fountain")) !==
          (await page.evaluate(() => sessionStorage.getItem("tutorial:resume-script")))
        )
          throw new Error("Resume lost the empty speech after its saved cue");
        if (
          JSON.parse(await tutorialRead(page, "Practice Play.proscenium")).id !==
          (await page.evaluate(() => sessionStorage.getItem("tutorial:resume-id")))
        )
          throw new Error("Resume made another play");
        await tutorialStop(page);
      },
    },
    {
      name: "tutorials · stale progress and damaged reset preserve practice",
      devMock: true,
      feature: "tutorial",
      async run(page) {
        await tutorialOpen(page);
        await page.getByRole("button", { name: "Start Over in a New Play", exact: true }).click();
        await cueStep(page, 1, 5);
        await tutorialType(page, "PROGRESS CONFLICT");
        const original = await tutorialRead(page, "Practice Play.fountain");
        await page.evaluate(() => {
          const key = "proscenium:dev:tutorial-progress";
          const v = JSON.parse(localStorage.getItem(key));
          v.moreHelp = !v.moreHelp;
          localStorage.setItem(key, JSON.stringify(v));
        });
        await page
          .locator(".tutorial-cue")
          .getByRole("button", { name: "More Help", exact: true })
          .click();
        await until(page, "stale checkpoint refused, in the guide", () =>
          document
            .querySelector(".tutorial-cue")
            ?.textContent.includes("changed in another window"),
        );
        await tutorialOpen(page);
        await page
          .getByRole("button", { name: "Reload Saved Tutorial Progress", exact: true })
          .click();
        await until(
          page,
          "checkpoint reloaded",
          () =>
            !document
              .querySelector(".tutorials")
              ?.textContent.includes("changed in another window"),
        );
        if ((await tutorialRead(page, "Practice Play.fountain")) !== original)
          throw new Error("Stale progress changed words");
        await page.getByRole("button", { name: "Return to My Play", exact: true }).click();
        await page.waitForSelector(".paneroot");
        await page.evaluate(() =>
          localStorage.setItem("proscenium:dev:tutorial-progress", "damaged progress"),
        );
        await page.reload();
        await walkIntoPlay(page);
        await tutorialOpen(page);
        await page.getByRole("button", { name: "Reset Progress…", exact: true }).click();
        await page
          .locator(".sheet__foot")
          .getByRole("button", { name: "Reset Progress", exact: true })
          .click();
        await until(page, "reset done", () => !!document.querySelector(".tutorials"));
        if (
          !(await page.evaluate(() =>
            Object.keys(localStorage).some(
              (k) =>
                k.startsWith("proscenium:dev:tutorial-progress:preserved:") &&
                localStorage.getItem(k) === "damaged progress",
            ),
          ))
        )
          throw new Error("Reset did not preserve damaged progress");
        await page.getByRole("button", { name: /^Saved Practice/ }).click();
        await page.getByRole("button", { name: "Open Practice", exact: true }).first().click();
        await until(
          page,
          "orphan practice independently discovered",
          () => !!document.querySelector(".editor-surface .ProseMirror"),
        );
        await tutorialOpen(page);
        await page.getByRole("button", { name: "Return to My Play", exact: true }).click();
        await page.waitForSelector(".paneroot");
      },
    },
    {
      name: "tutorials · partial copy keeps the original and retries into a new folder",
      devMock: true,
      feature: "tutorial",
      async run(page) {
        await tutorialStart(page, "Write Your First Exchange");
        await tutorialType(page, "COPY SURVIVES");
        await page.keyboard.press("Meta+s");
        await until(page, "practice settled before comparing copied bytes", () =>
          document.querySelector(".savestatus")?.textContent.startsWith("Saved"),
        );
        const original = await tutorialRead(page, "Practice Play.fountain");
        await tutorialOpen(page);
        await page.getByRole("button", { name: "Keep as a Play…", exact: true }).click();
        await page
          .getByRole("textbox", { name: "Play title", exact: true })
          .fill("Partial Practice Copy");
        await page.evaluate(() => window.__prosceniumGate("write", null));
        try {
          await page
            .locator(".sheet__foot")
            .getByRole("button", { name: "Keep Copy", exact: true })
            .click();
          await until(
            page,
            "first copy write held in Plays folder",
            () =>
              window.__prosceniumHeld("write") > 0 &&
              window.__prosceniumPeek("Practice Play.fountain") === null,
          );
          await page.evaluate(() => {
            window.__prosceniumOpenGates("write");
            window.__prosceniumGate("write", null, {
              fail: "No space left on device (os error 28)",
            });
          });
          await until(page, "copy failure shown", () =>
            /space|disk/i.test(
              document.querySelector('.tutorials__dialog [role="alert"]')?.textContent ?? "",
            ),
          );
          if ((await tutorialRead(page, "Practice Play.fountain")) !== original)
            throw new Error("Failed copy changed retained words");
          const keys = await page.evaluate(() =>
            window.__prosceniumStoreKeys().filter((k) => k.startsWith("Partial Practice Copy/")),
          );
          if (!keys.length || keys.some((k) => k.endsWith(".proscenium")))
            throw new Error("Partial copy was absent or published as a complete play");
        } finally {
          await page.evaluate(() => window.__prosceniumOpenGates());
        }
        await page
          .locator(".sheet__foot")
          .getByRole("button", { name: "Keep Copy", exact: true })
          .click();
        await until(
          page,
          "copy kept",
          () =>
            document
              .querySelector('.tutorials__dialog [role="status"]')
              ?.textContent.includes("is saved in your Plays folder"),
          undefined,
          15000,
        );
        if ((await tutorialRead(page, "Practice Play.fountain")) !== original)
          throw new Error("Retry changed the original");
        await page
          .locator(".sheet__foot")
          .getByRole("button", { name: "Cancel", exact: true })
          .click();
        await tutorialOpen(page);
        await page.getByRole("button", { name: "Return to My Play", exact: true }).click();
        await page.waitForSelector(".paneroot");
      },
    },
    {
      name: "tutorials · legacy practice resumes and copies without moving its original",
      devMock: true,
      feature: "tutorial",
      async run(page) {
        await tutorialStart(page, "Write Your First Exchange", "Write the reply");
        await tutorialType(page, "LEGACY WORDS");
        await page.evaluate(() => {
          const key = "proscenium:dev:tutorial-progress";
          const progress = JSON.parse(localStorage.getItem(key));
          const a = progress.attempts.at(-1);
          const files = JSON.parse(localStorage.getItem("proscenium:dev:tutorial-files"));
          const from = "/dev/app-data/tutorials/sessions/" + a.session + "/Practice Play/";
          const to = "/dev/app-data/tutorials/practice/Legacy Practice/";
          for (const [path, text] of Object.entries(files))
            if (path.startsWith(from))
              files[
                to +
                  path
                    .slice(from.length)
                    .replace("Practice Play.proscenium", "Legacy Practice.proscenium")
              ] = text;
          localStorage.setItem("proscenium:dev:tutorial-files", JSON.stringify(files));
          const legacyId = "01J00000000000000000000077";
          const manifest = JSON.parse(files[to + "Legacy Practice.proscenium"]);
          manifest.id = legacyId;
          files[to + "Legacy Practice.proscenium"] = JSON.stringify(manifest);
          localStorage.setItem("proscenium:dev:tutorial-files", JSON.stringify(files));
          // Before the course: no course pointer, one attempt in its own folder.
          a.id = legacyId;
          delete a.session;
          a.dir = "Legacy Practice";
          a.status = "paused";
          delete progress.invitation;
          delete progress.course;
          localStorage.setItem(key, JSON.stringify({ ...progress, attempts: [a] }));
        });
        // Stop checkpoints the current model, and the dev vault writes its whole
        // practice folder back to storage whenever it saves a practice file
        // (persistPractice). So both halves of the legacy fixture are installed
        // again after stopping, and the relaunch waits until they hold: on a slow
        // host a save landing after the fixture wiped its folder, and Continue
        // then found no practice to open.
        const legacy = await page.evaluate(() =>
          ["proscenium:dev:tutorial-progress", "proscenium:dev:tutorial-files"].map((k) => [
            k,
            localStorage.getItem(k),
          ]),
        );
        await tutorialStop(page);
        await until(
          page,
          "the legacy fixture holds",
          async (pairs) => {
            for (const [k, v] of pairs) localStorage.setItem(k, v);
            for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r));
            return pairs.every(([k, v]) => localStorage.getItem(k) === v);
          },
          legacy,
        );
        await page.reload();
        await walkIntoPlay(page);
        await tutorialOpen(page);
        await page.getByRole("button", { name: /^Continue: Write Your First Exchange/ }).click();
        await until(page, "legacy words resume", () =>
          document
            .querySelector(".editor-surface .ProseMirror")
            ?.textContent.includes("LEGACY WORDS"),
        );
        await cueReady(page);
        const original = await tutorialRead(page, "Practice Play.fountain");
        await tutorialOpen(page);
        await page.getByRole("button", { name: "Keep as a Play…", exact: true }).click();
        await page.getByRole("textbox", { name: "Play title", exact: true }).fill("Legacy Copy");
        await page
          .locator(".sheet__foot")
          .getByRole("button", { name: "Keep Copy", exact: true })
          .click();
        await until(
          page,
          "copy kept",
          () =>
            document
              .querySelector('.tutorials__dialog [role="status"]')
              ?.textContent.includes("is saved in your Plays folder"),
          undefined,
          15000,
        );
        if ((await tutorialRead(page, "Practice Play.fountain")) !== original)
          throw new Error("Legacy copy changed the original");
        await page.getByRole("button", { name: "Open Copy", exact: true }).click();
        await page.waitForSelector(".sheet", { state: "detached" });
        if ((await tutorialRead(page, "Practice Play.fountain")) !== original)
          throw new Error("Legacy copy lost words");
        await page.keyboard.press("Meta+Shift+KeyO");
        await page.waitForSelector(".vault-list");
        await page.locator(".playrow__title", { hasText: /^The Weight of Water$/ }).click();
        await page.waitForSelector(".paneroot");
      },
    },
    {
      name: "tutorials · a newer practice manifest holds the step and keeps Stop reachable",
      devMock: true,
      feature: "tutorial",
      async run(page) {
        await tutorialOpen(page);
        await page.getByRole("button", { name: "Start Over in a New Play", exact: true }).click();
        await cueStep(page, 1, 5);
        await tutorialStart(page, "Write Your First Exchange", "See that it's saved");
        await cueStep(page, 5, 5);
        const script = await tutorialRead(page, "Practice Play.fountain");
        const manifest = JSON.parse(await tutorialRead(page, "Practice Play.proscenium"));
        manifest.schemaVersion = 999;
        const newer = JSON.stringify(manifest);
        await page.evaluate(
          (text) => window.__prosceniumExternalChange("Practice Play.proscenium", text),
          newer,
        );
        await until(
          page,
          "practice protected",
          () =>
            document
              .querySelector(".editor-surface .ProseMirror")
              ?.getAttribute("contenteditable") === "false",
        );
        await cueTone(page, "fix");
        if (
          await page
            .locator(".tutorial-cue")
            .getByRole("button", { name: "Finish Lesson", exact: true })
            .count()
        )
          throw new Error("Read-only practice completed a step");
        if (
          (await tutorialRead(page, "Practice Play.proscenium")) !== newer ||
          (await tutorialRead(page, "Practice Play.fountain")) !== script
        )
          throw new Error("Newer practice was changed");
        await tutorialStop(page);
      },
    },
    {
      name: "tutorials · a writer who wanders off is led back, and Take Me There goes there",
      feature: "tutorial",
      async run(page) {
        // A lesson left part-done in the play that Start Over leaves behind. A step of it
        // chosen afterwards belongs to the new play, not the old one (docs/app/preferences-and-help/tutorials.md#TUT-10).
        // A play of its own first: the check before may leave a read-only practice open.
        await tutorialOpen(page);
        await page.getByRole("button", { name: "Start Over in a New Play", exact: true }).click();
        await cueStep(page, 1, 5);
        await tutorialStart(page, "Organize Files and Tags", "Write a note");
        await page
          .locator(".tutorial-cue")
          .getByRole("button", { name: "Show Me", exact: true })
          .click();
        await until(page, "the note shown", () =>
          [...document.querySelectorAll(".tutorial-cue button")].some(
            (b) => b.textContent === "Next",
          ),
        );
        await tutorialStop(page);
        await tutorialOpen(page);
        await page.getByRole("button", { name: "Start Over in a New Play", exact: true }).click();
        await cueStep(page, 1, 5);
        const course = (await tutorialProgress(page)).course.id;
        await tutorialStart(page, "Arrange Scenes on the Board", "Describe a scene");
        await cueStep(page, 3, 5);
        // Started from Help & Tutorials, the card's words have the keyboard, not the toolbar
        // button the closed sheet gave it back to.
        await until(
          page,
          "the card has the keyboard",
          () => !!document.activeElement?.matches(".tutorial-cue [data-tutorial-heading]"),
        );
        await page.keyboard.press("Meta+Digit1");
        await cueSays(page, "come back to this step");
        await beside(page, "the Board switch");
        await page.locator('.viewswitch [data-seg="corkboard"]').click();
        await cueSays(page, "what happens in this scene");
        await tutorialStart(page, "Organize Files and Tags", "Write a note");
        await cueStep(page, 2, 4);
        if ((await tutorialProgress(page)).course.id !== course)
          throw new Error("A step chosen after Start Over went back to the earlier practice play");
        await page.keyboard.press("Meta+Digit1");
        await cueSays(page, "Open your document");
        await audit(page, "tutorial · led back");
        await page
          .locator(".tutorial-cue")
          .getByRole("button", { name: "Take Me There", exact: true })
          .click();
        await cueSays(page, "write a few words");
        await page.waitForSelector(".material .ProseMirror");
        await tutorialStop(page);
      },
    },
    {
      name: "tutorials · a new invitation, for the next check",
      devMock: true,
      feature: "tutorial",
      async run(page) {
        await walkIntoPlay(page);
        await page.evaluate(() => {
          const key = "proscenium:dev:tutorial-progress";
          const v = JSON.parse(localStorage.getItem(key));
          v.invitation = "new";
          localStorage.setItem(key, JSON.stringify(v));
        });
        await page.reload();
      },
    },
    {
      name: "tutorials · Try the Tutorial opens the first lesson at the work",
      devMock: true,
      feature: "tutorial",
      async run(page) {
        await walkIntoPlay(page);
        await page.keyboard.press("Meta+Shift+KeyO");
        await page.waitForSelector(".tutorial-invitation", { timeout: 15000 });
        await page.getByRole("button", { name: "Try the Tutorial", exact: true }).click();
        await cueStep(page, 1, 5);
        await until(
          page,
          "the first line shows what to type",
          () => !!document.querySelector(".editor-surface .tutorial-line .tutorial-ghost"),
        );
        if ((await tutorialProgress(page)).invitation !== "dismissed")
          throw new Error("accepting the invitation did not end it");
        await tutorialStop(page);
        await walkIntoPlay(page);
      },
    },
    {
      // A tutorial check that failed mid-lesson would leave practice open, and every check
      // after it would fail on the wrong play. This puts the writer's play back either way.
      name: "tutorials · the writer's own play is back after the tutorial checks",
      async run(page) {
        for (let i = 0; i < 3 && (await page.locator(".modal-scrim").count()); i++)
          await page.keyboard.press("Escape");
        if (await page.locator(".tutorial-cue").count()) await tutorialStop(page);
        if (
          await page.evaluate(() =>
            /\/tutorials\//.test(document.querySelector(".statusbar__path")?.textContent ?? ""),
          )
        ) {
          await tutorialOpen(page);
          await page.getByRole("button", { name: "Return to My Play", exact: true }).click();
          await page.waitForSelector(".tutorials", { state: "detached" });
        }
        await walkIntoPlay(page);
        if (
          await page.evaluate(() =>
            /\/tutorials\//.test(document.querySelector(".statusbar__path")?.textContent ?? ""),
          )
        )
          throw new Error("practice is still open");
      },
    },
    {
      name: "usability · tutorials, appearance, dictionary and formats",
      feature: "app",
      async run(page) {
        await page.getByRole("button", { name: "Help & Tutorials", exact: true }).click();
        await page.getByRole("button", { name: "Format the Script", exact: true }).click();
        await visible(page, ".tutorials__detail", { minWidth: 200, minHeight: 50 });
        await audit(page, "tutorials");
        await page
          .locator(".sheet__foot")
          .getByRole("button", { name: "Close", exact: true })
          .click();
        await page.waitForSelector(".tutorials", { state: "detached" });
        await page.keyboard.press("Meta+Comma");
        await page.locator('.prefs__nav [role="tab"]', { hasText: "Appearance" }).click();
        const before = await page.evaluate(() => document.documentElement.dataset.theme);
        await page.getByRole("button", { name: /^Appearance:/ }).click();
        await page
          .getByRole("menuitemradio", { name: before === "dark" ? "Light" : "Dark", exact: true })
          .click();
        const opposite = before === "dark" ? "light" : "dark";
        await until(
          page,
          "appearance override",
          (value) => document.documentElement.dataset.theme === value,
          opposite,
        );
        await audit(page, "appearance override");
        await page.getByRole("button", { name: /^Appearance:/ }).click();
        await page.getByRole("menuitemradio", { name: "Follow Mac", exact: true }).click();
        await until(
          page,
          "system appearance restored",
          (value) => document.documentElement.dataset.theme === value,
          before,
        );
        await page.locator('.prefs__nav [role="tab"]', { hasText: "Writing" }).click();
        await page
          .getByRole("textbox", { name: "Word or name to add", exact: true })
          .fill("Smokewordling");
        await page.getByRole("button", { name: "Add Word", exact: true }).click();
        await page.getByRole("button", { name: "Remove “Smokewordling”", exact: true }).click();
        await page.getByRole("textbox", { name: "New status", exact: true }).fill("Table read");
        await page.getByRole("button", { name: "Add Status", exact: true }).click();
        await page.getByRole("button", { name: "Delete “Table read”", exact: true }).click();
        await page.locator('.prefs__nav [role="tab"]', { hasText: "Formats" }).click();
        const first = await page.locator(".formatlist__name").first().innerText();
        await page.getByRole("button", { name: `Move “${first}” down`, exact: true }).click();
        const order = await page.locator(".formatlist__name").allInnerTexts();
        if (order[1] !== first) throw new Error("format did not move");
        await page.keyboard.press("Escape");
        await page.locator(".doctitle").click();
        const menuNames = await page.locator(".menu__item").allInnerTexts();
        for (const name of order.slice(0, 3))
          if (!menuNames.some((label) => label.includes(name)))
            throw new Error(`quick formats omit ${name}`);
        for (const name of order.slice(3))
          if (menuNames.some((label) => label.includes(name)))
            throw new Error(`quick formats include fourth choice ${name}`);
        await page.keyboard.press("Escape");
        await page.keyboard.press("Meta+Comma");
        await page.getByRole("button", { name: `Move “${first}” up`, exact: true }).click();
        await page.keyboard.press("Escape");
      },
    },
    {
      name: "usability · add and reorder cast independently of the printed page",
      feature: "app",
      async run(page) {
        await page.locator(".seg__btn", { hasText: "Cast" }).first().click();
        await page.getByRole("button", { name: "Add Character", exact: true }).click();
        if (
          !(await page.evaluate(() => document.activeElement?.classList.contains("castcard__name")))
        )
          throw new Error("Add Character did not focus the new name");
        await page.keyboard.type("Smoke Guest");
        await page.keyboard.press("Tab");
        await page.getByRole("button", { name: "Move Smoke Guest up", exact: true }).click();
        const names = await page
          .locator(".castcard__name")
          .evaluateAll((fields) => fields.map((field) => field.value));
        if (names.at(-2) !== "Smoke Guest")
          throw new Error("cast did not retain the added name and new order");
        const print = page.locator('[aria-label="Printed characters page"] .ProseMirror');
        await print.fill("The company, in order of appearance.");
        await page.keyboard.press("Meta+a");
        await page.keyboard.press("Meta+b");
        await page
          .getByRole("textbox", { name: "Description — Smoke Guest", exact: true })
          .fill("A private casting note.");
        await page.keyboard.press("Tab");
        if ((await print.innerText()).trim() !== "The company, in order of appearance.")
          throw new Error("cast tools changed the custom printed page");
        if (!(await print.locator("strong").count()))
          throw new Error("printed page did not retain bold");
        await page.locator(".seg__btn", { hasText: "Script" }).first().click();
        await openFromDocumentMenu(page, /Export PDF/);
        const text = await page.locator(".exportpanel__pane").innerText();
        if (
          !text.includes("The company, in order of appearance.") ||
          text.includes("A private casting note.")
        )
          throw new Error("export did not separate the printed page from cast tools");
        await page.keyboard.press("Escape");
        await page.locator(".seg__btn", { hasText: "Cast" }).first().click();
        await page.getByRole("button", { name: "Remove Smoke Guest", exact: true }).click();
        await page.locator(".castview__page-options summary").click();
        await page
          .getByRole("button", { name: "Use Cast List Automatically", exact: true })
          .click();
        await audit(page, "editable Characters page and cast tools");
        await page.locator(".seg__btn", { hasText: "Script" }).first().click();
      },
    },
    {
      // Settings is sectioned: a vertical tablist that is ONE Tab stop, with ↑ ↓
      // between sections. Every section is shown, measured and audited, because a
      // section nobody opened in smoke is a section whose contrast nobody read.
      name: "settings · every section",
      feature: "app",
      async run(page) {
        await page.keyboard.press("Meta+Comma");
        await page.waitForSelector(".sheet .prefs", { timeout: 5000 });
        await visible(page, ".prefs__nav", { minWidth: 120, minHeight: 200 });
        await visible(page, ".prefs__panel", { minWidth: 300, minHeight: 200 });
        const labels = await page.locator('.prefs__nav [role="tab"]').allInnerTexts();
        const expected = [
          "General",
          "Appearance",
          "Writing",
          "Formats",
          "Keyboard Shortcuts",
          "Help & Feedback",
          "Privacy",
          "Updates",
          "About",
        ];
        if (labels.join("|") !== expected.join("|")) {
          throw new Error(`the section list reads ${labels.join(" · ")}`);
        }
        // A bare ⌘, reopens where the writer last was, so the section it opens on
        // is whatever an earlier check left: "welcome" leaves Privacy, and only a
        // dev-mock check between put it back to General, which the native
        // self-test skips. Focus starts on the chosen tab, whichever that is;
        // Home then starts the walk at General.
        const opened = await focused(page);
        const chosenOnOpen = await page.locator('.prefs__nav [aria-selected="true"]').innerText();
        if (opened.role !== "tab" || opened.text !== chosenOnOpen) {
          throw new Error(
            `opening Settings left focus on ${opened.desc}, not the chosen ${chosenOnOpen} tab`,
          );
        }
        await page.keyboard.press("Home");
        for (let i = 0; i < expected.length; i++) {
          if (i > 0) await page.keyboard.press("ArrowDown");
          const at = await focused(page);
          if (at.role !== "tab" || at.text !== expected[i]) {
            throw new Error(
              `${i ? "↓" : "Home"} left focus on ${at.desc}, expected the ${expected[i]} tab`,
            );
          }
          const chosen = await page.locator('.prefs__nav [aria-selected="true"]').innerText();
          const heading = await page.locator(".prefs__panel .settings__title").innerText();
          if (chosen !== expected[i] || heading !== expected[i]) {
            throw new Error(
              `on ${expected[i]}: the list chose "${chosen}" and the section shows "${heading}"`,
            );
          }
          const stops = await page.locator('.prefs__nav [role="tab"][tabindex="0"]').count();
          if (stops !== 1) throw new Error(`${stops} sections are Tab stops; the list is one`);
          await visible(page, ".prefs__panel .settings", { minWidth: 300, minHeight: 60 });
          await audit(page, `settings · ${expected[i].toLowerCase()}`);
        }
        await page.keyboard.press("ArrowDown");
        if ((await focused(page)).text !== "General")
          throw new Error("↓ on About did not wrap to General");
        await page.keyboard.press("End");
        if ((await focused(page)).text !== "About") throw new Error("End did not reach About");
        await page.keyboard.press("Home");

        // Tab leaves the list for the section; ⇧⇥ comes back to the CHOSEN tab.
        await page.keyboard.press("Tab");
        if (!(await page.evaluate(() => !!document.activeElement?.closest(".prefs__panel")))) {
          throw new Error(`Tab from the section list went to ${(await focused(page)).desc}`);
        }
        await page.keyboard.press("Shift+Tab");
        if ((await focused(page)).text !== "General") {
          throw new Error(`⇧⇥ from the section went to ${(await focused(page)).desc}`);
        }
        // And Tab from the sheet's last control wraps to the chosen section, not
        // to the first tab — a stop the list deliberately gave up.
        await page.keyboard.press("ArrowDown");
        await page.locator(".sheet__foot .btn", { hasText: "Done" }).focus();
        await page.keyboard.press("Tab");
        if ((await focused(page)).text !== "Appearance") {
          throw new Error(
            `Tab from Done wrapped to ${(await focused(page)).desc}, not the chosen section`,
          );
        }
        await page.keyboard.press("Escape");
        await page.waitForSelector(".sheet", { state: "detached", timeout: 5000 });
      },
    },
    {
      // A bare ⌘, reopens wherever the writer last was. (openSettings(section)
      // is the designer's way back to Settings › Formats: "formats · designer".)
      name: "settings · deep link",
      feature: "app",
      async run(page) {
        await page.keyboard.press("Meta+Comma");
        await page.waitForSelector(".prefs", { timeout: 5000 });
        await page.locator('.prefs__nav [role="tab"]', { hasText: "Formats" }).click();
        await page.waitForSelector(".formatlist", { timeout: 5000 });
        await page.keyboard.press("Escape");
        await page.waitForSelector(".sheet", { state: "detached", timeout: 5000 });
        await page.keyboard.press("Meta+Comma");
        await page.waitForSelector(".prefs", { timeout: 5000 });
        const chosen = await page.locator('.prefs__nav [aria-selected="true"]').innerText();
        if (chosen !== "Formats")
          throw new Error(`⌘, reopened Settings on ${chosen}, not where it was left`);
        await page.locator('.prefs__nav [role="tab"]', { hasText: "Keyboard Shortcuts" }).click();
        await page.waitForSelector(".keysheet", { timeout: 5000 });
        if ((await page.locator(".prefs .keysheet").count()) !== 1)
          throw new Error("Shortcuts did not open inside Settings");
        await page.keyboard.press("Escape");
        await page.waitForSelector(".sheet", { state: "detached", timeout: 5000 });
      },
    },
    {
      // The accent swatches are a radio group: one Tab stop, and an arrow moves
      // AND chooses, recolouring the document on the way.
      name: "keyboard · accent",
      feature: "app",
      async run(page) {
        await page.keyboard.press("Meta+Comma");
        await page.waitForSelector(".prefs", { timeout: 5000 });
        await page.locator('.prefs__nav [role="tab"]', { hasText: "Appearance" }).click();
        // Scoped to the swatches: the inspector's card colours are a radio group too.
        const stops = await page
          .locator('.settings__swatches [role="radio"][tabindex="0"]')
          .count();
        if (stops !== 1)
          throw new Error(`${stops} accent swatches are Tab stops; the group is one`);
        await page.locator('.settings__swatches [role="radio"][aria-checked="true"]').focus();
        const accent = () => page.evaluate(() => document.documentElement.dataset.accent);
        if ((await accent()) !== "gilt")
          throw new Error(`the fixture opened on ${await accent()}, not gilt`);
        await page.keyboard.press("ArrowRight");
        const moved = await focused(page);
        if ((await accent()) !== "velvet" || moved.role !== "radio") {
          throw new Error(`→ left the accent on ${await accent()} with focus on ${moved.desc}`);
        }
        await audit(page, "settings · appearance under velvet");
        await page.keyboard.press("ArrowLeft");
        if ((await accent()) !== "gilt") throw new Error(`← left the accent on ${await accent()}`);
        await page.keyboard.press("Escape");
        await page.waitForSelector(".sheet", { state: "detached", timeout: 5000 });
      },
    },
    {
      // Follow Mac takes the Mac's accent (accent.rs) and derives the tokens
      // from it (ui/system-accent.ts); it was one fixed blue that said it
      // followed macOS. The dev vault stands in for the Mac, as if the writer
      // changed the colour in System Settings and came back. Each colour is
      // audited, so a derivation that lets text slip under 4.5:1 fails here.
      name: "settings · Follow Mac takes the Mac's accent",
      feature: "app",
      devMock: true,
      async run(page) {
        await page.keyboard.press("Meta+Comma");
        await page.waitForSelector(".prefs", { timeout: 5000 });
        await page.locator('.prefs__nav [role="tab"]', { hasText: "Appearance" }).click();
        await page.locator('.settings__swatches [role="radio"][aria-checked="true"]').focus();
        await page.keyboard.press("End");
        const root = () =>
          page.evaluate(() => ({
            accent: document.documentElement.dataset.accent,
            warm: document.documentElement.dataset.accentWarm ?? null,
            fill: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
            swatch: getComputedStyle(
              document.querySelector('.settings__swatches [aria-label="Follow Mac"]'),
            ).backgroundColor,
            name: document.querySelector(".settings__accentname")?.textContent ?? "",
          }));
        if ((await root()).accent !== "system" || !/^Follow Mac/.test((await root()).name)) {
          throw new Error(`End chose ${JSON.stringify(await root())}, not Follow Mac`);
        }
        try {
          for (const [hex, warm] of [
            ["#f7821b", true],
            ["#62ba46", false],
            ["#ffc600", true],
            ["#8c8c8c", false],
          ]) {
            await page.evaluate((h) => window.__prosceniumSystemAccent(h), hex);
            const rgb = `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
            await until(
              page,
              `the swatch in ${hex}`,
              (want) =>
                getComputedStyle(
                  document.querySelector('.settings__swatches [aria-label="Follow Mac"]'),
                ).backgroundColor === want,
              rgb,
            );
            const now = await root();
            if ((now.warm === "true") !== warm) throw new Error(`${hex} left warm=${now.warm}`);
            if (["#0a66e0", "#6fa6f5"].includes(now.fill))
              throw new Error(`${hex} left the stand-in blue on --accent`);
            await audit(page, `settings · Follow Mac in ${hex}`);
          }
        } finally {
          await page.evaluate(() => window.__prosceniumSystemAccent(null));
          await page.locator('.settings__swatches [role="radio"][aria-checked="true"]').focus();
          await page.keyboard.press("Home");
        }
        await until(page, "gilt again", () => document.documentElement.dataset.accent === "gilt");
        await page.keyboard.press("Escape");
        await page.waitForSelector(".sheet", { state: "detached", timeout: 5000 });
      },
    },
    {
      name: "interface text reaches 200 percent without changing the page",
      feature: "ui",
      async run(page) {
        const pageSize = await page.evaluate(
          () => getComputedStyle(document.querySelector(".play-page")).fontSize,
        );
        await page.keyboard.press("Meta+Comma");
        await page.waitForSelector(".prefs");
        await page.locator('.prefs__nav [role="tab"]', { hasText: "Appearance" }).click();
        await page.evaluate(() => {
          const field = document.querySelector('.prefs [aria-label="Text size"]');
          field.value = "200";
          field.dispatchEvent(new Event("change", { bubbles: true }));
        });
        await until(
          page,
          "interface text to double",
          () => getComputedStyle(document.querySelector(".prefs__tab")).fontSize === "26px",
        );
        await audit(page, "settings at 200 percent");
        const clipped = await page.evaluate(() =>
          [...document.querySelectorAll(".prefs__tab, .settings__rowlabel, .sheet__foot .btn")]
            .filter(
              (el) => el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2,
            )
            .map((el) => el.textContent),
        );
        if (clipped.length) throw new Error(`enlarged settings clipped ${JSON.stringify(clipped)}`);
        await page.keyboard.press("Escape");
        if (
          (await page.evaluate(
            () => getComputedStyle(document.querySelector(".play-page")).fontSize,
          )) !== pageSize
        ) {
          throw new Error("interface text scaling changed script typography");
        }
        await page.locator(".doctitle").click();
        await page.waitForSelector(".menu");
        const menuSize = await page.evaluate(
          () => getComputedStyle(document.querySelector(".menu__item")).fontSize,
        );
        if (menuSize !== "26px") throw new Error(`enlarged menu text is ${menuSize}`);
        await page.keyboard.press("End");
        const reached = await page.evaluate(() => {
          const menu = document.querySelector(".menu"),
            row = document.activeElement;
          return (
            menu.contains(row) &&
            row.getBoundingClientRect().bottom <= menu.getBoundingClientRect().bottom
          );
        });
        if (!reached) throw new Error("the enlarged menu's final item is not keyboard reachable");
        await audit(page, "menu at 200 percent");
        await page.keyboard.press("Escape");
        if (!(await page.locator(".commentsfeed").count()))
          await page.keyboard.press("Meta+Shift+KeyC");
        await page.waitForSelector(".commentsfeed");
        const contained = await page.evaluate(() => {
          const head = document.querySelector(".commentsfeed__head");
          const box = head.getBoundingClientRect();
          return [...head.children].every((child) => {
            const r = child.getBoundingClientRect();
            return (
              r.top >= box.top &&
              r.bottom <= box.bottom &&
              r.left >= box.left &&
              r.right <= box.right
            );
          });
        });
        if (!contained) throw new Error("the enlarged comments controls escaped their header");
        await audit(page, "comments at 200 percent");
        await page.keyboard.press("Meta+Shift+KeyC");
        await page.keyboard.press("Meta+Comma");
        await page.waitForSelector(".prefs");
        const stored = await page.locator('.prefs [aria-label="Text size"]').inputValue();
        if (stored !== "200") throw new Error(`reopened text size is ${stored}`);
        await page.evaluate(() => {
          const field = document.querySelector('.prefs [aria-label="Text size"]');
          field.value = "100";
          field.dispatchEvent(new Event("change", { bubbles: true }));
        });
        await until(
          page,
          "interface text to return to its original size",
          () => getComputedStyle(document.querySelector(".prefs__tab")).fontSize === "13px",
        );
        await page.keyboard.press("Escape");
      },
    },
    {
      // One setting, two switches: the document menu's Check Spelling as You
      // Type and Settings › Writing must never show different states.
      name: "settings · spell check in step",
      feature: "spell",
      async run(page) {
        const menuChecked = async () => {
          await page.locator(".doctitle").click();
          await page.waitForSelector(".menu", { timeout: 5000 });
          const row = page.locator('.menu__item[role="menuitemcheckbox"]', {
            hasText: "Check Spelling as You Type",
          });
          const checked = await row.getAttribute("aria-checked");
          return { row, checked };
        };
        const settingsSwitch = () =>
          page.getByRole("switch", { name: "Check spelling as you type" });

        await page.keyboard.press("Meta+Comma");
        await page.waitForSelector(".prefs", { timeout: 5000 });
        await page.locator('.prefs__nav [role="tab"]', { hasText: "Writing" }).click();
        if ((await settingsSwitch().getAttribute("aria-checked")) !== "true") {
          throw new Error("spell check did not start on");
        }
        await settingsSwitch().focus();
        await page.keyboard.press("Space");
        if ((await settingsSwitch().getAttribute("aria-checked")) !== "false") {
          throw new Error("Space did not switch spell check off");
        }
        await page.keyboard.press("Escape");
        await page.waitForSelector(".sheet", { state: "detached", timeout: 5000 });

        const off = await menuChecked();
        if (off.checked !== "false")
          throw new Error(`Settings switched it off; the menu says aria-checked=${off.checked}`);
        await off.row.click();
        await page.waitForSelector(".menu", { state: "detached", timeout: 5000 });

        await page.keyboard.press("Meta+Comma");
        await page.waitForSelector(".prefs", { timeout: 5000 });
        if ((await settingsSwitch().getAttribute("aria-checked")) !== "true") {
          throw new Error("the menu switched spell check back on; Settings still shows it off");
        }
        await page.keyboard.press("Escape");
        await page.waitForSelector(".sheet", { state: "detached", timeout: 5000 });
      },
    },
    {
      // Settings › Updates: automatic checks start on, a switch turns them off,
      // and the note says what the switch does in either state (release-
      // engineering docs/engineering/release-engineering.md#REL-D6). In the real app the switch is written to settings.json
      // by settings.rs.
      name: "settings · updates",
      feature: "app",
      async run(page) {
        await page.keyboard.press("Meta+Comma");
        await page.waitForSelector(".prefs", { timeout: 5000 });
        await page.locator('.prefs__nav [role="tab"]', { hasText: "Updates" }).click();
        const automatic = () =>
          page.getByRole("switch", { name: "Check for updates automatically" });
        if ((await automatic().getAttribute("aria-checked")) !== "true") {
          throw new Error("automatic update checks did not start on");
        }
        await visible(page, ".prefs__panel .settings__row .btn", { minWidth: 40, minHeight: 18 });
        await automatic().focus();
        await page.keyboard.press("Space");
        if ((await automatic().getAttribute("aria-checked")) !== "false") {
          throw new Error("Space did not switch automatic update checks off");
        }
        // The note says what the switch does whichever way it is set; off is its opposite.
        const note = await page.locator(".prefs__panel .settings__note").first().innerText();
        if (!/once a day/.test(note)) throw new Error(`with checks off, the note reads "${note}"`);
        await audit(page, "settings · updates, automatic off");
        await page.keyboard.press("Space");
        if ((await automatic().getAttribute("aria-checked")) !== "true") {
          throw new Error("Space did not switch automatic update checks back on");
        }
        // The track (docs/app/preferences-and-help/settings.md#SET-37): stable unless chosen, a sentence
        // saying what each brings, and Alpha not offered to a copy with no key
        // (docs/app/preferences-and-help/settings.md#SET-37).
        if (!/Stable/.test(await trackLabel(page)))
          throw new Error(`the update track does not start on Stable: "${await trackLabel(page)}"`);
        if (!(await page.evaluate(settingsSays, "Each new release.")))
          throw new Error("Stable does not say what it brings");
        if ((await trackChoices(page)).join() !== "Stable,Beta")
          throw new Error(`with no key, the track menu offers ${await trackChoices(page)}`);
        await chooseTrack(page, "Beta");
        await until(
          page,
          "beta's sentence",
          settingsSays,
          "Each new release, and test versions of it before it comes out.",
        );
        await chooseTrack(page, "Stable");
        await page.keyboard.press("Escape");
        await page.waitForSelector(".sheet", { state: "detached", timeout: 5000 });
        // A copy already on alpha keeps it without a key, so nobody's choice vanishes,
        // which only a relaunch reads: the next check picks it up.
        await page.evaluate(async () => {
          if (window.__TAURI_INTERNALS__)
            await window.__TAURI_INTERNALS__.invoke("update_settings", {
              patch: { updateTrack: "alpha" },
            });
          else
            localStorage.setItem(
              "proscenium:dev:settings",
              JSON.stringify({
                ...JSON.parse(localStorage.getItem("proscenium:dev:settings") ?? "{}"),
                updateTrack: "alpha",
              }),
            );
        });
        await page.reload();
      },
    },
    {
      // Alpha without a key says so and offers Stable (docs/app/preferences-and-help/settings.md#SET-38);
      // "Have a key?" opens a field, and a key adds Alpha to the menu
      // (docs/app/preferences-and-help/settings.md#SET-37). All of it from the keyboard.
      name: "settings · updates, alpha's key",
      feature: "app",
      async run(page) {
        await walkIntoPlay(page);
        await page.keyboard.press("Meta+Comma");
        await page.waitForSelector(".prefs", { timeout: 5000 });
        await page.locator('.prefs__nav [role="tab"]', { hasText: "Updates" }).click();
        await until(page, "the track to be Alpha", () =>
          (
            document
              .querySelector('.prefs__panel [aria-label^="Track"]')
              ?.getAttribute("aria-label") ?? ""
          ).includes("Alpha"),
        );
        await until(
          page,
          "alpha without a key to say so",
          settingsSays,
          "Alpha needs a key, and this copy doesn’t have one, so Proscenium isn’t checking for updates.",
        );
        if ((await trackChoices(page)).join() !== "Stable,Beta,Alpha")
          throw new Error(`on alpha with no key, the menu offers ${await trackChoices(page)}`);
        const useStable = page.getByRole("button", { name: "Use Stable" });
        await visible(page, ".prefs__panel .settings__row .btn", { minWidth: 40, minHeight: 18 });
        await audit(page, "settings · updates, alpha without a key");
        await useStable.focus();
        await page.keyboard.press("Enter");
        await until(
          page,
          "Use Stable to set Stable and hand focus to the menu",
          () => (document.activeElement?.getAttribute("aria-label") ?? "") === "Track: Stable",
        );
        if ((await trackChoices(page)).join() !== "Stable,Beta")
          throw new Error(
            `back on Stable with no key, the menu offers ${await trackChoices(page)}`,
          );

        const haveKey = page.getByRole("button", { name: "Have a key?" });
        await haveKey.focus();
        await page.keyboard.press("Enter");
        await until(
          page,
          "the key field to take focus",
          () => document.activeElement?.getAttribute("aria-label") === "Key",
        );
        await page.keyboard.type("not a key");
        await page.keyboard.press("Enter");
        await until(
          page,
          "a malformed key to be refused in words",
          () =>
            document.querySelector("#alpha-key-problem")?.textContent ===
            "That isn’t a key. Check that all of it was copied.",
        );
        await audit(page, "settings · updates, a key refused");
        await page.locator('.prefs__panel input[aria-label="Key"]').fill(SMOKE_TRACK_KEY);
        await page.keyboard.press("Enter");
        await until(page, "a key to hand focus to the menu", () =>
          (document.activeElement?.getAttribute("aria-label") ?? "").startsWith("Track"),
        );
        await absent(
          page,
          '.prefs__panel input[aria-label="Key"]',
          "the key field went once a key was added",
        );
        if ((await trackChoices(page)).join() !== "Stable,Beta,Alpha")
          throw new Error(`with a key, the menu offers ${await trackChoices(page)}`);
        await chooseTrack(page, "Alpha");
        await until(
          page,
          "alpha's sentence",
          settingsSays,
          "Every change to Proscenium as soon as it passes its tests. Checks every hour.",
        );
        const automaticNote = await page
          .locator(".prefs__panel .settings__note")
          .first()
          .innerText();
        if (!/every hour/.test(automaticNote))
          throw new Error(`on alpha, the automatic checks' note reads "${automaticNote}"`);
        await audit(page, "settings · updates, alpha track");
        await chooseTrack(page, "Stable");
        await page.keyboard.press("Escape");
        await page.waitForSelector(".sheet", { state: "detached", timeout: 5000 });
      },
    },
    {
      // Settings › Privacy (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D3): the reports switch
      // starts on, goes off from the keyboard, and the section says what is
      // sent, what never is, and that off drops what was waiting.
      name: "settings · privacy",
      feature: "app",
      async run(page) {
        await page.keyboard.press("Meta+Comma");
        await page.waitForSelector(".prefs", { timeout: 5000 });
        await page.locator('.prefs__nav [role="tab"]', { hasText: "Privacy" }).click();
        const reports = () =>
          page.getByRole("switch", { name: "Share anonymous usage and crash reports" });
        if ((await reports().getAttribute("aria-checked")) !== "true") {
          throw new Error("usage and crash reports did not start on");
        }
        const words = (await page.locator(".prefs__panel .settings__note").allInnerTexts()).join(
          "\n",
        );
        for (const said of [
          /Crash reports include stack traces and the kind of failure/,
          /Never includes your writing, titles, character names, file names/,
          /discards reports that haven’t been sent/,
        ]) {
          if (!said.test(words)) throw new Error(`Settings › Privacy does not say ${said}`);
        }
        const policy = page.getByRole("button", { name: "Read the Privacy Policy" });
        const policyBox = await policy.boundingBox();
        if (!policyBox || policyBox.width < 20 || policyBox.height < 20)
          throw new Error("Privacy Policy button has no usable box");
        await policy.focus();
        if (!(await policy.evaluate((el) => el === document.activeElement)))
          throw new Error("Privacy Policy link is not keyboard reachable");
        await reports().focus();
        await page.keyboard.press("Space");
        if ((await reports().getAttribute("aria-checked")) !== "false") {
          throw new Error("Space did not switch usage and crash reports off");
        }
        await audit(page, "settings · privacy, reports off");
        await page.keyboard.press("Space");
        if ((await reports().getAttribute("aria-checked")) !== "true") {
          throw new Error("Space did not switch usage and crash reports back on");
        }
        await page.keyboard.press("Escape");
        await page.waitForSelector(".sheet", { state: "detached", timeout: 5000 });
      },
    },
    {
      // A store copy has no updater (Updates.tsx): the store updates it, so it
      // shows no switch, no Check Now and no note about where checks go, and
      // Privacy points it at no update setting. Mock-only: the state is the
      // dev vault's to choose; the check puts back the one it found.
      name: "settings · a store copy offers no update controls",
      feature: "app",
      devMock: true,
      async run(page) {
        const was = await page.evaluate(() =>
          window.__prosceniumUpdateState({ kind: "unavailable" }),
        );
        try {
          await page.keyboard.press("Meta+Comma");
          await page.waitForSelector(".prefs", { timeout: 5000 });
          await page.locator('.prefs__nav [role="tab"]', { hasText: "Updates" }).click();
          await until(page, "the store copy's sentence", () =>
            /come from the App Store/.test(
              document.querySelector(".prefs__panel")?.textContent ?? "",
            ),
          );
          if (await page.locator('.prefs__panel [role="switch"]').count())
            throw new Error("a store copy offers the automatic switch");
          if (await page.locator(".prefs__panel .btn", { hasText: "Check Now" }).count())
            throw new Error("a store copy offers Check Now");
          const updates = await page.locator(".prefs__panel").innerText();
          if (/proscenium\.ink|once a day/.test(updates))
            throw new Error(`a store copy describes the updater: ${updates}`);
          await audit(page, "settings · updates, store copy");
          await page.locator('.prefs__nav [role="tab"]', { hasText: "Privacy" }).click();
          const privacy = await page.locator(".prefs__panel").innerText();
          if (/separate setting, in Updates/.test(privacy))
            throw new Error("Privacy points a store copy at an update setting");
          await page.keyboard.press("Escape");
          await page.waitForSelector(".sheet", { state: "detached", timeout: 5000 });
        } finally {
          await page.evaluate((state) => window.__prosceniumUpdateState(state), was);
        }
      },
    },
    {
      // A status already in the list, added or renamed to, was refused with the
      // reason said to VoiceOver alone: on screen, Add Status did nothing and a
      // rename snapped back. The reason shows under the field now, and goes when
      // the writer types. The dictionary does the same for a word it has.
      name: "settings · a refused status or word says why",
      feature: "app",
      async run(page) {
        await page.keyboard.press("Meta+Comma");
        await page.waitForSelector(".prefs", { timeout: 5000 });
        await page.locator('.prefs__nav [role="tab"]', { hasText: "General" }).click();
        await page.waitForSelector(".statuslist__row", { timeout: 5000 });
        const rows = () =>
          page.evaluate(() =>
            [...document.querySelectorAll(".statuslist__row")]
              .map((r) => r.dataset.status)
              .join("|"),
          );
        const problem = async () =>
          (await page.locator(".prefs__panel .settings__problem").first().innerText()).trim();
        const before = await rows();

        // Added again, in another case: refused, said, and the typing kept.
        const add = page.locator('.statuslist__add input[aria-label="New status"]');
        await add.focus();
        await page.keyboard.type("Idea");
        await page.keyboard.press("Enter");
        await until(
          page,
          "the refusal on screen",
          () => !!document.querySelector(".prefs__panel .settings__problem")?.textContent,
        );
        if (!/^“Idea” is already in the list\.$/.test(await problem()))
          throw new Error(`a repeated status says "${await problem()}"`);
        if ((await add.inputValue()) !== "Idea")
          throw new Error("the refused name was taken out of the field");
        if ((await rows()) !== before) throw new Error("a repeated status changed the list");
        await visible(page, ".prefs__panel .settings__problem", { minWidth: 100, minHeight: 10 });
        await audit(page, "settings · a refused status");
        await page.keyboard.type("s");
        if (await problem()) throw new Error("the refusal stayed after the writer typed");
        await page.keyboard.press("Meta+a");
        await page.keyboard.press("Backspace");

        // Renamed to one it already has: it keeps its name, and says why.
        const drafting = page.locator(
          '.statuslist__row[data-status="drafting"] [data-part="name"]',
        );
        await drafting.focus();
        await page.keyboard.press("Meta+a");
        await page.keyboard.type("idea");
        await page.keyboard.press("Enter");
        await until(page, "the rename's refusal", () =>
          /keeps its name/.test(
            document.querySelector(".prefs__panel .settings__problem")?.textContent ?? "",
          ),
        );
        if (
          !/^“idea” is already in the list, so “drafting” keeps its name\.$/.test(await problem())
        ) {
          throw new Error(`a refused rename says "${await problem()}"`);
        }
        if ((await drafting.inputValue()) !== "drafting" || (await rows()) !== before)
          throw new Error("a refused rename changed the list");

        // A word the dictionary already has.
        await page.locator('.prefs__nav [role="tab"]', { hasText: "Writing" }).click();
        const word = page.locator('.prefs__panel input[aria-label="Word or name to add"]');
        await word.focus();
        await page.keyboard.type("Smokewordle");
        await page.keyboard.press("Enter");
        await until(page, "the word in the list", () =>
          [...document.querySelectorAll(".settings__words .capsule")].some((c) =>
            c.textContent.includes("Smokewordle"),
          ),
        );
        await word.focus();
        await page.keyboard.type("smokewordle");
        await page.keyboard.press("Enter");
        await until(page, "the word's refusal", () =>
          /already in the dictionary/.test(
            document.querySelector(".prefs__panel .settings__problem")?.textContent ?? "",
          ),
        );
        if (!/^“smokewordle” is already in the dictionary\.$/.test(await problem()))
          throw new Error(`a repeated word says "${await problem()}"`);
        if ((await word.inputValue()) !== "smokewordle")
          throw new Error("the repeated word was taken out of the field");
        await audit(page, "settings · a refused word");
        await page.keyboard.press("Meta+a");
        await page.keyboard.press("Backspace");
        await page.getByRole("button", { name: "Remove “Smokewordle”" }).click();
        await page.keyboard.press("Escape");
        await page.waitForSelector(".sheet", { state: "detached", timeout: 5000 });
      },
    },
    {
      name: "published formats share editor and print geometry",
      feature: "format",
      async run(page) {
        for (const name of [
          "UK / International (BBC)",
          "Samuel French / Concord — Manuscript",
          "Dramatists Guild — Traditional",
          "Dramatists Guild — Musical",
          "Proscenium House",
          "Sketch Comedy — Sketchworks",
        ]) {
          await openFromDocumentMenu(page, name);
          await page.waitForTimeout(300);
          await visible(page, ".play-page", { minWidth: 300, minHeight: 200 });
          if (name.startsWith("UK")) {
            const joins = await page.evaluate(() =>
              [...document.querySelectorAll(".pm-beside")].map((cue) => {
                const next = cue.nextElementSibling;
                return {
                  cue: cue.textContent,
                  a: cue.getBoundingClientRect().top,
                  b: next?.getBoundingClientRect().top,
                  right: cue.getBoundingClientRect().right,
                  left: next?.getBoundingClientRect().left,
                };
              }),
            );
            if (!joins.length) throw new Error("UK format has no cues beside their speeches");
            for (const join of joins) {
              if (Math.abs(join.a - join.b) > 1 || join.right > join.left + 1)
                throw new Error(`UK columns disagree: ${JSON.stringify(join)}`);
            }
            const runIns = await page.evaluate(() =>
              [...document.querySelectorAll(".pm-run-in")].map((direction) => {
                const next = direction.nextElementSibling;
                const range = document.createRange();
                const text = document.createTreeWalker(next, NodeFilter.SHOW_TEXT).nextNode();
                if (!text) return null;
                range.setStart(text, 0);
                range.setEnd(text, 1);
                return {
                  direction: direction.getBoundingClientRect().top,
                  dialogue: range.getBoundingClientRect().top,
                };
              }),
            );
            for (const run of runIns)
              if (run && Math.abs(run.direction - run.dialogue) > 3)
                throw new Error(
                  `UK parenthetical did not run into dialogue: ${JSON.stringify(run)}`,
                );
          }
          let opening = null;
          if (name.startsWith("Sketch")) {
            await visible(page, ".pgchrome--intro", { minWidth: 100, minHeight: 30 });
            opening = await page.evaluate(() => {
              if (document.querySelector("[data-front-kind]"))
                throw new Error("sketch still has separate front sheets");
              const intro = document.querySelector(".pgchrome--intro");
              const first = document.querySelector(".pm-after-intro");
              if (!first) throw new Error("sketch has no body after its opening");
              // Rects include page zoom; computed line-height does not.
              const pitch = intro.querySelector(".frontsheet__line").getBoundingClientRect().height;
              const rows =
                (first.getBoundingClientRect().top - intro.getBoundingClientRect().top) / pitch;
              const texts = [...intro.querySelectorAll(".frontsheet__line")].map(
                (el) => el.textContent,
              );
              if (!texts.some((text) => text.startsWith("Characters:")))
                throw new Error("sketch has no inline cast");
              if (first.getBoundingClientRect().top < intro.getBoundingClientRect().bottom - 1)
                throw new Error("sketch body overlaps its opening");
              return { rows, texts, first: first.textContent };
            });
          }
          await audit(page, name);
          await openFromDocumentMenu(page, /Export PDF/);
          await visible(page, ".exportpanel__paper", { minWidth: 100, minHeight: 100 });
          if (opening) {
            await page.evaluate((opening) => {
              const paper = document.querySelector(".exportpanel__pane .exportpanel__paper");
              const lines = [...paper.querySelectorAll(".exportpanel__line")];
              for (const text of opening.texts)
                if (!lines.some((line) => line.textContent === text))
                  throw new Error(`sketch export lost ${text}`);
              const first = lines.find((line) => line.textContent === opening.first);
              const match = first?.style.top.match(/calc\(([\d.]+)/);
              if (!match || Math.abs(Number(match[1]) - opening.rows) > 0.1)
                throw new Error(
                  `sketch editor and export rows disagree: ${opening.rows}, ${first?.style.top}`,
                );
              if (document.querySelector('.exportpanel__rail [data-sheet^="front-"]'))
                throw new Error("sketch export added front sheets");
            }, opening);
          }
          await audit(page, `${name} export`);
          await page.keyboard.press("Escape");
        }
        await openFromDocumentMenu(page, "Samuel French / Concord — Manuscript");
        const original = await page.evaluate(() => {
          const editor = document.querySelector(".ProseMirror").editor;
          const original = editor.getJSON();
          editor.commands.setContent({
            type: "doc",
            content: [
              { type: "character", content: [{ type: "text", text: "NELL" }] },
              {
                type: "dialogue",
                content: [{ type: "text", text: "A continuing speech. ".repeat(300) }],
              },
            ],
          });
          return original;
        });
        try {
          await until(
            page,
            "a manuscript continuation cue",
            () => document.querySelector(".pgchrome__contd")?.textContent === "NELL (Cont.)",
          );
          const casing = await page.evaluate(
            () => getComputedStyle(document.querySelector(".pgchrome__contd")).textTransform,
          );
          if (casing !== "none")
            throw new Error("the continued cue changed the published marker's case");
        } finally {
          await page.evaluate(
            (original) =>
              document.querySelector(".ProseMirror").editor.commands.setContent(original),
            original,
          );
        }
        await openFromDocumentMenu(page, "Dramatists Guild — Modern");
      },
    },
    {
      name: "sketch opening edits and overflow share editor and export sheets",
      feature: "layout",
      async run(page) {
        await openFromDocumentMenu(page, "Sketch Comedy — Sketchworks");
        await openFromDocumentMenu(page, /Edit Opening Pages/);
        await until(
          page,
          "opening editor ready",
          () =>
            document.querySelector('[aria-label="Opening notes text"] .ProseMirror')?.editor
              ?.isInitialized,
        );
        const original = await page
          .locator('[aria-label="Opening notes text"] .ProseMirror')
          .innerText();
        const setting = "A very long queue outside a ticket office. ".repeat(200) + "OPENING-END";
        await page.locator('[aria-label="Opening notes text"] .ProseMirror').fill(setting);
        await page.locator(".sheet__foot .btn", { hasText: /^Save$/ }).click();
        try {
          await until(page, "the long sketch opening", () =>
            document.querySelector(".pgchrome--intro")?.textContent.includes("OPENING-END"),
          );
          const expected = await page.evaluate(() => {
            const sheets = [...document.querySelectorAll(".pgchrome--intro > .frontsheet")];
            if (sheets.length < 2) throw new Error("long opening did not continue");
            for (const sheet of sheets) {
              const box = sheet.getBoundingClientRect();
              for (const line of sheet.querySelectorAll(".frontsheet__line")) {
                const r = line.getBoundingClientRect();
                if (
                  r.top < box.top - 1 ||
                  r.bottom > box.bottom + 1 ||
                  r.left < box.left - 1 ||
                  r.right > box.right + 1
                )
                  throw new Error("opening line escaped its page");
              }
            }
            const intro = document.querySelector(".pgchrome--intro");
            const body = document.querySelector(".pm-after-intro");
            if (body.getBoundingClientRect().top < intro.getBoundingClientRect().bottom - 1)
              throw new Error("body overlaps opening");
            return {
              total: document.querySelector(".ProseMirror").editor.storage.pagination.total,
              openingPages: sheets.length,
            };
          });
          await openFromDocumentMenu(page, /Export PDF/);
          const sheets = await page.locator(".exportpanel__rail [data-sheet]").count();
          if (sheets !== expected.total)
            throw new Error(`editor counts ${expected.total}, export counts ${sheets}`);
          const text = await page.locator(".exportpanel__pane").innerText();
          if (!text.includes("OPENING-END")) throw new Error("export lost the end of the opening");
          await audit(page, "sketch opening overflow export");
          await page.keyboard.press("Escape");
        } finally {
          if (await page.locator(".sheet").count()) await page.keyboard.press("Escape");
          await openFromDocumentMenu(page, /Edit Opening Pages/);
          await until(
            page,
            "opening editor ready to restore",
            () =>
              document.querySelector('[aria-label="Opening notes text"] .ProseMirror')?.editor
                ?.isInitialized,
          );
          await page.locator('[aria-label="Opening notes text"] .ProseMirror').fill(original);
          await page.locator(".sheet__foot .btn", { hasText: /^Save$/ }).click();
          await until(
            page,
            "restored sketch opening",
            () => !document.querySelector(".pgchrome--intro")?.textContent.includes("OPENING-END"),
          );
          await openFromDocumentMenu(page, "Dramatists Guild — Modern");
        }
      },
    },
    {
      name: "play language is keyboard accessible and persists",
      feature: "spell",
      async run(page) {
        await openFromDocumentMenu(page, "Play Language…");
        await page.getByRole("button", { name: /^Language:/ }).click();
        await page.locator(".menu__item", { hasText: "English (UK)" }).click();
        await audit(page, "Play Language");
        await page.getByRole("button", { name: "Save" }).focus();
        await page.keyboard.press("Enter");
        await until(
          page,
          "British play language",
          () => document.querySelector(".editor-surface")?.lang === "en-GB",
        );
        await openFromDocumentMenu(page, /Export PDF/);
        const language = await page.getByRole("textbox", { name: "Play language" }).inputValue();
        if (language !== "en-GB") throw new Error(`PDF language stayed ${language}`);
        await page.keyboard.press("Escape");
        await openFromDocumentMenu(page, "Play Language…");
        await page.getByRole("button", { name: /^Language:/ }).click();
        await page.locator(".menu__item", { hasText: "English (US)" }).click();
        await page.getByRole("button", { name: "Save" }).click();
        await until(
          page,
          "American play language restored",
          () => document.querySelector(".editor-surface")?.lang === "en-US",
        );
      },
    },
    {
      name: "changing language rechecks spelling without changing the script",
      feature: "spell",
      async run(page) {
        const original = await page.evaluate(() => {
          const editor = document.querySelector(".ProseMirror").editor;
          const original = editor.getJSON();
          editor.commands.insertContentAt(editor.state.doc.content.size, {
            type: "action",
            content: [{ type: "text", text: "colour color honour honor" }],
          });
          return original;
        });
        const choose = async (label) => {
          await openFromDocumentMenu(page, "Play Language…");
          await page.getByRole("button", { name: /^Language:/ }).click();
          await page.locator(".menu__item", { hasText: label }).click();
        };
        try {
          await until(page, "American spelling", () => {
            const node = [...document.querySelectorAll(".pl-action")].find(
              (node) => node.textContent === "colour color honour honor",
            );
            return (
              [...(node?.querySelectorAll(".pl-misspelled") ?? [])]
                .map((n) => n.textContent)
                .join("|") === "colour|honour"
            );
          });
          await choose("English (UK)");
          await page.getByRole("button", { name: "Save" }).click();
          await until(page, "British spelling", () => {
            const node = [...document.querySelectorAll(".pl-action")].find(
              (node) => node.textContent === "colour color honour honor",
            );
            return (
              [...(node?.querySelectorAll(".pl-misspelled") ?? [])]
                .map((n) => n.textContent)
                .join("|") === "color|honor"
            );
          });
          await choose("Another Language");
          await page.getByRole("textbox", { name: "Language code" }).fill("fr");
          await page.getByRole("button", { name: "Save" }).click();
          await until(
            page,
            "unsupported spelling cleared",
            () =>
              document.querySelector(".editor-surface")?.lang === "fr" &&
              !document.querySelector(".pl-misspelled"),
          );
          const unchanged = await page.evaluate(() =>
            [...document.querySelectorAll(".pl-action")].some(
              (n) => n.textContent === "colour color honour honor",
            ),
          );
          if (!unchanged) throw new Error("language selection changed the script");
        } finally {
          await choose("English (US)");
          await page.getByRole("button", { name: "Save" }).click();
          await page.evaluate(
            (original) =>
              document.querySelector(".ProseMirror").editor.commands.setContent(original),
            original,
          );
        }
      },
    },
    {
      // Settings › Formats: every format, what can be done with each, and the
      // format new plays start in.
      name: "formats · settings",
      feature: "format",
      async run(page) {
        await page.keyboard.press("Meta+Comma");
        await page.waitForSelector(".prefs", { timeout: 5000 });
        await page.locator('.prefs__nav [role="tab"]', { hasText: "Formats" }).click();
        await page.waitForSelector(".formatlist", { timeout: 5000 });
        const names = await page.locator(".formatlist__name").allInnerTexts();
        if (!names.includes("Dramatists Guild — Modern") || names.length < 2) {
          throw new Error(`the formats list reads ${names.join(" · ")}`);
        }
        await visible(page, ".formatlist__row", { minWidth: 300, minHeight: 24 });
        // Its own name, not "settings · every section"'s: a surface is audited
        // by one check, so a pass that leaves the other out numbers it the same.
        await audit(page, "formats · settings");
        await page.keyboard.press("Escape");
        await page.waitForSelector(".sheet", { state: "detached", timeout: 5000 });
      },
    },
    {
      // Part B's "done when", from the keyboard: duplicate DG Modern, move the
      // cue and see the preview move with it, put the page number in the footer
      // from the token menu, refuse a value that is not a number, save with ⌘S,
      // and use the format for the play.
      name: "formats · designer",
      feature: "format",
      async run(page) {
        try {
          await this.body(page);
        } finally {
          await closeDesigner(page);
        }
      },
      async body(page) {
        await page.keyboard.press("Meta+Comma");
        await page.waitForSelector(".prefs", { timeout: 5000 });
        await page.locator('.prefs__nav [role="tab"]', { hasText: "Formats" }).click();
        await page.getByRole("button", { name: "Duplicate “Dramatists Guild — Modern”" }).click();
        await page.waitForSelector(".designer", { timeout: 10000 });
        await visible(page, ".designer__form", { minWidth: 300, minHeight: 300 });
        await visible(page, ".designer__pane", { minWidth: 400, minHeight: 300 });
        await visible(page, ".designer__page .exportpanel__line", { minWidth: 10, minHeight: 4 });
        const pages = await page.locator(".designer__page").count();
        if (pages < 3) throw new Error(`the sampler laid out ${pages} pages`);
        if ((await focused(page)).id !== "dz-name") {
          throw new Error(`the designer opened with focus on ${(await focused(page)).desc}`);
        }
        await audit(page, "format designer");

        await page.keyboard.press("Meta+a");
        await page.keyboard.type("Smoke House");

        // The pages say where the cue is, in words, before and after it moves.
        const described = () =>
          page.evaluate(() =>
            [...document.querySelectorAll(".designer__page")]
              .map((p) => p.getAttribute("aria-label"))
              .join("\n"),
          );
        if (!(await described()).includes("Character at 4 inches from the left edge")) {
          throw new Error("no page says where dg-modern's cue sits");
        }
        await page.locator('[aria-controls="dz-el-character"]').focus();
        await page.keyboard.press("Enter");
        await page.waitForSelector("#dz-character-indent", { timeout: 5000 });
        await page.locator("#dz-character-indent").focus();
        await page.keyboard.press("Meta+a");
        await page.keyboard.type("3");
        await until(
          page,
          "the preview to mark the lines the change moved",
          () => document.querySelectorAll(".designer__page .exportpanel__line.is-moved").length > 0,
        );
        if (!(await described()).includes("Character at 4.5 inches from the left edge")) {
          throw new Error("the page description did not follow the cue");
        }

        // Not a number: said at the field, and Save waits.
        await page.keyboard.press("Meta+a");
        await page.keyboard.type("x");
        const problem = await page.locator("#dz-character-indent-error").innerText();
        if (problem !== "Enter a number.") throw new Error(`an indent of "x" says "${problem}"`);
        if ((await page.locator(".sheet__foot .btn--primary").getAttribute("disabled")) === null) {
          throw new Error("Save stayed enabled with a value that is not a number");
        }
        await page.keyboard.press("Meta+a");
        await page.keyboard.type("3");

        // Move the page number: out of the header's right slot, into the
        // footer's centre from the token menu rather than typed from memory.
        await page.locator("#dz-header-right").focus();
        await page.keyboard.press("Meta+a");
        await page.keyboard.press("Backspace");
        await until(
          page,
          "the header to lose its page number",
          () => !document.querySelector(".designer__page .exportpanel__header"),
        );
        await page.getByRole("button", { name: "Insert into Footer center" }).focus();
        await page.keyboard.press("Enter");
        await page.waitForSelector(".menu", { timeout: 5000 });
        await onTop(page, ".menu");
        await page.keyboard.press("Enter");
        await page.waitForSelector(".menu", { state: "detached", timeout: 5000 });
        await until(
          page,
          "{page} in the footer's centre slot",
          () => document.querySelector("#dz-footer-center")?.value === "{page}",
        );
        await until(
          page,
          "a footer on the previewed pages",
          () => !!document.querySelector(".designer__page .exportpanel__footer"),
        );

        // Act-scene-page numbering whole, from the same menu: the sheet that
        // opens ACT TWO is in Act Two from its first line
        // (docs/app/formatting/formats-and-layout.md#FMT-139,
        // docs/app/formatting/formats-and-layout.md#FMT-141).
        await page.getByRole("button", { name: "Insert into Header right" }).focus();
        await page.keyboard.press("Enter");
        await page.waitForSelector(".menu", { timeout: 5000 });
        await onTop(page, ".menu");
        await page.getByRole("menuitem", { name: /^II-3-67/ }).click();
        await page.waitForSelector(".menu", { state: "detached", timeout: 5000 });
        await until(
          page,
          "act-scene-page in the header's right slot",
          () =>
            document.querySelector("#dz-header-right")?.value === "{actRoman}-{sceneNumber}-{page}",
        );
        await until(page, "a page numbered in Act Two, scene 1", () =>
          [...document.querySelectorAll(".designer__page .exportpanel__hright")].some((el) =>
            /^II-1-\d+$/.test(el.textContent ?? ""),
          ),
        );
        const numbers = await page.evaluate(() =>
          [...document.querySelectorAll(".designer__page .exportpanel__hright")].map(
            (el) => el.textContent,
          ),
        );
        if (!numbers.every((n) => /^I{1,2}-\d+-\d+$/.test(n ?? ""))) {
          throw new Error(`the sampler's pages are numbered ${numbers.join(" · ")}`);
        }

        await page.keyboard.press("Meta+s");
        await until(page, "the format to be saved", () =>
          /Saved as smoke-house\.json/.test(
            document.querySelector(".designer__status")?.textContent ?? "",
          ),
        );
        await page.locator(".sheet__foot .btn", { hasText: "Use for This Play" }).click();
        await until(page, "the play to take the format", () =>
          document.querySelector(".sheet__foot")?.textContent?.includes("Used for This Play"),
        );

        // The open play instead of the sampler, laid out at the same values.
        await page.getByRole("switch", { name: "Preview with This Play" }).focus();
        await page.keyboard.press("Space");
        await until(page, "the preview to show the play", () =>
          /The Weight of Water/.test(
            document.querySelector(".designer__previewtitle")?.textContent ?? "",
          ),
        );
        await visible(page, ".designer__page .exportpanel__line", { minWidth: 10, minHeight: 4 });
        await audit(page, "format designer · this play");

        // Closing goes back where it came from: Settings › Formats, listing it.
        await page.keyboard.press("Escape");
        await page.waitForSelector(".designer", { state: "detached", timeout: 5000 });
        await page.waitForSelector(".formatlist", { timeout: 5000 });
        const listed = await page.locator(".formatlist__name").allInnerTexts();
        if (!listed.includes("Smoke House"))
          throw new Error(`Settings › Formats lists ${listed.join(" · ")}`);
        await page.keyboard.press("Escape");
        await page.waitForSelector(".sheet", { state: "detached", timeout: 5000 });

        await page.locator(".doctitle").click();
        await page.waitForSelector(".menu", { timeout: 5000 });
        await page.getByRole("menuitem", { name: "All Formats", exact: true }).click();
        const chosen = await page
          .locator('.menu__item[aria-checked="true"]', { hasText: "Smoke House" })
          .count();
        if (chosen !== 1)
          throw new Error("the document menu does not show Smoke House as this play's format");
        await page.keyboard.press("Escape");
        await page.keyboard.press("Escape");
        await page.waitForSelector(".menu", { state: "detached", timeout: 5000 });
      },
    },
    {
      // Closing with unsaved changes names them, and ⏎ on Keep Editing keeps
      // editing; a built-in never changes — typing into one asks to duplicate.
      name: "formats · unsaved changes and built-ins",
      feature: "format",
      async run(page) {
        try {
          await this.body(page);
        } finally {
          await closeDesigner(page);
        }
      },
      async body(page) {
        await openFromDocumentMenu(page, /Edit Current Format/);
        await page.waitForSelector(".designer", { timeout: 10000 });
        const opened = await page.locator("#dz-name").inputValue();
        if (opened !== "Smoke House")
          throw new Error(`Edit Current Format… opened "${opened}", not the play's format`);
        await page.locator("#dz-margin-left").focus();
        await page.keyboard.press("Meta+a");
        await page.keyboard.type("1.25");
        await page.keyboard.press("Escape");
        await page.waitForSelector(".alert", { timeout: 5000 });
        const body = await page.locator(".alert__body").innerText();
        if (!/the margins/.test(body)) throw new Error(`the unsaved-changes alert says "${body}"`);
        await audit(page, "format designer · unsaved changes");
        await page.locator(".alert .btn", { hasText: "Keep Editing" }).focus();
        await page.keyboard.press("Enter");
        await page.waitForSelector(".alert", { state: "detached", timeout: 5000 });
        if ((await page.locator(".designer").count()) !== 1)
          throw new Error("Keep Editing closed the designer");
        await page.keyboard.press("Escape");
        await page.waitForSelector(".alert", { timeout: 5000 });
        await page.locator(".alert .btn", { hasText: "Discard Changes" }).click();
        await page.waitForSelector(".designer", { state: "detached", timeout: 5000 });

        await page.keyboard.press("Meta+Comma");
        await page.waitForSelector(".prefs", { timeout: 5000 });
        await page.locator('.prefs__nav [role="tab"]', { hasText: "Formats" }).click();
        await page
          .getByRole("button", { name: "More actions for “Dramatists Guild — Modern”" })
          .click();
        await page.waitForSelector(".menu", { timeout: 5000 });
        await page.locator(".menu__item", { hasText: "Preview…" }).click();
        await page.waitForSelector(".designer", { timeout: 10000 });
        await page.locator("#dz-name").focus();
        await page.keyboard.type("x");
        await page.waitForSelector(".alert", { timeout: 5000 });
        const title = await page.locator(".alert__title").innerText();
        if (!/is built in/.test(title)) throw new Error(`typing into a built-in asked "${title}"`);
        if ((await page.locator("#dz-name").inputValue()) !== "Dramatists Guild — Modern") {
          throw new Error("typing into a built-in changed it");
        }
        await audit(page, "format designer · built-in");
        await page.keyboard.press("Escape");
        await page.waitForSelector(".alert", { state: "detached", timeout: 5000 });
        await page.keyboard.press("Escape");
        await page.waitForSelector(".designer", { state: "detached", timeout: 5000 });
        await page.keyboard.press("Escape");
        await page.waitForSelector(".sheet", { state: "detached", timeout: 5000 });
      },
    },
    {
      // Delete sends a format to the Trash, unconfirmed and undoable, and says
      // which play loses it and what that play uses instead.
      name: "formats · move to trash",
      feature: "format",
      async run(page) {
        await page.keyboard.press("Meta+Comma");
        await page.waitForSelector(".prefs", { timeout: 5000 });
        await page.locator('.prefs__nav [role="tab"]', { hasText: "Formats" }).click();
        await page.getByRole("button", { name: "More actions for “Smoke House”" }).click();
        await page.waitForSelector(".menu", { timeout: 5000 });
        await page.locator(".menu__item", { hasText: "Move to Trash" }).click();
        await until(page, "the Trash toast", () =>
          /moved to the Trash/.test(document.querySelector(".toast__title")?.textContent ?? ""),
        );
        const detail = await page.locator(".toast__detail").innerText();
        if (!/The Weight of Water/.test(detail) || !/Dramatists Guild — Modern/.test(detail)) {
          throw new Error(`the Trash toast says "${detail}"`);
        }
        const names = await page.locator(".formatlist__name").allInnerTexts();
        if (names.includes("Smoke House"))
          throw new Error("Smoke House is still listed after Move to Trash");
        await page.keyboard.press("Escape");
        await page.waitForSelector(".sheet", { state: "detached", timeout: 5000 });
      },
    },
    {
      // A double Enter opens the element menu (docs/app/writing/editor-ux.md#EDIT-58), Shift+Enter
      // keeps making line breaks, which a writer must not lose, and a parenthetical chosen
      // there puts the caret inside its parens. The caret itself cannot be read
      // from the page; the indent that places it between the parens can. It
      // runs here because the Trash just returned the play to Dramatists Guild
      // — Modern, whose parentheticals are left-aligned: the
      // alignment where the caret sat outside (format css.ts).
      name: "a second Enter opens the element menu, and Shift+Enter still breaks the line",
      feature: "editor",
      async run(page) {
        const script = page.locator(".ProseMirror").first();
        // The document, not the page's text: the page view's chrome (page
        // numbers) follows the format, which the previous check just changed.
        const doc = () =>
          page.evaluate(() =>
            JSON.stringify(document.querySelector(".ProseMirror").editor.state.doc.toJSON()),
          );
        const before = await doc();
        const where = () =>
          page.evaluate(() => {
            const view = document.querySelector(".ProseMirror");
            const { $from } = view.editor.state.selection;
            return {
              type: $from.parent.type.name,
              size: $from.parent.content.size,
              broke: $from.nodeBefore?.type.name === "lineBreak",
              inScript: document.activeElement === view,
            };
          });
        const menuOpen = () => page.locator('.pl-elementmenu [role="menuitem"]').count();
        await script.focus();
        await page.keyboard.press("Meta+ArrowDown");
        await page.waitForTimeout(100);
        try {
          await page.keyboard.press("Enter");
          await page.keyboard.press("Meta+Alt+KeyA");
          await page.keyboard.press("Enter");
          await page.waitForSelector('.pl-elementmenu [role="menuitem"]');
          if (!(await focused(page)).text.includes("Character")) {
            throw new Error(
              `the menu opened on "${(await focused(page)).text}", not on Character, which Enter used to make`,
            );
          }
          await page.keyboard.press("p");
          await page.waitForTimeout(100);
          const chosen = await where();
          if (chosen.type !== "parenthetical" || chosen.size !== 0 || !chosen.inScript) {
            throw new Error(`choosing p left ${JSON.stringify(chosen)}`);
          }
          const indent = () =>
            page.evaluate(() => {
              const { editor } = document.querySelector(".ProseMirror");
              const { node } = editor.view.domAtPos(editor.state.selection.from);
              const block = (node.nodeType === Node.TEXT_NODE ? node.parentElement : node).closest(
                ".pl-parenthetical",
              );
              const style = getComputedStyle(block);
              return {
                align: style.textAlign,
                indent: parseFloat(style.textIndent),
                pull: parseFloat(getComputedStyle(block, "::before").marginLeft),
              };
            });
          const empty = await indent();
          if (!["left", "start"].includes(empty.align)) {
            throw new Error(
              `this check wants the play on Dramatists Guild — Modern, whose parentheticals are left-aligned; it found ${empty.align}`,
            );
          }
          if (!(empty.indent > 0) || Math.abs(empty.indent + empty.pull) > 0.5) {
            throw new Error(
              `an empty parenthetical does not hold the caret between its parens: ${JSON.stringify(empty)}`,
            );
          }
          await page.keyboard.type("beat");
          const typed = await indent();
          if (typed.indent !== 0)
            throw new Error(
              `a written parenthetical kept the empty one's indent: ${JSON.stringify(typed)}`,
            );

          // Shift+Enter in a written line: a break in the same block, and no menu.
          await page.keyboard.press("Enter");
          await page.keyboard.press("Meta+Alt+KeyA");
          await page.keyboard.type("Lights up.");
          await page.keyboard.press("Shift+Enter");
          const soft = await where();
          if (soft.type !== "action" || !soft.broke || (await menuOpen())) {
            throw new Error(
              `Shift+Enter after words left ${JSON.stringify(soft)}${(await menuOpen()) ? " with the menu open" : ""}`,
            );
          }

          // Shift+Enter with the menu open: the break goes in; the lit row is not chosen.
          await page.keyboard.press("Enter");
          await page.keyboard.press("Meta+Alt+KeyA");
          await page.keyboard.press("Enter");
          await page.waitForSelector('.pl-elementmenu [role="menuitem"]');
          await page.keyboard.press("Shift+Enter");
          await page.waitForTimeout(150);
          const held = await where();
          if ((await menuOpen()) || held.type !== "action" || !held.broke || !held.inScript) {
            throw new Error(
              `Shift+Enter with the menu open left ${JSON.stringify(held)}${(await menuOpen()) ? " and the menu still open" : ""}`,
            );
          }
        } finally {
          if (await menuOpen()) await page.keyboard.press("Escape");
          await script.focus();
          for (let i = 0; i < 40 && (await doc()) !== before; i++) {
            await page.keyboard.press("Meta+KeyZ");
            await page.waitForTimeout(60);
          }
        }
        if ((await doc()) !== before)
          throw new Error("the second-Enter smoke check did not restore the script");
      },
    },
    {
      name: "seeded Find and export results use premounted status regions",
      feature: "app",
      async run(page) {
        await page.locator(".ProseMirror").first().focus();
        // Set a known text selection, independent of the prior check's caret
        // and the OS's word-selection gesture; Command-F is the action under test.
        const seed = await page.evaluate(() => {
          const editor = document.querySelector(".ProseMirror").editor;
          let selected = "";
          editor.state.doc.forEach((node, pos) => {
            if (selected || !node.textContent) return;
            const word = node.textContent.match(/^\S+/)?.[0];
            if (!word) return;
            editor.commands.setTextSelection({ from: pos + 1, to: pos + 1 + word.length });
            selected = word;
          });
          return selected;
        });
        await page.keyboard.press("Meta+KeyF");
        await page.waitForSelector(".findbar__field");
        if ((await page.locator(".findbar__field").first().inputValue()) !== seed || !seed)
          throw new Error("Find did not seed the selected word");
        await until(page, "the seeded Find result to be spoken", () =>
          /^Match \d+ of \d+\.$/.test(
            document.querySelector('[data-announcer="polite"]')?.textContent ?? "",
          ),
        );
        await page.keyboard.press("Escape");
        await openFromDocumentMenu(page, /Export PDF/);
        await page.waitForSelector(".exportpanel__body");
        const field = page.getByRole("textbox", { name: "Pages to export" });
        await field.fill("9-2");
        await until(page, "the invalid range to be described and spoken", () => {
          const input = document.querySelector('[aria-label="Pages to export"]');
          const summary = document.getElementById(input?.getAttribute("aria-describedby"));
          const spoken = input
            ?.closest('[aria-modal="true"]')
            ?.querySelector('[data-announcer="polite"]');
          return (
            input?.getAttribute("aria-invalid") === "true" &&
            !!summary?.textContent &&
            summary.textContent === spoken?.textContent
          );
        });
        await field.fill("1");
        await until(page, "the corrected range count to be spoken", () => {
          const input = document.querySelector('[aria-label="Pages to export"]');
          const spoken = input
            ?.closest('[aria-modal="true"]')
            ?.querySelector('[data-announcer="polite"]');
          return (
            input?.getAttribute("aria-invalid") === "false" &&
            /^1 of \d+ pages$/.test(spoken?.textContent ?? "")
          );
        });
        await audit(page, "export range feedback");
        await page.keyboard.press("Escape");
        await openFromDocumentMenu(page, /Versions/);
        await until(page, "versions completion to be spoken", () =>
          /^(Version ready:|No saved versions yet)/.test(
            document.querySelector('[aria-modal="true"] [data-announcer="polite"]')?.textContent ??
              "",
          ),
        );
        await page.keyboard.press("Escape");
      },
    },
    {
      name: "a failed version read is spoken inside Versions",
      feature: "review",
      devMock: true,
      async run(page) {
        await page.evaluate(() =>
          window.__prosceniumGate("versionRead", null, { fail: "A619 version unavailable" }),
        );
        try {
          await openFromDocumentMenu(page, /Versions/);
          await until(page, "the version read failure to be spoken", () =>
            /Could not read versions.*A619 version unavailable/.test(
              document.querySelector('[aria-modal="true"] [data-announcer="polite"]')
                ?.textContent ?? "",
            ),
          );
          await audit(page, "version read failure");
          await page.keyboard.press("Escape");
        } finally {
          await page.evaluate(() => window.__prosceniumOpenGates("versionRead"));
        }
      },
    },
    {
      name: "Changes speaks delayed and unavailable comparisons",
      feature: "review",
      devMock: true,
      async run(page) {
        const path = "The Weight of Water.fountain";
        const before = await page.evaluate((rel) => window.__prosceniumPeek(rel), path);
        await until(page, "the script to finish saving", () =>
          /^Saved/.test(document.querySelector(".savestatus")?.textContent ?? ""),
        );
        try {
          await page.evaluate(
            ({ rel, text }) =>
              window.__prosceniumExternalChange(rel, text + "\n\nA619 comparison marker.\n"),
            { rel: path, text: before },
          );
          await until(page, "the external comparison fixture to arrive", () =>
            document.querySelector(".ProseMirror")?.textContent.includes("A619 comparison marker"),
          );
          await page.locator(".seg__btn", { hasText: "Changes" }).first().click();
          await page.waitForSelector(".change__summary");
          await page.evaluate((rel) => window.__prosceniumGate("read", rel), path);
          await page.locator(".change__summary").first().click();
          await until(page, "a slow comparison to speak its loading state", () =>
            /Reading changes in/.test(
              document.querySelector('[data-announcer="polite"]')?.textContent ?? "",
            ),
          );
          if (!(await page.locator('.change__diff[aria-busy="true"]').count()))
            throw new Error("the slow comparison was not marked busy");
          await page.evaluate(() => window.__prosceniumOpenGates("read"));
          await until(page, "comparison completion to be spoken", () =>
            /Comparison ready for/.test(
              document.querySelector('[data-announcer="polite"]')?.textContent ?? "",
            ),
          );
          await page.locator(".seg__btn", { hasText: "Script" }).first().click();
          await page.locator(".seg__btn", { hasText: "Changes" }).first().click();
          await page.evaluate(
            (rel) => window.__prosceniumGate("read", rel, { fail: "A619 comparison unavailable" }),
            path,
          );
          await page.locator(".change__summary").first().click();
          await until(page, "an unavailable comparison to be spoken", () =>
            /No comparison available for/.test(
              document.querySelector('[data-announcer="polite"]')?.textContent ?? "",
            ),
          );
          if (await page.locator('.change__diff[aria-busy="true"]').count())
            throw new Error("a finished unavailable comparison stayed busy");
          await audit(page, "comparison unavailable");
        } finally {
          await page.evaluate(() => window.__prosceniumOpenGates("read"));
          await page.locator(".seg__btn", { hasText: "Script" }).first().click();
          await page.evaluate(({ rel, text }) => window.__prosceniumExternalChange(rel, text), {
            rel: path,
            text: before,
          });
          await until(
            page,
            "the comparison fixture to be removed",
            () =>
              !document
                .querySelector(".ProseMirror")
                ?.textContent.includes("A619 comparison marker"),
          );
          await page.locator(".seg__btn", { hasText: "Changes" }).first().click();
          const keep = page.locator(".changes button", { hasText: /^Keep$/ });
          for (let n = await keep.count(); n > 0; n = await keep.count()) {
            await keep.first().click();
            await until(
              page,
              "the comparison to be reviewed",
              (count) =>
                [...document.querySelectorAll(".changes button")].filter(
                  (button) => button.textContent.trim() === "Keep",
                ).length < count,
              n,
            );
          }
          await page.locator(".seg__btn", { hasText: "Script" }).first().click();
        }
      },
    },
    {
      name: "versions",
      feature: "review",
      async run(page) {
        await openFromDocumentMenu(page, /Versions/);
        await page.waitForSelector(".sheet", { timeout: 5000 });
        await audit(page, "versions sheet");
        await page.keyboard.press("Escape");
        await page.waitForSelector(".sheet", { state: "detached", timeout: 5000 });
      },
    },
    {
      name: "board",
      feature: "workspace",
      async run(page) {
        await page.locator(".seg__btn", { hasText: "Board" }).first().click();
        await page.waitForSelector(".board", { timeout: 10000 });
        await visible(page, ".board", { minWidth: 300, minHeight: 100 });
        await visible(page, ".card", { minWidth: 150, minHeight: 60 });
        await visible(page, ".board__act", { minWidth: 200 });
        await audit(page, "board");
      },
    },
    {
      name: "outline and cast",
      feature: "workspace",
      async run(page) {
        await page.locator(".seg__btn", { hasText: "Outline" }).first().click();
        await page.waitForSelector(".outliner", { timeout: 10000 });
        await visible(page, ".outliner", { minWidth: 300, minHeight: 60 });
        await audit(page, "outline");
        await page.locator(".seg__btn", { hasText: "Cast" }).first().click();
        await page.waitForSelector(".castview", { timeout: 10000 });
        await visible(page, ".castview__list", { minWidth: 300, minHeight: 40 });
        await audit(page, "cast");
        await page.locator(".seg__btn", { hasText: "Changes" }).first().click();
        await page.waitForTimeout(500);
        await audit(page, "changes");
        await page.locator(".seg__btn", { hasText: "Cast" }).first().click();
        await page.waitForSelector(".castview", { timeout: 10000 });
      },
    },
    {
      // A page is not a minute. Length reads as pages wherever it
      // shows, and the strip under the page calls itself a page map. Nothing
      // asserted the minute strings when they went in, so nothing would have
      // noticed one coming back.
      name: "lengths are pages, never minutes",
      feature: "layout",
      async run(page) {
        const minutes = /\bmin\b|minute/i;
        const count = /^\d+ pages?$/;
        await page.locator(".seg__btn", { hasText: "Script" }).first().click();
        await page.waitForSelector(".elementbar__pages", { timeout: 10000 });
        const counter = (await page.locator(".elementbar__pages").innerText()).trim();
        if (!/^Page \d+ of \d+$/.test(counter))
          throw new Error(`the element bar's page counter reads "${counter}"`);
        const tip = (await page.locator(".elementbar__pages").getAttribute("title")) ?? "";
        if (minutes.test(tip)) throw new Error(`the page counter's tooltip says "${tip}"`);
        const map = (await page.locator(".rts").getAttribute("aria-label")) ?? "";
        if (!/^Scene navigation: \d+ pages?\./.test(map) || minutes.test(map))
          throw new Error(`the page map says "${map}"`);
        const segments = await page.evaluate(() =>
          [...document.querySelectorAll(".rts__seg")].map((s) => s.title),
        );
        const badSegment = segments.find((t) => minutes.test(t) || !/ · \d+ pages?$/.test(t));
        if (!segments.length || badSegment !== undefined)
          throw new Error(`a page map segment says "${badSegment}"`);

        await page.locator(".ProseMirror").first().focus();
        await page.keyboard.press("Meta+Shift+KeyJ");
        await page.waitForSelector(".gotoscene__field", { timeout: 5000 });
        const hints = (await page.locator(".menu__item .menu__trail").allInnerTexts())
          .map((t) => t.trim())
          .filter(Boolean);
        await page.keyboard.press("Escape");
        await page.waitForSelector(".gotoscene__field", { state: "detached", timeout: 5000 });
        const badHint = hints.find((t) => minutes.test(t) || !/^Page \d+ · \d+ pages?$/.test(t));
        if (!hints.length || badHint !== undefined)
          throw new Error(`Go to Scene hints "${badHint}"`);

        await page.locator(".seg__btn", { hasText: "Board" }).first().click();
        await page.waitForSelector(".board__actlen", { timeout: 10000 });
        const acts = await page.locator(".board__actlen").allInnerTexts();
        const badAct = acts.find((t) => !count.test(t.trim()));
        if (badAct !== undefined) throw new Error(`a board act header's length reads "${badAct}"`);
        const cards = await page.evaluate(() =>
          [...document.querySelectorAll(".card__pages")].map(
            (c) => `${c.textContent} | ${c.title}`,
          ),
        );
        const badCard = cards.find((t) => minutes.test(t));
        if (!cards.length || badCard !== undefined)
          throw new Error(`a board card's length says "${badCard}"`);

        await page.locator(".seg__btn", { hasText: "Outline" }).first().click();
        await page.waitForSelector(".outliner__pages", { timeout: 10000 });
        const lengths = (await page.locator(".outliner__pages").allInnerTexts())
          .map((t) => t.trim())
          .filter(Boolean);
        const badLength = lengths.find((t) => minutes.test(t) || !/ · \d+ pages?$/.test(t));
        if (!lengths.length || badLength !== undefined)
          throw new Error(`an outline length reads "${badLength}"`);

        await page.keyboard.press("Meta+Comma");
        await page.waitForSelector(".sheet .prefs", { timeout: 5000 });
        await page.locator('.prefs__nav [role="tab"]', { hasText: "Writing" }).click();
        const pageMap = page.getByRole("switch", { name: "Show scene navigation strip" });
        if ((await pageMap.count()) !== 1)
          throw new Error("Settings › Writing has no Page map switch");
        const note = await page.locator(".prefs__panel").innerText();
        if (minutes.test(note)) throw new Error("Settings › Writing still talks about minutes");
        await page.keyboard.press("Escape");
        await page.waitForSelector(".sheet", { state: "detached", timeout: 5000 });
        await page.locator(".seg__btn", { hasText: "Cast" }).first().click();
        await page.waitForSelector(".castview", { timeout: 10000 });
      },
    },
    {
      name: "editing fields identify their scene or character",
      feature: "workspace",
      async run(page) {
        await page.locator(".seg__btn", { hasText: "Board" }).first().click();
        await page.waitForSelector(".card__synopsis");
        const board = await page.evaluate(() =>
          [...document.querySelectorAll(".card[role=group]")].every((card) => {
            const name = card.querySelector(".card__heading")?.textContent;
            const heading = document.getElementById(card.getAttribute("aria-labelledby"));
            return (
              card.getAttribute("role") === "group" &&
              heading?.textContent === name &&
              [...card.querySelectorAll("input, textarea")].every((field) =>
                field.getAttribute("aria-label")?.endsWith(` — ${name}`),
              )
            );
          }),
        );
        if (!board) throw new Error("board fields lost their scene names");
        await page.locator(".card__details summary").first().click();
        if (!(await page.locator('.card__note[aria-label^="Notes — "]').count()))
          throw new Error("new board note has no contextual name");
        await audit(page, "board field names");
        await page.locator(".seg__btn", { hasText: "Outline" }).first().click();
        await page.waitForSelector(".outliner");
        const outline = await page.evaluate(() =>
          [...document.querySelectorAll(".outliner__row")].every((row) => {
            const heading = row.querySelector('th[scope="row"] .outliner__open')?.textContent;
            return (
              heading &&
              [...row.querySelectorAll("input, textarea")].every((field) =>
                field.getAttribute("aria-label")?.endsWith(` — ${heading}`),
              )
            );
          }),
        );
        if (!outline) throw new Error("outline field names or scene row headers are missing");
        await audit(page, "outline field names");
        await page.locator(".seg__btn", { hasText: "Cast" }).first().click();
        await page.waitForSelector(".castcard");
        const cast = await page.evaluate(() =>
          [...document.querySelectorAll(".castcard")].every((card) => {
            const name = card.querySelector(".castcard__name").value;
            const heading = document.getElementById(card.getAttribute("aria-labelledby"));
            return (
              card.getAttribute("role") === "group" &&
              heading?.textContent === name &&
              card.querySelector(".castcard__name").getAttribute("aria-label") ===
                `Name — ${name}` &&
              card.querySelector(".castcard__desc").getAttribute("aria-label") ===
                `Description — ${name}`
            );
          }),
        );
        if (!cast) throw new Error("cast fields lost their character names");
        await audit(page, "cast field names");
      },
    },
    {
      // A document is written on the play's page: the script's width at the
      // same zoom, and a whole page tall however little is on it, in Page and
      // in Source. It was a 520px card 60% of the window tall at every zoom, so
      // a new note at 120% came up a little over half as wide as the script.
      // Ends on the document, in the view it was found in, at the zoom it was
      // found at.
      name: "sheets · a document is the script's page",
      feature: "markdown",
      async run(page) {
        const doc = "1953 North Sea Flood";
        const label = () => page.locator(".zoomctl__label").innerText();
        const step = async (name) => {
          const was = await label();
          await page.locator(`.zoomctl__step[aria-label="${name}"]`).click();
          await until(
            page,
            `${name} to change the zoom`,
            (w) => document.querySelector(".zoomctl__label")?.textContent !== w,
            was,
          );
        };
        const measure = (selector) =>
          page.evaluate((sel) => {
            const el = document.querySelector(sel);
            const pane = el?.closest(".pane__body");
            if (!el || !pane) return null;
            const box = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return {
              width: box.width,
              height: box.height,
              // Along the pane's scrolled content: a sheet wider than its pane
              // starts on the desk and the pane scrolls, as the script's does.
              left: box.left - pane.getBoundingClientRect().left + pane.scrollLeft,
              // The page's shape as the sheet itself reads it. Both lengths are
              // in the unit formatCssVars writes; NaN means they never arrived.
              aspect:
                parseFloat(style.getPropertyValue("--fmt-page-height")) /
                parseFloat(style.getPropertyValue("--fmt-page-width")),
            };
          }, selector);

        await page.locator(".seg__btn", { hasText: "Script" }).first().click();
        await until(
          page,
          "the script in a pane",
          () => !!document.querySelector(".pane__body .play-page"),
        );
        // Off 100%, so a sheet that ignores the zoom cannot pass by being 816px.
        const before = await label();
        let steps = 0;
        while (steps < 2 || ((await label()) === "100%" && steps < 3)) {
          await step("Zoom in");
          steps++;
        }
        const level = await label();
        const script = await measure(".play-page");
        if (!script || script.width < 300)
          throw new Error(`the script's page measured ${JSON.stringify(script)}`);

        await page.locator(".binder .binder__label", { hasText: doc }).first().click();
        await until(
          page,
          `${doc} to open`,
          (d) => document.querySelector(".material__title")?.value === d,
          doc,
        );
        const view = () => page.locator(".material__mode--on").innerText();
        const found = await view();
        const problems = [];
        for (const mode of found === "Source" ? ["Source", "Page"] : ["Page", "Source"]) {
          if ((await view()) !== mode)
            await page.locator(".material__mode", { hasText: mode }).first().click();
          const selector = mode === "Page" ? ".material__page" : ".material__body";
          await page.waitForSelector(selector, { timeout: 5000 });
          await page.waitForTimeout(150);
          const sheet = await measure(selector);
          if (!sheet) {
            problems.push(`${mode} drew no sheet in a pane`);
            continue;
          }
          const size = `${mode} at ${level} is ${Math.round(sheet.width)}×${Math.round(sheet.height)}, the script ${Math.round(script.width)} wide`;
          if (Math.abs(sheet.width / script.width - 1) > 0.02)
            problems.push(`${size}: not the script's page`);
          else if (!(sheet.aspect > 0))
            problems.push(`${size}: the sheet reads no --fmt-page-width/height`);
          else if (sheet.height < sheet.width * sheet.aspect - 2)
            problems.push(`${size}: less than a page tall`);
          else if (sheet.left < 0) problems.push(`${size}: cut off at the pane's left edge`);
        }
        if ((await view()) !== found)
          await page.locator(".material__mode", { hasText: found }).first().click();
        // Both drivers scroll a control into view to press it (the native one
        // centres it), which in a pane narrower than the page scrolls the pane
        // sideways: back to its left edge, where the document opened.
        await page.evaluate(() => {
          const pane = document.querySelector(".material")?.closest(".pane__body");
          if (pane) pane.scrollLeft = 0;
        });

        // The zoom goes back the way it was found, before anything can throw.
        if (/^Fit /.test(before)) {
          await page.locator(".zoomctl__label").click();
          await page.waitForSelector(".menu", { timeout: 5000 });
          await page
            .locator(".menu__item", {
              hasText: /^Fit width/.test(before) ? "Fit Width" : "Fit Page",
            })
            .first()
            .click();
          await page.waitForSelector(".menu", { state: "detached", timeout: 5000 });
        } else {
          for (let i = 0; i < steps; i++) await step("Zoom out");
        }
        const after = await label();
        if (problems.length) throw new Error(problems.join("; "));
        const same = /^Fit /.test(before)
          ? after.split("·")[0] === before.split("·")[0]
          : after === before;
        if (!same) throw new Error(`the zoom was ${before} and was left at ${after}`);
        await visible(page, found === "Source" ? ".material__body" : ".material__page", {
          minWidth: 300,
          minHeight: 300,
        });
        await audit(page, "document page");
      },
    },
    {
      // With a document alone on screen, Fit Width and Fit Page solve for the
      // document's pane: Fit Width fills its width, again after the binder
      // widens and narrows it, and Fit Page shows the whole page under the
      // header and format bar, in Page and in Source. Both fits solved only for
      // the script's pane, so with no script showing they did nothing, and at
      // the script's Fit Page a document's page ran 48px off the bottom. Each
      // fit starts from a level far from it (50% for the width, 200% for the
      // page), so a fit that did nothing cannot pass. Ends as it began.
      name: "sheets · a fit solves for the document's pane",
      feature: "markdown",
      async run(page) {
        const doc = "1953 North Sea Flood";
        const label = () => page.locator(".zoomctl__label").innerText();
        const view = () => page.locator(".material__mode--on").innerText();
        const choose = async (item) => {
          await page.locator(".zoomctl__label").click();
          await page.waitForSelector(".menu", { timeout: 5000 });
          await page.locator(".menu__item", { hasText: item }).first().click();
          await page.waitForSelector(".menu", { state: "detached", timeout: 5000 });
        };
        const fitTo = async (item) => {
          await choose(item);
          await until(
            page,
            `the zoom to read ${item}`,
            (want) =>
              document
                .querySelector(".zoomctl__label")
                ?.textContent?.toLowerCase()
                .startsWith(want),
            item.toLowerCase(),
          );
        };
        const showView = async (mode) => {
          if ((await view()) !== mode)
            await page.locator(".material__mode", { hasText: mode }).first().click();
          await page.waitForSelector(mode === "Page" ? ".material__page" : ".material__body", {
            timeout: 5000,
          });
        };
        const paneWidth = () =>
          page.evaluate(
            () =>
              document.querySelector(".pane__body .material__desk")?.closest(".pane__body")
                ?.clientWidth ?? 0,
          );
        /** The document's page as it looks where the document opens, at the top of its pane. */
        const measure = () =>
          page.evaluate(() => {
            const desk = document.querySelector(".pane__body .material__desk");
            const pane = desk?.closest(".pane__body");
            const sheet = desk?.firstElementChild;
            if (!desk || !pane || !sheet) return null;
            pane.scrollTop = 0;
            pane.scrollLeft = 0;
            const probe = document.createElement("div");
            probe.style.cssText = "position:absolute;width:1in;height:0;visibility:hidden";
            document.body.appendChild(probe);
            const pxPerIn = probe.getBoundingClientRect().width;
            probe.remove();
            const style = getComputedStyle(sheet);
            const zoom = parseFloat(style.zoom) || 1;
            const box = pane.getBoundingClientRect();
            // Off the desk, which is never zoomed: WebKit reports a zoomed box's
            // own rect divided by its zoom, so the sheet cannot say where it is.
            const top =
              desk.getBoundingClientRect().top +
              parseFloat(getComputedStyle(desk).paddingTop) -
              box.top -
              pane.clientTop;
            return {
              zoom,
              paneWidth: pane.clientWidth,
              paneHeight: pane.clientHeight,
              overflow: pane.scrollWidth - pane.clientWidth,
              width: parseFloat(style.getPropertyValue("--fmt-page-width")) * pxPerIn * zoom,
              top,
              bottom:
                top + parseFloat(style.getPropertyValue("--fmt-page-height")) * pxPerIn * zoom,
            };
          });
        const problems = [];
        const said = (m) =>
          `the page at ${Math.round(m.zoom * 100)}% is ${Math.round(m.width)} wide, ${Math.round(m.top)}–${Math.round(m.bottom)} down a ${m.paneWidth}×${m.paneHeight} pane`;
        const fitsWidth = (m, when) => {
          if (!m) problems.push(`${when}: no document page in a pane`);
          else if (m.width > m.paneWidth + 1 || m.overflow > 1)
            problems.push(`${when}: ${said(m)}, wider than its pane`);
          // Two gutters and a rounded percent; a fit that did nothing leaves hundreds.
          else if (m.paneWidth - m.width > 64)
            problems.push(`${when}: ${said(m)}, not fitted to its width`);
        };
        const fitsPage = (m, when) => {
          if (!m) problems.push(`${when}: no document page in a pane`);
          else if (m.bottom > m.paneHeight + 1)
            problems.push(`${when}: ${said(m)}, cut off at the bottom`);
          // A gutter under the page, or the width's two, and a rounded percent.
          else if (m.paneHeight - m.bottom > 48 && m.paneWidth - m.width > 64)
            problems.push(`${when}: ${said(m)}, not fitted to its pane`);
        };

        await page.locator(".binder .binder__label", { hasText: doc }).first().click();
        await until(
          page,
          `${doc} alone on screen, with no pane showing the script`,
          () =>
            !!document.querySelector(".pane__body .material__desk") &&
            !document.querySelector(".pane__body .play-page"),
        );
        const before = await label();
        const found = await view();
        const fit = /^Fit (width|page)/.exec(before);
        try {
          await showView("Page");
          await choose(/^50%$/);
          await fitTo("Fit Width");
          fitsWidth(await measure(), "Fit Width");
          const narrow = await paneWidth();
          await page.getByRole("button", { name: "Hide the binder" }).click();
          await until(
            page,
            "the document's pane to widen",
            (w) =>
              (document.querySelector(".pane__body .material__desk")?.closest(".pane__body")
                ?.clientWidth ?? 0) >
              w + 100,
            narrow,
          );
          fitsWidth(await measure(), "Fit Width with the binder hidden");
          await page.getByRole("button", { name: "Show the binder" }).click();
          await until(
            page,
            "the document's pane to narrow again",
            (w) =>
              (document.querySelector(".pane__body .material__desk")?.closest(".pane__body")
                ?.clientWidth ?? 0) <=
              w + 1,
            narrow,
          );
          fitsWidth(await measure(), "Fit Width with the binder back");

          await choose(/^200%$/);
          await fitTo("Fit Page");
          fitsPage(await measure(), "Fit Page");
          await showView("Source");
          fitsPage(await measure(), "Fit Page in Source");
          await showView("Page");
          fitsPage(await measure(), "Fit Page back in Page");
        } finally {
          // As it was found, however this went: a binder left hidden or a page
          // left at 200% would fail every check after this one.
          try {
            if (await page.locator('[aria-label="Show the binder"]').count()) {
              await page.getByRole("button", { name: "Show the binder" }).click();
            }
            await showView(found);
            const pct = parseInt(before, 10);
            if (fit) {
              await fitTo(fit[1] === "width" ? "Fit Width" : "Fit Page");
            } else if ([50, 75, 100, 125, 150, 200].includes(pct)) {
              await choose(new RegExp(`^${pct}%$`));
            } else {
              await choose("Actual Size");
              for (let i = 0; i < Math.round(Math.abs(pct - 100) / 10); i++) {
                const was = await label();
                await page
                  .locator(`.zoomctl__step[aria-label="${pct > 100 ? "Zoom in" : "Zoom out"}"]`)
                  .click();
                await until(
                  page,
                  "a step to change the zoom",
                  (w) => document.querySelector(".zoomctl__label")?.textContent !== w,
                  was,
                );
              }
            }
            await page.evaluate(() => {
              const pane = document.querySelector(".material")?.closest(".pane__body");
              if (pane) pane.scrollLeft = 0;
            });
          } catch {
            /* the check's own failure is the one to report */
          }
        }
        if (problems.length) throw new Error(problems.join("; "));
        const after = await label();
        const same = fit ? after.split("·")[0] === before.split("·")[0] : after === before;
        if (!same) throw new Error(`the zoom was ${before} and was left at ${after}`);
        await visible(page, found === "Source" ? ".material__body" : ".material__page", {
          minWidth: 100,
          minHeight: 100,
        });
      },
    },
    {
      // New ▸ Document puts the cursor on the page (docs/app/preferences-and-help/accessibility.md#A11Y-4). The new row
      // dropped into rename mode instead: the page was on screen, the keyboard
      // was in the binder, the first word typed renamed the file, and ⏎ left
      // focus on nothing. So: type a word, and find it on the page and in the
      // file, and not in the binder's name.
      name: "New ▸ Document puts the cursor on its page",
      feature: "markdown",
      async run(page) {
        const word = "Quincunx";
        await page.locator(".seg__btn", { hasText: "Script" }).first().click();
        await page.locator(".binder__add").first().click();
        await page.waitForSelector(".menu", { timeout: 5000 });
        await page.locator(".menu .menu__item", { hasText: "Document" }).first().click();
        await until(
          page,
          "the new document's page to take the cursor",
          () =>
            !!document.activeElement?.closest(".material .ProseMirror, .material .material__body"),
        );
        if (await page.locator(".binder__rename").count())
          throw new Error("the new document's row opened a name field");
        const name = await page.evaluate(
          () =>
            document.activeElement?.closest(".material")?.querySelector(".material__title")
              ?.value ?? "",
        );
        if (!name) throw new Error("the page with the cursor has no name");
        await page.keyboard.type(word);
        await until(
          page,
          `"${word}" on the page`,
          (w) => {
            const sheet = document.activeElement?.closest(".material");
            const text =
              sheet?.querySelector(".ProseMirror")?.textContent ??
              sheet?.querySelector(".material__body")?.value ??
              "";
            return text.includes(w);
          },
          word,
        );
        await until(page, `"${word}" in ${name}.md`, onDisk, { file: `${name}.md`, word });
        const labels = await page.locator(".binder .binder__label").allInnerTexts();
        if (labels.some((l) => l.includes(word)))
          throw new Error(`"${word}" went into the binder's name`);
        if (!labels.includes(name)) throw new Error(`the binder has no row named "${name}"`);
        await audit(page, "a new document");
        await closeTab(page, name);
      },
    },
    {
      // A character is named first — the Cast finds a sheet by its name — and
      // then ⏎ in the name carries the cursor onto its page, under its first
      // heading rather than into it (docs/app/preferences-and-help/accessibility.md#A11Y-4).
      name: "a new character is named, then ⏎ puts the cursor on its page",
      feature: "workspace",
      async run(page) {
        const name = "Wren Thackeray";
        const words = "The lighthouse.";
        await page.locator(".seg__btn", { hasText: "Script" }).first().click();
        await page.locator(".binder__add").first().click();
        await page.waitForSelector(".menu", { timeout: 5000 });
        await page.locator(".menu .menu__item", { hasText: "Character" }).first().click();
        await until(
          page,
          "the new row's name field to have the cursor",
          () => !!document.activeElement?.classList.contains("binder__rename"),
        );
        await page.keyboard.type(name);
        await page.keyboard.press("Enter");
        await until(
          page,
          "the character's page to take the cursor",
          () =>
            !!document.activeElement?.closest(".material .ProseMirror, .material .material__body"),
        );
        await until(
          page,
          `the sheet to be called ${name}`,
          (n) =>
            document.activeElement?.closest(".material")?.querySelector(".material__title")
              ?.value === n,
          name,
        );
        await page.keyboard.type(words);
        await until(page, `"${words}" in ${name}.md`, onDisk, { file: `${name}.md`, word: words });
        const labels = await page.locator(".binder .binder__label").allInnerTexts();
        if (!labels.includes(name))
          throw new Error(
            `the binder names the character ${JSON.stringify(labels.filter((l) => /Wren|New Character/.test(l)))}`,
          );
        await audit(page, "a new character");
        await closeTab(page, name);
      },
    },
    {
      // ⌘/ is generated from the keymap table, so an empty overlay means the
      // table and the renderer have come apart.
      name: "shortcuts overlay",
      feature: "app",
      async run(page) {
        await page.keyboard.press("Meta+Slash");
        await page.waitForSelector(".keysheet", { timeout: 5000 });
        await visible(page, ".keysheet", { minWidth: 400, minHeight: 200 });
        const rows = await page.locator(".keysheet__row").count();
        if (rows < 20) throw new Error(`shortcut sheet listed ${rows} rows, expected 20+`);
        await audit(page, "shortcuts overlay");
        await page.keyboard.press("Escape");
      },
    },
    {
      name: "an installing update holds edits and a failure releases them",
      feature: "app",
      devMock: true,
      async run(page) {
        await page.locator('.ProseMirror[contenteditable="true"]').first().click();
        await page.keyboard.press("Meta+End");
        await page.keyboard.type(" Update test words.");
        const before = await page.locator(".ProseMirror").allInnerTexts();
        await page.evaluate(() => window.__prosceniumUpdate());
        await page.getByRole("button", { name: "Restart to Update" }).click();
        await page.waitForSelector('[aria-labelledby="update-install-title"]', { timeout: 5000 });
        await until(page, "the mock installer to hold its swap", () =>
          window.__prosceniumUpdateHeld(),
        );
        const held = await page.evaluate(() => {
          const input = new InputEvent("beforeinput", {
            bubbles: true,
            cancelable: true,
            inputType: "insertText",
            data: "unsaved during install",
          });
          return {
            inert: document.getElementById("root").inert,
            prevented: !document.dispatchEvent(input),
          };
        });
        if (!held.inert || !held.prevented)
          throw new Error("editing remained available during installation");
        await page.keyboard.press("Escape");
        await visible(page, '[aria-labelledby="update-install-title"]', {
          minWidth: 250,
          minHeight: 80,
        });
        await audit(page, "update installation");
        await page.evaluate(() => window.__prosceniumUpdate(true));
        await page.waitForSelector('[aria-labelledby="update-install-title"]', {
          state: "detached",
          timeout: 5000,
        });
        if (await page.evaluate(() => document.getElementById("root").inert))
          throw new Error("the failed update left editing locked");
        const after = await page.locator(".ProseMirror").allInnerTexts();
        if (JSON.stringify(before) !== JSON.stringify(after))
          throw new Error("the update changed the open writing");
      },
    },
    {
      name: "folder access can be retried and reauthorised",
      feature: "storage",
      devMock: true,
      async run(page) {
        await page.evaluate(() => window.__prosceniumFolderAccess());
        await page.getByRole("button", { name: "Keep Folder Access…" }).click();
        await page.waitForSelector('[aria-labelledby="folder-access-title"]', { timeout: 5000 });
        await visible(page, '[aria-labelledby="folder-access-title"]', {
          minWidth: 250,
          minHeight: 100,
        });
        if (!(await page.getByRole("button", { name: "Choose Folder…" }).count()))
          throw new Error("reauthorisation is missing");
        await audit(page, "folder access retry");
        await page.getByRole("button", { name: "Try Again" }).click();
        await page.waitForSelector('[aria-labelledby="folder-access-title"]', {
          state: "detached",
          timeout: 5000,
        });
        await until(page, "access to be saved", () =>
          document.querySelector(".toast")?.textContent.includes("Folder access saved"),
        );
      },
    },
    {
      name: "feedback · keyboard draft and character limit",
      feature: "feedback",
      async run(page) {
        await page.getByRole("button", { name: "Feedback", exact: true }).click();
        await page.waitForSelector("#feedback-message:not(:disabled)");
        await until(
          page,
          "feedback owns focus",
          () => document.activeElement?.id === "feedback-message",
        );
        await page.keyboard.type("Keep these words");
        await page.keyboard.press("Enter");
        await page.keyboard.type("And this paragraph");
        await page.keyboard.press("Escape");
        await page.waitForSelector("#feedback-message", { state: "detached" });
        await page.getByRole("button", { name: "Feedback", exact: true }).click();
        await page.waitForSelector("#feedback-message:not(:disabled)");
        const draft = await page.locator("#feedback-message").inputValue();
        if (draft !== "Keep these words\nAnd this paragraph")
          throw new Error(`after Escape the draft reads ${JSON.stringify(draft)}`);
        await page.locator("#feedback-message").fill("x".repeat(10001));
        if ((await page.locator("#feedback-message").inputValue()) !== "x".repeat(10001))
          throw new Error("paste was truncated");
        const disabled = await page.evaluate(
          () =>
            [...document.querySelectorAll(".feedback__actions button")].find(
              (b) => b.textContent === "Send Feedback",
            )?.disabled,
        );
        if (!disabled || !(await page.locator("#feedback-limit").count()))
          throw new Error("over-limit message could send");
        await audit(page, "Send Feedback character limit");
        await page.getByRole("button", { name: "Discard Draft", exact: true }).click();
        await until(
          page,
          "draft discarded",
          () => document.querySelector("#feedback-message").value === "",
        );
        await page.keyboard.press("Escape");
        await page.waitForSelector("#feedback-message", { state: "detached" });
      },
    },
    {
      name: "feedback · three entry points and the acceptance message",
      feature: "feedback",
      devMock: true,
      async run(page) {
        for (const entry of ["toolbar", "Help", "About"]) {
          if (entry === "toolbar")
            await page.getByRole("button", { name: "Feedback", exact: true }).click();
          if (entry === "Help")
            await page.evaluate(() =>
              window.dispatchEvent(
                new CustomEvent("proscenium:fixture-menu", { detail: "report-problem" }),
              ),
            );
          if (entry === "About") {
            await page.keyboard.press("Meta+Comma");
            await page.waitForSelector(".prefs");
            await page.locator('.prefs__nav [role="tab"]', { hasText: "About" }).click();
            await page.getByRole("button", { name: "Send Feedback…", exact: true }).click();
          }
          await page.waitForSelector("#feedback-message:not(:disabled)");
          await visible(page, "#feedback-message", { minWidth: 250, minHeight: 100 });
          await until(
            page,
            "feedback focus",
            () => document.activeElement?.id === "feedback-message",
          );
          await page.keyboard.type("I wish the binder remembered its width");
          await audit(page, "Send Feedback");
          if (entry === "Help") await page.locator("#feedback-email").focus();
          if (entry === "About")
            await page.getByRole("button", { name: "Close", exact: true }).focus();
          await page.keyboard.press("Meta+Enter");
          await page.waitForSelector("#feedback-message", { state: "detached" });
          await until(page, "feedback confirmation", () =>
            [...document.querySelectorAll('[data-announcer="polite"]')].some(
              (el) => el.textContent === "Feedback sent. Thank you.",
            ),
          );
          if (entry === "About") {
            await page.keyboard.press("Escape");
            await page.waitForSelector(".prefs", { state: "detached" });
          }
        }
        const sent = await page.evaluate(() => window.__prosceniumFeedback().sent);
        if (
          sent.length !== 3 ||
          sent.some(
            (m) =>
              m.message !== "I wish the binder remembered its width" || Object.keys(m).length !== 2,
          )
        )
          throw new Error("acceptance message was not sent with only its id and words");
      },
    },
    {
      name: "feedback · drafts, offline retry, details, and enlarged text",
      feature: "feedback",
      devMock: true,
      async run(page) {
        await page.evaluate(() => localStorage.setItem("proscenium:dev:feedback-fail", "true"));
        await page.getByRole("button", { name: "Feedback", exact: true }).click();
        await page.waitForSelector("#feedback-message:not(:disabled)");
        await page.keyboard.type("First paragraph");
        await page.keyboard.press("Enter");
        await page.keyboard.type("Second paragraph 👋");
        await page.getByLabel("Email (optional)", { exact: true }).fill("writer@example.org");
        await page.keyboard.press("Enter");
        if (!(await page.locator("#feedback-message").count()))
          throw new Error("Return in email sent the message");
        await page.getByRole("checkbox", { name: "Include technical details" }).click();
        await page.locator(".feedback__details summary").click();
        const details = await page
          .getByRole("textbox", { name: "Technical details", exact: true })
          .inputValue();
        if (!details.includes("Proscenium")) throw new Error("details unavailable");
        await page.keyboard.press("Escape");
        await page.waitForSelector("#feedback-message", { state: "detached" });
        await page.getByRole("button", { name: "Feedback", exact: true }).click();
        await page.waitForSelector("#feedback-message:not(:disabled)");
        const words = await page.locator("#feedback-message").inputValue();
        if (
          words !== "First paragraph\nSecond paragraph 👋" ||
          (await page.locator("#feedback-email").inputValue()) !== "writer@example.org"
        )
          throw new Error("draft lost words or email");
        if (
          (await page
            .getByRole("checkbox", { name: "Include technical details" })
            .getAttribute("aria-checked")) !== "true"
        )
          throw new Error("draft lost checkbox");
        await page.keyboard.press("Meta+Enter");
        await page.waitForSelector(".feedback__failure");
        const id = await page.evaluate(() => window.__prosceniumFeedback().saved.id);
        if ((await page.locator("#feedback-message").inputValue()) !== words)
          throw new Error("failure lost words");
        await page.getByRole("button", { name: "Copy Message", exact: true }).click();
        if ((await page.evaluate(() => window.__prosceniumFeedback().copied)) !== words)
          throw new Error("copy lost words");
        const prior = await page.evaluate(() => {
          const root = document.documentElement;
          const old = {
            scale: root.style.getPropertyValue("--ui-scale"),
            large: root.getAttribute("data-large-text"),
          };
          root.style.setProperty("--ui-scale", "2");
          root.setAttribute("data-large-text", "true");
          return old;
        });
        await audit(page, "Send Feedback at 200 percent");
        const clipped = await page.evaluate(() => {
          const sheet = document.querySelector('[aria-labelledby="feedback-title"] .sheet');
          const foot = sheet.querySelector(".sheet__foot");
          return (
            sheet.scrollWidth > sheet.clientWidth + 2 ||
            foot.getBoundingClientRect().bottom > innerHeight ||
            [...foot.querySelectorAll("button")].some((el) => el.scrollWidth > el.clientWidth + 2)
          );
        });
        if (clipped) throw new Error("feedback clips at 200 percent");
        await page.evaluate((old) => {
          const root = document.documentElement;
          if (old.scale) root.style.setProperty("--ui-scale", old.scale);
          else root.style.removeProperty("--ui-scale");
          if (old.large === null) root.removeAttribute("data-large-text");
          else root.setAttribute("data-large-text", old.large);
          localStorage.removeItem("proscenium:dev:feedback-fail");
        }, prior);
        await page.getByRole("button", { name: "Try Again", exact: true }).click();
        await page.waitForSelector("#feedback-message", { state: "detached" });
        const state = await page.evaluate(() => window.__prosceniumFeedback());
        const sent = state.sent.at(-1);
        if (
          sent.id !== id ||
          sent.details !== details ||
          sent.email !== "writer@example.org" ||
          state.saved !== null
        )
          throw new Error("retry changed identity, diagnostics, or left a draft");
      },
    },
    {
      name: "feedback · diagnostics failure does not block a message",
      feature: "feedback",
      devMock: true,
      async run(page) {
        await page.evaluate(() =>
          localStorage.setItem("proscenium:dev:feedback-details-fail", "true"),
        );
        await page.getByRole("button", { name: "Feedback", exact: true }).click();
        await page.waitForSelector("#feedback-message:not(:disabled)");
        await page.keyboard.type("A question without diagnostics");
        if (!(await page.getByRole("checkbox", { name: "Include technical details" }).isDisabled()))
          throw new Error("unavailable details checkbox enabled");
        await page.keyboard.press("Meta+Enter");
        await page.waitForSelector("#feedback-message", { state: "detached" });
        await page.evaluate(() => localStorage.removeItem("proscenium:dev:feedback-details-fail"));
      },
    },
    {
      // What the reports would carry after a session of real work (privacy-and-
      // telemetry.md docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D3, docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D6): only the listed events, nothing of the sample
      // plays in any of them, dropped the moment the switch goes off. And About's
      // Copy Diagnostics says what it copied. Mock-only: the app's queue is in
      // Rust, and its Copy Diagnostics writes the real clipboard.
      name: "privacy · reports carry nothing of the play",
      feature: "diagnostics",
      devMock: true,
      async run(page) {
        const seen = () => page.evaluate(() => window.__prosceniumTelemetry());
        const { asked } = await seen();
        const names = new Set(asked.map((e) => e.name));
        for (const expected of ["play_opened", "surface_shown"]) {
          if (!names.has(expected))
            throw new Error(`no ${expected} after a session: ${[...names].join(", ")}`);
        }
        const allowed = [
          "play_opened",
          "surface_shown",
          "pdf_exported",
          "format_saved",
          "error_shown",
        ];
        const stray = [...names].filter((n) => !allowed.includes(n));
        if (stray.length)
          throw new Error(`the page recorded events off the list: ${stray.join(", ")}`);
        const carried = JSON.stringify(asked);
        for (const leak of [
          "Weight of Water",
          "Lighthouse",
          "Mara",
          "Jonah",
          "/dev",
          "sample-vault",
          ".fountain",
        ]) {
          if (carried.includes(leak)) throw new Error(`a report carries "${leak}": ${carried}`);
        }

        await page.keyboard.press("Meta+Comma");
        await page.waitForSelector(".prefs", { timeout: 5000 });
        await page.locator('.prefs__nav [role="tab"]', { hasText: "Privacy" }).click();
        const reports = () =>
          page.getByRole("switch", { name: "Share anonymous usage and crash reports" });
        // The switch reaches the backend, which drops what was waiting (in the
        // app that is telemetry/mod.rs, whose own tests send to a server).
        await reports().click();
        await page.waitForTimeout(100);
        const off = await seen();
        if (off.on || off.queued.length !== 0) {
          throw new Error(
            `with reports off, the backend says on=${off.on} with ${off.queued.length} waiting`,
          );
        }
        await reports().click();
        await page.waitForTimeout(100);
        if (!(await seen()).on)
          throw new Error("switching reports back on did not reach the backend");

        await page.locator('.prefs__nav [role="tab"]', { hasText: "About" }).click();
        await page.getByRole("button", { name: "Copy Diagnostics" }).click();
        // An earlier toast may still be up; this one replaces it when the copy lands.
        const copied = () => page.locator(".toast", { hasText: "Diagnostics copied" }).count();
        for (let i = 0; i < 50 && !(await copied()); i++) await page.waitForTimeout(100);
        if (!(await copied())) {
          const shown = (await page.locator(".toast").count())
            ? await page.locator(".toast").innerText()
            : "nothing";
          throw new Error(`Copy Diagnostics said ${JSON.stringify(shown)}`);
        }
        await visible(page, ".prefs__panel .btn", { minWidth: 40, minHeight: 18 });
        await audit(page, "settings · about, diagnostics");
        await page.keyboard.press("Escape");
        await page.waitForSelector(".sheet", { state: "detached", timeout: 5000 });
      },
    },
    {
      // The Plays screen's statuses are the writer's list, and Progress can go
      // (docs/app/preferences-and-help/settings.md#SET-7). Settings › General adds, renames and reorders — by keys,
      // by buttons — and the Plays screen offers the list in that order. A play
      // keeps a word renamed out of the list. Progress off drops the header and
      // the cells together. Everything is put back the way it was found.
      name: "statuses and Progress are set in Settings",
      feature: "workspace",
      async run(page) {
        const rows = () =>
          page.evaluate(() =>
            [...document.querySelectorAll(".statuslist__row")].map((r) => r.dataset.status),
          );
        const general = async () => {
          await page.keyboard.press("Meta+Comma");
          await page.waitForSelector(".prefs", { timeout: 5000 });
          await page.locator('.prefs__nav [role="tab"]', { hasText: "General" }).click();
          await page.waitForSelector(".statuslist__row", { timeout: 5000 });
        };
        const nameField = (status) =>
          page.evaluate((st) => {
            const row = [...document.querySelectorAll(".statuslist__row")].find(
              (r) => r.dataset.status === st,
            );
            return row ? row.querySelector('[data-part="name"]').getAttribute("aria-label") : null;
          }, status);
        const focusedPart = () =>
          page.evaluate(() => {
            const a = document.activeElement;
            return a?.closest(".statuslist__row")
              ? `${a.closest(".statuslist__row").dataset.status}:${a.dataset.part ?? a.getAttribute("aria-label")}`
              : (a?.getAttribute("aria-label") ?? a?.tagName);
          });
        const shipped = [
          "idea",
          "outlining",
          "drafting",
          "revising",
          "workshop",
          "submitted",
          "produced",
          "shelved",
        ];

        await general();
        if ((await rows()).join("|") !== shipped.join("|"))
          throw new Error(`the status list starts as ${(await rows()).join(", ")}`);
        await audit(page, "statuses");

        // Add, by the keyboard.
        await page.locator('.statuslist__add input[aria-label="New status"]').focus();
        await page.keyboard.type("in rehearsal");
        await page.keyboard.press("Enter");
        await until(
          page,
          "the new status at the end",
          () =>
            [...document.querySelectorAll(".statuslist__row")].pop()?.dataset.status ===
            "in rehearsal",
        );
        if ((await focusedPart()) !== "New status")
          throw new Error(`after adding, focus is on ${await focusedPart()}`);

        // Move it up with ⌃⌘↑ in its name, and idea down with its button.
        await page.locator(`input[aria-label="${await nameField("in rehearsal")}"]`).focus();
        await page.keyboard.press("Control+Meta+ArrowUp");
        await until(
          page,
          "⌃⌘↑ to move it",
          () =>
            [...document.querySelectorAll(".statuslist__row")]
              .map((r) => r.dataset.status)
              .indexOf("in rehearsal") === 7,
        );
        if ((await focusedPart()) !== "in rehearsal:name")
          throw new Error(`after ⌃⌘↑, focus is on ${await focusedPart()}`);
        await page.getByRole("button", { name: "Move “idea” down" }).click();
        await until(
          page,
          "idea to move down",
          () => document.querySelectorAll(".statuslist__row")[1]?.dataset.status === "idea",
        );

        // Rename drafting, which The Weight of Water has.
        await page
          .locator(`input[aria-label="${await nameField("drafting")}"]`)
          .fill("first draft");
        await page.keyboard.press("Enter");
        await until(page, "the rename", () =>
          [...document.querySelectorAll(".statuslist__row")].some(
            (r) => r.dataset.status === "first draft",
          ),
        );
        const edited = [
          "outlining",
          "idea",
          "first draft",
          "revising",
          "workshop",
          "submitted",
          "produced",
          "in rehearsal",
          "shelved",
        ];
        if ((await rows()).join("|") !== edited.join("|"))
          throw new Error(`the edited list reads ${(await rows()).join(", ")}`);

        // Progress off.
        await page.getByRole("switch", { name: "Show Progress column" }).click();
        await page.keyboard.press("Escape");
        await page.waitForSelector(".sheet", { state: "detached", timeout: 5000 });
        await page.keyboard.press("Meta+Shift+KeyO");
        await page.waitForSelector(".vault-list", { timeout: 15000 });
        const headers = await page.locator('.vault-list [role="columnheader"]').allInnerTexts();
        if (headers.join("|") !== "Play|Status|Modified")
          throw new Error(`with Progress off the headers read ${headers.join(" · ")}`);
        if (await page.locator(".playrow__progress").count())
          throw new Error("with Progress off, a row still has its cell");
        await audit(page, "plays screen without Progress");

        // The play keeps its word; the popup offers the list, in order, and that word.
        await page.getByRole("button", { name: /^Status for The Weight of Water(?! \d)/ }).click();
        await page.waitForSelector(".menu", { timeout: 5000 });
        const offered = (await page.locator(".menu .menu__item").allInnerTexts()).map((t) =>
          t.trim(),
        );
        await page.keyboard.press("Escape");
        await page.waitForSelector(".menu", { state: "detached", timeout: 5000 });
        const expected = ["No Status", ...edited, "drafting"];
        if (offered.join("|") !== expected.join("|"))
          throw new Error(`the status popup offers ${offered.join(", ")}`);

        // Put it all back.
        await general();
        await page.getByRole("button", { name: "Delete “in rehearsal”" }).click();
        await until(
          page,
          "the delete",
          () =>
            ![...document.querySelectorAll(".statuslist__row")].some(
              (r) => r.dataset.status === "in rehearsal",
            ),
        );
        if (!(await page.evaluate(() => !!document.activeElement?.closest(".statuslist__row")))) {
          throw new Error(`after a delete, focus is on ${await focusedPart()}`);
        }
        await page
          .locator(`input[aria-label="${await nameField("first draft")}"]`)
          .fill("drafting");
        await page.keyboard.press("Enter");
        await page.getByRole("button", { name: "Move “idea” up" }).click();
        await page.getByRole("switch", { name: "Show Progress column" }).click();
        await until(
          page,
          "the shipped list back",
          (list) =>
            [...document.querySelectorAll(".statuslist__row")]
              .map((r) => r.dataset.status)
              .join("|") === list,
          shipped.join("|"),
        );
        await page.keyboard.press("Escape");
        await page.waitForSelector(".sheet", { state: "detached", timeout: 5000 });
        await page.waitForSelector(".playrow__progress", { timeout: 5000 });
        await page.locator(".playrow__title", { hasText: /^The Weight of Water$/ }).click();
        await page.waitForSelector(".paneroot", { timeout: 20000 });
      },
    },
    {
      // Launch goes back where the writer left off, reopening the page that
      // was open when the application closed. A writer who went
      // back to the Plays screen left off there, and the relaunch below has to
      // open it rather than the play they had closed.
      name: "launch · a writer back on the Plays screen has left off there",
      feature: "app",
      async run(page) {
        await page.keyboard.press("Meta+Shift+KeyO");
        await page.waitForSelector(".vault-list", { timeout: 15000 });
        await until(page, "the Plays screen to be where the writer left off", async () => {
          const stored = window.__TAURI_INTERNALS__
            ? (await window.__TAURI_INTERNALS__.invoke("get_settings")).lastPlay
            : JSON.parse(localStorage.getItem("proscenium:dev:settings") ?? "{}").lastPlay;
          return stored == null;
        });
        await page.reload();
      },
    },
    {
      name: "launch · the relaunch opens on the Plays screen it was left on",
      feature: "app",
      async run(page) {
        await page.waitForSelector(".vault-list", { timeout: 20000 });
        // Launch walks into a play only once the folder and the settings have
        // answered; give it longer than that takes to go the wrong way.
        await page.waitForTimeout(1500);
        await absent(page, ".paneroot", "the writer left off on the Plays screen, not in a play");
        await visible(page, ".vault-list", { minHeight: 40 });
        await page.locator(".playrow__title", { hasText: /^The Weight of Water$/ }).click();
        await page.waitForSelector(".paneroot", { timeout: 20000 });
      },
    },
    {
      // The relaunches below have to open INTO the play, not flash the play
      // page and then jump. On the way in stood the Welcome
      // screen, the Plays screen, and the play itself before it was ready: an
      // empty page while the script was read, the first page before the layout
      // landed, then a jump to where the writer left off. A check that runs
      // after a reload only ever sees where it ended, so this watches every
      // later launch from its first mutation. It writes down each screen that
      // is VISIBLE, in order (under the launch screen, only the launch screen
      // is), and what the script showed in the frame the launch screen went.
      // Playwright's init script is the only way in that early, hence the dev
      // mock.
      name: "launch · watch every relaunch from its first frame",
      feature: "app",
      devMock: true,
      async run(page) {
        await page.addInitScript(() => {
          const seen = [];
          window.__prosceniumLaunchScreens = seen;
          const screens = [
            [".welcome", "welcome"],
            [".vault-screen", "plays"],
            [".paneroot", "play"],
          ];
          new MutationObserver(() => {
            // The first frame: #root as the parser made it, before any module
            // has run. Light or dark has to be settled already, and the launch
            // screen already drawn (boot-theme.js, index.html).
            if (!window.__prosceniumFirstFrame && document.getElementById("root")) {
              window.__prosceniumFirstFrame = {
                theme: document.documentElement.dataset.theme ?? null,
                launch: !!document.querySelector("#root > .launch-screen"),
              };
            }
            const shown = document.querySelector(".launch-screen")
              ? "launch"
              : screens
                  .filter(([selector]) => document.querySelector(selector))
                  .map(([, name]) => name)
                  .join("+");
            if (!shown || seen.at(-1) === shown) return;
            if (seen.at(-1) === "launch") {
              const scroller = document.querySelector(".play-page")?.closest(".pane__body");
              window.__prosceniumAtReveal = {
                text: document.querySelector(".play-page .ProseMirror")?.textContent?.length ?? 0,
                scroll: scroller?.scrollTop ?? null,
                height: scroller?.scrollHeight ?? null,
              };
            }
            seen.push(shown);
          }).observe(document, { childList: true, subtree: true });
        });
      },
    },
    {
      // A launch that goes back into the script goes back to the writer's place
      // in it — here the end of the last page — and that place has to be where
      // the play is FIRST seen, not somewhere it jumps to after.
      name: "launch · the script in front, the caret on its last page",
      feature: "app",
      devMock: true,
      async run(page) {
        await page
          .locator(".binder .binder__label", { hasText: "The Weight of Water" })
          .first()
          .click();
        await page.waitForSelector(".play-page .ProseMirror", { timeout: 10000 });
        // Through the editor: a click on the page's middle can land in a title
        // page field, and then no key reaches the script.
        await page.evaluate(() => {
          const editor = document.querySelector(".play-page .ProseMirror").editor;
          // From the top to the end, so the selection changes wherever it was.
          editor.chain().focus().setTextSelection(1).run();
          editor
            .chain()
            .setTextSelection(editor.state.doc.content.size - 1)
            .run();
        });
        await until(page, "the caret's place to be written down", () => {
          const editor = document.querySelector(".play-page .ProseMirror")?.editor;
          const kept = Number(
            localStorage.getItem("proscenium:caret:The Weight of Water.fountain"),
          );
          return editor && kept > 0 && kept >= editor.state.doc.content.size - 3;
        });
        await page.waitForTimeout(300);
        await page.reload();
      },
    },
    {
      name: "launch · the play is in place before the launch screen goes",
      feature: "app",
      devMock: true,
      async run(page) {
        await page.waitForSelector(".launch-screen", { state: "detached", timeout: 15000 });
        const screens = await page.evaluate(() => window.__prosceniumLaunchScreens ?? null);
        if (!screens) throw new Error("the launch watcher did not run");
        if (screens.join(" → ") !== "launch → play") {
          throw new Error(
            `the relaunch showed ${screens.join(" → ")}, not the launch screen and then the play`,
          );
        }
        // Light or dark from the first frame, and the launch screen in it,
        // so the light or dark mode never flashes on the way in.
        const frame = await page.evaluate(() => ({
          ...window.__prosceniumFirstFrame,
          now: document.documentElement.dataset.theme,
        }));
        if (!frame.launch) throw new Error("the first frame was not the launch screen");
        if (frame.theme !== frame.now)
          throw new Error(
            `the first frame was ${frame.theme ?? "unthemed (light)"}, the app ${frame.now}`,
          );
        const first = await page.evaluate(() => window.__prosceniumAtReveal);
        if (!first?.text) throw new Error("the launch screen went before the script had its words");
        if (!first.scroll)
          throw new Error(
            "the launch screen went with the script at its top, not at the writer's place",
          );
        // Longer than every settle the open does (caret, layout), so anything
        // still due has happened.
        await page.waitForTimeout(800);
        const now = await page.evaluate(() => {
          const scroller = document.querySelector(".play-page")?.closest(".pane__body");
          return {
            text: document.querySelector(".play-page .ProseMirror")?.textContent?.length ?? 0,
            scroll: scroller?.scrollTop ?? null,
            height: scroller?.scrollHeight ?? null,
          };
        });
        if (now.text !== first.text)
          throw new Error(
            `the script changed after it was shown (${first.text} → ${now.text} characters)`,
          );
        if (Math.abs(now.height - first.height) > 2)
          throw new Error(
            `the page layout moved after it was shown (${first.height}px → ${now.height}px tall)`,
          );
        if (Math.abs(now.scroll - first.scroll) > 2)
          throw new Error(
            `the script jumped after it was shown (${first.scroll}px → ${now.scroll}px)`,
          );
      },
    },
    {
      // LAST, because it relaunches: "When Proscenium opens: where you left off",
      // the default, must walk straight back into The Weight of Water, with
      // nothing clicked.
      name: "settings · open at launch",
      feature: "app",
      async run(page) {
        // A page in front to come back to (the relaunch check below).
        await page
          .locator(".binder .binder__label", { hasText: "1953 North Sea Flood" })
          .first()
          .click();
        await until(page, "the research sheet in front", () =>
          [...document.querySelectorAll(".material__title")].some(
            (t) => t.value === "1953 North Sea Flood",
          ),
        );
        await page.keyboard.press("Meta+Comma");
        await page.waitForSelector(".prefs", { timeout: 5000 });
        await page.locator('.prefs__nav [role="tab"]', { hasText: "General" }).click();
        const launch = () => page.getByRole("button", { name: /^Show when Proscenium opens/ });
        if (!/Where you left off/.test((await launch().getAttribute("aria-label")) ?? "")) {
          throw new Error(
            `launch does not default to where the writer left off: "${await launch().getAttribute("aria-label")}"`,
          );
        }
        await launch().click();
        await page.waitForSelector(".menu", { timeout: 5000 });
        await onTop(page, '.menu__item[role="menuitemradio"]');
        await page
          .locator('.menu__item[role="menuitemradio"]', { hasText: "Where you left off" })
          .click();
        const popup = await launch().getAttribute("aria-label");
        if (!/Where you left off/.test(popup ?? ""))
          throw new Error(`the launch popup says "${popup}"`);
        await page.keyboard.press("Escape");
        await page.waitForSelector(".sheet", { state: "detached", timeout: 5000 });
        await page.waitForTimeout(300);
        // A reload ends a check: in the native self-test it replaces the page
        // the harness runs in, which resumes at the NEXT check. Nothing may
        // follow it here, or it would never run in the real app.
        await page.evaluate(() => {
          if (!window.__prosceniumTelemetry) return;
          for (const key of ["proscenium:dev:settings", "proscenium:settings"]) {
            const stored = JSON.parse(localStorage.getItem(key) ?? "{}");
            localStorage.setItem(key, JSON.stringify({ ...stored, privacyNoticeSeen: false }));
          }
        });
        await page.reload();
      },
    },
    {
      // Straight after the relaunch above, and so last too.
      name: "settings · relaunch opens the last play",
      feature: "app",
      async run(page) {
        // The play is seen when the launch screen goes, not before: it opens
        // under it.
        await page.waitForSelector(".launch-screen", { state: "detached", timeout: 20000 });
        // The play, not its script page: the panes come back as they were left,
        // with the research sheet the check above put in front.
        await page.waitForSelector(".binder", { timeout: 20000 });
        await visible(page, ".paneroot", { minWidth: 300, minHeight: 300 });
        await absent(
          page,
          ".vault-list",
          "launch was asked to open the last play, not the Plays screen",
        );
        // The binder names the play. The toolbar's title names whichever
        // document is in front, which in the native self-test, with the dev-mock
        // checks before this one skipped, is a research sheet of the same play.
        // The binder can draw before the play's title arrives, reading "Play"
        // for a moment, so wait for a title rather than read the first frame.
        const play = await until(
          page,
          "the binder to name a play",
          () => {
            const text = document.querySelector(".binder__project")?.textContent?.trim() ?? "";
            return text && text !== "Play" ? text : null;
          },
          undefined,
          5000,
        ).catch(() => page.locator(".binder__project").innerText());
        if (!/Weight of Water/.test(play))
          throw new Error(`launch opened "${play}", not the last play`);
        // And the page that was open when it closed. A sheet's
        // tab was pruned against the binder of the moment the play's folder
        // opened — empty, a few awaits before the play's own arrived — so the
        // script came back instead, every time.
        await until(page, "the page that was open to come back", () =>
          [...document.querySelectorAll(".material__title")].some(
            (t) => t.value === "1953 North Sea Flood" && t.getClientRects().length > 0,
          ),
        );
      },
    },
    {
      // Straight after the relaunch, from what the watcher above wrote down.
      name: "launch · the relaunch opens into the play, with nothing on the way",
      feature: "app",
      devMock: true,
      async run(page) {
        const screens = await page.evaluate(() => window.__prosceniumLaunchScreens ?? null);
        if (!screens) throw new Error("the launch watcher did not run");
        // Seeing the launch screen is what says the watcher saw the start.
        if (screens.join(" → ") !== "launch → play") {
          throw new Error(
            `the relaunch showed ${screens.join(" → ")}, not the launch screen and then the play`,
          );
        }
        await absent(page, ".launch-screen", "the play is open; the launch screen has gone");
        const busy = await page.locator(".app-shell[aria-busy]").count();
        if (busy) throw new Error("the window still says it is busy with the play open");
      },
    },
    {
      // The Welcome screen stands in the window while a launch reopens the last
      // Plays folder. The reports notice must not appear there and be counted
      // as seen by a writer who never saw it: the installed app once did
      // exactly that. "privacy · reports carry nothing of the play" set the
      // notice back to unseen before the relaunch above.
      name: "a relaunch into a play shows the privacy toast once",
      feature: "app",
      devMock: true,
      async run(page) {
        await page.waitForSelector(".toast", { timeout: 5000 });
        await visible(page, ".toast", { minWidth: 200, minHeight: 24 });
        const text = await page.locator(".toast__title").innerText();
        if (
          text !==
          "Proscenium sends anonymous usage and crash reports, never your writing, and you can switch them off in Privacy settings."
        ) {
          throw new Error(`privacy toast reads ${JSON.stringify(text)}`);
        }
        await until(
          page,
          "the displayed notice to be remembered",
          () =>
            JSON.parse(localStorage.getItem("proscenium:dev:settings") ?? "{}")
              .privacyNoticeSeen === true,
        );
        await page.getByRole("button", { name: "Settings", exact: true }).click();
        await page.waitForSelector(".prefs", { timeout: 5000 });
        const chosen = await page.locator('.prefs__nav [aria-selected="true"]').innerText();
        if (chosen !== "Privacy") throw new Error(`notice opened ${chosen}`);
        await page.keyboard.press("Escape");
        await page.reload();
      },
    },
    {
      name: "a seen notice stays seen on the next launch",
      feature: "app",
      devMock: true,
      async run(page) {
        await page.waitForSelector(".binder", { timeout: 20000 });
        await page.waitForTimeout(300);
        await absent(page, ".toast", "a seen privacy notice must not repeat");
        await page.evaluate(() => {
          localStorage.setItem("proscenium:dev:analytics-key", "false");
          for (const key of ["proscenium:dev:settings", "proscenium:settings"]) {
            const stored = JSON.parse(localStorage.getItem(key) ?? "{}");
            localStorage.setItem(key, JSON.stringify({ ...stored, privacyNoticeSeen: false }));
          }
        });
        await page.reload();
      },
    },
    {
      name: "a build without a key leaves the workspace notice pending",
      feature: "app",
      devMock: true,
      async run(page) {
        await page.waitForSelector(".binder", { timeout: 20000 });
        await page.waitForTimeout(300);
        await absent(page, ".toast", "a build without a key must not announce sending");
        const seen = await page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("proscenium:dev:settings") ?? "{}").privacyNoticeSeen,
        );
        if (seen !== false) throw new Error("a build without a key consumed the notice");
        await page.evaluate(() => {
          localStorage.removeItem("proscenium:dev:analytics-key");
          for (const key of ["proscenium:dev:settings", "proscenium:settings"]) {
            const stored = JSON.parse(localStorage.getItem(key) ?? "{}");
            localStorage.setItem(key, JSON.stringify({ ...stored, privacyNoticeSeen: true }));
          }
        });
      },
    },
    {
      // Finder hands the app a script inside another play (docs/app/keeping-work/storage-and-file-format.md#STOR-D5): that play
      // opens with that script in front. `__prosceniumOpenFiles` is the mock's
      // stand-in for `RunEvent::Opened` — queue, then signal.
      name: "finder · a script in a play opens its play",
      feature: "workspace",
      devMock: true,
      async run(page) {
        await page.evaluate(() =>
          window.__prosceniumOpenFiles([
            "/dev/sample-vault/The Lighthouse/The Lighthouse.fountain",
          ]),
        );
        await until(page, "The Lighthouse to open", () =>
          document.querySelector(".doctitle")?.textContent?.includes("The Lighthouse"),
        );
        await page.waitForSelector(".paneroot", { timeout: 15000 });
      },
    },
    {
      // A play from some other folder asks before anything changes, and Cancel
      // changes nothing.
      name: "finder · a play elsewhere asks first",
      feature: "workspace",
      devMock: true,
      async run(page) {
        await page.evaluate(() =>
          window.__prosceniumOpenFiles(["/dev/elsewhere/Lear/Lear.proscenium"]),
        );
        await page.waitForSelector(".openfile", { timeout: 10000 });
        const title = await page.locator(".sheet__title").innerText();
        if (!/Open “Lear”\?/.test(title)) throw new Error(`the sheet asks "${title}"`);
        const lede = await page.locator(".openfile__lede").innerText();
        if (!/isn't your Plays folder/.test(lede)) throw new Error(`the sheet says "${lede}"`);
        await visible(page, ".sheet .btn--primary", { minWidth: 120 });
        await audit(page, "open elsewhere sheet");
        await page.keyboard.press("Escape");
        await page.waitForSelector(".openfile", { state: "detached", timeout: 5000 });
        const doc = await page.locator(".doctitle").innerText();
        if (!doc.includes("The Lighthouse")) throw new Error(`Cancel left "${doc}" open`);
      },
    },
    {
      // A loose script offers to become a play, copied in (docs/app/keeping-work/storage-and-file-format.md#STOR-D12).
      name: "finder · a loose script becomes a play when asked",
      feature: "workspace",
      devMock: true,
      async run(page) {
        await page.evaluate(() => window.__prosceniumOpenFiles(["/dev/outside/Draft.fountain"]));
        await page.waitForSelector(".import-desk__review", { timeout: 10000 });
        const title = await page.locator(".sheet__title").innerText();
        if (title !== "Review Your Draft") {
          throw new Error(`the sheet asks "${title}"`);
        }
        await audit(page, "Fountain import review");
        await page.getByRole("button", { name: "Create New Play", exact: true }).click();
        await until(page, "the new play to open", () =>
          document.querySelector(".doctitle")?.textContent?.includes("The Undertow"),
        );
        await until(page, "its script to load", () =>
          document.querySelector(".ProseMirror")?.textContent?.includes("It was never this quiet."),
        );
      },
    },
    {
      // One .fdx story (docs/app/importing/document-import.md#IMPT-35): opened with Proscenium, an .fdx
      // becomes a new play, and the .fdx is kept beside the script.
      name: "finder · an .fdx becomes a play and is kept",
      feature: "import",
      devMock: true,
      async run(page) {
        await page.evaluate(() => window.__prosceniumOpenFiles(["/dev/outside/Hamlet.fdx"]));
        await page.waitForSelector(".import-desk__review", { timeout: 10000 });
        await audit(page, "FDX import review");
        await page.getByRole("button", { name: "Create New Play", exact: true }).click();
        await until(page, "Hamlet to open", () =>
          document.querySelector(".doctitle")?.textContent?.includes("Hamlet"),
        );
        await until(page, "the converted script", () =>
          document.querySelector(".ProseMirror")?.textContent?.includes("Who's there?"),
        );
        // The binder files the kept .fdx as a document of the play.
        await until(
          page,
          "the kept .fdx in the binder",
          () =>
            [...document.querySelectorAll(".binder .binder__label")].filter(
              (l) => l.textContent === "Hamlet",
            ).length >= 2,
        );
        if (!(await page.locator(".binder__label", { hasText: "Originals" }).count()))
          throw new Error("the original has no folder in the binder");
      },
    },
    {
      // docs/app/importing/document-import.md#IMPT-89: a package-form .pages
      // opened from Finder is a folder. It reads like one chosen in the sheet,
      // and the play keeps it zipped whole, as Harbor.pages.zip.
      name: "finder · a package-form Pages document becomes a play and is kept zipped",
      feature: "import",
      devMock: true,
      async run(page) {
        for (const file of harborPackage())
          await page.evaluate(({ path, base64 }) => window.__prosceniumOutsideFile(path, base64), {
            path: `/dev/outside/Harbor.pages/${file.path}`,
            base64: toBase64(file.bytes),
          });
        await page.evaluate(() => window.__prosceniumOpenFiles(["/dev/outside/Harbor.pages"]));
        await page.waitForSelector(".import-desk__review", { timeout: 10000 });
        if ((await page.locator("#import-play-title").inputValue()) !== "Harbor")
          throw new Error("the package's play is not named for it");
        await page.getByRole("button", { name: "Create New Play", exact: true }).click();
        await until(page, "Harbor to open", () =>
          document.querySelector(".doctitle")?.textContent?.includes("Harbor"),
        );
        await until(page, "the converted script", () =>
          document.querySelector(".ProseMirror")?.textContent?.includes("There is a difference."),
        );
        // By store key: __prosceniumPeek reads from the folder open now, and
        // that is no longer the Plays folder.
        const kept = await page.evaluate(() =>
          window.__prosceniumPeekKey("Harbor/Originals/Harbor.pages.zip"),
        );
        if (!kept?.startsWith("PK") || !kept.includes("Harbor.pages/Index.zip"))
          throw new Error("the package was not kept whole as Originals/Harbor.pages.zip");
      },
    },
    {
      name: "finder · a file that is not there says so",
      feature: "workspace",
      devMock: true,
      async run(page) {
        await page.evaluate(() => window.__prosceniumOpenFiles(["/dev/outside/Gone.fountain"]));
        await until(page, "the toast", () =>
          /couldn't open “Gone\.fountain”/.test(
            document.querySelector(".toast")?.textContent ?? "",
          ),
        );
      },
    },
    {
      // Only the latest open lands, and an open never mixes two scripts. The
      // second script's read is held — a script still downloading from iCloud
      // — while the writer types into the first: those words go to the first
      // script's file. The path used to move before the read, so autosave wrote
      // them over the second script instead. Then a click back on the open
      // script takes back a click on another that is still reading.
      name: "scripts · a slow open never mixes two scripts",
      feature: "storage",
      devMock: true,
      async run(page) {
        const first = "The Weight of Water.fountain";
        const second = "Second Draft.fountain";
        const row = (label) => page.locator(".binder .binder__label", { hasText: label }).first();
        const peek = (rel) => page.evaluate((r) => window.__prosceniumPeek(r), rel);
        await page.keyboard.press("Meta+Shift+KeyO");
        await page.waitForSelector(".vault-list", { timeout: 15000 });
        await page.locator(".playrow__title", { hasText: /^The Weight of Water$/ }).click();
        await page.waitForSelector(".paneroot", { timeout: 20000 });
        await page.locator(".seg__btn", { hasText: "Script" }).first().click();
        await page.waitForSelector(".play-page", { timeout: 20000 });
        // A second script arrives from outside, and is filed.
        await page.evaluate(
          (rel) =>
            window.__prosceniumExternalChange(
              rel,
              "Title: Second Draft\n\nThe harbour, years later.\n",
            ),
          second,
        );
        await until(page, "the second script in the binder", () =>
          [...document.querySelectorAll(".binder .binder__label")].some(
            (l) => l.textContent === "Second Draft",
          ),
        );
        const secondBefore = await peek(second);

        await page.evaluate((rel) => window.__prosceniumGate("read", rel), second);
        await row("Second Draft").click();
        await page.locator(".ProseMirror").first().focus();
        await page.keyboard.press("Meta+ArrowDown");
        await page.keyboard.type(" Ebb and flow.");
        await until(
          page,
          "the words typed during the open to reach the first script",
          (rel) => (window.__prosceniumPeek(rel) ?? "").includes("Ebb and flow."),
          first,
        );
        await page.evaluate(() => window.__prosceniumOpenGates());
        await until(page, "the second script to open", () =>
          document
            .querySelector(".ProseMirror")
            ?.textContent?.includes("The harbour, years later."),
        );
        if ((await peek(second)) !== secondBefore) {
          throw new Error(
            `the second script's file changed: ${JSON.stringify((await peek(second))?.slice(0, 80))}`,
          );
        }
        await absent(page, ".banner--conflict", "an open that finished late raised a conflict");

        await page.evaluate((rel) => window.__prosceniumGate("read", rel), first);
        await row("The Weight of Water").click();
        await page.waitForTimeout(150);
        await row("Second Draft").click();
        await page.evaluate(() => window.__prosceniumOpenGates());
        await page.waitForTimeout(800);
        const text = await page.evaluate(
          () => document.querySelector(".ProseMirror")?.textContent ?? "",
        );
        if (!text.includes("The harbour, years later.")) {
          throw new Error("an open whose read came back late replaced the script asked for last");
        }
      },
    },
    {
      name: "copies kept during a save are readable in Changes",
      feature: "review",
      devMock: true,
      async run(page) {
        const rel = "Second Draft.fountain";
        const words = "ONLY COPY OF AN EXTERNAL EDIT\n".repeat(120);
        const before = await page.evaluate((path) => window.__prosceniumPeek(path), rel);
        await page.evaluate(
          ([path, text]) => window.__prosceniumSavedCopy(path, text),
          [rel, words],
        );
        await page.locator(".seg__btn", { hasText: "Changes" }).first().click();
        const row = page.getByRole("button", { name: /Saved copy of Second Draft/ });
        await row.click();
        const text = page.getByRole("textbox", { name: "Saved words from Second Draft.fountain" });
        await text.waitFor({ state: "visible" });
        if ((await text.inputValue()) !== words)
          throw new Error("the kept copy did not show all its words");
        const properties = await text.evaluate((field) => ({
          readOnly: field.readOnly,
          focused: document.activeElement === field,
          scrolls: field.scrollHeight > field.clientHeight,
        }));
        if (!properties.readOnly || !properties.focused || !properties.scrolls)
          throw new Error(`kept copy cannot be read by keyboard: ${JSON.stringify(properties)}`);
        await audit(page, "saved copy");
        await page.keyboard.press("Escape");
        await page.waitForSelector(".sheet", { state: "detached" });
        if ((await page.evaluate((path) => window.__prosceniumPeek(path), rel)) !== before)
          throw new Error("reading a saved copy changed the script");
        await row.click();
        await text.waitFor({ state: "visible" });
        if ((await text.inputValue()) !== words)
          throw new Error("closing the saved copy removed its words");
        await page.keyboard.press("Escape");
        await page.locator(".seg__btn", { hasText: "Script" }).first().click();
      },
    },
    {
      // "Keep this one" replaces the other version only once that version is
      // kept (docs/app/keeping-work/storage-and-file-format.md#STOR-D9, docs/app/keeping-work/storage-and-file-format.md#STOR-105). Theirs arrives while ours is unsaved, and then
      // cannot be read — bytes that are not text, a download not finished. It
      // used to count as "gone", so ours went over it with nothing kept. Once
      // it can be read, Keep this pins it and writes ours.
      name: "alternate event spelling gates unsaved words and Keep this preserves theirs",
      feature: "storage",
      devMock: true,
      async run(page) {
        const second = "Second Draft.fountain";
        const peek = (rel) => page.evaluate((r) => window.__prosceniumPeek(r), rel);
        await page.waitForSelector(".play-page", { timeout: 10000 });
        await page.locator(".ProseMirror").first().focus();
        await page.keyboard.press("Meta+ArrowDown");
        await page.keyboard.type(" Ours, typed here.");
        await page.evaluate(
          (rel) =>
            window.__prosceniumExternalAlias(
              rel,
              rel.toUpperCase(),
              "Title: Second Draft\n\nTHEIRS, from another Mac.\n",
            ),
          second,
        );
        await page.waitForSelector(".banner--conflict", { timeout: 5000 });
        // Both answers are reachable without a pointer: ⌃⇥ lands on the one the
        // banner leads with, ← reaches the other. Nothing is pressed.
        const lead = await areaKeysReach(page, ".banner-area");
        if (lead.text !== "Use the other")
          throw new Error(`⌃⇥ landed on ${lead.desc}, not Use the other`);
        await page.keyboard.press("ArrowLeft");
        const other = await focused(page);
        if (other.text !== "Keep this one")
          throw new Error(`← in the banner went to ${other.desc}`);
        await page.locator(".ProseMirror").first().focus();
        await page.evaluate(
          (rel) => window.__prosceniumGate("read", rel, { fail: "file is not valid UTF-8" }),
          second,
        );
        await page.locator(".banner--conflict .btn", { hasText: "Keep this one" }).click();
        await until(page, "the refusal", () =>
          /can't be read here/.test(document.querySelector(".toast")?.textContent ?? ""),
        );
        const refused = await peek(second);
        const bannerStayed = await page.evaluate(
          () => !!document.querySelector(".banner--conflict"),
        );
        await page.evaluate(() => window.__prosceniumOpenGates());
        if (!refused?.includes("THEIRS") || refused.includes("Ours, typed here.")) {
          throw new Error(
            `Keep this wrote over a version it could not read: ${JSON.stringify(refused?.slice(-60))}`,
          );
        }
        if (!bannerStayed) throw new Error("the banner went away with nothing chosen");

        await page.locator(".banner--conflict .btn", { hasText: "Keep this one" }).click();
        await until(
          page,
          "ours on disk",
          (rel) => (window.__prosceniumPeek(rel) ?? "").includes("Ours, typed here."),
          second,
        );
        await page.waitForSelector(".banner--conflict", { state: "detached", timeout: 5000 });
        const kept = await page.evaluate(() =>
          window.__prosceniumVersionsWith("THEIRS, from another Mac."),
        );
        if (!kept.some((v) => v.pinned)) {
          throw new Error(`theirs was replaced without a pinned version: ${JSON.stringify(kept)}`);
        }
      },
    },
    {
      // A restore lands in the script it was chosen from, or nowhere. The
      // writer chooses a version of the script on screen while another script
      // is still opening; the open finishes before the version is read. The
      // version used to be written into the script that had just opened.
      name: "versions · a restore lands in the script it was chosen from, or nowhere",
      feature: "review",
      devMock: true,
      async run(page) {
        const first = "The Weight of Water.fountain";
        const second = "Second Draft.fountain";
        const peek = (rel) => page.evaluate((r) => window.__prosceniumPeek(r), rel);
        const firstBefore = await peek(first);
        const secondBefore = await peek(second);
        await page.evaluate((rel) => window.__prosceniumGate("read", rel), first);
        await page
          .locator(".binder .binder__label", { hasText: "The Weight of Water" })
          .first()
          .click();
        await openFromDocumentMenu(page, /Versions/);
        await page.waitForSelector(".historypanel__preview", { timeout: 5000 });
        await until(page, "a version's text", () => {
          const text = document.querySelector(".historypanel__preview")?.textContent ?? "";
          return text !== "" && !/Loading/.test(text);
        });
        await page.evaluate(() => window.__prosceniumGate("versionRead", null));
        await page.locator(".sheet .btn", { hasText: "Restore…" }).first().click();
        await page.waitForSelector(".alert", { timeout: 5000 });
        await page
          .locator(".alert .btn", { hasText: /^Restore$/ })
          .first()
          .click();
        await until(
          page,
          "the restore to be reading its version",
          () => window.__prosceniumHeld("versionRead") > 0,
        );
        // The other script finishes opening, and only then is the version read.
        await page.evaluate(() => window.__prosceniumOpenGates("read"));
        await until(page, "the first script to open", () =>
          document
            .querySelector(".ProseMirror")
            ?.textContent?.includes("The pipe's been crying all night."),
        );
        await page.evaluate(() => window.__prosceniumOpenGates());
        await until(page, "the restore to be refused", () =>
          /nothing was replaced/.test(document.querySelector(".toast")?.textContent ?? ""),
        );
        for (let i = 0; i < 4 && (await page.locator(".alert, .sheet").count()); i++) {
          await page.keyboard.press("Escape");
          await page.waitForTimeout(150);
        }
        if ((await peek(first)) !== firstBefore) {
          throw new Error("the version went into the script that opened meanwhile");
        }
        if ((await peek(second)) !== secondBefore) {
          throw new Error(
            "the script the version was chosen from changed without it being on screen",
          );
        }
      },
    },
    {
      // Leaving the play keeps what an open sheet holds (docs/app/keeping-work/storage-and-file-format.md#STOR-104). Words
      // typed a moment before ⌘⇧O used to miss the file, and words behind the
      // sheet's "changed somewhere else" choice were dropped outright; now the
      // first land and the second are kept in Versions.
      name: "sheets · leaving the play keeps a sheet's last words",
      feature: "markdown",
      devMock: true,
      async run(page) {
        const mara = "Characters/Mara.md";
        const openMara = async () => {
          await page.locator(".binder .binder__label", { hasText: "Mara" }).first().click();
          await page.waitForSelector(".material .ProseMirror", { timeout: 10000 });
          await page.waitForTimeout(300);
          await page.locator(".material .ProseMirror").first().click();
          await page.keyboard.press("Meta+ArrowDown");
        };
        const enterPlay = async () => {
          await page.waitForSelector(".vault-list", { timeout: 15000 });
          await page.locator(".playrow__title", { hasText: /^The Weight of Water$/ }).click();
          await page.waitForSelector(".binder", { timeout: 20000 });
        };
        await openMara();
        await page.keyboard.type(" LAST WORDS BEFORE LEAVING");
        await page.keyboard.press("Meta+Shift+KeyO");
        await page.waitForSelector(".vault-list", { timeout: 15000 });
        const landed = await page.evaluate(
          (key) => window.__prosceniumPeekKey(key) ?? "",
          `The Weight of Water/${mara}`,
        );
        if (!landed.includes("LAST WORDS BEFORE LEAVING")) {
          throw new Error(
            `the sheet's last words never reached its file: ${JSON.stringify(landed.slice(-60))}`,
          );
        }

        await enterPlay();
        await openMara();
        await page.keyboard.type(" WORDS BEHIND THE CHOICE");
        const theirs =
          (await page.evaluate((r) => window.__prosceniumPeek(r), mara)) +
          "\nEdited on the iPad.\n";
        await page.evaluate(([r, t]) => window.__prosceniumExternalChange(r, t), [mara, theirs]);
        await page.waitForSelector(".material__gate", { timeout: 5000 });
        await page.keyboard.press("Meta+Shift+KeyO");
        await page.waitForSelector(".vault-list", { timeout: 15000 });
        const kept = await page.evaluate(() =>
          window.__prosceniumVersionsWith("WORDS BEHIND THE CHOICE"),
        );
        if (!kept.some((v) => v.pinned)) {
          throw new Error(
            `words behind the sheet's choice were kept nowhere: ${JSON.stringify(kept)}`,
          );
        }
        await enterPlay();
      },
    },
    {
      // A binder op waiting on a slow write finishes in its play, or not at
      // all. Trash a script whose save is still out and leave straight away:
      // the op used to resume after the vault had moved to the Plays folder,
      // and write a play file at its root — after which the Plays folder
      // refused itself as "a play".
      name: "binder · an op waiting on a slow write never runs in the Plays folder",
      feature: "workspace",
      devMock: true,
      async run(page) {
        const second = "Second Draft.fountain";
        await page.locator(".binder .binder__label", { hasText: "Second Draft" }).first().click();
        await page.locator(".seg__btn", { hasText: "Script" }).first().click();
        await page.waitForSelector(".play-page", { timeout: 10000 });
        // Kept by the Keep this check above.
        await until(page, "Second Draft open", () =>
          document.querySelector(".ProseMirror")?.textContent?.includes("Ours, typed here."),
        );
        const before = await page.evaluate(() => window.__prosceniumStoreKeys());
        await page.evaluate((r) => window.__prosceniumGate("write", r), second);
        await page.locator(".ProseMirror").first().focus();
        await page.keyboard.press("Meta+ArrowDown");
        await page.keyboard.type(" words in flight");
        await until(page, "the script's write held", () => window.__prosceniumHeld("write") > 0);
        await page.evaluate(() =>
          [...document.querySelectorAll("button")]
            .find((b) => b.getAttribute("aria-label") === "Actions for “Second Draft”")
            ?.click(),
        );
        await page.waitForSelector(".menu", { timeout: 5000 });
        await page.locator(".menu__item", { hasText: "Move to Trash" }).first().click();
        await page.waitForTimeout(200);
        await page.keyboard.press("Meta+Shift+KeyO");
        await page.waitForTimeout(300);
        await page.evaluate(() => window.__prosceniumOpenGates());
        await page.waitForSelector(".vault-list", { timeout: 15000 });
        await page.waitForTimeout(1000);
        const stray = (await page.evaluate(() => window.__prosceniumStoreKeys())).filter(
          (k) => !before.includes(k) && !k.includes("/"),
        );
        if (stray.length)
          throw new Error(`written at the Plays folder root: ${JSON.stringify(stray)}`);
        await page.locator(".playrow__title", { hasText: /^The Weight of Water$/ }).click();
        await page.waitForSelector(".binder", { timeout: 20000 });
      },
    },
    {
      // A scene moved from the Outline while its write is still out, and the
      // writer types in the script meanwhile: both are kept. The move used to be
      // loaded over the page when it landed — the typing gone — while the save
      // queued behind it wrote the page from before the move over the move.
      name: "board · a scene moved while the writer types keeps both",
      feature: "workspace",
      devMock: true,
      async run(page) {
        const script = "The Weight of Water.fountain";
        const typed = " Typed while a scene moved.";
        const disk = () => page.evaluate((r) => window.__prosceniumPeek(r) ?? "", script);
        const moved = (text) =>
          text.indexOf("= Morning. The truce") < text.indexOf("= Mara, alone before dawn");
        await page
          .locator(".binder .binder__label", { hasText: "The Weight of Water" })
          .first()
          .click();
        await page.locator(".seg__btn", { hasText: "Outline" }).first().click();
        await page.waitForSelector(".outliner__row", { timeout: 10000 });
        await page.evaluate((r) => window.__prosceniumGate("write", r), script);
        await page.getByRole("button", { name: "Move SCENE 1 down" }).first().click();
        await until(page, "the move's write held", () => window.__prosceniumHeld("write") > 0);
        await page.locator(".seg__btn", { hasText: "Script" }).first().click();
        await page.waitForSelector(".play-page", { timeout: 10000 });
        await page.locator(".ProseMirror").first().focus();
        await page.keyboard.press("Meta+ArrowDown");
        await page.keyboard.type(typed);
        // Long enough for autosave to queue a save behind the move.
        await page.waitForTimeout(900);
        await page.evaluate(() => window.__prosceniumOpenGates());
        await until(
          page,
          "both on disk",
          (t) => {
            const text = window.__prosceniumPeek("The Weight of Water.fountain") ?? "";
            return (
              text.includes(t) &&
              text.indexOf("= Morning. The truce") < text.indexOf("= Mara, alone before dawn")
            );
          },
          typed.trim(),
          10000,
        );
        const page_ = await page.evaluate(
          () => document.querySelector(".ProseMirror")?.textContent ?? "",
        );
        if (!page_.includes(typed.trim()))
          throw new Error("the words typed while the scene moved are gone from the page");
        if (!moved(await disk())) throw new Error("the move did not stay on disk");
        if (await page.evaluate(() => !!document.querySelector(".banner--conflict"))) {
          throw new Error('a move and typing raised a false "changed somewhere else"');
        }
        // Put the scene back for the checks that follow.
        await page.locator(".seg__btn", { hasText: "Outline" }).first().click();
        await page.waitForSelector(".outliner__row", { timeout: 10000 });
        await page.getByRole("button", { name: "Move SCENE 2 down" }).first().click();
        await until(
          page,
          "the scene back in place",
          () => {
            const text = window.__prosceniumPeek("The Weight of Water.fountain") ?? "";
            return text.indexOf("= Mara, alone before dawn") < text.indexOf("= Morning. The truce");
          },
          undefined,
          10000,
        );
        await page.locator(".seg__btn", { hasText: "Script" }).first().click();
        await page.waitForSelector(".play-page", { timeout: 10000 });
      },
    },
    {
      // The first outline note is made while a binder walk, started by a file
      // event, plans from the binder before it. The plan filed the note as a
      // newly found file with another id and committed over the note's own
      // entry; the scratchpad took that for a different note and read it over
      // the page. The native self-test lost "tur" of " Tide turns at the
      // stair." this way. Here the play file's write is held, so the plan is
      // made in that window every time.
      name: "outline · a note made while the binder is walked keeps every word",
      feature: "workspace",
      devMock: true,
      async run(page) {
        const notes = ".outline-notes .ProseMirror";
        const outlineRows = () =>
          page.evaluate(
            () =>
              [...document.querySelectorAll(".binder .binder__label")].filter(
                (l) => l.textContent === "Outline",
              ).length,
          );
        await page.locator(".seg__btn", { hasText: "Outline" }).first().click();
        await page.waitForSelector(`${notes}[contenteditable=true]`, { timeout: 10000 });
        if ((await outlineRows()) !== 0)
          throw new Error("this check needs a play whose outline note is not made yet");
        await page.locator(notes).first().click();
        await page.keyboard.press("Meta+ArrowDown");
        await page.evaluate(() =>
          window.__prosceniumGate("write", "The Weight of Water.proscenium"),
        );
        await page.keyboard.type(" Salt");
        // The save makes the note's file; its entry in the play file is held.
        await page.waitForTimeout(900);
        await page.evaluate(() =>
          window.__prosceniumExternalChange("Research/Tide tables.md", "# Tide tables\n"),
        );
        // The walk's debounce, the walk, and its plan.
        await page.waitForTimeout(1700);
        await page.evaluate(() => window.__prosceniumOpenGates());
        await page.keyboard.type(" in the tide tables.");
        await until(page, "the tide tables filed", () =>
          [...document.querySelectorAll(".binder .binder__label")].some(
            (l) => l.textContent === "Tide tables",
          ),
        );
        await page.waitForTimeout(1500);
        const text = await page.evaluate(
          (sel) => document.querySelector(sel)?.textContent ?? "",
          notes,
        );
        if (!text.includes("Salt in the tide tables.")) {
          throw new Error(
            `the scratchpad lost words while its note was filed: ${JSON.stringify(text)}`,
          );
        }
        if ((await outlineRows()) !== 1)
          throw new Error(`the binder shows ${await outlineRows()} outline notes`);
        await page.locator(".seg__btn", { hasText: "Script" }).first().click();
        await page.waitForSelector(".play-page", { timeout: 10000 });
      },
    },
    {
      // Coming back to the outline scratchpad shows what was last saved, not
      // what was read when the play opened — the next keystroke used to save
      // that old text over everything typed since. In the native self-test it
      // also caught WebKit's writing suggestions deleting "tur" (the next check).
      name: "outline · the scratchpad comes back with its latest words",
      feature: "workspace",
      async run(page) {
        const notes = ".outline-notes .ProseMirror";
        const shown = () =>
          page.evaluate((sel) => document.querySelector(sel)?.textContent ?? "", notes);
        await page.locator(".seg__btn", { hasText: "Outline" }).first().click();
        await page.waitForSelector(notes, { timeout: 10000 });
        await page.locator(notes).first().click();
        await page.keyboard.press("Meta+ArrowDown");
        await page.keyboard.type(" Tide turns at the stair.");
        await page.waitForTimeout(1200);
        await page.locator(".seg__btn", { hasText: "Script" }).first().click();
        await page.waitForSelector(".play-page", { timeout: 10000 });
        await page.locator(".seg__btn", { hasText: "Outline" }).first().click();
        await page.waitForSelector(notes, { timeout: 10000 });
        await until(
          page,
          "the scratchpad to show its words",
          (sel) =>
            (document.querySelector(sel)?.textContent ?? "").includes("Tide turns at the stair."),
          notes,
        );
        await page.locator(notes).first().click();
        await page.keyboard.press("Meta+ArrowDown");
        await page.keyboard.type(" And back.");
        await page.waitForTimeout(1200);
        const text = await shown();
        await page.locator(".seg__btn", { hasText: "Script" }).first().click();
        if (!text.includes("Tide turns at the stair. And back.")) {
          throw new Error(
            `the scratchpad lost what was typed before leaving it: ${JSON.stringify(text.slice(-80))}`,
          );
        }
      },
    },
    {
      // Coming back to the app re-reads every open file (docs/app/keeping-work/storage-and-file-format.md#STOR-86), and each read
      // used to become a row in Changes: "+0 −0" for a file nothing had
      // touched, and the app's own saves as "Changed somewhere else" wherever
      // the saving code had not moved the file's baseline. One writer's list held 54
      // of the first kind and their own Appearances edits as the second.
      name: "changes · coming back to the app lists nothing that did not change outside",
      feature: "review",
      devMock: true,
      async run(page) {
        const notes = ".outline-notes .ProseMirror";
        const show = async (surface, selector) => {
          await page.locator(".seg__btn", { hasText: surface }).first().click();
          await page.waitForSelector(selector, { timeout: 10000 });
        };
        const waiting = () =>
          page.evaluate(
            () =>
              [...document.querySelectorAll(".changes button")].filter(
                (b) => b.textContent.trim() === "Keep",
              ).length,
          );
        // Every file the app reads on the way back, and every row it would add.
        const comeBack = async () => {
          await page.evaluate(() => window.dispatchEvent(new Event("focus")));
          await page.waitForTimeout(800);
        };
        await show("Changes", ".changes");
        for (let count = await waiting(); count > 0; count = await waiting()) {
          await page
            .locator(".changes button", { hasText: /^Keep$/ })
            .first()
            .click();
          await until(
            page,
            "an earlier change to be kept",
            (before) =>
              [...document.querySelectorAll(".changes button")].filter(
                (b) => b.textContent.trim() === "Keep",
              ).length < before,
            count,
          );
        }

        await show("Script", ".play-page");
        await comeBack();
        await show("Changes", ".changes");
        if (await waiting())
          throw new Error("coming back to the app listed a file nothing had changed");

        // Twice: without a baseline, the first look at the note only takes one.
        for (const words of ["The stair again.", "And the door."]) {
          await show("Outline", notes);
          await page.locator(notes).first().click();
          await page.keyboard.press("Meta+ArrowDown");
          await page.keyboard.type(` ${words}`);
          await until(
            page,
            "the outline note to be saved",
            (w) =>
              window
                .__prosceniumStoreKeys()
                .some((key) => (window.__prosceniumPeekKey(key) ?? "").includes(w)),
            words,
          );
          await comeBack();
        }
        await show("Changes", ".changes");
        if (await waiting())
          throw new Error("the app's own outline saves were listed as changed somewhere else");
        await show("Script", ".play-page");
      },
    },
    {
      // macOS's writing suggestions deleted letters typed on a ProseMirror page.
      // In eight light passes of the native self-test, the check above typed
      // " Tide turns at the stair." and kept "Tide ns at the stair.": at the key
      // after "tur", WebKit sent deleteCompositionText for a composition the
      // page never saw start. With writingsuggestions="false" the same run kept
      // every letter. Suggestions stay off on every page words are typed on:
      // the script, and the prose pages of sheets and the outline notes.
      // Plain fields lost letters the same way ("paragraph" kept
      // "aph" in the Feedback box, "rehearsal" kept "arsal" in a new status),
      // so the body turns them off for every field, and none may turn them on.
      name: "text fields · writing suggestions are off wherever words are typed",
      feature: "ui",
      async run(page) {
        const said = (sel) =>
          page.evaluate((s) => {
            const el = document.querySelector(s);
            return el ? el.getAttribute("writingsuggestions") : "no page";
          }, sel);
        const body = await said("body");
        if (body !== "false")
          throw new Error(`the body has writingsuggestions=${body}, so fields inherit suggestions`);
        const onAgain = await page.evaluate(() =>
          [...document.querySelectorAll("[writingsuggestions]")]
            .filter((el) => el.getAttribute("writingsuggestions").toLowerCase() !== "false")
            .map((el) => el.id || el.getAttribute("aria-label") || el.tagName.toLowerCase()),
        );
        if (onAgain.length)
          throw new Error(`writing suggestions are turned back on in ${onAgain.join(", ")}`);
        await page.waitForSelector(".play-page .ProseMirror", { timeout: 10000 });
        const script = await said(".play-page .ProseMirror");
        if (script !== "false")
          throw new Error(`the script's page has writingsuggestions=${script}`);
        await page.locator(".seg__btn", { hasText: "Outline" }).first().click();
        await page.waitForSelector(".outline-notes .ProseMirror", { timeout: 10000 });
        const notes = await said(".outline-notes .ProseMirror");
        await page.locator(".seg__btn", { hasText: "Script" }).first().click();
        await page.waitForSelector(".play-page", { timeout: 10000 });
        if (notes !== "false")
          throw new Error(`the outline notes' page has writingsuggestions=${notes}`);
      },
    },
    {
      // A save the disk refuses is said once, in the writer's words (docs/app/keeping-work/storage-and-file-format.md#STOR-D9,
      // "When the disk refuses a write"). A script locked in Finder once
      // raised "Operation not permitted (os error 1)" in the installed app, again
      // at every autosave, with nothing about the words and nothing to do. The
      // write gate refuses the script as the vault reports a lock: the toast
      // says it is locked and the words are safe, the retries say nothing new,
      // another reason is news, and the words land once the gate opens and the
      // window comes back into focus, with nothing more typed.
      name: "saving · a refused save is said once, plainly, and lands when it can",
      feature: "storage",
      devMock: true,
      async run(page) {
        const script = "The Weight of Water.fountain";
        const toastText = () =>
          page.evaluate(() => document.querySelector(".toast")?.textContent ?? "");
        const status = () =>
          page.evaluate(() => document.querySelector(".savestatus")?.textContent ?? "");
        const errorCodes = async () =>
          (await page.evaluate(() => window.__prosceniumTelemetry())).errors;
        const refuse = (fail) =>
          page.evaluate(
            ([rel, f]) => {
              window.__prosceniumOpenGates("write");
              window.__prosceniumGate("write", rel, { fail: f });
            },
            [script, fail],
          );
        await page
          .locator(".binder .binder__label", { hasText: "The Weight of Water" })
          .first()
          .click();
        await page.locator(".seg__btn", { hasText: "Script" }).first().click();
        await page.waitForSelector(".play-page", { timeout: 10000 });
        await dismissToasts(page);
        const logged = (await errorCodes()).length;

        await refuse("locked: Operation not permitted (os error 1)");
        await page.locator(".ProseMirror").first().focus();
        await page.keyboard.press("Meta+ArrowDown");
        await page.keyboard.type(" Salt on the sill.");
        await until(page, "the refusal to be said", () =>
          /is locked in Finder/.test(document.querySelector(".toast")?.textContent ?? ""),
        );
        const said = await toastText();
        for (const words of [
          "“The Weight of Water” is locked in Finder.",
          "Your words are still here, and a copy is being kept.",
          "It will save once you unlock it in Finder's Get Info window.",
        ]) {
          if (!said.includes(words))
            throw new Error(`the refused save said ${JSON.stringify(said)}, not "${words}"`);
        }
        if (/os error|not permitted|locked:/i.test(said))
          throw new Error(`the toast shows the OS's words: ${JSON.stringify(said)}`);
        await visible(page, ".toast", { minWidth: 200, minHeight: 30 });
        await audit(page, "toast · a refused save");
        await until(
          page,
          "the status line to say Not saved",
          () => document.querySelector(".savestatus")?.textContent === "Not saved",
        );

        // The retries: each pause in the typing tries again, and none of them
        // raises the toast again.
        await dismissToasts(page);
        const tried = await page.evaluate(() => window.__prosceniumFailed("write"));
        for (const words of [" The kettle.", " The door.", " The stair."]) {
          await page.keyboard.type(words);
          await page.waitForTimeout(900);
        }
        await until(
          page,
          "autosave to try three more times",
          (n) => window.__prosceniumFailed("write") >= n + 3,
          tried,
        );
        await page.waitForTimeout(200);
        if (await page.locator(".toast").count()) {
          throw new Error(
            `a retry refused the same way raised a toast again: ${JSON.stringify(await toastText())}`,
          );
        }
        await until(
          page,
          "the status line to stay on Not saved",
          () => document.querySelector(".savestatus")?.textContent === "Not saved",
        );
        const locked = (await errorCodes()).slice(logged);
        if (locked.join() !== "E-SAVE-LOCKED") {
          throw new Error(
            `one refusal, retried, logged ${JSON.stringify(locked)} (T4's error log keeps the code, once)`,
          );
        }

        // Refused for another reason: that is news.
        await refuse("No space left on device (os error 28)");
        await page.keyboard.type(" The gulls.");
        await until(page, "the new refusal to be said", () =>
          /The disk is full\./.test(document.querySelector(".toast")?.textContent ?? ""),
        );
        const full = await toastText();
        if (
          !full.includes("Your words are still here, in this window.") ||
          !full.includes("“The Weight of Water” will save once there is room on the disk.")
        ) {
          throw new Error(`a full disk said ${JSON.stringify(full)}`);
        }
        if (!(await errorCodes()).slice(logged).includes("E-SAVE-DISK-FULL"))
          throw new Error("a full disk logged no E-SAVE-DISK-FULL");

        // Room again, and back from Finder: the window's focus tries once more.
        await dismissToasts(page);
        await page.evaluate(() => window.__prosceniumOpenGates("write"));
        if ((await status()) !== "Not saved")
          throw new Error(`before the retry, the status line says "${await status()}"`);
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await until(
          page,
          "every word typed while refused to reach the script",
          (rel) =>
            ["Salt on the sill.", "The stair.", "The gulls."].every((w) =>
              (window.__prosceniumPeek(rel) ?? "").includes(w),
            ),
          script,
        );
        await until(page, "the save to be said", () =>
          /“The Weight of Water” is saved\./.test(
            document.querySelector(".toast")?.textContent ?? "",
          ),
        );
        await until(page, "the status line to say Saved", () =>
          /^Saved/.test(document.querySelector(".savestatus")?.textContent ?? ""),
        );
      },
    },
    {
      name: "leaving waits for sheet saves already accepted by this play",
      feature: "storage",
      devMock: true,
      async run(page) {
        const path = "Characters/Mara.md";
        const first = " A514 first save in flight.";
        const second = " A514 second save queued.";
        await page.locator(".binder .binder__label", { hasText: "Mara" }).first().click();
        await page.waitForSelector(".material .ProseMirror", { timeout: 10000 });
        await page.waitForTimeout(300);
        await page.evaluate((rel) => window.__prosceniumGate("write", rel), path);
        try {
          await page.locator(".material .ProseMirror").first().focus();
          await page.keyboard.press("Meta+ArrowDown");
          await page.keyboard.type(first);
          await until(
            page,
            "the sheet write in flight",
            () => window.__prosceniumHeld("write") > 0,
          );
          await page.keyboard.type(second);
          await page.waitForTimeout(900);
          await page.keyboard.press("Meta+Shift+KeyO");
          await page.waitForTimeout(200);
          if (await page.locator(".vault-list").count())
            throw new Error("the play left before its sheet writes settled");
        } finally {
          await page.evaluate(() => window.__prosceniumOpenGates("write"));
        }
        await page.waitForSelector(".vault-list", { timeout: 15000 });
        await page.locator(".playrow__title", { hasText: /^The Weight of Water$/ }).click();
        await page.waitForSelector(".binder", { timeout: 20000 });
        const disk = await page.evaluate((rel) => window.__prosceniumPeek(rel) ?? "", path);
        if (!disk.includes(first.trim()) || !disk.includes(second.trim())) {
          throw new Error("an accepted sheet save was lost or diverted to Versions while leaving");
        }
        await page.locator(".binder .binder__label", { hasText: "Mara" }).first().click();
        await until(page, "the reopened sheet to show both saves", () => {
          const words = document.querySelector(".material .ProseMirror")?.textContent ?? "";
          return (
            words.includes("A514 first save in flight.") &&
            words.includes("A514 second save queued.")
          );
        });
      },
    },
    {
      // A refused sheet keeps a recovery copy. Leaving the play pins the
      // words in Versions and explains where they were kept.
      name: "saving · a refused sheet says where its words went",
      feature: "storage",
      devMock: true,
      async run(page) {
        const mara = "Characters/Mara.md";
        await page.locator(".binder .binder__label", { hasText: "Mara" }).first().click();
        await page.waitForSelector(".material .ProseMirror", { timeout: 10000 });
        await page.waitForTimeout(300);
        await dismissToasts(page);
        await page.evaluate(
          (rel) =>
            window.__prosceniumGate("write", rel, {
              fail: "folder-locked: Operation not permitted (os error 1)",
            }),
          mara,
        );
        await page.locator(".material .ProseMirror").first().click();
        await page.keyboard.press("Meta+ArrowDown");
        await page.keyboard.type(" WORDS IN A LOCKED FOLDER");
        await until(page, "the sheet's refusal", () =>
          /The folder “Characters” is locked in Finder\./.test(
            document.querySelector(".toast")?.textContent ?? "",
          ),
        );
        const said = await page.locator(".toast").innerText();
        if (!said.includes("Your words are still here, and a copy is being kept.")) {
          throw new Error(`a refused sheet said ${JSON.stringify(said)}`);
        }
        if (!said.includes("“Mara” will save once you unlock the folder"))
          throw new Error(`a refused sheet said ${JSON.stringify(said)}`);

        await page.keyboard.press("Meta+Shift+KeyO");
        await page.waitForSelector(".vault-list", { timeout: 15000 });
        await until(page, "where the words went", () =>
          /What was typed in “Mara” is kept in Versions, because it couldn't be saved\./.test(
            document.querySelector(".toast")?.textContent ?? "",
          ),
        );
        const where = await page.locator(".toast").innerText();
        await page.evaluate(() => window.__prosceniumOpenGates("write"));
        if (!where.includes("The folder “Characters” is locked in Finder."))
          throw new Error(`leaving said ${JSON.stringify(where)}`);
        const kept = await page.evaluate(() =>
          window.__prosceniumVersionsWith("WORDS IN A LOCKED FOLDER"),
        );
        if (!kept.some((v) => v.pinned))
          throw new Error(`the refused sheet's words were kept nowhere: ${JSON.stringify(kept)}`);
        await page.locator(".playrow__title", { hasText: /^The Weight of Water$/ }).click();
        await page.waitForSelector(".binder", { timeout: 20000 });
      },
    },
    {
      // The first outline note of a play, refused because its folder is locked:
      // the message names the folder the note is made in. It used to name the
      // play's folder, which was not the one locked.
      name: "saving · a refused first outline note names the folder it goes in",
      feature: "storage",
      devMock: true,
      async run(page) {
        const notes = ".outline-notes .ProseMirror";
        await page.keyboard.press("Meta+Shift+KeyO");
        await page.waitForSelector(".vault-list", { timeout: 15000 });
        await page.locator(".playrow__title", { hasText: "The Lighthouse" }).click();
        await page.waitForSelector(".binder", { timeout: 20000 });
        await page.locator(".seg__btn", { hasText: "Outline" }).first().click();
        await page.waitForSelector(`${notes}[contenteditable=true]`, { timeout: 10000 });
        await dismissToasts(page);
        await page.evaluate(
          (rel) =>
            window.__prosceniumGate("write", rel, {
              fail: "folder-locked: Operation not permitted (os error 1)",
            }),
          "Notes/Outline.md",
        );
        await page.locator(notes).first().click();
        await page.keyboard.type("The lamp room first.");
        await until(page, "the first note's refusal", () =>
          /is locked in Finder/.test(document.querySelector(".toast")?.textContent ?? ""),
        );
        const said = await page.locator(".toast").innerText();
        await until(
          page,
          "the first outline's words to have a recovery copy",
          () =>
            Object.keys(sessionStorage).some(
              (key) =>
                key.startsWith("proscenium:dev:recovery:") &&
                (sessionStorage.getItem(key) ?? "").includes("The lamp room first."),
            ),
          undefined,
          3000,
        );
        await page.evaluate(() => window.__prosceniumOpenGates("write"));
        if (!said.includes("The folder “Notes” is locked in Finder.")) {
          throw new Error(`a refused first outline note said ${JSON.stringify(said)}`);
        }
        await dismissToasts(page);
        await page.keyboard.press("Meta+Shift+KeyO");
        await page.waitForSelector(".vault-list", { timeout: 15000 });
        await page.locator(".playrow__title", { hasText: /^The Weight of Water$/ }).click();
        await page.waitForSelector(".binder", { timeout: 20000 });
      },
    },
    {
      // A prose surface reports an edit only when the writer makes one
      // (ProseEditor). ProseMirror normalizes a document as it parses it, so an
      // editor that reported its own settling would write back a file nobody
      // touched — a change with no author, in a folder somebody's sync is
      // watching. Asserted through a gate rather than through the bytes,
      // because a write is a write even when the file it lands is identical:
      // the gate counts every attempt, and the refusal would be said out loud.
      // “Structure” is here because its Markdown does NOT come back byte for
      // byte through the bridge, so an editor that reported its own settling
      // would be caught here rather than writing the same bytes twice.
      //
      // This is the half that has to hold however the guard is built, and it
      // was not covered before. The guard used to be a race against the
      // editor's own startup, and the race is how a keystroke came to be
      // dropped.
      name: "saving · opening a document writes nothing",
      feature: "storage",
      devMock: true,
      async run(page) {
        const failed = () => page.evaluate(() => window.__prosceniumFailed("write"));
        const lock = (rel) =>
          page.evaluate(
            (r) =>
              window.__prosceniumGate("write", r, {
                fail: "folder-locked: Operation not permitted (os error 1)",
              }),
            rel,
          );
        await dismissToasts(page);
        const before = await failed();
        await lock("Characters/Jonah.md");
        await lock("Notes/Structure.md");
        try {
          await page.locator(".binder .binder__label", { hasText: "Jonah" }).first().click();
          await page.waitForSelector(".material .ProseMirror[contenteditable=true]", {
            timeout: 10000,
          });
          await page.locator(".binder .binder__label", { hasText: "Structure" }).first().click();
          await page.waitForSelector(".material .ProseMirror[contenteditable=true]", {
            timeout: 10000,
          });
          // Longer than the debounce and its max-wait ceiling together, so a
          // save that opening had asked for has had every chance to go.
          await page.waitForTimeout(3000);
        } finally {
          await page.evaluate(() => window.__prosceniumOpenGates("write"));
        }
        if ((await failed()) !== before) {
          throw new Error("opening a document tried to write it");
        }
        const said = await page.evaluate(() => document.querySelector(".toast")?.textContent ?? "");
        if (said.includes("locked in Finder"))
          throw new Error(`opening a document said ${JSON.stringify(said)}`);
        await page.locator(".seg__btn", { hasText: "Script" }).first().click();
      },
    },
    {
      name: "sheet and outline recovery survive a crash and remain readable",
      feature: "storage",
      devMock: true,
      async run(page) {
        const hasCopy = (words) =>
          Object.keys(sessionStorage).some(
            (key) =>
              key.startsWith("proscenium:dev:recovery:") &&
              (sessionStorage.getItem(key) ?? "").includes(words),
          );
        await page.locator(".binder .binder__label", { hasText: "Mara" }).first().click();
        await page.waitForSelector(".material .ProseMirror[contenteditable=true]", {
          timeout: 10000,
        });
        await page.evaluate(() =>
          window.__prosceniumGate("write", "Characters/Mara.md", {
            fail: "folder-locked: Operation not permitted (os error 1)",
          }),
        );
        await page.locator(".material .ProseMirror").first().focus();
        await page.keyboard.press("Meta+ArrowDown");
        await page.keyboard.type(" A213 FIRST SHEET WORDS.");
        await until(
          page,
          "a sheet copy at its first refusal",
          hasCopy,
          "A213 FIRST SHEET WORDS",
          3000,
        );
        await page.evaluate(() =>
          window.__prosceniumExternalChange("Characters/Mara.md", "# Changed elsewhere\n"),
        );
        await page.keyboard.type(" A213 LATEST BLOCKED SHEET WORDS.");
        await until(
          page,
          "the blocked sheet's continuing words",
          hasCopy,
          "A213 LATEST BLOCKED SHEET WORDS",
          8000,
        );

        await page
          .locator(".binder .binder__label", { hasText: "The Weight of Water" })
          .first()
          .click();
        await page.locator(".seg__btn", { hasText: "Outline" }).first().click();
        await page.waitForSelector(".outline-notes .ProseMirror[contenteditable=true]", {
          timeout: 10000,
        });
        await page.evaluate(() =>
          window.__prosceniumGate("write", "Notes/Outline.md", {
            fail: "folder-locked: Operation not permitted (os error 1)",
          }),
        );
        await page.locator(".outline-notes .ProseMirror").first().focus();
        await page.keyboard.press("Meta+ArrowDown");
        await page.keyboard.type(" A213 OUTLINE WORDS.");
        await until(
          page,
          "an outline copy at its first refusal",
          hasCopy,
          "A213 OUTLINE WORDS",
          3000,
        );
        await page.reload();
        for (let turn = 0; turn < 100; turn++) {
          if (await page.locator(".paneroot").count()) break;
          if (turn >= 10)
            await page.evaluate(() => {
              const welcome = [...document.querySelectorAll(".welcome button")].find((node) =>
                node.textContent?.includes("A folder I choose"),
              );
              const play = [...document.querySelectorAll(".playrow__title")].find(
                (node) => node.textContent === "The Weight of Water",
              );
              (welcome ?? play)?.click();
            });
          await page.waitForTimeout(150);
        }
        await page.waitForSelector(".paneroot", { timeout: 15000 });
        await page.locator(".seg__btn", { hasText: "Changes" }).first().click();
        await page
          .getByRole("heading", { name: "Recovered document copies" })
          .waitFor({ state: "visible" });
        for (const [path, words] of [
          ["Characters/Mara.md", "A213 LATEST BLOCKED SHEET WORDS"],
          ["Notes/Outline.md", "A213 OUTLINE WORDS"],
        ]) {
          const copies = page.getByRole("button", {
            name: new RegExp(`Saved copy of ${path.replaceAll(".", "\\.")}`),
          });
          let found = false;
          for (let i = 0; i < (await copies.count()); i++) {
            await copies.nth(i).click();
            const field = page.getByRole("textbox", { name: `Saved words from ${path}` });
            await field.waitFor({ state: "visible" });
            found ||= (await field.inputValue()).includes(words);
            await audit(page, "recovered document copy");
            await page.keyboard.press("Escape");
            if (found) break;
          }
          if (!found) throw new Error(`the latest recovered words from ${path} were not readable`);
        }
        await page.locator(".seg__btn", { hasText: "Script" }).first().click();
      },
    },
    {
      // A crash costs seconds at most (docs/app/keeping-work/storage-and-file-format.md#STOR-D10, docs/app/keeping-work/storage-and-file-format.md#STOR-D13). Words typed behind the
      // "changed somewhere else" banner cannot be autosaved, so a recovery
      // snapshot is their only copy. The crash is the reload that ends this
      // check: the in-memory vault comes back as its seed, as an app that died
      // before a flush comes back to the file it last wrote, and the snapshot —
      // app data — is still there for the next check to find.
      name: "recovery · words behind the banner are kept through a crash",
      feature: "storage",
      devMock: true,
      async run(page) {
        // The checks before this one left another play open.
        await page.keyboard.press("Meta+Shift+KeyO");
        await page.waitForSelector(".vault-list", { timeout: 15000 });
        await page.locator(".playrow__title", { hasText: /^The Weight of Water$/ }).click();
        // The play comes back on the surface it was left on.
        await page.waitForSelector(".paneroot", { timeout: 20000 });
        await page.locator(".seg__btn", { hasText: "Script" }).first().click();
        await page.waitForSelector(".play-page", { timeout: 20000 });
        await page.locator(".ProseMirror").first().focus();
        await page.keyboard.press("Meta+ArrowDown");
        await page.keyboard.type(" Waves.");
        // Another writer changes the script while those words are unsaved.
        await page.evaluate(() =>
          window.__prosceniumExternalChange(
            "The Weight of Water.fountain",
            "Title: The Weight of Water\n\nThe tide came in somewhere else.\n",
          ),
        );
        await page.waitForSelector(".banner--conflict", { timeout: 5000 });
        await page.keyboard.type(" The sea came in.");
        await until(
          page,
          "a recovery snapshot",
          () =>
            Object.keys(sessionStorage).some(
              (k) =>
                k.startsWith("proscenium:dev:recovery:") &&
                (sessionStorage.getItem(k) ?? "").includes("The sea came in."),
            ),
          undefined,
          12000,
        );
        await page.reload();
      },
    },
    {
      name: "recovery · the reopened script offers the words back",
      feature: "storage",
      devMock: true,
      async run(page) {
        // Launch lands wherever settings send it: the Welcome screen, the Plays
        // screen, or — with "open the last play" chosen above — the play itself,
        // by way of a moment on the Plays screen, and of the Welcome screen
        // before the last folder has reopened. Walk in only when nothing else is
        // about to, and click in the page: a screen that is only passing
        // through is gone before a locator's click could land on it.
        const clickText = (selector, text, exact = false) =>
          page.evaluate(
            ([sel, t, x]) =>
              [...document.querySelectorAll(sel)]
                .find((el) => (x ? el.textContent?.trim() === t : el.textContent?.includes(t)))
                ?.click(),
            [selector, text, exact],
          );
        let seenPlays = 0;
        let seenWelcome = 0;
        for (let t = 0; t < 200; t++) {
          const at = await page.evaluate(() =>
            document.querySelector(".banner--recovery")
              ? "banner"
              : document.querySelector(".paneroot")
                ? "play"
                : document.querySelector(".vault-list")
                  ? "plays"
                  : document.querySelector(".welcome")
                    ? "welcome"
                    : "loading",
          );
          if (at === "banner" || at === "play") break;
          if (at === "welcome" && ++seenWelcome === 10)
            await clickText("button", "A folder I choose");
          if (at === "plays" && ++seenPlays === 10)
            await clickText(".playrow__title", "The Weight of Water", true);
          await page.waitForTimeout(150);
        }
        await page.waitForSelector(".banner--recovery", { timeout: 20000 });
        await visible(page, ".banner--recovery", { minWidth: 300, minHeight: 20 });
        const said = await page.locator(".banner--recovery").innerText();
        if (!/closed before these changes were saved/i.test(said)) {
          throw new Error(`the recovery banner reads "${said}"`);
        }
        await audit(page, "recovery banner");

        // Answered from the keyboard, as a writer without a pointer would: ⌃⇥
        // from the script lands on Review…, which ⏎ opens. The banner used to
        // be outside every area, and Tab passes buttons by on a Mac with
        // keyboard navigation off, so nothing reached it.
        await page.locator(".ProseMirror").first().focus();
        const review = await areaKeysReach(page, ".banner-area");
        if (review.text !== "Review…") throw new Error(`⌃⇥ landed on ${review.desc}, not Review…`);
        await page.keyboard.press("ArrowLeft");
        if ((await focused(page)).text !== "Discard")
          throw new Error("← in the banner did not reach Discard");
        await page.keyboard.press("ArrowRight");
        await page.keyboard.press("Enter");
        await page.waitForSelector(".recoverypanel", { timeout: 5000 });
        await visible(page, ".recoverypanel__diff", { minWidth: 300, minHeight: 100 });
        const diff = await page.locator(".recoverypanel__diff").innerText();
        await audit(page, "recovery sheet");
        if (!diff.includes("The sea came in.")) {
          throw new Error(`the review does not show the lost words: ${diff.slice(0, 160)}`);
        }
        // ⇧⇥ from the sheet reaches Recover These Changes: there is no default
        // button, so the key has to be able to get there.
        await page.keyboard.press("Shift+Tab");
        const recover = await focused(page);
        if (recover.text !== "Recover These Changes") {
          throw new Error(`⇧⇥ in the recovery sheet went to ${recover.desc}`);
        }
        await page.locator(".sheet__foot .btn", { hasText: "Recover These Changes" }).click();
        await page.waitForSelector(".recoverypanel", { state: "detached", timeout: 5000 });
        await page.waitForSelector(".banner--recovery", { state: "detached", timeout: 5000 });
        const text = await page.evaluate(
          () => document.querySelector(".ProseMirror")?.textContent ?? "",
        );
        if (!text.includes("The sea came in.")) {
          throw new Error("Recover did not put the words back into the script");
        }
      },
    },
    {
      // Quitting keeps the words (docs/app/keeping-work/storage-and-file-format.md#STOR-D13, quit.rs). A quit once
      // ended the app in about 120 ms without a word to the page: what was typed
      // a moment before went with it, in the script and in a document, and so
      // did a document's words the disk had refused, under a toast still saying
      // they were in the window. Every quit asks the page first now. The
      // script's last words land; a refused document's go into Versions, and
      // the note that says so waits for the relaunch, which is the reload that
      // ends this check. `__prosceniumQuit` asks as ⌘Q does.
      name: "quit · the words a quit waits on land, or are kept for the next launch",
      feature: "storage",
      devMock: true,
      async run(page) {
        const script = "The Weight of Water.fountain";
        const mara = "Characters/Mara.md";
        await page.locator(".seg__btn", { hasText: "Script" }).first().click();
        await page.waitForSelector(".play-page", { timeout: 10000 });
        await dismissToasts(page);
        await page.locator(".ProseMirror").first().focus();
        await page.keyboard.press("Meta+ArrowDown");
        await page.keyboard.type(" Out the door.");
        // At once: autosave waits for a pause in the typing, and a quit does not.
        const first = await page.evaluate(() => window.__prosceniumQuit());
        if (!first.heard || !first.go)
          throw new Error(`a quit with every word savable answered ${JSON.stringify(first)}`);
        const landed = await page.evaluate((rel) => window.__prosceniumPeek(rel) ?? "", script);
        if (!landed.includes("Out the door.")) {
          throw new Error(
            `the script's last words never reached its file: ${JSON.stringify(landed.slice(-60))}`,
          );
        }

        await page.locator(".binder .binder__label", { hasText: "Mara" }).first().click();
        await page.waitForSelector(".material .ProseMirror", { timeout: 10000 });
        await page.waitForTimeout(300);
        await page.evaluate(
          (rel) =>
            window.__prosceniumGate("write", rel, {
              fail: "locked: Operation not permitted (os error 1)",
            }),
          mara,
        );
        await page.locator(".material .ProseMirror").first().click();
        await page.keyboard.press("Meta+ArrowDown");
        await page.keyboard.type(" WORDS A QUIT KEPT");
        await until(page, "the document's refusal", () =>
          /“Mara” is locked in Finder\./.test(document.querySelector(".toast")?.textContent ?? ""),
        );
        const second = await page.evaluate(() => window.__prosceniumQuit());
        if (!second.go)
          throw new Error(
            `a quit whose words went into Versions was held: ${JSON.stringify(second)}`,
          );
        if (await page.locator(".alert").count())
          throw new Error("a quit with every word kept asked something");
        const kept = await page.evaluate(() =>
          window.__prosceniumVersionsWith("WORDS A QUIT KEPT"),
        );
        if (!kept.some((v) => v.pinned))
          throw new Error(
            `the refused document's words were kept nowhere: ${JSON.stringify(kept)}`,
          );
        await page.evaluate(() => window.__prosceniumOpenGates("write"));
        await page.reload();
      },
    },
    {
      // The relaunch: the play says where the last quit put the words that
      // could not be saved, and why, once — after its script has opened, whose
      // open retires what was said before it and on the first try took this.
      name: "quit · the play says where a quit kept the words, when it opens again",
      feature: "storage",
      devMock: true,
      async run(page) {
        await walkIntoPlay(page);
        await until(
          page,
          "the note the last quit left",
          () =>
            /What was typed in “Mara” before Proscenium quit is kept in Versions, because it couldn't be saved\./.test(
              document.querySelector(".toast")?.textContent ?? "",
            ),
          undefined,
          20000,
        );
        const said = await page.locator(".toast").innerText();
        if (!said.includes("“Mara” is locked in Finder."))
          throw new Error(`the note said ${JSON.stringify(said)}`);
        await visible(page, ".toast", { minWidth: 200, minHeight: 30 });
        await audit(page, "toast · words a quit kept");
        const left = await page.evaluate(() =>
          Object.keys(sessionStorage).filter((k) => k.startsWith("proscenium:dev:kept-at-quit:")),
        );
        if (left.length) throw new Error(`the note was said and kept: ${JSON.stringify(left)}`);
        await dismissToasts(page);
      },
    },
    {
      // Words that can be kept nowhere — the document refused, and Versions
      // refused too, as a full disk does to both — hold the quit, and an alert
      // says what quitting would lose. ⏎ and Escape are Don't Quit: nothing
      // brings back what Quit Anyway loses, so it is never the default.
      name: "quit · words that can be kept nowhere hold the quit, and ⏎ does not quit",
      feature: "storage",
      devMock: true,
      async run(page) {
        const mara = "Characters/Mara.md";
        await page.locator(".binder .binder__label", { hasText: "Mara" }).first().click();
        await page.waitForSelector(".material .ProseMirror", { timeout: 10000 });
        await page.waitForTimeout(300);
        await page.evaluate((rel) => {
          window.__prosceniumGate("write", rel, { fail: "No space left on device (os error 28)" });
          window.__prosceniumGate("versionSnapshot", null, {
            fail: "No space left on device (os error 28)",
          });
        }, mara);
        await page.locator(".material .ProseMirror").first().click();
        await page.keyboard.press("Meta+ArrowDown");
        await page.keyboard.type(" WORDS KEPT NOWHERE");
        await until(page, "the refusal", () =>
          /The disk is full\./.test(document.querySelector(".toast")?.textContent ?? ""),
        );
        await dismissToasts(page);

        const held = await page.evaluate(() => window.__prosceniumQuit());
        if (held.go) throw new Error("a quit went, with words kept nowhere");
        await page.waitForSelector(".alert", { timeout: 5000 });
        await visible(page, ".alert", { minWidth: 200, minHeight: 100 });
        await onTop(page, ".alert");
        const title = await page.locator(".alert__title").innerText();
        if (title !== "What was typed in “Mara” couldn't be saved or kept.")
          throw new Error(`the quit alert asks "${title}"`);
        const body = await page.locator(".alert__body").innerText();
        for (const words of [
          "The disk is full.",
          "If Proscenium quits now, what was typed is lost.",
          "“Mara” will save once there is room on the disk.",
        ]) {
          if (!body.includes(words))
            throw new Error(`the quit alert says ${JSON.stringify(body)}, not "${words}"`);
        }
        await audit(page, "quit alert");

        await page.keyboard.press("Enter");
        await page.waitForSelector(".alert", { state: "detached", timeout: 5000 });
        if (await page.evaluate(() => window.__prosceniumQuitGone()))
          throw new Error("⏎ in the quit alert quit");
        const kept = await page.evaluate(
          () => document.querySelector(".material .ProseMirror")?.textContent ?? "",
        );
        if (!kept.includes("WORDS KEPT NOWHERE"))
          throw new Error("Don't Quit lost the words on the page");
        if (!(await page.evaluate(() => !!document.activeElement?.closest(".material")))) {
          throw new Error(
            `Don't Quit left focus on ${(await focused(page)).desc}, not the page it came from`,
          );
        }

        // Asked without waiting for the answer: the alert is the answer.
        await page.evaluate(() => {
          void window.__prosceniumQuit();
        });
        await page.waitForSelector(".alert", { timeout: 5000 });
        // Apple's order, the default first: Don't Quit, then Quit Anyway.
        const buttons = await page.locator(".alert__actions .btn").allInnerTexts();
        if (buttons.join(" | ") !== "Don't Quit | Quit Anyway")
          throw new Error(`the quit alert offers ${buttons.join(" | ")}`);
        await page.keyboard.press("Escape");
        await page.waitForSelector(".alert", { state: "detached", timeout: 5000 });
        if (await page.evaluate(() => window.__prosceniumQuitGone()))
          throw new Error("Escape in the quit alert quit");

        await page.evaluate(() => {
          void window.__prosceniumQuit();
        });
        await page.waitForSelector(".alert", { timeout: 5000 });
        await page.locator(".alert .btn", { hasText: "Quit Anyway" }).first().click();
        await until(page, "Quit Anyway to quit", () => window.__prosceniumQuitGone());
        await page.evaluate(() => window.__prosceniumOpenGates());
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      },
    },
    {
      // docs/app/importing/document-import.md#IMPT-95 and
      // docs/app/importing/document-import.md#IMPT-103: in a play,
      // import adds to that play. A styled script arrives through the binder's
      // New menu as a new script; notes arrive through the menu command
      // (⌘⇧I) as a binder document. Each keeps its source under Originals.
      // Last, because it adds to the play every later check would share.
      name: "document import · into the open play, as a script and as a document",
      feature: "import",
      async run(page) {
        await walkIntoPlay(page);
        const choose = (name, base64) =>
          page.evaluate(
            ({ name, base64 }) => {
              const input = document.querySelector('.import-desk input[type="file"]');
              const transfer = new DataTransfer();
              transfer.items.add(
                new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], name),
              );
              input.files = transfer.files;
              input.dispatchEvent(new Event("change", { bubbles: true }));
            },
            { name, base64 },
          );
        await page.locator('[data-tutorial="binder-new"]').click();
        await page.locator('.menu [data-menu-id="new:import…"]').click();
        await page.waitForSelector(".import-desk__choose");
        if (!/before adding it to /.test(await page.locator(".sheet__sub").innerText()))
          throw new Error("import in a play does not say it adds to the play");
        await choose("Harbor.pages", toBase64(harborPages()));
        await page.waitForSelector(".import-desk__review", { timeout: 10000 });
        if (!(await page.getByRole("button", { name: "Add as: New Script" }).count()))
          throw new Error("a styled script did not start as a new script");
        await audit(page, "document import · into a play");
        await page.getByRole("button", { name: "Add Script", exact: true }).click();
        await page.waitForSelector(".import-desk", { state: "detached", timeout: 10000 });
        await until(page, "the imported script open", () =>
          [...document.querySelectorAll(".ProseMirror")].some((pm) =>
            pm.textContent?.includes("There is a difference."),
          ),
        );

        await page.evaluate(() => window.dispatchEvent(new Event("proscenium:import-draft")));
        await page.waitForSelector(".import-desk__choose");
        await choose(
          "Gull Island notes.txt",
          toBase64(
            new TextEncoder().encode(
              "Harbor town or inland?\nGull Island, fog most mornings.\nWhat does the ferry bring?\nNothing anyone ordered.",
            ),
          ),
        );
        await page.waitForSelector(".import-desk__review", { timeout: 10000 });
        if (!(await page.getByRole("button", { name: "Add as: Binder Document" }).count()))
          throw new Error("notes did not start as a binder document");
        if (await page.getByRole("button", { name: /inferred or unrecognized/ }).count())
          throw new Error("a document is being read as script elements");
        await page.getByRole("button", { name: "Add Document", exact: true }).click();
        await page.waitForSelector(".import-desk", { state: "detached", timeout: 10000 });
        await until(page, "the imported notes open as a page", () =>
          [...document.querySelectorAll(".ProseMirror")].some((pm) =>
            pm.textContent?.includes("Nothing anyone ordered."),
          ),
        );
        await until(page, "the notes and the kept originals in the binder", () => {
          const labels = [...document.querySelectorAll(".binder .binder__label")].map(
            (l) => l.textContent,
          );
          return labels.includes("Gull Island notes") && labels.includes("Originals");
        });

        // Import… from a folder's own menu files into that folder, and so does
        // a file dropped on it from Finder.
        const row = (label) =>
          page.evaluate((label) => {
            const el = [...document.querySelectorAll(".binder .binder__label")]
              .find((l) => l.textContent === label)
              ?.closest("[draggable]");
            const r = el?.getBoundingClientRect();
            return r ? { x: r.left + 12, y: r.top + r.height / 2 } : null;
          }, label);
        // Runs in the page, through `until`: the row's nearest folder is the one named.
        const inFolder = ({ label, folder }) => {
          const item = [...document.querySelectorAll(".binder .binder__label")].find(
            (l) => l.textContent === label,
          );
          const holder = item?.closest("ul")?.closest("li");
          return holder?.querySelector(".binder__label")?.textContent === folder;
        };
        const at = await row("Characters");
        if (!at) throw new Error("the play has no Characters folder to import into");
        await page.evaluate(({ x, y }) => {
          const el = document.elementFromPoint(x, y)?.closest("[draggable]");
          el?.dispatchEvent(
            new MouseEvent("contextmenu", {
              bubbles: true,
              cancelable: true,
              clientX: x,
              clientY: y,
            }),
          );
        }, at);
        // By pointer, the way it broke: a click on New closed every menu,
        // because the binder shut its row menu on any click in the window.
        await page.getByRole("menuitem", { name: "New", exact: true }).click();
        await page.getByRole("menuitem", { name: "Import…", exact: true }).click();
        await page.waitForSelector(".import-desk__choose");
        await choose(
          "Cast notes.txt",
          toBase64(
            new TextEncoder().encode(
              "Who is Mara before the flood?\nShe keeps the ferry timetable.",
            ),
          ),
        );
        await page.waitForSelector(".import-desk__review", { timeout: 10000 });
        if (!(await page.locator(".import-desk__destination").innerText()).includes("› Characters"))
          throw new Error("the review does not say the draft goes into Characters");
        await page.getByRole("button", { name: "Add Document", exact: true }).click();
        await page.waitForSelector(".import-desk", { state: "detached", timeout: 10000 });
        await until(page, "the notes filed in Characters", inFolder, {
          label: "Cast notes",
          folder: "Characters",
        });

        await page.evaluate(
          ({ x, y, base64 }) => {
            const el = document.elementFromPoint(x, y)?.closest("[draggable]");
            const transfer = new DataTransfer();
            transfer.items.add(
              new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], "Jonah notes.txt"),
            );
            for (const type of ["dragenter", "dragover", "drop"])
              el?.dispatchEvent(
                new DragEvent(type, {
                  bubbles: true,
                  cancelable: true,
                  clientX: x,
                  clientY: y,
                  dataTransfer: transfer,
                }),
              );
          },
          {
            ...(await row("Characters")),
            base64: toBase64(
              new TextEncoder().encode("Jonah never learned to swim.\nHe says so twice."),
            ),
          },
        );
        await page.waitForSelector(".import-desk__review", { timeout: 10000 });
        if (!(await page.locator(".import-desk__destination").innerText()).includes("› Characters"))
          throw new Error("a drop on Characters does not go into Characters");
        await page.getByRole("button", { name: "Add Document", exact: true }).click();
        await page.waitForSelector(".import-desk", { state: "detached", timeout: 10000 });
        await until(page, "the dropped notes filed in Characters", inFolder, {
          label: "Jonah notes",
          folder: "Characters",
        });
      },
    },
  ];
}

/**
 * Walk into "The Weight of Water" after a reload, wherever launch lands: the
 * Welcome screen, the Plays screen, or the play itself by way of both. Clicks
 * in the page, since a screen only passing through is gone before a locator's
 * click could land on it.
 */
/** A key in alpha's shape (settings-model.ts); nothing in the smoke run asks alpha with it. */
const SMOKE_TRACK_KEY = "smoke".repeat(8) + "Key";
/** Settings › Updates' Track menu: what it says it is set to, and what it offers. */
async function trackLabel(page) {
  return (await page.getByRole("button", { name: /^Track/ }).getAttribute("aria-label")) ?? "";
}
async function trackChoices(page) {
  await page.getByRole("button", { name: /^Track/ }).click();
  await page.waitForSelector(".menu", { timeout: 5000 });
  const choices = await page.locator('.menu__item[role="menuitemradio"]').allInnerTexts();
  await page.keyboard.press("Escape");
  await page.waitForSelector(".menu", { state: "detached", timeout: 5000 });
  return choices.map((c) => c.trim());
}
async function chooseTrack(page, name) {
  await page.getByRole("button", { name: /^Track/ }).click();
  await page.waitForSelector(".menu", { timeout: 5000 });
  await onTop(page, '.menu__item[role="menuitemradio"]');
  await page.locator('.menu__item[role="menuitemradio"]', { hasText: name }).click();
  await until(
    page,
    `the track to be ${name}`,
    (name) =>
      (
        document.querySelector('.prefs__panel [aria-label^="Track"]')?.getAttribute("aria-label") ??
        ""
      ).includes(name),
    name,
  );
}
/** Whether a Settings note reads exactly `sentence`. Runs in the page. */
function settingsSays(sentence) {
  return [...document.querySelectorAll(".prefs__panel .settings__note")].some(
    (n) => n.textContent.trim() === sentence,
  );
}

async function walkIntoPlay(page) {
  const clickText = (selector, text, exact = false) =>
    page.evaluate(
      ([sel, t, x]) =>
        [...document.querySelectorAll(sel)]
          .find((el) => (x ? el.textContent?.trim() === t : el.textContent?.includes(t)))
          ?.click(),
      [selector, text, exact],
    );
  let seenPlays = 0;
  let seenWelcome = 0;
  for (let t = 0; t < 200; t++) {
    const at = await page.evaluate(() =>
      document.querySelector(".paneroot")
        ? "play"
        : document.querySelector(".vault-list")
          ? "plays"
          : document.querySelector(".welcome")
            ? "welcome"
            : "loading",
    );
    if (at === "play") return;
    if (at === "welcome" && ++seenWelcome === 10) await clickText("button", "A folder I choose");
    if (at === "plays" && ++seenPlays === 10)
      await clickText(".playrow__title", "The Weight of Water", true);
    await page.waitForTimeout(150);
  }
  await page.waitForSelector(".paneroot", { timeout: 20000 });
}

/**
 * Polls `fn` in the page until it returns something truthy, and returns it. The
 * harness implements no `waitForFunction`, and a check has to run in both
 * drivers, so waiting on a condition is this: evaluate, pause, again.
 */
async function until(page, what, fn, arg, timeout = 10000) {
  timeout *= TIME_SCALE;
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await page.evaluate(fn, arg);
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out after ${timeout}ms waiting for ${what}`);
    await page.waitForTimeout(100);
  }
}

/**
 * The element bar as a person sees it (docs/app/writing/editor-ux.md#EDIT-171):
 * inside its pane, no wider a desk than the sheet, no two controls on top of
 * each other, and "Page N of M" on screen. With `verdict`, only whether all of
 * that holds, for `until`. Runs IN THE PAGE, so it closes over nothing.
 */
function elementBarFacts(verdict) {
  const bar = document.querySelector(".editor-surface .elementbar");
  const pane = bar?.closest(".pane__body");
  const sheet = bar?.parentElement.querySelector(".play-page");
  if (!bar || !pane || !sheet)
    return verdict
      ? false
      : { problems: ["no element bar over a sheet in a pane"], fit: "", width: 0 };
  const b = bar.getBoundingClientRect();
  const p = pane.getBoundingClientRect();
  const desk = bar.parentElement.getBoundingClientRect().width;
  const page = sheet.getBoundingClientRect().width;
  const problems = [];
  if (b.left < p.left - 0.5 || b.right > p.right + 0.5) {
    problems.push(
      `the bar spans ${Math.round(b.left)}–${Math.round(b.right)} in a pane at ${Math.round(p.left)}–${Math.round(p.right)}`,
    );
  }
  if (Math.abs(desk - page) > 1)
    problems.push(`the desk is ${Math.round(desk)}px for a ${Math.round(page)}px sheet`);
  const shown = [...bar.querySelectorAll("button, .elementbar__hint, .elementbar__pages")]
    .filter((n) => n.getClientRects().length && n.getBoundingClientRect().width > 0)
    .map((n) => [
      n.getAttribute("aria-label") || n.textContent.trim().replace(/\s+/g, " "),
      n.getBoundingClientRect(),
    ]);
  for (const [name, r] of shown) {
    if (r.left < b.left - 0.5 || r.right > b.right + 0.5)
      problems.push(`${name} runs past the bar`);
  }
  for (let i = 0; i < shown.length; i++) {
    for (let j = i + 1; j < shown.length; j++) {
      const [a, ra] = shown[i];
      const [c, rc] = shown[j];
      if (Math.min(ra.right, rc.right) - Math.max(ra.left, rc.left) > 1)
        problems.push(`${a} overlaps ${c}`);
    }
  }
  const count = bar.querySelector(".elementbar__pages");
  const cr = count?.getBoundingClientRect();
  if (
    !count ||
    !/^Page \d+ of \d+$/.test(count.textContent.trim()) ||
    !cr.width ||
    cr.left < p.left ||
    cr.right > p.right
  ) {
    problems.push("Page N of M is not on screen");
  }
  return verdict
    ? problems.length === 0
    : { problems, fit: bar.dataset.fit ?? "", width: Math.round(b.width) };
}

/** What has focus, in words a failure message can use. */
async function focused(page) {
  return page.evaluate(() => {
    const a = document.activeElement;
    const text = (a?.textContent ?? "").trim().slice(0, 40);
    return {
      id: a?.id ?? "",
      role: a?.getAttribute("role") ?? null,
      text,
      desc: a ? `<${a.tagName.toLowerCase()} class="${a.className}">${text}` : "nothing",
    };
  });
}

/**
 * Close a format designer a failed check left open. Escape alone cannot: with
 * unsaved changes it asks to discard them, and the runner's Escape loop would
 * only open and dismiss that question until every later check failed on it.
 */
async function closeDesigner(page) {
  try {
    for (let i = 0; i < 6 && (await page.locator(".designer").count()); i++) {
      const discard = page.locator(".alert .btn", { hasText: "Discard Changes" });
      if (await discard.count()) await discard.click();
      else await page.keyboard.press("Escape");
      await page.waitForTimeout(150);
    }
  } catch {
    /* the check's own failure is the one to report */
  }
}

/**
 * Runs IN THE PAGE: whether the play's file named `file` holds `word`, read
 * from disk — the dev vault's own copy in Chromium, the Rust vault natively.
 * Found through the play file's binder, so it holds wherever New put it.
 */
async function onDisk({ file, word }) {
  const read = async (rel) => {
    if (typeof window.__prosceniumPeek === "function") return window.__prosceniumPeek(rel);
    try {
      return (await window.__TAURI_INTERNALS__.invoke("vault_read", { rel })).content;
    } catch {
      return null;
    }
  };
  const play = JSON.parse((await read("The Weight of Water.proscenium")) ?? "{}");
  const walk = (items) => items.flatMap((it) => [it, ...walk(it.children ?? [])]);
  const item = walk(play.binder ?? []).find((it) => it.path?.split("/").pop() === file);
  return !!item && !!(await read(item.path))?.includes(word);
}

/** Close the tab named `label`, and wait until no pane holds it. Other sheets may stay open. */
async function closeTab(page, label) {
  await page.locator(`.pane__tabclose[aria-label="Close ${label}"]`).first().click();
  await until(
    page,
    `the ${label} tab to close`,
    (l) =>
      ![...document.querySelectorAll(".pane__tabclose")].some(
        (b) => b.getAttribute("aria-label") === `Close ${l}`,
      ),
    label,
  );
}

async function openFromDocumentMenu(page, row) {
  await page.locator(".doctitle").click();
  await page.waitForSelector(".menu", { timeout: 5000 });
  if (!(await page.locator(".menu__item", { hasText: row }).count())) {
    await page.getByRole("menuitem", { name: "All Formats", exact: true }).click();
  }
  await page.locator(".menu__item", { hasText: row }).first().click();
}

/**
 * Fails on a box that is present, sized, and drawn UNDER something else — the
 * third way to be invisible. Asks the page what is actually at the box's
 * centre, which is what a click there would reach.
 */
async function onTop(page, selector) {
  const covered = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return "nothing: it is not rendered at all";
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (hit && (hit === el || el.contains(hit))) return null;
    return hit ? `<${hit.tagName.toLowerCase()} class="${hit.className}">` : "nothing";
  }, selector);
  if (covered)
    throw new Error(`${selector}: covered by ${covered} — present, sized, and drawn underneath`);
}

/**
 * Waits for a box to stop moving: sized, and the same rectangle on two polls
 * running. The native harness scrolls a target into view once before it
 * clicks, where Playwright scrolls again on every retry, so a click sent while
 * something else is still moving the target can be scrolled for where it was
 * and meet whatever has moved over it since.
 */
async function still(page, selector, timeout = 10000) {
  const deadline = Date.now() + timeout;
  let last = null;
  for (;;) {
    const at = await page.evaluate((sel) => {
      const r = document.querySelector(sel)?.getBoundingClientRect();
      return r && r.width >= 1 && r.height >= 1
        ? `${r.left},${r.top},${r.width},${r.height}`
        : null;
    }, selector);
    if (at && at === last) return;
    if (Date.now() > deadline)
      throw new Error(`${selector}: ${at ? "still moving" : "not laid out"} after ${timeout}ms`);
    last = at;
    await page.waitForTimeout(100);
  }
}

/**
 * Press ⌃⇥ until focus is inside `selector`, and say what has it. A banner the
 * area keys could not reach is how a writer without a pointer was left unable
 * to answer the recovery banner.
 */
async function areaKeysReach(page, selector, presses = 8) {
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press("Control+Tab");
    const inside = await page.evaluate((sel) => !!document.activeElement?.closest(sel), selector);
    if (inside) return focused(page);
  }
  throw new Error(
    `${presses} presses of ⌃⇥ never reached ${selector}: ended on ${(await focused(page)).desc}`,
  );
}

/**
 * Whether pressing the mouse at the middle of `selector`'s box — or `at`, a
 * point given as fractions of that box — would start dragging the window.
 * Asks by Tauri 2's own rule (tauri/src/window/scripts/drag.js): walking up
 * from the element pressed, a control without the attribute stops the drag,
 * "deep" drags from anywhere inside, a bare attribute only from the element
 * itself. The window could not be moved at all when this was never asked.
 */
async function dragsWindow(page, selector, at = { x: 0.5, y: 0.5 }) {
  const region = await page.evaluate(
    ([sel, fx, fy]) => {
      const box = document.querySelector(sel)?.getBoundingClientRect();
      if (!box) return `${sel} is not rendered`;
      const hit = document.elementFromPoint(box.left + box.width * fx, box.top + box.height * fy);
      const clickable = new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "LABEL", "SUMMARY"]);
      const roles = new Set([
        "button",
        "link",
        "menuitem",
        "tab",
        "checkbox",
        "radio",
        "switch",
        "option",
      ]);
      for (let el = hit; el; el = el.parentElement) {
        const attr = el.getAttribute("data-tauri-drag-region");
        const control =
          clickable.has(el.tagName) ||
          (el.hasAttribute("contenteditable") && el.getAttribute("contenteditable") !== "false") ||
          (el.hasAttribute("tabindex") && el.getAttribute("tabindex") !== "-1") ||
          roles.has(el.getAttribute("role"));
        if (control && attr === null) return false;
        if (attr === null) continue;
        if (attr === "false") return false;
        if (attr === "deep") return true;
        return el === hit;
      }
      return false;
    },
    [selector, at.x, at.y],
  );
  if (region !== true) return region;
  // Attributes alone missed a real regression: React stopped the event inside
  // a sheet, before Tauri's document listener could start the drag. Exercise a
  // click through the driver (an NSEvent in the self-test app) and observe the
  // actual event. Tauri prevents default when it accepts the drag; browser
  // smoke instead checks delivery to document, where that native handler lives.
  await page.waitForTimeout(220);
  const point = await page.evaluate(
    ([sel, fx, fy]) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      const probe = { event: null, bubbled: false };
      probe.capture = (e) => {
        probe.event = e;
      };
      probe.bubble = () => {
        probe.bubbled = true;
      };
      document.addEventListener("mousedown", probe.capture, true);
      document.addEventListener("mousedown", probe.bubble);
      window.__dragProbe = probe;
      return { x: r.left + r.width * fx, y: r.top + r.height * fy };
    },
    [selector, at.x, at.y],
  );
  try {
    await page.mouse.click(point.x, point.y);
    return await page.evaluate(() => {
      const probe = window.__dragProbe;
      return (
        !!probe.event && (window.__TAURI_INTERNALS__ ? probe.event.defaultPrevented : probe.bubbled)
      );
    });
  } finally {
    await page.evaluate(() => {
      const probe = window.__dragProbe;
      document.removeEventListener("mousedown", probe.capture, true);
      document.removeEventListener("mousedown", probe.bubble);
      delete window.__dragProbe;
    });
  }
}

/**
 * Close the toast that is up, so the next one a check reads is its own. By its
 * Dismiss button only: a toast with an action (Undo) is left to time out
 * rather than have its action run.
 */
async function dismissToasts(page) {
  for (let i = 0; i < 80 && (await page.locator(".toast").count()); i++) {
    await page.evaluate(() => document.querySelector('.toast [aria-label="Dismiss"]')?.click());
    await page.waitForTimeout(100);
  }
}

/** The opposite assertion, for chrome that must EARN its space rather than repeat what other chrome already says. */
async function absent(page, selector, why) {
  const n = await page.locator(selector).count();
  if (n > 0) throw new Error(`${selector}: rendered ${n}×, expected none — ${why}`);
}

/** Fails on a box that is present but has no size — the whole point. */
async function visible(page, selector, { minWidth = 1, minHeight = 1 } = {}) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`${selector}: not rendered at all`);
  if (box.width < minWidth || box.height < minHeight) {
    throw new Error(
      `${selector}: rendered at ${Math.round(box.width)}×${Math.round(box.height)}, ` +
        `expected at least ${minWidth}×${minHeight} — present in the DOM, invisible on screen`,
    );
  }
}

/*
 * WCAG 2.2 A and AA, critical and serious only. Best-practice rules (a landmark
 * around every node, one h1) are printed and do not fail: this is a desk of
 * panes, not a document, and a gate that fails on advice is a gate that gets
 * switched off. Findings are remembered per scheme so a rule that fails on five
 * surfaces says so once per surface rather than drowning the report.
 *
 * A finding is RECORDED, not thrown: a check that threw from inside an open
 * menu never reached its own Escape, and every check after it failed on a
 * screen it had not asked for. The runner fails the check once it has finished.
 */

/**
 * Runs IN THE PAGE, after axe-core is loaded there: Playwright ships this
 * function as source, so it must close over nothing.
 */
export async function runAxe(tags) {
  // The sheet drops in from 60% opacity; a contrast read mid-drop measures the
  // fade, not the colours. Let every running animation land first.
  await Promise.race([
    Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))),
    new Promise((r) => setTimeout(r, 1500)),
  ]);
  // And hold every style at its end while axe reads. In the real app hover
  // follows the Mac's own pointer, which no check controls, and a hover that
  // moved during the read started a fade under it: a shortcut badge caught at
  // 12% opacity was reported as a contrast failure by the self-test.
  // Nothing in the app waits on a transition or animation ending.
  const still = document.createElement("style");
  still.textContent =
    "*, *::before, *::after { transition: none !important; animation: none !important; }";
  document.head.appendChild(still);
  try {
    void document.body.offsetHeight;
    const r = await window.axe.run(document, {
      runOnly: { type: "tag", values: [...tags, "best-practice"] },
      resultTypes: ["violations"],
    });
    return r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      tags: v.tags,
      help: v.help,
      nodes: v.nodes.map(
        (n) =>
          `${n.target.join(" ")}${n.failureSummary ? ` — ${n.failureSummary.split("\n").slice(1, 2).join("").trim()}` : ""}`,
      ),
    }));
  } finally {
    still.remove();
  }
}

/** Blocking findings and advice, by the same rule in both drivers. */
export function recordAudit(violations, surface, { findings, advisories }) {
  const blocking = violations.filter(
    (v) =>
      (v.impact === "critical" || v.impact === "serious") &&
      v.tags.some((t) => AUDIT_TAGS.includes(t)),
  );
  for (const v of violations) {
    if (blocking.includes(v)) continue;
    if (!advisories.has(v.id)) advisories.set(v.id, { help: v.help, surfaces: new Set() });
    advisories.get(v.id).surfaces.add(surface);
  }
  for (const v of blocking) {
    findings.push(
      `${surface} · ${v.id} (${v.impact}) × ${v.nodes.length}: ${v.help}\n          ${v.nodes.slice(0, 6).join("\n          ")}`,
    );
  }
}

async function tutorialRead(page, rel) {
  return page.evaluate(
    async (rel) =>
      window.__TAURI_INTERNALS__
        ? (await window.__TAURI_INTERNALS__.invoke("vault_read", { rel })).content
        : window.__prosceniumPeek(rel),
    rel,
  );
}
async function tutorialProgress(page) {
  return page.evaluate(async () =>
    JSON.parse(
      window.__TAURI_INTERNALS__
        ? (await window.__TAURI_INTERNALS__.invoke("tutorials_read")).content
        : localStorage.getItem("proscenium:dev:tutorial-progress"),
    ),
  );
}
/** Help & Tutorials, from wherever the writer is. */
async function tutorialOpen(page) {
  await walkIntoPlay(page);
  if (!(await page.locator(".tutorials").count()))
    await page.getByRole("button", { name: "Help & Tutorials", exact: true }).click();
  await page.waitForSelector(".tutorials");
}
async function tutorialStart(page, title, step) {
  await tutorialOpen(page);
  const topic = page.getByRole("button", { name: title, exact: true });
  if ((await topic.getAttribute("aria-expanded")) !== "true") await topic.click();
  await page
    .getByRole(
      "button",
      step ? { name: step, exact: true } : { name: /^(Start Tutorial|Start Again)$/ },
    )
    .click();
  await cueReady(page);
  await entryFocused(page);
}
/** The guide's card, placed and saying its step. */
async function cueReady(page) {
  await until(
    page,
    "the guide is ready",
    () => {
      const c = document.querySelector(".tutorial-cue");
      return (
        !!c &&
        !!c.querySelector(".tutorial-cue__count") &&
        !c.textContent.includes("Getting the practice ready") &&
        c.style.left !== "-9999px"
      );
    },
    undefined,
    15000,
  );
  await guideStill(page);
}
/**
 * A deliberate entry (a lesson started, Next, a chosen step) moves the keyboard
 * off the Help & Tutorials button the closed sheet hands it back to: to the
 * script, the card's words, or a document that opened ready to write in. It
 * lands a frame or two after the card is ready; a check that focuses or types
 * elsewhere acts after that.
 */
async function entryFocused(page) {
  await until(page, "the keyboard where the lesson put it", () => {
    const a = document.activeElement;
    return (
      !!a &&
      a !== document.body &&
      !a.matches('[data-tutorial="help"]') &&
      !a.closest(".tutorials, .modal-scrim:not(:has(.tutorial-cue))")
    );
  });
}
async function cueStep(page, n, of) {
  await until(
    page,
    `step ${n} of ${of}`,
    ([n, of]) =>
      document.querySelector(".tutorial-cue__count")?.textContent === `${n} of ${of}` &&
      !document.querySelector(".tutorial-cue")?.textContent.includes("Getting the practice ready"),
    [n, of],
    15000,
  );
  await guideStill(page);
}
async function cueSays(page, text) {
  await until(
    page,
    `the guide saying “${text}”`,
    (t) => !!document.querySelector(".tutorial-cue__say")?.textContent.includes(t),
    text,
  );
  await guideStill(page);
}
async function cueTone(page, tone) {
  await until(
    page,
    `a ${tone} cue`,
    (t) => !!document.querySelector(".tutorial-cue")?.classList.contains(`tutorial-cue--${t}`),
    tone,
  );
}
/**
 * The guide has stopped moving: its card and its ring hold the same place for
 * three frames. When a step changes, the card moves to its new target, and may
 * scroll it into view, on the next frame (CueCard's place()). A click pressed
 * before that move and released after it lands on nothing, and WebKit then
 * sends no click at all; a slow host lands in that frame often. So every
 * helper that waits for the guide to say something waits for it to hold still
 * too, and a click after one is never made mid-move. A writer's click never
 * comes within that frame, so this is the test's timing, not the app's.
 */
async function guideStill(page) {
  await until(page, "the guide holds still", async () => {
    const at = () =>
      [...document.querySelectorAll(".tutorial-cue, .tutorial-ring")]
        .map((e) => {
          const r = e.getBoundingClientRect();
          return `${r.left},${r.top},${r.width},${r.height}`;
        })
        .join("|");
    const first = at();
    for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r));
    return at() === first;
  });
}
/** The guide's ring is on `selector`, and the guide holds still. */
async function settledOn(page, selector, what) {
  await until(
    page,
    `the guide's ring on ${what}`,
    (sel) => {
      const t = document.querySelector(sel),
        r = document.querySelector(".tutorial-ring");
      if (!t || !r || getComputedStyle(r).display === "none") return false;
      const a = t.getBoundingClientRect(),
        b = r.getBoundingClientRect();
      return Math.abs(b.left - (a.left - 3)) <= 1 && Math.abs(b.top - (a.top - 3)) <= 1;
    },
    selector,
  );
  await guideStill(page);
}
/** Beside its target, never over it, and on screen (docs/app/preferences-and-help/tutorials.md#TUT-D103). */
async function beside(page, what) {
  await until(page, `the guide beside ${what}, not over it`, () => {
    const card = document.querySelector(".tutorial-cue");
    if (!card || card.style.left === "-9999px") return false;
    const c = card.getBoundingClientRect();
    const ring = document.querySelector(".tutorial-ring");
    const line = document.querySelector(".editor-surface .tutorial-line");
    const t =
      ring && getComputedStyle(ring).display !== "none"
        ? ring.getBoundingClientRect()
        : line?.getBoundingClientRect();
    if (!t) return false;
    const overlap =
      c.left < t.right - 1 && t.left < c.right - 1 && c.top < t.bottom - 1 && t.top < c.bottom - 1;
    const gap = Math.max(t.left - c.right, c.left - t.right, t.top - c.bottom, c.top - t.bottom);
    return (
      !overlap &&
      gap <= 48 &&
      c.left >= 0 &&
      c.top >= 0 &&
      c.right <= innerWidth + 1 &&
      c.bottom <= innerHeight + 1
    );
  });
  await guideStill(page);
}
/**
 * Keeps every announcement from here on. The guide speaks again as soon as its
 * words change, so a live region read later may already hold the next sentence.
 */
async function recordAnnouncements(page) {
  await page.evaluate(() => {
    window.__announcedObserver?.disconnect();
    window.__announced = [];
    window.__announcedObserver = new MutationObserver((records) => {
      for (const r of records) {
        const region = (r.target.nodeType === 1 ? r.target : r.target.parentElement)?.closest?.(
          "[data-announcer]",
        );
        if (region?.textContent) window.__announced.push(region.textContent);
      }
    });
    window.__announcedObserver.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
}
async function announced(page, text) {
  await until(
    page,
    `“${text}” announced`,
    (t) => !!window.__announced?.some((said) => said.includes(t)),
    text,
  );
  await page.evaluate(() => window.__announcedObserver?.disconnect());
}
/** After a deliberate action (a fix, a skip), the cursor is put back in the script. */
async function scriptFocused(page) {
  await until(
    page,
    "the cursor back in the script",
    () => !!document.activeElement?.matches(".editor-surface .ProseMirror"),
  );
}
/** The guide moved on; the keyboard stayed where the writer was typing. */
async function noFocusTheft(page) {
  if (!(await page.evaluate(() => document.activeElement?.matches(".editor-surface .ProseMirror"))))
    throw new Error(`the guide took focus: ${(await focused(page)).desc}`);
}
async function lessonFinished(page) {
  await until(
    page,
    "the lesson finished",
    () => !!document.querySelector(".tutorial-cue")?.textContent.includes("Lesson finished"),
    undefined,
    15000,
  );
  await guideStill(page);
}
async function nextLesson(page) {
  await page
    .locator(".tutorial-cue")
    .getByRole("button", { name: "Next Lesson", exact: true })
    .click();
  await cueReady(page);
  await entryFocused(page);
}
async function scriptLines(page) {
  return page.evaluate(() =>
    JSON.stringify(
      [...document.querySelectorAll(".editor-surface [data-pl]")].map((n) => [
        n.dataset.pl,
        n.textContent,
      ]),
    ),
  );
}
async function tutorialType(page, text) {
  if (!(await page.evaluate(() => document.activeElement?.matches(".editor-surface .ProseMirror"))))
    await page.locator(".editor-surface .ProseMirror").focus();
  await page.keyboard.type(text);
  await page.keyboard.press("Meta+s");
  await until(page, "practice words saved", () =>
    document.querySelector(".savestatus")?.textContent.startsWith("Saved"),
  );
}
/**
 * All Plays by its key. If the Plays screen does not come, the failure says what
 * the window held when the key went in and what became of the key: whether the
 * page saw it and whether the window keymap took it, and in the app whether the
 * menu bar sent All Plays (the key's route when the page leaves it) and which view
 * AppKit gives keys to. The native self-test has twice seen ⌘⇧O change nothing
 * just after Stop Tutorial, and a timeout alone says nothing why.
 */
async function allPlays(page) {
  const before = await page.evaluate(async () => {
    const tauri = window.__TAURI_INTERNALS__;
    // One menu recorder for the page's life; each press reads what came after its mark.
    if (tauri && !window.__menuActions) {
      window.__menuActions = [];
      await tauri.invoke("plugin:event|listen", {
        event: "menu://action",
        target: { kind: "Any" },
        handler: tauri.transformCallback((e) => window.__menuActions.push(e.payload)),
      });
    }
    const probe = (window.__allPlaysProbe = { keys: [], mark: window.__menuActions?.length ?? 0 });
    probe.onKey = (e) => {
      if (e.metaKey && e.key.toLowerCase() === "o") probe.keys.push(e);
    };
    window.addEventListener("keydown", probe.onKey, true);
    return JSON.stringify({
      layers: [...document.querySelectorAll(".sheet, .menu, .alert, .modal-scrim")].map(
        (e) => e.className,
      ),
      active:
        document.activeElement === document.body
          ? "body"
          : `${document.activeElement?.tagName}.${document.activeElement?.className}`.slice(0, 80),
      windowFocus: document.hasFocus(),
      visibility: document.visibilityState,
      play: document.querySelector(".binder__project")?.textContent ?? null,
      path: document.querySelector(".statusbar__path")?.textContent ?? null,
      alert: document.querySelector('[role="alert"]')?.textContent ?? null,
      responder: tauri
        ? (await tauri.invoke("selftest_input_facts").catch(() => null))?.firstResponder
        : undefined,
    });
  });
  try {
    await page.keyboard.press("Meta+Shift+KeyO");
    await page.waitForSelector(".vault-list", { timeout: 15000 }).catch(async () => {
      const after = await page.evaluate(async () => {
        const tauri = window.__TAURI_INTERNALS__,
          probe = window.__allPlaysProbe;
        return JSON.stringify({
          keys: probe.keys.map((e) => ({
            target:
              e.target === document.body
                ? "body"
                : `${e.target?.tagName}.${e.target?.className}`.slice(0, 60),
            taken: e.defaultPrevented,
          })),
          menu: window.__menuActions?.slice(probe.mark),
          play: document.querySelector(".binder__project")?.textContent ?? null,
          alert: document.querySelector('[role="alert"]')?.textContent ?? null,
          busy: document.querySelector(".app-shell")?.getAttribute("aria-busy") ?? null,
          responder: tauri
            ? (await tauri.invoke("selftest_input_facts").catch(() => null))?.firstResponder
            : undefined,
        });
      });
      throw new Error(
        `All Plays (⌘⇧O) did not bring the Plays screen; before the key ${before}, 15 s after ${after}`,
      );
    });
  } finally {
    await page.evaluate(() =>
      window.removeEventListener("keydown", window.__allPlaysProbe.onKey, true),
    );
  }
}
/**
 * Stop gives the keyboard back to the play it returned to: its script in the
 * focused pane, with the caret where the writer left it. Not <body>, and not the
 * toolbar's Help & Tutorials, which a selector list once found first.
 */
async function keyboardBackInScript(page, how, place) {
  await until(
    page,
    `the keyboard back in the script after Stop by ${how}`,
    () => !!document.activeElement?.matches(".pane.is-focused .editor-surface .ProseMirror"),
    undefined,
    15000,
  ).catch(async (e) => {
    throw new Error(`${e.message}; it is on ${(await focused(page)).desc}`);
  });
  if (
    (await page.evaluate(() => document.querySelector(".doctitle__label")?.textContent)) !==
    "The Weight of Water"
  )
    throw new Error(`Stop by ${how} did not return to the writer's play`);
  const at = await page.evaluate(
    () => document.querySelector(".editor-surface .ProseMirror").editor.state.selection.from,
  );
  if (at !== place)
    throw new Error(
      `Stop by ${how} put the caret at ${at}, not where the writer left it (${place})`,
    );
}
/**
 * Stop Tutorial, once the card holds still. A check often stops right after a
 * step changes, when the card is still moving to its new target on the next
 * frame, and a click pressed before that move and released after it gets no
 * click in WebKit (guideStill, above). On the hosted runner's slower WebKit,
 * "retained practice waits for an explicit resume after relaunch" lost its
 * Stop that way and left the card open for the next check.
 */
async function tutorialStop(page) {
  await guideStill(page);
  await page
    .locator(".tutorial-cue")
    .getByRole("button", { name: "Stop Tutorial", exact: true })
    .click();
  await page.waitForSelector(".tutorial-cue", { state: "detached" });
  // Stop's checkpoint and the practice files it saves are written through
  // queues that finish after the card has gone. A check that writes a fixture
  // or relaunches next waits for the stored state to stop changing, or on a
  // slow host those writes land after it. Only the dev vault keeps these in
  // storage; in the real app there is nothing to read, and it passes at once.
  await until(page, "the stopped tutorial written", async () => {
    if (window.__TAURI_INTERNALS__) return true;
    const at = () =>
      ["proscenium:dev:tutorial-progress", "proscenium:dev:tutorial-files"]
        .map((k) => localStorage.getItem(k))
        .join("\u0000");
    const first = at();
    await new Promise((r) => setTimeout(r, 300));
    return at() === first;
  });
}
