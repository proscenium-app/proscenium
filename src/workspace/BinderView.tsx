// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The binder (left rail) — an ordered materials tree
 * (docs/app/organizing/workspace-model.md#WORK-D1). Selecting a script opens it in the editor;
 * drag reorders/moves items and the change is mapped to disk by binder-apply.
 *
 * ## What this surface owes the writer
 *
 * The previous version could technically do most of this and still felt broken,
 * because a file tree is almost entirely FEEDBACK. Dragging a row gave none: no
 * line showing where it would land, no highlight on the folder it would enter,
 * no target at all on the empty space below the tree, and a collapsed folder
 * stayed collapsed no matter how long you hovered over it. A drop that missed
 * a row by three pixels did nothing and said nothing, which is indistinguishable
 * from a drag that doesn't work.
 *
 * So: an insertion line at the exact depth the row will land, a ring on the
 * folder that will receive it, spring-loaded folders that open under the
 * pointer, and the whole empty area below the tree as a root drop target. Plus
 * the things every file tree has and this one didn't — a right-click menu,
 * arrow-key navigation, type-ahead, a filter, duplicate, and Reveal in Finder.
 *
 * Drag is HTML5 drag-and-drop because a binder row must also be draggable ONTO
 * a pane (PaneTree reads BINDER_MIME off the same gesture). The native app
 * turns Tauri's own OS-level drag handler off (`dragDropEnabled: false`) so the
 * webview sees these events at all.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BINDER_MIME } from "../app/PaneTree";
import { ancestorsOf, dropPlan, filterBinder, findItem, folderIds, type DropWhere } from "./binder";
import { BinderIcon, DisclosureIcon, PencilIcon, type IconKind } from "./BinderIcons";
import { Menu, PlusIcon, announce, requestPageFocus, useMenu, type MenuEntry } from "../ui";
import { normalizeType } from "../materials/schema";
import { titleOf } from "./binder";
import type { BinderItem, BinderItemType } from "./play-file";
import { BinderMoveSheet } from "./BinderMoveSheet";

/** One scene, as the rail shows it. Display-only: a scene is not a file. */
export interface BinderScene {
  id: string;
  ordinal: number;
  label: string;
  color: string;
  /** "7–10", from `scenePages`; absent while the script has not paginated. */
  pages: string | null;
}

export interface BinderProps {
  binder: BinderItem[];
  activeId: string | null;
  playTitle: string;
  readOnly: boolean;
  /**
   * A freshly-created item, to show (its folders open) and — when `name` — to
   * open in rename mode (then cleared). App opens its page; the binder hands
   * the cursor there once the name is done (docs/app/preferences-and-help/accessibility.md#A11Y-4).
   */
  justCreated: { id: string; name: boolean } | null;
  onConsumeCreated: () => void;
  onSelect: (item: BinderItem) => void;
  onReorder: (id: string, toIndex: number) => void;
  onMove: (id: string, parentId: string | null, atIndex: number) => void;
  onRename: (id: string, title: string) => void;
  /** Move to Trash. No dialog: the app trashes to the OS, so a confirm() was
      friction with no safety behind it (docs/app/keeping-work/storage-and-file-format.md#STOR-90). The shell shows an undo
      toast instead — this only has to say which row went. */
  onDelete: (id: string) => void;
  /** Open this row in a pane of its own (the context menu's first item). */
  onOpenInNewPane?: (item: BinderItem) => void;
  /**
   * The open script's scenes, for the rows under it (docs/app/organizing/workspace-model.md#WORK-5). Derived by App
   * from `cards` + `scenePages` — the binder holds no scene state of its own,
   * so it cannot disagree with the board about what a scene is.
   */
  scenes?: BinderScene[];
  /** The scene the caret is in, so the rail marks where you are writing. */
  caretScene?: number | null;
  onOpenScene?: (ordinal: number) => void;
  onDuplicate?: (id: string) => void;
  /** Show this item in the OS file manager. Absent where the host has none. */
  onReveal?: (id: string) => void;
  onNewFolder: (parentId: string | null, title: string, atIndex?: number) => void;
  onNewMaterial: (
    parentId: string | null,
    type: BinderItemType,
    title: string,
    atIndex?: number,
    opts?: { name?: boolean },
  ) => void;
  onNewScript: (parentId: string | null, title: string, atIndex?: number) => void;
  /** Import a draft into this play as a script or a document, into `parentId`'s
   * folder when there is one (docs/app/importing/document-import.md#IMPT-95). */
  onImport?: (parentId: string | null) => void;
  /** Files dropped from Finder onto the binder: the same review, aimed at the
   * folder they were dropped on (docs/app/importing/document-import.md#IMPT-95). */
  onImportFiles?: (files: File[], parentId: string | null) => void;
  /** Jump to the Cast surface (a pinned shortcut above the tree). */
  onOpenCast?: () => void;
  /** Highlight the Cast shortcut when that surface is showing. */
  castActive?: boolean;
  /**
   * Ids the app filed for the writer rather than the writer filing them —
   * typically a material something else just created. Marked with a dot so arriving
   * work is visible rather than silently absorbed.
   */
  newlyFiled?: Set<string>;
  /** Ids whose file is missing on disk. Greyed and labelled, never removed. */
  missingIds?: Set<string>;
  /** The writer has seen what arrived — drop the dots. */
  onAcknowledgeFiled?: () => void;
}

/**
 * What "New" can make.
 *
 * Four entries, down from six, because there are four things (schema.ts):
 * Document is the default and comes first — it is what nearly every new file
 * actually is, and putting it first means the common case is the top of the
 * menu rather than a choice between five near-synonyms. Import… comes last:
 * not a fifth thing, but a way to make one of them from a file the writer has.
 *
 * A document is written in at once: its page takes the cursor, and its name
 * waits in the page's header, F2 or a double-click (docs/app/preferences-and-help/accessibility.md#A11Y-4). A character
 * is named first, because the Cast finds a sheet by its name and "New
 * Character" matches nobody; a script and a folder are named first too.
 */
const CREATE_KINDS: {
  label: string;
  hint: string;
  run: (p: BinderProps, parentId: string | null, atIndex?: number) => void;
}[] = [
  {
    label: "Document",
    hint: "A blank Markdown page",
    run: (p, id, at) => p.onNewMaterial(id, "document", "Untitled", at),
  },
  {
    label: "Character",
    hint: "A character sheet the Cast reads",
    run: (p, id, at) => p.onNewMaterial(id, "character", "New Character", at, { name: true }),
  },
  {
    label: "Script",
    hint: "A new .fountain script",
    run: (p, id, at) => p.onNewScript(id, "Untitled Script", at),
  },
  {
    label: "Folder",
    hint: "A folder on disk and in the binder",
    run: (p, id, at) => p.onNewFolder(id, "New Folder", at),
  },
  {
    label: "Import…",
    hint: "A script or document from a file you have",
    // Into the folder it was chosen from; at the end of it, so several files
    // keep the order they were chosen in.
    run: (p, id) => p.onImport?.(id),
  },
];

/**
 * A drag from outside the app carrying files, over a binder that can import
 * them. A drag of the binder's own rows carries no files and sets `dragId`.
 */
function fromFinder(
  e: React.DragEvent,
  dragId: string | null,
  p: Pick<BinderProps, "onImportFiles" | "readOnly">,
): boolean {
  return !dragId && !!p.onImportFiles && !p.readOnly && e.dataTransfer.types.includes("Files");
}

/** Binder item type → icon, resolving the old type names through the normalizer. */
function iconKindFor(type: string): IconKind {
  return normalizeType(type) as IconKind;
}

/** localStorage key for which folders are open, scoped to the play. */
function expandKey(playTitle: string): string {
  return `proscenium.binder.expanded:${playTitle}`;
}

/** A row as the tree actually renders it — the unit keyboard navigation moves over. */
type Row =
  | {
      kind: "file";
      id: string;
      label: string;
      item: BinderItem;
      depth: number;
      parentId: string | null;
    }
  | {
      kind: "scene";
      id: string;
      label: string;
      scene: BinderScene;
      depth: number;
      parentId: string;
    };

const sceneRowId = (script: string, scene: string) => `scene:${script}:${scene}`;

function visibleRows(
  items: BinderItem[],
  isOpen: (id: string) => boolean,
  activeId: string | null,
  scenes: BinderScene[],
  depth = 0,
  parentId: string | null = null,
  out: Row[] = [],
): Row[] {
  for (const item of items) {
    out.push({ kind: "file", id: item.id, label: titleOf(item), item, depth, parentId });
    if (item.type === "script" && item.id === activeId) {
      for (const scene of scenes)
        out.push({
          kind: "scene",
          id: sceneRowId(item.id, scene.id),
          label: scene.label,
          scene,
          depth: depth + 1,
          parentId: item.id,
        });
    }
    if (item.type === "folder" && item.children?.length && isOpen(item.id)) {
      visibleRows(item.children, isOpen, activeId, scenes, depth + 1, item.id, out);
    }
  }
  return out;
}

/** Where in the row the pointer is, and therefore what the drop means. */
function whereIn(rect: DOMRect, y: number, isFolder: boolean): DropWhere {
  const f = (y - rect.top) / rect.height;
  if (!isFolder) return f < 0.5 ? "before" : "after";
  // A folder gets a fat middle: dropping INTO is the common intent, and the
  // thin edges are there for the writer who is deliberately ordering.
  if (f < 0.28) return "before";
  if (f > 0.72) return "after";
  return "inside";
}

interface DropState {
  targetId: string | null;
  where: DropWhere;
  ok: boolean;
}

export function Binder(props: BinderProps) {
  const { binder, activeId, playTitle, readOnly } = props;

  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(expandKey(playTitle));
      return raw ? new Set<string>(JSON.parse(raw) as string[]) : new Set<string>();
    } catch {
      return new Set<string>();
    }
  });
  const [query, setQuery] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropState | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [cursorId, setCursorId] = useState<string | null>(activeId);
  const treeRef = useRef<HTMLDivElement | null>(null);
  const springRef = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);

  // Folders are open by default and we persist only the CLOSED ones, so a
  // folder that arrives later (another tool's, a sync's) shows its contents rather
  // than hiding them behind a disclosure the writer never touched.
  useEffect(() => {
    try {
      localStorage.setItem(expandKey(playTitle), JSON.stringify([...collapsed]));
    } catch {
      /* a preference that won't persist still works this session */
    }
  }, [collapsed, playTitle]);

  const filtered = useMemo(() => filterBinder(binder, query), [binder, query]);
  // A filter that left folders shut would hide its own results.
  const isOpen = useCallback(
    (id: string) => (query.trim() ? true : !collapsed.has(id)),
    [collapsed, query],
  );
  const rows = useMemo(
    () => visibleRows(filtered, isOpen, activeId, props.scenes ?? []),
    [filtered, isOpen, activeId, props.scenes],
  );
  const treeHadFocus = useRef(false);

  /* The cursor's row can vanish under it — Move to Trash, a file gone from
     disk. The cursor moves to whatever took its place, rather than leaving
     aria-activedescendant naming a node that no longer exists (which also left
     the keyboard with no row to act on). */
  const cursorIndexRef = useRef(-1);
  const cursorInRows = cursorId !== null && rows.some((r) => r.id === cursorId);
  useEffect(() => {
    if (!cursorId) return;
    const i = rows.findIndex((r) => r.id === cursorId);
    if (i >= 0) {
      cursorIndexRef.current = i;
      return;
    }
    const next = rows[Math.min(Math.max(cursorIndexRef.current, 0), rows.length - 1)];
    setCursorId(next ? next.id : null);
  }, [rows, cursorId]);

  useEffect(() => {
    if (activeId) setCursorId(activeId);
  }, [activeId]);

  /**
   * Anything the app just made or just filed has to be VISIBLE. Creating a
   * document inside a shut folder used to leave it on disk, selected, and in
   * rename mode behind a closed disclosure — from the writer's side, nothing
   * happened, and their typing went into a field that was not on screen.
   *
   * Opening it is App's job now: the Cast makes sheets with the
   * binder closed, when this effect is not mounted to open anything.
   */
  const reveal = props.justCreated?.id ?? null;
  useEffect(() => {
    if (!reveal) return;
    const chain = ancestorsOf(binder, reveal);
    if (!chain.length) return;
    setCollapsed((cur) => {
      if (!chain.some((id) => cur.has(id))) return cur;
      const next = new Set(cur);
      for (const id of chain) next.delete(id);
      return next;
    });
  }, [reveal, binder]);
  /** The row being named on its way to its page: ⏎ or ⎋ in its name hands the cursor on. */
  const namingNew = useRef<string | null>(null);

  const toggle = useCallback((id: string, deep: boolean, tree: BinderItem[]) => {
    setCollapsed((cur) => {
      const next = new Set(cur);
      const closing = !next.has(id);
      const ids = deep ? [id, ...folderIds(findItem(tree, id)?.item.children ?? [])] : [id];
      for (const each of ids) closing ? next.add(each) : next.delete(each);
      return next;
    });
  }, []);

  const clearDrag = useCallback(() => {
    if (springRef.current) clearTimeout(springRef.current.timer);
    springRef.current = null;
    setDragId(null);
    setDrop(null);
  }, []);

  /** Hovering a shut folder mid-drag opens it, the way Finder does. */
  const spring = useCallback((id: string) => {
    if (springRef.current?.id === id) return;
    if (springRef.current) clearTimeout(springRef.current.timer);
    springRef.current = {
      id,
      timer: setTimeout(
        () =>
          setCollapsed((cur) => {
            if (!cur.has(id)) return cur;
            const next = new Set(cur);
            next.delete(id);
            return next;
          }),
        600,
      ),
    };
  }, []);

  const dragOver = useCallback(
    (targetId: string | null, where: DropWhere) => {
      if (!dragId) return;
      const plan = dropPlan(binder, dragId, targetId, where);
      setDrop({ targetId, where, ok: plan !== null });
    },
    [binder, dragId],
  );

  const commitDrop = useCallback(
    (targetId: string | null, where: DropWhere) => {
      const id = dragId;
      clearDrag();
      if (!id) return;
      const plan = dropPlan(binder, id, targetId, where);
      if (!plan) return;
      const src = findItem(binder, id);
      if (src && src.parentId === plan.parentId) props.onReorder(id, plan.atIndex);
      else props.onMove(id, plan.parentId, plan.atIndex);
    },
    [binder, dragId, clearDrag, props],
  );

  /**
   * Where a new item goes: inside the selected folder, or immediately after the
   * selected file. The writer is looking at a place in the play, and "New"
   * means "here", not "at the bottom".
   */
  const createTarget = useCallback((): { parentId: string | null; atIndex?: number } => {
    const sel = cursorId ? findItem(binder, cursorId) : null;
    if (!sel) return { parentId: null };
    if (sel.item.type === "folder") return { parentId: sel.item.id };
    return { parentId: sel.parentId, atIndex: sel.index + 1 };
  }, [binder, cursorId]);

  const create = useCallback(
    (kind: (typeof CREATE_KINDS)[number], at?: { parentId: string | null; atIndex?: number }) => {
      const t = at ?? createTarget();
      kind.run(props, t.parentId, t.atIndex);
    },
    [createTarget, props],
  );

  // --- keyboard ---------------------------------------------------------
  const typeahead = useRef<{ buffer: string; at: number }>({ buffer: "", at: 0 });

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (renamingId) return;
    const i = rows.findIndex((r) => r.id === cursorId);
    const current = i >= 0 ? rows[i] : null;
    const row = current?.kind === "file" ? current : null;
    const go = (n: number) => {
      const next = rows[Math.max(0, Math.min(rows.length - 1, n))];
      if (next) setCursorId(next.id);
    };

    if (current?.kind === "scene") {
      // A scene has navigation and activation, never file mutation commands.
      if (e.key === "Enter") {
        e.preventDefault();
        props.onOpenScene?.(current.scene.ordinal);
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setCursorId(current.parentId);
        return;
      }
      if (["F2", "Backspace", "Delete"].includes(e.key) || e.ctrlKey || e.metaKey) {
        e.preventDefault();
        return;
      }
    }

    /* ⌃⌘ + arrow moves the item. Filing was drag-only,
       so a writer without a pointer could make a document and never put it in
       a folder (WCAG 2.5.7). The moves go through the same drop plan a drag
       does, so the keyboard cannot file anything a drag would refuse. */
    if (e.ctrlKey && e.metaKey && !e.altKey && row && !readOnly && !query.trim()) {
      const here = findItem(binder, row.item.id);
      if (here) {
        const siblings = here.parentId
          ? (findItem(binder, here.parentId)?.item.children ?? [])
          : binder;
        let plan: ReturnType<typeof dropPlan> = null;
        let said = "";
        if (e.key === "ArrowUp" && here.index > 0) {
          plan = dropPlan(binder, row.item.id, siblings[here.index - 1].id, "before");
          said = "Moved up";
        } else if (e.key === "ArrowDown" && here.index < siblings.length - 1) {
          plan = dropPlan(binder, row.item.id, siblings[here.index + 1].id, "after");
          said = "Moved down";
        } else if (e.key === "ArrowLeft" && here.parentId) {
          plan = dropPlan(binder, row.item.id, here.parentId, "after");
          said = "Moved out of the folder";
        } else if (e.key === "ArrowRight" && here.index > 0) {
          const before = siblings[here.index - 1];
          if (before.type === "folder") {
            plan = dropPlan(binder, row.item.id, before.id, "inside");
            said = `Moved into ${titleOf(before)}`;
          }
        }
        if (e.key.startsWith("Arrow")) {
          e.preventDefault();
          e.stopPropagation();
          if (plan) {
            if (here.parentId === plan.parentId) props.onReorder(row.item.id, plan.atIndex);
            else props.onMove(row.item.id, plan.parentId, plan.atIndex);
            announce(`${said}: ${titleOf(row.item)}`);
          }
          return;
        }
      }
    }

    // ⇧F10 and ⌃⏎ open the row's actions — the right-click, from the keyboard.
    if (row && ((e.key === "F10" && e.shiftKey) || (e.key === "Enter" && e.ctrlKey))) {
      e.preventDefault();
      const el = document.getElementById(`binderrow-${row.item.id}`);
      const r = el?.getBoundingClientRect();
      if (r) setMenu({ id: row.item.id, x: r.left + 24, y: r.bottom });
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        return go(i + 1);
      case "ArrowUp":
        e.preventDefault();
        return go(i - 1);
      case "Home":
        e.preventDefault();
        return go(0);
      case "End":
        e.preventDefault();
        return go(rows.length - 1);
      case "ArrowRight":
        e.preventDefault();
        if (row?.item.type === "folder" && !isOpen(row.item.id)) toggle(row.item.id, false, binder);
        else go(i + 1);
        return;
      case "ArrowLeft": {
        e.preventDefault();
        if (row?.item.type === "folder" && isOpen(row.item.id))
          return toggle(row.item.id, false, binder);
        if (row?.parentId) setCursorId(row.parentId);
        return;
      }
      case "Enter":
        e.preventDefault();
        if (row && row.item.type !== "folder") props.onSelect(row.item);
        else if (row) toggle(row.item.id, false, binder);
        return;
      case "F2":
        e.preventDefault();
        if (row && !readOnly) setRenamingId(row.item.id);
        return;
      case "Backspace":
      case "Delete":
        e.preventDefault();
        if (row && !readOnly) {
          props.onDelete(row.item.id);
        }
        return;
      case "Escape":
        setQuery("");
        setMenu(null);
        return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
      e.preventDefault();
      if (row && !readOnly) props.onDuplicate?.(row.item.id);
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
      e.preventDefault();
      if (!readOnly) create(CREATE_KINDS[0]); // Document — the common case
      return;
    }

    // Type-ahead: press "j" to land on Jonah. Every list in the OS does this.
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const now = Date.now();
      const t = typeahead.current;
      t.buffer = now - t.at > 900 ? e.key : t.buffer + e.key;
      t.at = now;
      const needle = t.buffer.toLowerCase();
      const from = t.buffer.length === 1 ? i + 1 : i;
      const order = [...rows.slice(from), ...rows.slice(0, Math.max(0, from))];
      const hit = order.find((r) => r.label.toLowerCase().startsWith(needle));
      if (hit) {
        e.preventDefault();
        setCursorId(hit.id);
      }
    }
  };

  // Real row focus gives WebKit a concrete tree item to announce. Never from a
  // name being typed: a new script opens after its row has gone
  // into rename mode, the cursor follows it, and focusing the row blurred the
  // field — which commits it — so New ▸ Script never kept its name field.
  useLayoutEffect(() => {
    if (!cursorId) return;
    const row = document.getElementById(`binderrow-${cursorId}`);
    if (!row) return;
    const active = document.activeElement;
    const naming =
      active instanceof HTMLInputElement && active.classList.contains("binder__rename");
    if (
      treeHadFocus.current &&
      !naming &&
      (treeRef.current?.contains(active) || active === document.body)
    ) {
      row.focus({ preventScroll: true });
    }
    row.scrollIntoView({ block: "nearest" });
  }, [cursorId, rows]);

  useEffect(() => {
    if (!menu) return;
    // A click in a menu is the menu's own: its rows choose and close it, and
    // the row that opens New's submenu must not close it.
    const close = (e: Event) => {
      if (e.type === "click" && (e.target as Element | null)?.closest?.(".menu")) return;
      setMenu(null);
    };
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  const allCollapsed = useMemo(() => {
    const all = folderIds(binder);
    return all.length > 0 && all.every((id) => collapsed.has(id));
  }, [binder, collapsed]);

  return (
    <nav className="binder" aria-label="Binder">
      <header className="binder__head">
        <span className="binder__project" title={playTitle}>
          {playTitle || "Play"}
        </span>
        <span className="binder__headactions">
          {readOnly && (
            <span className="binder__ro" title="newer schema">
              read-only
            </span>
          )}
          <button
            className="binder__iconbtn"
            title={allCollapsed ? "Expand all folders" : "Collapse all folders"}
            aria-label={allCollapsed ? "Expand all folders" : "Collapse all folders"}
            onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(folderIds(binder)))}
          >
            <CollapseAllIcon expanded={!allCollapsed} />
          </button>
        </span>
      </header>

      <div className="binder__filter">
        <SearchIcon />
        <input
          className="binder__filterinput"
          type="search"
          value={query}
          placeholder="Filter"
          aria-label="Filter the binder"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setQuery("");
              e.currentTarget.blur();
            }
          }}
        />
      </div>

      {(props.newlyFiled?.size ?? 0) > 0 && (
        <button
          className="binder__filed"
          onClick={props.onAcknowledgeFiled}
          title="These appeared in the folder and were filed for you. Click to clear."
        >
          {props.newlyFiled!.size} new {props.newlyFiled!.size === 1 ? "file" : "files"} filed
          <span className="binder__filedclear">✓</span>
        </button>
      )}

      {/* The scroller IS the root drop zone: everything below the last row is
          "put it at the top level", which is where a writer instinctively drags
          something they want out of a folder. */}
      <div
        ref={treeRef}
        className={`binder__scroll${drop?.targetId === null && drop.ok ? " is-rootdrop" : ""}`}
        tabIndex={rows.length === 0 ? 0 : -1}
        role="tree"
        aria-label="Binder items"
        onFocusCapture={(e) => {
          treeHadFocus.current = true;
          if (e.target === e.currentTarget) {
            const id = cursorInRows ? cursorId : rows[0]?.id;
            if (id) document.getElementById(`binderrow-${id}`)?.focus();
          }
        }}
        onBlurCapture={(e) => {
          if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node))
            treeHadFocus.current = false;
        }}
        onKeyDown={onKeyDown}
        onDragOver={(e) => {
          if (fromFinder(e, dragId, props)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            return;
          }
          if (!dragId) return;
          e.preventDefault();
          dragOver(null, "after");
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (fromFinder(e, dragId, props)) {
            props.onImportFiles?.([...e.dataTransfer.files], null);
            return;
          }
          commitDrop(null, "after");
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(null);
        }}
      >
        {rows.length === 0 ? (
          <p className="binder__empty">
            {query.trim() ? `Nothing matches “${query.trim()}”.` : "This play is empty."}
          </p>
        ) : (
          /* `presentation`, not its ARIA synonym `none`, here and on every
             row's <li>: WebKit keeps a tree a tree only while every element
             between it and its treeitems is a treeitem, a group or
             `presentation`, and it does not count `none`. With `none` the
             binder and every row in it read as unnamed "generic" to VoiceOver
             in the app, while Chromium read a tree (docs/app/preferences-and-help/accessibility.md#A11Y-16
             found it). */
          <ul className="binder__tree" role="presentation">
            {filtered.map((item) => (
              <BinderNode
                key={item.id}
                item={item}
                depth={0}
                parentId={null}
                tree={filtered}
                fullTree={binder}
                actions={props}
                cursorId={cursorId}
                setCursorId={setCursorId}
                renamingId={renamingId}
                setRenamingId={setRenamingId}
                namingNew={namingNew}
                isOpen={isOpen}
                toggle={toggle}
                dragId={dragId}
                setDragId={setDragId}
                drop={drop}
                dragOver={dragOver}
                commitDrop={commitDrop}
                clearDrag={clearDrag}
                spring={spring}
                openMenu={(id, x, y) => setMenu({ id, x, y })}
              />
            ))}
          </ul>
        )}
      </div>

      {!readOnly && (
        <footer className="binder__foot">
          <CreateMenu
            tutorial="binder-new"
            label="+ New"
            title="Add to the play"
            onPick={(kind) => create(kind)}
            place="up"
          />
          <span className="binder__foothint">
            {(() => {
              const t = createTarget();
              const p = t.parentId
                ? (() => {
                    const f = findItem(binder, t.parentId);
                    return f ? titleOf(f.item) : null;
                  })()
                : null;
              return p ? `in ${p}` : "at the top level";
            })()}
          </span>
        </footer>
      )}

      {menu && !readOnly && (
        <RowMenu
          x={menu.x}
          y={menu.y}
          item={findItem(binder, menu.id)?.item ?? null}
          actions={props}
          onClose={() => setMenu(null)}
          onRename={(id) => setRenamingId(id)}
          onMove={(id) => {
            setCursorId(id);
            document.getElementById(`binderrow-${id}`)?.focus({ preventScroll: true });
            setMovingId(id);
          }}
          onCreate={(kind) => create(kind)}
        />
      )}
      {movingId && !readOnly && (
        <BinderMoveSheet
          binder={binder}
          itemId={movingId}
          playTitle={playTitle}
          onClose={() => setMovingId(null)}
          onMove={(parentId, index) => {
            const source = findItem(binder, movingId);
            if (!source) return;
            if (parentId)
              setCollapsed((current) => {
                const next = new Set(current);
                for (const id of [...ancestorsOf(binder, parentId), parentId]) next.delete(id);
                return next;
              });
            setQuery("");
            setCursorId(movingId);
            setMovingId(null);
            if (source.parentId === parentId) props.onReorder(movingId, index);
            else props.onMove(movingId, parentId, index);
          }}
        />
      )}
    </nav>
  );
}

interface NodeProps {
  item: BinderItem;
  depth: number;
  parentId: string | null;
  tree: BinderItem[];
  fullTree: BinderItem[];
  actions: BinderProps;
  cursorId: string | null;
  setCursorId: (id: string) => void;
  renamingId: string | null;
  setRenamingId: (id: string | null) => void;
  namingNew: React.MutableRefObject<string | null>;
  isOpen: (id: string) => boolean;
  toggle: (id: string, deep: boolean, tree: BinderItem[]) => void;
  dragId: string | null;
  setDragId: (id: string | null) => void;
  drop: DropState | null;
  dragOver: (targetId: string | null, where: DropWhere) => void;
  commitDrop: (targetId: string | null, where: DropWhere) => void;
  clearDrag: () => void;
  spring: (id: string) => void;
  openMenu: (id: string, x: number, y: number) => void;
}

function BinderNode(p: NodeProps) {
  const { item, depth, actions } = p;
  const isFolder = item.type === "folder";
  const open = isFolder && p.isOpen(item.id);
  const selected = item.id === actions.activeId;
  const cursored = item.id === p.cursorId;
  const editing = p.renamingId === item.id;
  const isNew = actions.newlyFiled?.has(item.id) ?? false;
  const isMissing = actions.missingIds?.has(item.id) ?? false;
  const dropping = p.drop?.targetId === item.id ? p.drop : null;

  const [draft, setDraft] = useState(titleOf(item));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) return;
    setDraft(titleOf(item));
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    // Select the name, not the extension-free whole string — there is no
    // extension in the label, so this is simply "select all", but it is the
    // moment that makes rename feel like Finder's.
    el.select();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  // A freshly-created item that is named first opens straight into rename mode
  // (name-in-place). One with a page goes on to it when the name is done.
  useEffect(() => {
    const made = actions.justCreated;
    if (made?.id === item.id && made.name) {
      p.setRenamingId(item.id);
      p.namingNew.current = isFolder ? null : item.id;
      actions.onConsumeCreated();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions.justCreated, item.id]);

  function commitRename() {
    const next = draft.trim();
    if (next && next !== titleOf(item)) actions.onRename(item.id, next);
    p.setRenamingId(null);
  }

  const cls = [
    "binder__row",
    selected && "is-selected",
    cursored && !selected && "is-cursor",
    p.dragId === item.id && "is-dragging",
    isMissing && "is-missing",
    dropping?.ok && dropping.where === "before" && "is-dropbefore",
    dropping?.ok && dropping.where === "after" && "is-dropafter",
    dropping?.ok && dropping.where === "inside" && "is-dropinside",
    dropping && !dropping.ok && "is-nodrop",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li role="presentation">
      <div
        className={cls}
        data-row={item.id}
        id={`binderrow-${item.id}`}
        role="treeitem"
        tabIndex={cursored ? 0 : -1}
        onFocus={(e) => {
          if (e.target === e.currentTarget) p.setCursorId(item.id);
        }}
        aria-selected={selected}
        aria-expanded={isFolder ? open : undefined}
        aria-level={depth + 1}
        style={{ ["--pad" as string]: `${0.45 + depth * 0.85}rem` }}
        draggable={!actions.readOnly && !editing}
        onDragStart={(e) => {
          p.setDragId(item.id);
          e.dataTransfer.effectAllowed = "move";
          // The binder's own reorder reads `dragId` from component state; this
          // payload is for the PANES, which are outside this tree and need the
          // id on the event itself. Folders are excluded — there is nothing to
          // open — so dragging one still only ever means "re-file it".
          if (!isFolder) e.dataTransfer.setData(BINDER_MIME, item.id);
        }}
        onDragEnd={p.clearDrag}
        onDragOver={(e) => {
          if (fromFinder(e, p.dragId, actions)) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "copy";
            if (isFolder) p.dragOver(item.id, "inside");
            return;
          }
          if (!p.dragId) return;
          e.preventDefault();
          e.stopPropagation();
          const where = whereIn(e.currentTarget.getBoundingClientRect(), e.clientY, isFolder);
          e.dataTransfer.dropEffect = "move";
          p.dragOver(item.id, where);
          if (isFolder && where === "inside" && !open) p.spring(item.id);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (fromFinder(e, p.dragId, actions)) {
            p.clearDrag();
            // On a folder, into it; on a file, beside it, in its folder.
            actions.onImportFiles?.([...e.dataTransfer.files], isFolder ? item.id : p.parentId);
            return;
          }
          const where = whereIn(e.currentTarget.getBoundingClientRect(), e.clientY, isFolder);
          p.commitDrop(item.id, where);
        }}
        onClick={() => {
          if (editing) return;
          p.setCursorId(item.id);
          // A folder row SELECTS and opens; it never closes. Toggling on the
          // row meant that selecting a folder to put something in it hid what
          // was already inside — and the writer's next click, to see it again,
          // deselected nothing and reopened it, so the pair read as a flicker.
          // Closing is the chevron's job (and ←), where it is unambiguous.
          if (isFolder) {
            if (!open) p.toggle(item.id, false, p.fullTree);
          } else actions.onSelect(item);
        }}
        onDoubleClick={(e) => {
          if (actions.readOnly) return;
          e.stopPropagation();
          p.setRenamingId(item.id);
        }}
        onContextMenu={(e) => {
          if (actions.readOnly) return;
          e.preventDefault();
          e.stopPropagation();
          p.setCursorId(item.id);
          p.openMenu(item.id, e.clientX, e.clientY);
        }}
        title={item.path}
      >
        {/* A folder gets a chevron AND a folder icon; a leaf gets a spacer
            where the chevron would be, so every row's icon column aligns. */}
        {isFolder ? (
          <span
            className={`binder__twisty${open ? " is-open" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              p.toggle(item.id, e.altKey, p.fullTree);
            }}
          >
            <DisclosureIcon />
          </span>
        ) : (
          <span className="binder__twisty binder__twisty--leaf" />
        )}
        <span className="binder__icon">
          <BinderIcon kind={iconKindFor(item.type)} />
        </span>
        {editing ? (
          <input
            ref={inputRef}
            className="binder__rename"
            aria-label={`Rename ${titleOf(item)}`}
            value={draft}
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              // A character or script just made: its name is done, so the
              // cursor goes on to its page (docs/app/preferences-and-help/accessibility.md#A11Y-4). ⎋ keeps what was
              // typed here, as it does in any rename (the field's blur commits).
              const toPage = p.namingNew.current === item.id;
              if (e.key === "Enter" || e.key === "Escape") p.namingNew.current = null;
              if (toPage && (e.key === "Enter" || e.key === "Escape")) {
                commitRename();
                requestPageFocus(item.id);
              } else if (e.key === "Enter") commitRename();
              else if (e.key === "Escape") {
                // Back to the tree, on the same row: the input
                // going away used to leave focus on the body.
                const tree = e.currentTarget.closest<HTMLElement>('[role="tree"]');
                p.setRenamingId(null);
                tree?.focus();
              }
            }}
            onBlur={() => {
              // A click elsewhere leaves the cursor where the click put it.
              if (p.namingNew.current === item.id) p.namingNew.current = null;
              commitRename();
            }}
          />
        ) : (
          <span className="binder__label">{titleOf(item)}</span>
        )}
        {isNew && !editing && (
          <span className="binder__newdot" title="Appeared in the folder and was filed for you">
            ●
          </span>
        )}
        {isMissing && !editing && (
          <span
            className="binder__missing"
            title="In the binder, but not in the folder any more. Nothing has been deleted."
          >
            missing
          </span>
        )}
        {!actions.readOnly && !editing && (
          <span className="binder__rowactions">
            {/* Out of the Tab order: two stops per row made the binder a
                corridor of forty. The keyboard has F2 and ⇧F10 for these; a
                screen reader and Voice Control still reach them by name. */}
            <button
              tabIndex={-1}
              title="Rename"
              aria-label={`Rename “${titleOf(item)}”`}
              onClick={(e) => {
                e.stopPropagation();
                p.setRenamingId(item.id);
              }}
            >
              <PencilIcon />
            </button>
            <button
              tabIndex={-1}
              title="More…"
              aria-label={`Actions for “${titleOf(item)}”`}
              onClick={(e) => {
                e.stopPropagation();
                const r = e.currentTarget.getBoundingClientRect();
                p.openMenu(item.id, r.left, r.bottom);
              }}
            >
              <MoreIcon />
            </button>
          </span>
        )}
      </div>
      {/*
        Scenes, under the script they are in (docs/app/organizing/workspace-model.md#WORK-5). The board is already the
        scene navigator; this makes the rail one too, without a second list to
        keep in step — the rows are DERIVED from the same `cards` and
        `scenePages` the board reads, and they are display-only: a scene is not
        a file, so it cannot be dragged, renamed or trashed here.
       */}
      {item.type === "script" && selected && (actions.scenes?.length ?? 0) > 0 && (
        <ul role="group" aria-label={`Scenes in ${titleOf(item)}`}>
          {actions.scenes?.map((sc) => (
            /* `role="presentation"` like every other row's <li>: without it
               the list item sat between the group and its treeitem, and
               VoiceOver's tree lost these rows' level and position. */
            <li key={sc.id} role="presentation">
              <div
                className={`binder__row binder__row--scene${
                  sc.ordinal === actions.caretScene ? " is-selected" : ""
                }`}
                style={{ "--pad": `${8 + (depth + 1) * 16}px` } as React.CSSProperties}
                id={`binderrow-${sceneRowId(item.id, sc.id)}`}
                data-row={sceneRowId(item.id, sc.id)}
                role="treeitem"
                tabIndex={p.cursorId === sceneRowId(item.id, sc.id) ? 0 : -1}
                aria-level={depth + 2}
                aria-selected={sc.ordinal === actions.caretScene}
                onFocus={() => p.setCursorId(sceneRowId(item.id, sc.id))}
                onClick={() => {
                  p.setCursorId(sceneRowId(item.id, sc.id));
                  actions.onOpenScene?.(sc.ordinal);
                }}
              >
                <span className={`binder__huedot swatch--${sc.color}`} aria-hidden="true" />
                <span className="binder__label">{sc.label}</span>
                {sc.pages && <span className="binder__pages">{sc.pages}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {isFolder && open && (
        <ul role="group" aria-label={titleOf(item)}>
          {item.children?.length ? (
            item.children.map((child) => (
              <BinderNode {...p} key={child.id} item={child} depth={depth + 1} parentId={item.id} />
            ))
          ) : (
            <li
              role="presentation"
              className="binder__emptyfolder"
              style={{ paddingLeft: `${1.9 + depth * 0.85}rem` }}
              onDragOver={(e) => {
                const files = fromFinder(e, p.dragId, actions);
                if (!p.dragId && !files) return;
                e.preventDefault();
                e.stopPropagation();
                if (files) e.dataTransfer.dropEffect = "copy";
                p.dragOver(item.id, "inside");
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (fromFinder(e, p.dragId, actions)) {
                  p.clearDrag();
                  actions.onImportFiles?.([...e.dataTransfer.files], item.id);
                  return;
                }
                p.commitDrop(item.id, "inside");
              }}
            >
              Empty
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

/** The "+ New" pull-down. One menu anatomy — see ui/Menu.tsx. */
function CreateMenu({
  label,
  title,
  onPick,
  tutorial,
}: {
  label: string;
  title: string;
  onPick: (kind: (typeof CREATE_KINDS)[number]) => void;
  place?: "up" | "down";
  /** The guide's name for this button (docs/app/preferences-and-help/tutorials.md#TUT-D9). */
  tutorial?: string;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const menu = useMenu();
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="btn btn--small btn--borderless binder__add"
        data-tutorial={tutorial}
        title={title}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        onClick={(e) => {
          e.stopPropagation();
          menu.openFrom(ref.current);
        }}
      >
        <PlusIcon size={11} />
        {label.replace(/^\+\s*/, "")}
      </button>
      {menu.anchor && (
        <Menu
          anchor={menu.anchor}
          onClose={menu.close}
          width={190}
          label="New"
          entries={CREATE_KINDS.map((k) => ({
            id: `new:${k.label.toLowerCase()}`,
            label: k.label,
            /* The hint moves to a tooltip: a menu row that carries a sentence
               is a menu you read instead of scan. */
            onSelect: () => onPick(k),
          }))}
        />
      )}
    </>
  );
}

/**
 * The row menu's entries. The shortcuts it shows are the keys the binder's
 * own handler answers (`onKeyDown` above): F2 renames the row and ⏎ opens it,
 * so the menu says F2 beside Rename. It said ⏎, which opened the row instead.
 */
export function rowMenuEntries(
  item: BinderItem,
  actions: Pick<BinderProps, "onOpenInNewPane" | "onDuplicate" | "onReveal" | "onDelete">,
  on: { create: (kind: string) => void; rename: (id: string) => void; move: (id: string) => void },
): MenuEntry[] {
  const isFolder = item.type === "folder";
  const entries: MenuEntry[] = [];
  if (!isFolder && actions.onOpenInNewPane) {
    entries.push({
      label: "Open in New Pane",
      onSelect: () => actions.onOpenInNewPane?.(item),
    });
  }
  entries.push({
    label: "New",
    submenu: CREATE_KINDS.map((k) => ({
      label: k.label,
      onSelect: () => on.create(k.label),
    })),
  });
  entries.push({ kind: "sep" });
  entries.push({ label: "Rename", shortcut: "F2", onSelect: () => on.rename(item.id) });
  entries.push({ label: "Move…", onSelect: () => on.move(item.id) });
  if (actions.onDuplicate && !isFolder) {
    entries.push({
      label: "Duplicate",
      shortcut: "⌘D",
      onSelect: () => actions.onDuplicate?.(item.id),
    });
  }
  if (actions.onReveal) {
    entries.push({ label: "Reveal in Finder", onSelect: () => actions.onReveal?.(item.id) });
  }
  entries.push({ kind: "sep" });
  entries.push({
    label: "Move to Trash",
    shortcut: "⌘⌫",
    destructive: true,
    onSelect: () => actions.onDelete(item.id),
  });
  return entries;
}

/** The right-click menu for one row, on the same anatomy as every other. */
function RowMenu({
  x,
  y,
  item,
  actions,
  onClose,
  onRename,
  onMove,
  onCreate,
}: {
  x: number;
  y: number;
  item: BinderItem | null;
  actions: BinderProps;
  onClose: () => void;
  onRename: (id: string) => void;
  onMove: (id: string) => void;
  onCreate: (kind: (typeof CREATE_KINDS)[number]) => void;
}) {
  if (!item) return null;
  const entries = rowMenuEntries(item, actions, {
    create: (kind) => onCreate(CREATE_KINDS.find((k) => k.label === kind) ?? CREATE_KINDS[0]),
    rename: onRename,
    move: onMove,
  });

  /* No title header row: the menu opened AT the row, which already says which
     one it is — a header only pushes the first real item down. */
  return (
    <Menu
      anchor={{ kind: "point", x, y }}
      entries={entries}
      onClose={onClose}
      width={210}
      label={titleOf(item) || "Item"}
    />
  );
}

const ICON = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.3,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function SearchIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" {...ICON}>
      <circle cx="7.2" cy="7.2" r="3.9" />
      <path d="M10.1 10.1 13 13" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" {...ICON}>
      <circle cx="4" cy="8" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="12" cy="8" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CollapseAllIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" {...ICON}>
      {expanded ? (
        <>
          <path d="M5 6.4 8 3.4l3 3" />
          <path d="M5 9.6 8 12.6l3-3" />
        </>
      ) : (
        <>
          <path d="M5 3.6 8 6.6l3-3" />
          <path d="M5 12.4 8 9.4l3 3" />
        </>
      )}
    </svg>
  );
}
