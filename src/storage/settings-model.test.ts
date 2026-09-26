// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The frontend's copy of the settings model against the one that decides:
 * settings.rs. The shared facts (accent ids, the defaults) are read out
 * of the Rust source, as keymap.test.ts reads the editor's, so the two cannot
 * drift apart quietly. The patch cases repeat settings/tests.rs's expectations,
 * because an optimistic update that disagrees with the file flickers.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { ACCENTS } from "../ui/use-accent";
import {
  ACCENT_IDS,
  DEFAULT_PLAY_STATUSES,
  DEFAULT_SCENE_STATUSES,
  DEFAULT_SETTINGS,
  MAX_STATUSES,
  LEGACY_KEYS,
  SETTINGS_MIRROR_KEY,
  applyPatch,
  applyPatchToObject,
  clearLegacyKeys,
  legacyMigration,
  readMirror,
  readSettings,
  validatePatch,
  writeMirror,
  type KeyValueStorage,
  type SettingsPatch,
} from "./settings-model";

const rust = readFileSync(new URL("../../src-tauri/src/settings.rs", import.meta.url), "utf8");
const ipcSource = readFileSync(new URL("./ipc.ts", import.meta.url), "utf8");

function memoryStorage(seed: Record<string, string> = {}): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe("the model agrees with settings.rs", () => {
  it("has the same accent ids, in the same order", () => {
    const line = rust.match(/pub const ACCENTS: \[&str; \d+\] = \[([^\]]*)\]/);
    expect(line).not.toBeNull();
    const ids = [...line![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual([...ACCENT_IDS]);
  });

  it("names and colours every accent id, in that order", () => {
    expect(ACCENTS.map((a) => a.id)).toEqual([...ACCENT_IDS]);
  });

  it("has the same statuses, in the same order", () => {
    const line = rust.match(/pub const DEFAULT_PLAY_STATUSES: \[&str; \d+\] = \[([^\]]*)\]/);
    expect(line).not.toBeNull();
    const statuses = [...line![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(statuses).toEqual([...DEFAULT_PLAY_STATUSES]);
    expect(rust).toMatch(new RegExp(`const MAX_STATUSES: usize = ${MAX_STATUSES};`));
  });

  it("leaves the license's address to the allowlist, where every address lives", () => {
    // docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D2: the page names no address at all.
    expect(ipcSource).not.toMatch(/https?:\/\/[a-z0-9]/i);
    expect(rust).toContain("os_open(crate::telemetry::allowlist::LICENSE)");
    expect(rust).toContain("os_open(crate::telemetry::allowlist::SUPPORT)");
  });

  it("defaults to what the app did before each was a choice, launch aside", () => {
    expect(DEFAULT_SETTINGS).toEqual({
      accent: "gilt",
      appearance: "system",
      formatOrder: [],
      sceneStatuses: [...DEFAULT_SCENE_STATUSES],
      interfaceTextSize: 100,      runningTimeStrip: true,
      spellcheck: true,
      learnedWords: [],
      // The list VaultScreen.tsx held before docs/app/preferences-and-help/settings.md#SET-7, and Progress shown.
      playStatuses: ["idea", "outlining", "drafting", "revising", "workshop", "submitted", "produced", "shelved"],
      showProgress: true,
      // Where the writer left off (2026-09-16), not the Plays screen.
      openAtLaunch: "lastPlay",
      lastPlay: null,
      checkForUpdates: true,
      updateTrack: "stable",
      hasUpdateTrackKey: false,
      defaultFormat: null,
      shareAnalytics: true,
      privacyNoticeSeen: false,
    });
    // settings.rs spells the same defaults.
    expect(rust).toContain('const DEFAULT_ACCENT: &str = "gilt"');
    expect(rust).toMatch(/flag\("runningTimeStrip"\)\.unwrap_or\(true\)/);
    expect(rust).toMatch(/flag\("spellcheck"\)\.unwrap_or\(true\)/);
    expect(rust).toMatch(/flag\("checkForUpdates"\)\.unwrap_or\(true\)/);
    expect(rust).toMatch(/flag\("shareAnalytics"\)\.unwrap_or\(true\)/);
    expect(rust).toMatch(/flag\("privacyNoticeSeen"\)\.unwrap_or\(false\)/);
    expect(rust).toMatch(/#\[default\]\s*LastPlay,/);
    expect(rust).toMatch(/#\[default\]\s*Stable,/);
    expect(rust).toMatch(/flag\("showProgress"\)\.unwrap_or\(true\)/);
  });
});

describe("readSettings", () => {
  it("reads the file every installed copy has today", () => {
    const s = readSettings({
      lastVault: "/Users/writer/Plays",
      lastVaultBookmark: "Ym9va21hcms",
      learnedWords: ["Jonah", "Mara"],
      accent: "iris",
      appearance: "system",
      formatOrder: [],
      sceneStatuses: [...DEFAULT_SCENE_STATUSES],
      runningTimeStrip: false,
    });
    expect(s).toEqual({
      accent: "iris",
      appearance: "system",
      formatOrder: [],
      sceneStatuses: [...DEFAULT_SCENE_STATUSES],
      interfaceTextSize: 100,
      runningTimeStrip: false,
      spellcheck: true,
      learnedWords: ["Jonah", "Mara"],
      playStatuses: [...DEFAULT_PLAY_STATUSES],
      showProgress: true,
      openAtLaunch: "lastPlay",
      lastPlay: null,
      // Absent from every file written before updates existed: on.
      checkForUpdates: true,
      // And before tracks existed: stable, with no key for alpha.
      updateTrack: "stable",
      hasUpdateTrackKey: false,
      defaultFormat: null,
      // And before reports existed: on, with the notice still to be seen.
      shareAnalytics: true,
      privacyNoticeSeen: false,
    });
  });

  it("lets a wrong value cost only that preference", () => {
    const s = readSettings({
      accent: 42,
      runningTimeStrip: "yes",
      spellcheck: false,
      learnedWords: ["Mara", 7, null, "Jonah"],
      openAtLaunch: "somewhere",
      lastPlay: "\n",
      playStatuses: "drafting",
      showProgress: "no",
      updateTrack: "nightly",
    });
    expect(s).toEqual({ ...DEFAULT_SETTINGS, spellcheck: false, learnedWords: ["Mara", "Jonah"] });
    expect(readSettings(null)).toEqual({ ...DEFAULT_SETTINGS });
    expect(readSettings(["not", "an", "object"])).toEqual({ ...DEFAULT_SETTINGS });
  });
});

describe("alpha's key", () => {
  const key = "k".repeat(22) + "Ey_-0123456789abcdefg";
  it("is written by a patch, and read back only as whether there is one", () => {
    expect(validatePatch({ updateTrackKey: key })).toBeNull();
    const file = applyPatchToObject({ updateTrack: "alpha" }, { updateTrackKey: key });
    expect(file.updateTrackKey).toBe(key);
    const s = readSettings(file);
    expect(s.hasUpdateTrackKey).toBe(true);
    expect(JSON.stringify(s)).not.toContain(key);
    // An optimistic update keeps it, as settings.rs's answer would.
    expect(applyPatch(s, { updateTrack: "beta" }).hasUpdateTrackKey).toBe(true);
  });
  it("refuses what settings.rs refuses", () => {
    for (const bad of ["", key.slice(1), `${key}=`, key.replace(/k/g, "+"), 7, null]) {
      expect(validatePatch({ updateTrackKey: bad } as unknown as SettingsPatch)).not.toBeNull();
    }
    expect(readSettings({ updateTrack: "alpha", updateTrackKey: "short" }).hasUpdateTrackKey).toBe(false);
    // settings.rs reads the same key, in the same shape.
    expect(rust).toContain('const UPDATE_TRACK_KEY: &str = "updateTrackKey"');
    expect(rust).toContain("key.len() == 43 && key.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')");
  });
});

describe("the status list", () => {
  it("reads what it can use: order kept, blanks and repeats dropped, an emptied list empty", () => {
    const s = readSettings({ playStatuses: ["drafting", "", 7, " padded ", "Drafting", "in rehearsal", "idea"] });
    expect(s.playStatuses).toEqual(["drafting", "in rehearsal", "idea"]);
    expect(readSettings({ playStatuses: [] }).playStatuses).toEqual([]);
    expect(readSettings({}).playStatuses).toEqual([...DEFAULT_PLAY_STATUSES]);
  });

  it("is patched whole, and refused whole when any of it is wrong", () => {
    expect(validatePatch({ playStatuses: ["in rehearsal", "idea"], showProgress: false })).toBeNull();
    expect(validatePatch({ playStatuses: [] })).toBeNull();
    const bad = [
      ["idea", "Idea"],
      ["idea", ""],
      [" idea"],
      ["x".repeat(41)],
      ["tab\there"],
      Array.from({ length: MAX_STATUSES + 1 }, (_, i) => `status ${i}`),
      "idea",
    ];
    for (const playStatuses of bad) {
      expect(validatePatch({ playStatuses } as unknown as SettingsPatch)).not.toBeNull();
    }
    expect(validatePatch({ showProgress: "off" } as unknown as SettingsPatch)).not.toBeNull();
  });

  it("applies as the whole list, in the order given", () => {
    const next = applyPatch(DEFAULT_SETTINGS, { playStatuses: ["revising", "idea"] });
    expect(next.playStatuses).toEqual(["revising", "idea"]);
    expect(applyPatch(next, { showProgress: false }).playStatuses).toEqual(["revising", "idea"]);
  });
});

describe("validatePatch", () => {
  it("accepts every well-formed field", () => {
    expect(
      validatePatch({
        accent: "velvet",
        runningTimeStrip: false,
        spellcheck: true,
        openAtLaunch: "lastPlay",
        lastPlay: "The Weight of Water",
        learnedWords: { add: ["Ophelia"], remove: ["Hedda"] },
        updateTrack: "alpha",
      }),
    ).toBeNull();
    // Back on the Plays screen: nothing to go back into.
    expect(validatePatch({ openAtLaunch: "plays", lastPlay: null })).toBeNull();
  });

  it("refuses what settings.rs refuses", () => {
    const bad = [
      { accent: "chartreuse" },
      { lastVault: "/tmp/elsewhere" },
      { accnet: "iris" },
      { spellcheck: "no" },
      { openAtLaunch: "lastScene" },
      { updateTrack: "nightly" },
      { updateTrack: "Alpha" },
      { lastPlay: "  " },
      { lastPlay: "The Lighthouse\u0000" },
      { learnedWords: { add: ["   "] } },
      { learnedWords: { add: ["x".repeat(101)] } },
      { learnedWords: { set: ["x"] } },
    ] as unknown as SettingsPatch[];
    for (const patch of bad) expect(validatePatch(patch)).not.toBeNull();
  });
});

describe("applying a patch", () => {
  it("leaves the vault, its bookmark and unknown keys alone", () => {
    const file = {
      lastVault: "/Users/writer/Plays",
      lastVaultBookmark: "Ym9va21hcms".repeat(100),
      telemetry: { enabled: false },
      accent: "iris",
      appearance: "system",
      formatOrder: [],
      sceneStatuses: [...DEFAULT_SCENE_STATUSES],
    };
    const next = applyPatchToObject(file, { accent: "velvet", spellcheck: false });
    expect(next).toEqual({ ...file, accent: "velvet", spellcheck: false });
    expect(file.accent).toBe("iris"); // the input is not mutated
  });

  it("changes the dictionary by word, exactly as settings.rs does", () => {
    let s = { ...DEFAULT_SETTINGS, learnedWords: ["Jonah", "Mara", "Vronsky"] };
    s = applyPatch(s, { learnedWords: { add: ["  Ophelia ", "vronsky", "anouilh"] } });
    expect(s.learnedWords).toEqual(["anouilh", "Jonah", "Mara", "Ophelia", "Vronsky"]);
    s = applyPatch(s, { learnedWords: { remove: ["MARA"] } });
    expect(s.learnedWords).toEqual(["anouilh", "Jonah", "Ophelia", "Vronsky"]);
    s = applyPatch(s, { learnedWords: { add: ["Hedda"], remove: ["hedda"] } });
    expect(s.learnedWords).not.toContain("Hedda");
    const once = applyPatch(s, { learnedWords: { add: ["Éponine"] } });
    expect(applyPatch(once, { learnedWords: { add: ["éponine"] } }).learnedWords).toEqual(
      once.learnedWords,
    );
  });

  it("removes an emptied dictionary's key", () => {
    const next = applyPatchToObject({ learnedWords: ["Mara"] }, { learnedWords: { remove: ["mara"] } });
    expect("learnedWords" in next).toBe(false);
  });

  it("clears the last play when the writer goes back to the Plays screen", () => {
    const file = { lastVault: "/Users/writer/Plays", lastPlay: "01KYFQCPT4C7J7D6VPZPJMSSJ5" };
    expect(applyPatchToObject(file, { spellcheck: false }).lastPlay).toBe(file.lastPlay);
    const next = applyPatchToObject(file, { lastPlay: null });
    expect("lastPlay" in next).toBe(false);
    expect(next.lastVault).toBe(file.lastVault);
    expect(applyPatch(readSettings(file), { lastPlay: null }).lastPlay).toBeNull();
  });
});

describe("the first-frame mirror", () => {
  it("prefers the mirror, then the pre-model keys, then the defaults", () => {
    expect(readMirror(null)).toEqual({ ...DEFAULT_SETTINGS });
    const legacy = memoryStorage({
      [LEGACY_KEYS.accent]: "velvet",
      [LEGACY_KEYS.runningTimeStrip]: "0",
      [LEGACY_KEYS.spellcheck]: "0",
    });
    expect(readMirror(legacy)).toMatchObject({ accent: "velvet", runningTimeStrip: false, spellcheck: false });
    writeMirror(legacy, { ...DEFAULT_SETTINGS, accent: "iris" });
    expect(readMirror(legacy).accent).toBe("iris");
    legacy.setItem(SETTINGS_MIRROR_KEY, "{ torn");
    expect(readMirror(legacy)).toMatchObject({ accent: "velvet", spellcheck: false });
  });

  it("carries over only what settings.json never got", () => {
    const off = memoryStorage({ [LEGACY_KEYS.spellcheck]: "0", [LEGACY_KEYS.accent]: "iris" });
    // Spell check's toggle lived only in localStorage: it must reach the file.
    expect(legacyMigration(off, { ...DEFAULT_SETTINGS })).toEqual({ spellcheck: false, accent: "iris" });
    // An explicit choice in settings.json wins over a mirror.
    expect(legacyMigration(off, { ...DEFAULT_SETTINGS, accent: "velvet", spellcheck: false })).toBeNull();
    // A legacy value that IS the default carries nothing.
    expect(legacyMigration(memoryStorage({ [LEGACY_KEYS.spellcheck]: "1" }), { ...DEFAULT_SETTINGS })).toBeNull();
    expect(legacyMigration(null, { ...DEFAULT_SETTINGS })).toBeNull();
    clearLegacyKeys(off);
    expect(off.data.size).toBe(0);
  });
});

describe("the default format for new plays", () => {
  it("is set by id, cleared by null, and refused when it is not an id", () => {
    const set = applyPatch({ ...DEFAULT_SETTINGS }, { defaultFormat: "my-house" });
    expect(set.defaultFormat).toBe("my-house");
    const cleared = applyPatchToObject({ defaultFormat: "my-house", accent: "iris" }, { defaultFormat: null });
    expect(cleared).toEqual({ accent: "iris" });
    expect(validatePatch({ defaultFormat: null })).toBeNull();
    expect(validatePatch({ defaultFormat: "My House" })).not.toBeNull();
    expect(validatePatch({ defaultFormat: "../x" })).not.toBeNull();
    expect(readSettings({ defaultFormat: 7 }).defaultFormat).toBeNull();
  });
});

describe("the reports switch", () => {
  it("is on until switched off, and takes only true or false", () => {
    expect(readSettings({}).shareAnalytics).toBe(true);
    expect(applyPatch({ ...DEFAULT_SETTINGS }, { shareAnalytics: false }).shareAnalytics).toBe(false);
    expect(applyPatch({ ...DEFAULT_SETTINGS }, { privacyNoticeSeen: true }).privacyNoticeSeen).toBe(true);
    expect(validatePatch({ shareAnalytics: false, privacyNoticeSeen: true })).toBeNull();
    expect(validatePatch({ shareAnalytics: "no" } as unknown as SettingsPatch)).not.toBeNull();
    expect(readSettings({ shareAnalytics: "off" }).shareAnalytics).toBe(true);
  });
});

it("docs/app/preferences-and-help/accessibility.md#A11Y-2: interface text size persists through 200 percent and rejects unusable scales", () => {
  for (const size of [100, 125, 150, 175, 200]) {
    expect(validatePatch({ interfaceTextSize: size })).toBeNull();
    expect(readSettings(applyPatchToObject({}, { interfaceTextSize: size })).interfaceTextSize).toBe(size);
  }
  for (const size of [0, 99, 201, 150.5, NaN, Infinity]) {
    expect(validatePatch({ interfaceTextSize: size })).not.toBeNull();
    expect(readSettings({ interfaceTextSize: size }).interfaceTextSize).toBe(100);
  }
});

it("persists appearance, ordered formats and the writer's scene statuses", () => {
  const patch: SettingsPatch = { appearance: "dark", formatOrder: ["stage-us-modern", "dg-modern"],
    sceneStatuses: ["sketch", "needs a read", "ready"] };
  expect(validatePatch(patch)).toBeNull();
  expect(readSettings(applyPatchToObject({}, patch))).toMatchObject(patch);
  expect(readSettings({ appearance: "unknown", formatOrder: ["bad/id", "dg-modern", "dg-modern"] }))
    .toMatchObject({ appearance: "system", formatOrder: ["dg-modern"] });
  expect(validatePatch({ sceneStatuses: ["draft", "DRAFT"] })).not.toBeNull();
  expect(validatePatch({ formatOrder: ["dg-modern", "dg-modern"] })).not.toBeNull();
});
