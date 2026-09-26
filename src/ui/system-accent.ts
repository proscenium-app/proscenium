// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Follow Mac: the seven accent tokens (docs/engineering/design-system.md#UI-D102), derived from
 * whatever accent colour the Mac answers (src-tauri/src/accent.rs).
 *
 * The four hand-picked accents were each tuned by eye against the surfaces
 * they sit on. The Mac's accent can be anything System Settings offers, from
 * yellow to graphite, so here the tuning is arithmetic, to the floors docs/engineering/design-system.md#UI-D100
 * holds the others to:
 *
 * - **Words on a fill read at 4.5:1.** The fill carries ink or cream, whichever
 *   reads better on the Mac's colour, and moves away from it in lightness until
 *   it reads at 4.5:1, as the old fixed System blue was darkened for white.
 * - **Accent text reads at 4.5:1 on every surface it sits on**: paper, a
 *   field, the chrome, the rails and the desk. It darkens by day and lightens
 *   at night until it does, so a yellow accent's text comes out bronze, as
 *   gilt's does.
 * - **At night the fill lifts** to the other accents' lightness and carries
 *   #1A1613, as every accent's does.
 * - **A warm accent (orange, yellow) is flagged**, and warnings go neutral as
 *   they do under gilt: amber must not read as the accent.
 *
 * Lightness moves in OKLCH with the hue held, so a darkened accent is the same
 * colour deeper rather than a greyer one; chroma is cut only as far as sRGB
 * needs.
 */

/** sRGB components, 0…1. */
type Rgb = [number, number, number];

/** One scheme's seven accent tokens, as CSS values. */
export interface AccentTokens {
  accent: string;
  accentDeep: string;
  accentSoft: string;
  accentSofter: string;
  accentRing: string;
  accentText: string;
  onAccent: string;
}

export interface SystemAccent {
  /** The Mac's colour as it answered it, for the swatch. */
  swatch: string;
  /** Orange or yellow: amber warnings would read as the accent. */
  warm: boolean;
  light: AccentTokens;
  dark: AccentTokens;
}

/** The contrast every derived pairing clears (WCAG 2.2 AA for text). */
export const ACCENT_FLOOR = 4.5;

const INK = "#1f2933";
const CREAM = "#fcf8ef";
const NIGHT_INK = "#1a1613";
/** Where accent text sits by day: a field, paper, cream, the chrome, the rails, the desk. */
export const DAY_SURFACES = ["#fffdf8", "#fcf8ef", "#f4ecd8", "#f0e7d2", "#ebe1c9", "#dcd2c0"];
/** And at night: cream, paper, the chrome, the rails, the desk. */
export const NIGHT_SURFACES = ["#3a342d", "#332e28", "#2e2a25", "#262320", "#191714"];
/** The lightness the hand-picked accents lift to at night (OKLCH). */
const NIGHT_LIGHTNESS = 0.72;
const STEP = 0.01;

export function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const byte = (c: number) => Math.round(Math.min(1, Math.max(0, c)) * 255);

function toHex(rgb: Rgb): string {
  return `#${rgb.map((c) => byte(c).toString(16).padStart(2, "0")).join("")}`;
}

function rgba(rgb: Rgb, alpha: number): string {
  return `rgba(${rgb.map(byte).join(", ")}, ${alpha})`;
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** WCAG 2 relative luminance. */
function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio between two colours, 1…21. */
export function contrast(a: Rgb | string, b: Rgb | string): number {
  const x = luminance(typeof a === "string" ? parseHex(a)! : a);
  const y = luminance(typeof b === "string" ? parseHex(b)! : b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** sRGB → OKLCH: lightness 0…1, chroma, hue in degrees. */
function toOklch(rgb: Rgb): [number, number, number] {
  const [r, g, b] = rgb.map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
}

/** OKLCH → linear sRGB, which may fall outside 0…1. */
function oklchToLinear(L: number, C: number, h: number): Rgb {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const fits = (rgb: Rgb) => rgb.every((c) => c >= -1e-4 && c <= 1 + 1e-4);

/** The colour at lightness L with the hue held, its chroma cut only as far as sRGB needs. */
function at(L: number, C: number, h: number): Rgb {
  const lightness = Math.min(1, Math.max(0, L));
  let lo = 0;
  let hi = C;
  if (!fits(oklchToLinear(lightness, hi, h))) {
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (fits(oklchToLinear(lightness, mid, h))) lo = mid;
      else hi = mid;
    }
    hi = lo;
  }
  // Quantised to what the hex will say, so every contrast is checked on the colour that ships.
  return oklchToLinear(lightness, hi, h).map((c) => byte(toGamma(Math.min(1, Math.max(0, c)))) / 255) as Rgb;
}

/** From lightness L, step in `direction` until `ok` holds; black or white, which always do, at the end. */
function walk(L: number, C: number, h: number, direction: 1 | -1, ok: (rgb: Rgb) => boolean): Rgb {
  for (let l = L; l >= 0 && l <= 1; l += direction * STEP) {
    const rgb = at(l, C, h);
    if (ok(rgb)) return rgb;
  }
  return at(direction > 0 ? 1 : 0, C, h);
}

const worst = (rgb: Rgb, surfaces: readonly string[]) => Math.min(...surfaces.map((s) => contrast(rgb, s)));

/** A slightly deeper fill for hover and press, darker where the words on it still read. */
function deeper(fill: Rgb, C: number, h: number, on: string): Rgb {
  const [L] = toOklch(fill);
  for (const next of [L - 0.05, L + 0.05]) {
    const rgb = at(next, C, h);
    if (contrast(rgb, on) >= ACCENT_FLOOR) return rgb;
  }
  return fill;
}

/** The two schemes' tokens for the Mac's accent colour, or null for a colour that is not `#rrggbb`. */
export function deriveSystemAccent(hex: string): SystemAccent | null {
  const base = parseHex(hex);
  if (!base) return null;
  const [L, C, h] = toOklch(base);

  // By day the fill carries ink or cream, whichever reads better on the Mac's colour.
  const on = contrast(base, CREAM) >= contrast(base, INK) ? CREAM : INK;
  const fill = walk(L, C, h, on === CREAM ? -1 : 1, (rgb) => contrast(rgb, on) >= ACCENT_FLOOR);
  // A light fill takes gilt's stronger tints, a dark one the others'.
  const [soft, softer, ring] = on === INK ? [0.2, 0.1, 0.5] : [0.13, 0.07, 0.35];
  const light: AccentTokens = {
    accent: toHex(fill),
    accentDeep: toHex(deeper(fill, C, h, on)),
    accentSoft: rgba(fill, soft),
    accentSofter: rgba(fill, softer),
    accentRing: rgba(fill, ring),
    accentText: toHex(walk(L, C, h, -1, (rgb) => worst(rgb, DAY_SURFACES) >= ACCENT_FLOOR)),
    onAccent: on,
  };

  // At night the fill lifts, and carries near-black like every accent's.
  const night = walk(Math.max(L, NIGHT_LIGHTNESS), C, h, 1, (rgb) => contrast(rgb, NIGHT_INK) >= ACCENT_FLOOR);
  const [nightL] = toOklch(night);
  const dark: AccentTokens = {
    accent: toHex(night),
    accentDeep: toHex(deeper(night, C, h, NIGHT_INK)),
    accentSoft: rgba(night, 0.18),
    accentSofter: rgba(night, 0.09),
    accentRing: rgba(night, 0.4),
    accentText: toHex(walk(nightL, C, h, 1, (rgb) => worst(rgb, NIGHT_SURFACES) >= ACCENT_FLOOR)),
    onAccent: NIGHT_INK,
  };

  // Amber sits near 75° in OKLCH; orange and yellow are within reach of it.
  const warm = C >= 0.06 && h >= 45 && h <= 105;
  return { swatch: toHex(base), warm, light, dark };
}

/** The custom properties tokens.css reads under `data-accent="system"`, day then night. */
export function systemAccentProperties(accent: SystemAccent): [string, string][] {
  const scheme = (prefix: string, t: AccentTokens): [string, string][] => [
    [`--sys-${prefix}accent`, t.accent],
    [`--sys-${prefix}accent-deep`, t.accentDeep],
    [`--sys-${prefix}accent-soft`, t.accentSoft],
    [`--sys-${prefix}accent-softer`, t.accentSofter],
    [`--sys-${prefix}accent-ring`, t.accentRing],
    [`--sys-${prefix}accent-text`, t.accentText],
    [`--sys-${prefix}on-accent`, t.onAccent],
  ];
  return [...scheme("", accent.light), ...scheme("night-", accent.dark)];
}

const BLANK: AccentTokens = { accent: "", accentDeep: "", accentSoft: "", accentSofter: "", accentRing: "", accentText: "", onAccent: "" };
/** Every property applySystemAccent may set, to take them all off again. */
const PROPERTY_NAMES = systemAccentProperties({ swatch: "", warm: false, light: BLANK, dark: BLANK }).map(([name]) => name);

/** Where the last colour the Mac answered is kept, so the first frame is already right. */
const REMEMBERED = "proscenium:system-accent";

export function rememberedSystemAccent(): string | null {
  try {
    return localStorage.getItem(REMEMBERED);
  } catch {
    return null;
  }
}

/**
 * Put the Mac's colour on the document — or take it off, for null, which
 * leaves tokens.css's stand-in blue. It only shows while Follow Mac is the
 * accent: every property is read under `data-accent="system"`.
 */
export function applySystemAccent(hex: string | null): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const derived = hex ? deriveSystemAccent(hex) : null;
  try {
    if (derived) localStorage.setItem(REMEMBERED, derived.swatch);
    else localStorage.removeItem(REMEMBERED);
  } catch {
    /* no storage: the next launch asks again before painting its colour */
  }
  for (const name of PROPERTY_NAMES) root.style.removeProperty(name);
  delete root.dataset.accentWarm;
  if (!derived) return;
  for (const [name, value] of systemAccentProperties(derived)) root.style.setProperty(name, value);
  if (derived.warm) root.dataset.accentWarm = "true";
}
