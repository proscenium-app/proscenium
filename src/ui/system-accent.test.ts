// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Follow Mac is held to the hand-picked accents' floors whatever the Mac
 * answers: every accent System Settings offers, and the colours at the ends of
 * the range, which no hand-tuning ever saw.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  ACCENT_FLOOR,
  DAY_SURFACES,
  NIGHT_SURFACES,
  contrast,
  deriveSystemAccent,
  parseHex,
  systemAccentProperties,
} from "./system-accent";

/** macOS's accent colours as AppKit resolves them in light appearance, and the extremes. */
const MAC_ACCENTS: Record<string, string> = {
  blue: "#007aff",
  purple: "#a550a7",
  pink: "#f74f9e",
  red: "#ff5257",
  orange: "#f7821b",
  yellow: "#ffc600",
  green: "#62ba46",
  graphite: "#8c8c8c",
  white: "#ffffff",
  black: "#000000",
  paleYellow: "#fff8c0",
  navy: "#0a1a40",
};

const worst = (text: string, surfaces: readonly string[]) => Math.min(...surfaces.map((s) => contrast(text, s)));
const rgbaColour = (value: string) => {
  const m = /^rgba\((\d+), (\d+), (\d+), (0?\.\d+)\)$/.exec(value);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] : null;
};

describe("Follow Mac's tokens", () => {
  for (const [name, hex] of Object.entries(MAC_ACCENTS)) {
    it(`keep every floor for ${name} (${hex})`, () => {
      const derived = deriveSystemAccent(hex)!;
      expect(derived.swatch).toBe(hex);
      for (const [scheme, tokens, surfaces] of [
        ["day", derived.light, DAY_SURFACES],
        ["night", derived.dark, NIGHT_SURFACES],
      ] as const) {
        for (const key of ["accent", "accentDeep", "accentText", "onAccent"] as const) {
          expect(parseHex(tokens[key]), `${scheme} ${key}`).not.toBeNull();
        }
        // Words on the fill, and on the fill under the pointer.
        expect(contrast(tokens.onAccent, tokens.accent), `${scheme} words on the fill`).toBeGreaterThanOrEqual(ACCENT_FLOOR);
        expect(contrast(tokens.onAccent, tokens.accentDeep), `${scheme} words on the pressed fill`).toBeGreaterThanOrEqual(ACCENT_FLOOR);
        // Accent text on every surface it sits on.
        expect(worst(tokens.accentText, surfaces), `${scheme} accent text`).toBeGreaterThanOrEqual(ACCENT_FLOOR);
        // The tints are the fill, thinned.
        for (const key of ["accentSoft", "accentSofter", "accentRing"] as const) {
          const tint = rgbaColour(tokens[key]);
          expect(tint, `${scheme} ${key}`).not.toBeNull();
          expect(tint!.slice(0, 3).map((c) => c.toString(16).padStart(2, "0")).join("")).toBe(tokens.accent.slice(1));
        }
      }
      // At night every accent's fill carries near-black, as the hand-picked four do.
      expect(derived.dark.onAccent).toBe("#1a1613");
    });
  }

  it("keeps a colour that already reads, as the Mac gave it", () => {
    // Navy reads under cream as it is, and its text reads on every day surface.
    const navy = deriveSystemAccent("#0a1a40")!;
    expect(navy.light.accent).toBe("#0a1a40");
    expect(navy.light.onAccent).toBe("#fcf8ef");
  });

  it("puts ink on a light accent and cream on a dark one, as gilt and the others do", () => {
    expect(deriveSystemAccent("#ffc600")!.light.onAccent).toBe("#1f2933");
    expect(deriveSystemAccent("#007aff")!.light.onAccent).toBe("#fcf8ef");
  });

  it("darkens a yellow accent's text toward bronze, never to grey", () => {
    const text = parseHex(deriveSystemAccent("#ffc600")!.light.accentText)!;
    const [r, g, b] = text;
    expect(r).toBeGreaterThan(b);
    expect(g).toBeGreaterThan(b);
  });

  it("flags orange and yellow as warm, and nothing else", () => {
    const warm = Object.entries(MAC_ACCENTS)
      .filter(([, hex]) => deriveSystemAccent(hex)!.warm)
      .map(([name]) => name);
    expect(warm.sort()).toEqual(["orange", "paleYellow", "yellow"]);
  });

  it("answers nothing for a colour that is not #rrggbb", () => {
    for (const bad of ["", "#fff", "blue", "#12345g", "rgb(0,0,0)"]) expect(deriveSystemAccent(bad)).toBeNull();
    expect(deriveSystemAccent("0a66e0")).not.toBeNull();
  });

  it("names the properties tokens.css defines and reads", () => {
    const css = readFileSync(new URL("../app/styles/tokens.css", import.meta.url), "utf8");
    const names = systemAccentProperties(deriveSystemAccent("#007aff")!).map(([name]) => name);
    expect(names).toHaveLength(14);
    for (const name of names) {
      expect(css, `${name} defined`).toMatch(new RegExp(`^\\s*${name}:`, "m"));
      expect(css, `${name} read`).toContain(`var(${name})`);
    }
  });
});
