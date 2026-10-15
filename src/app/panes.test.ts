// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it } from "bun:test";

import {
  __resetPaneIds,
  PANE_FLOOR,
  allSurfaces,
  closeNode,
  closeSurface,
  closeTab,
  defaultTree,
  findLeaf,
  findNode,
  fromLegacyLayout,
  hasSurface,
  leaf,
  leaves,
  moveTab,
  normalize,
  openSurface,
  paneNeed,
  panesWithoutRoom,
  pruneMissingMaterials,
  reviveTree,
  setSize,
  showSurface,
  split,
  splitLeaf,
  surfaceKey,
  type PaneNode,
  type Surface,
} from "./panes";

const SCRIPT: Surface = { kind: "script" };
const BOARD: Surface = { kind: "corkboard" };
const OUTLINE: Surface = { kind: "outliner" };
const COMMENTS: Surface = { kind: "comments" };
const SHEET = (id: string): Surface => ({ kind: "material", id });

beforeEach(() => __resetPaneIds());

/** Sizes should always be a valid distribution. */
function expectWellFormed(node: PaneNode | null) {
  if (!node) return;
  if (node.type === "split") {
    expect(node.children.length).toBeGreaterThanOrEqual(2);
    expect(node.sizes.length).toBe(node.children.length);
    const sum = node.sizes.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
    node.children.forEach(expectWellFormed);
  } else {
    expect(node.tabs.length).toBeGreaterThan(0);
    expect(node.active).toBeGreaterThanOrEqual(0);
    expect(node.active).toBeLessThan(node.tabs.length);
  }
}

describe("opening surfaces", () => {
  it("appends a tab and focuses it", () => {
    const t = leaf([SCRIPT], 0, "a");
    const next = openSurface(t, "a", BOARD);
    const l = findLeaf(next, "a")!;
    expect(l.tabs.map(surfaceKey)).toEqual(["script", "corkboard"]);
    expect(l.active).toBe(1);
  });

  it("focuses rather than duplicating a surface the leaf already has", () => {
    const t = leaf([SCRIPT, BOARD], 1, "a");
    const next = openSurface(t, "a", SCRIPT);
    expect(findLeaf(next, "a")!.tabs).toHaveLength(2);
    expect(findLeaf(next, "a")!.active).toBe(0);
  });

  it("never opens the script twice — one mounted editor", () => {
    // The whole reason SINGLETON exists: a second script tab would fight the
    // one mounted ProseMirror instance for its DOM node.
    const t = split("row", [leaf([SCRIPT], 0, "a"), leaf([BOARD], 0, "b")]);
    const next = openSurface(t, "b", SCRIPT);
    expect(allSurfaces(next).filter((s) => s.kind === "script")).toHaveLength(1);
    expect(findLeaf(next, "b")!.tabs.map(surfaceKey)).toEqual(["corkboard"]);
  });

  it("opens the same material in two panes only once per pane", () => {
    const t = split("row", [leaf([SCRIPT], 0, "a"), leaf([BOARD], 0, "b")]);
    const withSheet = openSurface(openSurface(t, "a", SHEET("x")), "b", SHEET("x"));
    // A material is NOT a singleton — two panes may show the same sheet.
    expect(allSurfaces(withSheet).filter((s) => s.kind === "material")).toHaveLength(2);
  });
});

describe("switching what a pane shows", () => {
  it("replaces the active tab instead of stacking another", () => {
    // The regression in one assertion: the switcher must not grow the strip.
    const t = leaf([SCRIPT], 0, "a");
    const next = showSurface(t, "a", BOARD);
    const l = findLeaf(next, "a")!;
    expect(l.tabs.map(surfaceKey)).toEqual(["corkboard"]);
    expect(l.active).toBe(0);
  });

  it("leaves the other tabs alone and swaps only the one on screen", () => {
    const t = leaf([SCRIPT, BOARD, COMMENTS], 1, "a");
    const l = findLeaf(showSurface(t, "a", OUTLINE), "a")!;
    expect(l.tabs.map(surfaceKey)).toEqual(["script", "outliner", "comments"]);
    expect(l.active).toBe(1);
  });

  it("focuses a surface the pane already holds rather than duplicating it", () => {
    const t = leaf([SCRIPT, BOARD], 1, "a");
    const l = findLeaf(showSurface(t, "a", SCRIPT), "a")!;
    expect(l.tabs.map(surfaceKey)).toEqual(["script", "corkboard"]);
    expect(l.active).toBe(0);
  });

  it("still never produces a second script", () => {
    const t = split("row", [leaf([SCRIPT], 0, "a"), leaf([BOARD], 0, "b")]);
    const next = showSurface(t, "b", SCRIPT);
    expect(allSurfaces(next).filter((s) => s.kind === "script")).toHaveLength(1);
    // The pane that already had it keeps it; the switch focuses it there.
    expect(findLeaf(next, "b")!.tabs.map(surfaceKey)).toEqual(["corkboard"]);
  });

  it("switching away from the script closes it, and switching back reopens it", () => {
    const t = leaf([SCRIPT], 0, "a");
    const away = showSurface(t, "a", BOARD);
    expect(hasSurface(away, SCRIPT)).toBe(false);
    const back = showSurface(away, "a", SCRIPT);
    expect(findLeaf(back, "a")!.tabs.map(surfaceKey)).toEqual(["script"]);
  });

  it("touches only the named leaf", () => {
    const t = split("row", [leaf([SCRIPT], 0, "a"), leaf([BOARD, COMMENTS], 0, "b")]);
    const next = showSurface(t, "b", OUTLINE);
    expect(findLeaf(next, "a")!.tabs.map(surfaceKey)).toEqual(["script"]);
    expect(findLeaf(next, "b")!.tabs.map(surfaceKey)).toEqual(["outliner", "comments"]);
  });
});

describe("splitting", () => {
  it("replaces a leaf with a split of two", () => {
    const t = leaf([SCRIPT], 0, "a");
    const next = splitLeaf(t, "a", "row", BOARD);
    expect(next.type).toBe("split");
    expect(leaves(next).map((l) => l.tabs.map(surfaceKey))).toEqual([["script"], ["corkboard"]]);
    expectWellFormed(next);
  });

  it("places the new pane first when asked", () => {
    const next = splitLeaf(leaf([SCRIPT], 0, "a"), "a", "row", BOARD, true);
    expect(leaves(next).map((l) => l.tabs.map(surfaceKey))).toEqual([["corkboard"], ["script"]]);
  });

  it("splits vertically too", () => {
    const next = splitLeaf(leaf([SCRIPT], 0, "a"), "a", "col", OUTLINE);
    expect((next as { dir: string }).dir).toBe("col");
  });

  it("MOVES the script rather than cloning it when splitting it out", () => {
    const t = leaf([SCRIPT, BOARD], 0, "a");
    const next = splitLeaf(t, "a", "row", SCRIPT);
    expect(allSurfaces(next).filter((s) => s.kind === "script")).toHaveLength(1);
    expectWellFormed(next);
  });

  it("survives splitting out the only surface in the tree", () => {
    const next = splitLeaf(leaf([SCRIPT], 0, "a"), "a", "row", SCRIPT);
    expect(allSurfaces(next).map(surfaceKey)).toEqual(["script"]);
    expectWellFormed(next);
  });
});

describe("closing", () => {
  it("removes a tab and keeps the left neighbour focused", () => {
    const t = leaf([SCRIPT, BOARD, OUTLINE], 2, "a");
    const next = closeTab(t, "a", 2)!;
    expect(findLeaf(next, "a")!.tabs.map(surfaceKey)).toEqual(["script", "corkboard"]);
    expect(findLeaf(next, "a")!.active).toBe(1);
  });

  it("collapses the split when a pane empties", () => {
    // The bug this prevents: a chain of one-child splits that still draw
    // dividers and still divide the width.
    const t = split("row", [leaf([SCRIPT], 0, "a"), leaf([BOARD], 0, "b")]);
    const next = closeTab(t, "b", 0)!;
    expect(next.type).toBe("leaf");
    expect((next as { tabs: Surface[] }).tabs.map(surfaceKey)).toEqual(["script"]);
  });

  it("collapses nested splits all the way up", () => {
    const t = split("row", [
      leaf([SCRIPT], 0, "a"),
      split("col", [leaf([BOARD], 0, "b"), leaf([OUTLINE], 0, "c")]),
    ]);
    const one = closeTab(t, "b", 0)!;
    const two = closeTab(one, "c", 0)!;
    expect(two.type).toBe("leaf");
    expectWellFormed(two);
  });

  it("returns null when the last tab closes", () => {
    expect(closeTab(leaf([SCRIPT], 0, "a"), "a", 0)).toBeNull();
  });

  it("keeps surviving panes' proportions when a sibling closes", () => {
    const t = split(
      "row",
      [leaf([SCRIPT], 0, "a"), leaf([BOARD], 0, "b"), leaf([OUTLINE], 0, "c")],
      [0.5, 0.2, 0.3],
    );
    const next = closeTab(t, "b", 0)! as { sizes: number[] };
    // 0.5 : 0.3 renormalized, not reset to 0.5 : 0.5.
    expect(next.sizes[0]).toBeCloseTo(0.625, 3);
    expect(next.sizes[1]).toBeCloseTo(0.375, 3);
  });

  it("closes a surface wherever it lives", () => {
    const t = split("row", [leaf([SCRIPT], 0, "a"), leaf([BOARD, COMMENTS], 1, "b")]);
    const next = closeSurface(t, COMMENTS)!;
    expect(hasSurface(next, COMMENTS)).toBe(false);
    expectWellFormed(next);
  });
});

describe("closing a whole pane", () => {
  it("closes a pane with every tab in it, whatever the tab count", () => {
    // The pane Split makes has ONE tab, and for a while nothing could close it:
    // the only close box was on a strip drawn for two tabs or more.
    const t = split("row", [leaf([SCRIPT], 0, "a"), leaf([BOARD], 0, "b")]);
    const one = closeNode(t, "b")!;
    expect(one.type).toBe("leaf");
    expect(allSurfaces(one).map(surfaceKey)).toEqual(["script"]);

    const many = closeNode(
      split("row", [leaf([SCRIPT], 0, "a"), leaf([BOARD, OUTLINE, COMMENTS], 1, "b")]),
      "b",
    )!;
    expect(allSurfaces(many).map(surfaceKey)).toEqual(["script"]);
  });

  it("closes everything under a split, and collapses what is left", () => {
    const inner = split("col", [leaf([BOARD], 0, "b"), leaf([OUTLINE], 0, "c")], undefined, "in");
    const t = split("row", [leaf([SCRIPT], 0, "a"), inner]);
    const next = closeNode(t, "in")!;
    expect(next.type).toBe("leaf");
    expect(allSurfaces(next).map(surfaceKey)).toEqual(["script"]);
  });

  it("gives its share to the pane named as its heir", () => {
    const t = split(
      "row",
      [leaf([SCRIPT], 0, "a"), leaf([BOARD], 0, "b"), leaf([OUTLINE], 0, "c")],
      [0.5, 0.2, 0.3],
    );
    // A divider dragged across `b` from `c`'s side: `c` is drawn over both.
    const next = closeNode(t, "b", "c")! as { sizes: number[] };
    expect(next.sizes[0]).toBeCloseTo(0.5, 5);
    expect(next.sizes[1]).toBeCloseTo(0.5, 5);
    expectWellFormed(next as PaneNode);
  });

  it("shares it out in proportion when no heir is named, as a tab's close does", () => {
    const t = split(
      "row",
      [leaf([SCRIPT], 0, "a"), leaf([BOARD], 0, "b"), leaf([OUTLINE], 0, "c")],
      [0.5, 0.2, 0.3],
    );
    const next = closeNode(t, "b")! as { sizes: number[] };
    expect(next.sizes[0]).toBeCloseTo(0.625, 3);
    expect(next.sizes[1]).toBeCloseTo(0.375, 3);
  });

  it("ignores an heir that is not a sibling", () => {
    const inner = split("col", [leaf([BOARD], 0, "b"), leaf([OUTLINE], 0, "c")], [0.5, 0.5], "in");
    const t = split("row", [leaf([SCRIPT], 0, "a"), inner], [0.6, 0.4]);
    const next = closeNode(t, "b", "a")! as { sizes: number[] };
    expect(next.sizes[0]).toBeCloseTo(0.6, 5);
    expect(next.sizes[1]).toBeCloseTo(0.4, 5);
    expectWellFormed(next as PaneNode);
  });

  it("returns null for the whole tree, and the tree for an id that is not in it", () => {
    const t = split("row", [leaf([SCRIPT], 0, "a"), leaf([BOARD], 0, "b")]);
    expect(closeNode(t, t.id)).toBeNull();
    expect(leaves(closeNode(t, "nowhere")!).map((l) => l.id)).toEqual(["a", "b"]);
  });

  it("finds a split as well as a leaf by id", () => {
    const inner = split("col", [leaf([BOARD], 0, "b"), leaf([OUTLINE], 0, "c")], undefined, "in");
    const t = split("row", [leaf([SCRIPT], 0, "a"), inner]);
    expect(findNode(t, "in")).toBe(inner);
    expect(findNode(t, "c")?.type).toBe("leaf");
    expect(findNode(t, "nowhere")).toBeNull();
  });
});

describe("moving tabs", () => {
  it("moves a tab into another pane", () => {
    const t = split("row", [leaf([SCRIPT, BOARD], 1, "a"), leaf([OUTLINE], 0, "b")]);
    const next = moveTab(t, { leafId: "a", index: 1 }, "b");
    expect(findLeaf(next, "a")!.tabs.map(surfaceKey)).toEqual(["script"]);
    expect(findLeaf(next, "b")!.tabs.map(surfaceKey)).toEqual(["outliner", "corkboard"]);
    expect(findLeaf(next, "b")!.active).toBe(1);
    expectWellFormed(next);
  });

  it("reorders within one pane", () => {
    const t = leaf([SCRIPT, BOARD, OUTLINE], 0, "a");
    const next = moveTab(t, { leafId: "a", index: 2 }, "a", 0);
    expect(findLeaf(next, "a")!.tabs.map(surfaceKey)).toEqual(["outliner", "script", "corkboard"]);
  });

  it("collapses the source pane when its last tab leaves", () => {
    const t = split("row", [leaf([SCRIPT], 0, "a"), leaf([BOARD], 0, "b")]);
    const next = moveTab(t, { leafId: "b", index: 0 }, "a");
    expect(next.type).toBe("leaf");
    expect((next as { tabs: Surface[] }).tabs.map(surfaceKey)).toEqual(["script", "corkboard"]);
  });

  it("is a no-op for an index that isn't there", () => {
    const t = leaf([SCRIPT], 0, "a");
    expect(moveTab(t, { leafId: "a", index: 5 }, "a")).toBe(t);
  });
});

describe("resizing", () => {
  it("redistributes between the two neighbours of one divider only", () => {
    const t = split(
      "row",
      [leaf([SCRIPT], 0, "a"), leaf([BOARD], 0, "b"), leaf([OUTLINE], 0, "c")],
      [0.4, 0.3, 0.3],
    );
    const next = setSize(t, t.id, 0, 0.5) as { sizes: number[] };
    expect(next.sizes[0]).toBeCloseTo(0.5, 5);
    expect(next.sizes[1]).toBeCloseTo(0.2, 5);
    expect(next.sizes[2]).toBeCloseTo(0.3, 5); // untouched
  });

  it("refuses to shrink a pane past the minimum", () => {
    const t = split("row", [leaf([SCRIPT], 0, "a"), leaf([BOARD], 0, "b")], [0.5, 0.5]);
    const next = setSize(t, t.id, 0, 0.001) as { sizes: number[] };
    expect(next.sizes[0]).toBeGreaterThan(0.1);
    expectWellFormed(next as PaneNode);
  });

  it("stops at the floors the renderer measured, on either side", () => {
    const t = split("row", [leaf([SCRIPT], 0, "a"), leaf([BOARD], 0, "b")], [0.5, 0.5]);
    const least = { first: 0.3, second: 0.25 };
    expect((setSize(t, t.id, 0, 0.01, 1, least) as { sizes: number[] }).sizes[0]).toBeCloseTo(0.3);
    expect((setSize(t, t.id, 0, 0.99, 1, least) as { sizes: number[] }).sizes[0]).toBeCloseTo(0.75);
  });

  it("meets in the middle when the two floors do not fit the pair", () => {
    const t = split("row", [leaf([SCRIPT], 0, "a"), leaf([BOARD], 0, "b")], [0.5, 0.5]);
    const least = { first: 0.7, second: 0.7 };
    for (const ask of [0, 0.5, 1]) {
      const next = setSize(t, t.id, 0, ask, 1, least) as { sizes: number[] };
      expect(next.sizes[0]).toBeCloseTo(0.5, 5);
    }
  });

  it("resizes across a pane that is not drawn, leaving that pane's share alone", () => {
    const t = split(
      "row",
      [leaf([SCRIPT], 0, "a"), leaf([BOARD], 0, "b"), leaf([OUTLINE], 0, "c")],
      [0.4, 0.2, 0.4],
    );
    const next = setSize(t, t.id, 0, 0.6, 2) as { sizes: number[] };
    expect(next.sizes[0]).toBeCloseTo(0.6, 5);
    expect(next.sizes[1]).toBeCloseTo(0.2, 5); // the pane between, untouched
    expect(next.sizes[2]).toBeCloseTo(0.2, 5);
  });

  it("is a no-op for a pair that is not two children in order", () => {
    const t = split("row", [leaf([SCRIPT], 0, "a"), leaf([BOARD], 0, "b")], [0.5, 0.5]);
    expect((setSize(t, t.id, 1, 0.9, 0) as { sizes: number[] }).sizes).toEqual([0.5, 0.5]);
    expect((setSize(t, t.id, 0, 0.9, 5) as { sizes: number[] }).sizes).toEqual([0.5, 0.5]);
  });
});

describe("room", () => {
  const W = PANE_FLOOR.width;
  const H = PANE_FLOOR.height;
  const row = (...ids: string[]) =>
    split(
      "row",
      ids.map((id) => leaf([BOARD], 0, id)),
    );

  it("needs one floor for a pane, the sum along a split and the largest across it", () => {
    expect(paneNeed(leaf([SCRIPT], 0, "a"))).toEqual({ width: W, height: H });
    expect(paneNeed(row("a", "b", "c"))).toEqual({ width: 3 * W, height: H });
    const stacked = split("col", [leaf([SCRIPT], 0, "a"), row("b", "c")]);
    expect(paneNeed(stacked)).toEqual({ width: 2 * W, height: 2 * H });
  });

  it("counts only the panes still drawn, and nothing for a split with none", () => {
    const t = split("row", [leaf([SCRIPT], 0, "a"), row("b", "c")]);
    expect(paneNeed(t, new Set(["b"]))).toEqual({ width: 2 * W, height: H });
    expect(paneNeed(row("b", "c"), new Set(["b", "c"]))).toBeNull();
  });

  it("leaves every pane in when they fit", () => {
    expect(panesWithoutRoom(row("a", "b"), { width: 2 * W, height: H }, "a").size).toBe(0);
    // A measured box is fractional: a hair under is still room.
    expect(panesWithoutRoom(row("a", "b"), { width: 2 * W - 0.4, height: H }, "a").size).toBe(0);
  });

  it("leaves out the smallest pane first, and never the focused one", () => {
    const t = split(
      "row",
      [leaf([SCRIPT], 0, "a"), leaf([BOARD], 0, "b"), leaf([OUTLINE], 0, "c")],
      [0.5, 0.2, 0.3],
    );
    const box = { width: 2 * W + 10, height: 400 };
    expect([...panesWithoutRoom(t, box, "a")]).toEqual(["b"]);
    // Focused, the smallest stays and the next smallest goes.
    expect([...panesWithoutRoom(t, box, "b")]).toEqual(["c"]);
  });

  it("leaves out the later of two equals", () => {
    expect([...panesWithoutRoom(row("a", "b", "c"), { width: 2 * W, height: H }, "a")]).toEqual([
      "c",
    ]);
  });

  it("keeps one pane however small the box, the first when none is focused", () => {
    const box = { width: 10, height: 10 };
    expect([...panesWithoutRoom(row("a", "b", "c"), box, "b")].sort()).toEqual(["a", "c"]);
    expect([...panesWithoutRoom(row("a", "b", "c"), box, null)].sort()).toEqual(["b", "c"]);
    expect([...panesWithoutRoom(row("a", "b", "c"), box, "gone")].sort()).toEqual(["b", "c"]);
    expect(panesWithoutRoom(leaf([SCRIPT], 0, "a"), box, "a").size).toBe(0);
  });

  it("passes over a pane whose absence would not help", () => {
    // Too narrow for the row of three; the tiny pane stacked beside it costs
    // no width, so it stays and one of the row goes.
    const stack = split("col", [leaf([SCRIPT], 0, "a"), leaf([OUTLINE], 0, "tiny")], [0.95, 0.05]);
    const t = split("row", [stack, leaf([BOARD], 0, "b"), leaf([BOARD], 0, "c")], [0.4, 0.3, 0.3]);
    const hidden = panesWithoutRoom(t, { width: 2 * W, height: 2 * H }, "a");
    expect([...hidden]).toEqual(["c"]);
  });

  it("answers for height as it does for width", () => {
    const t = split("col", [leaf([SCRIPT], 0, "a"), leaf([BOARD], 0, "b")], [0.7, 0.3]);
    expect([...panesWithoutRoom(t, { width: 900, height: 2 * H - 20 }, "a")]).toEqual(["b"]);
    expect(panesWithoutRoom(t, { width: 900, height: 2 * H }, "a").size).toBe(0);
  });

  it("changes nothing in the tree: a larger box draws every pane again", () => {
    const t = row("a", "b", "c");
    const before = JSON.stringify(t);
    expect(panesWithoutRoom(t, { width: W, height: H }, "a").size).toBe(2);
    expect(JSON.stringify(t)).toBe(before);
    expect(panesWithoutRoom(t, { width: 3 * W, height: H }, "a").size).toBe(0);
  });
});

describe("normalize", () => {
  it("clamps an out-of-range active index", () => {
    const n = normalize({ type: "leaf", id: "a", tabs: [SCRIPT], active: 7 }) as { active: number };
    expect(n.active).toBe(0);
  });

  it("turns a split of one into its child", () => {
    const n = normalize(split("row", [leaf([SCRIPT], 0, "a")]))!;
    expect(n.type).toBe("leaf");
  });
});

describe("persistence", () => {
  it("round-trips a tree through JSON", () => {
    const t = split("row", [
      leaf([SCRIPT], 0, "a"),
      split("col", [leaf([BOARD], 0, "b"), leaf([SHEET("m1"), COMMENTS], 1, "c")]),
    ]);
    const back = reviveTree(JSON.parse(JSON.stringify(t)))!;
    expect(allSurfaces(back).map(surfaceKey)).toEqual(allSurfaces(t).map(surfaceKey));
    expectWellFormed(back);
  });

  it("keeps a Comments pane across a reload", () => {
    // The feed is a surface like any other: close the app with it open and it
    // is still there (docs/app/writing/comments.md#COMM-D5).
    const t = split("row", [leaf([SCRIPT], 0, "a"), leaf([{ kind: "comments" }], 0, "b")]);
    const back = reviveTree(JSON.parse(JSON.stringify(t)))!;
    expect(allSurfaces(back).map(surfaceKey)).toEqual(["script", "comments"]);
  });

  it("drops garbage instead of throwing", () => {
    expect(reviveTree(null)).toBeNull();
    expect(reviveTree({ type: "leaf", tabs: [{ kind: "nope" }] })).toBeNull();
    expect(reviveTree({ type: "leaf", tabs: [{ kind: "material" }] })).toBeNull();
    expect(reviveTree("garbage")).toBeNull();
  });

  it("keeps the good tabs from a partly corrupt leaf", () => {
    const back = reviveTree({
      type: "leaf",
      tabs: [{ kind: "script" }, { kind: "bogus" }, { kind: "corkboard" }],
      active: 0,
    })!;
    expect(allSurfaces(back).map(surfaceKey)).toEqual(["script", "corkboard"]);
  });

  it("migrates the v1 split layout", () => {
    const t = fromLegacyLayout({ split: true, surface: "outliner", ratio: 0.7 })!;
    expect(t.type).toBe("split");
    expect(leaves(t).map((l) => l.tabs.map(surfaceKey))).toEqual([["script"], ["outliner"]]);
    expect((t as { sizes: number[] }).sizes[0]).toBeCloseTo(0.7, 5);
  });

  it("migrates the v1 unsplit layout to a lone script", () => {
    const t = fromLegacyLayout({ split: false, surface: "corkboard", ratio: 0.6 })!;
    expect(t.type).toBe("leaf");
    expect(allSurfaces(t).map(surfaceKey)).toEqual(["script"]);
  });

  it("ignores a layout that isn't v1", () => {
    expect(fromLegacyLayout({ nope: 1 })).toBeNull();
  });
});

describe("pruning materials", () => {
  it("drops tabs for materials that no longer exist", () => {
    const t = split("row", [leaf([SCRIPT], 0, "a"), leaf([SHEET("gone"), SHEET("here")], 0, "b")]);
    const next = pruneMissingMaterials(t, new Set(["here"]))!;
    expect(allSurfaces(next).map(surfaceKey)).toEqual(["script", "material:here"]);
    expectWellFormed(next);
  });

  it("collapses a pane that held only a deleted material", () => {
    const t = split("row", [leaf([SCRIPT], 0, "a"), leaf([SHEET("gone")], 0, "b")]);
    const next = pruneMissingMaterials(t, new Set())!;
    expect(next.type).toBe("leaf");
    expect(allSurfaces(next).map(surfaceKey)).toEqual(["script"]);
  });

  it("leaves a tree with no materials alone", () => {
    const t = defaultTree();
    expect(pruneMissingMaterials(t, new Set())).toEqual(t);
  });
});
