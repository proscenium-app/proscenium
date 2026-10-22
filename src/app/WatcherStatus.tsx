// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from "react";
import { watcherHealth, type WatchHealth } from "../storage/ipc";
import { announce } from "../ui/announce";
import { Chip, WarnIcon } from "../ui";
import { FRESH, hear } from "./watcher-words";

/** File observation is separate from whether the latest save succeeded. */
export function WatcherStatus({ root }: { root: string | null }) {
  const [health, setHealth] = useState<WatchHealth | null>(null);
  useEffect(() => {
    if (!root) return;
    let dead = false;
    let off: (() => void) | undefined;
    let revision = 0;
    let heard = FRESH;
    const opened = Date.now();
    let grace = 0;
    const receive = (next: WatchHealth | null) => {
      if (dead || (next && next.root !== root)) return;
      // A folder's first watch starting is not shown, and asked again once
      // its grace is over (watcher-words.ts).
      const { now, say, wait } = hear(heard, next?.status ?? null, Date.now() - opened);
      heard = now;
      window.clearTimeout(grace);
      if (wait !== null) {
        grace = window.setTimeout(() => void refresh(), wait);
        return;
      }
      setHealth(next);
      if (say) announce(say);
    };
    const refresh = async () => {
      const before = revision;
      try {
        const next = await watcherHealth.state();
        if (before === revision) receive(next);
      } catch {
        receive({ root, status: "unavailable" });
      }
    };
    void watcherHealth
      .onState((next) => {
        revision++;
        receive(next);
      })
      .then((stop) => {
        if (dead) {
          stop();
          return;
        }
        off = stop;
        void refresh();
      });
    const timer = setInterval(() => void refresh(), 15000);
    return () => {
      dead = true;
      off?.();
      clearInterval(timer);
      window.clearTimeout(grace);
    };
  }, [root]);
  const problem = health?.root === root && health?.status !== "watching";
  return (
    <span data-watcher-status>
      {problem && (
        <Chip
          kind="warn"
          tiny
          title="Proscenium is reconnecting to this folder. It also checks open files when you return to the app."
        >
          <WarnIcon size={10} />
          Checking file changes…
        </Chip>
      )}
    </span>
  );
}
