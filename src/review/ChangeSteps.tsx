// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * "Change 2 of 7", and the presses that go from one change to the next on a
 * drawn comparison (docs/app/keeping-work/storage-and-file-format.md#STOR-186).
 * Counted in the drawn page itself, so it counts exactly what is marked.
 */
import { useEffect, useRef, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, IconButton } from "../ui";

/** What it counts in: the document's part of a sitting, or the whole of a change. */
const SCOPE = ".sitting__doc, .changedetail";

/** The marked elements and lines of a drawn comparison, top to bottom. */
function marks(scope: Element): HTMLElement[] {
  return [
    ...scope.querySelectorAll<HTMLElement>(
      ".change__diff [data-redline], .change__diff .diffline--add, .change__diff .diffline--del",
    ),
  ];
}

/**
 * Its presses are full-size: beside the row of a burst's saves, a small one
 * stood closer to them than a touch target may (WCAG 2.2, 2.5.8).
 */
export function ChangeSteps() {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [count, setCount] = useState(0);
  const [index, setIndex] = useState(-1);
  useEffect(() => {
    const scope = ref.current?.closest(SCOPE);
    if (!scope) return;
    const recount = () => {
      const n = marks(scope).length;
      setCount(n);
      setIndex((i) => (i < n ? i : -1));
    };
    recount();
    const observer = new MutationObserver(recount);
    observer.observe(scope, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  const go = (delta: number) => {
    const scope = ref.current?.closest(SCOPE);
    if (!scope) return;
    const all = marks(scope);
    const next = Math.max(0, Math.min(all.length - 1, index + delta));
    setIndex(next);
    all[next]?.scrollIntoView({ block: "center" });
  };
  return (
    <span ref={ref} className="changesteps" role="group" aria-label="Changes on this page">
      {count > 1 && (
        <>
          <IconButton label="Previous change" neutral disabled={index <= 0} onClick={() => go(-1)}>
            <ChevronLeftIcon size={10} />
          </IconButton>
          <span className="changesteps__count">
            {index < 0 ? `${count} changes` : `${index + 1} of ${count}`}
          </span>
          <IconButton
            label="Next change"
            neutral
            disabled={index >= count - 1}
            onClick={() => go(1)}
          >
            <ChevronRightIcon size={10} />
          </IconButton>
        </>
      )}
    </span>
  );
}
