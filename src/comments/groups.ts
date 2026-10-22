// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The feed's groups: the conversations of a script under the headings they are
 * listed under (docs/app/writing/comments.md#COMM-71). Pure: the collected
 * threads in, the groups out.
 */
import type { CommentThread } from "./plugin";

export interface CommentGroup {
  /** What the group is headed with: `act · scene`, or either alone. */
  label: string;
  items: CommentThread[];
}

/** The heading a conversation is listed under, as the feed words it. */
export function headingLabel({ root }: CommentThread): string {
  const parts = [root.act, root.scene].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Front of script";
}

/**
 * Conversations in script order, each run of them under one heading as one
 * group. A heading is a line of the script, not its text: two scenes with one
 * title are two groups with one label. Grouped by the label's text, they were
 * one group, and the feed showed the comments of two scenes as one scene's.
 */
export function groupByHeading(threads: readonly CommentThread[]): CommentGroup[] {
  const groups: CommentGroup[] = [];
  let under: number | null = null;
  for (const thread of threads) {
    const last = groups[groups.length - 1];
    if (last && thread.root.headingPos === under) last.items.push(thread);
    else groups.push({ label: headingLabel(thread), items: [thread] });
    under = thread.root.headingPos;
  }
  return groups;
}
