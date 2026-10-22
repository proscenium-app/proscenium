// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Previous and Next through a change drawn on the script
 * (docs/app/keeping-work/storage-and-file-format.md#STOR-185): how many
 * elements it marked, which one is in view, and the press that goes on to the
 * next. Counted on the page, after each transaction, so it is always what is
 * drawn. Turning the redline on goes to its first change.
 */
import type { Editor } from "@tiptap/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { redlineStops } from "../editor/live-redline";

export interface RedlineSteps {
  count: number;
  /** The change last gone to, or -1. */
  index: number;
  go: (delta: number) => void;
}

export function useRedlineSteps(editor: Editor | null, on: boolean): RedlineSteps {
  const [count, setCount] = useState(0);
  const [index, setIndex] = useState(-1);
  const indexRef = useRef(index);
  indexRef.current = index;

  const go = useCallback(
    (delta: number) => {
      if (!editor || editor.isDestroyed) return;
      const stops = redlineStops(editor.view.dom.parentElement ?? editor.view.dom);
      if (!stops.length) return;
      const at = indexRef.current;
      const next = at < 0 ? 0 : Math.max(0, Math.min(stops.length - 1, at + delta));
      setIndex(next);
      stops[next]!.scrollIntoView({ block: "center" });
    },
    [editor],
  );

  useEffect(() => {
    setIndex(-1);
    if (!editor || !on) {
      setCount(0);
      return;
    }
    const recount = () => {
      if (editor.isDestroyed) return;
      setCount(redlineStops(editor.view.dom.parentElement ?? editor.view.dom).length);
    };
    recount();
    editor.on("transaction", recount);
    return () => {
      editor.off("transaction", recount);
    };
  }, [editor, on]);

  // On, and drawn: the first change is brought into view.
  const arrived = on && count > 0;
  useEffect(() => {
    if (arrived) go(0);
  }, [arrived, go]);

  return { count, index, go };
}
