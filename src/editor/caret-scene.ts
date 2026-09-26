// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which scene the caret is in.
 *
 * `openScene` goes the other way — ordinal to position — and this is its
 * inverse, so the two must agree on what counts as a boundary or the inspector
 * would describe one scene while the caret sat in another. Both use
 * `extractScenes`' rule: `##` scene nodes if the script has any, otherwise
 * scene headings.
 *
 * Watching the SELECTION rather than the document, because the answer changes
 * when the writer moves without typing — which is most of the time they are
 * reading.
 */
import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";

/** 0-based ordinal of the scene containing `pos`, or null before the first. */
export function sceneOrdinalAt(doc: PmNode, pos: number): number | null {
  let hasScene = false;
  doc.forEach((n) => {
    if (n.type.name === "scene") hasScene = true;
  });
  const boundary = hasScene ? "scene" : "sceneHeading";
  let count = -1;
  let found: number | null = null;
  doc.forEach((node, offset) => {
    if (node.type.name === boundary) {
      count += 1;
      if (offset <= pos) found = count;
    }
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
    const dom = editor.view.dom as HTMLElement;
    let frame = 0;

    /**
     * Resolved on every read, never once. App re-parents the mounted editor
     * into whichever pane is showing the script (and parks it when none is),
     * so the scroller this element sits in is not a fact you can capture when
     * the effect happens to run — caching it here read `null` forever and the
     * marker never moved, which is the bug this hook exists to fix.
     */
    const read = () => {
      frame = 0;
      // The frame can land after a teardown, or while the editor is parked.
      if (editor.isDestroyed || !dom.isConnected) return false;
      const scroller = dom.closest(".pane__body");
      const box = (scroller ?? document.documentElement).getBoundingClientRect();
      const rect = dom.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false; // parked
      const at = editor.view.posAtCoords({
        left: rect.left + rect.width / 2,
        // A third down the visible box, not the top edge: the top is a sliver
        // of the scene you are leaving, and a marker that flips on the first
        // pixel of a scroll reads as jitter.
        top: box.top + box.height / 3,
      });
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
      document.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
      editor.off("update", schedule);
      editor.off("selectionUpdate", schedule);
    };
  }, [editor, enabled]);
  return ordinal;
}
