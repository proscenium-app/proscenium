// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The element bar — one quiet strip over the paper: what this line is, how to
 * emphasise it, the two breaks, comments, and the page count.
 *
 * **The row of element buttons is gone** (docs/app/writing/editor-ux.md#EDIT-170). It was a "Line Types"
 * palette behind a chevron, and compact-with-a-dropdown had been the
 * DEFAULT since B / I / U joined the bar — but the open/closed state was remembered in localStorage,
 * so a writer who expanded it once never left. The expanded row was reported as
 * though it were the design, which is the tell: a mode you enter by accident and
 * never exit is not a preference. The dropdown is now the only way this control
 * is drawn, and every element type keeps the three ways in it always had —
 * Tab cycles, `;` opens the leader menu, ⌘⌥+letter sets one directly.
 *
 * It also carries the two things that were built and invisible:
 * **emphasis** (B / I / U, already bound to ⌘B/⌘I/⌘U and already round-tripping
 * through Fountain's `*italic*` / `**bold**` / `_underline_`) and **breaks** (a
 * line break inside a block, and a forced page break the schema has always had
 * and nothing could reach). Both groups disable themselves where the gesture has
 * no business — a cue is a name, not a place for bold — rather than presenting a
 * button that silently does nothing.
 *
 * That also finishes what the usability pass asked for: "the element bar is the
 * most prominent thing on screen … for a mechanism the design premise says you
 * should almost never need". Nothing is lost — the popup still names every
 * element and still shows each one's chord.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { FormattingIcon } from "../ui/FormattingIcon";
import { canEmphasize, canSoftBreak, insertLineBreak, insertPageBreak, toggleEmphasis } from "./breaks";
import {
  CommentAddIcon,
  CommentIcon,
  EllipsisIcon,
  LineBreakIcon,
  Menu,
  PageBreakIcon,
  PopupButton,
  useMenu,
  type MenuEntry,
  type PopupOption,
} from "../ui";

interface ElementChoice {
  type: string;
  label: string;
  /** Shortcut shown on the button when ⌘ is held (matches the live keymap). */
  hint: string;
  attrs?: Record<string, unknown>;
}

// Ordered the way a writer reaches for them: structure, then the body cluster
// (the Tab-cycle ring), then the special ones. That order is the popup's order.
const ALL: ElementChoice[] = [
  { type: "act", label: "Act", hint: "⌘⌥1" },
  { type: "scene", label: "Scene", hint: "⌘⌥2" },
  { type: "sceneHeading", label: "Scene Heading", hint: "⌘⌥S" },
  { type: "action", label: "Action", hint: "⌘⌥A" },
  { type: "character", label: "Character", hint: "⌘⌥C" },
  { type: "parenthetical", label: "Parenthetical", hint: "⌘⌥P" },
  { type: "dialogue", label: "Dialogue", hint: "⌘⌥D" },
  { type: "transition", label: "Transition", hint: "⌘⌥T" },
  { type: "lyric", label: "Lyric", hint: "⌘⌥L" },
  { type: "centered", label: "Centered Text", hint: "; >" },
  { type: "synopsis", label: "Scene Summary (Not Printed)", hint: "; =" },
];
const HAS_LABEL = new Set(ALL.map((e) => e.type));
const LABEL_OF = new Map(ALL.map((e) => [e.type, e.label]));

/** The name a writer knows an element by — what the bar shows, and what is spoken. */
export function elementLabel(type: string): string | undefined {
  return LABEL_OF.get(type) ?? (type === "note" ? "Comment" : undefined);
}

/** Fountain carries all three (`**bold**` / `*italic*` / `_underline_`). */
const MARKS: { name: string; label: string; hint: string; title: string }[] = [
  { name: "strong", label: "B", hint: "⌘B", title: "Bold" },
  { name: "em", label: "I", hint: "⌘I", title: "Italic" },
  { name: "underline", label: "U", hint: "⌘U", title: "Underline" },
];

/**
 * How the bar gives way in a narrow pane (docs/app/writing/editor-ux.md#EDIT-171),
 * richest first. Each step keeps everything the one before it gave up, and the
 * bar takes the first that fits on ONE row: the "Tab cycles" hint goes, the
 * breaks and comments keep only their icons, and then whole groups fold into
 * More, least-reached first. The element popup and "Page N of M" never go; at
 * the last step the popup's name shortens instead.
 */
const FITS = [
  "",
  "terse",
  "terse icons",
  "terse icons fold-comments",
  "terse icons fold-comments fold-breaks",
  "terse icons fold-comments fold-breaks fold-marks",
];

/** Does anything in the bar end past its content edge? Its items never
    shrink, so a bar too narrow for them overflows rather than squeezing. */
function overflows(bar: HTMLElement): boolean {
  const edge = bar.getBoundingClientRect().right - (parseFloat(getComputedStyle(bar).paddingRight) || 0);
  for (const item of bar.children) {
    if (item.getBoundingClientRect().right > edge + 0.5) return true;
  }
  return false;
}

/** Try each fit, richest first, and keep the first that shows on one row. */
function fitBar(bar: HTMLElement) {
  for (const fit of FITS) {
    bar.dataset.fit = fit;
    if (!overflows(bar)) return;
  }
}

/* The remembered open/closed flag goes with the branch it toggled. A stored
   preference that outlives the thing it controlled is what kept a writer in a
   mode the default had already left. */
try {
  localStorage.removeItem("proscenium:elementBarOpen");
} catch {
  /* chrome preference only — never worth failing a mount over */
}

export function ElementBar({
  editor,
  commentsOpen = false,
  onToggleComments,
}: {
  editor: Editor;
  /** The Comments feed pane is open (App owns the pane tree). */
  commentsOpen?: boolean;
  onToggleComments?: () => void;
}) {
  const [type, setType] = useState("action");
  const [revealing, setRevealing] = useState(false);
  /** Marks live at the caret, so they're read on every selection change too. */
  const [marks, setMarks] = useState<Record<string, boolean>>({});
  const [can, setCan] = useState({ emphasis: false, lineBreak: false });
  const [pages, setPages] = useState<{ current: number; total: number }>({
    current: 1,
    total: 0,
  });
  const [commentCount, setCommentCount] = useState(0);
  const barRef = useRef<HTMLDivElement | null>(null);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const more = useMenu();

  // Track the element at the caret so the active button stays in sync, mirror
  // the layout engine's page count, and read the active marks — the emphasis
  // buttons track the caret exactly the way the element buttons track the block
  // type.
  useEffect(() => {
    const update = () => {
      const node = editor.state.selection.$from.parent;
      if (node.isTextblock) setType(node.type.name);
      setMarks((prev) => {
        const next: Record<string, boolean> = {};
        let changed = false;
        for (const m of MARKS) {
          next[m.name] = editor.isActive(m.name);
          if (next[m.name] !== prev[m.name]) changed = true;
        }
        return changed ? next : prev;
      });
      setCan((prev) => {
        const emphasis = canEmphasize(node);
        const lineBreak = canSoftBreak(node);
        return prev.emphasis === emphasis && prev.lineBreak === lineBreak
          ? prev
          : { emphasis, lineBreak };
      });
      const pg = editor.storage.pagination;
      if (pg) {
        setPages((prev) =>
          prev.current === pg.current && prev.total === pg.total
            ? prev
            : { current: pg.current, total: pg.total },
        );
      }
      const cm = editor.storage.comments;
      if (cm) setCommentCount((prev) => (prev === cm.count ? prev : cm.count));
    };
    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    update();
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
    };
  }, [editor]);

  // Hold ⌘ to reveal shortcuts — brighten the badges on Meta/Ctrl.
  useEffect(() => {
    const isMod = (e: KeyboardEvent) => e.key === "Meta" || e.key === "Control";
    const down = (e: KeyboardEvent) => isMod(e) && setRevealing(true);
    const up = (e: KeyboardEvent) => isMod(e) && setRevealing(false);
    const clear = () => setRevealing(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
    };
  }, []);

  /* Fit the bar to its room. Its OWN box never depends on what it holds
     (stage-format.css), so trying a fit cannot resize it: the observer sees
     the pane, the zoom and the rails move it, never its own fitting. What it
     holds changes on a render (the element's name, the counts), and the page
     count's box stands in for everything else that resizes the words — a font
     arriving, the interface text size. */
  const hasPages = pages.total > 0;
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    let live = true;
    const refit = () => live && fitBar(bar);
    const observer = new ResizeObserver(refit);
    observer.observe(bar);
    const count = bar.querySelector(".elementbar__pages");
    if (count) observer.observe(count);
    void document.fonts?.ready.then(refit);
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [hasPages]);
  useLayoutEffect(() => {
    if (barRef.current) fitBar(barRef.current);
  });

  const setElement = (t: string, attrs?: Record<string, unknown>) =>
    editor.chain().focus().setNode(t, attrs).run();

  // Both groups are shown in either mode: emphasis is the thing a
  // writer looks for and concludes the app can't do, and the breaks are the
  // gestures nothing on screen ever named.
  const emphasisGroup = (
    <div className="elementbar__group elementbar__fold--marks" key="emphasis" data-tutorial="emphasis">
      {MARKS.map((m) => (
        <button
          key={m.name}
          type="button"
          className={`elementbar__btn elementbar__btn--mark elementbar__btn--${m.name}${
            marks[m.name] ? " is-active" : ""
          }`}
          disabled={!can.emphasis}
          // Mouse-down only keeps the caret: a press would move focus out of
          // the editor and collapse the selection first. The action itself is
          // on click, so Space, Return and an assistive press all reach it.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => toggleEmphasis(editor, m.name)}
          title={
            can.emphasis
              ? `${m.title} · ${m.hint}`
              : `${m.title} — not in ${LABEL_OF.get(type) ?? "this element"}; its weight comes from the format`
          }
          aria-pressed={!!marks[m.name]}
          aria-label={m.title}
          data-tutorial={m.name === "strong" ? "bold" : undefined}
          aria-keyshortcuts={`Meta+${m.label.toLowerCase()}`}
        >
          <FormattingIcon name={m.name === "strong" ? "bold" : m.name === "em" ? "italic" : "underline"} />
          <kbd className="elementbar__badge">{m.hint}</kbd>
        </button>
      ))}
    </div>
  );

  const breakGroup = (
    <div className="elementbar__group elementbar__fold--breaks" key="breaks">
      <button
        type="button"
        className="elementbar__btn"
        disabled={!can.lineBreak}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => insertLineBreak(editor)}
        data-tutorial="line-break"
        title={
          can.lineBreak
            ? "Line Break — the next line, same element · ⇧⏎"
            : `Line Break — ${LABEL_OF.get(type) ?? "this element"} is one line by construction`
        }
      >
        <LineBreakIcon size={12} />
        <span className="elementbar__btnlabel">Line Break</span>
        <kbd className="elementbar__badge">⇧⏎</kbd>
      </button>
      <button
        type="button"
        className="elementbar__btn"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => insertPageBreak(editor)}
        data-tutorial="page-break"
        title="Page Break — force the next page here · ⌘⏎"
      >
        <PageBreakIcon size={12} />
        <span className="elementbar__btnlabel">Page Break</span>
        <kbd className="elementbar__badge">⌘⏎</kbd>
      </button>
    </div>
  );

  /* Every element the bar knows, as one popup — the compact bar's own way to
     change what a line is, beside the two it already teaches (Tab and `;`). */
  const elementOptions: PopupOption<string>[] = ALL.map((el) => ({
    value: el.type,
    label: el.label,
    hint: el.hint,
  }));
  if (!HAS_LABEL.has(type)) {
    // The caret is in a block with no button (a note, a page break). Name it
    // rather than showing the popup as if it were on something it can set.
    elementOptions.push({ value: type, label: type, disabled: true });
  }

  /** What folded into More, read when it opens: the fit is the DOM's, not state. */
  const folded = (group: string) =>
    (barRef.current?.dataset.fit ?? "").split(" ").includes(`fold-${group}`);
  const moreEntries = (): MenuEntry[] => {
    const out: MenuEntry[] = [];
    const sep = () => out.length && out.push({ kind: "sep" });
    if (folded("marks")) {
      for (const m of MARKS) {
        out.push({
          label: m.title,
          shortcut: m.hint,
          checked: !!marks[m.name],
          disabled: !can.emphasis,
          onSelect: () => toggleEmphasis(editor, m.name),
        });
      }
    }
    if (folded("breaks")) {
      sep();
      out.push(
        { label: "Line Break", shortcut: "⇧⏎", disabled: !can.lineBreak, onSelect: () => insertLineBreak(editor) },
        { label: "Page Break", shortcut: "⌘⏎", onSelect: () => insertPageBreak(editor) },
      );
    }
    if (folded("comments")) {
      sep();
      out.push(
        { label: "Comment", shortcut: "⌘⌥M", onSelect: () => editor.chain().focus().addComment().run() },
        {
          label: commentCount > 0 ? `Comments (${commentCount})` : "Comments",
          shortcut: "⌘⇧C",
          checked: commentsOpen,
          disabled: !onToggleComments,
          onSelect: () => onToggleComments?.(),
        },
      );
    }
    return out;
  };

  return (
    <div ref={barRef} className={`elementbar${revealing ? " is-revealing" : ""}`}>
      <div className="elementbar__groups">
        <span className="elementbar__line" data-tutorial="line-type"><PopupButton
          label="What this line is"
          menuId="line-type"
          className="elementbar__what"
          options={elementOptions}
          value={type}
          onChange={(v) => setElement(v, ALL.find((e) => e.type === v)?.attrs)}
          menuWidth={190}
        /></span>
        <span className="elementbar__hint">Tab cycles · ; menu</span>
        <span className="elementbar__divider elementbar__fold--marks" />
        {emphasisGroup}
        <span className="elementbar__divider elementbar__fold--breaks" />
        {breakGroup}
      </div>
      <span className="elementbar__divider elementbar__fold--comments" />
      {/* Comments live in the script as [[ ]] notes. The first button writes
          one at the selection, the second swaps the margin for the full list
          (docs/app/writing/comments.md#COMM-D4, docs/app/writing/comments.md#COMM-D5, docs/app/writing/comments.md#COMM-D6). */}
      <button
        type="button"
        className="elementbar__btn elementbar__fold--comments"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor.commands.addComment()}
        title="Comment on the selection — a [[ ]] note after it · ⌘⌥M"
      >
        <span className="elementbar__onlyicon"><CommentAddIcon size={12} /></span>
        <span className="elementbar__btnlabel">+ Comment</span>
        <kbd className="elementbar__badge">⌘⌥M</kbd>
      </button>
      <button
        type="button"
        className={`elementbar__btn elementbar__comments elementbar__fold--comments${commentsOpen ? " is-active" : ""}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onToggleComments?.()}
        title="The comment feed — every comment in the script, click one to go to it · ⌘⇧C"
        aria-pressed={commentsOpen}
        disabled={!onToggleComments}
      >
        <CommentIcon size={12} />
        <span className="elementbar__btnlabel">
          Comments{commentCount > 0 ? ` (${commentCount})` : ""}
        </span>
        {commentCount > 0 && (
          <span className="elementbar__count" aria-hidden="true">{commentCount}</span>
        )}
        <kbd className="elementbar__badge">⌘⇧C</kbd>
      </button>
      {/* Whatever the pane has no room for. The guide looks for a folded
          control here (`data-tutorial-folded`), so a lesson that names one
          still points somewhere. */}
      <span className="elementbar__overflow">
        <span className="elementbar__divider" />
        <button
          ref={moreRef}
          type="button"
          className="elementbar__btn elementbar__more"
          aria-label="More"
          aria-haspopup="menu"
          aria-expanded={more.open}
          title="More — what this pane is too narrow to show"
          data-tutorial-folded="bold line-break page-break"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => more.openFrom(moreRef.current, "end")}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              more.openFrom(moreRef.current, "end");
            }
          }}
        >
          <EllipsisIcon size={14} />
        </button>
      </span>
      {more.anchor && (
        <Menu anchor={more.anchor} entries={moreEntries()} onClose={more.close} width={200} label="More" />
      )}
      <span className="elementbar__spacer" />
      {pages.total > 0 && (
        <span
          className="elementbar__pages"
          title="Tab cycles · ; opens the element menu · hold ⌘ for keys"
        >
          {/* A page count, and only that. A minute estimate sat
              beside it, one page to a minute; a page is not a minute, and a
              real minute counter would be built from something else. */}
          Page {pages.current} of {pages.total}
        </span>
      )}
    </div>
  );
}
