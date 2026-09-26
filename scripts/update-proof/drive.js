// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// The update proof's driver: the build host's check that a copy of one version
// updates itself to the next through the real update service.
// A self-test build started with PROSCENIUM_UPDATE_PROOF runs this in its page
// instead of smoke's checks (src-tauri/src/selftest.rs). It does what a writer
// does: with the play open, Settings › Updates › Check Now, and once the new
// version is downloaded, a line typed into the script and Restart to Update
// straight after, so the words the updater must keep are ones no autosave has
// had time to write. What happens after the restart is scripts/update-proof.mjs's
// to judge: this page, and this build, are gone by then.
(() => {
  if (window.top !== window || window.__prosceniumProofStarted) return;
  window.__prosceniumProofStarted = true;

  const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);
  const log = (line) => invoke("selftest_proof_log", { line }).catch(() => {});
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function until(what, fn, timeout) {
    const deadline = Date.now() + timeout;
    for (;;) {
      const value = await fn();
      if (value) return value;
      if (Date.now() > deadline) throw new Error(`timed out after ${Math.round(timeout / 1000)}s waiting for ${what}`);
      await sleep(250);
    }
  }
  const button = (text) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === text && !b.disabled);
  const settingsOpen = () => !!document.querySelector(".prefs");

  async function openUpdates() {
    if (!settingsOpen()) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: ",", code: "Comma", metaKey: true, bubbles: true, cancelable: true }));
      await until("Settings to open", settingsOpen, 10_000);
    }
    const tab = [...document.querySelectorAll('.prefs__nav [role="tab"]')].find((t) => t.textContent.trim() === "Updates");
    if (!tab) throw new Error("Settings has no Updates section");
    tab.click();
    await until("the Updates section", () => [...document.querySelectorAll("button")].some((b) => /^(Check Now|Restart to Update)$/.test(b.textContent.trim())), 10_000);
  }

  function closeSettings() {
    const done = button("Done");
    if (done) done.click();
  }

  async function main() {
    const { line } = await invoke("selftest_proof_context");
    await log(`page loaded: ${location.href}`);
    const editor = await until("the play open, its script in the editor", () => document.querySelector(".editor-surface .ProseMirror"), 120_000);
    await log(`play open: ${document.querySelector(".doctitle")?.textContent?.trim() ?? "?"}`);

    await openUpdates();
    const before = document.querySelector(".prefs")?.textContent ?? "";
    await log(`Updates says: ${before.match(/Proscenium [^.]*\./)?.[0] ?? "?"}`);
    (await until("Check Now", () => button("Check Now"), 10_000)).click();
    await log("Check Now pressed");
    // Checking, then Downloading, then Ready: a failure is said in the same row.
    // Checking, then Downloading, then Ready (src/app/updates.ts). An answer that
    // ends it otherwise is said in the same row, and stops the proof with it.
    await until("Restart to Update (the new version downloaded and verified)", () => {
      if (button("Restart to Update")) return true;
      const said = document.querySelector(".prefs")?.textContent ?? "";
      const end = said.match(/[^.]*(is up to date|Couldn’t connect|Couldn’t check|security check|didn’t check|can’t check)[^.]*\./)?.[0];
      if (end && button("Check Now")) throw new Error(`the check ended without an update: ${end.trim()}`);
      return false;
    }, 15 * 60_000);
    await log("the update is downloaded: Restart to Update is offered");
    closeSettings();
    await until("Settings to close", () => !settingsOpen(), 10_000);

    // The line, typed at the end of the script through the editor, as a writer's
    // keys would put it there, and not yet saved when the restart is asked for.
    const tiptap = editor.editor;
    if (tiptap) tiptap.chain().focus("end").insertContent(` ${line}`).run();
    else {
      editor.focus();
      document.execCommand("insertText", false, ` ${line}`);
    }
    if (!editor.textContent.includes(line)) throw new Error("the line did not reach the script");
    await log(`typed: ${line}`);

    await openUpdates();
    for (let attempt = 1; ; attempt++) {
      const restart = await until("Restart to Update", () => button("Restart to Update"), 10_000);
      restart.click();
      await log(`Restart to Update pressed (${attempt})`);
      // The app refuses while edits are still being written, says so, and is
      // asked again; the process ends when the install begins.
      await sleep(5_000);
      if (attempt >= 12) throw new Error("the app never restarted after 12 presses of Restart to Update");
    }
  }

  main().catch((e) => log(`FAILED: ${e?.message ?? e}`));
})();
