// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The chrome icon set (docs/engineering/design-system.md#UI-D106).
 *
 * Monoline on a 16-unit box at 1.3px, round caps and joins, `currentColor` —
 * the same grid and weight `BinderIcons.tsx` already draws on, so a toolbar
 * glyph and a binder glyph share a family. FormattingIcon uses native SF
 * Symbols rendered locally on macOS, with vector fallbacks elsewhere.
 *
 * Every icon is `aria-hidden`: an icon button carries its name in `aria-label`,
 * because colour and shape are never the only carrier anywhere in this system.
 */
import { useSyncExternalStore, type ReactNode } from "react";
import { APP_MARK } from "./app-mark";

const S = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.3,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function Icon({ size = 16, children }: { size?: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false" {...S}>
      {children}
    </svg>
  );
}

type P = { size?: number };

/* ── Structure ─────────────────────────────────────────────────────────── */

/** `sidebar.left` — the binder toggle. */
export const SidebarLeftIcon = ({ size }: P) => (
  <Icon size={size}>
    <rect x="1.8" y="2.9" width="12.4" height="10.2" rx="2" />
    <path d="M6.2 2.9V13.1" />
  </Icon>
);

/** `sidebar.right` — the inspector toggle. */
export const SidebarRightIcon = ({ size }: P) => (
  <Icon size={size}>
    <rect x="1.8" y="2.9" width="12.4" height="10.2" rx="2" />
    <path d="M9.8 2.9V13.1" />
  </Icon>
);

/** `rectangle.split.2x1` — split side by side. */
export const SplitIcon = ({ size }: P) => (
  <Icon size={size}>
    <rect x="1.8" y="3.2" width="5.3" height="9.6" rx="1.3" />
    <rect x="8.9" y="3.2" width="5.3" height="9.6" rx="1.3" />
  </Icon>
);

/** Split top and bottom. */
export const SplitDownIcon = ({ size }: P) => (
  <Icon size={size}>
    <rect x="3.2" y="1.8" width="9.6" height="5.3" rx="1.3" />
    <rect x="3.2" y="8.9" width="9.6" height="5.3" rx="1.3" />
  </Icon>
);

/** `square.and.arrow.up` — pop a tab out into a pane of its own. */
export const PopOutIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M9.2 2.6h4.2v4.2" />
    <path d="M13.4 2.6 8.2 7.8" />
    <path d="M6.8 3.8H3.2v9h9V9.2" />
  </Icon>
);

/* ── Actions ───────────────────────────────────────────────────────────── */

export const PlusIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M8 3v10M3 8h10" />
  </Icon>
);

export const SearchIcon = ({ size }: P) => (
  <Icon size={size}>
    <circle cx="7.1" cy="7.1" r="4.3" />
    <path d="M10.3 10.3 13.4 13.4" />
  </Icon>
);

export const CheckIcon = ({ size = 11 }: P) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    aria-hidden="true"
    focusable="false"
    {...S}
    strokeWidth={1.7}
  >
    <path d="M3 8.4 6.4 11.8 13 4.6" />
  </svg>
);

export const CloseIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M4.6 4.6 11.4 11.4M11.4 4.6 4.6 11.4" />
  </Icon>
);

export const EllipsisIcon = ({ size }: P) => (
  <Icon size={size}>
    <circle cx="3.6" cy="8" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="8" cy="8" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="12.4" cy="8" r="0.9" fill="currentColor" stroke="none" />
  </Icon>
);

export const TrashIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M3.5 4.5h9" />
    <path d="M6.5 4.5V3.2h3v1.3" />
    <path d="M4.7 4.5 5.4 13h5.2l.7-8.5" />
  </Icon>
);

/** `clock.arrow.circlepath` — Changes, and "nothing has arrived from outside". */
export const RevertIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M2.6 8a5.4 5.4 0 1 0 5.4-5.4" />
    <path d="M2.6 4.4V8h3.6" />
  </Icon>
);

export const CopyIcon = ({ size }: P) => (
  <Icon size={size}>
    <rect x="5.4" y="5.4" width="8.2" height="8.2" rx="1.5" />
    <path d="M11 5.4V4A1.1 1.1 0 0 0 9.9 2.9H3.5A1.1 1.1 0 0 0 2.4 4v6.4A1.1 1.1 0 0 0 3.5 11.5h1.4" />
  </Icon>
);

/* ── Chevrons and arrows ───────────────────────────────────────────────── */

export const ChevronDownIcon = ({ size = 9 }: P) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    aria-hidden="true"
    focusable="false"
    {...S}
    strokeWidth={1.6}
  >
    <path d="M3.6 6 8 10.4 12.4 6" />
  </svg>
);

export const ChevronRightIcon = ({ size = 9 }: P) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    aria-hidden="true"
    focusable="false"
    {...S}
    strokeWidth={1.6}
  >
    <path d="M6 3.6 10.4 8 6 12.4" />
  </svg>
);

export const ChevronLeftIcon = ({ size = 9 }: P) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    aria-hidden="true"
    focusable="false"
    {...S}
    strokeWidth={1.6}
  >
    <path d="M10 3.6 5.6 8 10 12.4" />
  </svg>
);

/** The popup button's badge: up and down together, macOS's own glyph. */
export const UpDownIcon = ({ size = 9 }: P) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    aria-hidden="true"
    focusable="false"
    {...S}
    strokeWidth={1.5}
  >
    <path d="M4.2 6.2 8 2.6l3.8 3.6M4.2 9.8 8 13.4l3.8-3.6" />
  </svg>
);

export const ArrowUpIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M8 13V3.4M4 7.4 8 3.4l4 4" />
  </Icon>
);

export const ArrowDownIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M8 3v9.6M4 8.6l4 4 4-4" />
  </Icon>
);

/* ── Documents and people ──────────────────────────────────────────────── */

/** `doc.text` — the document-menu glyph on the title. */
export const DocIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M3.2 2.6h7.4l2.2 2.3v8.5H3.2z" />
    <path d="M10.4 2.7V5h2.3" />
  </Icon>
);

/** `person.2` — the pinned Cast row. */
export const CastIcon = ({ size }: P) => (
  <Icon size={size}>
    <circle cx="6.2" cy="5.8" r="2.3" />
    <path d="M2.4 13.2a3.8 3.8 0 0 1 7.6 0" />
    <path d="M10.4 3.9a2.3 2.3 0 0 1 0 4.4M11.2 9.9a3.8 3.8 0 0 1 2.4 3.3" />
  </Icon>
);

/** `rectangle.grid.2x2` — the Board. */
export const BoardIcon = ({ size }: P) => (
  <Icon size={size}>
    <rect x="2.4" y="2.4" width="5" height="5" rx="1" />
    <rect x="8.6" y="2.4" width="5" height="5" rx="1" />
    <rect x="2.4" y="8.6" width="5" height="5" rx="1" />
    <rect x="8.6" y="8.6" width="5" height="5" rx="1" />
  </Icon>
);

/** `list.bullet` — the Outline. */
export const OutlineIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M3.2 4.6h1M6 4.6h6.8M5 8h1M7.8 8h5M5 11.4h1M7.8 11.4h5" />
  </Icon>
);

/** `text.bubble` — Comments. */
export const CommentIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M13.4 9.4a1.7 1.7 0 0 1-1.7 1.7H6.4L3.2 13.6v-2.5a1.7 1.7 0 0 1-.6-1.7V4.3a1.7 1.7 0 0 1 1.7-1.7h7.4a1.7 1.7 0 0 1 1.7 1.7z" />
  </Icon>
);

/** `plus.bubble` — a new comment, for where "+ Comment" has no room for its words. */
export const CommentAddIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M13.4 9.4a1.7 1.7 0 0 1-1.7 1.7H6.4L3.2 13.6v-2.5a1.7 1.7 0 0 1-.6-1.7V4.3a1.7 1.7 0 0 1 1.7-1.7h7.4a1.7 1.7 0 0 1 1.7 1.7z" />
    <path d="M8 4.6v4M6 6.6h4" />
  </Icon>
);

/* ── Editing ───────────────────────────────────────────────────────────── */

export const PencilIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M11.1 2.9a1.6 1.6 0 0 1 2.3 2.3L5.9 12.7l-3 .7.7-3z" />
    <path d="M10.2 3.8l2 2" />
  </Icon>
);

/** `return` — a line break inside the same thought. */
export const LineBreakIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M13 3.4v4.2a1.6 1.6 0 0 1-1.6 1.6H3.4" />
    <path d="M6.2 6.2 3.2 9.2l3 3" />
  </Icon>
);

/** `arrow.down.to.line` — a page break. */
export const PageBreakIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M8 2.6v7.2M5 6.8 8 9.8l3-3" />
    <path d="M3 13h10" />
  </Icon>
);

export const LockIcon = ({ size }: P) => (
  <Icon size={size}>
    <rect x="3.6" y="7.2" width="8.8" height="6.2" rx="1.4" />
    <path d="M5.8 7.2V5.4a2.2 2.2 0 0 1 4.4 0v1.8" />
  </Icon>
);

/** `exclamationmark.triangle` — the warn glyph. Never colour alone. */
export const WarnIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M8 2.6 14 13H2z" />
    <path d="M8 6.4v3.1M8 11.2v.2" />
  </Icon>
);

export const InfoIcon = ({ size }: P) => (
  <Icon size={size}>
    <circle cx="8" cy="8" r="5.6" />
    <path d="M8 4.8v3.8M8 11v.2" />
  </Icon>
);

const subscribeScheme = (onChange: () => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
};
const prefersDark = () => document.documentElement.dataset.theme === "dark";

/**
 * The app's mark, as the Dock draws it: the tile, the arch, the lit stage and
 * its floor strip (docs/engineering/release-engineering.md#REL-D7), from the same description the icon
 * generator reads (app-mark.ts). It was an accent square with an outline arch,
 * which is not the app the Dock shows.
 *
 * The colours are the brand's rather than tokens: the Dock icon does not follow
 * a writer's accent, so neither does its likeness. At night it takes the dark
 * icon's colours, as the Dock does, and below 32px it drops the strip, which is
 * under a pixel tall there.
 */
export const AppMarkIcon = ({ size = 52 }: { size?: number }) => {
  const c = useSyncExternalStore(subscribeScheme, prefersDark, () => false)
    ? APP_MARK.dark
    : APP_MARK.light;
  const { tile, strip } = APP_MARK;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`${tile.x} ${tile.y} ${tile.size} ${tile.size}`}
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x={tile.x}
        y={tile.y}
        width={tile.size}
        height={tile.size}
        rx={tile.radius}
        fill={c.tile}
      />
      <path fillRule="evenodd" d={APP_MARK.arch} fill={c.arch} />
      <path d={APP_MARK.stage} fill={c.stage} />
      {size >= 32 && (
        <rect x={strip.x} y={strip.y} width={strip.width} height={strip.height} fill={c.strip} />
      )}
    </svg>
  );
};
