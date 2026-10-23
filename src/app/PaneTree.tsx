// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The pane tree's renderer (model: panes.ts).
 *
 * Walks the tree and draws it: a split becomes a flex row/column with draggable
 * dividers between its children, a leaf becomes a body under a tab strip. All
 * layout decisions come from the model — this file owns pixels and pointers,
 * never structure, which is why every structural test lives against panes.ts
 * with nothing mounted.
 *
 * The strip is there whenever it has something to do: two or more tabs to
 * choose between, or a pane that is one of several and so can be closed, moved
 * and told apart. A play in one pane with one tab has no strip, because there a
 * strip is 30px spent restating the toolbar. It used to hang on the tab count
 * alone, so a pane made by Split, which has one tab, had no strip, and with it
 * no close box and no handle to drag: nothing in the window could close it.
 *
 * Drag has two sources that must not be confused with each other: a TAB being
 * rearranged, and a BINDER ROW being opened. Both are offered as typed
 * dataTransfer payloads and the drop zone reads whichever is present, so the
 * binder's own drag-to-reorder (which uses neither) keeps working untouched.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { CloseIcon, Menu, PlusIcon, useMenu } from "../ui";
import { BINDER_MIME } from "../workspace/binder-drag";

import {
  MIN_PANE_SHARE,
  leaves,
  paneNeed,
  surfaceKey,
  type Direction,
  type Leaf,
  type PaneNode,
  type Surface,
} from "./panes";

/** Where a drop lands: a new tab here, or a split in that direction. */
export type DropZone = "center" | "left" | "right" | "top" | "bottom";

export const TAB_MIME = "application/x-proscenium-tab";

export interface TabDrag {
  leafId: string;
  index: number;
}

export interface PaneTreeProps {
  node: PaneNode;
  /** The surface's content. Returning null renders an empty pane body. */
  renderSurface: (surface: Surface, leafId: string) => ReactNode;
  labelFor: (surface: Surface) => string;
  /** Surfaces offered by a pane's "+" menu, already filtered to what's open-able. */
  addable: (leafId: string) => { surface: Surface; label: string }[];
  activeLeafId: string | null;
  onFocusLeaf: (leafId: string) => void;
  onActivateTab: (leafId: string, index: number) => void;
  onCloseTab: (leafId: string, index: number) => void;
  /**
   * Close a whole pane, or everything on one side of a divider. `heirId` is
   * the sibling that takes its room.
   */
  onClosePane: (nodeId: string, heirId?: string) => void;
  /** The panes the window has no room for, by leaf id (panes.ts `panesWithoutRoom`). */
  hidden: ReadonlySet<string>;
  /** Child `index` of a split takes `fraction` of it, the difference coming from child `next`. */
  onResize: (
    splitId: string,
    index: number,
    fraction: number,
    next: number,
    least: { first: number; second: number },
  ) => void;
  onAddSurface: (leafId: string, surface: Surface) => void;
  /** A tab dropped on a pane. */
  onDropTab: (drag: TabDrag, leafId: string, zone: DropZone) => void;
  /** A binder item dropped on a pane. */
  onDropBinderItem: (itemId: string, leafId: string, zone: DropZone) => void;
}

/**
 * Which edge of the box the pointer is in, if any.
 *
 * The 26% band is wide enough to hit without aiming and still leaves a
 * comfortable centre; edges win over the centre so a deliberate drag to the
 * side always splits rather than sometimes stacking a tab.
 */
function zoneFor(rect: DOMRect, x: number, y: number): DropZone {
  const EDGE = 0.26;
  const fx = (x - rect.left) / rect.width;
  const fy = (y - rect.top) / rect.height;
  const dLeft = fx;
  const dRight = 1 - fx;
  const dTop = fy;
  const dBottom = 1 - fy;
  const min = Math.min(dLeft, dRight, dTop, dBottom);
  if (min > EDGE) return "center";
  if (min === dLeft) return "left";
  if (min === dRight) return "right";
  if (min === dTop) return "top";
  return "bottom";
}

function readDrag(e: React.DragEvent): { tab?: TabDrag; itemId?: string } {
  const tabRaw = e.dataTransfer.getData(TAB_MIME);
  if (tabRaw) {
    try {
      return { tab: JSON.parse(tabRaw) as TabDrag };
    } catch {
      /* fall through */
    }
  }
  const itemId = e.dataTransfer.getData(BINDER_MIME);
  return itemId ? { itemId } : {};
}

/** True when the drag carries something a pane can accept. */
function carriesPayload(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes(TAB_MIME) || e.dataTransfer.types.includes(BINDER_MIME);
}

export function PaneTree(props: PaneTreeProps) {
  return <PaneNodeView node={props.node} tree={props} />;
}

function PaneNodeView({ node, tree }: { node: PaneNode; tree: PaneTreeProps }) {
  if (node.type === "leaf") return <LeafView leaf={node} tree={tree} />;
  return <SplitView split={node} tree={tree} />;
}

/** How far along its split a pane is drawn, start to end, in CSS pixels. */
function along(el: Element, horizontal: boolean) {
  const r = el.getBoundingClientRect();
  return horizontal ? { start: r.left, size: r.width } : { start: r.top, size: r.height };
}

function SplitView({
  split,
  tree,
}: {
  split: Extract<PaneNode, { type: "split" }>;
  tree: PaneTreeProps;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const cells = useRef<Record<string, HTMLDivElement | null>>({});
  const horizontal = split.dir === "row";
  const axis = horizontal ? "width" : "height";

  /* The split's own length, for what a divider's limits are in shares. The
     drag measures for itself; this is for the keyboard and for the numbers a
     screen reader is given. */
  const [extent, setExtent] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setExtent(along(el, horizontal).size || null);
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [horizontal]);

  /* What each child needs, and which are drawn at all: a child with every pane
     under it left out for want of room takes no cell, and the divider beside
     it belongs to the two panes that are drawn either side. */
  const needs = split.children.map((c) => paneNeed(c, tree.hidden));
  const drawn = needs.map((n) => n !== null);
  const scale = split.sizes.reduce((sum, s, i) => (drawn[i] ? sum + s : sum), 0) || 1;
  const nextDrawn = (i: number) => drawn.indexOf(true, i + 1);
  const floor = (i: number) => needs[i]?.[axis] ?? 0;
  /** The least share child `i` can be left with: its floor, in the tree's units. */
  const least = (i: number, of: number | null = extent) =>
    of ? (floor(i) / of) * scale : MIN_PANE_SHARE;

  /* A drag that has gone past half a pane's floor: that pane is out of the
     layout while the pointer stays there, and closes when it lets go. */
  type Leaving = { index: number; heir: number; px: number };
  const [closing, setClosing] = useState<Leaving | null>(null);

  function startDrag(index: number, e: React.PointerEvent<HTMLDivElement>) {
    const container = ref.current;
    const next = nextDrawn(index);
    const first = cells.current[split.children[index].id];
    const second = next < 0 ? null : cells.current[split.children[next].id];
    if (!container || !first || !second) return;
    const divider = e.currentTarget;
    try {
      divider.setPointerCapture(e.pointerId);
    } catch {
      /* a pointer that is already up: the moves still arrive at the divider */
    }
    // The pair either side of THIS divider shares the space it divides. Read
    // once, as drawn: the drag is in pixels and hands the model shares.
    const total = along(container, horizontal).size;
    const a = along(first, horizontal);
    const pairPx = a.size + along(second, horizontal).size;
    const pairShare = split.sizes[index] + split.sizes[next];
    const grab = (horizontal ? e.clientX : e.clientY) - (a.start + a.size);
    const limits = { first: least(index, total), second: least(next, total) };
    // Held here as well as in state: the pointer can come up before the render
    // that state asked for, and what closes is what the last move decided.
    let gone: Leaving | null = null;

    const onMove = (ev: PointerEvent) => {
      const px = (horizontal ? ev.clientX : ev.clientY) - grab - a.start;
      // Past half its floor a pane gives way (the split view's own rule on a
      // Mac): it resists at the floor, then goes, and comes back if the
      // pointer does.
      const over = px < floor(index) / 2 ? index : pairPx - px < floor(next) / 2 ? next : -1;
      if (over !== (gone?.index ?? -1)) {
        gone =
          over < 0
            ? null
            : {
                index: over,
                heir: over === index ? next : index,
                // The box it has now, which it keeps while it is out of sight.
                px: along(over === index ? first : second, horizontal).size,
              };
        setClosing(gone);
      }
      if (!gone && pairPx > 0) {
        tree.onResize(split.id, index, (px / pairPx) * pairShare, next, limits);
      }
    };
    const done = (ev: PointerEvent) => {
      divider.removeEventListener("pointermove", onMove);
      divider.removeEventListener("pointerup", done);
      divider.removeEventListener("pointercancel", done);
      setClosing(null);
      if (gone && ev.type === "pointerup") {
        tree.onClosePane(split.children[gone.index].id, split.children[gone.heir].id);
      }
    };
    divider.addEventListener("pointermove", onMove);
    divider.addEventListener("pointerup", done);
    divider.addEventListener("pointercancel", done);
  }

  /* The keyboard's resize, in the same units the drag hands the model: the new
     size of the child BEFORE the divider. The model clamps; this only moves. */
  function nudge(index: number, e: React.KeyboardEvent<HTMLDivElement>) {
    const next = nextDrawn(index);
    if (next < 0) return;
    const back = horizontal ? "ArrowLeft" : "ArrowUp";
    const forward = horizontal ? "ArrowRight" : "ArrowDown";
    const pair = split.sizes[index] + split.sizes[next];
    const limits = { first: least(index), second: least(next) };
    const step = (e.shiftKey ? 0.1 : 0.02) * scale;
    let to: number | null = null;
    if (e.key === back) to = split.sizes[index] - step;
    else if (e.key === forward) to = split.sizes[index] + step;
    else if (e.key === "Home") to = limits.first;
    else if (e.key === "End") to = pair - limits.second;
    if (to === null) return;
    e.preventDefault();
    tree.onResize(split.id, index, to, next, limits);
  }

  /**
   * A divider's position for a screen reader: where it sits across the split
   * as drawn, in percent, and how far the two panes beside it let it travel.
   */
  function dividerValue(index: number, next: number) {
    const before = split.sizes.reduce((sum, s, i) => (i < index && drawn[i] ? sum + s : sum), 0);
    const pair = split.sizes[index] + split.sizes[next];
    const pct = (share: number) => Math.round((share / scale) * 100);
    const now = pct(before + split.sizes[index]);
    return {
      "aria-valuenow": now,
      "aria-valuemin": Math.min(now, pct(before + Math.min(least(index), pair / 2))),
      "aria-valuemax": Math.max(now, pct(before + Math.max(pair - least(next), pair / 2))),
    };
  }

  return (
    <div ref={ref} className={`panesplit panesplit--${split.dir}`}>
      {split.children.map((child, i) => {
        if (!drawn[i]) return null;
        const next = nextDrawn(i);
        const leaving = closing?.index === i;
        // A pane on its way out keeps the box it had, out of the flow and out
        // of sight, so nothing in it is laid out again for a pane that may yet
        // come back; the pane beside it is drawn over the room of both.
        const share =
          closing?.heir === i ? split.sizes[i] + split.sizes[closing.index] : split.sizes[i];
        const style: CSSProperties = leaving
          ? { [axis]: closing.px }
          : {
              flexBasis: `${(share / scale) * 100}%`,
              [horizontal ? "minWidth" : "minHeight"]: floor(i),
            };
        return (
          <div
            key={child.id}
            ref={(el) => {
              cells.current[child.id] = el;
            }}
            className={`panesplit__cell${leaving ? " is-leaving" : ""}`}
            style={style}
          >
            <PaneNodeView node={child} tree={tree} />
            {next >= 0 && (
              /* A splitter a keyboard can move: focus it and the arrows resize,
                 Shift takes bigger steps, Home and End go to the limits. It was
                 drag-only, so a writer without a pointer got whatever split
                 the last drag left (WCAG 2.5.7, 2.1.1). Dragged all the way
                 over a pane it closes that pane, which the pane's own close
                 box and View › Close Pane do without a drag. */
              <div
                className={`panedivider panedivider--${split.dir}`}
                role="separator"
                tabIndex={0}
                aria-orientation={horizontal ? "vertical" : "horizontal"}
                aria-label={
                  horizontal ? "Resize the panes side to side" : "Resize the panes top to bottom"
                }
                {...dividerValue(i, next)}
                title="Drag to resize. Drag all the way across a pane to close it."
                onPointerDown={(e) => startDrag(i, e)}
                onKeyDown={(e) => nudge(i, e)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function LeafView({ leaf, tree }: { leaf: Leaf; tree: PaneTreeProps }) {
  const [zone, setZone] = useState<DropZone | null>(null);
  const addRef = useRef<HTMLButtonElement | null>(null);
  const addMenu = useMenu();
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const active = leaf.tabs[leaf.active];
  const isFocused = tree.activeLeafId === leaf.id;
  // One of several panes, whether or not the window has room to draw the rest.
  const oneOfSeveral = tree.node.type === "split";

  /* Per-surface scroll memory. It used to hang off the single
     editor frame; with one scroller per pane it belongs here, keyed by surface
     so switching tabs and coming back lands where you left. Restoring in a
     LAYOUT effect keeps it pre-paint, so there is no visible jump. */
  const scrollMem = useRef<Record<string, number>>({});
  const activeKey = active ? surfaceKey(active) : "";
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = scrollMem.current[activeKey] ?? 0;
  }, [activeKey]);
  const rememberScroll = () => {
    const el = bodyRef.current;
    if (el) scrollMem.current[activeKey] = el.scrollTop;
  };

  function onDragOver(e: React.DragEvent) {
    if (!carriesPayload(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = bodyRef.current?.getBoundingClientRect();
    if (rect) setZone(zoneFor(rect, e.clientX, e.clientY));
  }

  function onDrop(e: React.DragEvent) {
    if (!carriesPayload(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = bodyRef.current?.getBoundingClientRect();
    const where = rect ? zoneFor(rect, e.clientX, e.clientY) : "center";
    setZone(null);
    const { tab, itemId } = readDrag(e);
    if (tab) tree.onDropTab(tab, leaf.id, where);
    else if (itemId) tree.onDropBinderItem(itemId, leaf.id, where);
  }

  const options = addMenu.open ? tree.addable(leaf.id) : [];

  return (
    <section
      className={`pane${isFocused ? " is-focused" : ""}`}
      onFocusCapture={() => tree.onFocusLeaf(leaf.id)}
      onMouseDownCapture={() => tree.onFocusLeaf(leaf.id)}
    >
      {(leaf.tabs.length > 1 || oneOfSeveral) && (
        <div className="pane__tabs">
          {/* A list of two buttons per tab, not a `tablist`. The strip was a
            tablist of tabs that each held their own close button — a control
            inside a control, which VoiceOver flattens into one unnamed thing,
            and a tablist that also held the "+" button, which it may not.
            Siblings keep both reachable by Tab, by VoiceOver and by Voice
            Control ("click Close Board"), and ⌫ on a tab closes it too. */}
          <ul className="pane__tablist" aria-label="Open in this pane">
            {leaf.tabs.map((surface, i) => (
              <li
                key={surfaceKey(surface)}
                className={`pane__tab${i === leaf.active ? " is-on" : ""}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData(TAB_MIME, JSON.stringify({ leafId: leaf.id, index: i }));
                }}
                onClick={() => tree.onActivateTab(leaf.id, i)}
                title={tree.labelFor(surface)}
              >
                <button
                  type="button"
                  className="pane__tabbtn"
                  aria-current={i === leaf.active ? "true" : undefined}
                  aria-keyshortcuts="Delete"
                  onKeyDown={(e) => {
                    if (e.key === "Delete" || e.key === "Backspace") {
                      e.preventDefault();
                      tree.onCloseTab(leaf.id, i);
                    }
                  }}
                >
                  <span className="pane__tablabel">{tree.labelFor(surface)}</span>
                </button>
                <button
                  type="button"
                  className="pane__tabclose"
                  aria-label={`Close ${tree.labelFor(surface)}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    tree.onCloseTab(leaf.id, i);
                  }}
                >
                  <CloseIcon size={9} />
                </button>
              </li>
            ))}
          </ul>
          <span className="pane__tabspacer" />
          <span className="pane__addwrap">
            <button
              ref={addRef}
              className="pane__add"
              title="Show another surface in this pane"
              aria-label="Add a surface to this pane"
              aria-haspopup="menu"
              aria-expanded={addMenu.open}
              onClick={() => addMenu.openFrom(addRef.current, "end")}
            >
              <PlusIcon size={11} />
            </button>
            {addMenu.anchor && options.length > 0 && (
              <Menu
                anchor={addMenu.anchor}
                onClose={addMenu.close}
                width={190}
                label="Show in this pane"
                entries={[
                  { kind: "section", label: "Show in this pane" },
                  ...options.map((o) => ({
                    label: o.label,
                    onSelect: () => tree.onAddSurface(leaf.id, o.surface),
                  })),
                ]}
              />
            )}
          </span>
        </div>
      )}

      <div
        ref={bodyRef}
        className="pane__body"
        onScroll={rememberScroll}
        onDragOver={onDragOver}
        onDragLeave={(e) => {
          // Only clear when the pointer actually left the body, not when it
          // crossed into a child — dragleave fires for both.
          if (!bodyRef.current?.contains(e.relatedTarget as Node | null)) setZone(null);
        }}
        onDrop={onDrop}
      >
        {active ? tree.renderSurface(active, leaf.id) : null}
        {zone && <div className={`pane__dropzone pane__dropzone--${zone}`} aria-hidden="true" />}
      </div>
    </section>
  );
}

/** Every leaf id, in render order — used to pick a focus target after a close. */
export function leafIds(node: PaneNode): string[] {
  return leaves(node).map((l) => l.id);
}

export type { Direction };
