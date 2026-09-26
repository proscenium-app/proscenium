// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  VaultWriteError,
  versions,
  saveProblem,
  type SaveProblem,
  type SaveRefusal,
  type SaveSubject,
} from "../storage";
import { findItem } from "../workspace/binder";
import { matchingPath } from "../storage/path-key";
import type { RecoveryBuffer } from "../storage/buffer-recovery";
import {
  builtOn,
  rememberFailed,
  splitFrontMatter,
  withFrontMatter,
  setField,
  parseTags,
  samePath,
  titleOf,
  titleFromFileName,
  type BinderItem,
  type BufferLease,
  type MaterialBuffer,
  type ParkedWords,
} from "../workspace";
import { oneAtATime, type Line } from "./one-at-a-time";
import type { SaveStatus, VersionsTarget } from "./useWorkspace";
import type { MaterialSettlement } from "./workspace-transition";
import type { DocumentScope } from "./document-scope";

/**
 * An external change to the material the writer has open, held while they
 * choose (docs/app/keeping-work/storage-and-file-format.md#STOR-104 — nothing is overwritten until they do).
 */
export interface MaterialGate {
  path: string;
  /** What is on disk now. */
  theirs: string;
  hash: string;
}

/** One open sheet as its editors see it. */
export interface OpenMaterial {
  item: BinderItem;
  /** The file as the store last knew it on disk. */
  content: string;
  /** Bumped when the editors must take `content` whatever they hold (MaterialEditor). */
  reset: number;
}

type MaterialRecord = { path: string; hash: string; content: string; keepMine: boolean };

interface Host {
  currentScope: () => DocumentScope;
  bufferGeneration: () => number;
  syncBeacon: () => void;
  captureRecovery: () => void;
  setSheetStatus: (status: SaveStatus) => void;
  setActiveId: (id: string) => void;
  setError: Dispatch<SetStateAction<string | SaveProblem | null>>;
  setPreserved: Dispatch<SetStateAction<string[]>>;
  saveLanded: (key: string) => void;
  saveRefused: (key: string, error: VaultWriteError, subject: SaveSubject) => void;
  saveSubject: (kind: SaveSubject["kind"], path: string) => SaveSubject;
  refusalFor: (key: string) => { refusal: SaveRefusal; subject: SaveSubject } | undefined;
  forgetRefused: (gone: (key: string) => boolean) => void;
}

/** Owns sheet buffers, hash ancestry, conflict choices, writes and preservation. */
export function useMaterialSessions(host: Host) {
  const hostRef = useRef(host);
  hostRef.current = host;
  const {
    currentScope,
    bufferGeneration,
    syncBeacon,
    captureRecovery,
    setSheetStatus,
    setActiveId,
    setError,
    setPreserved,
    saveLanded,
    saveRefused,
    saveSubject,
    refusalFor,
    forgetRefused,
  } = useMemo(
    () => ({
      bufferGeneration: () => hostRef.current.bufferGeneration(),
      currentScope: (...args: Parameters<Host["currentScope"]>) =>
        hostRef.current.currentScope(...args),
      syncBeacon: (...args: Parameters<Host["syncBeacon"]>) => hostRef.current.syncBeacon(...args),
      captureRecovery: (...args: Parameters<Host["captureRecovery"]>) =>
        hostRef.current.captureRecovery(...args),
      setSheetStatus: (...args: Parameters<Host["setSheetStatus"]>) =>
        hostRef.current.setSheetStatus(...args),
      setActiveId: (...args: Parameters<Host["setActiveId"]>) =>
        hostRef.current.setActiveId(...args),
      setError: (...args: Parameters<Host["setError"]>) => hostRef.current.setError(...args),
      setPreserved: (...args: Parameters<Host["setPreserved"]>) =>
        hostRef.current.setPreserved(...args),
      saveLanded: (...args: Parameters<Host["saveLanded"]>) => hostRef.current.saveLanded(...args),
      saveRefused: (...args: Parameters<Host["saveRefused"]>) =>
        hostRef.current.saveRefused(...args),
      saveSubject: (...args: Parameters<Host["saveSubject"]>) =>
        hostRef.current.saveSubject(...args),
      refusalFor: (...args: Parameters<Host["refusalFor"]>) => hostRef.current.refusalFor(...args),
      forgetRefused: (...args: Parameters<Host["forgetRefused"]>) =>
        hostRef.current.forgetRefused(...args),
    }),
    [],
  );
  /*
   * Open materials, keyed by BINDER ID.
   *
   * There used to be exactly one of each of these, because there was exactly
   * one place a material could be shown. With a pane tree there can be several
   * on screen at once, and a single buffer meant the second pane showed the
   * first pane's text under its own name. Everything below is the same
   * machinery as before with a key in front of it — the split between state and
   * ref is unchanged and deliberate: content renders, so it is state; hash and
   * dirty are read inside async callbacks that must not close over a stale
   * value, so they are refs.
   *
   * The invariant that matters is unchanged too: a hash belongs to the file it
   * was read from, and a save only lands against that hash (docs/app/keeping-work/storage-and-file-format.md#STOR-D9).
   */
  const [openMaterials, setOpenMaterials] = useState<Record<string, OpenMaterial>>({});
  /**
   * What the store knows of each open sheet's file: where it is, its hash, the
   * content that hash belongs to, and whether the writer has chosen to keep
   * their words over another version (`keepMine`, for exactly one save).
   */
  const matsRef = useRef(
    new Map<string, { path: string; hash: string; content: string; keepMine: boolean }>(),
  );
  /**
   * Every editor showing each sheet registers its buffer here (MaterialEditor's
   * `MaterialBuffer`). The editors own the words; this is how the store reaches
   * them — to ask whether any are unsaved (docs/app/keeping-work/storage-and-file-format.md#STOR-104), to write them, and to
   * keep them when a sheet goes away before they could land.
   */
  const matBuffersRef = useRef(new Map<string, Set<MaterialBuffer>>());
  /**
   * Words editors left unsaved when they went away (their lease's `release`),
   * by sheet, oldest first. A list: two panes of one sheet can both go.
   */
  const matParkedRef = useRef(new Map<string, ParkedWords[]>());
  /** Sheets whose first read is still on its way, so a second open does not read it again. */
  const matPendingRef = useRef(new Set<string>());
  /**
   * Saves of each sheet that did not land, each with the version it was built
   * on (material-buffer.ts `buildsOn`). Words written on top of a save the
   * disk refused are still written on what that save was built on, and the next
   * save must not meet a choice about a version that never existed on disk.
   */
  const matFailedRef = useRef(new Map<string, Map<string, string>>());
  /** Take parked words of one sheet out of the list: those a landed save has made moot. */
  const dropParked = (id: string, moot: (words: ParkedWords) => boolean) => {
    const list = matParkedRef.current.get(id);
    if (!list) return;
    const rest = list.filter((w) => !moot(w));
    if (rest.length) matParkedRef.current.set(id, rest);
    else matParkedRef.current.delete(id);
  };
  /** Their version, held while the writer chooses. Nothing is overwritten. */
  const [materialGates, setMaterialGates] = useState<Record<string, MaterialGate>>({});
  const matGatesRef = useRef(new Map<string, MaterialGate>());
  /** Writes of sheet files, one at a time, so each is checked against what the last one left. */
  const materialWritesRef = useRef<Line | null>(null);
  if (!materialWritesRef.current) materialWritesRef.current = oneAtATime();
  const materialWrites = materialWritesRef.current;

  /** Whether any editor showing this sheet holds words its file does not. */
  const materialUnsaved = useCallback(
    (id: string) =>
      matParkedRef.current.has(id) ||
      [...(matBuffersRef.current.get(id) ?? [])].some((b) => b.unsaved() !== null),
    [],
  );
  /**
   * Every unsaved text of one sheet: what its editors hold, and what the last
   * one left when it went away. Distinct, and never what the file already has.
   */
  const unsavedTextsOf = useCallback((id: string): string[] => {
    const texts = [...(matBuffersRef.current.get(id) ?? [])]
      .map((b) => b.unsaved())
      .filter((t): t is string => t !== null);
    for (const words of matParkedRef.current.get(id) ?? []) texts.push(words.full);
    const onDisk = matsRef.current.get(id)?.content;
    return [...new Set(texts)].filter((t) => t !== onDisk);
  }, []);
  const openMaterialsRef = useRef(openMaterials);
  openMaterialsRef.current = openMaterials;
  /**
   * Which open material is this vault path? The watcher and the external-change
   * paths know a file, not a binder id, so every path-shaped lookup comes
   * through here rather than each site scanning the map itself.
   */
  const idForMaterialPath = useCallback((path: string): string | null => {
    const match = matchingPath(
      path,
      [...matsRef.current.values()].map((m) => m.path),
    );
    for (const [id, m] of matsRef.current) if (m.path === match) return id;
    return null;
  }, []);

  /** A typed document's identity, buffer and unresolved comparison move together. */
  const retargetMaterial = useCallback((id: string, path: string) => {
    const material = matsRef.current.get(id);
    if (!material || material.path === path) return;
    matsRef.current.set(id, { ...material, path });
    const gate = matGatesRef.current.get(id);
    if (gate) {
      const moved = { ...gate, path };
      matGatesRef.current.set(id, moved);
      setMaterialGates((current) => ({ ...current, [id]: moved }));
    }
  }, []);

  /**
   * A new version of one open sheet's file. `replace` tells its editors to
   * take it whatever they hold (the writer chose it); otherwise only an editor
   * with nothing unsaved takes it, and one with words of its own keeps them.
   */
  const patchMaterial = useCallback((id: string, content: string, replace = false) => {
    setOpenMaterials((cur) =>
      cur[id]
        ? { ...cur, [id]: { ...cur[id], content, reset: cur[id].reset + (replace ? 1 : 0) } }
        : cur,
    );
  }, []);

  // --- materials (docs/app/organizing/workspace-model.md#WORK-D106) ---
  const openMaterial = useCallback(
    async (item: BinderItem) => {
      if (!item.path) return;
      // Already open in another pane: adopt it rather than re-reading, so two
      // panes showing one sheet share a buffer and a hash instead of racing
      // each other's saves.
      if (matsRef.current.has(item.id)) {
        setActiveId(item.id);
        return;
      }
      const path = item.path;
      // One read per sheet at a time, and a read that finishes after the play
      // was left installs nothing: it used to land in whatever
      // play was open by then, baseline and all.
      if (matPendingRef.current.has(item.id)) return;
      const scope = currentScope();
      const generation = bufferGeneration();
      matPendingRef.current.add(item.id);
      try {
        const { content, hash } = await scope.io.read(path);
        if (!scope.isCurrent() || generation !== bufferGeneration()) return;
        matsRef.current.set(item.id, { path, hash, content, keepMine: false });
        // Remember what the writer is now looking at, so a later change from
        // outside can be shown as a change.
        void scope.changes?.writeBaseline(path, content);
        // An editor already showing this sheet (it outlived the store's copy)
        // is not told to take this read over what it holds: its words stay,
        // and its next save is checked against this version.
        setOpenMaterials((cur) => ({
          ...cur,
          [item.id]: { item, content, reset: cur[item.id]?.reset ?? 0 },
        }));
        setActiveId(item.id);
        setSheetStatus("saved");
      } catch (e) {
        if (scope.isCurrent()) setError(String(e));
      } finally {
        matPendingRef.current.delete(item.id);
      }
    },
    [setSheetStatus],
  );

  const raiseMaterialGate = useCallback(
    (id: string, g: MaterialGate) => {
      matGatesRef.current.set(id, g);
      setMaterialGates((cur) => ({ ...cur, [id]: g }));
      setSheetStatus("conflict");
    },
    [setSheetStatus],
  );

  /**
   * Write one sheet. `base` is the version of the file the words were written
   * on top of (MaterialEditor); when the store's version has moved on since —
   * another pane saved, the inspector set a field, the appearances sync wrote
   * — the words would go over a version the writer never saw, so nothing is
   * written and the gate asks instead. Resolves true only if the words landed.
   */
  const writeMaterialNow = useCallback(
    async (
      id: string,
      fullContent: string,
      base?: string,
      scope = currentScope(),
    ): Promise<boolean> => {
      if (!scope.isCurrent()) return false;
      const m = matsRef.current.get(id);
      if (!m) return false;
      const sent = fullContent;
      const failed = matFailedRef.current.get(id) ?? new Map<string, string>();
      matFailedRef.current.set(id, failed);
      // Not written: remembered as a save that never landed, built on `base`.
      const refused = () => {
        if (base !== undefined) rememberFailed(failed, sent, base);
        captureRecovery();
        return false;
      };
      if (matGatesRef.current.has(id)) return refused();
      // Already what the file holds (a save that landed while another editor
      // took over its words): nothing to write, and nothing to argue about.
      if (fullContent === m.content) {
        dropParked(id, (w) => w.full === sent);
        failed.delete(sent);
        syncBeacon();
        return true;
      }
      // Written on a save the disk refused counts as written on what that save
      // was built on — else a refused write made the next one a false choice.
      const root = base === undefined ? undefined : builtOn(base, m.content, failed);
      if (root !== undefined && root !== m.content && !m.keepMine) {
        const was = splitFrontMatter(root);
        const now = splitFrontMatter(m.content);
        const mine = splitFrontMatter(fullContent);
        if (was.body === now.body && mine.header === was.header) {
          // Only the front matter moved underneath (an inspector field), and
          // these words did not touch it: they go on top of the new front
          // matter rather than meeting a choice about the writer's own edit.
          fullContent = withFrontMatter(now.header, mine.body);
        } else {
          raiseMaterialGate(id, { path: m.path, theirs: m.content, hash: m.hash });
          return refused();
        }
      }
      setSheetStatus("saving");
      try {
        const outcome = await scope.io.write(m.path, fullContent, m.hash);
        if (!scope.isCurrent()) return false;
        const now = matsRef.current.get(id);
        if (outcome.status === "ok") {
          if (now) {
            matsRef.current.set(id, {
              ...now,
              hash: outcome.hash,
              content: fullContent,
              keepMine: false,
            });
            patchMaterial(id, fullContent);
          }
          // Words parked on their way here have landed — as sent, or rebased
          // onto new front matter — and are not unsaved any more.
          dropParked(id, (w) => w.full === sent || w.full === fullContent);
          failed.delete(sent);
          failed.delete(fullContent);
          syncBeacon();
          saveLanded(`sheet:${id}`);
          setSheetStatus("saved");
          return true;
        }
        // Someone wrote this file between our read and our write. Raise the
        // same gate the watcher raises rather than telling the writer to
        // "reopen it" — their edits are still in the buffer, and reopening is
        // precisely how they would lose them.
        refused();
        const fresh = await scope.io.read(m.path);
        if (scope.isCurrent() && matsRef.current.has(id)) {
          raiseMaterialGate(id, { path: m.path, theirs: fresh.content, hash: fresh.hash });
        }
        return false;
      } catch (e) {
        if (!scope.isCurrent()) return false;
        // Refused by the disk: said once, and the editor keeps the words and
        // sends them again at its next pause. The status line used to stay on
        // "Saving…" until something else set it.
        if (e instanceof VaultWriteError)
          saveRefused(`sheet:${id}`, e, saveSubject("document", m.path));
        else setError(String(e));
        setSheetStatus("idle");
        return refused();
      }
    },
    [raiseMaterialGate, patchMaterial, setSheetStatus, saveLanded, saveRefused, saveSubject],
  );
  const saveMaterial = useCallback(
    (id: string, fullContent: string, base?: string): Promise<boolean> => {
      const scope = currentScope();
      return materialWrites(() => writeMaterialNow(id, fullContent, base, scope));
    },
    [materialWrites, writeMaterialNow],
  );
  /**
   * Set one front-matter field of an open sheet (the inspector), applied to
   * the sheet as it is when the write's turn comes — not as the inspector last
   * drew it, which a save from the page a moment earlier had already replaced.
   */
  const setFieldWith = useCallback(
    (id: string, key: string, valueOf: (content: string) => string): Promise<boolean> => {
      const scope = currentScope();
      return materialWrites(async () => {
        if (!scope.isCurrent()) return false;
        const m = matsRef.current.get(id);
        if (!m) return false;
        const parts = splitFrontMatter(m.content);
        const full = withFrontMatter(setField(parts.header, key, valueOf(m.content)), parts.body);
        if (full === m.content) return true;
        if (await writeMaterialNow(id, full, m.content, scope)) return true;
        // Not written — the sheet's choice is up, or the disk refused. The
        // field the writer set is kept as a version rather than dropped with
        // the inspector, and they are told where.
        const playId = scope.playId;
        const title = titleFromFileName(m.path);
        try {
          if (!playId || !matsRef.current.has(id)) throw new Error("no sheet");
          const pinned = await versions.snapshot(playId, id, "collision", full, "md");
          setPreserved((p) => [...p, pinned]);
          setError(`“${key}” couldn't be saved to “${title}”, so it is kept in Versions.`);
        } catch {
          setError(`“${key}” couldn't be saved to “${title}” or kept.`);
        }
        return false;
      });
    },
    [materialWrites, writeMaterialNow, currentScope],
  );
  const setMaterialField = useCallback(
    (id: string, key: string, value: string): Promise<boolean> =>
      setFieldWith(id, key, () => value),
    [setFieldWith],
  );
  const editMaterialTags = useCallback(
    (id: string, edit: (tags: string[]) => string[]): Promise<boolean> =>
      setFieldWith(id, "tags", (content) => {
        const next = edit(parseTags(splitFrontMatter(content).fields.tags));
        return next.length ? `[${next.join(", ")}]` : "";
      }),
    [setFieldWith],
  );

  /**
   * The material editor owns its own buffer and debounce, so the store cannot
   * otherwise know whether there are unsaved edits — and docs/app/keeping-work/storage-and-file-format.md#STOR-104 ("no silent loss of
   * in-memory edits") turns on exactly that question. One ref, set by the
   * surface, read by the watcher. There must be exactly one such answer.
   */
  const setMaterialDirty = useCallback((_id: string, _dirty: boolean) => {
    syncBeacon();
  }, []);

  /**
   * Resolve a material's external-change gate (docs/app/keeping-work/storage-and-file-format.md#STOR-104, docs/app/keeping-work/storage-and-file-format.md#STOR-109).
   *
   * "Load theirs" replaces the buffer. "Keep mine" preserves THEIR bytes to a
   * conflict sibling before adopting their hash — the same both-versions-kept
   * guarantee docs/app/keeping-work/storage-and-file-format.md#STOR-105 gives an authored file, made explicit here because the writer
   * is choosing to overwrite something that is already on disk.
   */
  const resolveMaterialGate = useCallback(
    async (id: string, choice: "mine" | "theirs") => {
      const scope = currentScope();
      const gate = matGatesRef.current.get(id);
      const m = matsRef.current.get(id);
      if (!gate || !m || !samePath(gate.path, m.path)) return;
      matGatesRef.current.delete(id);
      setMaterialGates((cur) => {
        if (!(id in cur)) return cur;
        const next = { ...cur };
        delete next[id];
        return next;
      });

      if (choice === "theirs") {
        // The side being replaced is kept first (docs/app/keeping-work/storage-and-file-format.md#STOR-D9): the writer's own
        // unsaved words, as a pinned version — or nothing is replaced.
        const ours = unsavedTextsOf(id);
        const playId = scope.playId;
        try {
          for (const text of ours) {
            if (!playId) throw new Error("no play");
            const pinned = await versions.snapshot(playId, id, "pre-reload-at-banner", text, "md");
            setPreserved((p) => [...p, pinned]);
          }
        } catch {
          if (!scope.isCurrent()) return;
          matGatesRef.current.set(id, gate);
          setMaterialGates((cur) => ({ ...cur, [id]: gate }));
          setError("Your version couldn't be kept in Versions, so nothing was replaced.");
          return;
        }
        if (!scope.isCurrent()) return;
        const cur = matsRef.current.get(id);
        if (!cur) return;
        matsRef.current.set(id, { ...cur, hash: gate.hash, content: gate.theirs, keepMine: false });
        matParkedRef.current.delete(id);
        matFailedRef.current.delete(id);
        patchMaterial(id, gate.theirs, true);
        setSheetStatus("saved");
        syncBeacon();
        return;
      }

      /*
       * Pin a version of THEIRS before ours replaces it (docs/app/keeping-work/storage-and-file-format.md#STOR-105).
       *
       * This used to write `x.proscenium-conflict-<ts>.md` next to the file —
       * a sibling nobody asked for, in a folder that is supposed to hold only
       * the writer's work (docs/app/keeping-work/storage-and-file-format.md#STOR-111). A pinned version keeps the same guarantee
       * somewhere they can reach it, and the folder stays theirs. If it cannot
       * be kept, ours does not replace it: the choice stays open.
       */
      const playId = scope.playId;
      try {
        if (!playId) throw new Error("no play");
        const pinned = await versions.snapshot(playId, id, "pre-keep", gate.theirs, "md");
        setPreserved((p) => [...p, pinned]);
      } catch {
        if (!scope.isCurrent()) return;
        matGatesRef.current.set(id, gate);
        setMaterialGates((cur) => ({ ...cur, [id]: gate }));
        setError("The other version couldn't be kept in Versions, so nothing was replaced.");
        return;
      }
      if (!scope.isCurrent()) return;
      const now = matsRef.current.get(id);
      if (!now) return;
      // Our next save goes over theirs, once: they are in Versions now.
      matsRef.current.set(id, { ...now, hash: gate.hash, content: gate.theirs, keepMine: true });
      setSheetStatus("dirty");
      const editors = [...(matBuffersRef.current.get(id) ?? [])];
      const list = matParkedRef.current.get(id) ?? [];
      if (editors.some((b) => b.unsaved() !== null)) {
        // Words on screen: they go now.
        await Promise.all(editors.map((b) => b.flush()));
      } else if (list.length) {
        // None on screen — the words went with a tab switched away, perhaps in
        // the other pane, where answering used to write nothing: the newest go.
        const parked = list[list.length - 1];
        await materialWrites(() => writeMaterialNow(id, parked.full, parked.base));
      } else {
        // Nothing unsaved anywhere: the page as it stands is the one kept. With
        // nothing written, "Editing…" and the unsaved-work beacon stayed up.
        const page = editors[0]?.page();
        if (page !== undefined && page !== gate.theirs) {
          await materialWrites(() => writeMaterialNow(id, page));
        } else {
          const after = matsRef.current.get(id);
          if (after) matsRef.current.set(id, { ...after, keepMine: false });
          setSheetStatus("saved");
        }
      }
      syncBeacon();
    },
    [patchMaterial, setSheetStatus, unsavedTextsOf, materialWrites, writeMaterialNow],
  );

  /**
   * Force one material's pending edits to disk.
   *
   * The buffer and its debounce live in the editor component, so the store
   * cannot write them itself — the surface registers a flush here on mount and
   * withdraws it on unmount. The registration exists for exactly one reason:
   * closing a tab frees the buffer SYNCHRONOUSLY, in the same handler, before
   * React unmounts the editor. Without a flush at that moment the pending
   * timeout fires into a store that has already forgotten the file, and the
   * last few seconds of typing are gone.
   */
  const registerMaterialBuffer = useCallback(
    (id: string, buffer: MaterialBuffer): BufferLease<ParkedWords> => {
      const set = matBuffersRef.current.get(id) ?? new Set<MaterialBuffer>();
      set.add(buffer);
      matBuffersRef.current.set(id, set);
      const generation = bufferGeneration();
      return {
        take: () => {
          const list = matParkedRef.current.get(id);
          const words = list?.pop() ?? null;
          if (list && list.length === 0) matParkedRef.current.delete(id);
          return words;
        },
        release: (words) => {
          set.delete(buffer);
          if (set.size === 0 && matBuffersRef.current.get(id) === set)
            matBuffersRef.current.delete(id);
          const m = matsRef.current.get(id);
          // Its play has closed, or the sheet did: those words were kept then.
          if (words && generation === bufferGeneration() && m && words.full !== m.content) {
            matParkedRef.current.set(id, [...(matParkedRef.current.get(id) ?? []), words]);
          }
          syncBeacon();
        },
      };
    },
    [],
  );
  const flushMaterial = useCallback(
    (id: string) =>
      Promise.all([...(matBuffersRef.current.get(id) ?? [])].map((b) => b.flush())).then(
        () => undefined,
      ),
    [],
  );
  /** Every open material's pending edits, awaited. */
  const flushAllMaterials = useCallback(
    () =>
      Promise.all(
        [...matBuffersRef.current.values()].flatMap((set) => [...set].map((b) => b.flush())),
      ).then(() => undefined),
    [],
  );

  /**
   * Words in open sheets that could not reach their files — behind a gate, or
   * refused by the disk — kept as pinned versions of those sheets before the
   * sheets go away. Taken from the editors now, while they still hold them.
   * Returns the ids of the sheets whose words could be kept nowhere, once each.
   */
  const keepUnsavedMaterials = useCallback(
    async (ids: string[]): Promise<string[]> => {
      const scope = currentScope();
      const playId = scope.playId;
      const lost = new Set<string>();
      // Saves already in line land first: what they carry is not "unsaved".
      await materialWrites(async () => true);
      if (!scope.isCurrent()) return ids;
      const pending = ids.flatMap((id) => unsavedTextsOf(id).map((text) => ({ id, text })));
      for (const { id, text } of pending) {
        try {
          if (!playId) throw new Error("no play");
          const pinned = await versions.snapshot(playId, id, "collision", text, "md");
          setPreserved((p) => [...p, pinned]);
        } catch {
          lost.add(id);
        }
      }
      return [...lost];
    },
    [materialWrites, unsavedTextsOf],
  );
  /** An open sheet's name as the binder shows it. */
  const sheetTitle = useCallback((id: string): string => {
    const item = openMaterialsRef.current[id]?.item;
    return item ? titleOf(item) : "A sheet";
  }, []);

  /** Close ONE material's buffer (the last tab showing it closing), its words kept first. */
  const closeMaterial = useCallback(
    (id: string) => {
      const scope = currentScope();
      // What the editors hold, taken before they unmount; written if it can be,
      // and otherwise kept as a version.
      const texts = unsavedTextsOf(id);
      void (async () => {
        await flushMaterial(id);
        await materialWrites(async () => true);
        if (!scope.isCurrent()) return;
        const m = matsRef.current.get(id);
        const playId = scope.playId;
        let kept = 0;
        let lost = false;
        for (const text of texts) {
          if (m && text === m.content) continue;
          try {
            if (!playId) throw new Error("no play");
            await versions.snapshot(playId, id, "collision", text, "md");
            kept++;
          } catch {
            lost = true;
            setError(
              `What was typed in “${m ? titleFromFileName(m.path) : "that sheet"}” couldn't be saved or kept in Versions. Its words stay in this window: open the sheet again to see them.`,
            );
          }
        }
        // The disk refused its last save, whose toast said the words were in
        // the window. The window is going: say where they are now.
        const refused = refusalFor(`sheet:${id}`);
        if (refused && kept > 0 && !lost) {
          const cause = saveProblem(refused.refusal, refused.subject);
          setError({
            title: `What was typed in “${refused.subject.name}” is kept in Versions, because it couldn't be saved.`,
            detail: cause.title,
            code: cause.code,
          });
        }
        if (!scope.isCurrent()) return;
        // Words that could be kept nowhere are not dropped with the tab, as they
        // once were: the buffer and the parked words stay, and the sheet shows
        // them again when it is next opened.
        if (!lost) {
          matsRef.current.delete(id);
          matParkedRef.current.delete(id);
        }
        matGatesRef.current.delete(id);
        matFailedRef.current.delete(id);
        forgetRefused((key) => key === `sheet:${id}`);
        setMaterialGates((cur) => {
          if (!(id in cur)) return cur;
          const next = { ...cur };
          delete next[id];
          return next;
        });
        setOpenMaterials((cur) => {
          if (!(id in cur)) return cur;
          const next = { ...cur };
          delete next[id];
          return next;
        });
        syncBeacon();
      })();
    },
    [flushMaterial, materialWrites, unsavedTextsOf, forgetRefused],
  );

  // Integrations operate on identities and snapshots; the maps and leases stay here.
  const record = useCallback(
    (id: string) => matsRef.current.get(id) as Readonly<MaterialRecord> | undefined,
    [],
  );
  const paths = useCallback(() => [...matsRef.current.values()].map((m) => m.path), []);
  const hasGate = useCallback((id: string) => matGatesRef.current.has(id), []);
  const bufferedIds = useCallback(
    () => [...new Set([...matBuffersRef.current.keys(), ...matParkedRef.current.keys()])],
    [],
  );
  const unsafe = useCallback(
    () =>
      matGatesRef.current.size > 0 ||
      matParkedRef.current.size > 0 ||
      [...matBuffersRef.current.values()].some((set) => [...set].some((b) => b.unsaved() !== null)),
    [],
  );
  const adopt = useCallback(
    (id: string, content: string, hash: string) => {
      const m = matsRef.current.get(id);
      if (!m) return;
      matsRef.current.set(id, { ...m, hash, content, keepMine: false });
      patchMaterial(id, content);
    },
    [patchMaterial],
  );
  const updateItem = useCallback((item: BinderItem) => {
    setOpenMaterials((cur) =>
      cur[item.id] && cur[item.id].item !== item
        ? { ...cur, [item.id]: { ...cur[item.id], item } }
        : cur,
    );
  }, []);
  const forget = useCallback((id: string) => {
    matsRef.current.delete(id);
    matGatesRef.current.delete(id);
    matParkedRef.current.delete(id);
    matFailedRef.current.delete(id);
    setMaterialGates((cur) => {
      const next = { ...cur };
      delete next[id];
      return next;
    });
    setOpenMaterials((cur) => {
      const next = { ...cur };
      delete next[id];
      return next;
    });
  }, []);
  const reset = useCallback(() => {
    matsRef.current.clear();
    matGatesRef.current.clear();
    matParkedRef.current.clear();
    matFailedRef.current.clear();
    setMaterialGates({});
    setOpenMaterials({});
  }, []);
  const recoveryCopies = useCallback(
    (pathFor: (id: string) => string | undefined): RecoveryBuffer[] => {
      const { playId } = currentScope();
      if (!playId) return [];
      const copies: RecoveryBuffer[] = [];
      const ids = new Set([...bufferedIds(), ...matFailedRef.current.keys()]);
      for (const id of ids) {
        const material = matsRef.current.get(id);
        const path = material?.path ?? pathFor(id);
        if (!path) continue;
        const live = unsavedTextsOf(id);
        const words = new Set(live.length ? live : (matFailedRef.current.get(id)?.keys() ?? []));
        [...words]
          .filter((text) => text !== material?.content)
          .forEach((content, index) =>
            copies.push({ key: `material:${id}:${index}`, playId, scriptId: id, path, content }),
          );
      }
      return copies;
    },
    [bufferedIds, unsavedTextsOf, currentScope],
  );

  const versionsOf = useCallback(
    (id: string): VersionsTarget | null => {
      const scope = currentScope();
      const playId = scope.playId;
      const sheet = openMaterialsRef.current[id];
      if (!playId || !sheet) return null;
      const list = () => versions.list(playId, id);
      const read = (name: string) => versions.read(playId, id, name);
      const current = () =>
        unsavedTextsOf(id)[0] ?? matsRef.current.get(id)?.content ?? sheet!.content;
      return {
        title: titleOf(sheet!.item),
        list,
        read,
        current,
        restore: async (name) => {
          try {
            const text = await read(name);
            if (!scope.isCurrent()) return false;
            // Every unsaved text is kept first — two panes can hold two — and
            // what the file has now, so a restore can be undone too.
            for (const kept of new Set([
              ...unsavedTextsOf(id),
              matsRef.current.get(id)?.content ?? "",
            ])) {
              if (kept) await versions.snapshot(playId, id, "pre-restore", kept, "md");
            }
            const ok = await materialWrites(async () => {
              const m = matsRef.current.get(id);
              if (!m) return false;
              if (matGatesRef.current.has(id)) {
                setError("Choose between the two versions of this sheet first.");
                return false;
              }
              if (!scope.isCurrent()) return false;
              return writeMaterialNow(id, text, m.content, scope);
            });
            if (ok) {
              matParkedRef.current.delete(id);
              syncBeacon();
              patchMaterial(id, text, true);
            }
            return ok;
          } catch (e) {
            setError(String(e));
            return false;
          }
        },
      };
    },
    [
      currentScope,
      unsavedTextsOf,
      materialWrites,
      writeMaterialNow,
      patchMaterial,
      syncBeacon,
      setError,
    ],
  );
  const onExternal = useCallback(
    (path: string, hash: string | null): boolean => {
      const id = idForMaterialPath(path);
      const material = id ? matsRef.current.get(id) : null;
      if (!id || !material) return false;
      if (hash === null || hash === material.hash) return true;
      const scope = currentScope();
      void (async () => {
        try {
          const fresh = await scope.io.read(material.path);
          if (!scope.isCurrent()) return;
          const now = matsRef.current.get(id);
          if (now?.path !== material.path || fresh.hash === now.hash) return;
          if (materialUnsaved(id))
            raiseMaterialGate(id, { path: material.path, theirs: fresh.content, hash: fresh.hash });
          else {
            adopt(id, fresh.content, fresh.hash);
            setSheetStatus("saved");
          }
        } catch {
          /* Unreadable: keep the buffer unchanged. */
        }
      })();
      return true;
    },
    [idForMaterialPath, currentScope, materialUnsaved, raiseMaterialGate, adopt, setSheetStatus],
  );

  const settle = useCallback(async (): Promise<MaterialSettlement> => {
    await flushAllMaterials();
    const ids = bufferedIds();
    const unsavedKeys = ids
      .filter((id) => unsavedTextsOf(id).length > 0)
      .map((id) => `sheet:${id}`);
    const notKept = new Set(await keepUnsavedMaterials(ids));
    return {
      unsavedKeys,
      lostTitles: [...notKept].map(sheetTitle),
      remaining: ids
        .filter((id) => unsavedTextsOf(id).length > 0)
        .map((id) => ({
          key: `sheet:${id}`,
          kind: "document" as const,
          title: sheetTitle(id),
          path: matsRef.current.get(id)?.path ?? null,
          inVersions: !notKept.has(id),
        })),
    };
  }, [flushAllMaterials, bufferedIds, unsavedTextsOf, keepUnsavedMaterials, sheetTitle]);

  const applyBinder = useCallback(
    (binder: BinderItem[], forgetRemoved: boolean) => {
      for (const [id, m] of [...matsRef.current]) {
        const now = findItem(binder, id)?.item;
        if (!now?.path) {
          if (!forgetRemoved) continue;
          // Deleted, or filed out of the binder: drop the buffer rather than
          // leave a pane writing into nothing — after what it held that never
          // landed is kept in Versions. Taken now, while the editors still
          // hold it: they go away with the sheet.
          const texts = unsavedTextsOf(id);
          const title = titleFromFileName(m.path);
          const playId = currentScope().playId;
          void (async () => {
            for (const text of texts) {
              try {
                if (!playId) throw new Error("no play");
                const pinned = await versions.snapshot(playId, id, "collision", text, "md");
                setPreserved((p) => [...p, pinned]);
              } catch {
                setError(`What was typed in “${title}” couldn't be kept.`);
              }
            }
          })();
          forget(id);
          syncBeacon();
          continue;
        }
        const nextPath = now.path;
        retargetMaterial(id, nextPath);
        updateItem(now);
      }
    },
    [
      currentScope,
      unsavedTextsOf,
      setPreserved,
      setError,
      forget,
      syncBeacon,
      retargetMaterial,
      updateItem,
    ],
  );

  return {
    applyBinder,
    settle,
    versionsOf,
    onExternal,
    openMaterials,
    materialGates,
    materialUnsaved,
    unsavedTextsOf,
    idForMaterialPath,
    openMaterial,
    saveMaterial,
    setMaterialField,
    editMaterialTags,
    setMaterialDirty,
    resolveMaterialGate,
    registerMaterialBuffer,
    flushMaterial,
    flushAllMaterials,
    closeMaterial,
    materialWrites,
    record,
    paths,
    hasGate,
    unsafe,
    adopt,
    reset,
    recoveryCopies,
  };
}
