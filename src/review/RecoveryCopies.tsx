// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState } from "react";
import { recovery } from "../storage";
import { decodeSnapshot } from "../storage/recovery-policy";
import type { SavedCopy } from "../storage/ipc";
import type { BinderItem } from "../workspace/play-file";
import { flatten } from "../workspace/binder";
import { announce } from "../ui/announce";

export interface RecoveryCopiesState {
  copies: SavedCopy[];
  error: string | null;
  read(id: string): Promise<string>;
}

/** Sheet/outline recovery includes notes whose first file could not be made.
 * It stays readable in Changes, without guessing which current file to replace. */
export function useRecoveryCopies(
  playId: string | null,
  root: string | null,
  binder: BinderItem[],
): RecoveryCopiesState {
  const binderRef = useRef(binder);
  binderRef.current = binder;
  const [state, setState] = useState<{
    playId: string | null;
    root: string | null;
    copies: SavedCopy[];
    words: Map<string, string>;
    error: string | null;
  }>({
    playId: null,
    root: null,
    copies: [],
    words: new Map(),
    error: null,
  });
  useEffect(() => {
    if (!playId || !root) return;
    let live = true,
      turn = 0;
    let known = new Set<string>();
    const refresh = async () => {
      const generation = ++turn;
      try {
        const files = await recovery.list(playId);
        if (!live || generation !== turn) return;
        const scripts = new Set(
          flatten(binderRef.current)
            .filter((row) => row.type === "script")
            .map((row) => row.id),
        );
        const copies: SavedCopy[] = [],
          words = new Map<string, string>();
        for (const file of files) {
          if (scripts.has(file.scriptId)) continue; // the script's existing recovery offer owns these
          const snapshot = decodeSnapshot(file.content);
          const id = `${file.scriptId}/${file.owner}`;
          copies.push({
            id,
            rel: snapshot?.path || "Recovered document",
            hash: "",
            createdMs: snapshot?.savedAtMs ?? 0,
          });
          words.set(id, snapshot?.content ?? file.content);
        }
        copies.sort((a, b) => b.createdMs - a.createdMs);
        if (copies.some((copy) => !known.has(copy.id)))
          announce("Recovered document copies are available in Changes.");
        known = new Set(copies.map((copy) => copy.id));
        setState({ playId, root, copies, words, error: null });
      } catch {
        if (live && generation === turn)
          setState((prior) => ({
            playId,
            root,
            copies: prior.playId === playId && prior.root === root ? prior.copies : [],
            words: prior.playId === playId && prior.root === root ? prior.words : new Map(),
            error: "Recovered document copies could not be read. Return to the app to try again.",
          }));
      }
    };
    const foreground = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    void refresh();
    window.addEventListener("focus", foreground);
    document.addEventListener("visibilitychange", foreground);
    return () => {
      live = false;
      window.removeEventListener("focus", foreground);
      document.removeEventListener("visibilitychange", foreground);
    };
  }, [playId, root]);
  const read = useCallback(
    async (id: string) => {
      const words = state.words.get(id);
      if (state.playId !== playId || state.root !== root || words === undefined)
        throw new Error("That recovered copy is in another play.");
      return words;
    },
    [state, playId, root],
  );
  return state.playId === playId && state.root === root
    ? { copies: state.copies, error: state.error, read }
    : { copies: [], error: null, read };
}
