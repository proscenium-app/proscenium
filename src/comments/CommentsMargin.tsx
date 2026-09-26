// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The comment margin (docs/app/writing/comments.md#COMM-D4) — cards on the desk beside the
 * page, level with the line they annotate. This is the surface that makes a
 * comment *visible*: in page view the note text itself is hidden so wrapping
 * matches the engine, and a marker alone is a dot you have to hunt for.
 * Cards in the margin, because you read the script and the margin at the
 * same time.
 *
 * Every number here is MEASURED and none of it is stored. Card positions come
 * from `coordsAtPos` on the rendered document, so zoom, a format change and
 * the page chrome are already accounted for; the cards live outside the page
 * entirely, so nothing in this file can move a wrap or a page break.
 *
 * When the desk is too narrow for a column the margin stands down; the feed
 * pane (⌘⇧C, CommentsFeed.tsx) is the surface that always fits.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import { commentsState, type CommentsStorage, type PmCommentEntry } from "./plugin";
import { useCommentFocus } from "./focus";
import { sameSpots, stackCards } from "./stack";

/** A comfortable card, and the least one can shrink to before it's useless. */
const COLUMN_PX = 236;
const MIN_COLUMN_PX = 168;
/** Sheet ↔ column, card ↔ card, and the desk left clear on the far side. */
const GAP_PX = 16;
const CARD_GAP_PX = 8;
const MIN_DESK_PX = 8;

interface Geometry {
  /** There is room for a column, and something to put in it. */
  show: boolean;
  /** Column offset from the surface's left edge, and its width. */
  left: number;
  width: number;
  /** Desk to reserve on the right, so the column isn't off the frame. */
  reserve: number;
}

const NO_ROOM: Geometry = { show: false, left: 0, width: 0, reserve: 0 };

/**
 * Where a comment sits on screen. The highlight's start when it has one (the
 * card lines up with the phrase, as in Docs); the note otherwise.
 *
 * A standalone comment has no coordinates at all in page view — its whole
 * block is hidden, because the engine skips it — so it borrows the nearest
 * visible neighbour's edge rather than piling up at the top of the sheet.
 */
function anchorTop(view: EditorView, entry: PmCommentEntry): number | null {
  try {
    const coords = view.coordsAtPos(entry.anchorFrom ?? entry.pos);
    if (coords.top !== 0 || coords.bottom !== 0) return coords.top;
  } catch {
    /* a position that no longer resolves: fall through to the neighbours */
  }
  const dom = view.nodeDOM(entry.blockPos);
  const el = dom instanceof HTMLElement ? dom : null;
  if (!el) return null;
  for (let p = el.previousElementSibling; p; p = p.previousElementSibling) {
    const rect = p.getBoundingClientRect();
    if (rect.height > 0) return rect.bottom;
  }
  for (let n = el.nextElementSibling; n; n = n.nextElementSibling) {
    const rect = n.getBoundingClientRect();
    if (rect.height > 0) return rect.top;
  }
  return null;
}

export interface MarginState {
  /** The margin is up — the cards carry the comment text. */
  show: boolean;
  /** Desk to hold clear for the column. */
  reserve: number;
}

export function CommentsMargin({
  editor,
  onMargin,
}: {
  editor: Editor;
  /** Reported to PlayEditor, which shifts the sheet and hides the inline chips. */
  onMargin?: (state: MarginState) => void;
}) {
  const [entries, setEntries] = useState<PmCommentEntry[]>(
    () => commentsState(editor.state)?.entries ?? [],
  );
  const [ui, setUi] = useState<CommentsStorage>(() => ({ ...editor.storage.comments }));
  const [geom, setGeom] = useState<Geometry>(NO_ROOM);
  const [wants, setWants] = useState<Map<number, number>>(() => new Map());
  const [tops, setTops] = useState<Map<number, number>>(() => new Map());
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const columnRef = useRef<HTMLDivElement | null>(null);
  const complete = useCommentFocus(editor, columnRef);
  const cardRefs = useRef(new Map<number, HTMLElement>());

  /** Read the desk and the anchors. Cheap enough to run on every change. */
  const measure = useCallback(() => {
    const column = columnRef.current;
    const surface = column?.closest(".editor-surface") as HTMLElement | null;
    const mount = surface?.parentElement;
    const page = editor.view.dom.closest(".play-page") as HTMLElement | null;
    const list = commentsState(editor.state)?.entries ?? [];
    if (!column || !surface || !mount || !page) return;

    const surfaceRect = surface.getBoundingClientRect();
    const pad = getComputedStyle(mount);
    const desk =
      mount.clientWidth -
      (parseFloat(pad.paddingLeft) || 0) -
      (parseFloat(pad.paddingRight) || 0) -
      surfaceRect.width;
    // The sheet is centred, so reserving R on the right buys R/2 of column.
    const reserve = Math.min(
      Math.max(0, 2 * (COLUMN_PX + GAP_PX) - desk),
      Math.max(0, desk - 2 * MIN_DESK_PX),
    );
    // Desk first; then, if the desk is short, the page's own right margin — an
    // inch of blank paper the script never prints into. Measured (never taken
    // from the spec) so zoom and a format change are already in it, and every
    // term is independent of the reserve, so applying the reserve can't move
    // the answer. The text column is the floor: a card never covers a word.
    const rightDesk = (desk + reserve) / 2;
    const paper = page.getBoundingClientRect().right - editor.view.dom.getBoundingClientRect().right;
    const width = Math.min(COLUMN_PX, rightDesk + Math.max(0, paper - GAP_PX));
    const show = width >= MIN_COLUMN_PX && list.length > 0;
    const next: Geometry = show
      ? { show, width, reserve, left: surfaceRect.width + rightDesk - width }
      : NO_ROOM;
    setGeom((prev) =>
      prev.show === next.show &&
      prev.left === next.left &&
      prev.width === next.width &&
      prev.reserve === next.reserve
        ? prev
        : next,
    );

    if (!show) {
      setWants((prev) => (prev.size ? new Map() : prev));
      return;
    }
    const view = editor.view;
    const found = new Map<number, number>();
    let last: number | null = null;
    for (const entry of list) {
      const top = anchorTop(view, entry);
      // A comment that cannot be measured still gets a card — under the one
      // before it. Dropping it would make it invisible, which is the one
      // thing this surface exists to prevent.
      const spot: number = top !== null ? top - surfaceRect.top : (last ?? 0) + CARD_GAP_PX;
      found.set(entry.pos, spot);
      last = spot;
    }
    setWants((prev) => (sameSpots(prev, found) ? prev : found));
  }, [editor]);

  // The document, the panel and the reading focus all move the margin; so do
  // the pagination pass (which arrives as its own transaction), zoom, a format
  // change and the frame itself. One measure covers all of them.
  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setEntries(commentsState(editor.state)?.entries ?? []);
        setUi({ ...editor.storage.comments });
        measure();
      });
    };
    editor.on("transaction", schedule);
    const surface = columnRef.current?.closest(".editor-surface");
    const observer = new ResizeObserver(schedule);
    if (surface) observer.observe(surface);
    const page = editor.view.dom.closest(".play-page");
    if (page) observer.observe(page);
    window.addEventListener("resize", schedule);
    void document.fonts?.ready.then(schedule);
    schedule();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      editor.off("transaction", schedule);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [editor, measure]);

  useEffect(() => {
    onMargin?.({ show: geom.show, reserve: geom.show ? geom.reserve : 0 });
  }, [geom.show, geom.reserve, onMargin]);

  // A new comment (⌘⌥M) opens its card straight into typing.
  useEffect(() => {
    const entry = entries.find((entry) => entry.pos === ui.focusPos);
    if (ui.composing && entry && editingId !== entry.id) {
      setEditingId(entry.id);
      setDraft("");
    }
    // Only when the editor hands us a fresh comment to compose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.composing, ui.focusPos]);

  // Placement needs the rendered heights, so it happens after paint: the
  // cards go up at their anchors and the stack settles them.
  const placed = entries.filter((e) => wants.has(e.pos));  // measured this pass
  useLayoutEffect(() => {
    if (!geom.show) {
      setTops((prev) => (prev.size ? new Map() : prev));
      return;
    }
    const active = placed.findIndex((e) => e.pos === ui.focusPos);
    const boxes = placed.map((e) => ({
      want: wants.get(e.pos) ?? 0,
      height: cardRefs.current.get(e.pos)?.offsetHeight ?? 0,
    }));
    const next = new Map<number, number>();
    stackCards(boxes, { gap: CARD_GAP_PX, minTop: 0, active: active >= 0 ? active : null }).forEach(
      (top, i) => next.set(placed[i].pos, top),
    );
    setTops((prev) => (sameSpots(prev, next) ? prev : next));
  });

  // A card grows when it is edited (or when a long comment rewraps); the ones
  // under it move out of the way. Re-running the placement is enough — it
  // reads the heights back off the DOM.
  const cardResize = useRef<ResizeObserver | null>(null);
  useEffect(() => {
    const observer = new ResizeObserver(() => setTops((prev) => new Map(prev)));
    cardResize.current = observer;
    return () => {
      observer.disconnect();
      cardResize.current = null;
    };
  }, []);

  if (!geom.show) return <div className="comments-margin" ref={columnRef} hidden />;

  const noteAt = (pos: number) => {
    const node = editor.state.doc.nodeAt(pos);
    return node && node.type.name === "note" ? node : null;
  };

  const beginEdit = (entry: PmCommentEntry) => {
    editor.commands.focusComment(entry.pos);
    setEditingId(entry.id);
    setDraft(entry.text);
  };

  /** Save the card back into the note. An emptied comment is a resolved one. */
  const cancelEdit = (entry: PmCommentEntry) => {
    setEditingId(null);
    if (ui.composing) remove(entry.pos);
    else complete("Comment edit cancelled", entry.id);
  };

  const saveEdit = (id: string) => {
    const entry = commentsState(editor.state)?.entries.find((entry) => entry.id === id);
    if (!entry) { setEditingId(null); complete("Comment is no longer here", null); return; }
    const pos = entry.pos;
    const node = noteAt(pos);
    const text = draft.replace(/\n{2,}/g, "\n").trim(); // a note holds no blank lines
    setEditingId(null);
    setDraft("");
    if (!node) return;
    if (!text) {
      remove(pos);
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

  /** Resolve: the trail lives in the history ring and the ledger (docs/app/writing/comments.md#COMM-D5). */
  const remove = (pos: number) => {
    const index = placed.findIndex((entry) => entry.pos === pos);
    const next = placed[index + 1] ?? placed[index - 1];
    const node = noteAt(pos);
    if (!node) return;
    editor
      .chain()
      .command(({ tr, dispatch }) => {
        if (!dispatch) return true;
        const $pos = tr.doc.resolve(pos);
        const block = $pos.parent;
        // A standalone comment takes its (unprinted) line with it.
        if (block.childCount === 1) tr.delete($pos.before(), $pos.after());
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
    <div
      className="comments-margin"
      ref={columnRef}
      style={{ left: geom.left, width: geom.width }}
      aria-label="Comments"
    >
      {placed.map((entry) => {
        const active = ui.focusPos === entry.pos;
        const doomed = ui.doomedPos === entry.pos;
        const editing = editingId === entry.id;
        return (
          <article
            key={entry.id}
            ref={(el) => {
              if (el) {
                cardRefs.current.set(entry.pos, el);
                cardResize.current?.observe(el);
              } else {
                cardRefs.current.delete(entry.pos);
              }
            }}
            data-comment-id={entry.id}
            className={`comment-card${active ? " is-active" : ""}${doomed ? " is-doomed" : ""}`}
            style={{ top: tops.get(entry.pos) ?? wants.get(entry.pos) ?? 0 }}
            onMouseDown={(e) => {
              if (editing) return;
              e.preventDefault(); // the card takes the focus, not the caret
              editor.commands.focusComment(entry.pos);
            }}
            onMouseEnter={() => editor.commands.hoverComment(entry.pos)}
            onMouseLeave={() => editor.commands.hoverComment(null)}
          >
            <header className="comment-card__head">
              <span className="comment-card__author">
                {entry.parsed.author ?? (entry.parsed.todo ? "" : "Comment")}
              </span>
              {entry.parsed.todo && <span className="comments-chip is-todo">todo</span>}
              {!editing && (
                <span className="comment-card__actions">
                  <button
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => beginEdit(entry)}
                    title="Edit"
                    aria-label="Edit comment"
                  >
                    ✎
                  </button>
                  <button
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => remove(entry.pos)}
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
              )}
            </header>
            {editing ? (
              <div className="comment-card__edit">
                <textarea
                  className="comment-card__field"
                  value={draft}
                  autoFocus
                  rows={3}
                  placeholder="Comment…"
                  aria-label="Edit comment"
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      saveEdit(entry.id);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      cancelEdit(entry);
                    }
                  }}
                />
                <div className="comment-card__editrow">
                  <button onClick={() => saveEdit(entry.id)} title="Save (⌘⏎)">
                    Save
                  </button>
                  <button
                    onClick={() => {
                      cancelEdit(entry);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <p className="comment-card__body">{entry.parsed.body || <em>(empty)</em>}</p>
            )}
          </article>
        );
      })}
    </div>
  );
}
