// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import { PAGE_FOCUS_RETRY_MS, PAGE_FOCUS_WAIT_MS, createPageFocus, type PageTarget } from "./page-focus";

/** A clock and a task queue the test runs by hand. */
function harness() {
  let now = 0;
  let tasks: { at: number; run: () => void }[] = [];
  const state = { layer: false, typing: false };
  const focus = createPageFocus({
    now: () => now,
    later: (run, ms) => void tasks.push({ at: now + ms, run }),
    layerOpen: () => state.layer,
    typingSomewhere: () => state.typing,
  });
  /** Move the clock and run what fell due, including what that schedules. */
  const advance = (ms: number) => {
    const until = now + ms;
    for (;;) {
      const due = tasks.filter((t) => t.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      tasks = tasks.filter((t) => t !== due);
      now = Math.max(now, due.at);
      due.run();
    }
    now = until;
  };
  return { focus, state, advance, queued: () => tasks.length };
}

/** A page that is ready unless told otherwise, and takes focus when asked. */
function page(opts: { ready?: boolean; lands?: boolean } = {}) {
  const p = {
    ready: opts.ready ?? true,
    lands: opts.lands ?? true,
    focused: false,
    calls: 0,
  };
  const target: PageTarget = {
    hasFocus: () => p.focused,
    ready: () => p.ready,
    focus: () => {
      p.calls++;
      if (p.lands) p.focused = true;
    },
  };
  return { p, target };
}

describe("page focus (docs/app/preferences-and-help/accessibility.md#A11Y-4)", () => {
  test("a request waits for its page, and the page takes the cursor once", () => {
    const h = harness();
    h.focus.request("doc");
    h.advance(200);
    expect(h.focus.pending()).toBe("doc");
    const a = page();
    h.focus.register("doc", a.target);
    // At the next look, never more than a retry away.
    h.advance(PAGE_FOCUS_RETRY_MS);
    expect(a.p.calls).toBe(1);
    expect(a.p.focused).toBe(true);
    expect(h.focus.pending()).toBeNull();
    // Consumed: the same page offered again, later, is left alone.
    a.p.focused = false;
    const again = page();
    h.focus.register("doc", again.target);
    h.advance(PAGE_FOCUS_RETRY_MS * 4);
    expect(again.p.calls).toBe(0);
  });

  test("never inside the call that asked: a name field has to go first", () => {
    const h = harness();
    const a = page();
    h.focus.register("sheet", a.target);
    h.focus.request("sheet");
    expect(a.p.calls).toBe(0);
    h.advance(0);
    expect(a.p.calls).toBe(1);
  });

  test("never over a layer: it waits for the menu or sheet to close", () => {
    const h = harness();
    const a = page();
    h.focus.register("doc", a.target);
    h.state.layer = true;
    h.focus.request("doc");
    h.advance(PAGE_FOCUS_RETRY_MS * 10);
    expect(a.p.calls).toBe(0);
    h.state.layer = false;
    h.advance(PAGE_FOCUS_RETRY_MS);
    expect(a.p.focused).toBe(true);
  });

  test("a hidden page is waited for, not focused", () => {
    const h = harness();
    const a = page({ ready: false });
    h.focus.register("script", a.target);
    h.focus.request("script");
    h.advance(PAGE_FOCUS_RETRY_MS * 5);
    expect(a.p.calls).toBe(0);
    a.p.ready = true;
    h.advance(PAGE_FOCUS_RETRY_MS);
    expect(a.p.focused).toBe(true);
  });

  test("focus that does not land is tried again until it does", () => {
    const h = harness();
    const a = page({ lands: false });
    h.focus.register("doc", a.target);
    h.focus.request("doc");
    h.advance(PAGE_FOCUS_RETRY_MS * 3);
    expect(a.p.calls).toBeGreaterThan(1);
    a.p.lands = true;
    h.advance(PAGE_FOCUS_RETRY_MS);
    expect(a.p.focused).toBe(true);
    expect(h.focus.pending()).toBeNull();
  });

  test("a writer typing somewhere else keeps the cursor", () => {
    const h = harness();
    const a = page();
    h.focus.request("doc");
    h.state.typing = true;
    h.focus.register("doc", a.target);
    h.advance(PAGE_FOCUS_RETRY_MS * 4);
    expect(a.p.calls).toBe(0);
    expect(h.focus.pending()).toBeNull();
  });

  test("a page that already has focus answers without being focused again", () => {
    const h = harness();
    const a = page();
    a.p.focused = true;
    h.state.typing = true; // its own editor holds the caret
    h.focus.register("doc", a.target);
    h.focus.request("doc");
    h.advance(0);
    expect(a.p.calls).toBe(0);
    expect(h.focus.pending()).toBeNull();
  });

  test("a request lapses, so a page opened much later never takes the cursor", () => {
    const h = harness();
    h.focus.request("doc");
    h.advance(PAGE_FOCUS_WAIT_MS + 1);
    const a = page();
    h.focus.register("doc", a.target);
    h.advance(PAGE_FOCUS_RETRY_MS * 4);
    expect(a.p.calls).toBe(0);
    expect(h.focus.pending()).toBeNull();
  });

  test("waiting stops when the request lapses: no task is left running", () => {
    const h = harness();
    h.focus.register("doc", page({ ready: false }).target);
    h.focus.request("doc");
    h.advance(PAGE_FOCUS_WAIT_MS + PAGE_FOCUS_RETRY_MS * 2);
    expect(h.queued()).toBe(0);
  });

  test("only the newest request stands, and cancel drops it", () => {
    const h = harness();
    const first = page();
    const second = page();
    h.focus.register("first", first.target);
    h.focus.register("second", second.target);
    h.focus.request("first");
    h.focus.request("second");
    h.advance(0);
    expect(first.p.calls).toBe(0);
    expect(second.p.focused).toBe(true);

    h.focus.request("first");
    h.focus.cancel("second");
    expect(h.focus.pending()).toBe("first");
    h.focus.cancel();
    h.advance(PAGE_FOCUS_RETRY_MS);
    expect(first.p.calls).toBe(0);
  });

  test("a page withdrawn before its request is answered is not focused", () => {
    const h = harness();
    const a = page();
    const withdraw = h.focus.register("doc", a.target);
    withdraw();
    h.focus.request("doc");
    h.advance(PAGE_FOCUS_RETRY_MS * 3);
    expect(a.p.calls).toBe(0);
    expect(h.focus.pending()).toBe("doc");
  });
});
