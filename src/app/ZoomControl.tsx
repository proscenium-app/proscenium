// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The zoom control, in the status bar.
 *
 * Zoom has long existed and grew fit modes, but the only
 * thing on screen that admitted it was three rows buried in the Format menu,
 * behind a button labelled "Format" — so to a writer there was simply no zoom
 * control. It isn't a format setting and it never was: the format spec
 * decides the page, and zoom is a pure view transform that leaves the engine's
 * geometry and every page break identical. Putting it where
 * every other document app puts it — the right end of the status bar, always
 * visible while a script is open — is both the fix and the honest home.
 *
 * `−  100%  +` is the whole control at rest. The percentage is a button, because
 * the thing worth reaching for is **Fit width**: with the binder and inspector rails
 * open on a laptop the pane is narrower than a Letter sheet, and a fit re-solves
 * itself every time that changes.
 *
 * The popover is the app's one Menu (docs/app/preferences-and-help/accessibility.md#A11Y-3). It was the last hand-built
 * floating chrome: a `role="menu"` whose preset row held plain buttons, with no
 * arrow keys, no focus on open and nowhere for focus to go on close — the
 * one menu in the app a keyboard could open and not operate.
 */
import { useRef } from "react";
import { ZOOM_PRESETS, ZOOM_STEP, type ZoomMode } from "./use-zoom";
import { Menu, PlusIcon, useMenu, type MenuEntry } from "../ui";

export interface ZoomControlProps {
  mode: ZoomMode;
  /** "120%", or "Fit width · 84%". */
  label: string;
  onDelta: (delta: number) => void;
  onSetMode: (mode: ZoomMode) => void;
  onReset: () => void;
}

/** The step-out glyph: a rule, drawn rather than the "−" character, so it
    matches the "+" beside it at the same weight. */
function MinusIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
    >
      <path d="M3 8h10" />
    </svg>
  );
}

export function ZoomControl(props: ZoomControlProps) {
  const labelRef = useRef<HTMLButtonElement | null>(null);
  const menu = useMenu();

  const pct = props.mode.kind === "manual" ? `${Math.round(props.mode.level * 100)}%` : props.label;
  const fitting = props.mode.kind !== "manual";

  const entries: MenuEntry[] = [
    /* The fits solve for the pane and re-solve when it changes, so the sheet
       stops being cut off the moment a rail opens. */
    ...(
      [
        ["fit-width", "Fit Width"],
        ["fit-page", "Fit Page"],
      ] as const
    ).map(([kind, label]) => ({
      label,
      radio: true,
      checked: props.mode.kind === kind,
      onSelect: () => props.onSetMode({ kind }),
    })),
    { kind: "sep" },
    ...ZOOM_PRESETS.map((level) => ({
      label: `${Math.round(level * 100)}%`,
      radio: true,
      checked: props.mode.kind === "manual" && props.mode.level === level,
      onSelect: () => props.onSetMode({ kind: "manual", level }),
    })),
    { kind: "sep" },
    { label: "Actual Size", shortcut: "⌘0", onSelect: props.onReset },
  ];

  return (
    <span className="zoomctl">
      <button
        type="button"
        className="zoomctl__step"
        onClick={() => props.onDelta(-ZOOM_STEP)}
        title="Zoom out (⌘−)"
        aria-label="Zoom out"
      >
        <MinusIcon />
      </button>
      <button
        ref={labelRef}
        type="button"
        className={`zoomctl__label${menu.open ? " is-open" : ""}${fitting ? " is-fit" : ""}`}
        onClick={() => menu.openFrom(labelRef.current, "end", "top")}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            menu.openFrom(labelRef.current, "end", "top");
          }
        }}
        title="Zoom — fit the page to the pane, or pick a level"
        aria-label={`Zoom: ${pct}`}
        aria-haspopup="menu"
        aria-expanded={menu.open}
      >
        {pct}
      </button>
      <button
        type="button"
        className="zoomctl__step"
        onClick={() => props.onDelta(ZOOM_STEP)}
        title="Zoom in (⌘+)"
        aria-label="Zoom in"
      >
        <PlusIcon size={11} />
      </button>
      {menu.anchor && (
        /* Opens UPWARD — the status bar is the last row on screen — with the
           arrow that says it belongs to this control. */
        <Menu
          anchor={menu.anchor}
          entries={entries}
          onClose={menu.close}
          width={200}
          label="Zoom"
          start="checked"
          arrow
        />
      )}
    </span>
  );
}
