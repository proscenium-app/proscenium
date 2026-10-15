// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pane-tree state: load per play, persist on change, and expose the operations
 * App.tsx and PaneTree need.
 *
 * The model in panes.ts is pure; this is the thin stateful shell around it.
 * Persistence lives in an effect and never inside a state updater — StrictMode
 * replays updaters, and a write from inside one would fire twice per change and
 * could commit a value that was never rendered. The skip flag stops the
 * post-load commit from writing the pre-load default over the stored layout —
 * the same trap the v1 layout hit.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  activateTab,
  closeNode,
  closeSurface,
  closeTab,
  defaultTree,
  findNode,
  focusSurface,
  fromLegacyLayout,
  leafWithSurface,
  leaves,
  moveTab,
  normalize,
  openSurface,
  pruneMissingMaterials,
  reviveTree,
  setSize,
  showSurface,
  splitLeaf,
  surfaceKey,
  type Direction,
  type PaneNode,
  type Surface,
} from "./panes";
import type { DropZone, TabDrag } from "./PaneTree";

const KEY = (root: string) => `proscenium:panes:v2:${root}`;
/** The v1 `{split, surface, ratio}` key, read once and migrated. */
const LEGACY_KEY = (root: string) => `proscenium:panes:${root}`;

function load(root: string | null): PaneNode {
  if (!root) return defaultTree();
  try {
    const raw = localStorage.getItem(KEY(root));
    if (raw) {
      const revived = reviveTree(JSON.parse(raw));
      if (revived) return revived;
    }
    const legacy = localStorage.getItem(LEGACY_KEY(root));
    if (legacy) {
      const migrated = fromLegacyLayout(JSON.parse(legacy));
      if (migrated) return migrated;
    }
  } catch {
    /* chrome preference only — a bad layout must never block opening a play */
  }
  return defaultTree();
}

/** A drop zone becomes either a new tab (center) or a split in that direction. */
function zoneToSplit(zone: DropZone): { dir: Direction; before: boolean } | null {
  switch (zone) {
    case "left":
      return { dir: "row", before: true };
    case "right":
      return { dir: "row", before: false };
    case "top":
      return { dir: "col", before: true };
    case "bottom":
      return { dir: "col", before: false };
    default:
      return null;
  }
}

/**
 * A surface asked for where it already is takes the focus to its pane: the
 * script lives in one pane only, so "show me the script" from another pane
 * changed nothing the writer could see. It is also the way back to a pane the
 * window has no room for, since the focused pane is the one that is kept
 * (panes.ts `panesWithoutRoom`).
 */
const paneOf = (surface: Surface) => (settled: PaneNode) =>
  leafWithSurface(settled, surface)?.id ?? null;
const isSingleton = (surface: Surface) => surface.kind === "script";

export function usePanes(root: string | null) {
  const [tree, setTree] = useState<PaneNode>(() => load(null));
  const [focusedLeaf, setFocusedLeaf] = useState<string | null>(null);
  const skipPersist = useRef(true);

  useEffect(() => {
    skipPersist.current = true;
    const next = load(root);
    setTree(next);
    setFocusedLeaf(leaves(next)[0]?.id ?? null);
  }, [root]);

  useEffect(() => {
    if (skipPersist.current) {
      skipPersist.current = false;
      return;
    }
    if (!root) return;
    try {
      localStorage.setItem(KEY(root), JSON.stringify(tree));
    } catch {
      /* chrome preference only */
    }
  }, [tree, root]);

  /**
   * Apply a model op, keeping focus on a leaf that still exists. `focusOn`
   * names the leaf an op is about, by the tree it left: that pane takes the
   * focus when it is there.
   */
  const apply = useCallback(
    (fn: (t: PaneNode) => PaneNode | null, focusOn?: (settled: PaneNode) => string | null) => {
      setTree((prev) => {
        const next = fn(prev);
        // The last tab closing would leave nothing to render or drop onto, so
        // the tree floors at an empty pane rather than at null.
        const settled = normalize(next) ?? defaultTree();
        setFocusedLeaf((cur) => {
          const ids = leaves(settled).map((l) => l.id);
          const wanted = focusOn?.(settled);
          if (wanted && ids.includes(wanted)) return wanted;
          return cur && ids.includes(cur) ? cur : (ids[0] ?? null);
        });
        return settled;
      });
    },
    [],
  );

  const targetLeaf = useCallback(
    (t: PaneNode) => focusedLeaf ?? leaves(t)[0]?.id ?? null,
    [focusedLeaf],
  );

  /**
   * Whether the window has room for a tree with one more pane in it, and what
   * to say when it has not. The shell that measures the panes sets both
   * (use-workspace-panes.ts); until it has, every pane is allowed.
   */
  const room = useRef<{ fits: (next: PaneNode) => boolean; refuse: () => void }>({
    fits: () => true,
    refuse: () => {},
  });
  const treeRef = useRef(tree);
  treeRef.current = tree;
  /**
   * An op that adds a pane, refused when the result would not all be drawn.
   * Without this a split in a small window made a pane and hid it, or hid
   * another to show it, and the button read as broken. Decided on the tree as
   * rendered and outside the updater, which StrictMode replays.
   */
  const applyAdding = useCallback(
    (fn: (t: PaneNode) => PaneNode | null, focusOn?: (settled: PaneNode) => string | null) => {
      const before = treeRef.current;
      const after = normalize(fn(before));
      if (after && leaves(after).length > leaves(before).length && !room.current.fits(after)) {
        room.current.refuse();
        return;
      }
      apply(fn, focusOn);
    },
    [apply],
  );

  const open = useCallback(
    (surface: Surface) =>
      apply(
        (t) => {
          const id = targetLeaf(t);
          return id ? openSurface(t, id, surface) : t;
        },
        isSingleton(surface) ? paneOf(surface) : undefined,
      ),
    [apply, targetLeaf],
  );

  /** Switch the focused pane to a surface — the toolbar's view switcher. */
  const show = useCallback(
    (surface: Surface) =>
      apply(
        (t) => {
          const id = targetLeaf(t);
          return id ? showSurface(t, id, surface) : t;
        },
        isSingleton(surface) ? paneOf(surface) : undefined,
      ),
    [apply, targetLeaf],
  );

  const openInLeaf = useCallback(
    (leafId: string, surface: Surface) => apply((t) => openSurface(t, leafId, surface)),
    [apply],
  );

  const focus = useCallback(
    (surface: Surface) => apply((t) => focusSurface(t, surface), paneOf(surface)),
    [apply],
  );

  const activate = useCallback(
    (leafId: string, index: number) => apply((t) => activateTab(t, leafId, index)),
    [apply],
  );

  const close = useCallback(
    (leafId: string, index: number) => apply((t) => closeTab(t, leafId, index)),
    [apply],
  );

  /**
   * Close a whole pane, or everything under a split. The focus goes to the
   * pane that took its room when the pane that had it is gone.
   */
  const closePane = useCallback(
    (nodeId: string, heirId?: string) =>
      apply(
        (t) => closeNode(t, nodeId, heirId),
        (settled) => {
          if (focusedLeaf && leaves(settled).some((l) => l.id === focusedLeaf)) return focusedLeaf;
          const heir = heirId ? findNode(settled, heirId) : null;
          return heir ? (leaves(heir)[0]?.id ?? null) : null;
        },
      ),
    [apply, focusedLeaf],
  );

  const resize = useCallback(
    (
      splitId: string,
      index: number,
      fraction: number,
      next?: number,
      least?: { first: number; second: number },
    ) => apply((t) => setSize(t, splitId, index, fraction, next, least)),
    [apply],
  );

  const splitWith = useCallback(
    (leafId: string, dir: Direction, surface: Surface, before = false) =>
      applyAdding((t) => splitLeaf(t, leafId, dir, surface, before)),
    [applyAdding],
  );

  /** A tab dragged onto a pane: stacked in the centre, or split at an edge. */
  const dropTab = useCallback(
    (drag: TabDrag, leafId: string, zone: DropZone) =>
      applyAdding((t) => {
        const asSplit = zoneToSplit(zone);
        if (!asSplit) return moveTab(t, drag, leafId);
        const source = leaves(t).find((l) => l.id === drag.leafId);
        const surface = source?.tabs[drag.index];
        if (!surface) return t;
        // Remove first, then split — otherwise the surface exists twice for an
        // instant and a singleton (the script) would be deduplicated wrongly.
        const without = closeTab(t, drag.leafId, drag.index);
        if (!without) return splitLeaf(t, leafId, asSplit.dir, surface, asSplit.before);
        const anchor = leaves(without).some((l) => l.id === leafId)
          ? leafId
          : (leaves(without)[0]?.id ?? leafId);
        return splitLeaf(without, anchor, asSplit.dir, surface, asSplit.before);
      }),
    [applyAdding],
  );

  /** A binder row dragged onto a pane. */
  const dropSurface = useCallback(
    (surface: Surface, leafId: string, zone: DropZone) =>
      applyAdding((t) => {
        const asSplit = zoneToSplit(zone);
        return asSplit
          ? splitLeaf(t, leafId, asSplit.dir, surface, asSplit.before)
          : openSurface(t, leafId, surface);
      }),
    [applyAdding],
  );

  /** Close a surface wherever it lives (the titlebar's rail toggles). */
  const dismiss = useCallback(
    (surface: Surface) => apply((t) => closeSurface(t, surface)),
    [apply],
  );

  /**
   * Put a surface in a NEW pane next to the focused one — what a toggle in the
   * titlebar means by "show me this": beside the work, not on top of it.
   * Already-open surfaces are focused rather than split out again.
   */
  const openBeside = useCallback(
    (surface: Surface, dir: Direction) => {
      const isOpen = (t: PaneNode) =>
        leaves(t).some((l) => l.tabs.some((s) => surfaceKey(s) === surfaceKey(surface)));
      applyAdding(
        (t) => {
          if (isOpen(t)) return focusSurface(t, surface);
          const id = targetLeaf(t);
          return id ? splitLeaf(t, id, dir, surface) : t;
        },
        // A pane made here leaves the focus where it was; one already open is
        // gone to, as above.
        isOpen(treeRef.current) ? paneOf(surface) : undefined,
      );
    },
    [applyAdding, targetLeaf],
  );

  /** Drop tabs whose material is gone from the binder. */
  const prune = useCallback(
    (liveIds: Set<string>) => apply((t) => pruneMissingMaterials(t, liveIds)),
    [apply],
  );

  return {
    tree,
    focusedLeaf,
    setFocusedLeaf,
    open,
    openInLeaf,
    show,
    openBeside,
    focus,
    activate,
    close,
    closePane,
    closeSurface: dismiss,
    resize,
    splitWith,
    dropTab,
    dropSurface,
    prune,
    room,
  };
}
