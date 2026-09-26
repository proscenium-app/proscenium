// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Binder icons.
 *
 * These were eight Unicode dingbats (`❖ ▸ ☻ ✦ ✎ “ ⎙ ▤`) picked from five
 * different blocks, which is why they never looked like a set: each came from a
 * different type designer, at a different weight, on a different baseline, and
 * `☻` fell through to the color-emoji font on macOS. `“` was literally a
 * quotation mark doing duty as a picture, so it hung at the cap line instead of
 * centering in its box.
 *
 * Drawn here on one 16-unit grid at one stroke weight, in `currentColor` so a
 * row inherits `--ash`, `--oxide` when selected, and the dark token fork,
 * without any of them being restated.
 *
 * The disclosure chevron is deliberately SEPARATE from the folder icon. The old
 * set used `▸` for both and rotated it with `.binder__icon.is-open { transform:
 * rotate(0) }` — a no-op, since nothing set a base rotation. Open and closed
 * folders rendered identically and the only signal you had was a color change.
 */

export type IconKind =
  | "script"
  | "folder"
  | "character"
  | "outline"
  | "reference"
  | "document";

const S = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.3,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** A page outline with a turned corner — the base most material icons sit on. */
const PAGE = "M4 2.4h5.2L12.4 5.6v8H4z";
const FOLD = "M9.2 2.4v3.2h3.2";

const PATHS: Record<IconKind, React.ReactNode> = {
  // The script: a page whose lines are CENTERED — the shape of a cue over a
  // speech, which is what tells it apart from a note at 16px.
  script: (
    <>
      <path d={PAGE} />
      <path d={FOLD} />
      <path d="M6.9 8.4h2.6" />
      <path d="M5.8 10.4h4.8" />
      <path d="M6.6 12.4h3.2" />
    </>
  ),
  // No turned corner, lines flush left: a sheet of prose, not a page of script.
  // Every material that is not a script or a character sheet draws this one —
  // there is one document kind now, so there is one document icon.
  document: (
    <>
      <rect x="3.5" y="2.4" width="9" height="11.2" rx="1.1" />
      <path d="M5.8 6.2h4.4" />
      <path d="M5.8 8.6h4.4" />
      <path d="M5.8 11h2.8" />
    </>
  ),
  folder: (
    <>
      <path d="M2.3 4.5a1 1 0 0 1 1-1h2.9l1.4 1.7h5.1a1 1 0 0 1 1 1v6.3a1 1 0 0 1-1 1H3.3a1 1 0 0 1-1-1z" />
    </>
  ),
  character: (
    <>
      <circle cx="8" cy="5.9" r="2.5" />
      <path d="M3.3 13.4a4.7 4.7 0 0 1 9.4 0" />
    </>
  ),
  // Hierarchy, which is the whole point of the outline: rows at two depths.
  outline: (
    <>
      <path d="M3.2 4.6h1" />
      <path d="M6 4.6h6.8" />
      <path d="M5 8h1" />
      <path d="M7.8 8h5" />
      <path d="M5 11.4h1" />
      <path d="M7.8 11.4h5" />
    </>
  ),
  // A paperclip: a file that came from somewhere else and opens elsewhere.
  reference: (
    <>
      <path d="M12.1 7.6 7.7 12a2.8 2.8 0 0 1-4-4l4.7-4.7a1.9 1.9 0 0 1 2.7 2.7l-4.7 4.7a.9.9 0 0 1-1.3-1.3l4.3-4.3" />
    </>
  ),
};

export function BinderIcon({ kind }: { kind: IconKind }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" {...S}>
      {PATHS[kind] ?? PATHS.document}
    </svg>
  );
}

/** The folder disclosure arrow. Rotation is CSS, off `.is-open`. */
export function DisclosureIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" {...S}>
      <path d="M6.2 3.6 10.6 8l-4.4 4.4" />
    </svg>
  );
}

/** Rename — a pencil. No longer doubles as the `note` type icon. */
export function PencilIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" {...S}>
      <path d="M11.1 2.9a1.6 1.6 0 0 1 2.3 2.3L5.9 12.7l-3 .7.7-3z" />
      <path d="M10.2 3.8l2 2" />
    </svg>
  );
}

/** Delete — a cross, drawn rather than the `✕` character. */
export function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" {...S}>
      <path d="M4.6 4.6l6.8 6.8M11.4 4.6l-6.8 6.8" />
    </svg>
  );
}
