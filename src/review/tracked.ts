// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Inline tracked changes — the "later" half of
 * letting a writer see outside changes as changes, built on top of a ledger entry rather than under one.
 *
 * A ProseMirror DECORATION layer, never a document mutation. That distinction
 * is the whole reason this can exist without breaking rule 3: the marks are
 * derived from a diff the ledger already holds, they live only in the view, and
 * the `.fountain` on disk is untouched. Turn the layer off and nothing about
 * the play has changed.
 *
 * Deletions are the interesting case. A removed line is not in the document, so
 * there is nothing to underline — it renders as a WIDGET at the position it was
 * cut from. That is also why this is a decoration problem and not a data one:
 * the deleted text lives in `.proscenium/review/before/<id>` and is displayed,
 * never re-inserted.
 *
 * Block granularity, deliberately. Fountain lines map to editor blocks, so a
 * changed line is a changed block; going to character ranges would mean a
 * second position-mapping to keep correct through reparse and repagination for
 * very little the writer cannot already see.
 */
import { diffLines } from "./diff";

/** What changed, expressed against blocks of the AFTER document. */
export interface TrackedMarks {
  /** Block indexes (0-based, in the after-doc) that were added or rewritten. */
  added: Set<number>;
  /** Removed text, keyed by the after-doc block index it sat before. */
  removedBefore: Map<number, string[]>;
}

export function emptyMarks(): TrackedMarks {
  return { added: new Set(), removedBefore: new Map() };
}

/**
 * Fountain lines are not blocks one-for-one: blank lines separate elements and
 * are not blocks themselves. Walk the after-text counting only non-blank lines,
 * which is the same rule the parser uses to emit a block per element.
 */
function blockIndexOfLine(afterLines: string[]): number[] {
  const out: number[] = [];
  let block = -1;
  for (const line of afterLines) {
    if (line.trim() !== "") block += 1;
    out.push(Math.max(0, block));
  }
  return out;
}

/**
 * Diff `before` against `after` and express the result as marks on the after
 * document's blocks.
 */
export function computeMarks(before: string, after: string): TrackedMarks {
  const marks = emptyMarks();
  const afterLines = after.split("\n");
  const blockAt = blockIndexOfLine(afterLines);

  let afterIdx = 0;
  for (const line of diffLines(before, after)) {
    const block = blockAt[Math.min(afterIdx, blockAt.length - 1)] ?? 0;
    if (line.kind === "same") {
      afterIdx += 1;
    } else if (line.kind === "add") {
      if (line.text.trim() !== "") marks.added.add(block);
      afterIdx += 1;
    } else if (line.text.trim() !== "") {
      // A deletion does not advance the after position, so it attaches to the
      // block that now sits where it used to be.
      const at = marks.removedBefore.get(block) ?? [];
      at.push(line.text);
      marks.removedBefore.set(block, at);
    }
  }
  return marks;
}

/** Merge the marks from several pending entries into one view. */
export function mergeMarks(all: TrackedMarks[]): TrackedMarks {
  const out = emptyMarks();
  for (const m of all) {
    for (const b of m.added) out.added.add(b);
    for (const [b, lines] of m.removedBefore) {
      out.removedBefore.set(b, [...(out.removedBefore.get(b) ?? []), ...lines]);
    }
  }
  return out;
}
