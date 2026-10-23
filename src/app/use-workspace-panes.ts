// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { announce, useToast } from "../ui";
import { titleOf, type BinderItem } from "../workspace";
import type { Workspace } from "./useWorkspace";
import { usePanes } from "./use-panes";
import {
  allSurfaces,
  closeNode,
  findLeaf,
  findNode,
  leaves,
  paneNeed,
  panesWithoutRoom,
  surfaceKey,
  type PaneBox,
  type Surface,
} from "./panes";
import { playLanding } from "./regions";
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
  | "root"
  | "binder"
  | "scriptTitle"
  | "openMaterials"
  | "selectItem"
  | "view"
  | "setView"
  | "closeMaterial"
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

  /* The room the panes have, measured: the element comes and goes with the
     play, so it is held in state and the box is read whenever it or the window
     changes. `resize` beside the observer for the reason use-narrow-layout.ts
     gives: it is a plain event, delivered with or without a frame loop. */
  const [paneRoot, setPaneRootEl] = useState<HTMLElement | null>(null);
  const setPaneRoot = useCallback((el: HTMLElement | null) => {
    paneRootRef.current = el;
    setPaneRootEl(el);
  }, []);
  const [paneBox, setPaneBox] = useState<PaneBox | null>(null);
  useLayoutEffect(() => {
    if (!paneRoot) {
      setPaneBox(null);
      return;
    }
    const read = () => {
      const { width, height } = paneRoot.getBoundingClientRect();
      setPaneBox((was) =>
        was && Math.abs(was.width - width) < 0.5 && Math.abs(was.height - height) < 0.5
          ? was
          : { width, height },
      );
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(paneRoot);
    window.addEventListener("resize", read);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", read);
    };
  }, [paneRoot]);

  /**
   * The panes this window has no room for (panes.ts `panesWithoutRoom`): left
   * out of the drawing, never out of the tree, so each is back when there is
   * room. Derived on every render from the box and the tree, as a rail a
   * narrow window suppresses is.
   */
  const paneKeep = panes.focusedLeaf;
  const hiddenPanes = useMemo(
    () => (paneBox ? panesWithoutRoom(paneTree, paneBox, paneKeep) : new Set<string>()),
    [paneTree, paneBox, paneKeep],
  );

  /* A pane that would not be drawn is not made: Split, Open in New Pane and a
     drop on a pane's edge say so instead. They used to make it anyway, and in
     a small window the new pane, or the one beside it, was a sliver. */
  const toast = useToast();
  panes.room.current = {
    fits: (next) => {
      const need = paneNeed(next);
      return (
        !paneBox ||
        !need ||
        (need.width <= paneBox.width + 0.5 && need.height <= paneBox.height + 0.5)
      );
    },
    refuse: () =>
      toast({
        kind: "plain",
        title: "No room for another pane",
        detail: "Make the window larger, or close a pane first.",
      }),
  };

  /* Said, since nothing takes focus when a window is resized (the app's rule
     for what changes without it). Only of a pane that was on screen a moment
     ago: a layout restored into a smaller window is how the play opens, not a
     change, and its panes are new to this window. */
  const paneRoom = useRef<{ drawn: Set<string>; hidden: Map<string, string> }>({
    drawn: new Set(),
    hidden: new Map(),
  });
  useEffect(() => {
    const drawn = new Set<string>();
    const hidden = new Map<string, string>();
    for (const l of leaves(paneTree)) {
      const surface = l.tabs[l.active];
      if (!hiddenPanes.has(l.id)) drawn.add(l.id);
      else if (surface) hidden.set(l.id, labelForSurface(surface, binder, scriptTitle));
    }
    const was = paneRoom.current;
    paneRoom.current = { drawn, hidden };
    const gone = [...hidden].filter(([id]) => was.drawn.has(id)).map(([, label]) => label);
    const back = [...was.hidden].filter(([id]) => drawn.has(id)).map(([, label]) => label);
    if (gone.length > 0) announce(`No room for ${gone.join(", ")}. Hidden until there is.`);
    else if (back.length > 0) announce(`${back.join(", ")} back.`);
  }, [hiddenPanes, paneTree, binder, scriptTitle]);

  /** The surface showing in each pane right now (the active tab of each leaf on screen). */
  const visibleSurfaces = useMemo(
    () =>
      leaves(paneTree)
        .filter((l) => !hiddenPanes.has(l.id))
        .map((l) => l.tabs[l.active])
        .filter(Boolean),
    [paneTree, hiddenPanes],
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

  const labelFor = useCallback(
    (surface: Surface) => labelForSurface(surface, binder, scriptTitle),
    [binder, scriptTitle],
  );

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

  /** A close the writer asked for took a pane with it (see the effect below). */
  const closedByWriter = useRef(false);

  /**
   * Closing a tab. A material's buffer belongs to its tab, so this is where it
   * is released — but only when the LAST tab showing that sheet goes: the same
   * sheet can be open in two panes, and freeing the buffer while the other pane
   * still renders it would blank that pane and drop the hash its next save
   * depends on.
   */
  const onCloseTab = useCallback(
    (leafId: string, index: number) => {
      const leaf = findLeaf(paneTree, leafId);
      const surface = leaf?.tabs[index];
      closedByWriter.current = leaf?.tabs.length === 1;
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

  /**
   * Closing a whole pane, by View › Close Pane or a divider dragged across it:
   * every tab in it, and every pane under it when it is a split. Each sheet's
   * buffer goes with its last tab, as above.
   */
  const onClosePane = useCallback(
    (nodeId: string, heirId?: string) => {
      const node = findNode(paneTree, nodeId);
      // The last pane is not closed: there is nothing to give its room to.
      if (!node || node === paneTree) return;
      const after = closeNode(paneTree, nodeId, heirId);
      const kept = new Set((after ? allSurfaces(after) : []).map(surfaceKey));
      const closed = allSurfaces(node);
      closedByWriter.current = true;
      panes.closePane(nodeId, heirId);
      for (const surface of closed) {
        if (surface.kind === "material" && !kept.has(surfaceKey(surface))) {
          closeMaterial(surface.id);
        }
      }
      const names = leaves(node)
        .map((l) => l.tabs[l.active])
        .filter(Boolean)
        .map((surface) => labelForSurface(surface, binder, scriptTitle));
      announce(`Closed ${names.join(", ")}.`);
    },
    [paneTree, panes, closeMaterial, binder, scriptTitle],
  );

  /** View › Close Pane: the focused pane, when it is one of several. */
  const closeFocusedPane = useCallback(() => {
    const id = panes.focusedLeaf ?? leaves(paneTree)[0]?.id;
    if (id) onClosePane(id);
  }, [panes.focusedLeaf, paneTree, onClosePane]);

  /* A pane the writer closes can take the keyboard with it: its close box, a
     field in it, the script. The keyboard then goes to the pane that has the
     focus, where ⌃⇥ would land in the play, rather than to nothing. Only after
     a close asked for here: a pane that goes because its document was moved to
     the Trash leaves the keyboard to the binder that did it. */
  useEffect(() => {
    if (!closedByWriter.current) return;
    closedByWriter.current = false;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    playLanding()?.focus({ preventScroll: true });
  }, [paneTree]);

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
    setPaneRoot,
    hiddenPanes,
    scriptVisible,
    visibleSurfaces,
    labelFor,
    toolbarAddable,
    addableFor,
    onActivateTab,
    switcherView,
    onCloseTab,
    onClosePane,
    closeFocusedPane,
    onSelectBinderItem,
    onDropBinderItem,
    splitFocused,
  };
}
