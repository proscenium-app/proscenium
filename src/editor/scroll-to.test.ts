// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where a position lands when it is brought into view. The scroller is faked
 * with the few measurements scrollPosIntoView reads: a frame 700px tall at the
 * top of the window, scrolled 1,000px into 5,000px of pages.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { EditorView } from "@tiptap/pm/view";
import { scrollPosIntoView } from "./scroll-to";

function frame(caretTop: number) {
  const scroller = {
    overflowY: "auto", scrollHeight: 5000, clientHeight: 700, scrollTop: 1000, parentElement: null,
    getBoundingClientRect: () => ({top: 0, bottom: 700, height: 700}),
  };
  const view = {dom: {parentElement: scroller}, coordsAtPos: () => ({top: caretTop, bottom: caretTop + 20})} as unknown as EditorView;
  return {scroller, view};
}

let saved: typeof globalThis.getComputedStyle;
beforeEach(() => {
  saved = globalThis.getComputedStyle;
  globalThis.getComputedStyle = ((el: {overflowY?: string}) => ({overflowY: el.overflowY ?? "visible"})) as unknown as typeof getComputedStyle;
});
afterEach(() => {globalThis.getComputedStyle = saved;});

describe("scrollPosIntoView", () => {
  it("brings a line only just inside the margin by default", () => {
    const {scroller, view} = frame(900);
    scrollPosIntoView(view, 1);
    expect(scroller.scrollTop).toBe(1000 + 900 - 96);
  });

  it("always centres with center", () => {
    const {scroller, view} = frame(300);
    scrollPosIntoView(view, 1, {center: true});
    expect(scroller.scrollTop).toBe(1000 + 300 - 350);
  });

  describe("centerIfHidden", () => {
    it("leaves a line inside the margin where it is", () => {
      for (const top of [96, 300, 584]) {
        const {scroller, view} = frame(top);
        scrollPosIntoView(view, 1, {centerIfHidden: true});
        expect(scroller.scrollTop).toBe(1000);
      }
    });

    it("centres a line pushed below the frame, so the lines before it show too", () => {
      const {scroller, view} = frame(900);
      scrollPosIntoView(view, 1, {centerIfHidden: true});
      expect(scroller.scrollTop).toBe(1000 + 900 - 350);
    });

    it("centres a line hidden above the frame, or under the margin", () => {
      for (const top of [-200, 40]) {
        const {scroller, view} = frame(top);
        scrollPosIntoView(view, 1, {centerIfHidden: true});
        expect(scroller.scrollTop).toBe(1000 + top - 350);
      }
    });

    it("never scrolls past the top of the pages", () => {
      const {scroller, view} = frame(-1200);
      scrollPosIntoView(view, 1, {centerIfHidden: true});
      expect(scroller.scrollTop).toBe(0);
    });
  });
});
