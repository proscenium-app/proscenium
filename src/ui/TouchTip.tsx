// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A tooltip a finger can read.
 *
 * A pointer that rests on a badge shows its `title`; a finger never does, so
 * on an iPad a format's warnings, a play's pages "Not counted" and why, and
 * the binder's "missing" were said nowhere a writer could read them
 * (docs/engineering/cross-platform.md#PLAT-70). An element whose title carries
 * news says so with `data-news`, and a tap by a finger on it shows the title
 * beside it, and says it to a screen reader, until the next tap or a few
 * seconds on. A pointer keeps its own tooltip, so nothing changes on a Mac.
 *
 * On `pointerup`, not `click`: iPadOS sends a tap's click only to an element
 * that looks clickable, and a badge does not. A tap that reads a badge does
 * nothing else: inside something a finger also presses (a binder row) it
 * neither focuses the row nor clicks it. It did both: the row's focus brought
 * its actions in, the badge moved out from under the finger, the click landed
 * on the row, which opened its note, and the tip went as it came.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { announce } from "./announce";
import { visibleHeight } from "./keyboard-inset";
import { portalHost } from "./portal-host";

/** The attribute an element with news in its title carries. */
export const NEWS = "data-news";

const GAP = 6;
/** How long a tip stays up, unless another tap takes it down first. */
const SHOWN_MS = 6000;

interface Tip {
  text: string;
  rect: DOMRect;
  el: Element;
}

export function TouchTip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let down: { x: number; y: number; at: number } | null = null;
    let timer = 0;
    /** The badge a tap just read, whose click goes no further. */
    let read: { el: Element; until: number } | null = null;
    const badgeAt = (target: EventTarget | null) =>
      (target as Element | null)?.closest?.(`[${NEWS}][title]`) ?? null;
    // A finger's tap on a badge focuses nothing: WebKit sends the tap's
    // mouse events after its pointer's lift, which has read the badge.
    const onMouseDown = (e: MouseEvent) => {
      if (read && Date.now() <= read.until && read.el.contains(e.target as Node))
        e.preventDefault();
    };
    // Its click lands on the badge, or on the row around it if anything moved
    // between press and lift: either way, it is the badge's, and stops here.
    const onClick = (e: MouseEvent) => {
      if (!read || Date.now() > read.until) return;
      const target = e.target as Node;
      if (read.el.contains(target) || target.contains(read.el)) {
        e.stopPropagation();
        e.preventDefault();
      }
      read = null;
    };
    const onDown = (e: PointerEvent) => {
      down =
        e.pointerType === "touch" || e.pointerType === "pen"
          ? { x: e.clientX, y: e.clientY, at: Date.now() }
          : null;
    };
    const onUp = (e: PointerEvent) => {
      const start = down;
      down = null;
      if (!start) return;
      // A tap, not a scroll or a press held to select.
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) return;
      if (Date.now() - start.at > 600) return;
      const el = badgeAt(e.target);
      const text = el?.getAttribute("title")?.trim();
      window.clearTimeout(timer);
      if (!el || !text) {
        setTip(null);
        return;
      }
      setTip({ text, rect: el.getBoundingClientRect(), el });
      announce(text);
      read = { el, until: Date.now() + 1000 };
      timer = window.setTimeout(() => setTip(null), SHOWN_MS);
    };
    const hide = () => setTip(null);
    // A scroll that moved the badge takes its tip down; one that did not (the
    // row's own focus, as the tap lands) leaves it where it is, and so does a
    // badge drawn again in its place (the binder's new-file dot, cleared by
    // the tap that asked what it meant).
    const moved = () =>
      setTip((tip) => {
        if (!tip || !tip.el.isConnected) return tip;
        const now = tip.el.getBoundingClientRect();
        return Math.abs(now.top - tip.rect.top) < 2 && Math.abs(now.left - tip.rect.left) < 2
          ? tip
          : null;
      });
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("resize", hide);
    window.addEventListener("scroll", moved, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("resize", hide);
      window.removeEventListener("scroll", moved, true);
    };
  }, []);

  // Below the badge, or above it where the screen's keyboard or the window's
  // foot leaves no room, and never past either side.
  useEffect(() => {
    const el = ref.current;
    if (!el || !tip) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const below = tip.rect.bottom + GAP;
    const top = below + h > visibleHeight() - GAP ? tip.rect.top - h - GAP : below;
    const left = Math.min(Math.max(GAP, tip.rect.left), window.innerWidth - w - GAP);
    el.style.top = `${Math.round(Math.max(GAP, top))}px`;
    el.style.left = `${Math.round(Math.max(GAP, left))}px`;
    el.style.visibility = "visible";
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    // Said through the announcer; the bubble itself is the picture of it.
    <div ref={ref} className="touchtip" aria-hidden="true" style={{ visibility: "hidden" }}>
      {tip.text}
    </div>,
    portalHost(),
  );
}
