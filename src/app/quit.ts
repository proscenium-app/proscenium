// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Quitting keeps the words: the page's half of the quit gate (quit.rs; storage
 * docs/app/keeping-work/storage-and-file-format.md#STOR-D13, "Blur, hide, tab close, and quit flush immediately").
 *
 * Every quit — ⌘Q, the Dock, logging out, the window's close button — now asks
 * this page first and waits for the answer. It used to ask nothing, and a
 * quit lost words typed a moment before it, in a document and in the script,
 * and a document's words whose file was locked in Finder, with the toast still
 * saying they were in the window.
 *
 * The workspace settles (`settleForQuit`): what can land lands, and the rest is
 * kept where the next launch finds it — a script's words in its recovery
 * snapshot, which the script offers back when it opens; a document's and the
 * outline notes' as pinned versions, which the play says when it opens
 * (storage/quit-note.ts). Then the app goes.
 *
 * It does not go while words can be kept nowhere — a full disk that app data is
 * on too — or while a settle has run past ten seconds, on a drive that stopped
 * answering. The quit is called off and an alert says what quitting would lose,
 * with Don't Quit as the default. A settle that finishes after that with every
 * word kept quits after all: quitting is what the writer asked for.
 *
 * Nothing is torn down to quit, so a quit that is called off leaves the play as
 * it was.
 */
import { useEffect, useRef, useState } from "react";
import { quit } from "../storage/ipc";
import type { SaveProblem } from "../storage/save-failure";

/** What settling for a quit came to (useWorkspace `settleForQuit`). */
export interface QuitSettled {
  /** Whose words could be kept nowhere, as the binder names them. Empty when every word is on disk or kept. */
  lost: string[];
  /** Why the first of those could not be saved, in `saveProblem(…, "quitting")`'s words, when the disk said. */
  problem: SaveProblem | null;
  /** Leave word of what went into Versions, for the play's next open. Called just before the app goes. */
  leave: () => Promise<void>;
}

/** What the alert says while a quit is held. */
export type QuitHold =
  | { kind: "not-kept"; lost: string[]; problem: SaveProblem | null }
  | { kind: "still-saving" };

/** The page's half of quit.rs's protocol. */
export interface QuitChannel {
  heard: (id: number) => Promise<void>;
  settled: (id: number, go: boolean) => Promise<void>;
  now: () => Promise<void>;
}

/** How long a settle may run before the quit is called off and the alert says so. quit.rs waits three times as long. */
export const SETTLE_WITHIN_MS = 10_000;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Answers each question quit.rs asks: heard at once, then settled — `go`, or
 * not and why. Settles run one after another, so a second quit never answers
 * from a settle that began before words typed since.
 */
export class QuitAnswerer {
  private queue: Promise<unknown> = Promise.resolve();
  /** Asked to quit, and not answered Don't Quit since: a late settle that kept everything quits. */
  private wanted = false;
  /** The newest settle's outcome, for Quit Anyway to leave its note. */
  private last: QuitSettled | null = null;

  constructor(
    private readonly settle: () => Promise<QuitSettled>,
    private readonly channel: QuitChannel,
    private readonly show: (hold: QuitHold | null) => void,
    private readonly sleep: (ms: number) => Promise<void> = wait,
    private readonly within = SETTLE_WITHIN_MS,
  ) {}

  /** Question `id`. Resolves once it has been answered, and for a late settle, once that has finished. */
  async request(id: number): Promise<void> {
    void this.channel.heard(id).catch(() => {});
    this.wanted = true;
    const settling = this.queue
      .then(() => this.settle())
      .then(
        (settled) => (this.last = settled),
        (): QuitSettled => {
          // A settle that threw kept nothing anybody knows of: hold the quit.
          const unknown: QuitSettled = { lost: [], problem: null, leave: async () => {} };
          UNKNOWN.add(unknown);
          return unknown;
        },
      );
    this.queue = settling;
    const late = Symbol("late");
    const first = await Promise.race([settling, this.sleep(this.within).then(() => late)]);
    if (first !== late) return this.decide(id, first as QuitSettled);

    await this.answer(id, false);
    if (!this.wanted) return;
    this.show({ kind: "still-saving" });
    const settled = await settling;
    if (!this.wanted) return;
    if (kept(settled)) {
      this.wanted = false;
      this.show(null);
      await settled.leave();
      await this.channel.now().catch(() => {});
    } else {
      this.show({ kind: "not-kept", lost: settled.lost, problem: settled.problem });
    }
  }

  /** The writer chose Don't Quit: the alert goes, and a settle still running only settles. */
  dontQuit(): void {
    this.wanted = false;
    this.show(null);
  }

  /** The writer chose Quit Anyway. */
  async quitAnyway(): Promise<void> {
    this.wanted = false;
    this.show(null);
    await this.last?.leave().catch(() => {});
    await this.channel.now().catch(() => {});
  }

  private async decide(id: number, settled: QuitSettled): Promise<void> {
    if (kept(settled)) {
      await settled.leave().catch(() => {});
      await this.answer(id, true);
      return;
    }
    await this.answer(id, false);
    if (this.wanted) this.show({ kind: "not-kept", lost: settled.lost, problem: settled.problem });
  }

  private answer(id: number, go: boolean): Promise<void> {
    return this.channel.settled(id, go).catch(() => {});
  }
}

/** Settles that threw: they name nothing lost, and nothing is known to be kept either. */
const UNKNOWN = new WeakSet<QuitSettled>();

/** Every word is on disk or kept. */
function kept(settled: QuitSettled): boolean {
  return settled.lost.length === 0 && !UNKNOWN.has(settled);
}

/** The alert's words: what quitting now would lose, and why. */
export function quitHoldWords(hold: QuitHold): { title: string; body: string } {
  if (hold.kind === "still-saving") {
    return {
      title: "Proscenium is still saving what was typed.",
      body: "It quits once everything is saved or kept. If it quits now, what hasn't been saved yet is lost.",
    };
  }
  const names = hold.lost.map((name) => `“${name}”`).join(", ");
  return {
    title: names
      ? `What was typed in ${names} couldn't be saved or kept.`
      : "What was typed couldn't be saved or kept.",
    body: hold.problem
      ? `${hold.problem.title} ${hold.problem.detail}`
      : "If Proscenium quits now, what was typed is lost.",
  };
}

/**
 * The quit gate, for the app shell: answers every quit with `settle`, and
 * holds the alert's state while a quit is called off.
 */
export function useQuitGate(settle: () => Promise<QuitSettled>): {
  hold: QuitHold | null;
  dontQuit: () => void;
  quitAnyway: () => void;
} {
  const [hold, setHold] = useState<QuitHold | null>(null);
  const settleRef = useRef(settle);
  settleRef.current = settle;
  const answererRef = useRef<QuitAnswerer | null>(null);
  answererRef.current ??= new QuitAnswerer(() => settleRef.current(), quit, setHold);
  useEffect(() => {
    // A subscription arriving after its effect was cleaned up unsubscribes
    // itself: a listener left behind would answer every quit twice.
    let dead = false;
    let off: (() => void) | null = null;
    void quit
      .onRequested((id) => void answererRef.current?.request(id))
      .then((unlisten) => {
        if (dead) unlisten();
        else off = unlisten;
      })
      .catch(() => {});
    return () => {
      dead = true;
      off?.();
    };
  }, []);
  return {
    hold,
    dontQuit: () => answererRef.current?.dontQuit(),
    quitAnyway: () => void answererRef.current?.quitAnyway(),
  };
}
