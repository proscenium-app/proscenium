// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The iPad probe: one step of the iPad simulator's proof, run inside the real
 * iPad app's page, over the real Rust vault, by a probe build (Cargo's
 * `ipad-probe` feature, which no release build carries). scripts/ipad-sim.mjs
 * launches the app with the step in PROSCENIUM_IPAD_PROBE and reads the
 * report this leaves through `ipad_probe_report`, in the app's cache.
 *
 * What it does is what a writer does, pressed from inside the page: open the
 * sample play, put words in the script, open the Export sheet and export, open
 * Settings › Updates, and ask another host for something. What only an iPad
 * does around it (leaving the app, being ended, coming back, the share sheet)
 * is the driver's, through `simctl`.
 */
(() => {
  const probe = window.__PROSCENIUM_IPAD_PROBE__;
  if (!probe || window.top !== window) return;

  // The watch step's record of every key the page saw, from before the page's
  // own listeners exist, and whether the page kept it (preventDefault).
  const keysSeen = [];
  if (probe.step === "watch") {
    window.addEventListener(
      "keydown",
      (e) => {
        const seen = {
          at: Math.round(performance.now()),
          key: e.key,
          code: e.code,
          meta: e.metaKey,
          alt: e.altKey,
          shift: e.shiftKey,
          ctrl: e.ctrlKey,
          editing: Boolean(document.activeElement?.isContentEditable),
        };
        keysSeen.push(seen);
        setTimeout(() => {
          seen.kept = e.defaultPrevented;
        }, 0);
      },
      true,
    );
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function until(test, what, ms = 30000) {
    const end = Date.now() + ms;
    for (;;) {
      const found = test();
      if (found) return found;
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await sleep(100);
    }
  }
  const invoke = (command, args) => window.__TAURI_INTERNALS__.invoke(command, args);
  const report = (data) =>
    invoke("ipad_probe_report", { step: probe.step, data: JSON.stringify(data) });
  const byText = (selector, text) =>
    [...document.querySelectorAll(selector)].find((el) => el.textContent.trim() === text);

  /**
   * The sample play's script: from the Plays screen on a first launch, and
   * as the app reopens it on a later one, which opens the last play.
   */
  async function openThePlay() {
    // The script's editor is the one on screen in the pane, holding the
    // script's lines: the Plays screen lays scripts out in a hidden editor of
    // its own to count their pages, which holds lines too.
    const script = () =>
      [...document.querySelectorAll(".paneroot .play-page .ProseMirror")].find(
        (el) => el.querySelector(".pl-action") && el.getClientRects().length > 0,
      );
    const found = await until(
      () => byText(".playrow__title", "The Weight of Water") || script(),
      "the play, or the Plays screen's row for it",
    );
    if (found.classList.contains("playrow__title")) found.click();
    const dom = await until(script, "the script");
    await until(() => dom.editor, "the script's editor");
    return dom;
  }

  /**
   * The words, at the end of the script's last action line, as the editor
   * takes typing: one transaction, which marks the script unsaved and arms
   * autosave as a key does. A page's own focus() starts no editing on an iPad
   * without a touch, so the probe does not ask the keyboard; the iPad's native
   * pass types on real keys.
   */
  async function type(dom, words) {
    const editor = dom.editor;
    let end = null;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "action") end = pos + node.nodeSize - 1;
    });
    if (end === null) throw new Error("the script has no action line to type in");
    editor.view.dispatch(editor.state.tr.insertText(` ${words}`, end));
    await until(() => dom.textContent.includes(words), "the words in the script", 5000);
  }

  const steps = {
    // A Plays folder iCloud has not brought down
    // (docs/engineering/cross-platform.md#PLAT-69): the driver emptied each
    // play into a folder outside it, and the probe build's download passes
    // bring one play back a pass. The screen says it is downloading and offers
    // nothing meanwhile; each play joins the list as it arrives; and once all
    // are down the sentence is gone. Then the iPad's own pass is asked once.
    async cloud() {
      const sentence = () =>
        [...document.querySelectorAll(".vault-screen__sub, .vault-screen__cloud")]
          .map((p) => p.textContent.trim())
          .find((t) => /downloading/i.test(t));
      const said = await until(sentence, "the Plays screen saying it is downloading");
      const offered = [...document.querySelectorAll("button")].some(
        (b) => b.textContent.trim() === "Open the Sample Play" && !b.disabled,
      );
      const rows = () => document.querySelectorAll(".playrow--play").length;
      await until(() => !sentence() && rows() > 0, "every play down, and nothing said", 90000);
      // Listed once the last one has come down: the count, once it holds still.
      let count = rows();
      for (let still = 0; still < 6; still++) {
        await sleep(250);
        if (rows() !== count) {
          count = rows();
          still = -1;
        }
      }
      const swift = await invoke("ipad_probe_swift_download");
      return { said, offeredWhileDownloading: offered, rows: count, swift };
    },
    // Typed, and reported at once: the driver leaves the app before
    // autosave's two-second wait is over, so only leaving can keep them.
    async type() {
      const editor = await openThePlay();
      await type(editor, probe.words);
      return { typed: probe.words };
    },
    async verify() {
      const dom = await openThePlay();
      return { found: dom.textContent.includes(probe.words) };
    },
    // The Export sheet by its chord, ⌘⇧E: an iPad's narrower toolbar draws the
    // document menu as a button with no title in it.
    async export() {
      await openThePlay();
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "E",
          code: "KeyE",
          metaKey: true,
          shiftKey: true,
          bubbles: true,
        }),
      );
      const button = await until(
        () =>
          [...document.querySelectorAll("button")].find(
            (b) => b.textContent.trim() === "Export PDF…" && !b.disabled,
          ),
        "the Export sheet's Export PDF… button",
      );
      button.click();
      return { asked: true };
    },
    async settings() {
      await openThePlay();
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: ",", code: "Comma", metaKey: true, bubbles: true }),
      );
      const tab = await until(
        () => byText('.prefs__nav [role="tab"]', "Updates"),
        "Settings' Updates tab",
      );
      tab.click();
      const pane = await until(
        () =>
          [...document.querySelectorAll(".prefs__panel")].find((p) =>
            /Proscenium \d|This version/i.test(p.innerText),
          ),
        "the Updates pane's sentence",
      );
      await sleep(300);
      return { text: pane.innerText };
    },
    // Another host, three ways: a fetch, which the content security policy
    // refuses before WebKit's rules see it; an image; and preconnect and
    // dns-prefetch hints, which no content security policy covers, so only
    // WebKit's content rules keep them from opening a connection.
    async network() {
      const target = `https://127.0.0.1:${probe.port}`;
      const results = {};
      try {
        await fetch(`${target}/fetch`, { mode: "no-cors" });
        results.fetch = "reached";
      } catch (e) {
        results.fetch = `refused: ${e}`;
      }
      for (const rel of ["preconnect", "dns-prefetch"]) {
        const link = document.createElement("link");
        link.rel = rel;
        link.href = target;
        document.head.append(link);
      }
      const image = new Image();
      image.src = `${target}/image.png`;
      document.body.append(image);
      await sleep(4000);
      return { results };
    },
    // For a driver that presses real keys, shows the screen's keyboard or
    // opens files from Files (Apple's UI testing, outside the page): the play
    // opened, where there is one, then every half second a report of the keys
    // the page saw, what the app told it (menu items, the keyboard's inset,
    // files opened), and where the page sits. It never ends; the driver ends
    // the app.
    async watch() {
      const heard = [];
      for (const event of ["menu://action", "app://keyboard", "app://opened"]) {
        await invoke("plugin:event|listen", {
          event,
          target: { kind: "Any" },
          handler: window.__TAURI_INTERNALS__.transformCallback((e) =>
            heard.push({ at: Math.round(performance.now()), event, payload: e.payload }),
          ),
        });
      }
      const said = (promise) =>
        promise.then(
          (value) => value,
          (error) => `refused: ${error}`,
        );
      const capabilities = await said(invoke("capabilities"));
      const container = await said(invoke("vault_cloud_root"));
      const play = await said(openThePlay().then(() => "open"));
      const where = () => {
        const vv = window.visualViewport;
        const texts = (selector, n) =>
          [...document.querySelectorAll(selector)]
            .map((el) => el.innerText.trim().slice(0, n))
            .filter(Boolean);
        return {
          kbInset: getComputedStyle(document.documentElement).getPropertyValue("--kb-inset").trim(),
          innerHeight: window.innerHeight,
          scrollY: window.scrollY,
          viewport: vv && { height: vv.height, offsetTop: vv.offsetTop, pageTop: vv.pageTop },
          rootTop: document.getElementById("root")?.getBoundingClientRect().top,
          focused: `${document.activeElement?.tagName} ${document.activeElement?.className}`.trim(),
          dialogs: texts('[role="dialog"], [role="alertdialog"]', 600),
          told: texts('[role="status"], [role="alert"]', 200),
          welcome: texts(".welcome__choice", 200),
        };
      };
      // Each place the page has been, as it changed, beside the newest.
      const history = [];
      for (;;) {
        const now = where();
        const text = JSON.stringify(now);
        if (history.length < 200 && text !== JSON.stringify(history.at(-1)?.where)) {
          history.push({ at: Math.round(performance.now()), where: now });
        }
        await report({
          ok: true,
          // Each `at` is milliseconds after this, the page's own start, on
          // the host's clock, which a driver's own times are on too.
          origin: Math.round(performance.timeOrigin),
          capabilities,
          container,
          play,
          keys: keysSeen,
          heard,
          history,
          where: now,
        });
        await sleep(500);
      }
    },
  };

  const run = async () => {
    await until(() => window.__TAURI_INTERNALS__, "Tauri's bridge");
    const step = steps[probe.step];
    if (!step) throw new Error(`no probe step ${probe.step}`);
    return step();
  };
  /** What Rust has open when the step is done: the folder, or why none. */
  const where = () =>
    invoke("vault_list", { relDir: "" }).then(
      (entries) => `a vault is open, listing ${entries.length} entries`,
      (error) => `no vault: ${error}`,
    );
  const start = () =>
    run().then(
      async (data) => report({ ok: true, ...data, vault: await where(), href: location.href }),
      (error) =>
        report({ ok: false, error: String(error), page: document.body?.innerText?.slice(0, 2000) }),
    );
  if (document.readyState === "complete") void start();
  else window.addEventListener("load", () => void start(), { once: true });
})();
