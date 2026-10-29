// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The real Windows app's variant passes (docs/engineering/release-engineering.md#REL-128):
 * acts smoke has already run in the PC's plain setup, run again as a writer's
 * PC is set up otherwise, each through WebView2 alone and never by changing
 * the machine.
 *
 *   node scripts/smoke.mjs --engine webview2 --app <exe> --variants all
 *   node scripts/smoke.mjs --engine webview2 --app <exe> --variants scale-150,contrast
 *
 * A variant changes how the app is started (`launch`, which the test build
 * reads: WebView2's display language) or how its page is shown (`emulate`,
 * through WebView2's own DevTools emulation: the screen's scale, forced
 * colours). The checks are the same, and so is what each surface says: a
 * variant's tree is held against the PC copy's file, and has a file of its
 * own (`<surface>.<variant>.yml`) only where it reads otherwise, as a dark
 * scheme or an engine does (scripts/aria-snapshots.mjs).
 *
 * `acts` names the acts a variant runs: every act that runs in every engine,
 * by default, or the acts it is about.
 */
import { ACTS } from "./smoke-checks.mjs";

/** The acts a writer's setup could change, in a sentence: the shared acts. */
const SHARED = ACTS.filter((a) => !a.engines).map((a) => a.name);

/** The acts that show a date, a time, a count or a sorted list. */
const LOCALE_ACTS = [
  "opening",
  "plays",
  "the play's chrome",
  "editor",
  "settings",
  "review",
  "feedback",
  "recovery",
  "writes in flight",
];

export const VARIANTS = [
  {
    name: "scale-150",
    what: "Windows' display at 150%, a 1080p laptop's default: the page drawn at one and a half device pixels to each of its own",
    emulate: { deviceScaleFactor: 1.5 },
    acts: SHARED,
  },
  {
    name: "scale-200",
    what: "Windows' display at 200%, a 4K screen's default",
    emulate: { deviceScaleFactor: 2 },
    acts: [
      "opening",
      "the play's chrome",
      "panes",
      "editor",
      "keyboard and sheets",
      "export",
      "workspace",
      "review",
      "formats",
    ],
  },
  {
    name: "contrast",
    what: "a high contrast theme: Windows' forced colours, in the light scheme and the dark",
    emulate: { forcedColors: "active", contrast: "more" },
    // The theme sets every colour, so contrast is the theme's: axe reads the
    // colours the theme overrides, and called white words on black dark ones.
    // What forced colours can still hide, focus and what is chosen, the
    // forced colours act holds (scripts/smoke-checks.mjs).
    axe: { disable: ["color-contrast"] },
    acts: SHARED,
  },
  {
    name: "de",
    what: "Windows in German: WebView2 started in German, its dates, times and numbers in German forms",
    launch: { lang: "de-DE" },
    acts: LOCALE_ACTS,
  },
  {
    name: "ja",
    what: "Windows in Japanese: WebView2 started in Japanese, a display language in another script",
    launch: { lang: "ja-JP" },
    acts: LOCALE_ACTS,
  },
];

/** A variant by name, or an error naming the ones there are. */
export function variantNamed(name) {
  const v = VARIANTS.find((x) => x.name === name);
  if (!v)
    throw new Error(
      `no variant "${name}": the variants are ${VARIANTS.map((x) => x.name).join(", ")}`,
    );
  return v;
}

/** `--variants`' value as variants: `all`, or names, comma-separated. */
export function variantsFrom(arg) {
  if (!arg) return [];
  if (arg === "all") return [...VARIANTS];
  return arg
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(variantNamed);
}

/**
 * The variant a snapshot file belongs to, by its name (`<surface>.<variant>.yml`,
 * `<surface>.<variant>.dark.yml`), or null for the PC copy's own.
 */
export function variantOfFile(file) {
  for (const v of VARIANTS)
    if (file.endsWith(`.${v.name}.yml`) || file.endsWith(`.${v.name}.dark.yml`)) return v.name;
  return null;
}

/**
 * The files a surface's tree is held against in a variant, most particular
 * first: the variant's own in this scheme, the variant's own, then the
 * files the PC copy's plain pass holds it against (`plain`, most particular
 * first).
 */
export function variantNames(name, variant, scheme, plain) {
  return [
    scheme !== "light" && `${name}.${variant}.${scheme}.yml`,
    `${name}.${variant}.yml`,
    ...plain,
  ].filter(Boolean);
}
