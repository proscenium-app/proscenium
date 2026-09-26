// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * public/boot-theme.js makes applyAppearance's decision before the first frame,
 * in plain script. If the two ever disagreed, a launch would paint one scheme
 * and then switch to the other: the flash that script exists to remove.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { readMirror, SETTINGS_MIRROR_KEY } from "../storage/settings-model";
import { applyAppearance } from "./use-accent";

const BOOT = readFileSync(new URL("../../public/boot-theme.js", import.meta.url), "utf8");

/** Just enough of a page for both: the root's data attributes and colour scheme. */
function page(mirror: string | null, systemDark: boolean) {
  const dataset: Record<string, string> = {};
  const style: Record<string, string> = {};
  const documentElement = {
    dataset,
    style,
    setAttribute(name: string, value: string) {
      dataset[name.replace(/^data-/, "")] = value;
    },
  };
  const storage = {
    getItem: (key: string) => (key === SETTINGS_MIRROR_KEY ? mirror : null),
    setItem() {},
    removeItem() {},
  };
  const window = { matchMedia: () => ({ matches: systemDark }) };
  return { dataset, style, storage, window, document: { documentElement } };
}

function boot(mirror: string | null, systemDark: boolean) {
  const p = page(mirror, systemDark);
  new Function("window", "document", "localStorage", BOOT)(p.window, p.document, p.storage);
  return { theme: p.dataset.theme, appearance: p.dataset.appearance, scheme: p.style.colorScheme };
}

function app(mirror: string | null, systemDark: boolean) {
  const p = page(mirror, systemDark);
  const saved = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: p.window, document: p.document });
  try {
    applyAppearance(readMirror(p.storage).appearance);
  } finally {
    Object.assign(globalThis, saved);
  }
  return { theme: p.dataset.theme, appearance: p.dataset.appearance, scheme: p.style.colorScheme };
}

describe("the first frame's light or dark", () => {
  const mirrors: [string, string | null][] = [
    ["no mirror yet", null],
    ["a torn mirror", "{"],
    ["Follow Mac", JSON.stringify({ appearance: "system" })],
    ["Light", JSON.stringify({ appearance: "light" })],
    ["Dark", JSON.stringify({ appearance: "dark" })],
    ["a value from elsewhere", JSON.stringify({ appearance: "sepia" })],
  ];
  for (const [what, mirror] of mirrors) {
    for (const systemDark of [false, true]) {
      it(`is the app's, for ${what} on a Mac in ${systemDark ? "Dark" : "Light"} mode`, () => {
        expect(boot(mirror, systemDark)).toEqual(app(mirror, systemDark));
      });
    }
  }

  it("follows the Mac until the writer chooses", () => {
    expect(boot(null, true).theme).toBe("dark");
    expect(boot(null, false).theme).toBe("light");
    expect(boot(JSON.stringify({ appearance: "light" }), true).theme).toBe("light");
  });
});
