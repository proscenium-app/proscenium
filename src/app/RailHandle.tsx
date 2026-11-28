// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The edge a rail is resized by (docs/app/organizing/workspace-model.md#WORK-97):
 * the binder's right edge and the inspector's left. A drag moves it within the
 * rail's range, a double-click puts it back where it started, and a keyboard
 * moves it too — focus it and the arrows step, Shift steps further, Home and
 * End go to the limits — as the panes' own dividers do (WCAG 2.5.7, 2.1.1).
 *
 * While the pointer is down the width is written straight to the rail's
 * custom property on the workspace, so a drag redraws the rail and the page
 * beside it and nothing else; the width is kept when the pointer lets go.
 */

import { RAIL_LIMITS, type Rail, clampRail, railWidthForDrag, railWidthForKey } from "./rail-width";

export const RAIL_VAR: Record<Rail, string> = {
  binder: "--binder-w",
  inspector: "--inspector-w",
};

const LABEL: Record<Rail, string> = {
  binder: "Resize the binder",
  inspector: "Resize the inspector",
};

export function RailHandle({
  rail,
  width,
  onWidth,
}: {
  rail: Rail;
  width: number;
  onWidth: (px: number) => void;
}) {
  const { min, max, initial } = RAIL_LIMITS[rail];

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const handle = e.currentTarget;
    const host = handle.parentElement;
    if (!host) return;
    // No preventDefault: on a pointerdown it would take the mousedown and
    // mouseup that follow, and a press that never reaches the page as one.
    // The handle takes no selection (binder.css), and the capture keeps the
    // drag's moves here.
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      /* a pointer already up: the moves still arrive at the handle */
    }
    const startX = e.clientX;
    let now = width;
    const onMove = (ev: PointerEvent) => {
      now = railWidthForDrag(rail, width, ev.clientX - startX);
      host.style.setProperty(RAIL_VAR[rail], `${now}px`);
    };
    const done = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", done);
      handle.removeEventListener("pointercancel", done);
      if (now !== width) onWidth(now);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", done);
    handle.addEventListener("pointercancel", done);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const to = railWidthForKey(rail, width, e.key, e.shiftKey);
    if (to === null) return;
    e.preventDefault();
    if (to !== width) onWidth(to);
  }

  return (
    <div
      className={`railhandle railhandle--${rail}`}
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={LABEL[rail]}
      aria-valuenow={clampRail(rail, width)}
      aria-valuemin={min}
      aria-valuemax={max}
      title="Drag to resize. Double-click to put it back."
      onPointerDown={onPointerDown}
      onDoubleClick={() => {
        if (width !== initial) onWidth(initial);
      }}
      onKeyDown={onKeyDown}
    />
  );
}
