// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from "react";
import { watcherHealth, type WatchHealth } from "../storage/ipc";
import { announce } from "../ui/announce";
import { Chip, WarnIcon } from "../ui";

/** File observation is separate from whether the latest save succeeded. */
export function WatcherStatus({ root }: { root: string | null }) {
  const [health, setHealth] = useState<WatchHealth | null>(null);
  useEffect(() => {
    if (!root) return;
    let dead = false;
    let off: (() => void) | undefined;
    let revision = 0;
    let failed = false;
    const receive = (next: WatchHealth | null) => {
      if (dead || (next && next.root !== root)) return;
      setHealth(next);
      const problem = next !== null && next.status !== "watching";
      if (problem && !failed) announce("Checking file changes. Proscenium is reconnecting to this folder.");
      if (!problem && failed) announce("File changes are up to date.");
      failed = problem;
    };
    const refresh = async () => {
      const before = revision;
      try { const next = await watcherHealth.state(); if (before === revision) receive(next); }
      catch { receive({ root, status: "unavailable" }); }
    };
    void watcherHealth.onState((next) => { revision++; receive(next); }).then((stop) => {
      if (dead) { stop(); return; }
      off = stop;
      void refresh();
    });
    const timer = setInterval(() => void refresh(), 15000);
    return () => { dead = true; off?.(); clearInterval(timer); };
  }, [root]);
  const problem = health?.root === root && health?.status !== "watching";
  return <span data-watcher-status>{problem && <Chip kind="warn" tiny
    title="Proscenium is reconnecting to this folder. It also checks open files when you return to the app.">
    <WarnIcon size={10} />Checking file changes…
  </Chip>}</span>;
}
