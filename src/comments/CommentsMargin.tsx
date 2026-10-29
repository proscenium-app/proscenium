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
 * A card is a conversation: a comment and the replies under it
 * (docs/app/writing/comments.md#COMM-D10), drawn by Thread.tsx as the feed draws it.
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
import {
  commentsState,
  type CommentsStorage,
  type CommentThread,
  type PmCommentEntry,
} from "./plugin";
import { useCommentFocus } from "./focus";
import { sameSpots, stackCards } from "./stack";
import { ThreadView, threadIsBusy } from "./Thread";
import { useThreadEditing } from "./use-thread-editing";

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
  onNoRoom,
}: {
  editor: Editor;
  /** Reported to PlayEditor, which shifts the sheet and hides the inline chips. */
  onMargin?: (state: MarginState) => void;
  /**
   * A comment is being made or answered and there is no room here to type it:
   * the feed is the surface that always fits (docs/app/writing/comments.md#COMM-56).
   */
  onNoRoom?: () => void;
}) {
  const [threads, setThreads] = useState<CommentThread[]>(
    () => commentsState(editor.state)?.threads ?? [],
  );
  const [ui, setUi] = useState<CommentsStorage>(() => ({ ...editor.storage.comments }));
  const [geom, setGeom] = useState<Geometry>(NO_ROOM);
  /** Room for a column, whether or not there is yet a comment to put in it. */
  const [room, setRoom] = useState(false);
  const [wants, setWants] = useState<Map<number, number>>(() => new Map());
  const [tops, setTops] = useState<Map<number, number>>(() => new Map());
  const columnRef = useRef<HTMLDivElement | null>(null);
  const complete = useCommentFocus(editor, columnRef);
  const cardRefs = useRef(new Map<number, HTMLElement>());
  /** The caret was in the script when a card was pressed: a plain click gives it back. */
  const scriptHadFocus = useRef(false);

  /** Read the desk and the anchors. Cheap enough to run on every change. */
  const measure = useCallback(() => {
    const column = columnRef.current;
    const surface = column?.closest(".editor-surface") as HTMLElement | null;
    const mount = surface?.parentElement;
    const page = editor.view.dom.closest(".play-page") as HTMLElement | null;
    const list = commentsState(editor.state)?.threads ?? [];
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
    const paper =
      page.getBoundingClientRect().right - editor.view.dom.getBoundingClientRect().right;
    const width = Math.min(COLUMN_PX, rightDesk + Math.max(0, paper - GAP_PX));
    // Room is a fact about the desk, not about the script: it is known before
    // the first comment exists, which is when a new comment asks where it will
    // be typed.
    const hasRoom = width >= MIN_COLUMN_PX;
    setRoom(hasRoom);
    // Only when it changed. A command is a transaction whether or not it has
    // anything to say, and this runs after every transaction: said each time,
    // it measured itself again every frame, and the page layout, which waits
    // for the editor to go quiet, never ran.
    if (editor.storage.comments.marginRoom !== hasRoom) {
      editor.commands.setCommentMarginRoom(hasRoom);
    }
    const show = hasRoom && list.length > 0;
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
    for (const { root } of list) {
      const top = anchorTop(view, root);
      // A comment that cannot be measured still gets a card — under the one
      // before it. Dropping it would make it invisible, which is the one
      // thing this surface exists to prevent.
      const spot: number = top !== null ? top - surfaceRect.top : (last ?? 0) + CARD_GAP_PX;
      found.set(root.pos, spot);
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
        setThreads(commentsState(editor.state)?.threads ?? []);
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

  // Placement needs the rendered heights, so it happens after paint: the
  // cards go up at their anchors and the stack settles them.
  const placed = threads.filter((thread) => wants.has(thread.root.pos)); // measured this pass

  // A new comment (⌘⌥M) opens its card straight into typing, and one asked for
  // where a comment already is opens that card's reply.
  const editing = useThreadEditing({
    editor,
    threads: placed,
    takesNew: room,
    request: ui,
    complete,
  });

  // With no room for a card, the feed is where it is typed: ask for it.
  const wanted = ui.composing || ui.replying;
  useEffect(() => {
    if (wanted && !room) onNoRoom?.();
  }, [wanted, room, onNoRoom]);

  useLayoutEffect(() => {
    if (!geom.show) {
      setTops((prev) => (prev.size ? new Map() : prev));
      return;
    }
    const active = placed.findIndex((thread) => thread.root.pos === ui.focusPos);
    const boxes = placed.map((thread) => ({
      want: wants.get(thread.root.pos) ?? 0,
      height: cardRefs.current.get(thread.root.pos)?.offsetHeight ?? 0,
    }));
    const next = new Map<number, number>();
    stackCards(boxes, { gap: CARD_GAP_PX, minTop: 0, active: active >= 0 ? active : null }).forEach(
      (top, i) => next.set(placed[i].root.pos, top),
    );
    setTops((prev) => (sameSpots(prev, next) ? prev : next));
  });

  // A card grows when it is edited or answered (or when a long comment
  // rewraps); the ones under it move out of the way. Re-running the placement
  // is enough — it reads the heights back off the DOM.
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

  /**
   * A press on a comment's words may be the start of selecting them, so it is
   * let through; a plain click still leaves the caret where it was in the
   * script, as a press anywhere else on the card always has.
   */
  const returnCaret = () => {
    if (scriptHadFocus.current && window.getSelection()?.isCollapsed !== false) editor.view.focus();
  };

  return (
    <div
      className="comments-margin"
      ref={columnRef}
      style={{ left: geom.left, width: geom.width }}
      aria-label="Comments"
    >
      {placed.map((thread) => {
        const { root } = thread;
        const active = ui.focusPos === root.pos;
        const doomed = ui.doomedPos === root.pos;
        const busy = threadIsBusy(thread, editing);
        return (
          <article
            key={root.id}
            ref={(el) => {
              if (el) {
                cardRefs.current.set(root.pos, el);
                cardResize.current?.observe(el);
              } else {
                cardRefs.current.delete(root.pos);
              }
            }}
            data-comment-id={root.id}
            className={`comment-card${active ? " is-active" : ""}${doomed ? " is-doomed" : ""}`}
            style={{ top: tops.get(root.pos) ?? wants.get(root.pos) ?? 0 }}
            onMouseDown={(e) => {
              if (busy) return;
              scriptHadFocus.current = editor.view.hasFocus();
              const words = (e.target as HTMLElement).closest(".cthread__body");
              if (!words) e.preventDefault(); // the card takes the focus, not the caret
              editor.commands.focusComment(root.pos);
            }}
            onMouseEnter={() => editor.commands.hoverComment(root.pos)}
            onMouseLeave={() => editor.commands.hoverComment(null)}
          >
            <ThreadView
              editor={editor}
              thread={thread}
              editing={editing}
              onWordsClick={returnCaret}
            />
          </article>
        );
      })}
    </div>
  );
}
