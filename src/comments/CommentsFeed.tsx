// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The comment feed (docs/app/writing/comments.md#COMM-D5) — every comment in the script, in
 * script order, grouped under its scene, as a PANE: it sits beside the work
 * like the Board and Changes do, rather than floating over the page.
 *
 * The margin (CommentsMargin.tsx) is for reading a comment where it applies;
 * the feed is for seeing them all and going to one. Click a row and the script
 * scrolls to that comment and focuses it — the same jump the board's cards and
 * find already use.
 *
 * Reading, editing, answering and resolving work here as they do in the
 * margin, over the same Fountain notes and drawn by the same Thread.tsx. There
 * is no comment store to keep in sync. It is also where a comment is typed
 * when the margin has no room for a card (docs/app/writing/comments.md#COMM-56).
 */
import { keys } from "../ui/keys";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { commentsState, type CommentThread, type CommentsStorage } from "./plugin";
import { useCommentFocus } from "./focus";
import { groupByHeading } from "./groups";
import { ThreadView } from "./Thread";
import { useThreadEditing } from "./use-thread-editing";
import { PopupButton } from "../ui";

type Filter = "all" | "todo" | `author:${string}`;

/** What the feed reads of the editor's comment state. */
type FeedUi = Pick<CommentsStorage, "focusPos" | "composing" | "replying" | "marginRoom">;
const IDLE: FeedUi = { focusPos: null, composing: false, replying: false, marginRoom: false };

export function CommentsFeed({
  editor,
  onJump,
}: {
  editor: Editor | null;
  /**
   * Show this comment in the script (App owns which pane the script is in).
   * `fromWords`: the click was on the comment's words, and may be the first
   * press of a double-click; a word it goes on to select is left selected.
   */
  onJump: (pos: number, fromWords?: boolean) => void;
}) {
  const [threads, setThreads] = useState<CommentThread[]>([]);
  const [ui, setUi] = useState<FeedUi>(IDLE);
  const [filter, setFilter] = useState<Filter>("all");
  const root = useRef<HTMLDivElement>(null);
  const complete = useCommentFocus(editor, root);
  const rowRefs = useRef(new Map<number, HTMLLIElement>());

  // The feed follows the document: comments are text, so every edit anywhere
  // can add, move or remove one. Meta-only transactions carry the focus, and
  // the script's request to type a comment here.
  useEffect(() => {
    if (!editor) return;
    const sync = () => {
      setThreads(commentsState(editor.state)?.threads ?? []);
      const { focusPos, composing, replying, marginRoom } = editor.storage.comments;
      setUi((prev) =>
        prev.focusPos === focusPos &&
        prev.composing === composing &&
        prev.replying === replying &&
        prev.marginRoom === marginRoom
          ? prev
          : { focusPos, composing, replying, marginRoom },
      );
    };
    editor.on("transaction", sync);
    sync();
    return () => {
      editor.off("transaction", sync);
    };
  }, [editor]);
  const focusPos = ui.focusPos;

  // Following a marker or a card into the feed: bring that row into view.
  useEffect(() => {
    if (focusPos === null) return;
    rowRefs.current.get(focusPos)?.scrollIntoView({ block: "nearest" });
  }, [focusPos, threads]);

  const authors = useMemo(() => {
    const set = new Set<string>();
    for (const thread of threads) {
      for (const entry of [thread.root, ...thread.replies]) {
        if (entry.parsed.author) set.add(entry.parsed.author);
      }
    }
    return [...set].sort();
  }, [threads]);

  // A conversation is shown when any part of it matches: a reply by Sam is
  // found under Sam, with the comment it answers.
  const visible = useMemo(() => {
    if (filter === "all") return threads;
    const author = filter.startsWith("author:") ? filter.slice("author:".length) : null;
    return threads.filter((thread) =>
      [thread.root, ...thread.replies].some((entry) =>
        author === null ? entry.parsed.todo : entry.parsed.author === author,
      ),
    );
  }, [threads, filter]);

  const groups = useMemo(() => groupByHeading(visible), [visible]);

  const editing = useThreadEditing({
    editor,
    threads: visible,
    // The margin types a new comment when it has room for the card.
    takesNew: !ui.marginRoom,
    request: ui,
    complete,
  });

  // A comment being made here is shown whatever the filter says: the writer
  // has to see the field they were sent to.
  const asked = ui.composing || ui.replying;
  useEffect(() => {
    if (asked && !ui.marginRoom) setFilter("all");
  }, [asked, ui.marginRoom]);

  if (!editor) return <div className="commentsfeed commentsfeed--empty">No script open.</div>;

  return (
    <div className="commentsfeed" ref={root}>
      <header className="commentsfeed__head">
        <h2 className="commentsfeed__count" tabIndex={-1} data-comment-fallback>
          {threads.length} comment{threads.length === 1 ? "" : "s"}
        </h2>
        <PopupButton
          flat
          className="commentsfeed__filter"
          label="Filter comments"
          menuWidth={186}
          value={filter}
          onChange={(v) => setFilter(v as Filter)}
          options={[
            { value: "all", label: "All Comments" },
            { value: "todo", label: "To-dos" },
            ...authors.map((a) => ({
              value: `author:${a}`,
              label: a,
              section: "By author",
            })),
          ]}
        />
      </header>

      {threads.length === 0 && (
        <p className="commentsfeed__empty">
          No comments yet. Select a line in the script and press <kbd>{keys("⌘⌥M")}</kbd>, or type{" "}
          <code>[[</code> where you want one.
        </p>
      )}
      {threads.length > 0 && visible.length === 0 && (
        <p className="commentsfeed__empty">Nothing matches this filter.</p>
      )}

      <ul className="commentsfeed__list">
        {groups.map((group) => (
          <li key={`${group.label}-${group.items[0].root.id}`}>
            <div className="commentsfeed__scene">{group.label}</div>
            <ul>
              {group.items.map((thread) => {
                const pos = thread.root.pos;
                return (
                  <li
                    key={thread.root.id}
                    ref={(el) => {
                      if (el) rowRefs.current.set(pos, el);
                      else rowRefs.current.delete(pos);
                    }}
                    data-comment-id={thread.root.id}
                    className={`commentsfeed__row${focusPos === pos ? " is-focused" : ""}`}
                    onMouseEnter={() => editor.commands.hoverComment(pos)}
                    onMouseLeave={() => editor.commands.hoverComment(null)}
                  >
                    <ThreadView
                      editor={editor}
                      thread={thread}
                      editing={editing}
                      onShow={() => onJump(pos)}
                      // A click on the words goes to the comment, as it always
                      // has, unless it was the end of selecting some of them.
                      onWordsClick={() => {
                        if (window.getSelection()?.isCollapsed !== false) onJump(pos, true);
                      }}
                    />
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
