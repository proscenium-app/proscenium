// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Proscenium mark: an arch, the lit stage inside it, and a pale floor strip
 * along the stage's lip. It is option 3a of the logo set in the proscenium.ink
 * design handoff (Logos), adopted exactly (docs/engineering/release-engineering.md#REL-D7).
 *
 * This is the ONE copy of its geometry and colours. The Dock icon and the Icon
 * Composer layers (scripts/make-icon.ts) and the mark drawn inside the app
 * (AppMarkIcon) all read it, so none of them can drift from the others. That is
 * how the old icon ended up as an oxide gradient in the Dock and an accent
 * square with an outline in the app.
 *
 * Coordinates are the 1024 icon canvas; the tile is macOS's 824 grid square.
 * The colours are the brand's, not the accent: the Dock does not change with a
 * writer's accent preference, so neither does the mark.
 */
export const APP_MARK = {
  canvas: 1024,
  tile: { x: 100, y: 100, size: 824, radius: 186 },
  /** The arch, even-odd: the frame, with the opening cut out of it. */
  arch: "M280 826V430a232 232 0 0 1 464 0v232H338v164Z M338 604V430a174 174 0 0 1 348 0v174Z",
  /** The opening, lit: the stage. */
  stage: "M338 604V430a174 174 0 0 1 348 0v174Z",
  /** The floor strip. Dropped below 32px, where it is under a pixel tall. */
  strip: { x: 338, y: 590, width: 348, height: 14 },
  /** Arch and stage alone, no tile and no strip: menus and favicons. */
  glyphViewBox: "180 160 664 700",
  light: { tile: "#f4ecd8", arch: "#1f2933", stage: "#c9a227", strip: "#f8ecc4" },
  dark: { tile: "#1b1f24", arch: "#efe6d2", stage: "#d9b23c", strip: "#fbf3d8" },
  /**
   * Icon Composer draws each layer separately, and two shapes whose edges only
   * meet leave a hairline seam between them in dark mode. So its stage and strip
   * layers are drawn LARGER than the design, underneath the arch, which covers
   * the excess: what shows is exactly the design above.
   */
  layers: {
    stage: "M309 633V430a203 203 0 0 1 406 0v203Z",
    strip: { x: 309, y: 590, width: 406, height: 43 },
  },
} as const;

export type AppMarkPalette = (typeof APP_MARK)["light"] | (typeof APP_MARK)["dark"];
