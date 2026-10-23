// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a chosen change says to a screen reader, and when
 * (docs/app/keeping-work/storage-and-file-format.md#STOR-186).
 *
 * Changes opens on an entry and reads it at once. When Versions… opened it,
 * Changes has something of its own to say too (what it found), at the same
 * moment, and the announcer keeps only the last of two messages that close
 * together: a comparison that could not be read went unsaid. So while
 * Changes has words waiting, the entry chosen hands it what it would have
 * said, and the two are said as one; after that, each says its own.
 */
import { createContext, useContext, useEffect, useRef } from "react";
import { useAnnouncedStatus } from "../ui/use-announced-status";

export interface StatusSink {
  /** Changes has words of its own waiting to be said with the entry's. */
  holding: boolean;
  /** What the part `key` would say now, and whether it is its settled result. */
  report: (key: string, message: string | null, settled: boolean) => void;
}

export const ChangeStatus = createContext<StatusSink | null>(null);

/** Say `message` for the part `key` of a chosen change, or hand it to Changes while it is holding. */
export function useChangeStatus(key: string, message: string | null, settled: boolean) {
  const sink = useContext(ChangeStatus);
  const holding = !!sink?.holding;
  /** The last words handed over, said already with Changes' own. */
  const handed = useRef<string | null>(null);
  useEffect(() => {
    if (!holding || !sink) return;
    sink.report(key, message, settled);
    handed.current = message;
  }, [holding, sink, key, message, settled]);
  const said = !holding && message === handed.current;
  useEffect(() => {
    // Words moved on from what was handed: the same words later are new again.
    if (!holding && message !== handed.current) handed.current = null;
  }, [holding, message]);
  useAnnouncedStatus(holding || said ? null : message);
}
