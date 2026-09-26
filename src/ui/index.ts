// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The chrome's shared vocabulary (docs/engineering/design-system.md#UI-D106, docs/engineering/design-system.md#UI-D107, docs/app/preferences-and-help/accessibility.md#UI-D108).
 *
 * Everything here reads the tokens in styles.css and holds no colour of its
 * own. `bun run check:design` fails the build on a chrome font-size, radius or
 * gap outside the scales — an audit counted thirty type sizes and eight menu
 * chromes before there was a gate.
 */
export * from "./Icons";
export { Menu, useMenu, type MenuEntry, type MenuAction, type MenuAnchor } from "./Menu";
export {
  Button,
  IconButton,
  Segmented,
  Switch,
  Checkbox,
  Radio,
  PopupButton,
  PullDownButton,
  Chip,
  Capsule,
  Meter,
  type ButtonProps,
  type SegmentedOption,
  type PopupOption,
} from "./controls";
export { Sheet, Alert } from "./Sheet";
export { ToastHost, focusToastAction, useToast, type ToastSpec } from "./Toast";
export { announce, ensureAnnouncer } from "./announce";
export { anyLayerOpen } from "./layers";
export { onScreen, requestPageFocus, usePageTarget, type PageTarget } from "./page-focus";
export { ACCENTS, DEFAULT_ACCENT, type AccentId } from "./use-accent";
