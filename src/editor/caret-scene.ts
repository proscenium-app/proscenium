// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which scene the caret is in.
 *
 * `openScene` goes the other way — ordinal to position — and this is its
 * inverse, so the two must agree on what counts as a boundary or the inspector
 * would describe one scene while the caret sat in another. Both use
 * `extractScenes`' rule: `##` scene nodes if the script has any, otherwise
 * scene headings, and with neither the whole script is one scene
 * (scene-starts.ts, which a comment's scene is read from too).
 *
 * Watching the SELECTION rather than the document, because the answer changes
 * when the writer moves without typing — which is most of the time they are
 * reading.
 */
import { useEffect, useLayoutEffect, useState } from "react";
import type { Editor } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { sceneStarts } from "./scene-starts";

/**
 * 0-based ordinal of the scene containing `pos`, or null before the first (or
 * in a script with no words, which has none).
 */
export function sceneOrdinalAt(doc: PmNode, pos: number): number | null {
  let found: number | null = null;
  sceneStarts(doc).forEach((start, ordinal) => {
    if (start <= pos) found = ordinal;
  });
  return found;
}

export function useCaretScene(editor: Editor | null): number | null {
  const [ordinal, setOrdinal] = useState<number | null>(null);
  useEffect(() => {
    if (!editor) {
      setOrdinal(null);
      return;
    }
    const sync = () => {
      setOrdinal(sceneOrdinalAt(editor.state.doc, editor.state.selection.head));
    };
    sync();
    editor.on("selectionUpdate", sync);
    editor.on("update", sync);
    return () => {
      editor.off("selectionUpdate", sync);
      editor.off("update", sync);
    };
  }, [editor]);
  return ordinal;
}

/**
 * The point the page map reads the script at, in viewport coordinates, or
 * null while the editor is parked or gone.
 *
 * Resolved on every read, never once. App re-parents the mounted editor into
 * whichever pane is showing the script (and parks it when none is), so the
 * scroller this element sits in is not a fact you can capture when an effect
 * happens to run — caching it read `null` forever and the strip's scene never
 * moved.
 *
 * A third down the visible box, not the top edge: the top is a sliver of the
 * scene you are leaving, and a marker that flips on the first pixel of a
 * scroll reads as jitter. The scene lit on the strip and the place marked in
 * it are both read here, so the two can never disagree.
 */
function readingPoint(editor: Editor): { left: number; top: number } | null {
  if (editor.isDestroyed) return null;
  const dom = editor.view.dom as HTMLElement;
  if (!dom.isConnected || parked(dom)) return null;
  const scroller = dom.closest(".pane__body");
  const box = (scroller ?? document.documentElement).getBoundingClientRect();
  const rect = dom.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null; // not laid out
  return { left: rect.left + rect.width / 2, top: box.top + box.height / 3 };
}

/**
 * Whether the script waits in App's park, off screen, with no pane showing it.
 * The park is a hidden box of no size, but the pages inside it keep their own,
 * so their size cannot say so: read there, the "screen" was the window's, a
 * scene was lit for a script nobody could see, and the pane it next opened in
 * lit another a frame or more later, the mark taken down and drawn again.
 */
function parked(dom: HTMLElement): boolean {
  return dom.closest(".editorpark") !== null;
}

/**
 * How far through a scene a point down the page is, from 0 at its heading to
 * 1 where the next scene starts: `at`, `start` and `end` are the same axis
 * (the page's tops). A point above the heading is 0 and one past the end is 1,
 * and a scene with no height yet is 0, so the marker never leaves its segment.
 */
export function throughScene(at: number, start: number, end: number): number {
  if (!(end > start)) return 0;
  return Math.min(1, Math.max(0, (at - start) / (end - start)));
}

/**
 * Where in the scene on screen the writer is reading, 0–1, for the marker
 * inside its segment of the page map (docs/app/preferences-and-help/settings.md#SET-45).
 *
 * Measured in drawn height, not characters: the strip sizes each scene by its
 * pages, and a page of short dialogue holds far fewer characters than a page
 * of stage directions, so a count of characters would put the marker in the
 * wrong place on the page the writer is looking at. `ordinal` is the scene the
 * strip has lit (useVisibleScene), read at the same point.
 *
 * Its own hook, used by the marker alone, so a scroll redraws one span and not
 * the editor that holds the strip.
 *
 * Its first read is a layout effect, before the page is painted or anything
 * else runs. The marker is drawn inside the lit scene's segment, so a new lit
 * scene mounts a new marker, which starts with no answer; read after paint, as
 * a plain effect does, the mark was gone from the page for a frame each time
 * the lit scene changed, and a check that looked in that frame (a slow page,
 * a script still settling after it was opened) found no mark at all.
 */
export function useSceneProgress(editor: Editor | null, ordinal: number | null): number | null {
  const [through, setThrough] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!editor || ordinal === null) {
      setThrough(null);
      return;
    }
    let frame = 0;
    const read = () => {
      frame = 0;
      const point = readingPoint(editor);
      if (!point) return;
      const { view, state } = editor;
      const starts = sceneStarts(state.doc);
      const start = starts[ordinal];
      if (start === undefined) return;
      // Inside the heading's own line, not on the boundary before it, where
      // a position has no line of its own to be measured from.
      const top = (pos: number) => view.coordsAtPos(Math.min(pos + 1, state.doc.content.size)).top;
      const next = starts[ordinal + 1];
      const end =
        next === undefined ? (view.dom as HTMLElement).getBoundingClientRect().bottom : top(next);
      // Kept to a thousandth, so a scroll that moves nothing visible redraws nothing.
      setThrough(Math.round(throughScene(point.top, top(start), end) * 1000) / 1000);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    // As useVisibleScene: scroll from any scroller, in the capture phase, and
    // the first answer synchronous for a document that never fires a frame.
    document.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    editor.on("update", schedule);
    editor.on("selectionUpdate", schedule);
    // The script's own size too: an editor still parked or unlaid-out at
    // mount reads nothing, and fonts and pages that settle after it move every
    // heading without a scroll or an edit to say so.
    const sized = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    sized?.observe(editor.view.dom);
    read();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      sized?.disconnect();
      document.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
      editor.off("update", schedule);
      editor.off("selectionUpdate", schedule);
    };
  }, [editor, ordinal]);
  return through;
}

/**
 * Which scene is ON SCREEN — the answer the page map needs.
 *
 * `useCaretScene` answers "where is the caret", and the strip used to mark that.
 * The caret does not move while you read, so scrolling past six
 * scenes left the mark sitting on the last one you typed in: a marker that
 * doesn't follow the scroll doesn't really work as one.
 *
 * Reads a point a third of the way down the visible box rather than the very
 * top edge — the top is a sliver of the scene you are leaving, and a marker
 * that flips on the first pixel of a scroll reads as jitter. `posAtCoords` then
 * hands the position to the SAME `sceneOrdinalAt` the caret path uses, so the
 * strip and the inspector can never name different scenes for one screen.
 *
 * Typing keeps the caret in view, so while writing this agrees with the caret
 * anyway; the difference only shows up when reading, which is the whole point.
 */
export function useVisibleScene(editor: Editor | null, enabled = true): number | null {
  const [ordinal, setOrdinal] = useState<number | null>(null);
  useEffect(() => {
    if (!editor || !enabled) {
      setOrdinal(null);
      return;
    }
    let frame = 0;

    const read = () => {
      frame = 0;
      const point = readingPoint(editor);
      // Parked, the answer is the one the pane last gave, still true when
      // the script comes back to the scroll that pane kept.
      if (!point) return false;
      const at = editor.view.posAtCoords(point);
      // Past the end of the text (or in a gutter) posAtCoords finds nothing.
      // Holding the last answer beats blanking the marker mid-scroll.
      if (!at) return false;
      const doc = editor.state.doc;
      const ord = sceneOrdinalAt(doc, at.pos);
      // Above the first scene heading — front matter, an act title — is still
      // "the start of the play" as far as a MAP is concerned, and a strip with
      // nothing lit reads as broken rather than as precise. `sceneOrdinalAt`
      // keeps its null for the inspector, which means something different by
      // it: the caret is genuinely not in a scene.
      if (ord === null) {
        let any = false;
        doc.forEach((n) => {
          if (n.type.name === "scene" || n.type.name === "sceneHeading") any = true;
        });
        setOrdinal(any ? 0 : null);
        return any;
      }
      setOrdinal(ord);
      return true;
    };

    // rAF-coalesced: scroll fires far faster than the strip can change, and
    // posAtCoords hit-tests.
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };

    /* Scroll does not bubble, and the element that scrolls may not exist yet
       when this runs — so listen in the CAPTURE phase on the document, which
       sees scroll from any descendant whenever it appears. */
    document.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    editor.on("update", schedule);
    editor.on("selectionUpdate", schedule);
    /* App moves the script between its park and a pane without a scroll, a
       resize or an edit to say so: the move takes it in or out of view, which
       this sees once the pane has laid it out and put its scroll back. */
    const shown =
      typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(schedule);
    shown?.observe(editor.view.dom);

    /* The first answer, retried for a few frames: at mount the editor is often
       still parked or unlaid-out, and one failed read would leave the strip
       unmarked until the writer happened to scroll. Bounded, so a script that
       genuinely has no scenes costs ten frames and stops. A hidden document
       never fires rAF (the preview pane runs with document.hidden true), so
       the first attempt is synchronous and the retries are the bonus. */
    let tries = 0;
    const settle = () => {
      if (read() || (tries += 1) >= 10) return;
      requestAnimationFrame(settle);
    };
    settle();

    return () => {
      if (frame) cancelAnimationFrame(frame);
      shown?.disconnect();
      document.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
      editor.off("update", schedule);
      editor.off("selectionUpdate", schedule);
    };
  }, [editor, enabled]);
  return ordinal;
}
