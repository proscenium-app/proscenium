// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import type { BinderItem } from "./play-file";
import {
  dropPlan,
  filterBinder,
  findItem,
  flatten,
  insert,
  isAncestor,
  move,
  removeItem,
  reorder,
  titleOf,
} from "./binder";

function tree(): BinderItem[] {
  return [
    { id: "script", type: "script", path: "Script.fountain" },
    {
      id: "chars",
      type: "folder",
      path: "Characters",
      children: [
        { id: "mara", type: "character", path: "Characters/Mara.md" },
        { id: "jonah", type: "character", path: "Characters/Jonah.md" },
      ],
    },
    { id: "note", type: "document", path: "Notes/Structure.md" },
  ];
}

const ids = (b: BinderItem[]) => b.map((x) => x.id);

describe("binder pure ops", () => {
  it("finds items at any depth with parent context", () => {
    expect(findItem(tree(), "mara")?.parentId).toBe("chars");
    expect(findItem(tree(), "script")?.parentId).toBe(null);
    expect(findItem(tree(), "nope")).toBeNull();
  });

  it("reorders within a parent", () => {
    expect(ids(reorder(tree(), "note", 0))).toEqual(["note", "script", "chars"]);
    const t = reorder(tree(), "jonah", 0);
    expect(t[1].children!.map((c) => c.id)).toEqual(["jonah", "mara"]);
  });

  it("moves an item into a folder", () => {
    const t = move(tree(), "note", "chars", 1);
    expect(ids(t)).toEqual(["script", "chars"]);
    expect(t[1].children!.map((c) => c.id)).toEqual(["mara", "note", "jonah"]);
  });

  it("moves an item to the root", () => {
    const t = move(tree(), "mara", null, 0);
    expect(ids(t)).toEqual(["mara", "script", "chars", "note"]);
    expect(findItem(t, "chars")?.item.children?.map((c) => c.id)).toEqual(["jonah"]);
  });

  it("refuses to move a folder into its own subtree", () => {
    expect(move(tree(), "chars", "mara", 0)).toEqual(tree());
    expect(isAncestor(tree(), "chars", "mara")).toBe(true);
    expect(isAncestor(tree(), "chars", "note")).toBe(false);
  });

  it("takes an item's title from its filename (docs/app/keeping-work/storage-and-file-format.md#STOR-D4)", () => {
    // There is no `title` field to rename. Renaming IS a path change, which
    // binder-apply performs on disk — the two names cannot drift because there
    // is only one.
    expect(titleOf(findItem(tree(), "mara")!.item)).toBe("Mara");
    expect(titleOf(findItem(tree(), "chars")!.item)).toBe("Characters");
    expect(titleOf(findItem(tree(), "script")!.item)).toBe("Script");
    // A name with dots keeps everything but the last extension.
    expect(titleOf({ id: "x", type: "document", path: "Notes/Notes on 1953.md" })).toBe(
      "Notes on 1953",
    );
  });

  it("removes a subtree and reports the removed item", () => {
    const { binder, removed } = removeItem(tree(), "chars");
    expect(ids(binder)).toEqual(["script", "note"]);
    expect(removed?.children?.length).toBe(2);
  });

  it("inserts at root and into folders", () => {
    const item: BinderItem = { id: "new", type: "document", path: "Notes/New.md" };
    expect(ids(insert(tree(), null, item, 1))).toEqual(["script", "new", "chars", "note"]);
    const t = insert(tree(), "chars", item, 0);
    expect(findItem(t, "chars")!.item.children!.map((c) => c.id)).toEqual(["new", "mara", "jonah"]);
  });

  it("flattens for disk reconciliation", () => {
    expect(flatten(tree()).map((x) => x.id)).toEqual(["script", "chars", "mara", "jonah", "note"]);
  });
});

describe("dropPlan", () => {
  // A tree with a folder in the middle, so "before/after/inside" all have
  // somewhere meaningful to land.
  const tree: BinderItem[] = [
    { id: "a", type: "document", path: "A.md" },
    {
      id: "f",
      type: "folder",
      path: "F",
      children: [
        { id: "f1", type: "document", path: "F/F1.md" },
        { id: "f2", type: "document", path: "F/F2.md" },
      ],
    },
    { id: "b", type: "document", path: "B.md" },
  ];

  it("drops INTO a folder at the end of its children", () => {
    expect(dropPlan(tree, "a", "f", "inside")).toEqual({ parentId: "f", atIndex: 2 });
  });

  it("refuses to drop into a leaf", () => {
    expect(dropPlan(tree, "a", "b", "inside")).toBeNull();
  });

  it("indexes AFTER the removal, which is the off-by-one that reads as 'drag is broken'", () => {
    // `a` is at 0 and `b` at 2. Dropping `a` after `b` must be index 2, not 3:
    // by the time it is inserted, `a` is no longer in the array. Get this
    // wrong and the row lands one short of where the line was drawn.
    expect(dropPlan(tree, "a", "b", "after")).toEqual({ parentId: null, atIndex: 2 });
    expect(dropPlan(tree, "a", "b", "before")).toEqual({ parentId: null, atIndex: 1 });
    // Moving DOWNWARD needs no adjustment.
    expect(dropPlan(tree, "b", "a", "before")).toEqual({ parentId: null, atIndex: 0 });
  });

  it("crosses folders without the removal adjustment", () => {
    expect(dropPlan(tree, "a", "f2", "after")).toEqual({ parentId: "f", atIndex: 2 });
    expect(dropPlan(tree, "f1", "b", "before")).toEqual({ parentId: null, atIndex: 2 });
  });

  it("returns null for a gesture that would change nothing", () => {
    expect(dropPlan(tree, "a", "a", "before")).toBeNull();
    expect(dropPlan(tree, "a", "f", "before")).toBeNull(); // already immediately before f
    expect(dropPlan(tree, "f2", "f", "inside")).toBeNull(); // already the last child
  });

  it("never lets a folder swallow itself", () => {
    expect(dropPlan(tree, "f", "f1", "before")).toBeNull();
    expect(dropPlan(tree, "f", "f", "inside")).toBeNull();
  });

  it("treats the empty space below the tree as the root", () => {
    expect(dropPlan(tree, "f1", null, "after")).toEqual({ parentId: null, atIndex: 3 });
    // Already the last row at the root — nothing to do.
    expect(dropPlan(tree, "b", null, "after")).toBeNull();
  });
});

describe("filterBinder", () => {
  const tree: BinderItem[] = [
    { id: "s", type: "script", path: "The Weight of Water.fountain" },
    {
      id: "c",
      type: "folder",
      path: "Characters",
      children: [
        { id: "m", type: "character", path: "Characters/Mara.md" },
        { id: "j", type: "character", path: "Characters/Jonah.md" },
      ],
    },
  ];

  it("keeps a match's ancestors, so a hit is never orphaned from its folder", () => {
    const out = filterBinder(tree, "mara");
    expect(out.map((i) => i.id)).toEqual(["c"]);
    expect(out[0].children!.map((i) => i.id)).toEqual(["m"]);
  });

  it("a matching folder keeps all of its children — you searched for the folder", () => {
    const out = filterBinder(tree, "charac");
    expect(out[0].children!).toHaveLength(2);
  });

  it("an empty query is the whole tree, unchanged", () => {
    expect(filterBinder(tree, "  ")).toBe(tree);
  });
});
