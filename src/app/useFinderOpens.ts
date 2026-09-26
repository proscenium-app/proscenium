// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Files opened from Finder, routed (docs/app/keeping-work/storage-and-file-format.md#STOR-D5, docs/app/keeping-work/storage-and-file-format.md#STOR-D12).
 *
 * Rust queues what Finder hands the app — including what arrives before the
 * window exists — and this drains the queue once the last Plays folder has been
 * tried, then again on every `app://opened` signal. Each path is classified
 * (`classifyOpened`, pure and tested) and handled in order, one at a time, so
 * two files opened together never race each other for the vault:
 *
 *  - a play, or a script in one, in the open Plays folder: open it, the script
 *    in front;
 *  - the same, in another folder: ask to use that folder as the Plays folder,
 *    or cancel. Nothing is ever moved;
 *  - a loose script: ask to make a play from it, the script copied in;
 *  - an `.fdx`: it becomes a play, the file kept beside the script —
 *    unless it already sits in a play, which is then what opens;
 *  - anything else: say so.
 *
 * A file that needs a Plays folder when there is none yet waits — out of the
 * way of the files behind it, which may not need one — and goes as soon as the
 * writer chooses one.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { onOpened, opened } from "../storage";
import type { ToastSpec } from "../ui";
import { classifyOpened, inPlaysFolder, type PlayLocation } from "../workspace";
import type { Workspace } from "./useWorkspace";

/** A question for the writer, shown as a sheet until answered. */
export type OpenRequest =
  | {
      kind: "adopt-folder";
      /** The play's name — its folder's name. */
      playTitle: string;
      /** The folder it would become the Plays folder. */
      playsFolder: string;
      /** Whether the app has a Plays folder at all yet. */
      hasPlaysFolder: boolean;
    }
  | { kind: "make-play"; fileName: string };

type Outcome = "done" | "wait";

export function useFinderOpens(
  ws: Workspace,
  notify: (t: ToastSpec) => void,
  reviewImport: (path: string) => Promise<void>,
) {
  const [request, setRequest] = useState<OpenRequest | null>(null);
  const answerRef = useRef<((yes: boolean) => void) | null>(null);
  const queue = useRef<string[]>([]);
  /** Files that need a Plays folder, set aside until there is one. */
  const waiting = useRef<string[]>([]);
  const busy = useRef(false);
  // Routing awaits the writer for as long as they take; it has to read the
  // workspace as it is then, not as it was when the file arrived.
  const wsRef = useRef(ws);
  wsRef.current = ws;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const importRef = useRef(reviewImport);
  importRef.current = reviewImport;

  const ask = (req: OpenRequest) =>
    new Promise<boolean>((resolve) => {
      answerRef.current = resolve;
      setRequest(req);
    });

  const answer = useCallback((yes: boolean) => {
    const resolve = answerRef.current;
    answerRef.current = null;
    setRequest(null);
    resolve?.(yes);
  }, []);

  const openPlay = async (at: PlayLocation, script: string | null): Promise<Outcome> => {
    const w = wsRef.current;
    if (inPlaysFolder(at, w.vaultRoot)) {
      await w.openPlayByDir(at.dirName, script, at.playsFolder);
      return "done";
    }
    const yes = await ask({
      kind: "adopt-folder",
      playTitle: at.dirName,
      playsFolder: at.playsFolder,
      hasPlaysFolder: w.vaultRoot !== null,
    });
    if (!yes) return "done";
    if (await wsRef.current.adoptPlaysFolder(at.playsFolder)) {
      await wsRef.current.openPlayByDir(at.dirName, script, at.playsFolder);
    }
    return "done";
  };

  const waitForPlaysFolder = (name: string): Outcome => {
    notifyRef.current({
      kind: "plain",
      title: "Choose where your plays live first",
      detail: `“${name}” becomes a play there as soon as you do.`,
    });
    return "wait";
  };

  const route = async (path: string): Promise<Outcome> => {
    const name = path.slice(path.lastIndexOf("/") + 1);
    const couldNot = (why: string) =>
      notifyRef.current({
        kind: "error",
        title: `Proscenium couldn't open “${name}”.`,
        detail: why,
        code: "E-FINDER-OPEN",
      });
    let facts;
    try {
      facts = await opened.facts(path);
    } catch (e) {
      couldNot(String(e));
      return "done";
    }
    const r = classifyOpened(facts);
    switch (r.kind) {
      case "play":
        return openPlay(r, null);
      case "script-in-play":
        return openPlay(r, r.script);
      case "final-draft": {
        if (r.inPlay) return openPlay(r.inPlay, null);
        if (!wsRef.current.vaultRoot) return waitForPlaysFolder(r.name);
        await importRef.current(path);
        return "done";
      }
      case "document-import": {
        if (r.inPlay) return openPlay(r.inPlay, null);
        if (!wsRef.current.vaultRoot) return waitForPlaysFolder(r.name);
        await importRef.current(path);
        return "done";
      }
      case "loose-script": {
        if (!wsRef.current.vaultRoot) return waitForPlaysFolder(r.name);
        await importRef.current(path);
        return "done";
      }
      case "unknown":
        couldNot(
          facts.exists
            ? "Use Import a Draft for Word, RTF, OpenDocument, text and script exports."
            : "It isn't there any more.",
        );
        return "done";
    }
  };
  const routeRef = useRef(route);
  routeRef.current = route;

  const pump = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      while (queue.current.length > 0) {
        const path = queue.current[0];
        let outcome: Outcome;
        try {
          outcome = await routeRef.current(path);
        } catch (e) {
          // A file that throws on the way in is taken out of the line, and
          // said; it used to stay at the head and stop every later open.
          queue.current.shift();
          const name = path.slice(path.lastIndexOf("/") + 1);
          notifyRef.current({
            kind: "error",
            title: `Proscenium couldn't open “${name}”.`,
            detail: String(e),
            code: "E-FINDER-OPEN",
          });
          continue;
        }
        queue.current.shift();
        // Waiting on a Plays folder: set aside, and back in line when one opens
        // — or straight back now, if one opened while this was being routed.
        if (outcome === "wait") {
          if (wsRef.current.vaultRoot) queue.current.push(path);
          else if (!waiting.current.includes(path)) waiting.current.push(path);
        }
      }
    } finally {
      busy.current = false;
    }
  }, []);

  // Drain Rust's queue once the last Plays folder has been tried, then on
  // every signal. Taking drains it, so a path is handed over exactly once.
  useEffect(() => {
    if (!ws.booted) return;
    let dead = false;
    let off: (() => void) | undefined;
    const drain = async () => {
      try {
        const paths = await opened.take();
        for (const p of paths) if (!queue.current.includes(p)) queue.current.push(p);
      } catch {
        return;
      }
      void pump();
    };
    // Listening first, then draining: a file that arrives between the two is
    // either already in the queue the drain takes, or signalled to a listener
    // that is there to hear it. The other order had a gap where it was neither.
    void onOpened(() => void drain()).then(
      (unlisten) => {
        if (dead) {
          unlisten();
          return;
        }
        off = unlisten;
        void drain();
      },
      () => void drain(),
    );
    return () => {
      dead = true;
      off?.();
    };
  }, [ws.booted, pump]);

  // A Plays folder just opened: whatever was waiting for one can go now.
  useEffect(() => {
    if (!ws.vaultRoot || waiting.current.length === 0) return;
    for (const p of waiting.current.splice(0))
      if (!queue.current.includes(p)) queue.current.push(p);
    void pump();
  }, [ws.vaultRoot, pump]);

  return { request, answer };
}
