// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Every key the app shows, and every chord it binds, as this system has them
 * (docs/engineering/cross-platform.md#PLAT-35, docs/app/preferences-and-help/settings.md#SET-11).
 *
 * Shortcuts are written once, in a Mac's glyphs (`⌘⇧E`), in the shortcut table
 * (app/keymap.ts) and wherever a hint names a key. On a Mac they are shown as
 * written. On a PC each is first moved to the PC's chord, then written in
 * words (`Ctrl+Shift+E`). How a system writes them is the capability record's
 * `keys`, which the page is given at boot: no component asks which system it
 * is on.
 *
 * WHERE A PC'S CHORD DIFFERS. ⌘ is Ctrl. No chord uses Ctrl+Alt, because on
 * many keyboards AltGr is Ctrl+Alt and types characters; and none uses the
 * Windows key, which ⌘ would otherwise be and Windows keeps. So a Mac's ⌘⌥ is
 * a PC's Ctrl+Shift, and where that is a chord already, Windows' own
 * convention takes its place: Find and Replace is Ctrl+H, the previous and
 * next scene Ctrl+PageUp and Ctrl+PageDown.
 */

export type KeyStyle = "mac" | "pc";

let style: KeyStyle = "mac";

/** From the capability record, once, before the first render (main.tsx). */
export function setKeyStyle(next: KeyStyle): void {
  style = next;
}

export function keyStyle(): KeyStyle {
  return style;
}

/** A Mac chord's PC form, in the Mac's notation, where they differ. */
export const PC_CHORDS: Readonly<Record<string, string>> = {
  // The elements: ⌥ becomes ⇧.
  "⌘⌥1": "⌘⇧1",
  "⌘⌥2": "⌘⇧2",
  "⌘⌥S": "⌘⇧S",
  "⌘⌥A": "⌘⇧A",
  "⌘⌥C": "⌘⇧C",
  "⌘⌥D": "⌘⇧D",
  "⌘⌥P": "⌘⇧P",
  "⌘⌥T": "⌘⇧T",
  "⌘⌥L": "⌘⇧L",
  // Comments: Ctrl+Shift+C is Character's, so the pair moves to M.
  "⌘⌥M": "⌘M",
  "⌘⇧C": "⌘⇧M",
  // Windows' own conventions.
  "⌘⌥F": "⌘H",
  "⌥⌘↑": "⌘PageUp",
  "⌥⌘↓": "⌘PageDown",
  // Panels.
  "⌘⌥B": "⌘⇧B",
  "⌘⌥I": "⌘⇧I",
  // Ctrl+Win+arrows switches Windows' desktops.
  "⌃⌘↑": "⌘⇧↑",
  "⌃⌘↓": "⌘⇧↓",
  "⌃⌘←": "⌘⇧←",
  "⌃⌘→": "⌘⇧→",
  "⌃⌘F": "⌘⇧F",
  // The elements' modifiers, said alone ("⌘⌥ chords work anywhere").
  "⌘⌥": "⌘⇧",
  // Move to Trash: Windows' Delete, which the binder takes as it is.
  "⌘⌫": "⌦",
};

/** This system's chord for a Mac chord, in the Mac's notation. */
export function chord(mac: string): string {
  return style === "pc" ? (PC_CHORDS[mac] ?? mac) : mac;
}

const MODIFIERS = "⌃⌥⇧⌘";

/** A chord's modifiers and its key: `⌥⌘↑` is `{ mods: "⌥⌘", key: "↑" }`. */
function split(c: string): { mods: string; key: string } {
  let i = 0;
  while (i < c.length && MODIFIERS.includes(c[i] as string)) i++;
  return { mods: c.slice(0, i), key: c.slice(i) };
}

const PC_KEY: Readonly<Record<string, string>> = {
  "⏎": "Enter",
  Return: "Enter",
  "⇥": "Tab",
  "⌫": "Backspace",
  "⌦": "Delete",
  esc: "Esc",
  "⎋": "Esc",
};

/**
 * A key cap as this system draws it, for a key the tutorials name by word
 * (`Return`, `⌘Return`): a Mac's with its glyph, a PC's in words.
 */
export function keyCap(key: string): string {
  if (style === "mac") return MAC_CAPS[key] ?? key;
  return PC_CAPS[key] ?? keys(key.replace("Return", "⏎"));
}

const MAC_CAPS: Readonly<Record<string, string>> = {
  Return: "⏎ Return",
  Tab: "⇥ Tab",
  Escape: "esc",
  "⇧Return": "⇧⏎",
  "⌘Return": "⌘⏎",
  Shift: "⇧ Shift",
};

const PC_CAPS: Readonly<Record<string, string>> = {
  Return: "Enter",
  Tab: "Tab",
  Escape: "Esc",
  Shift: "Shift",
};

/** One chord in a PC's words, modifiers in Windows' order: Ctrl, Alt, Shift. */
function pcWords(c: string): string {
  const { mods, key } = split(c);
  const names = [
    mods.includes("⌘") || mods.includes("⌃") ? "Ctrl" : null,
    mods.includes("⌥") ? "Alt" : null,
    mods.includes("⇧") ? "Shift" : null,
  ].filter(Boolean);
  // `⏎⏎` is Enter twice, not a chord; a bare modifier ("hold ⌘") is its name.
  const shown = key === "⏎⏎" ? "Enter Enter" : (PC_KEY[key] ?? key);
  return [...names, shown].filter(Boolean).join("+");
}

/**
 * A shortcut as this system writes it. A Mac's is shown as written; a PC's is
 * moved to its chord and written in words. Alternatives separated by ` / `
 * are each written so.
 */
export function keys(mac: string): string {
  if (style === "mac") return mac;
  return mac
    .split(" / ")
    .map((c) => pcWords(PC_CHORDS[c] ?? c))
    .join(" / ");
}

const BINDING_KEY: Readonly<Record<string, string>> = {
  "⏎": "Enter",
  "⇥": "Tab",
  "⌫": "Backspace",
  "↑": "ArrowUp",
  "↓": "ArrowDown",
  "←": "ArrowLeft",
  "→": "ArrowRight",
};

/**
 * This system's chord for a Mac chord, as an editor keymap binds it
 * (`Mod-Alt-c`): ⌘ is `Mod`, which ProseMirror reads as Ctrl off a Mac.
 */
export function binding(mac: string): string {
  const { mods, key } = split(chord(mac));
  const parts = [
    mods.includes("⌘") ? "Mod" : null,
    mods.includes("⌃") ? "Ctrl" : null,
    mods.includes("⌥") ? "Alt" : null,
    mods.includes("⇧") ? "Shift" : null,
  ].filter(Boolean);
  const name = BINDING_KEY[key] ?? (key.length === 1 ? key.toLowerCase() : key);
  return [...parts, name].join("-");
}

/**
 * Whether ⌘ is held as this system has it: Command on a Mac, Ctrl on a PC
 * (and not the Windows key, which is never part of a chord there).
 */
export function commandKey(e: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return style === "pc" ? e.ctrlKey && !e.metaKey : e.metaKey;
}

const EVENT_KEY: Readonly<Record<string, string>> = {
  "⏎": "Enter",
  "⇥": "Tab",
  "⌫": "Backspace",
  "↑": "ArrowUp",
  "↓": "ArrowDown",
  "←": "ArrowLeft",
  "→": "ArrowRight",
};

/**
 * Whether a key event is this system's chord for a Mac chord, every modifier
 * exactly. On a Mac, ⌘ is Command and ⌃ is Control. On a PC, ⌘ is Ctrl alone:
 * the Windows key is never part of a chord.
 */
export function pressed(
  e: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "key" | "code">,
  mac: string,
): boolean {
  const { mods, key } = split(chord(mac));
  const [ctrl, meta] =
    style === "pc"
      ? [mods.includes("⌘") || mods.includes("⌃"), false]
      : [mods.includes("⌃"), mods.includes("⌘")];
  if (e.ctrlKey !== ctrl || e.metaKey !== meta) return false;
  if (e.altKey !== mods.includes("⌥") || e.shiftKey !== mods.includes("⇧")) return false;
  const want = EVENT_KEY[key] ?? key;
  if (want.length === 1) {
    // A letter or digit by its place on the keyboard, so Shift's character
    // (`!` for 1) and a layout's own letters still match.
    const code = /^[A-Z]$/i.test(want)
      ? `Key${want.toUpperCase()}`
      : /^[0-9]$/.test(want)
        ? `Digit${want}`
        : null;
    return (code !== null && e.code === code) || e.key.toLowerCase() === want.toLowerCase();
  }
  return e.key === want;
}

/**
 * This system's chord for a Mac chord, as `aria-keyshortcuts` says it
 * (`Meta+Alt+C`, `Control+Shift+C`).
 */
export function ariaKeys(mac: string): string {
  return mac
    .split(" / ")
    .map((c) => {
      const { mods, key } = split(chord(c));
      // Control, Alt, Shift, then Meta, as the Mac's own attributes have them.
      const pcCtrl = style === "pc" && mods.includes("⌘");
      const names = [
        mods.includes("⌃") || pcCtrl ? "Control" : null,
        mods.includes("⌥") ? "Alt" : null,
        mods.includes("⇧") ? "Shift" : null,
        mods.includes("⌘") && !pcCtrl ? "Meta" : null,
      ].filter(Boolean);
      // A letter as the Mac's own attributes write it, lower case.
      const name = EVENT_KEY[key] ?? (key.length === 1 ? key.toLowerCase() : key);
      return [...names, name].join("+");
    })
    .join(" ");
}
