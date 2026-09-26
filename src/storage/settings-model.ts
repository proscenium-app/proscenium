// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The settings model (docs/app/preferences-and-help/settings.md#SET-D100, Part A), shared by the
 * IPC client, the in-memory dev vault and the app's settings store.
 *
 * `src-tauri/src/settings.rs` is the authority: it validates a patch, writes it
 * atomically and answers with what it stored. This mirrors its shape and its
 * patch rules for the readers that cannot wait for it — the first frame of a
 * launch, painted from a localStorage mirror before IPC answers, and an
 * optimistic update, where a switch flips when it is clicked rather than one
 * fsync later — and for the dev vault, which has no Rust behind it.
 *
 * **Adding a preference:** a field on `Settings`, its default and its line in
 * `readSettings`, a field on `SettingsPatch` (and a rule in `validatePatch` if
 * the type is not enough) — and the same in settings.rs.
 */

/** In the order Settings shows them. settings-model.test.ts holds this to settings.rs. */
export const ACCENT_IDS = ["gilt", "velvet", "inkblue", "iris", "system"] as const;
export type AccentId = (typeof ACCENT_IDS)[number];

/** What the app shows when it opens: the Plays screen, or the last play. */
export type OpenAtLaunch = "plays" | "lastPlay";
/** Where updates come from (docs/app/preferences-and-help/settings.md#SET-37), slowest first. */
export const UPDATE_TRACKS = ["stable", "beta", "alpha"] as const;
export type UpdateTrack = (typeof UPDATE_TRACKS)[number];
export const isUpdateTrack = (v: unknown): v is UpdateTrack => (UPDATE_TRACKS as readonly unknown[]).includes(v);
/**
 * Alpha's key, as scripts/track-key.mjs makes it: 32 random bytes, base64url,
 * unpadded (docs/app/preferences-and-help/settings.md#SET-37). settings.rs holds the same shape.
 */
export const isUpdateTrackKey = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{43}$/.test(v);
export type Appearance = "system" | "light" | "dark";
export const DEFAULT_SCENE_STATUSES = ["idea", "drafting", "revising", "ready for reading"];

/**
 * The statuses a play can carry on the Plays screen, in order: the list that
 * was fixed in VaultScreen.tsx until docs/app/preferences-and-help/settings.md#SET-7 moved it here.
 * settings-model.test.ts holds this to settings.rs.
 */
export const DEFAULT_PLAY_STATUSES = [
  "idea",
  "outlining",
  "drafting",
  "revising",
  "workshop",
  "submitted",
  "produced",
  "shelved",
] as const;
/** Longer than any workflow word; past it, a status is a sentence. */
export const MAX_STATUS_CHARS = 40;
/** More than a popup of statuses can be read down. */
export const MAX_STATUSES = 24;

export interface Settings {
  /** The accent colour; appearance is an independent preference. */
  accent: AccentId;
  appearance: Appearance;
  formatOrder: string[];
  sceneStatuses: string[];
  /** Interface text percentage; script zoom stays independent. */
  interfaceTextSize: number;
  /** The page map under the script (docs/app/preferences-and-help/settings.md#SET-9), named for the running time it
   *  showed until a page stopped being read as a minute; the key keeps that name. */
  runningTimeStrip: boolean;
  /** Spell check on or off: the document menu's Check Spelling is this value. */
  spellcheck: boolean;
  /** Words taught to the spell checker, sorted, one spelling each. */
  learnedWords: string[];
  /**
   * The Plays screen's statuses, in order (docs/app/preferences-and-help/settings.md#SET-7). A new play starts as
   * the first. Renaming or deleting one changes the list only: a play keeps
   * the word it has (docs/app/keeping-work/storage-and-file-format.md#STOR-D5 calls it a free-form label).
   */
  playStatuses: string[];
  /** Whether the Plays screen shows Progress, a page count per play — and counts it at all. */
  showProgress: boolean;
  openAtLaunch: OpenAtLaunch;
  /**
   * The play open when the app last closed — state kept for `openAtLaunch`, not
   * a choice. Null when the writer left it for the Plays screen.
   */
  lastPlay: string | null;
  /**
   * Whether Proscenium looks for a newer version by itself, at launch and once
   * a day (docs/engineering/release-engineering.md#REL-D6). Check Now asks either way.
   */
  checkForUpdates: boolean;
  /** Where updates come from (Settings › Updates): stable unless chosen. */
  updateTrack: UpdateTrack;
  /**
   * Whether this copy holds alpha's key (`updateTrackKey` in settings.json).
   * The page is told only this: the key goes in through a patch and never
   * comes back out.
   */
  hasUpdateTrackKey: boolean;
  /** The format a new play starts in, or null for the app's default (Settings › Formats). */
  defaultFormat: string | null;
  /**
   * "Share anonymous usage and crash reports" (Settings › Privacy,
   * docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D3). On unless switched off; off, nothing is sent
   * and anything waiting to go is dropped.
   */
  shareAnalytics: boolean;
  /** The Welcome screen has said, once, that reports are sent — state, not a choice. */
  privacyNoticeSeen: boolean;
}

/**
 * A partial update. Absent fields are left alone. The dictionary changes by
 * word, never by list: a window holding an older list must not be able to wipe
 * the word another one just taught.
 */
export interface SettingsPatch {
  accent?: AccentId;
  appearance?: Appearance;
  formatOrder?: string[];
  sceneStatuses?: string[];
  interfaceTextSize?: number;
  runningTimeStrip?: boolean;
  spellcheck?: boolean;
  openAtLaunch?: OpenAtLaunch;
  /** A play's id, or null: the writer went back to the Plays screen. */
  lastPlay?: string | null;
  checkForUpdates?: boolean;
  updateTrack?: UpdateTrack;
  /** Alpha's key, as the writer entered it. Write-only. */
  updateTrackKey?: string;
  /** A format id, or null to go back to the app's default. */
  defaultFormat?: string | null;
  /** The whole list: edited in one place, rarely, and in order. */
  playStatuses?: string[];
  showProgress?: boolean;
  shareAnalytics?: boolean;
  privacyNoticeSeen?: boolean;
  /** Removals apply after additions, so a word in both is forgotten. */
  learnedWords?: { add?: string[]; remove?: string[] };
}

/**
 * Every default. A preference that has never been chosen reads as this, and
 * the defaults are what the app did before each was a choice — the strip was
 * on, spelling was checked — with one exception. Launch went to the Plays
 * screen, and stayed that way so no one's app changed on upgrade, until a
 * writer wanted the page that was open when the app closed (2026-09-16): it goes
 * back where the writer left off now.
 */
export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  accent: "gilt",
  appearance: "system",
  formatOrder: [],
  sceneStatuses: [...DEFAULT_SCENE_STATUSES],
  interfaceTextSize: 100,
  runningTimeStrip: true,
  spellcheck: true,
  learnedWords: [],
  playStatuses: [...DEFAULT_PLAY_STATUSES],
  showProgress: true,
  openAtLaunch: "lastPlay",
  lastPlay: null,
  checkForUpdates: true,
  updateTrack: "stable",
  hasUpdateTrackKey: false,
  defaultFormat: null,
  shareAnalytics: true,
  privacyNoticeSeen: false,
});

const MAX_WORD_CHARS = 100;

/** A format id, by validation's rule (src/format/validate.ts) — as settings.rs checks it. */
function isFormatId(v: unknown): v is string {
  return typeof v === "string" && v.length <= 64 && /^[a-z0-9][a-z0-9-]*$/.test(v);
}

/**
 * A play as the Plays screen knows it: the ULID in its play file, or its
 * folder's name when the file has none (vault-plays.ts). Only ever compared
 * with the plays found in the folder, never made into a path.
 */
function isPlayRef(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "" && [...v].length <= 512 && !/\p{Cc}/u.test(v);
}

/** One status as settings.rs accepts it: trimmed already, not empty, short, no control characters. */
export function isStatus(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v !== "" &&
    v === v.trim() &&
    [...v].length <= MAX_STATUS_CHARS &&
    !/\p{Cc}/u.test(v)
  );
}

/** Why a status list would be refused, or null — the rule settings.rs applies to a patch. */
export function statusListProblem(list: unknown): string | null {
  if (!Array.isArray(list)) return "playStatuses is not a list";
  if (list.length > MAX_STATUSES) return `at most ${MAX_STATUSES} statuses`;
  const seen = new Set<string>();
  for (const status of list) {
    if (!isStatus(status)) return `"${String(status)}" is not a status`;
    const key = status.toLowerCase();
    if (seen.has(key)) return `"${status}" is in the list twice`;
    seen.add(key);
  }
  return null;
}

/** A stored list, read softly: what is usable survives, a list that is not one is the default. */
function readStatuses(v: unknown): string[] {
  if (!Array.isArray(v)) return [...DEFAULT_PLAY_STATUSES];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of v) {
    if (!isStatus(item) || seen.has(item.toLowerCase())) continue;
    seen.add(item.toLowerCase());
    out.push(item);
  }
  return out.slice(0, MAX_STATUSES);
}

export function isAccentId(v: unknown): v is AccentId {
  return typeof v === "string" && (ACCENT_IDS as readonly string[]).includes(v);
}

function isInterfaceTextSize(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 100 && v <= 200;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * The preferences in a settings object, each falling back to its default on its
 * own, exactly as settings.rs reads the file: a mangled accent does not cost
 * the writer their dictionary.
 */
export function readSettings(raw: unknown): Settings {
  const o = isRecord(raw) ? raw : {};
  return {
    accent: isAccentId(o.accent) ? o.accent : DEFAULT_SETTINGS.accent,
    appearance: o.appearance === "light" || o.appearance === "dark" ? o.appearance : "system",
    formatOrder: Array.isArray(o.formatOrder) ? [...new Set(o.formatOrder.filter(isFormatId))].slice(0, 256) : [],
    sceneStatuses: Array.isArray(o.sceneStatuses) ? readStatuses(o.sceneStatuses) : [...DEFAULT_SCENE_STATUSES],
    interfaceTextSize: isInterfaceTextSize(o.interfaceTextSize) ? o.interfaceTextSize : 100,
    runningTimeStrip:
      typeof o.runningTimeStrip === "boolean" ? o.runningTimeStrip : DEFAULT_SETTINGS.runningTimeStrip,
    spellcheck: typeof o.spellcheck === "boolean" ? o.spellcheck : DEFAULT_SETTINGS.spellcheck,
    learnedWords: Array.isArray(o.learnedWords)
      ? o.learnedWords.filter((w): w is string => typeof w === "string")
      : [],
    playStatuses: readStatuses(o.playStatuses),
    showProgress: typeof o.showProgress === "boolean" ? o.showProgress : DEFAULT_SETTINGS.showProgress,
    openAtLaunch:
      o.openAtLaunch === "plays" || o.openAtLaunch === "lastPlay" ? o.openAtLaunch : DEFAULT_SETTINGS.openAtLaunch,
    lastPlay: isPlayRef(o.lastPlay) ? o.lastPlay : null,
    checkForUpdates:
      typeof o.checkForUpdates === "boolean" ? o.checkForUpdates : DEFAULT_SETTINGS.checkForUpdates,
    updateTrack: isUpdateTrack(o.updateTrack) ? o.updateTrack : DEFAULT_SETTINGS.updateTrack,
    // The file holds the key; a Settings object (the first-frame mirror, an
    // optimistic update) holds only whether there is one.
    hasUpdateTrackKey: isUpdateTrackKey(o.updateTrackKey) || o.hasUpdateTrackKey === true,
    defaultFormat: isFormatId(o.defaultFormat) ? o.defaultFormat : null,
    shareAnalytics:
      typeof o.shareAnalytics === "boolean" ? o.shareAnalytics : DEFAULT_SETTINGS.shareAnalytics,
    privacyNoticeSeen:
      typeof o.privacyNoticeSeen === "boolean" ? o.privacyNoticeSeen : DEFAULT_SETTINGS.privacyNoticeSeen,
  };
}

/** Why a patch would be refused, or null when settings.rs would accept it. */
export function validatePatch(patch: SettingsPatch): string | null {
  const known = new Set([
    "appearance", "formatOrder", "sceneStatuses",
    "accent",
    "interfaceTextSize",
    "runningTimeStrip",
    "spellcheck",
    "openAtLaunch",
    "lastPlay",
    "learnedWords",
    "checkForUpdates",
    "updateTrack",
    "updateTrackKey",
    "defaultFormat",
    "shareAnalytics",
    "privacyNoticeSeen",
    "playStatuses",
    "showProgress",
  ]);
  for (const key of Object.keys(patch)) {
    if (!known.has(key)) return `"${key}" is not a setting`;
  }
  if (patch.appearance !== undefined && !["system", "light", "dark"].includes(patch.appearance)) return "Unknown appearance";
  if (patch.formatOrder !== undefined && (!Array.isArray(patch.formatOrder) || patch.formatOrder.length > 256 || !patch.formatOrder.every(isFormatId) || new Set(patch.formatOrder).size !== patch.formatOrder.length)) return "Invalid format order";
  if (patch.sceneStatuses !== undefined) {
    const problem = statusListProblem(patch.sceneStatuses);
    if (problem) return problem;
  }
  if (patch.interfaceTextSize !== undefined && !isInterfaceTextSize(patch.interfaceTextSize)) return "interfaceTextSize must be a whole percentage from 100 to 200";
  if (patch.accent !== undefined && !isAccentId(patch.accent)) {
    return `"${String(patch.accent)}" is not an accent`;
  }
  for (const key of ["runningTimeStrip", "spellcheck", "checkForUpdates", "shareAnalytics", "privacyNoticeSeen", "showProgress"] as const) {
    if (patch[key] !== undefined && typeof patch[key] !== "boolean") return `${key} is not true or false`;
  }
  if (patch.openAtLaunch !== undefined && patch.openAtLaunch !== "plays" && patch.openAtLaunch !== "lastPlay") {
    return `"${String(patch.openAtLaunch)}" is not a launch choice`;
  }
  if (patch.updateTrack !== undefined && !isUpdateTrack(patch.updateTrack)) {
    return `"${String(patch.updateTrack)}" is not an update track`;
  }
  if (patch.updateTrackKey !== undefined && !isUpdateTrackKey(patch.updateTrackKey)) return "That is not a key";
  if (patch.lastPlay !== undefined && patch.lastPlay !== null && !isPlayRef(patch.lastPlay)) {
    return `"${String(patch.lastPlay)}" is not a play`;
  }
  if (patch.playStatuses !== undefined) {
    const problem = statusListProblem(patch.playStatuses);
    if (problem) return problem;
  }
  if (patch.defaultFormat !== undefined && patch.defaultFormat !== null && !isFormatId(patch.defaultFormat)) {
    return `"${String(patch.defaultFormat)}" is not a format id`;
  }
  if (patch.learnedWords !== undefined) {
    const { add = [], remove = [], ...rest } = patch.learnedWords;
    if (Object.keys(rest).length || !Array.isArray(add) || !Array.isArray(remove)) {
      return "learnedWords takes lists to add and remove";
    }
    for (const word of [...add, ...remove]) {
      const trimmed = typeof word === "string" ? word.trim() : "";
      if (!trimmed || [...trimmed].length > MAX_WORD_CHARS) {
        return `"${String(word)}" is not a word the dictionary can hold`;
      }
    }
  }
  return null;
}

/** Case-insensitive, as the checker compares: the first spelling taught is kept. */
function sameWord(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Apply a VALID patch to a settings object and return the new object, leaving
 * every key the patch does not name as it was — the same promise settings.rs
 * makes about `lastVault` and keys it has never heard of.
 */
export function applyPatchToObject(
  obj: Readonly<Record<string, unknown>>,
  patch: SettingsPatch,
): Record<string, unknown> {
  const { learnedWords, defaultFormat, lastPlay, ...values } = patch;
  const next: Record<string, unknown> = { ...obj };
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) next[key] = value;
  }
  // The two fields where null means something: clear, leaving no key behind.
  if (defaultFormat === null) delete next.defaultFormat;
  else if (defaultFormat !== undefined) next.defaultFormat = defaultFormat;
  if (lastPlay === null) delete next.lastPlay;
  else if (lastPlay !== undefined) next.lastPlay = lastPlay;
  if (learnedWords) {
    const list = readSettings(next).learnedWords.slice();
    for (const word of learnedWords.add ?? []) {
      const trimmed = word.trim();
      if (!list.some((w) => sameWord(w, trimmed))) list.push(trimmed);
    }
    const removed = (learnedWords.remove ?? []).map((w) => w.trim());
    const kept = list.filter((w) => !removed.some((r) => sameWord(w, r)));
    // Code-unit order of the lowercased word, which is settings.rs's order too.
    kept.sort((a, b) => {
      const x = a.toLowerCase();
      const y = b.toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    });
    if (kept.length) next.learnedWords = kept;
    else delete next.learnedWords;
  }
  return next;
}

/** The settings after a patch, as settings.rs would answer. */
export function applyPatch(settings: Settings, patch: SettingsPatch): Settings {
  return readSettings(applyPatchToObject(settings as unknown as Record<string, unknown>, patch));
}

/* ── The first-frame mirror ─────────────────────────────────────────────── */

/**
 * localStorage holds a copy of the settings for ONE reason: the first paint of
 * a launch, which happens before IPC can answer. An accent that arrives a frame
 * late is a flash of the wrong colour, and a strip that appears a beat after the
 * page is a jump — each seen once and never unseen. settings.json stays the
 * preference; the mirror is overwritten by it as soon as it arrives.
 */
export const SETTINGS_MIRROR_KEY = "proscenium:settings";

/**
 * The per-key mirrors, and one real preference, from before the model.
 * `proscenium:spellcheck` was never a mirror — spell check's on/off lived ONLY
 * in localStorage — so a writer who switched it off keeps it off only because
 * the settings store migrates it into settings.json.
 */
export const LEGACY_KEYS = {
  accent: "proscenium:accent",
  runningTimeStrip: "proscenium:runningTimeStrip",
  spellcheck: "proscenium:spellcheck",
} as const;

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The browser's localStorage, or null where there is none or it refuses access. */
export function browserStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function tryGet(storage: KeyValueStorage | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** The values the pre-model keys hold, as a patch over the defaults. */
export function legacyValues(storage: KeyValueStorage | null): SettingsPatch {
  const out: SettingsPatch = {};
  const accent = tryGet(storage, LEGACY_KEYS.accent);
  if (isAccentId(accent)) out.accent = accent;
  const strip = tryGet(storage, LEGACY_KEYS.runningTimeStrip);
  if (strip === "0" || strip === "1") out.runningTimeStrip = strip === "1";
  const spell = tryGet(storage, LEGACY_KEYS.spellcheck);
  if (spell === "0" || spell === "1") out.spellcheck = spell === "1";
  return out;
}

/** The settings to paint the first frame with: the mirror, else the old keys, else defaults. */
export function readMirror(storage: KeyValueStorage | null): Settings {
  const raw = tryGet(storage, SETTINGS_MIRROR_KEY);
  if (raw !== null) {
    try {
      return readSettings(JSON.parse(raw));
    } catch {
      /* a torn mirror is only a first frame; fall through */
    }
  }
  return applyPatch({ ...DEFAULT_SETTINGS }, legacyValues(storage));
}

export function writeMirror(storage: KeyValueStorage | null, settings: Settings): void {
  try {
    storage?.setItem(SETTINGS_MIRROR_KEY, JSON.stringify(settings));
  } catch {
    /* the mirror is a nicety; settings.json is the preference */
  }
}

/**
 * What the old keys know that settings.json does not, as a patch — or null.
 *
 * A legacy value is carried over only where it is not the default and the
 * stored settings still are. The old hooks wrote the mirror and settings.json
 * together, so a mirror that disagrees with an explicit choice in settings.json
 * cannot happen; one that disagrees with a DEFAULT means the file never got the
 * value (spell check's toggle never went to the file at all). Either way the
 * writer's last choice is the one that survives.
 */
export function legacyMigration(
  storage: KeyValueStorage | null,
  stored: Settings,
): SettingsPatch | null {
  const legacy = legacyValues(storage);
  const patch: SettingsPatch = {};
  if (legacy.accent !== undefined && legacy.accent !== DEFAULT_SETTINGS.accent && stored.accent === DEFAULT_SETTINGS.accent) {
    patch.accent = legacy.accent;
  }
  for (const key of ["runningTimeStrip", "spellcheck"] as const) {
    const value = legacy[key];
    if (value !== undefined && value !== DEFAULT_SETTINGS[key] && stored[key] === DEFAULT_SETTINGS[key]) {
      patch[key] = value;
    }
  }
  return Object.keys(patch).length ? patch : null;
}

/** Forget the pre-model keys, once what they held is safely in settings.json. */
export function clearLegacyKeys(storage: KeyValueStorage | null): void {
  for (const key of Object.values(LEGACY_KEYS)) {
    try {
      storage?.removeItem(key);
    } catch {
      /* nothing to clear is the normal case */
    }
  }
}
