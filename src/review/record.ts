// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Recording a change.
 *
 * The floor, and the reason it is a floor: this runs on the watcher path, so it
 * catches a change no matter how it arrived — another device, a text editor, a
 * sync that resolved something its own way. There is nothing to opt into and
 * nothing to bypass.
 *
 * It deliberately does NOT block. The canonical file has already changed by the
 * time we hear about it; pretending otherwise would mean racing a folder the
 * app does not own. What we can do — and do here — is remember what the writer
 * had, so the change can be shown as a change and undone in one click.
 */
import { ulid } from "../workspace/ulid";
import { diffLines } from "./diff";
import type { ChangesStore, LedgerEntry } from "./store";

/** Added/removed line counts between two texts. */
export function countStats(before: string, after: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diffLines(before, after)) {
    if (line.kind === "add") added += 1;
    else if (line.kind === "del") removed += 1;
  }
  return { added, removed };
}

/**
 * Record an external change to `path`, if there is one.
 *
 * `nowIso` is passed in rather than read from a clock here so the caller owns
 * time (and tests can pin it). `after` is the content that is on disk now.
 *
 * An event is a reason to look, never proof that anything changed. The
 * watcher's start-up scan reports every file in the play, returning to the app
 * re-reads every open one, and a sync provider touching a file's metadata fires
 * too. Every one of those used to become an entry: a Changes list of "+0 −0"
 * rows, one per file per launch and one per open file each time the window came
 * forward. So the bytes decide:
 *
 * - the same bytes as the baseline are not a change, and nothing is written;
 * - a file with no baseline has not been seen on this device, so there is no
 *   "since the writer last saw it" to report. Its bytes become the baseline,
 *   which gives the next real change a diff and a way back.
 *
 * Returns the entry, or null when there was nothing to record. A baseline that
 * cannot be read throws rather than reading as "never seen": taking the new
 * bytes as the baseline would overwrite the one thing a revert needs.
 */
export async function recordExternalChange(
  store: ChangesStore,
  args: {
    path: string;
    after: string;
    afterHash: string;
    nowIso: string;
  },
): Promise<LedgerEntry | null> {
  const before = await store.readBaseline(args.path);
  if (before === args.after) return null;
  if (before === null) {
    await store.writeBaseline(args.path, args.after);
    return null;
  }

  const entry: LedgerEntry = {
    id: ulid(),
    ts: args.nowIso,
    kind: "external",
    path: args.path,
    afterHash: args.afterHash,
    revertable: true,
    stats: countStats(before, args.after),
    /*
     * Always null now.
     *
     * There used to be an inbound note channel: anything writing into a play
     * folder could append a line saying what it changed, and the app showed the
     * note beside the change. Its only writer was the chat panel, which is gone, and
     * the file it read lived in the `.proscenium/` directory a play no longer
     * has (docs/app/keeping-work/storage-and-file-format.md#STOR-D3). The field stays because an entry written before this is
     * still readable, and because "who changed it" is not a question Changes
     * answers any more — a change is the writer's, or it came from outside.
     */
    note: null,
    status: "pending",
  };

  // Keep the pre-change bytes under this entry's own id: the baseline is about
  // to move forward, so it cannot also be what a revert restores.
  await store.writeBefore(entry.id, before);
  await store.appendEntry(entry);
  // The change the writer is now looking at becomes the next baseline, so a
  // second edit diffs against what they saw rather than against history.
  await store.writeBaseline(args.path, args.after);
  return entry;
}
