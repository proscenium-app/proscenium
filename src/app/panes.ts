// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The pane tree.
 *
 * v1 was a boolean: `{split, surface, ratio}`. The Script was always the
 * primary pane, exactly one other surface could sit beside it, materials opened
 * full-frame and the inspector was a fixed rail. This replaces that with a recursive
 * split tree of tab groups, so any surface can sit anywhere, in any arrangement.
 *
 * Pure and side-effect free — no React, no DOM, no storage. The renderer walks
 * what these functions return, which is what makes the tricky parts (a split
 * collapsing when its second child closes, a tab moving between groups without
 * losing focus) testable without mounting anything.
 *
 * Two invariants hold after EVERY operation, and `normalize` is what enforces
 * them rather than each operation remembering to:
 *
 *   1. A split has at least two children. A split with one child is that child.
 *      Without this, closing panes leaves a chain of single-child splits that
 *      still divide the width and still draw dividers.
 *   2. `sizes` has one entry per child and sums to 1.
 *
 * The one rule that is about the app rather than the tree: **the script may
 * appear only once.** There is a single mounted ProseMirror instance (App.tsx
 * keeps it alive across surfaces so board edits and the editor never diverge),
 * so a second script tab would either steal the DOM node or render blank.
 * `openSurface` focuses the existing script tab instead of adding another.
 */

export type Surface =
  | { kind: "script" }
  | { kind: "corkboard" }
  | { kind: "outliner" }
  | { kind: "cast" }
  | { kind: "changes" }
  | { kind: "comments" }
  /** A binder material, by binder item id. */
  | { kind: "material"; id: string };

export type Direction = "row" | "col";

export interface Leaf {
  type: "leaf";
  id: string;
  tabs: Surface[];
  /** Index into `tabs`. Clamped by `normalize`, never out of range. */
  active: number;
}

export interface Split {
  type: "split";
  id: string;
  dir: Direction;
  children: PaneNode[];
  /** Fractions, one per child, summing to 1. */
  sizes: number[];
}

export type PaneNode = Leaf | Split;

/** Surfaces that may only ever exist once in the tree. */
const SINGLETON: Surface["kind"][] = ["script"];

export function surfaceKey(s: Surface): string {
  return s.kind === "material" ? `material:${s.id}` : s.kind;
}

export function sameSurface(a: Surface, b: Surface): boolean {
  return surfaceKey(a) === surfaceKey(b);
}

let counter = 0;
/** Ids are tree-local and never persisted as identity — only for React keys
 *  and for naming a drop target. A counter keeps them stable across a session
 *  and, unlike a clock, keeps `normalize` deterministic in tests. */
export function paneId(prefix = "p"): string {
  counter += 1;
  return `${prefix}${counter}`;
}

/** Reset the id counter. Tests only — keeps expectations readable. */
export function __resetPaneIds(): void {
  counter = 0;
}

export function leaf(tabs: Surface[], active = 0, id?: string): Leaf {
  return { type: "leaf", id: id ?? paneId("leaf"), tabs, active };
}

export function split(dir: Direction, children: PaneNode[], sizes?: number[], id?: string): Split {
  return {
    type: "split",
    id: id ?? paneId("split"),
    dir,
    children,
    sizes: sizes ?? children.map(() => 1 / Math.max(1, children.length)),
  };
}

// --- traversal -------------------------------------------------------------

export function leaves(node: PaneNode): Leaf[] {
  return node.type === "leaf" ? [node] : node.children.flatMap(leaves);
}

export function findLeaf(node: PaneNode, id: string): Leaf | null {
  for (const l of leaves(node)) if (l.id === id) return l;
  return null;
}

/** The leaf holding `surface`, if any. */
export function leafWithSurface(node: PaneNode, surface: Surface): Leaf | null {
  for (const l of leaves(node)) {
    if (l.tabs.some((t) => sameSurface(t, surface))) return l;
  }
  return null;
}

export function allSurfaces(node: PaneNode): Surface[] {
  return leaves(node).flatMap((l) => l.tabs);
}

export function hasSurface(node: PaneNode, surface: Surface): boolean {
  return leafWithSurface(node, surface) !== null;
}

// --- normalization ---------------------------------------------------------

/**
 * Collapse degenerate structure and repair sizes. Every mutating function ends
 * with this, so no caller has to remember the rules.
 *
 * Returns null when the tree is empty (every tab closed) — the caller decides
 * what an empty workspace shows.
 */
export function normalize(node: PaneNode | null): PaneNode | null {
  if (!node) return null;

  if (node.type === "leaf") {
    if (node.tabs.length === 0) return null;
    const active = Math.min(Math.max(0, node.active), node.tabs.length - 1);
    return active === node.active ? node : { ...node, active };
  }

  const children = node.children
    .map((c) => normalize(c))
    .filter((c): c is PaneNode => c !== null);

  if (children.length === 0) return null;
  // A split of one is not a split. Collapsing here is what stops closed panes
  // from leaving invisible dividers behind.
  if (children.length === 1) return children[0];

  // Keep the surviving children's relative proportions rather than resetting
  // to equal — closing one pane should not reshuffle the others.
  const kept = node.children
    .map((c, i) => ({ c: normalize(c), size: node.sizes[i] ?? 0 }))
    .filter((x) => x.c !== null);
  const total = kept.reduce((sum, x) => sum + x.size, 0);
  const sizes =
    total > 0 ? kept.map((x) => x.size / total) : children.map(() => 1 / children.length);

  return { ...node, children, sizes };
}

// --- mutation --------------------------------------------------------------

/**
 * Rewrite every node, children first.
 *
 * Post-order is load-bearing, not stylistic. Applied top-down, `fn` would see
 * its OWN output: `splitLeaf` replaces leaf X with a split CONTAINING leaf X,
 * so descending into the result re-matches X and splits it again, forever.
 * Going bottom-up applies `fn` exactly once per node of the original tree.
 */
function mapTree(node: PaneNode, fn: (n: PaneNode) => PaneNode): PaneNode {
  if (node.type === "split") {
    return fn({ ...node, children: node.children.map((c) => mapTree(c, fn)) });
  }
  return fn(node);
}

/**
 * Open `surface` in the leaf `leafId` — focusing it if that leaf already has
 * it, otherwise appending a tab. A singleton surface already open ANYWHERE is
 * focused where it is instead of being opened again.
 */
export function openSurface(
  tree: PaneNode,
  leafId: string,
  surface: Surface,
): PaneNode {
  if (SINGLETON.includes(surface.kind)) {
    const existing = leafWithSurface(tree, surface);
    if (existing) return focusSurface(tree, surface);
  }
  const next = mapTree(tree, (n) => {
    if (n.type !== "leaf" || n.id !== leafId) return n;
    const at = n.tabs.findIndex((t) => sameSurface(t, surface));
    if (at >= 0) return { ...n, active: at };
    return { ...n, tabs: [...n.tabs, surface], active: n.tabs.length };
  });
  return normalize(next) ?? next;
}

/**
 * SWITCH what `leafId` is showing: replace its active tab's surface rather than
 * stacking another tab on it.
 *
 * This is what the toolbar's view switcher means, and it is deliberately NOT
 * `openSurface`. A segmented control that silently accumulated a tab per click
 * was the whole complaint: peeking at the board and coming back
 * left two tabs and a tab strip that had appeared on its own. Adding a tab is
 * now its own gesture — the "+" beside the switcher — so a second tab only
 * exists because someone asked for one.
 *
 * A surface already in THIS pane is focused instead of replacing anything, so
 * switching can never produce the same surface twice in one strip. Singletons
 * (the script) are still deduplicated tree-wide, exactly as `openSurface` does.
 */
export function showSurface(tree: PaneNode, leafId: string, surface: Surface): PaneNode {
  if (SINGLETON.includes(surface.kind) && hasSurface(tree, surface)) {
    return focusSurface(tree, surface);
  }
  const next = mapTree(tree, (n) => {
    if (n.type !== "leaf" || n.id !== leafId) return n;
    const at = n.tabs.findIndex((t) => sameSurface(t, surface));
    if (at >= 0) return { ...n, active: at };
    // An empty pane has nothing to replace; anything else swaps the tab the
    // pane is actually showing and leaves every other tab where it was.
    if (n.tabs.length === 0) return { ...n, tabs: [surface], active: 0 };
    return { ...n, tabs: n.tabs.map((t, i) => (i === n.active ? surface : t)) };
  });
  return normalize(next) ?? next;
}

/** Make `surface` the active tab wherever it already lives. */
export function focusSurface(tree: PaneNode, surface: Surface): PaneNode {
  const next = mapTree(tree, (n) => {
    if (n.type !== "leaf") return n;
    const at = n.tabs.findIndex((t) => sameSurface(t, surface));
    return at >= 0 ? { ...n, active: at } : n;
  });
  return normalize(next) ?? next;
}

/** Focus a tab by index within a leaf. */
export function activateTab(tree: PaneNode, leafId: string, index: number): PaneNode {
  const next = mapTree(tree, (n) =>
    n.type === "leaf" && n.id === leafId ? { ...n, active: index } : n,
  );
  return normalize(next) ?? next;
}

/**
 * Split `leafId` along `dir`, putting `surface` in the new half. `before`
 * places the new pane above/left of the existing one.
 */
export function splitLeaf(
  tree: PaneNode,
  leafId: string,
  dir: Direction,
  surface: Surface,
  before = false,
): PaneNode {
  // A singleton that already exists is MOVED into the new pane rather than
  // duplicated — dragging the script somewhere should relocate it, not fail.
  const withoutSingleton =
    SINGLETON.includes(surface.kind) && hasSurface(tree, surface)
      ? closeSurface(tree, surface)
      : tree;
  if (!withoutSingleton) return tree;

  const target = findLeaf(withoutSingleton, leafId);
  // The leaf may have vanished if it only held the singleton we just removed.
  const anchorId = target ? leafId : (leaves(withoutSingleton)[0]?.id ?? null);
  if (!anchorId) return leaf([surface]);

  const fresh = leaf([surface]);
  const next = mapTree(withoutSingleton, (n) => {
    if (n.type !== "leaf" || n.id !== anchorId) return n;
    const pair = before ? [fresh, n] : [n, fresh];
    return split(dir, pair, [0.5, 0.5]);
  });
  return normalize(next) ?? next;
}

/** Close one tab. Empties collapse: the leaf goes, then any split of one. */
export function closeTab(tree: PaneNode, leafId: string, index: number): PaneNode | null {
  const next = mapTree(tree, (n) => {
    if (n.type !== "leaf" || n.id !== leafId) return n;
    const tabs = n.tabs.filter((_, i) => i !== index);
    // Keep the neighbour to the left focused, the way editors do.
    const active = index <= n.active ? n.active - 1 : n.active;
    return { ...n, tabs, active: Math.max(0, active) };
  });
  return normalize(next);
}

/** Close a surface wherever it is. */
export function closeSurface(tree: PaneNode, surface: Surface): PaneNode | null {
  const next = mapTree(tree, (n) => {
    if (n.type !== "leaf") return n;
    const at = n.tabs.findIndex((t) => sameSurface(t, surface));
    if (at < 0) return n;
    const tabs = n.tabs.filter((_, i) => i !== at);
    const active = at <= n.active ? n.active - 1 : n.active;
    return { ...n, tabs, active: Math.max(0, active) };
  });
  return normalize(next);
}

/** Move a tab into another leaf (or to a new index within its own). */
export function moveTab(
  tree: PaneNode,
  from: { leafId: string; index: number },
  toLeafId: string,
  toIndex?: number,
): PaneNode {
  const source = findLeaf(tree, from.leafId);
  const surface = source?.tabs[from.index];
  if (!surface) return tree;

  if (from.leafId === toLeafId) {
    const next = mapTree(tree, (n) => {
      if (n.type !== "leaf" || n.id !== toLeafId) return n;
      const tabs = [...n.tabs];
      const [moved] = tabs.splice(from.index, 1);
      const at = Math.min(toIndex ?? tabs.length, tabs.length);
      tabs.splice(at, 0, moved);
      return { ...n, tabs, active: at };
    });
    return normalize(next) ?? next;
  }

  const next = mapTree(tree, (n) => {
    if (n.type !== "leaf") return n;
    if (n.id === from.leafId) {
      const tabs = n.tabs.filter((_, i) => i !== from.index);
      const active = from.index <= n.active ? n.active - 1 : n.active;
      return { ...n, tabs, active: Math.max(0, active) };
    }
    if (n.id === toLeafId) {
      const tabs = [...n.tabs];
      const at = Math.min(toIndex ?? tabs.length, tabs.length);
      tabs.splice(at, 0, surface);
      return { ...n, tabs, active: at };
    }
    return n;
  });
  return normalize(next) ?? next;
}

/** The smallest share of a split a pane can be resized down to. */
export const MIN_PANE_SHARE = 0.12;

/** Resize: set the fraction of child `index` in split `splitId`. */
export function setSize(
  tree: PaneNode,
  splitId: string,
  index: number,
  fraction: number,
): PaneNode {
  const MIN = MIN_PANE_SHARE;
  const next = mapTree(tree, (n) => {
    if (n.type !== "split" || n.id !== splitId) return n;
    if (index < 0 || index + 1 >= n.children.length) return n;
    // A divider redistributes between its two neighbours only, so dragging one
    // divider never shifts panes on the far side of the pane.
    const pairTotal = n.sizes[index] + n.sizes[index + 1];
    const first = Math.min(Math.max(fraction, MIN), pairTotal - MIN);
    const sizes = [...n.sizes];
    sizes[index] = first;
    sizes[index + 1] = pairTotal - first;
    return { ...n, sizes };
  });
  return normalize(next) ?? next;
}

// --- persistence -----------------------------------------------------------

/** The layout a play opens with the first time: the script, alone. */
export function defaultTree(): PaneNode {
  return leaf([{ kind: "script" }]);
}

const KINDS = new Set([
  "script",
  "corkboard",
  "outliner",
  "cast",
  "changes",
  "comments",
  "material",
]);

function reviveSurface(raw: unknown): Surface | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { kind?: unknown; id?: unknown };
  if (typeof r.kind !== "string" || !KINDS.has(r.kind)) return null;
  if (r.kind === "material") {
    return typeof r.id === "string" && r.id ? { kind: "material", id: r.id } : null;
  }
  return { kind: r.kind as Exclude<Surface["kind"], "material"> };
}

/**
 * Rebuild a tree from stored JSON, dropping anything malformed rather than
 * throwing — a layout is chrome, and a corrupt one must never be able to stop
 * a play from opening.
 */
export function reviveTree(raw: unknown): PaneNode | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  if (r.type === "leaf") {
    const tabs = Array.isArray(r.tabs)
      ? r.tabs.map(reviveSurface).filter((s): s is Surface => s !== null)
      : [];
    if (tabs.length === 0) return null;
    return leaf(tabs, typeof r.active === "number" ? r.active : 0);
  }

  if (r.type === "split") {
    const children = Array.isArray(r.children)
      ? r.children.map(reviveTree).filter((c): c is PaneNode => c !== null)
      : [];
    if (children.length === 0) return null;
    const sizes = Array.isArray(r.sizes) && r.sizes.every((n) => typeof n === "number")
      ? (r.sizes as number[])
      : undefined;
    const dir: Direction = r.dir === "col" ? "col" : "row";
    return normalize(split(dir, children, sizes?.slice(0, children.length)));
  }

  return null;
}

/**
 * Migrate the v1 `{split, surface, ratio}` layout, so a writer who had the
 * Script-plus-Outline split set up opens to exactly that arrangement rather
 * than to a bare script.
 */
export function fromLegacyLayout(raw: unknown): PaneNode | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { split?: unknown; surface?: unknown; ratio?: unknown };
  if (typeof r.split !== "boolean") return null;
  const script = leaf([{ kind: "script" }]);
  if (!r.split) return script;
  const kind = typeof r.surface === "string" && KINDS.has(r.surface) ? r.surface : "outliner";
  const ratio = typeof r.ratio === "number" && r.ratio > 0 && r.ratio < 1 ? r.ratio : 0.6;
  return split("row", [script, leaf([{ kind } as Surface])], [ratio, 1 - ratio]);
}

/**
 * Drop tabs for materials that no longer exist (deleted, or a vault whose
 * binder changed under a stored layout). Keeps a stale id from rendering an
 * empty pane the writer cannot get rid of.
 */
export function pruneMissingMaterials(tree: PaneNode, liveIds: Set<string>): PaneNode | null {
  const next = mapTree(tree, (n) => {
    if (n.type !== "leaf") return n;
    const tabs = n.tabs.filter((t) => t.kind !== "material" || liveIds.has(t.id));
    return tabs.length === n.tabs.length ? n : { ...n, tabs, active: Math.min(n.active, tabs.length - 1) };
  });
  return normalize(next);
}
