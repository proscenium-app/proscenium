// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * One snapshot of the settings for every surface that shows a preference.
 *
 * The document menu's Check Spelling and Settings › Writing's switch used to be
 * two readers of a `useState` in App, and the accent, the strip and the
 * dictionary were three hooks with three copies of the same load-and-mirror
 * dance. Now there is one store: both spell-check controls read it and write
 * it, so they cannot disagree — there is nothing for them to disagree about.
 *
 * - **Optimistic.** A switch flips when it is clicked; the patch goes to
 *   settings.rs behind it, and what settings.rs answers becomes the snapshot.
 * - **Ordered.** Patches go one at a time. Two quick clicks on one switch are
 *   two IPC calls, and Tauri makes no promise about the order two async
 *   commands take the file lock in — so without the queue, on-then-off could
 *   land as off-then-on while the switch showed off.
 * - **No flicker.** An answer is adopted only when nothing else is still in
 *   flight, so the first of two answers cannot briefly undo the second click.
 *   The last answer carries both.
 * - **Migrating.** The first load carries the pre-model localStorage values
 *   into settings.json (settings-model.ts `legacyMigration`) before painting.
 */
import { useEffect, useSyncExternalStore } from "react";
import { applyAppearance, applyInterfaceTextSize } from "../../ui/use-accent";
import { settings as ipc } from "../../storage";
import {
  applyPatch,
  browserStorage,
  clearLegacyKeys,
  legacyMigration,
  readMirror,
  validatePatch,
  writeMirror,
  type KeyValueStorage,
  type Settings,
  type SettingsPatch,
} from "../../storage/settings-model";

export interface SettingsBackend {
  get(): Promise<Settings>;
  update(patch: SettingsPatch): Promise<Settings>;
}

export interface SettingsStore {
  getSnapshot(): Settings;
  subscribe(listener: () => void): () => void;
  /** True once settings.json has answered (or failed to): until then the snapshot is the mirror. */
  isLoaded(): boolean;
  load(): Promise<void>;
  /** Apply at once, then persist behind it. An invalid patch is refused and reported. */
  update(patch: SettingsPatch): Promise<void>;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((w, i) => w === b[i]);
}

/**
 * `next`, unless nothing in it changed — then `prev`, so a redundant answer
 * re-renders nobody. The word list keeps its identity when its words did not
 * change: the editor rebuilds its speller whenever the array it was given is a
 * new one, and a toggle of the strip is no reason to re-check the whole play.
 * The status list keeps its identity the same way.
 */
function settle(prev: Settings, next: Settings): Settings {
  const words = sameList(prev.learnedWords, next.learnedWords) ? prev.learnedWords : next.learnedWords;
  const statuses = sameList(prev.playStatuses, next.playStatuses) ? prev.playStatuses : next.playStatuses;
  const merged = { ...next, learnedWords: words, playStatuses: statuses,
    sceneStatuses: sameList(prev.sceneStatuses, next.sceneStatuses) ? prev.sceneStatuses : next.sceneStatuses,
    formatOrder: sameList(prev.formatOrder, next.formatOrder) ? prev.formatOrder : next.formatOrder,
  };
  const same = (Object.keys(merged) as (keyof Settings)[]).every((k) => merged[k] === prev[k]);
  return same ? prev : merged;
}

export function createSettingsStore(opts: {
  backend: SettingsBackend;
  storage: KeyValueStorage | null;
  /** Runs on every change, before listeners — where the accent reaches the document. */
  onChange?: (settings: Settings) => void;
  onError?: (message: string) => void;
}): SettingsStore {
  let state = readMirror(opts.storage);
  let loaded = false;
  let loading: Promise<void> | null = null;
  let inFlight = 0;
  let queue: Promise<unknown> = Promise.resolve();
  const listeners = new Set<() => void>();

  const emit = () => {
    for (const listener of [...listeners]) listener();
  };

  const set = (next: Settings) => {
    const settled = settle(state, next);
    if (settled === state) return;
    state = settled;
    writeMirror(opts.storage, state);
    opts.onChange?.(state);
    emit();
  };

  /** Persist a patch that is ALREADY in `state`. Resolves to whether it was stored. */
  const send = (patch: SettingsPatch): Promise<boolean> => {
    inFlight++;
    const done = queue.then(() => opts.backend.update(patch)).then(
      (stored) => {
        inFlight--;
        if (inFlight === 0) set(stored);
        return true;
      },
      (e: unknown) => {
        inFlight--;
        opts.onError?.(`a settings change was not saved: ${e instanceof Error ? e.message : String(e)}`);
        // What is on screen is no longer what is stored: go back to the truth,
        // rather than show a preference that will not be there next launch.
        if (inFlight === 0) {
          void opts.backend.get().then(
            (s) => inFlight === 0 && set(s),
            () => {},
          );
        }
        return false;
      },
    );
    queue = done;
    return done;
  };

  const load = () =>
    (loading ??= opts.backend.get().then(
      (stored) => {
        const migration = legacyMigration(opts.storage, stored);
        const base = inFlight === 0 ? stored : state;
        set(migration ? applyPatch(base, migration) : base);
        loaded = true;
        emit();
        if (migration) {
          void send(migration).then((ok) => ok && clearLegacyKeys(opts.storage));
        } else {
          clearLegacyKeys(opts.storage);
        }
      },
      (e: unknown) => {
        // The mirror stands in; nothing about this blocks the app.
        loaded = true;
        emit();
        opts.onError?.(`settings could not be read: ${e instanceof Error ? e.message : String(e)}`);
      },
    ));

  const update = (patch: SettingsPatch): Promise<void> => {
    const invalid = validatePatch(patch);
    if (invalid) {
      opts.onError?.(`refused a settings change: ${invalid}`);
      return Promise.resolve();
    }
    set(applyPatch(state, patch));
    return send(patch).then(() => undefined);
  };

  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isLoaded: () => loaded,
    load,
    update,
  };
}

/** The app's store: settings.rs behind it, localStorage as the first-frame mirror. */
export const settingsStore: SettingsStore = createSettingsStore({
  backend: ipc,
  storage: browserStorage(),
  // `data-accent` on :root recolours the whole app in one paint, portals
  // included (use-accent.ts), and follows the store wherever it changes from.
  onChange: (s) => {
    if (typeof document !== "undefined") document.documentElement.dataset.accent = s.accent;
    applyInterfaceTextSize(s.interfaceTextSize);
    applyAppearance(s.appearance);
  },
  // Loud in development and in smoke, which fails a run on a console error.
  onError: (message) => console.error(`[settings] ${message}`),
});

/** Every preference, kept current. The first call starts the load from settings.json. */
export function useSettings(): Settings {
  const snapshot = useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.getSnapshot,
    settingsStore.getSnapshot,
  );
  useEffect(() => {
    void settingsStore.load();
  }, []);
  return snapshot;
}

/** Whether settings.json has answered yet — for decisions a mirror must not make. */
export function useSettingsLoaded(): boolean {
  return useSyncExternalStore(settingsStore.subscribe, settingsStore.isLoaded, settingsStore.isLoaded);
}

/** Change settings from anywhere: a menu, a sheet, a plugin callback. */
export function updateSettings(patch: SettingsPatch): void {
  void settingsStore.update(patch);
}

/**
 * Teach the spell checker a word. Applied at once — the underline should go
 * the moment the writer says the word is fine — and a word it already knows,
 * in any case, sends nothing.
 */
export function learnWord(word: string): void {
  const trimmed = word.trim();
  const known = settingsStore.getSnapshot().learnedWords;
  if (!trimmed || known.some((w) => w.toLowerCase() === trimmed.toLowerCase())) return;
  updateSettings({ learnedWords: { add: [trimmed] } });
}

/** Unteach one. "Learn" with no way back would be a one-way door on the writer's own list. */
export function forgetWord(word: string): void {
  updateSettings({ learnedWords: { remove: [word] } });
}
