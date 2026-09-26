// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { QuitAnswerer, quitHoldWords, type QuitHold, type QuitSettled } from "./quit";
import { saveProblem } from "../storage/save-failure";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let every settled promise's callbacks run. */
const flush = () => new Promise((r) => setTimeout(r, 0));

/** quit.rs, as a log; the alert, as the last thing shown; the deadline, released by hand. */
function harness(settle: () => Promise<QuitSettled>) {
  const said: string[] = [];
  let shown: QuitHold | null = null;
  const deadline = deferred<void>();
  const answerer = new QuitAnswerer(
    settle,
    {
      heard: async (id) => void said.push(`heard ${id}`),
      settled: async (id, go) => void said.push(`settled ${id} ${go ? "go" : "stay"}`),
      now: async () => void said.push("now"),
    },
    (hold) => (shown = hold),
    () => deadline.promise,
  );
  return { answerer, said, shown: () => shown, deadline };
}

function outcome(lost: string[] = [], log?: string[]): QuitSettled {
  return {
    lost,
    problem: lost.length ? saveProblem("disk-full", { kind: "document", name: lost[0], folder: "Characters" }, "quitting") : null,
    leave: async () => void log?.push("note left"),
  };
}

describe("answering a quit", () => {
  it("goes once every word is on disk or kept, leaving its note first", async () => {
    const log: string[] = [];
    const h = harness(async () => outcome([], log));
    await h.answerer.request(1);
    expect(h.said).toEqual(["heard 1", "settled 1 go"]);
    expect(log).toEqual(["note left"]);
    expect(h.shown()).toBeNull();
  });

  it("says it heard before it settles, so quit.rs waits for a page that is working", async () => {
    const settle = deferred<QuitSettled>();
    const h = harness(() => settle.promise);
    const answered = h.answerer.request(4);
    await flush();
    expect(h.said).toEqual(["heard 4"]);
    settle.resolve(outcome());
    await answered;
    expect(h.said).toEqual(["heard 4", "settled 4 go"]);
  });

  it("stays while words can be kept nowhere, and says what quitting would lose", async () => {
    const log: string[] = [];
    const h = harness(async () => outcome(["Mara"], log));
    await h.answerer.request(2);
    expect(h.said).toEqual(["heard 2", "settled 2 stay"]);
    expect(log).toEqual([]);
    expect(h.shown()).toEqual({ kind: "not-kept", lost: ["Mara"], problem: expect.anything() });

    h.answerer.dontQuit();
    expect(h.shown()).toBeNull();
    expect(h.said).not.toContain("now");
  });

  it("quits anyway when the writer says so, leaving word of what was kept", async () => {
    const log: string[] = [];
    const h = harness(async () => outcome(["Mara"], log));
    await h.answerer.request(3);
    await h.answerer.quitAnyway();
    expect(h.shown()).toBeNull();
    expect(log).toEqual(["note left"]);
    expect(h.said[h.said.length - 1]).toBe("now");
  });

  it("calls the quit off when a settle runs long, and quits once it finishes with every word kept", async () => {
    const settle = deferred<QuitSettled>();
    const h = harness(() => settle.promise);
    const answered = h.answerer.request(5);
    h.deadline.resolve();
    await flush();
    expect(h.said).toEqual(["heard 5", "settled 5 stay"]);
    expect(h.shown()).toEqual({ kind: "still-saving" });

    settle.resolve(outcome());
    await answered;
    expect(h.shown()).toBeNull();
    expect(h.said).toEqual(["heard 5", "settled 5 stay", "now"]);
  });

  it("does not quit after Don't Quit, however the late settle ends", async () => {
    const settle = deferred<QuitSettled>();
    const h = harness(() => settle.promise);
    const answered = h.answerer.request(6);
    h.deadline.resolve();
    await flush();
    h.answerer.dontQuit();
    settle.resolve(outcome());
    await answered;
    expect(h.said).toEqual(["heard 6", "settled 6 stay"]);
    expect(h.shown()).toBeNull();
  });

  it("turns the alert into what would be lost when the late settle could not keep everything", async () => {
    const settle = deferred<QuitSettled>();
    const h = harness(() => settle.promise);
    const answered = h.answerer.request(7);
    h.deadline.resolve();
    await flush();
    settle.resolve(outcome(["Outline notes"]));
    await answered;
    expect(h.shown()).toMatchObject({ kind: "not-kept", lost: ["Outline notes"] });
    expect(h.said).not.toContain("now");
  });

  it("holds the quit when the settle itself fails: nothing is known to be kept", async () => {
    const h = harness(async () => {
      throw new Error("a bug");
    });
    await h.answerer.request(8);
    expect(h.said).toEqual(["heard 8", "settled 8 stay"]);
    expect(h.shown()).toEqual({ kind: "not-kept", lost: [], problem: null });
  });

  it("settles a second quit after the first, never from a settle that began before it", async () => {
    const first = deferred<QuitSettled>();
    const order: string[] = [];
    let calls = 0;
    const h = harness(() => {
      calls++;
      order.push(`settle ${calls}`);
      return calls === 1 ? first.promise : Promise.resolve(outcome());
    });
    const one = h.answerer.request(9);
    const two = h.answerer.request(10);
    await flush();
    expect(order).toEqual(["settle 1"]);
    first.resolve(outcome(["Mara"]));
    await Promise.all([one, two]);
    expect(order).toEqual(["settle 1", "settle 2"]);
    expect(h.said).toContain("settled 9 stay");
    expect(h.said).toContain("settled 10 go");
  });
});

describe("the quit alert's words", () => {
  it("names what would be lost, why, and what would let it save", () => {
    const problem = saveProblem("disk-full", { kind: "document", name: "Mara", folder: "Characters" }, "quitting");
    expect(quitHoldWords({ kind: "not-kept", lost: ["Mara", "Outline notes"], problem })).toEqual({
      title: "What was typed in “Mara”, “Outline notes” couldn't be saved or kept.",
      body: "The disk is full. If Proscenium quits now, what was typed is lost. “Mara” will save once there is room on the disk.",
    });
    expect(quitHoldWords({ kind: "not-kept", lost: [], problem: null })).toEqual({
      title: "What was typed couldn't be saved or kept.",
      body: "If Proscenium quits now, what was typed is lost.",
    });
    expect(quitHoldWords({ kind: "still-saving" }).title).toBe("Proscenium is still saving what was typed.");
  });

  it("never uses the words a writer is not shown (docs/app/keeping-work/storage-and-file-format.md#STOR-D1)", () => {
    const internal = /vault|workspace|project|manifest|material|conflict|sync|snapshot|collision|buffer|settle|IPC/i;
    const problem = saveProblem("locked", { kind: "outline", name: "Outline", folder: "The Tide" }, "quitting");
    const holds: QuitHold[] = [
      { kind: "still-saving" },
      { kind: "not-kept", lost: ["Outline notes"], problem },
      { kind: "not-kept", lost: [], problem: null },
    ];
    for (const hold of holds) {
      const { title, body } = quitHoldWords(hold);
      expect(`${title} ${body}`.match(internal)?.[0] ?? null).toBeNull();
    }
  });
});
