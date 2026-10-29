// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ariaKeys, binding, chord, keys, PC_CHORDS, pressed, setKeyStyle } from "./keys";

const press = (init: KeyboardEventInit & { code?: string }) =>
  ({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init }) as KeyboardEvent;

afterEach(() => setKeyStyle("mac"));

describe("a Mac's keys (docs/app/preferences-and-help/settings.md#SET-11)", () => {
  test("are shown and bound as they are written", () => {
    expect(keys("⌘⌥C")).toBe("⌘⌥C");
    expect(keys("⌘+ / ⌘−")).toBe("⌘+ / ⌘−");
    expect(chord("⌥⌘↑")).toBe("⌥⌘↑");
    expect(binding("⌘⌥C")).toBe("Mod-Alt-c");
    expect(binding("⌘⏎")).toBe("Mod-Enter");
    expect(ariaKeys("⌘⌥B")).toBe("Alt+Meta+b");
    expect(ariaKeys("⌘B")).toBe("Meta+b");
    expect(ariaKeys("⌃⌘↑ / ⌃⌘↓")).toBe("Control+Meta+ArrowUp Control+Meta+ArrowDown");
  });
});

describe("a PC's keys", () => {
  test("are written in words, Ctrl, Alt, Shift, then the key", () => {
    setKeyStyle("pc");
    expect(keys("⌘⇧E")).toBe("Ctrl+Shift+E");
    expect(keys("⌘B")).toBe("Ctrl+B");
    expect(keys("⇧⏎")).toBe("Shift+Enter");
    expect(keys("⌃⇥ / ⌃⇧⇥")).toBe("Ctrl+Tab / Ctrl+Shift+Tab");
    expect(keys("⌘+ / ⌘−")).toBe("Ctrl++ / Ctrl+−");
    expect(keys("⏎⏎")).toBe("Enter Enter");
    expect(keys("⇧F10")).toBe("Shift+F10");
    expect(keys("⌘")).toBe("Ctrl");
    expect(ariaKeys("⌘⌥B")).toBe("Control+Shift+b");
  });

  test("never use Ctrl+Alt, which is AltGr, or the Windows key", () => {
    setKeyStyle("pc");
    expect(keys("⌘⌥C")).toBe("Ctrl+Shift+C");
    expect(keys("⌘⌥F")).toBe("Ctrl+H");
    expect(keys("⌥⌘↑")).toBe("Ctrl+PageUp");
    expect(keys("⌃⌘↓")).toBe("Ctrl+Shift+↓");
    for (const pc of Object.values(PC_CHORDS)) {
      const shown = keys(pc);
      expect(shown.includes("Ctrl") && shown.includes("Alt")).toBe(false);
    }
  });

  test("no two Mac chords become one PC chord", () => {
    setKeyStyle("pc");
    const macChords = [
      ...Object.keys(PC_CHORDS),
      // The Mac chords the moved ones would land on, kept as they are.
      "⌘⇧E",
      "⌘⇧J",
      "⌘⇧O",
      "⌘⇧Z",
      // ⌘H and ⌘M are a Mac's Hide and Minimize, its own menu's; a PC's menu
      // has neither, so Ctrl+H and Ctrl+M are free there.
      "⌘P",
    ];
    const seen = new Map<string, string>();
    for (const mac of macChords) {
      const pc = chord(mac);
      expect(seen.get(pc) ?? mac).toBe(mac);
      seen.set(pc, mac);
    }
  });

  test("bind and match the PC's chord", () => {
    setKeyStyle("pc");
    expect(binding("⌘⌥C")).toBe("Mod-Shift-c");
    expect(binding("⌘⌥M")).toBe("Mod-m");
    expect(binding("⌘⌥F")).toBe("Mod-h");
    expect(pressed(press({ ctrlKey: true, shiftKey: true, key: "C", code: "KeyC" }), "⌘⌥C")).toBe(
      true,
    );
    // The Windows key is never part of a chord, and Ctrl+Alt is AltGr.
    expect(
      pressed(
        press({ ctrlKey: true, metaKey: true, shiftKey: true, key: "C", code: "KeyC" }),
        "⌘⌥C",
      ),
    ).toBe(false);
    expect(pressed(press({ ctrlKey: true, altKey: true, key: "c", code: "KeyC" }), "⌘⌥C")).toBe(
      false,
    );
    expect(pressed(press({ ctrlKey: true, key: "PageUp" }), "⌥⌘↑")).toBe(true);
    // A digit by its place: Shift+1 types "!".
    expect(pressed(press({ ctrlKey: true, shiftKey: true, key: "!", code: "Digit1" }), "⌘⌥1")).toBe(
      true,
    );
  });
});

describe("a sentence for this system", () => {
  test("is a Mac's as written, and a PC's in its own words", async () => {
    const { forThisSystem, setSystemWords } = await import("./system-words");
    const mac =
      "Bold, Italic and Underline are also ⌘B, ⌘I and ⌘U. ⌘Return is the shortcut. Shift–Return too; Return ends it.";
    expect(forThisSystem(mac)).toBe(mac);
    setKeyStyle("pc");
    setSystemWords({
      machine: "PC",
      system: "Windows",
      fileManager: "File Explorer",
      trash: "Recycle Bin",
    });
    expect(forThisSystem(mac)).toBe(
      "Bold, Italic and Underline are also Ctrl+B, Ctrl+I and Ctrl+U. Ctrl+Enter is the shortcut. Shift–Enter too; Enter ends it.",
    );
    expect(forThisSystem("Every practice play is kept on this Mac.")).toBe(
      "Every practice play is kept on this PC.",
    );
    setSystemWords({ machine: "Mac", system: "macOS", fileManager: "Finder", trash: "Trash" });
  });
});

describe("Windows' menu bar (src-tauri/src/menu.rs)", () => {
  const menuRs = readFileSync(new URL("../../src-tauri/src/menu.rs", import.meta.url), "utf8");
  /** Every item with a Mac accelerator, as `[id, glyphs]`. */
  const macItems = [...menuRs.matchAll(/\("([\w-]+)", "[^"]*", Some\("([^"]+)"\)\)/g)].map(
    ([, id, accel]) => [id as string, glyphs(accel as string)] as const,
  );
  const pcBlock = /pub const PC_KEYS[^=]*= &\[([\s\S]*?)\n\];/.exec(menuRs)?.[1] ?? "";
  const pcKeys = new Map(
    [...pcBlock.matchAll(/\("([\w-]+)", "([^"]+)"\)/g)].map(([, id, k]) => [id, k] as const),
  );

  test("shows each item's chord as the page writes it on a PC, and binds no two alike", () => {
    setKeyStyle("pc");
    expect(macItems.length).toBeGreaterThan(30);
    for (const [id, mac] of macItems) {
      // Import a Draft has no chord on a PC: Ctrl+Shift+I is the Inspector's.
      const want = id === "import-draft" ? undefined : keys(inTable(mac));
      expect([id, pcKeys.get(id)]).toEqual([id, want]);
    }
    const shown = [...pcKeys.values()];
    expect(new Set(shown).size).toBe(shown.length);
    expect(shown.some((k) => /Ctrl\+Alt|Alt\+/.test(k))).toBe(false);
  });
});

/** A menu accelerator (`CmdOrCtrl+Alt+1`) in a Mac's glyphs (`⌘⌥1`). */
function glyphs(accel: string): string {
  const MOD: Record<string, string> = { CmdOrCtrl: "⌘", Cmd: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧" };
  const KEY: Record<string, string> = { Up: "↑", Down: "↓", Enter: "⏎", Plus: "+" };
  const parts = accel.split("+");
  const key = parts.pop() as string;
  return parts.map((p) => MOD[p] ?? p).join("") + (KEY[key] ?? key);
}

/** The chord as the table spells it, whichever order its modifiers are in. */
function inTable(mac: string): string {
  const mods = [...mac].filter((c) => "⌃⌥⇧⌘".includes(c));
  const key = [...mac].filter((c) => !"⌃⌥⇧⌘".includes(c)).join("");
  const spellings = [mods.join(""), [...mods].reverse().join("")].map((m) => m + key);
  return spellings.find((s) => s in PC_CHORDS) ?? mac;
}

describe("a Mac's chord, pressed", () => {
  test("is Command for ⌘ and Control for ⌃, each exactly", () => {
    expect(pressed(press({ metaKey: true, key: "b", code: "KeyB" }), "⌘B")).toBe(true);
    expect(pressed(press({ ctrlKey: true, key: "b", code: "KeyB" }), "⌘B")).toBe(false);
    expect(pressed(press({ ctrlKey: true, metaKey: true, key: "ArrowUp" }), "⌃⌘↑")).toBe(true);
    expect(pressed(press({ metaKey: true, key: "ArrowUp" }), "⌃⌘↑")).toBe(false);
  });
});
