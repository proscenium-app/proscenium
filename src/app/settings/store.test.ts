// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The settings store's promises, against a backend whose answers the test
 * releases one at a time: optimistic, ordered, no flicker, honest on failure,
 * and a first load that migrates without painting the wrong value first.
 */
import { describe, expect, it } from "bun:test";
import {
  DEFAULT_SETTINGS,
  LEGACY_KEYS,
  SETTINGS_MIRROR_KEY,
  applyPatch,
  type KeyValueStorage,
  type Settings,
  type SettingsPatch,
} from "../../storage/settings-model";
import { createSettingsStore } from "./store";

function memoryStorage(
  seed: Record<string, string> = {},
): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

/** A settings.rs stand-in: applies patches to its "file" when the test says so. */
function fakeBackend(initial: Settings = { ...DEFAULT_SETTINGS }) {
  let file = initial;
  const sent: SettingsPatch[] = [];
  const pending: { patch: SettingsPatch; resolve: () => void; reject: (e: Error) => void }[] = [];
  return {
    sent,
    pending,
    get file() {
      return file;
    },
    get: () => Promise.resolve(file),
    update: (patch: SettingsPatch) =>
      new Promise<Settings>((resolve, reject) => {
        sent.push(patch);
        pending.push({
          patch,
          resolve: () => {
            file = applyPatch(file, patch);
            resolve(file);
          },
          reject: (e) => reject(e),
        });
      }),
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("the settings store", () => {
  it("paints the first frame from the mirror, then adopts settings.json", async () => {
    const storage = memoryStorage({
      [SETTINGS_MIRROR_KEY]: JSON.stringify({ ...DEFAULT_SETTINGS, accent: "iris" }),
    });
    const backend = fakeBackend({ ...DEFAULT_SETTINGS, accent: "velvet" });
    const painted: string[] = [];
    const store = createSettingsStore({
      backend,
      storage,
      onChange: (s) => painted.push(s.accent),
    });
    expect(store.getSnapshot().accent).toBe("iris");
    expect(store.isLoaded()).toBe(false);
    await store.load();
    expect(store.getSnapshot().accent).toBe("velvet");
    expect(store.isLoaded()).toBe(true);
    expect(painted).toEqual(["velvet"]);
    expect(JSON.parse(storage.data.get(SETTINGS_MIRROR_KEY)!).accent).toBe("velvet");
  });

  it("migrates spell check's old toggle without ever showing it on", async () => {
    const storage = memoryStorage({ [LEGACY_KEYS.spellcheck]: "0" });
    const backend = fakeBackend();
    const store = createSettingsStore({ backend, storage });
    const seen: boolean[] = [store.getSnapshot().spellcheck];
    store.subscribe(() => seen.push(store.getSnapshot().spellcheck));
    await store.load();
    await tick();
    expect(seen.every((on) => on === false)).toBe(true);
    expect(backend.sent).toEqual([{ spellcheck: false }]);
    // The old key is only let go once the file has the value.
    expect(storage.data.has(LEGACY_KEYS.spellcheck)).toBe(true);
    backend.pending[0].resolve();
    await tick();
    expect(backend.file.spellcheck).toBe(false);
    expect(storage.data.has(LEGACY_KEYS.spellcheck)).toBe(false);
  });

  it("applies at once and persists in order, one patch at a time", async () => {
    const backend = fakeBackend();
    const store = createSettingsStore({ backend, storage: null });
    await store.load();

    void store.update({ spellcheck: false });
    void store.update({ spellcheck: true });
    void store.update({ spellcheck: false });
    // The switch shows the last click immediately…
    expect(store.getSnapshot().spellcheck).toBe(false);
    await tick();
    // …and only the first patch is on its way until it is answered.
    expect(backend.sent).toEqual([{ spellcheck: false }]);

    const shown: boolean[] = [];
    store.subscribe(() => shown.push(store.getSnapshot().spellcheck));
    backend.pending[0].resolve();
    await tick();
    expect(backend.sent).toEqual([{ spellcheck: false }, { spellcheck: true }]);
    backend.pending[1].resolve();
    await tick();
    backend.pending[2].resolve();
    await tick();
    // No intermediate answer flickered the switch back.
    expect(shown.every((on) => on === false)).toBe(true);
    expect(backend.file.spellcheck).toBe(false);
    expect(store.getSnapshot().spellcheck).toBe(false);
  });

  it("goes back to what is stored when a change was not saved", async () => {
    const backend = fakeBackend();
    const errors: string[] = [];
    const store = createSettingsStore({ backend, storage: null, onError: (m) => errors.push(m) });
    await store.load();
    void store.update({ runningTimeStrip: false });
    expect(store.getSnapshot().runningTimeStrip).toBe(false);
    await tick();
    backend.pending[0].reject(new Error("disk full"));
    await tick();
    await tick();
    expect(errors.some((m) => m.includes("disk full"))).toBe(true);
    expect(store.getSnapshot().runningTimeStrip).toBe(true);
  });

  it("refuses an invalid patch before it reaches the screen or the file", async () => {
    const backend = fakeBackend();
    const errors: string[] = [];
    const store = createSettingsStore({ backend, storage: null, onError: (m) => errors.push(m) });
    await store.load();
    const before = store.getSnapshot();
    await store.update({ accent: "chartreuse" } as unknown as SettingsPatch);
    expect(store.getSnapshot()).toBe(before);
    expect(backend.sent).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  it("keeps the word list's identity when a change does not touch it", async () => {
    const backend = fakeBackend({ ...DEFAULT_SETTINGS, learnedWords: ["Mara"] });
    const store = createSettingsStore({ backend, storage: null });
    await store.load();
    const words = store.getSnapshot().learnedWords;
    void store.update({ runningTimeStrip: false });
    await tick();
    backend.pending[0].resolve();
    await tick();
    expect(store.getSnapshot().runningTimeStrip).toBe(false);
    expect(store.getSnapshot().learnedWords).toBe(words);
  });

  it("re-renders nobody for an answer that changes nothing", async () => {
    const backend = fakeBackend();
    const store = createSettingsStore({ backend, storage: null });
    await store.load();
    let renders = 0;
    store.subscribe(() => renders++);
    void store.update({ accent: "iris" });
    expect(renders).toBe(1);
    await tick();
    backend.pending[0].resolve();
    await tick();
    expect(renders).toBe(1);
  });
});
