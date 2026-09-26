// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The accents (docs/engineering/design-system.md#UI-D102): their names and swatches, and the first
 * paint.
 *
 * Seven CSS tokens describe every accent use in the app, and `data-accent` on
 * the document element says which set of seven is live. There is no colour
 * anywhere else in the stylesheet, so the whole app recolours in one paint —
 * including menus and toasts, which is why the attribute goes on `:root` rather
 * than on `.app-shell`: they render through a portal.
 *
 * **Gilt is the default** — theatre's own gold, and the only candidate that
 * reads as *this* theatre before a word is read. It is also the only one whose
 * fills carry ink text: gold on cream is 2.3:1, so exactly like macOS's Yellow
 * accent it splits into a fill (ink on gilt, 6.1:1) and a text colour (bronze
 * on paper, 5.1:1). The other four set `--accent-text = --accent`.
 *
 * The preference itself is a setting like any other (settings.json, through
 * `src/app/settings/store.ts`, which keeps `data-accent` in step). This file
 * only has to get the FIRST frame right, before any of that has run.
 */
import { readMirror, browserStorage, type AccentId, type Appearance } from "../storage/settings-model";
import { applySystemAccent, rememberedSystemAccent } from "./system-accent";

export type { AccentId };

/*
 * The swatch and its name are the whole description: a colour needs no
 * sentence. Each accent used to carry one ("the house curtain", "the most
 * “writing” of the set"), and the last said System followed macOS, which it
 * never did: `system` was one fixed blue in tokens.css. It follows the Mac now
 * (accent.rs, ui/system-accent.ts) and is called Follow Mac, as the light and
 * dark choice is; the id stays, so a writer who chose it keeps it. Its swatch
 * here is the stand-in blue: Settings draws the Mac's own colour.
 */
export const ACCENTS = [
  { id: "gilt", name: "Gilt", swatch: "#c9a227" },
  { id: "velvet", name: "Velvet", swatch: "#7a3b6a" },
  { id: "inkblue", name: "Ink", swatch: "#34508c" },
  { id: "iris", name: "Iris", swatch: "#5b4e9e" },
  { id: "system", name: "Follow Mac", swatch: "#0a66e0" },
] as const satisfies readonly { id: AccentId; name: string; swatch: string }[];

export const DEFAULT_ACCENT: AccentId = "gilt";

/**
 * Applied before React mounts, so the first paint is never the wrong colour —
 * a frame of the wrong accent is the kind of flash you see once and then cannot
 * stop seeing. Reads the settings mirror (or the pre-model accent key, on the
 * first launch after the upgrade); settings.json corrects it moments later if
 * the two ever disagree.
 */
export function applyStoredAccent(): void {
  const settings = readMirror(browserStorage());
  document.documentElement.dataset.accent = settings.accent;
  // The Mac's accent as it last answered, for Follow Mac; asked again at once (main.tsx).
  applySystemAccent(rememberedSystemAccent());
  applyAppearance(settings.appearance);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (document.documentElement.dataset.appearance === "system") applyAppearance("system");
  });
  applyInterfaceTextSize(settings.interfaceTextSize);
}

export function applyAppearance(appearance: Appearance): void {
  if (typeof document === "undefined") return;
  const dark = appearance === "dark" || (appearance === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.appearance = appearance;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

/** Shared tokens reach every portal while leaving the writing format alone. */
export function applyInterfaceTextSize(percent: number): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--ui-scale", String(percent / 100));
  document.documentElement.dataset.largeText = String(percent > 100);
}
