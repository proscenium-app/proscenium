// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The pane tree's renderer (model: panes.ts).
 *
 * Walks the tree and draws it: a split becomes a flex row/column with draggable
 * dividers between its children, a leaf becomes a body under a tab strip that
 * exists only when there are two or more tabs to choose between (because
 * a one-tab strip is 30px spent restating the toolbar). All
 * layout decisions come from the model — this file owns pixels and pointers,
 * never structure, which is why every structural test lives against panes.ts
 * with nothing mounted.
 *
 * Drag has two sources that must not be confused with each other: a TAB being
 * rearranged, and a BINDER ROW being opened. Both are offered as typed
 * dataTransfer payloads and the drop zone reads whichever is present, so the
 * binder's own drag-to-reorder (which uses neither) keeps working untouched.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CloseIcon, Menu, PlusIcon, useMenu } from "../ui";

import {
  MIN_PANE_SHARE,
  leaves,
  surfaceKey,
  type Direction,
  type Leaf,
  type PaneNode,
  type Surface,
} from "./panes";

/** Where a drop lands: a new tab here, or a split in that direction. */
export type DropZone = "center" | "left" | "right" | "top" | "bottom";

export const TAB_MIME = "application/x-proscenium-tab";
export const BINDER_MIME = "application/x-proscenium-binder";

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
  onResize: (splitId: string, index: number, fraction: number) => void;
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

/**
 * A divider's position for a screen reader: where it sits across the whole
 * split, in percent, and how far the two panes beside it let it travel.
 */
function dividerValue(sizes: number[], index: number) {
  const before = sizes.slice(0, index).reduce((a, b) => a + b, 0);
  const pair = sizes[index] + sizes[index + 1];
  const pct = (f: number) => Math.round(f * 100);
  return {
    "aria-valuenow": pct(before + sizes[index]),
    "aria-valuemin": pct(before + MIN_PANE_SHARE),
    "aria-valuemax": pct(before + pair - MIN_PANE_SHARE),
  };
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

function SplitView({
  split,
  tree,
}: {
  split: Extract<PaneNode, { type: "split" }>;
  tree: PaneTreeProps;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  function startDrag(index: number, e: React.PointerEvent<HTMLDivElement>) {
    const container = ref.current;
    if (!container) return;
    const divider = e.currentTarget;
    divider.setPointerCapture(e.pointerId);
    const rect = container.getBoundingClientRect();
    const horizontal = split.dir === "row";
    // The pair either side of THIS divider shares the space it divides; the
    // fraction handed to the model is of the whole split, so the offset of the
    // preceding children has to come back out.
    const before = split.sizes.slice(0, index).reduce((a, b) => a + b, 0);

    const onMove = (ev: PointerEvent) => {
      const total = horizontal ? rect.width : rect.height;
      const pos = horizontal ? ev.clientX - rect.left : ev.clientY - rect.top;
      tree.onResize(split.id, index, pos / total - before);
    };
    const onUp = () => {
      divider.removeEventListener("pointermove", onMove);
      divider.removeEventListener("pointerup", onUp);
    };
    divider.addEventListener("pointermove", onMove);
    divider.addEventListener("pointerup", onUp);
  }

  /* The keyboard's resize, in the same units the drag hands the model: the new
     size of the child BEFORE the divider. The model clamps; this only moves. */
  function nudge(index: number, e: React.KeyboardEvent<HTMLDivElement>) {
    const back = split.dir === "row" ? "ArrowLeft" : "ArrowUp";
    const forward = split.dir === "row" ? "ArrowRight" : "ArrowDown";
    const pair = split.sizes[index] + split.sizes[index + 1];
    const step = e.shiftKey ? 0.1 : 0.02;
    let next: number | null = null;
    if (e.key === back) next = split.sizes[index] - step;
    else if (e.key === forward) next = split.sizes[index] + step;
    else if (e.key === "Home") next = MIN_PANE_SHARE;
    else if (e.key === "End") next = pair - MIN_PANE_SHARE;
    if (next === null) return;
    e.preventDefault();
    tree.onResize(split.id, index, next);
  }

  return (
    <div ref={ref} className={`panesplit panesplit--${split.dir}`}>
      {split.children.map((child, i) => (
        <div
          key={child.id}
          className="panesplit__cell"
          style={{ flexBasis: `${split.sizes[i] * 100}%` }}
        >
          <PaneNodeView node={child} tree={tree} />
          {i < split.children.length - 1 && (
            /* A splitter a keyboard can move: focus it and the arrows resize,
               Shift takes bigger steps, Home and End go to the limits. It was
               drag-only, so a writer without a pointer got whatever split
               the last drag left (WCAG 2.5.7, 2.1.1). */
            <div
              className={`panedivider panedivider--${split.dir}`}
              role="separator"
              tabIndex={0}
              aria-orientation={split.dir === "row" ? "vertical" : "horizontal"}
              aria-label={
                split.dir === "row"
                  ? "Resize the panes side to side"
                  : "Resize the panes top to bottom"
              }
              {...dividerValue(split.sizes, i)}
              title="Drag to resize"
              onPointerDown={(e) => startDrag(i, e)}
              onKeyDown={(e) => nudge(i, e)}
            />
          )}
        </div>
      ))}
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
      {leaf.tabs.length > 1 && (
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
