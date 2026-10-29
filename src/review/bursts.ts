// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A burst: changes from outside to one file, one after another, with nothing
 * of the writer's between them
 * (docs/app/keeping-work/storage-and-file-format.md#STOR-184). Something that
 * edits a script in several writes, a sync that lands a morning's work in
 * pieces, is one burst, and the writer reads what it did once, not once for
 * each write.
 *
 * Changes groups its list by the versions between changes (timeline.ts). The
 * script's own redline
 * (docs/app/keeping-work/storage-and-file-format.md#STOR-185) asks for the
 * newest burst of one file, and asks it of the texts themselves: two changes
 * are one burst when the second began from exactly what the first left. A save
 * of the writer's between them would have moved the second's starting text.
 */
import type { LedgerEntry } from "./store";
import { SITTING_GAP_MS } from "./timeline";

/** What each change kept: the text before it, and the text it left (null when none was kept). */
export interface ChangeTexts {
  before: (id: string) => Promise<string | null>;
  after: (id: string) => Promise<string | null>;
}

const at = (iso: string) => Date.parse(iso);

/** Changes still standing to the file at `path`, oldest first. */
export function changesTo(
  entries: readonly LedgerEntry[],
  path: string,
  same: (a: string, b: string) => boolean,
): LedgerEntry[] {
  return entries
    .filter((e) => e.revertable && e.status !== "reverted" && same(e.path, path))
    .sort((a, b) => at(a.ts) - at(b.ts) || a.id.localeCompare(b.id));
}

/** The newest burst among `list` (one file's changes, oldest first), oldest first; empty when there are none. */
export async function newestBurst(
  list: readonly LedgerEntry[],
  texts: ChangeTexts,
  gapMs = SITTING_GAP_MS,
): Promise<LedgerEntry[]> {
  const last = list[list.length - 1];
  if (!last) return [];
  const burst = [last];
  for (let k = list.length - 2; k >= 0; k--) {
    const prev = list[k]!;
    const next = burst[0]!;
    if (at(next.ts) - at(prev.ts) > gapMs) break;
    const [left, began] = await Promise.all([texts.after(prev.id), texts.before(next.id)]);
    // A change kept before after-texts were: the gap alone decides.
    if (left !== null && began !== null && left !== began) break;
    burst.unshift(prev);
  }
  return burst;
}

/**
 * The two texts a burst is read between: what was there before its first
 * change, and what its last left. `next` is the change to the same file that
 * came after the burst, when one did, and `current` the file as it stands:
 * the last change's own text is read first, then what the next one began
 * from, then the file now. Null when nothing was kept from before.
 */
export async function burstTexts(
  burst: readonly LedgerEntry[],
  texts: ChangeTexts,
  next: LedgerEntry | null,
  current: () => Promise<string | null>,
): Promise<{ before: string; after: string } | null> {
  const first = burst[0];
  const last = burst[burst.length - 1];
  if (!first || !last) return null;
  const before = await texts.before(first.id);
  if (before === null) return null;
  const after =
    (await texts.after(last.id)) ??
    (next ? await texts.before(next.id) : null) ??
    (await current());
  return after === null ? null : { before, after };
}
