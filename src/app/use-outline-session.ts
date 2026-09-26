// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { VaultWriteError, versions, type SaveProblem, type SaveSubject } from "../storage";
import type { RecoveryBuffer } from "../storage/buffer-recovery";
import { defaultDirFor } from "../materials";
import { findItem } from "../workspace/binder";
import {
  buildsOn,
  rememberFailed,
  splitFrontMatter,
  withFrontMatter,
  samePath,
  hasContent,
  findOutlineNote,
  newMaterial,
  OUTLINE_NOTE_TITLE,
  type BinderItem,
  type BinderContext,
  type ApplyResult,
  type BufferLease,
  type MaterialBuffer,
  type ParkedWords,
} from "../workspace";
import { oneAtATime, type Line } from "./one-at-a-time";
import type { SaveStatus, VersionsTarget } from "./useWorkspace";
import type { DocumentScope } from "./document-scope";

type BinderOperation = (
  fn: (ctx: BinderContext) => Promise<ApplyResult>,
) => Promise<ApplyResult | undefined>;
type OutlineRecord = {
  id: string;
  path: string;
  hash: string;
  header: string | null;
  body: string;
};
interface Host {
  currentScope: () => DocumentScope;
  bufferGeneration: () => number;
  syncBeacon: () => void;
  captureRecovery: () => void;
  setSheetStatus: (status: SaveStatus) => void;
  setError: Dispatch<SetStateAction<string | SaveProblem | null>>;
  setPreserved: Dispatch<SetStateAction<string[]>>;
  saveLanded: (key: string) => void;
  saveRefused: (key: string, error: VaultWriteError, subject: SaveSubject) => void;
  saveSubject: (kind: SaveSubject["kind"], path: string) => SaveSubject;
  runBinderOp: BinderOperation;
  binderOpNow: BinderOperation;
}

/** Owns the scratchpad before its first file exists, and throughout its lifetime. */
export function useOutlineSession(binder: BinderItem[], host: Host) {
  const hostRef = useRef(host);
  hostRef.current = host;
  const {
    currentScope,
    bufferGeneration,
    syncBeacon,
    captureRecovery,
    setSheetStatus,
    setError,
    setPreserved,
    saveLanded,
    saveRefused,
    saveSubject,
    runBinderOp,
    binderOpNow,
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
      setError: (...args: Parameters<Host["setError"]>) => hostRef.current.setError(...args),
      setPreserved: (...args: Parameters<Host["setPreserved"]>) =>
        hostRef.current.setPreserved(...args),
      saveLanded: (...args: Parameters<Host["saveLanded"]>) => hostRef.current.saveLanded(...args),
      saveRefused: (...args: Parameters<Host["saveRefused"]>) =>
        hostRef.current.saveRefused(...args),
      saveSubject: (...args: Parameters<Host["saveSubject"]>) =>
        hostRef.current.saveSubject(...args),
      runBinderOp: (...args: Parameters<Host["runBinderOp"]>) =>
        hostRef.current.runBinderOp(...args),
      binderOpNow: (...args: Parameters<Host["binderOpNow"]>) =>
        hostRef.current.binderOpNow(...args),
    }),
    [],
  );
  // The outline scratchpad. Body in state (the surface renders it); path, hash
  // and the untouched front matter in a ref, so a save can put the header back
  // without the view ever having to know about it.
  const [outlineBody, setOutlineBody] = useState("");
  const outlineBodyRef = useRef("");
  outlineBodyRef.current = outlineBody;
  const outlineRef = useRef<OutlineRecord | null>(null);
  const [outlineNotePath, setOutlineNotePath] = useState<string | null>(null);
  // Guards the lazy first write: two debounced saves must not race into two notes.
  const outlineBirthRef = useRef(false);
  // Unsaved edits in the scratchpad's own buffer, as it last reported them.
  const outlineDirtyRef = useRef(false);
  /** The note exists but has not been read yet: nothing typed may be saved over it. */
  const [outlineLoading, setOutlineLoading] = useState(false);
  const outlineLoadingRef = useRef(false);
  outlineLoadingRef.current = outlineLoading;
  /** Bumped when the scratchpad must take `outlineBody` whatever it holds. */
  const [outlineReset, setOutlineReset] = useState(0);
  /** Another version of the note, held while the writer chooses (like a sheet's gate). */
  const [outlineGate, setOutlineGate] = useState<{ theirs: string; hash: string } | null>(null);
  const outlineGateRef = useRef<{ theirs: string; hash: string } | null>(null);
  outlineGateRef.current = outlineGate;
  /** The scratchpad editors' buffers (MaterialBuffer), for leaving the play. */
  const outlineBuffersRef = useRef(new Set<MaterialBuffer>());
  /**
   * What scratchpads held unsaved when they went away, oldest first, each with
   * the note it was written on — so a save, or leaving the play, can tell words
   * written on the note as it is from words another save has overtaken.
   */
  const outlineParkedRef = useRef<ParkedWords[]>([]);
  /** Saves of the note that did not land, each with the body it was built on (`buildsOn`). */
  const outlineFailedRef = useRef(new Map<string, string>());
  /** The writer chose their notes over another version: the next save goes over it, once. */
  const outlineKeepMineRef = useRef(false);
  /** The note's writes, one at a time: each expects the hash the last one left. */
  const outlineWritesRef = useRef<Line | null>(null);
  if (!outlineWritesRef.current) outlineWritesRef.current = oneAtATime();
  const outlineWrites = outlineWritesRef.current;
  const setOutlineDirty = useCallback((dirty: boolean) => {
    outlineDirtyRef.current = dirty;
    syncBeacon();
  }, []);

  // --- the outline scratchpad (outline-note.ts) ---
  // Read once per note, keyed on its id: saves change the binder (and so re-run
  // this effect) but not the id, so the writer's buffer is never yanked out from
  // under them mid-sentence.
  useEffect(() => {
    const item = findOutlineNote(binder);
    if (!item?.path) {
      if (outlineRef.current) {
        outlineRef.current = null;
        setOutlineBody("");
        setOutlineNotePath(null);
      }
      setOutlineLoading(false);
      return;
    }
    if (outlineRef.current?.id === item.id) {
      // Renamed or moved, here or somewhere else: the scratchpad follows its
      // file. Left at the old path, the next save recreated the old name.
      if (outlineRef.current.path !== item.path) {
        outlineRef.current = { ...outlineRef.current, path: item.path };
        setOutlineNotePath(item.path);
      }
      return;
    }
    // Being made right now, from what is on the page: reading the new, empty
    // note back into the scratchpad would wipe the words it is being made from.
    if (outlineBirthRef.current) return;
    const scope = currentScope();
    const path = item.path;
    let cancelled = false;
    setOutlineLoading(true);
    void (async () => {
      try {
        const { content, hash } = await scope.io.read(path);
        if (cancelled || !scope.isCurrent()) return;
        const fm = splitFrontMatter(content);
        outlineRef.current = { id: item.id, path, hash, header: fm.header, body: fm.body };
        outlineFailedRef.current.clear();
        outlineKeepMineRef.current = false;
        setOutlineBody(fm.body);
        setOutlineReset((n) => n + 1);
        setOutlineNotePath(item.path ?? null);
      } catch (e) {
        if (!cancelled && scope.isCurrent()) setError(String(e));
      } finally {
        if (!cancelled && scope.isCurrent()) setOutlineLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [binder]);

  /**
   * Persist the outline scratchpad, creating it on the first real keystroke.
   * Empty stays empty: looking at the Outline surface never puts a file in the
   * play. Once it exists, this is an ordinary guarded material write — the front
   * matter goes back exactly as it was read.
   */
  /**
   * Where the outline note is, or where it would be made (newMaterial's home
   * for an outline). A refused first note used to be named by its file alone,
   * so the message blamed the play's folder when the locked one was Notes.
   */
  const outlineNotePathOrHome = useCallback((): string => {
    const made = outlineRef.current?.path;
    if (made) return made;
    const dir = defaultDirFor("outline");
    const file = `${OUTLINE_NOTE_TITLE}.md`;
    return dir ? `${dir}/${file}` : file;
  }, []);

  const writeOutline = useCallback(
    async (
      body: string,
      binderOp: (
        fn: (ctx: BinderContext) => Promise<ApplyResult>,
      ) => Promise<ApplyResult | undefined>,
      base?: string,
    ): Promise<boolean> => {
      const scope = currentScope();
      if (!scope.isCurrent()) return false;
      // Not written: remembered as a save that never landed, built on `base`.
      const refused = () => {
        if (base !== undefined) rememberFailed(outlineFailedRef.current, body, base);
        captureRecovery();
        return false;
      };
      // Still being read: whatever was typed on the empty page is not written
      // over the note that is about to arrive.
      if (outlineLoadingRef.current || outlineGateRef.current) return refused();
      let target = outlineRef.current;
      let born = false;
      if (!target) {
        if (!hasContent(body) || outlineBirthRef.current) return refused();
        outlineBirthRef.current = true;
        try {
          const res = await binderOp((c) => {
            if (!scope.isCurrent())
              throw new Error("This outline belongs to a play that has closed.");
            return newMaterial(c, null, "outline", OUTLINE_NOTE_TITLE);
          });
          if (!scope.isCurrent()) return false;
          if (!res?.ok || !res.createdId) return refused();
          const item = findItem(res.play.binder, res.createdId)?.item;
          if (!item?.path) return refused();
          const path = item.path;
          const { content, hash } = await scope.io.read(path);
          if (!scope.isCurrent()) return false;
          const fm = splitFrontMatter(content);
          target = { id: item.id, path, hash, header: fm.header, body: fm.body };
          outlineRef.current = target;
          setOutlineNotePath(item.path);
          born = true;
        } catch (e) {
          if (!scope.isCurrent()) return false;
          if (e instanceof VaultWriteError) {
            saveRefused("outline", e, saveSubject("outline", outlineNotePathOrHome()));
          } else setError(String(e));
          return refused();
        } finally {
          outlineBirthRef.current = false;
        }
      }
      // In line: two saves out at once used to collide with each other, the
      // second expecting the hash from before the first had landed.
      const noteId = target.id;
      return outlineWrites(async () => {
        if (!scope.isCurrent()) return false;
        const note = outlineRef.current;
        if (!note || note.id !== noteId || outlineGateRef.current) return refused();
        // Written on notes that have since been replaced — another pane's save,
        // or another device's — so nothing is written and the writer chooses,
        // as with a sheet. It used to go over them with the newest hash.
        if (
          !born &&
          base !== undefined &&
          !outlineKeepMineRef.current &&
          !buildsOn(base, note.body, outlineFailedRef.current)
        ) {
          const gate = { theirs: withFrontMatter(note.header, note.body), hash: note.hash };
          outlineGateRef.current = gate;
          setOutlineGate(gate);
          setSheetStatus("conflict");
          return refused();
        }
        setSheetStatus("saving");
        try {
          const outcome = await scope.io.write(
            note.path,
            withFrontMatter(note.header, body),
            note.hash,
          );
          if (!scope.isCurrent()) return false;
          if (outcome.status === "ok") {
            if (outlineRef.current?.id === noteId) {
              outlineRef.current = { ...outlineRef.current, hash: outcome.hash, body };
              // What the next scratchpad starts from. It used to stay the text
              // as read, so leaving the Outline surface and coming back showed
              // the old notes — and the next keystroke saved them over the file.
              setOutlineBody(body);
            }
            outlineKeepMineRef.current = false;
            outlineFailedRef.current.delete(body);
            outlineParkedRef.current = outlineParkedRef.current.filter((p) => p.full !== body);
            syncBeacon();
            saveLanded("outline");
            setSheetStatus("saved");
            return true;
          }
          // Changed somewhere else. Nothing is written; the writer chooses, as
          // with a sheet — this used to leave the old hash in place, so every
          // later save failed, and the only advice was to reopen the play.
          refused();
          const fresh = await scope.io.read(note.path);
          if (scope.isCurrent() && outlineRef.current?.id === noteId) {
            const gate = { theirs: fresh.content, hash: fresh.hash };
            outlineGateRef.current = gate;
            setOutlineGate(gate);
            setSheetStatus("conflict");
          }
          return false;
        } catch (e) {
          if (!scope.isCurrent()) return false;
          if (e instanceof VaultWriteError)
            saveRefused("outline", e, saveSubject("outline", note.path));
          else setError(String(e));
          setSheetStatus("idle");
          return refused();
        }
      });
    },
    [setSheetStatus, outlineWrites, saveLanded, saveRefused, saveSubject],
  );
  const saveOutlineNote = useCallback(
    (body: string, base?: string) => writeOutline(body, runBinderOp, base),
    [writeOutline, runBinderOp],
  );

  /**
   * The scratchpad's unsaved words, for leaving the play or quitting: written
   * if they can be — from inside the line, so a first note is made without
   * waiting on it — and otherwise kept as a version of the note. Words kept
   * nowhere stay where they were, and when `quitting`, so does every word a
   * scratchpad left that did not land: a quit that is called off goes on with
   * the play as it was.
   */
  const keepOutlineInLine = useCallback(
    async (quitting = false): Promise<"landed" | "kept" | "lost"> => {
      const scope = currentScope();
      // Saves already in line land first.
      await outlineWrites(async () => true);
      if (!scope.isCurrent())
        return outlineParkedRef.current.length ||
          [...outlineBuffersRef.current].some((buffer) => buffer.unsaved() !== null)
          ? "lost"
          : "landed";
      // The words to write: the first written on the note as it is now — what a
      // scratchpad on screen holds, then the newest a scratchpad left. The rest
      // were written on notes a later save replaced, and are kept as versions,
      // never written over the newer notes.
      const onDisk = outlineRef.current?.body ?? "";
      const live = [...outlineBuffersRef.current]
        .map((b) => b.words())
        .filter((w): w is ParkedWords => w !== null);
      const parked = [...outlineParkedRef.current].reverse();
      outlineParkedRef.current = [];
      const unsaved = [...live, ...parked].filter((w) => w.full !== onDisk);
      const write = unsaved.find((w) => buildsOn(w.base, onDisk, outlineFailedRef.current)) ?? null;
      const pin = [...new Set(unsaved.map((w) => w.full))].filter((t) => t !== write?.full);
      let outcome: "landed" | "kept" | "lost" = "landed";
      const keptNowhere = new Set<string>();
      const tasks: { text: string; base?: string; land: boolean }[] = [
        ...(write ? [{ text: write.full, base: write.base, land: true }] : []),
        ...pin.map((text) => ({ text, land: false })),
      ];
      let landed: string | null = null;
      for (const { text, base, land } of tasks) {
        if (land && (await writeOutline(text, binderOpNow, base))) {
          landed = text;
          continue;
        }
        const playId = scope.playId;
        const note = outlineRef.current;
        try {
          if (!playId) throw new Error("no play");
          // A note still being made has no id of its own yet; its words are kept
          // under the scratchpad's name.
          await versions.snapshot(
            playId,
            note?.id ?? "outline",
            "collision",
            note ? withFrontMatter(note.header, text) : text,
            "md",
          );
          if (outcome === "landed") outcome = "kept";
        } catch {
          outcome = "lost";
          keptNowhere.add(text);
        }
      }
      // Words a scratchpad left go back to the front of the list, oldest first:
      // those kept nowhere, which taken out above were gone from the app
      // entirely, and for a quit, all but the words that landed.
      const back = parked
        .filter((w) => (quitting ? w.full !== landed : keptNowhere.has(w.full)))
        .reverse();
      if (back.length) outlineParkedRef.current = [...back, ...outlineParkedRef.current];
      return outcome;
    },
    [writeOutline, binderOpNow, outlineWrites],
  );

  /** The writer's answer to the scratchpad's gate — the same two choices a sheet gets. */
  const resolveOutlineGate = useCallback(
    async (choice: "mine" | "theirs") => {
      const scope = currentScope();
      const gate = outlineGateRef.current;
      const note = outlineRef.current;
      if (!gate || !note) return;
      if (choice === "theirs") {
        // The writer's own words are kept first (docs/app/keeping-work/storage-and-file-format.md#STOR-D9), or nothing is replaced.
        const ours = [
          ...new Set(
            [
              ...[...outlineBuffersRef.current].map((b) => b.unsaved()),
              ...outlineParkedRef.current.map((p) => p.full),
            ].filter((t): t is string => t !== null),
          ),
        ];
        const playId = scope.playId;
        try {
          for (const text of ours) {
            if (!playId) throw new Error("no play");
            const pinned = await versions.snapshot(
              playId,
              note.id,
              "pre-reload-at-banner",
              withFrontMatter(note.header, text),
              "md",
            );
            setPreserved((p) => [...p, pinned]);
          }
        } catch {
          setError("Your version couldn't be kept in Versions, so nothing was replaced.");
          return;
        }
        if (!scope.isCurrent()) return;
        const split = splitFrontMatter(gate.theirs);
        const cur = outlineRef.current;
        if (!cur) return;
        outlineRef.current = { ...cur, hash: gate.hash, header: split.header, body: split.body };
        outlineGateRef.current = null;
        setOutlineGate(null);
        outlineParkedRef.current = [];
        outlineFailedRef.current.clear();
        outlineKeepMineRef.current = false;
        syncBeacon();
        setOutlineBody(split.body);
        setOutlineReset((n) => n + 1);
        setSheetStatus("saved");
        return;
      }
      const playId = scope.playId;
      try {
        if (!playId) throw new Error("no play");
        const pinned = await versions.snapshot(playId, note.id, "pre-keep", gate.theirs, "md");
        setPreserved((p) => [...p, pinned]);
      } catch {
        setError("The other version couldn't be kept in Versions, so nothing was replaced.");
        return;
      }
      if (!scope.isCurrent()) return;
      const theirs = splitFrontMatter(gate.theirs);
      const cur = outlineRef.current;
      if (!cur) return;
      outlineRef.current = { ...cur, hash: gate.hash, header: theirs.header, body: theirs.body };
      setOutlineGate(null);
      outlineGateRef.current = null;
      // The writer's next save goes over theirs, once: they are in Versions now.
      outlineKeepMineRef.current = true;
      const live = [...outlineBuffersRef.current];
      const parked = outlineParkedRef.current;
      if (live.some((b) => b.unsaved() !== null)) {
        // Words on screen: they go now.
        await Promise.all(live.map((b) => b.flush()));
      } else if (parked.length) {
        // None on screen — they went with a scratchpad switched away, perhaps in
        // the other pane, where answering used to write nothing: the newest go.
        const newest = parked[parked.length - 1];
        await saveOutlineNote(newest.full, newest.base);
      } else {
        // Nothing unsaved anywhere: the page as it stands is the one kept.
        const page = live[0]?.page();
        if (page !== undefined && page !== theirs.body) {
          await saveOutlineNote(page);
        } else {
          outlineKeepMineRef.current = false;
          setSheetStatus("saved");
        }
      }
      syncBeacon();
    },
    [setSheetStatus, saveOutlineNote],
  );

  const versionsOf = useCallback(
    (id: string): VersionsTarget | null => {
      const scope = currentScope();
      const playId = scope.playId;
      if (!playId) return null;
      const note = outlineRef.current;
      const isOutline = id === "outline" || note?.id === id;
      if (!isOutline) return null;
      if (isOutline) {
        // Words kept before the note existed are under the scratchpad's own
        // name, where the note's Versions never looked: they show here too.
        const earlier = note && id !== "outline";
        const list = async () => {
          const own = await versions.list(playId, id);
          if (!earlier) return own;
          const before = await versions.list(playId, "outline").catch(() => []);
          return [...own, ...before].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
        };
        const read = async (name: string) => {
          try {
            return await versions.read(playId, id, name);
          } catch (e) {
            if (!earlier) throw e;
            return versions.read(playId, "outline", name);
          }
        };
        const current = () => {
          const words =
            [...outlineBuffersRef.current].map((b) => b.unsaved()).find((t) => t !== null) ??
            outlineParkedRef.current[outlineParkedRef.current.length - 1]?.full ??
            outlineRef.current?.body ??
            outlineBodyRef.current;
          const n = outlineRef.current;
          return n ? withFrontMatter(n.header, words) : words;
        };
        return {
          title: "Outline notes",
          list,
          read,
          current,
          restore: async (name) => {
            try {
              const text = await read(name);
              if (!scope.isCurrent()) return false;
              // Everything there now is kept first — each scratchpad's unsaved
              // words, and the note — so a restore can be undone too. Only the
              // first used to be, and the rest were cleared with it.
              const n = outlineRef.current;
              const ours = [
                ...new Set(
                  [
                    ...[...outlineBuffersRef.current].map((b) => b.unsaved()),
                    ...outlineParkedRef.current.map((p) => p.full),
                    n?.body ?? outlineBodyRef.current,
                  ].filter((t): t is string => t !== null),
                ),
              ];
              for (const words of ours) {
                await versions.snapshot(
                  playId,
                  id,
                  "pre-restore",
                  n ? withFrontMatter(n.header, words) : words,
                  "md",
                );
              }
              const body = splitFrontMatter(text).body;
              if (!scope.isCurrent()) return false;
              const ok = await writeOutline(body, runBinderOp);
              if (ok) {
                outlineParkedRef.current = [];
                syncBeacon();
                setOutlineBody(body);
                setOutlineReset((r) => r + 1);
              }
              return ok;
            } catch (e) {
              setError(String(e));
              return false;
            }
          },
        };
      }
      return null;
    },
    [writeOutline, runBinderOp],
  );

  const registerOutlineBuffer = useCallback((buffer: MaterialBuffer): BufferLease<ParkedWords> => {
    outlineBuffersRef.current.add(buffer);
    const generation = bufferGeneration();
    return {
      take: () => outlineParkedRef.current.pop() ?? null,
      release: (words) => {
        outlineBuffersRef.current.delete(buffer);
        // Its play has closed: leaving it already kept those words.
        if (
          words &&
          generation === bufferGeneration() &&
          currentScope().playId !== null &&
          words.full !== outlineRef.current?.body
        ) {
          outlineParkedRef.current = [...outlineParkedRef.current, words];
        }
        syncBeacon();
      },
    };
  }, []);

  const recoveryCopies = useCallback((): RecoveryBuffer[] => {
    const { playId } = currentScope();
    if (!playId) return [];
    const copies: RecoveryBuffer[] = [];
    const note = outlineRef.current;
    const liveBodies = [
      ...[...outlineBuffersRef.current].map((buffer) => buffer.unsaved()),
      ...outlineParkedRef.current.map((words) => words.full),
    ].filter((body): body is string => body !== null);
    const bodies = new Set(liveBodies.length ? liveBodies : outlineFailedRef.current.keys());
    [...bodies]
      .filter((body): body is string => body !== null && body !== note?.body)
      .forEach((body, index) => {
        if (!note && !hasContent(body)) return;
        const home = [defaultDirFor("outline"), `${OUTLINE_NOTE_TITLE}.md`]
          .filter(Boolean)
          .join("/");
        copies.push({
          key: `outline:${index}`,
          playId,
          scriptId: note?.id ?? "outline-unsaved",
          path: note?.path ?? home,
          content: withFrontMatter(note?.header ?? "", body),
        });
      });
    return copies;
  }, [currentScope]);

  const record = useCallback(() => outlineRef.current as Readonly<OutlineRecord> | null, []);
  const hasUnsaved = useCallback(
    () =>
      outlineParkedRef.current.length > 0 ||
      [...outlineBuffersRef.current].some((b) => b.unsaved() !== null),
    [],
  );
  const unsafe = useCallback(() => outlineGateRef.current !== null || hasUnsaved(), [hasUnsaved]);
  const flush = useCallback(
    () => Promise.all([...outlineBuffersRef.current].map((b) => b.flush())).then(() => undefined),
    [],
  );
  const reset = useCallback(() => {
    outlineRef.current = null;
    setOutlineBody("");
    setOutlineNotePath(null);
    setOutlineGate(null);
    outlineGateRef.current = null;
    outlineParkedRef.current = [];
    outlineFailedRef.current.clear();
    outlineKeepMineRef.current = false;
  }, []);
  const adoptWrite = useCallback((path: string, content: string, hash: string) => {
    const note = outlineRef.current;
    if (!note || !samePath(note.path, path)) return;
    const split = splitFrontMatter(content);
    outlineRef.current = { ...note, hash, header: split.header, body: split.body };
    outlineKeepMineRef.current = false;
    setOutlineBody(split.body);
  }, []);
  const onExternal = useCallback(
    (path: string, hash: string | null): boolean => {
      // The open OUTLINE scratchpad — same rule, simpler surface.
      const scope = currentScope();
      const outline = outlineRef.current;
      if (outline && path === outline.path) {
        void (async () => {
          if (hash === null || hash === outline.hash) return;
          try {
            const fresh = await scope.io.read(outline.path);
            if (!scope.isCurrent()) return;
            const now = outlineRef.current;
            if (now?.path !== outline.path || fresh.hash === now.hash) return;
            if (
              [...outlineBuffersRef.current].some((b) => b.unsaved() !== null) ||
              outlineParkedRef.current.length > 0
            ) {
              // Words of the writer's own — on screen, or left by a scratchpad
              // switched away, which used to count for nothing, so the other
              // version was written over — and nothing replaces either until
              // they choose.
              const gate = { theirs: fresh.content, hash: fresh.hash };
              outlineGateRef.current = gate;
              setOutlineGate(gate);
              setSheetStatus("conflict");
              return;
            }
            const split = splitFrontMatter(fresh.content);
            outlineRef.current = {
              ...now,
              hash: fresh.hash,
              header: split.header,
              body: split.body,
            };
            outlineKeepMineRef.current = false;
            setOutlineBody(split.body);
            setOutlineReset((n) => n + 1);
          } catch {
            /* unreadable right now: the scratchpad keeps what it shows (docs/app/keeping-work/storage-and-file-format.md#STOR-104) */
          }
        })();
        return true;
      }

      return false;
    },
    [currentScope, setSheetStatus],
  );

  return {
    outlineBody,
    outlineNotePath,
    outlineLoading,
    outlineReset,
    outlineGate,
    setOutlineDirty,
    saveOutlineNote,
    resolveOutlineGate,
    registerOutlineBuffer,
    outlineNotePathOrHome,
    keepOutlineInLine,
    versionsOf,
    recoveryCopies,
    record,
    hasUnsaved,
    unsafe,
    flush,
    reset,
    adoptWrite,
    onExternal,
  };
}
