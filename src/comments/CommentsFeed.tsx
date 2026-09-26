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
 * Reading, editing and resolving work here as they do in the margin, over the
 * same Fountain notes. There is no comment store to keep in sync.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { commentsState, type PmCommentEntry } from "./plugin";
import { useCommentFocus } from "./focus";
import { PopupButton } from "../ui";

type Filter = "all" | "todo" | `author:${string}`;

function sceneLabel(entry: PmCommentEntry): string {
  const parts = [entry.act, entry.scene].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Front of script";
}

/** The comment node at `pos`, verified — positions go stale across edits. */
function noteAt(editor: Editor, pos: number) {
  const node = editor.state.doc.nodeAt(pos);
  return node && node.type.name === "note" ? node : null;
}

export function CommentsFeed({
  editor,
  onJump,
}: {
  editor: Editor | null;
  /** Show this comment in the script (App owns which pane the script is in). */
  onJump: (pos: number) => void;
}) {
  const [entries, setEntries] = useState<PmCommentEntry[]>([]);
  const [focusPos, setFocusPos] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const complete = useCommentFocus(editor, root);
  const [draft, setDraft] = useState("");
  const rowRefs = useRef(new Map<number, HTMLLIElement>());

  // The feed follows the document: comments are text, so every edit anywhere
  // can add, move or remove one. Meta-only transactions carry the focus.
  useEffect(() => {
    if (!editor) return;
    const sync = () => {
      setEntries(commentsState(editor.state)?.entries ?? []);
      setFocusPos(editor.storage.comments.focusPos);
    };
    editor.on("transaction", sync);
    sync();
    return () => {
      editor.off("transaction", sync);
    };
  }, [editor]);

  // Following a marker or a card into the feed: bring that row into view.
  useEffect(() => {
    if (focusPos === null) return;
    rowRefs.current.get(focusPos)?.scrollIntoView({ block: "nearest" });
  }, [focusPos, entries]);

  const authors = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) if (e.parsed.author) set.add(e.parsed.author);
    return [...set].sort();
  }, [entries]);

  const visible = useMemo(() => {
    if (filter === "all") return entries;
    if (filter === "todo") return entries.filter((e) => e.parsed.todo);
    const author = filter.slice("author:".length);
    return entries.filter((e) => e.parsed.author === author);
  }, [entries, filter]);

  const groups = useMemo(() => {
    const out: { label: string; items: PmCommentEntry[] }[] = [];
    for (const entry of visible) {
      const label = sceneLabel(entry);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(entry);
      else out.push({ label, items: [entry] });
    }
    return out;
  }, [visible]);

  if (!editor) return <div className="commentsfeed commentsfeed--empty">No script open.</div>;

  const beginEdit = (entry: PmCommentEntry) => {
    setEditingId(entry.id);
    setDraft(entry.text);
  };

  const cancelEdit = (id: string) => {
    setEditingId(null);
    setDraft("");
    complete("Comment edit cancelled", id);
  };

  const saveEdit = (id: string) => {
    const entry = commentsState(editor.state)?.entries.find((entry) => entry.id === id);
    if (!entry) {
      setEditingId(null);
      complete("Comment is no longer here", null);
      return;
    }
    const pos = entry.pos;
    const node = noteAt(editor, pos);
    const text = draft.replace(/\n{2,}/g, "\n").trim(); // a note holds no blank lines
    setEditingId(null);
    setDraft("");
    if (!node) return;
    if (!text) {
      resolve(pos);
      return;
    }
    editor
      .chain()
      .command(({ tr, state, dispatch }) => {
        if (dispatch) tr.replaceWith(pos + 1, pos + node.nodeSize - 1, state.schema.text(text));
        return true;
      })
      .run();
    complete("Comment saved", id);
  };

  /** Delete IS resolve — the trail is the history ring and the ledger (docs/app/writing/comments.md#COMM-D5). */
  const resolve = (pos: number) => {
    const index = visible.findIndex((entry) => entry.pos === pos);
    const next = visible[index + 1] ?? visible[index - 1];
    const node = noteAt(editor, pos);
    if (!node) return;
    editor
      .chain()
      .command(({ tr, dispatch }) => {
        if (!dispatch) return true;
        const $pos = tr.doc.resolve(pos);
        // A standalone comment takes its (unprinted) line with it.
        if ($pos.parent.childCount === 1) tr.delete($pos.before(), $pos.after());
        else tr.delete(pos, pos + node.nodeSize);
        return true;
      })
      .run();
    if (editingId === entries.find((entry) => entry.pos === pos)?.id) setEditingId(null);
    editor.commands.doomComment(null);
    editor.commands.hoverComment(null);
    editor.commands.focusComment(null);
    complete("Comment resolved", next?.id ?? null);
  };

  return (
    <div className="commentsfeed" ref={root}>
      <header className="commentsfeed__head">
        <h2 className="commentsfeed__count" tabIndex={-1} data-comment-fallback>
          {entries.length} comment{entries.length === 1 ? "" : "s"}
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

      {entries.length === 0 && (
        <p className="commentsfeed__empty">
          No comments yet. Select a line in the script and press <kbd>⌘⌥M</kbd>, or type{" "}
          <code>[[</code> where you want one.
        </p>
      )}
      {entries.length > 0 && visible.length === 0 && (
        <p className="commentsfeed__empty">Nothing matches this filter.</p>
      )}

      <ul className="commentsfeed__list">
        {groups.map((group) => (
          <li key={`${group.label}-${group.items[0].id}`}>
            <div className="commentsfeed__scene">{group.label}</div>
            <ul>
              {group.items.map((entry) => (
                <li
                  key={entry.id}
                  ref={(el) => {
                    if (el) rowRefs.current.set(entry.pos, el);
                    else rowRefs.current.delete(entry.pos);
                  }}
                  data-comment-id={entry.id}
                  className={`commentsfeed__row${focusPos === entry.pos ? " is-focused" : ""}`}
                  onMouseEnter={() => editor.commands.hoverComment(entry.pos)}
                  onMouseLeave={() => editor.commands.hoverComment(null)}
                >
                  {editingId === entry.id ? (
                    <div className="commentsfeed__edit">
                      <textarea
                        className="commentsfeed__field"
                        value={draft}
                        autoFocus
                        rows={3}
                        aria-label="Edit comment"
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault();
                            saveEdit(entry.id);
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            cancelEdit(entry.id);
                          }
                        }}
                      />
                      <div className="commentsfeed__editrow">
                        <button onClick={() => saveEdit(entry.id)} title="Save (⌘⏎)">
                          Save
                        </button>
                        <button onClick={() => cancelEdit(entry.id)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button
                        className="commentsfeed__body"
                        onClick={() => onJump(entry.pos)}
                        title="Go to this comment in the script"
                      >
                        {entry.parsed.todo && <span className="comments-chip is-todo">todo</span>}
                        {entry.parsed.author && (
                          <span className="comments-chip">{entry.parsed.author}</span>
                        )}
                        <span className="commentsfeed__text">
                          {entry.parsed.body || <em>(empty)</em>}
                        </span>
                      </button>
                      <span className="commentsfeed__actions">
                        <button
                          onClick={() => beginEdit(entry)}
                          title="Edit"
                          aria-label="Edit comment"
                        >
                          ✎
                        </button>
                        <button
                          onClick={() => resolve(entry.pos)}
                          onMouseEnter={() => editor.commands.doomComment(entry.pos)}
                          onMouseLeave={() => editor.commands.doomComment(null)}
                          onFocus={() => editor.commands.doomComment(entry.pos)}
                          onBlur={() => editor.commands.doomComment(null)}
                          title="Resolve — history keeps it"
                          aria-label="Resolve comment"
                        >
                          ✓
                        </button>
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
