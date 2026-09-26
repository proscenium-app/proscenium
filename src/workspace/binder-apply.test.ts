// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, mock } from "bun:test";
import { PLAY_TMPL, stringifyCanonical } from "./json-io";
import type { PlayFile } from "./play-file";
import type { MoveStart, PendingMove } from "../storage/ipc";

// In-memory vault mirroring the Rust semantics, so binder-apply's disk
// orchestration is tested without Tauri. Binder paths ARE vault paths now: the
// vault is opened at the play's own folder, and there is no sub-project prefix.
let store: Map<string, string>;
let refuseManifest = false;
let failFinish = false;
let pendingMoves: Map<string, PendingMove>;
let afterMove: (() => void) | null = null;
const hashOf = (s: string) =>
  "sha256:" + s.length + "-" + (s.split("").reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 0)).toString(16);

const vaultMock = {
  async read(rel: string) {
    if (!store.has(rel)) throw new Error("ENOENT " + rel);
    const content = store.get(rel)!;
    return { content, hash: hashOf(content) };
  },
  async write(rel: string, content: string, expected: string | null, rebasable = false) {
    if (refuseManifest && rel.endsWith(".proscenium")) throw new Error("EPERM play file locked");
    if (expected != null && store.has(rel) && hashOf(store.get(rel)!) !== expected) {
      // Nothing is written and no sibling is made (docs/app/keeping-work/storage-and-file-format.md#STOR-D9).
      const hash = hashOf(store.get(rel)!);
      return { status: rebasable ? ("stale" as const) : ("collision" as const), hash };
    }
    store.set(rel, content);
    return { status: "ok" as const, hash: hashOf(content) };
  },
  // A Mac volume is case-insensitive (docs/app/keeping-work/storage-and-file-format.md#STOR-D4): `Charlie.md` exists the
  // moment `charlie.md` does, because they are one file. The Rust vault asks
  // the filesystem, so this asks the same question the same way.
  async exists(rel: string) {
    const want = rel.toLowerCase();
    return [...store.keys()].some((k) => {
      const key = k.toLowerCase();
      return key === want || key.startsWith(want + "/");
    });
  },
  async rename(from: string, to: string) {
    if (from.toLowerCase() !== to.toLowerCase() && await this.exists(to)) throw new Error("destination occupied");
    for (const k of [...store.keys()].filter((k) => k === from || k.startsWith(from + "/"))) {
      store.set(to + k.slice(from.length), store.get(k)!);
      store.delete(k);
    }
  },
  async beginMove(from: string, to: string, manifest: string, payload: string): Promise<MoveStart> {
    const intent = { id: "a208", from, to, manifest, payload };
    if (pendingMoves.size) return { status: "refused", message: "unfinished move", blocked: true };
    pendingMoves.set(intent.id, intent);
    try { await this.rename(from, to); }
    catch (error) { pendingMoves.delete(intent.id); return { status: "refused", message: String(error), blocked: false }; }
    afterMove?.();
    return { status: "ok", intent };
  },
  async finishMove(id: string) {
    if (failFinish) throw new Error("journal sync refused");
    pendingMoves.delete(id);
  },
  async rollbackMove(id: string) {
    const intent = pendingMoves.get(id)!;
    await this.rename(intent.to, intent.from);
  },
  async trash(rel: string) {
    for (const k of [...store.keys()].filter((k) => k === rel || k.startsWith(rel + "/"))) {
      store.delete(k);
    }
  },
  async mkdir() {},
  // Exclusive, like the Rust vault's guarded write with the no-file hash.
  async create(rel: string, content: string) {
    if (await this.exists(rel)) throw new Error(`“${rel}” is already there, so it was left alone.`);
    store.set(rel, content);
    return hashOf(content);
  },
  async createBinary(rel: string, base64: string) {
    return this.create(rel, atob(base64));
  },
};

mock.module("../storage", () => ({ vault: vaultMock }));

const {
  renameItem,
  moveItem,
  newFolder,
  newMaterial,
  newScript,
  deleteItem,
  duplicateItem,
  reorderItem,
  restoreBinderItem,
  importIntoPlay,
} = await import("./binder-apply");
const { titleOf } = await import("./binder");
const { recoverBinderMoves, applyRelocation, decodeRelocation } = await import("./binder-relocation");

const PLAY_PATH = "The Weight of Water.proscenium";

function seed(): { play: PlayFile; hash: string } {
  const play: PlayFile = {
    kind: "proscenium/play",
    schemaVersion: 1,
    id: "01PLAY",
    created: "2026-06-18T21:42:00Z",
    modified: "2026-06-18T21:42:00Z",
    generator: { app: "Proscenium", version: "1.0.0" },
    settings: { format: "dg-modern", sceneAnchors: "manifest" },
    binder: [
      { id: "script", type: "script", path: "The Weight of Water.fountain" },
      {
        id: "chars",
        type: "folder",
        path: "Characters",
        children: [{ id: "mara", type: "character", path: "Characters/Mara.md" }],
      },
      // A folder with no directory on disk: create-on-demand (docs/app/keeping-work/storage-and-file-format.md#STOR-D3).
      { id: "notes", type: "folder", path: "Notes", children: [] },
    ],
    scripts: { script: { scenes: [], orphans: [] } },
  };
  store.set("The Weight of Water.fountain", "# ACT ONE\n");
  store.set("Characters/Mara.md", "# MARA\n");
  const content = stringifyCanonical(play, PLAY_TMPL);
  store.set(PLAY_PATH, content);
  return { play, hash: hashOf(content) };
}

const ctx = () => ({ playPath: PLAY_PATH, ...seedRef });
let seedRef: { play: PlayFile; hash: string };

beforeEach(() => {
  store = new Map();
  refuseManifest = false;
  failFinish = false;
  pendingMoves = new Map();
  afterMove = null;
  seedRef = seed();
});

// Each case began as a reproduction of a data-loss report. Its assertions
// proved loss; these assert that the same production operations keep the words.
describe("data-loss reproductions: safe outcomes", () => {
  it("docs/app/keeping-work/storage-and-file-format.md#STOR-90: rebasing a reorder retains another writer's new script and card notes", async () => {
    const original = ctx();
    const newer = structuredClone(original.play);
    newer.binder.push({ id: "new-script", type: "script", path: "Another.fountain" });
    newer.scripts["new-script"] = { scenes: [{ id: "new-scene",
      anchor: { ordinal: 0, headingHash: "h", embeddedId: null },
      card: { color: "cream", status: "draft", label: "", boardNote: "ONLY COPY OF NOTES" } }], orphans: [] };
    store.set(PLAY_PATH, stringifyCanonical(newer, PLAY_TMPL));
    const out = await reorderItem(original, "notes", 0);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.play.binder.some((item) => item.id === "new-script")).toBe(true);
    expect(out.play.scripts["new-script"].scenes[0].card.boardNote).toBe("ONLY COPY OF NOTES");
  });

  it("docs/app/keeping-work/storage-and-file-format.md#STOR-57: a rebase never replaces malformed bytes with the cached play", async () => {
    const raw = '{"kind":"proscenium/play","logline":"UNIQUE NEW WORDS';
    store.set(PLAY_PATH, raw);
    const out = await reorderItem(ctx(), "notes", 0);
    expect(out.ok).toBe(false);
    expect(store.get(PLAY_PATH)).toBe(raw);
  });

  it("docs/app/keeping-work/storage-and-file-format.md#STOR-90: trash undo keeps later scripts and their canonical notes", async () => {
    const original = ctx();
    const removed = await deleteItem(original, "script");
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    const newer = structuredClone(removed.play);
    newer.binder.push({ id: "B", type: "script", path: "B.fountain" });
    newer.scripts.B = { scenes: [], orphans: [], note: "UNIQUE LATER NOTE" };
    store.set(PLAY_PATH, stringifyCanonical(newer, PLAY_TMPL));
    const restored = await restoreBinderItem({ playPath: PLAY_PATH, play: removed.play, hash: removed.hash },
      original.play.binder[0], null, 0, { script: original.play.scripts.script });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.play.binder.map((row) => row.id)).toEqual(["script", "chars", "notes", "B"]);
    expect(restored.play.scripts.B.note).toBe("UNIQUE LATER NOTE");
  });

  it("docs/app/keeping-work/storage-and-file-format.md#STOR-91: a refused manifest after a rename restores the original writing path", async () => {
    refuseManifest = true;
    const out = await renameItem(ctx(), "script", "Renamed");
    expect(out.ok).toBe(false);
    expect(store.get("The Weight of Water.fountain")).toBe("# ACT ONE\n");
    expect(store.has("Renamed.fountain")).toBe(false);
    expect(pendingMoves.size).toBe(0);
  });

  it("docs/app/keeping-work/storage-and-file-format.md#STOR-91: an occupied original path blocks writing and keeps the recovery intent", async () => {
    refuseManifest = true;
    afterMove = () => store.set("The Weight of Water.fountain", "OTHER WRITER");
    const out = await renameItem(ctx(), "script", "Renamed");
    expect(out).toMatchObject({ ok: false, blocked: true });
    expect(store.get("The Weight of Water.fountain")).toBe("OTHER WRITER");
    expect(store.get("Renamed.fountain")).toBe("# ACT ONE\n");
    expect(pendingMoves.size).toBe(1);
  });

  it("docs/app/keeping-work/storage-and-file-format.md#STOR-91: an interrupted move reopens under its original item id and retains later notes", async () => {
    const original = ctx();
    const op = { version: 1 as const, itemId: "script", from: "The Weight of Water.fountain", to: "Renamed.fountain" };
    await vaultMock.beginMove(op.from, op.to, PLAY_PATH, JSON.stringify(op));
    const fresh = structuredClone(original.play);
    fresh.binder.push({ id: "later", type: "document", path: "Later.md" });
    fresh.scripts.script.note = "LATEST CARD NOTE";
    store.set(PLAY_PATH, stringifyCanonical(fresh, PLAY_TMPL));
    const recovered = await recoverBinderMoves(PLAY_PATH, { data: original.play, hash: original.hash }, [...pendingMoves.values()]);
    expect(recovered.data.binder[0]).toMatchObject({ id: "script", path: op.to });
    expect(recovered.data.binder[recovered.data.binder.length - 1]?.id).toBe("later");
    expect(recovered.data.scripts.script.note).toBe("LATEST CARD NOTE");
    expect(store.get(op.to)).toBe("# ACT ONE\n");
    expect(store.has(op.from)).toBe(false);
    expect(pendingMoves.size).toBe(0);
  });

  it("docs/app/keeping-work/storage-and-file-format.md#STOR-91: metadata already committed before a crash is idempotent; journal sync must still succeed", async () => {
    failFinish = true;
    const out = await renameItem(ctx(), "script", "Renamed");
    expect(out).toMatchObject({ ok: false, blocked: true });
    const current = await vaultMock.read(PLAY_PATH);
    expect(JSON.parse(current.content).binder[0].path).toBe("Renamed.fountain");
    expect(pendingMoves.size).toBe(1);
    failFinish = false;
    const recovered = await recoverBinderMoves(PLAY_PATH, { data: JSON.parse(current.content), hash: current.hash }, [...pendingMoves.values()]);
    expect(recovered.data.binder.filter((item) => item.id === "script")).toHaveLength(1);
    expect(pendingMoves.size).toBe(0);
  });

  it("docs/app/keeping-work/storage-and-file-format.md#STOR-91: recovery refuses mismatched paths, another play, or an externally moved identity", async () => {
    const op = { version: 1 as const, itemId: "script", from: "The Weight of Water.fountain", to: "Renamed.fountain" };
    const intent = { id: "a208", from: op.from, to: op.to, manifest: PLAY_PATH, payload: JSON.stringify(op) };
    expect(() => decodeRelocation({ ...intent, to: "Different.fountain" })).toThrow();
    await expect(recoverBinderMoves("Other.proscenium", { data: seedRef.play, hash: seedRef.hash }, [intent])).rejects.toThrow();
    const moved = structuredClone(seedRef.play);
    moved.binder[0].path = "Somewhere Else.fountain";
    expect(() => applyRelocation(moved, op)).toThrow();
  });

  it("docs/app/keeping-work/storage-and-file-format.md#STOR-36: move replay matches a normalized manifest and rewrites child paths by segment", () => {
    const play = structuredClone(seedRef.play);
    play.binder = [{ id: "folder", type: "folder", path: "Cafe\u0301", children: [
      { id: "script", type: "script", path: "Cafe\u0301/Act.fountain" },
    ] }];
    const moved = applyRelocation(play, { version: 1, itemId: "folder", from: "Café", to: "Drafts" });
    expect(moved.binder[0].path).toBe("Drafts");
    expect(moved.binder[0].children![0].path).toBe("Drafts/Act.fountain");
  });
});

describe("binder-apply disk mapping", () => {
  it("reorders without moving files (the play file only)", async () => {
    const res = await reorderItem(ctx(), "chars", 0);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.play.binder.map((b) => b.id)).toEqual(["chars", "script", "notes"]);
    expect(store.has("The Weight of Water.fountain")).toBe(true);
  });

  it("renames a script by moving its file — there is no sidecar to keep in step", async () => {
    const res = await renameItem(ctx(), "script", "Low Tide");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const item = res.play.binder.find((b) => b.id === "script")!;
    // The filename IS the title — no slug in between, and no second name to
    // disagree with it (docs/app/keeping-work/storage-and-file-format.md#STOR-D4).
    expect(item.path).toBe("Low Tide.fountain");
    expect(titleOf(item)).toBe("Low Tide");
    expect(store.has("Low Tide.fountain")).toBe(true);
    expect(store.has("The Weight of Water.fountain")).toBe(false);
    // The card records stay attached: they are keyed by binder id, not path.
    expect(res.play.scripts.script).toBeDefined();
  });

  it("renames a folder's directory too, carrying its subtree", async () => {
    const r = await renameItem(ctx(), "chars", "The Cast");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const folder = r.play.binder.find((b) => b.id === "chars")!;
    expect(folder.path).toBe("The Cast");
    expect(folder.children![0].path).toBe("The Cast/Mara.md");
    expect(store.has("The Cast/Mara.md")).toBe(true);
    expect(store.has("Characters/Mara.md")).toBe(false);
  });

  it("renames a folder that has no directory yet", async () => {
    // An empty binder folder is a row and nothing else, so there is nothing on
    // disk to move — and refusing the rename would baffle the writer.
    const r = await renameItem(ctx(), "notes", "Thoughts");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.play.binder.find((b) => b.id === "notes")!.path).toBe("Thoughts");
    expect(store.has("Thoughts")).toBe(false);
  });

  it("renames by case alone without calling its own file taken", async () => {
    // A sheet filed as a slug ("charlie") renamed to the name the play uses. The
    // file's own old name answers `exists` for the new one, and counting that as
    // a collision renamed the sheet to "Charlie 2".
    const r = await renameItem(ctx(), "mara", "MARA");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const chars = r.play.binder.find((b) => b.id === "chars")!;
    expect(chars.children![0].path).toBe("Characters/MARA.md");
    expect(store.has("Characters/MARA.md")).toBe(true);
    expect(store.has("Characters/Mara.md")).toBe(false);
  });

  it("renames a folder by case alone, carrying its subtree", async () => {
    const r = await renameItem(ctx(), "chars", "characters");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const folder = r.play.binder.find((b) => b.id === "chars")!;
    expect(folder.path).toBe("characters");
    expect(folder.children![0].path).toBe("characters/Mara.md");
    expect(store.has("characters/Mara.md")).toBe(true);
  });

  it("still steps aside for a DIFFERENT file whose name differs only by case", async () => {
    let r = await newMaterial(ctx(), "chars", "character", "Jonah");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    seedRef = { play: r.play, hash: r.hash };
    r = await renameItem(ctx(), r.createdId!, "mara");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const paths = r.play.binder.find((b) => b.id === "chars")!.children!.map((c) => c.path);
    // Characters/mara.md would be Mara's file on a Mac — never write over it.
    expect(paths).toEqual(["Characters/Mara.md", "Characters/mara 2.md"]);
    expect(store.get("Characters/Mara.md")).toBe("# MARA\n");
  });

  it("strips only what a filesystem cannot hold, and adopts the real name", async () => {
    const res = await renameItem(ctx(), "script", "Act 1/2: the end?");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const item = res.play.binder.find((b) => b.id === "script")!;
    expect(item.path).toBe("Act 12 the end.fountain");
    expect(titleOf(item)).toBe("Act 12 the end");
  });

  it("moves a document into a folder and relocates its file", async () => {
    let r = await newMaterial(ctx(), null, "document", "Beat Sheet");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    seedRef = { play: r.play, hash: r.hash };
    const noteId = r.createdId!;
    r = await moveItem(ctx(), noteId, "chars", Infinity);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const moved = r.play.binder
      .find((b) => b.id === "chars")!
      .children!.find((c) => c.id === noteId)!;
    expect(moved.path).toBe("Characters/Beat Sheet.md");
    expect(store.has("Characters/Beat Sheet.md")).toBe(true);
    expect(store.has("Notes/Beat Sheet.md")).toBe(false);
  });

  it("makes a folder WITHOUT creating a directory (create-on-demand, docs/app/keeping-work/storage-and-file-format.md#STOR-111)", async () => {
    // The app never scaffolds an empty directory. The row exists; the directory
    // appears when the first file lands in it, because every write creates its
    // parents.
    const r = await newFolder(ctx(), null, "Scenes");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.play.binder.some((b) => b.path === "Scenes")).toBe(true);
    expect(store.has("Scenes")).toBe(false);
    expect([...store.keys()].some((k) => k.startsWith("Scenes/"))).toBe(false);
  });

  it("creates a document as a genuinely empty file, in Notes", async () => {
    const res = await newMaterial(ctx(), null, "document", "Act two");
    expect(res.ok).toBe(true);
    // Zero bytes. No front matter, no heading — the writer's first keystroke is
    // the first byte in the file.
    expect(store.get("Notes/Act two.md")).toBe("");
  });

  it("creates a character sheet with its front-matter stub", async () => {
    const res = await newMaterial(ctx(), "chars", "character", "Jonah");
    expect(res.ok).toBe(true);
    const body = store.get("Characters/Jonah.md")!;
    expect(body).toContain("type: character");
    expect(body).not.toContain("## Want");
    // The name lives in the filename, once.
    expect(body).not.toContain("# Jonah");
  });

  it("puts a second script beside the first, not in a script/ folder", async () => {
    // There is no `script/` folder and no sub-project layer (docs/app/keeping-work/storage-and-file-format.md#STOR-D3).
    const res = await newScript(ctx(), null, "Parked bedroom");
    expect(res.ok).toBe(true);
    expect(store.has("Parked bedroom.fountain")).toBe(true);
    expect([...store.keys()].some((k) => k.startsWith("script/"))).toBe(false);
  });

  it("duplicates a file beside itself, with card records of its own", async () => {
    const res = await duplicateItem(ctx(), "script");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const copy = res.play.binder.find((b) => b.id === res.createdId)!;
    expect(titleOf(copy)).toBe("The Weight of Water copy");
    expect(store.has("The Weight of Water copy.fountain")).toBe(true);
    // Beside the original, not at the end.
    expect(res.play.binder.map((b) => b.id)).toEqual([
      "script",
      res.createdId!,
      "chars",
      "notes",
    ]);
    // Scene ids are unique to a script, so the copy starts with none of its
    // own rather than sharing the original's board.
    expect(res.play.scripts[res.createdId!]).toBeUndefined();
    // A folder has no byte-level copy behind it; better to refuse than to
    // half-copy a subtree.
    expect((await duplicateItem(ctx(), "chars")).ok).toBe(false);
  });

  it("deletes by trashing the file and dropping the entry", async () => {
    const res = await deleteItem(ctx(), "script");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.play.binder.map((b) => b.id)).toEqual(["chars", "notes"]);
    expect(store.has("The Weight of Water.fountain")).toBe(false);
  });

  it("drops a script's card records once its row is gone", async () => {
    // They are only reachable through the row, so an entry with no row is
    // unreachable by definition. Nothing prunes them while the row survives —
    // a script missing from disk keeps both (docs/app/keeping-work/storage-and-file-format.md#STOR-D8).
    const res = await deleteItem(ctx(), "script");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.play.scripts.script).toBeUndefined();
  });

  it("trashing a folder removes its whole subtree", async () => {
    const res = await deleteItem(ctx(), "chars");
    expect(res.ok).toBe(true);
    expect(store.has("Characters/Mara.md")).toBe(false);
  });

  it("deleting an empty folder just drops the row", async () => {
    const res = await deleteItem(ctx(), "notes");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.play.binder.map((b) => b.id)).toEqual(["script", "chars"]);
  });

  it("never writes a title into the play file (docs/app/keeping-work/storage-and-file-format.md#STOR-D5)", async () => {
    const r = await newMaterial(ctx(), "chars", "character", "Sophie");
    expect(r.ok).toBe(true);
    expect(store.get(PLAY_PATH)!).not.toContain('"title"');
  });
});

// docs/app/importing/document-import.md#IMPT-98
describe("an import added to the open play", () => {
  const kept = { name: "Tide.docx", base64: btoa("PK\u0003\u0004 the source") };
  const rowAt = (binder: PlayFile["binder"], path: string) =>
    binder.flatMap((it) => [it, ...(it.children ?? [])]).find((it) => it.path === path);

  it("a script lands at the play root, its source kept under Originals, and the binder is written last", async () => {
    const out = await importIntoPlay(ctx(), "script", "Tide", "Title: Tide\n\nMARA\nHello.\n", kept);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(store.get("Tide.fountain")).toBe("Title: Tide\n\nMARA\nHello.\n");
    expect(store.get("Originals/Tide.docx")).toBe("PK\u0003\u0004 the source");
    expect(out.play.binder.find((it) => it.id === out.createdId)).toMatchObject({ type: "script", path: "Tide.fountain" });
    const originals = out.play.binder.find((it) => it.type === "folder" && it.path === "Originals");
    expect(originals?.children).toEqual([expect.objectContaining({ type: "reference", path: "Originals/Tide.docx" })]);
    // Written through the guarded play-file writer: the manifest on disk says so too.
    expect(store.get(PLAY_PATH)).toContain("Originals/Tide.docx");
  });

  it("a refused play-file write leaves the new files unlisted, never a row that names nothing", async () => {
    refuseManifest = true;
    const before = store.get(PLAY_PATH);
    const out = await importIntoPlay(ctx(), "script", "Tide", "Title: Tide\n", kept);
    expect(out.ok).toBe(false);
    expect(store.get(PLAY_PATH)).toBe(before);
    // Written before the binder: the next reconcile files them where they lie.
    expect(store.has("Tide.fountain")).toBe(true);
    expect(store.has("Originals/Tide.docx")).toBe(true);
  });

  it("a document goes in Notes; nothing already there is written over", async () => {
    store.set("Notes/Tide.md", "the writer's own note\n");
    store.set("Originals/Tide.docx", "an earlier import\n");
    const out = await importIntoPlay(ctx(), "document", "Tide", "# Tide\n\nA note.\n", kept);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(store.get("Notes/Tide.md")).toBe("the writer's own note\n");
    expect(store.get("Notes/Tide 2.md")).toBe("# Tide\n\nA note.\n");
    expect(store.get("Originals/Tide.docx")).toBe("an earlier import\n");
    expect(store.get("Originals/Tide 2.docx")).toBe("PK\u0003\u0004 the source");
    const notes = out.play.binder.find((it) => it.id === "notes");
    expect(notes?.children?.map((c) => c.path)).toEqual(["Notes/Tide 2.md"]);
    expect(rowAt(out.play.binder, "Notes/Tide 2.md")?.type).toBe("document");
  });

  it("imported into a folder, a script or a document lands in that folder, at its end", async () => {
    const script = await importIntoPlay(ctx(), "script", "Tide", "Title: Tide\n", kept, "chars");
    expect(script.ok).toBe(true);
    if (!script.ok) return;
    expect(store.has("Characters/Tide.fountain")).toBe(true);
    expect(script.play.binder.find((it) => it.id === "chars")?.children?.map((c) => c.path)).toEqual(["Characters/Mara.md", "Characters/Tide.fountain"]);
    seedRef = { play: script.play, hash: script.hash };
    const doc = await importIntoPlay(ctx(), "document", "Tide", "Words.\n", kept, "chars");
    expect(doc.ok).toBe(true);
    if (!doc.ok) return;
    // A document filed among the characters is still a document, not a sheet.
    const kids = doc.play.binder.find((it) => it.id === "chars")?.children ?? [];
    expect(kids[kids.length - 1]).toMatchObject({ type: "document", path: "Characters/Tide.md" });
    expect(store.has("Originals/Tide 2.docx")).toBe(true);
  });

  it("a play without a Notes folder row gets one; a zipped Pages package keeps both extensions", async () => {
    seedRef.play.binder = seedRef.play.binder.filter((it) => it.id !== "notes");
    const out = await importIntoPlay(ctx(), "document", "Harbor", "Words.\n", { name: "Harbor.pages.zip", base64: btoa("PK") });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.play.binder.find((it) => it.type === "folder" && it.path === "Notes")?.children?.[0]?.path).toBe("Notes/Harbor.md");
    expect(store.has("Originals/Harbor.pages.zip")).toBe(true);
  });
});
