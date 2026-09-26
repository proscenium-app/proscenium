// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { RestartOutcome } from "../storage/ipc";

export type RestartResult = "unsaved" | "notReady" | "installing" | { failed: string };
export interface RestartServices {
  lock: () => () => void;
  settle: () => Promise<{ lost: string[]; leave: () => Promise<void> } | void>;
  confirmSaved: () => Promise<void>;
  restart: () => Promise<RestartOutcome>;
}

/** Lock before the first await, so nothing typed during the install is lost; one whole-workspace settle and one
 * installer at a time. Any failure gives the writer the same buffers back. */
export class UpdateRestart {
  private pending: Promise<RestartResult> | null = null;
  run(services: RestartServices): Promise<RestartResult> {
    if (this.pending) return this.pending;
    const unlock = services.lock();
    this.pending = this.install(services).finally(() => { unlock(); this.pending = null; });
    return this.pending;
  }

  private async install(services: RestartServices): Promise<RestartResult> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const settled = await Promise.race([
        services.settle(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Saving is taking longer than expected. Proscenium stayed open.")), 10_000); }),
      ]);
      clearTimeout(timer);
      if (settled?.lost.length) return { failed: `what was typed in ${settled.lost.map((t) => `“${t}”`).join(", ")} couldn't be saved or kept, so Proscenium stays open` };
      if (settled) await settled.leave();
      await services.confirmSaved();
      const deadline = Date.now() + 8000;
      for (;;) {
        const outcome = await services.restart();
        if (outcome.kind !== "unsaved" || Date.now() > deadline) return outcome.kind;
        await new Promise((r) => setTimeout(r, 250));
      }
    } catch (e) { return { failed: String(e) }; }
    finally { clearTimeout(timer); }
  }
}
