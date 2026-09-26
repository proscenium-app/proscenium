// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { titleOf, type BinderItem } from "../workspace";
import type { Workspace } from "./useWorkspace";
import { usePanes } from "./use-panes";
import { findLeaf, leaves, surfaceKey, type Surface } from "./panes";
import type { DropZone } from "./PaneTree";
import type { ViewId } from "./Toolbar";

/** The label a tab carries. Materials resolve against the binder. */
function labelForSurface(surface: Surface, binder: BinderItem[], scriptTitle: string): string {
  switch (surface.kind) {
    case "script":
      return scriptTitle || "Script";
    case "corkboard":
      return "Board";
    case "outliner":
      return "Outline";
    case "cast":
      return "Cast";
    case "changes":
      return "Changes";
    case "comments":
      return "Comments";
    case "material": {
      const item = findBinderItem(binder, surface.id);
      return item ? titleOf(item) : "Sheet";
    }
  }
}

export function findBinderItem(items: BinderItem[], id: string): BinderItem | null {
  for (const it of items) {
    if (it.id === id) return it;
    const inner = it.children ? findBinderItem(it.children, id) : null;
    if (inner) return inner;
  }
  return null;
}

/** Every binder id that can be opened as a material tab. */
function materialIds(items: BinderItem[], into: Set<string> = new Set()): Set<string> {
  for (const it of items) {
    if (it.type === "folder") materialIds(it.children ?? [], into);
    else if (it.type !== "script") into.add(it.id);
  }
  return into;
}

/** The surfaces the "+" menu offers, minus what the pane already shows. */
const ADDABLE: { surface: Surface; label: string }[] = [
  { surface: { kind: "script" }, label: "Script" },
  { surface: { kind: "corkboard" }, label: "Board" },
  { surface: { kind: "outliner" }, label: "Outline" },
  { surface: { kind: "cast" }, label: "Cast" },
  { surface: { kind: "changes" }, label: "Changes" },
  { surface: { kind: "comments" }, label: "Comments" },
];

/** Pane routing sees document identities and actions, never session internals. */
export function useWorkspacePanes({
  root,
  binder,
  scriptTitle,
  openMaterials,
  selectItem,
  view,
  setView,
  closeMaterial,
}: Pick<
  Workspace,
  "root" | "binder" | "scriptTitle" | "openMaterials" | "selectItem" | "view" | "setView" | "closeMaterial"
>) {
  // The pane tree, loaded per play and persisted on change (use-panes.ts).
  const panes = usePanes(root);
  const { tree: paneTree, prune: prunePanes } = panes;

  // A material tab whose file left the binder would render a pane the writer
  // could not get rid of, so stale ids are dropped whenever the binder moves —
  // but only against the play's OWN binder. A play's folder opens several awaits
  // before its binder arrives, and the tree saved for it loads at once, so the
  // prune ran against the empty binder in between: every sheet tab was dropped,
  // and saved that way, each time a play opened. The page a writer had open when
  // the app closed came back as the script, not as that page.
  const liveMaterialIds = useMemo(() => materialIds(binder), [binder]);
  const binderAtOpen = useRef<{ root: string | null; binder: BinderItem[] }>({ root, binder });
  useEffect(() => {
    if (binderAtOpen.current.root !== root) {
      binderAtOpen.current = { root, binder };
      return;
    }
    if (binder === binderAtOpen.current.binder) return;
    prunePanes(liveMaterialIds);
  }, [root, binder, liveMaterialIds, prunePanes]);

  /**
   * Load the buffer for any material tab that is ACTIVE in its pane.
   *
   * The pane tree is restored from disk on open, so a sheet can be the active
   * tab of a pane before anything has asked the workspace to read it — and
   * `onActivateTab`, which is what normally loads one, never fires because
   * nothing was activated. The pane rendered empty and stayed empty until the
   * writer clicked the tab it was already on.
   */
  useEffect(() => {
    for (const leaf of leaves(paneTree)) {
      const surface = leaf.tabs[leaf.active];
      if (surface?.kind !== "material" || openMaterials[surface.id]) continue;
      const item = findBinderItem(binder, surface.id);
      if (item) selectItem(item);
    }
  }, [
    paneTree,
    binder,
    openMaterials,
    root,
    binder,
    openMaterials,
    selectItem,
    view,
    setView,
    closeMaterial,
  ]);

  /**
   * Opening a material routes through the workspace, which keeps one buffer
   * per sheet (`matsRef`, keyed by binder id) with a dirty flag and a conflict
   * gate for each (docs/app/keeping-work/storage-and-file-format.md#STOR-D9). A pane can host a sheet beside the script, and
   * two sheets can be live at once — one per tab. Focusing a
   * material tab is what loads it. Keying that buffer by binder id is the
   * follow-up, and it is not a change to make in the same pass as the layout.
   */
  const openMaterialTab = useCallback(
    (item: BinderItem) => {
      selectItem(item);
      panes.open({ kind: "material", id: item.id });
    },
    [root, binder, openMaterials, selectItem, view, setView, closeMaterial, panes],
  );

  // --- the single mounted editor, and the pane it currently lives in --------
  const editorParkRef = useRef<HTMLDivElement | null>(null);
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const scriptSlotRef = useRef<HTMLDivElement | null>(null);
  /**
   * The script pane's VISIBLE box — the scroller, not the slot.
   *
   * Zoom solves a fit against `clientWidth`/`clientHeight` and watches the
   * element for resizes. The slot is as tall as the whole script, so measuring
   * it would make fit-page silently degrade to fit-width and would re-solve on
   * every keystroke, since typing changes the document's height.
   */
  const scriptScrollerRef = useRef<HTMLElement | null>(null);
  const setScriptSlot = useCallback((el: HTMLDivElement | null) => {
    scriptSlotRef.current = el;
    scriptScrollerRef.current = el?.closest(".pane__body") ?? null;
  }, []);
  /** Every pane, for the sheet a fit solves against when none shows the script. */
  const paneRootRef = useRef<HTMLElement | null>(null);

  /** The surface showing in each pane right now (the active tab of each leaf). */
  const visibleSurfaces = useMemo(
    () =>
      leaves(paneTree)
        .map((l) => l.tabs[l.active])
        .filter(Boolean),
    [paneTree],
  );
  const scriptVisible = visibleSurfaces.some((s) => s.kind === "script");

  // Re-parent the mounted editor into the Script pane (or park it when no pane
  // is showing the script). Runs after every render: the slot element is
  // recreated whenever the tree reshapes, so a stale parent is the norm, not
  // the exception. `appendChild` MOVES the node — ProseMirror's own element is
  // never destroyed, so selection, history and scroll all survive a split.
  useLayoutEffect(() => {
    const host = editorHostRef.current;
    if (!host) return;
    const target = scriptVisible ? scriptSlotRef.current : editorParkRef.current;
    if (target && host.parentElement !== target) target.appendChild(host);
  });

  // Hand the editor back to the node React thinks owns it, or unmounting the
  // app would try to remove it from a parent it no longer has.
  useEffect(() => {
    return () => {
      const host = editorHostRef.current;
      const park = editorParkRef.current;
      if (host && park && host.parentElement !== park) park.appendChild(host);
    };
  }, []);

  const labelFor = useCallback((surface: Surface) => labelForSurface(surface, binder, scriptTitle), [binder, scriptTitle]);

  /** The toolbar "+": everything the focused pane is not already holding. */
  const toolbarAddable = useMemo(() => {
    const id = panes.focusedLeaf ?? leaves(paneTree)[0]?.id ?? null;
    const here = new Set((id ? (findLeaf(paneTree, id)?.tabs ?? []) : []).map(surfaceKey));
    return ADDABLE.filter((o) => !here.has(surfaceKey(o.surface)));
  }, [paneTree, panes.focusedLeaf]);

  /** The "+" menu: everything not already in this pane. */
  const addableFor = useCallback(
    (leafId: string) => {
      const here = new Set((findLeaf(paneTree, leafId)?.tabs ?? []).map((t) => surfaceKey(t)));
      return ADDABLE.filter((o) => !here.has(surfaceKey(o.surface)));
    },
    [paneTree],
  );

  /**
   * Activating a tab also tells the workspace what is on screen: `view`
   * still drives find, "reveal this scene in the script", and the Cast
   * shortcut's active state, so the two must not drift.
   */
  const onActivateTab = useCallback(
    (leafId: string, index: number) => {
      const surface = findLeaf(paneTree, leafId)?.tabs[index];
      panes.activate(leafId, index);
      if (!surface) return;
      if (surface.kind === "material") {
        const item = findBinderItem(binder, surface.id);
        if (item && !openMaterials[item.id]) selectItem(item);
      } else if (surface.kind !== "comments") {
        // The comment feed sits BESIDE the script rather than instead of it,
        // so it does not change what `view` says is on screen.
        setView(surface.kind === "script" ? "editor" : surface.kind);
      }
    },
    [paneTree, panes, root, binder, openMaterials, selectItem, view, setView, closeMaterial],
  );

  /**
   * Which segment of the view switcher reads as on: what the FOCUSED pane is
   * showing, or null when it is showing something outside the set (a sheet,
   * the comment feed) — in which case no segment is on, rather than a stale one.
   */
  const switcherView = useMemo<ViewId | null>(() => {
    const leaf = panes.focusedLeaf ? findLeaf(paneTree, panes.focusedLeaf) : null;
    const kind = leaf?.tabs[leaf.active]?.kind;
    if (kind === "script" || kind === "corkboard" || kind === "outliner") return kind;
    if (kind === "cast" || kind === "changes") return kind;
    return null;
  }, [paneTree, panes.focusedLeaf]);

  /**
   * Closing a tab. A material's buffer belongs to its tab, so this is where it
   * is released — but only when the LAST tab showing that sheet goes: the same
   * sheet can be open in two panes, and freeing the buffer while the other pane
   * still renders it would blank that pane and drop the hash its next save
   * depends on.
   */
  const onCloseTab = useCallback(
    (leafId: string, index: number) => {
      const surface = findLeaf(paneTree, leafId)?.tabs[index];
      panes.close(leafId, index);
      if (surface?.kind !== "material") return;
      const stillOpen = leaves(paneTree).some((l) =>
        l.tabs.some(
          (t, i) =>
            t.kind === "material" && t.id === surface.id && !(l.id === leafId && i === index),
        ),
      );
      if (!stillOpen) closeMaterial(surface.id);
    },
    [paneTree, panes, root, binder, openMaterials, selectItem, view, setView, closeMaterial],
  );

  /** Clicking a binder row opens it in the focused pane. */
  const onSelectBinderItem = useCallback(
    (item: BinderItem) => {
      if (item.type === "script") {
        selectItem(item);
        panes.open({ kind: "script" });
        return;
      }
      openMaterialTab(item);
    },
    [root, binder, openMaterials, selectItem, view, setView, closeMaterial, panes, openMaterialTab],
  );

  /** A binder row dropped on a pane opens there. */
  const onDropBinderItem = useCallback(
    (itemId: string, leafId: string, zone: DropZone) => {
      const item = findBinderItem(binder, itemId);
      if (!item || item.type === "folder") return;
      if (item.type === "script") {
        selectItem(item);
        panes.dropSurface({ kind: "script" }, leafId, zone);
        return;
      }
      selectItem(item);
      panes.dropSurface({ kind: "material", id: item.id }, leafId, zone);
    },
    [root, binder, openMaterials, selectItem, view, setView, closeMaterial, panes],
  );

  /**
   * Split the focused pane, seeding the new half with the first surface it is
   * not already showing — splitting into an empty pane would give the writer a
   * divider and nothing to look at.
   */
  const splitFocused = useCallback(
    (dir: "row" | "col") => {
      const id = panes.focusedLeaf ?? leaves(paneTree)[0]?.id;
      if (!id) return;
      const shown = new Set(visibleSurfaces.map(surfaceKey));
      const pick = ADDABLE.find((o) => !shown.has(surfaceKey(o.surface))) ?? ADDABLE[1];
      panes.splitWith(id, dir, pick.surface);
    },
    [panes, paneTree, visibleSurfaces],
  );

  return {
    panes,
    paneTree,
    openMaterialTab,
    editorParkRef,
    editorHostRef,
    scriptScrollerRef,
    setScriptSlot,
    paneRootRef,
    scriptVisible,
    visibleSurfaces,
    labelFor,
    toolbarAddable,
    addableFor,
    onActivateTab,
    switcherView,
    onCloseTab,
    onSelectBinderItem,
    onDropBinderItem,
    splitFocused,
  };
}
