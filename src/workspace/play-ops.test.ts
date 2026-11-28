// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, mock } from "bun:test";

// An in-memory Plays folder with the Rust vault's rules: a create never
// writes over a file, a copy is byte for byte, a reserved folder is new.
// Bytes are kept one per character, as the dev vault keeps a binary file.
const store = new Map<string, string>();
const dirs = new Set<string>();
const written: string[] = [];
const hashOf = (s: string) =>
  "h" +
  s
    .split("")
    .reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)
    .toString(16) +
  s.length;
const latin1 = (s: string) => btoa(s);

function listOf(relDir: string) {
  const prefix = relDir ? relDir + "/" : "";
  const seen = new Map<string, boolean>();
  for (const key of [...store.keys(), ...dirs]) {
    if (!key.startsWith(prefix)) continue;
    const rest = key.slice(prefix.length);
    if (!rest) continue;
    const slash = rest.indexOf("/");
    if (slash === -1) seen.set(rest, seen.get(rest) ?? dirs.has(prefix + rest));
    else seen.set(rest.slice(0, slash), true);
  }
  return [...seen].map(([name, isDir]) => ({
    name,
    relPath: prefix + name,
    isDir,
    isSyncArtifact: false,
  }));
}

const vaultMock = {
  async list(relDir: string) {
    return listOf(relDir);
  },
  async read(rel: string) {
    if (!store.has(rel)) throw new Error("ENOENT " + rel);
    const content = store.get(rel)!;
    return { content, hash: hashOf(content) };
  },
  async readBinary(rel: string) {
    if (!store.has(rel)) throw new Error("ENOENT " + rel);
    return latin1(store.get(rel)!);
  },
  async write(rel: string, content: string, expected: string | null, rebasable = false) {
    const now = store.has(rel) ? hashOf(store.get(rel)!) : "";
    if (expected != null && now !== expected)
      return { status: rebasable ? ("stale" as const) : ("collision" as const), hash: now };
    store.set(rel, content);
    written.push(rel);
    return { status: "ok" as const, hash: hashOf(content) };
  },
  async create(rel: string, content: string) {
    const out = await vaultMock.write(rel, content, "");
    if (out.status !== "ok") throw new Error(`${rel} is already there`);
    return out.hash;
  },
  async createBinary(rel: string, base64: string) {
    return vaultMock.create(rel, atob(base64));
  },
  async copyFile(from: string, to: string) {
    if (!store.has(from)) throw new Error("ENOENT " + from);
    await vaultMock.create(to, store.get(from)!);
  },
  async reserveDir(name: string) {
    if (listOf("").some((e) => e.name.toLowerCase() === name.toLowerCase()))
      throw new Error("The destination already exists");
    dirs.add(name);
  },
  async rename(from: string, to: string) {
    if (from !== to && from.toLowerCase() !== to.toLowerCase() && (store.has(to) || dirs.has(to)))
      throw new Error("Something is already at that name, so nothing was moved.");
    for (const key of [...store.keys()]) {
      if (key === from || key.startsWith(from + "/")) {
        const value = store.get(key)!;
        store.delete(key);
        store.set(to + key.slice(from.length), value);
      }
    }
    for (const dir of [...dirs]) {
      if (dir === from || dir.startsWith(from + "/")) {
        dirs.delete(dir);
        dirs.add(to + dir.slice(from.length));
      }
    }
  },
};

mock.module("../storage", () => ({
  vault: vaultMock,
  formats: { listUser: async () => [] },
}));

const {
  addZippedPlay,
  duplicatePlay,
  mainScript,
  newPlayLike,
  playFiles,
  playZip,
  PlayNameTaken,
  readZippedPlay,
  renamePlay,
  sameTitle,
  scriptToFollow,
  titleFacts,
  withTitle,
} = await import("./play-ops");
const { serializePlay } = await import("./play-file");
type PlayFile = import("./play-file").PlayFile;

const NOW = "2026-11-26T12:00:00.000Z";
const PNG = String.fromCharCode(137, 80, 78, 71, 0, 255, 128, 10);

function seedPlay(name: string, extra: Partial<PlayFile> = {}): PlayFile {
  const play: PlayFile = {
    kind: "proscenium/play",
    schemaVersion: 1,
    id: "01PLAYIDPLAYIDPLAYIDPLAYID",
    status: "drafting",
    logline: "A family entertains badly.",
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-02-01T00:00:00.000Z",
    generator: { app: "Proscenium", version: "1.0.0" },
    settings: { format: "dg-modern", language: "en-GB", sceneAnchors: "manifest" },
    binder: [
      {
        id: "FRONT",
        type: "folder",
        path: "Front Matter",
        children: [{ id: "TP", type: "document", path: "Front Matter/Title Page.md" }],
      },
      { id: "SCRIPT", type: "script", path: `${name}.fountain` },
      {
        id: "CHARS",
        type: "folder",
        path: "Characters",
        children: [{ id: "JUDITH", type: "character", path: "Characters/Judith.md" }],
      },
      { id: "PIC", type: "reference", path: "Set.png" },
    ],
    scripts: {
      SCRIPT: {
        scenes: [
          {
            id: "SCENE1",
            anchor: { ordinal: 0, headingHash: "x", embeddedId: null },
            card: { color: "oxide", status: "", label: "", boardNote: "" },
          },
        ],
        orphans: [],
        frontMatter: { folder: "FRONT" },
      },
    },
    ...extra,
  };
  store.set(`${name}/${name}.fountain`, SCRIPT(name));
  store.set(`${name}/Front Matter/Title Page.md`, "# {TITLE}\n");
  store.set(`${name}/Characters/Judith.md`, "Judith Bliss, an actress.\n");
  store.set(`${name}/Set.png`, PNG);
  store.set(`${name}/.DS_Store`, "junk");
  store.set(`${name}/${name}.proscenium`, serializePlay(play));
  return play;
}

const SCRIPT = (title: string) =>
  `Title: ${title}\nCredit: a play by\nAuthor: Noël Coward\nDraft date: 1 March 1925\nContact:\n    The Bliss house\n    Cookham\n\n# ACT ONE\n\n## Scene 1\n\nJUDITH\nI shall go on the stage again.\n`;

const playIn = (dir: string): PlayFile => JSON.parse(store.get(`${dir}/${dir}.proscenium`)!);

beforeEach(() => {
  store.clear();
  dirs.clear();
  written.length = 0;
});

describe("a title page's title (docs/app/keeping-work/storage-and-file-format.md#STOR-208)", () => {
  it("changes the title line alone and keeps every other key as written", () => {
    const out = withTitle(SCRIPT("Hay Fever"), "Spring Cleaning");
    expect(out).toBe(SCRIPT("Spring Cleaning"));
  });

  it("replaces a title written over several lines with one", () => {
    const source = "Title:\n    _HAY_\n    FEVER\nCredit: by\n\nBody\n";
    expect(withTitle(source, "Hay Fever")).toBe("Title: Hay Fever\nCredit: by\n\nBody\n");
  });

  it("takes off the keys it is asked to, with their indented lines", () => {
    const out = withTitle(SCRIPT("Hay Fever"), "New", ["draft date", "contact"]);
    expect(out).toBe(
      "Title: New\nCredit: a play by\nAuthor: Noël Coward\n\n# ACT ONE\n\n## Scene 1\n\nJUDITH\nI shall go on the stage again.\n",
    );
  });

  it("gives a script with no title page one holding the title", () => {
    expect(withTitle("# ACT ONE\n", "Hay Fever")).toBe("Title: Hay Fever\n\n# ACT ONE\n");
  });

  it("keeps a script's line endings", () => {
    expect(withTitle("Title: A\r\nCredit: by\r\n\r\nBody", "B")).toBe(
      "Title: B\r\nCredit: by\r\n\r\nBody",
    );
  });

  it("reads two titles as the same when only emphasis, spacing and case differ", () => {
    expect(sameTitle("_HAY  FEVER_", "Hay Fever")).toBe(true);
    expect(sameTitle("Hay Fever (old)", "Hay Fever")).toBe(false);
    expect(sameTitle(undefined, "Hay Fever")).toBe(false);
  });
});

describe("Duplicate Play (docs/app/keeping-work/storage-and-file-format.md#STOR-197)", () => {
  it("copies every file byte for byte into a new play with an id of its own, and leaves the original", async () => {
    seedPlay("Hay Fever");
    const before = new Map(store);
    const dir = await duplicatePlay("Hay Fever", "Hay Fever copy", NOW);
    expect(dir).toBe("Hay Fever copy");
    for (const [key, value] of before) expect(store.get(key)).toBe(value);
    expect(store.get("Hay Fever copy/Set.png")).toBe(PNG);
    expect(store.get("Hay Fever copy/Characters/Judith.md")).toBe("Judith Bliss, an actress.\n");
    expect(store.get("Hay Fever copy/Front Matter/Title Page.md")).toBe("# {TITLE}\n");
    expect(store.has("Hay Fever copy/.DS_Store")).toBe(false);
    const copy = playIn("Hay Fever copy");
    expect(copy.id).not.toBe("01PLAYIDPLAYIDPLAYIDPLAYID");
    expect(copy.created).toBe(NOW);
    expect(copy.logline).toBe("A family entertains badly.");
    expect(copy.scripts.SCRIPT.scenes[0].card.color).toBe("oxide");
  });

  it("names the copy's script for the copy, and keeps the words of its title page", async () => {
    seedPlay("Hay Fever");
    await duplicatePlay("Hay Fever", "Hay Fever, Chicago", NOW);
    expect(store.get("Hay Fever, Chicago/Hay Fever, Chicago.fountain")).toBe(SCRIPT("Hay Fever"));
    expect(store.has("Hay Fever, Chicago/Hay Fever.fountain")).toBe(false);
    const copy = playIn("Hay Fever, Chicago");
    expect(mainScript(copy.binder)?.path).toBe("Hay Fever, Chicago.fountain");
  });

  it("writes the play file last, so a copy that stops is never a play", async () => {
    seedPlay("Hay Fever");
    await duplicatePlay("Hay Fever", "Copy", NOW);
    const mine = written.filter((rel) => rel.startsWith("Copy/"));
    expect(mine[mine.length - 1]).toBe("Copy/Copy.proscenium");
  });

  it("refuses a name the Plays folder already has, as the disk compares names", async () => {
    seedPlay("Hay Fever");
    seedPlay("Fallen Angels");
    await expect(duplicatePlay("Hay Fever", "fallen angels", NOW)).rejects.toBeInstanceOf(
      PlayNameTaken,
    );
    expect(
      listOf("")
        .map((e) => e.name)
        .sort(),
    ).toEqual(["Fallen Angels", "Hay Fever"]);
  });

  it("takes no name from an empty field", async () => {
    seedPlay("Hay Fever");
    await expect(duplicatePlay("Hay Fever", "   ", NOW)).rejects.toThrow(/Give the copy a name/);
    expect(dirs.size).toBe(0);
  });

  it("refuses a play from a newer Proscenium and copies nothing", async () => {
    seedPlay("Hay Fever", { schemaVersion: 99 });
    await expect(duplicatePlay("Hay Fever", "Copy", NOW)).rejects.toThrow(/newer Proscenium/);
    expect(dirs.has("Copy")).toBe(false);
  });
});

describe("Rename Play (docs/app/keeping-work/storage-and-file-format.md#STOR-208)", () => {
  it("renames the folder and the play file together, and says the script follows", async () => {
    seedPlay("Untitled Play");
    const dir = await renamePlay("Untitled Play", "Hay Fever", { title: false }, NOW);
    expect(dir).toBe("Hay Fever");
    expect(store.has("Hay Fever/Hay Fever.proscenium")).toBe(true);
    expect(store.has("Untitled Play/Untitled Play.proscenium")).toBe(false);
    const play = playIn("Hay Fever");
    expect(play.renamedFrom).toBe("Untitled Play");
    expect(scriptToFollow(play, "Hay Fever")).toEqual({ id: "SCRIPT", from: "Untitled Play" });
    // The title page is the writer's until they say so.
    expect(store.get("Hay Fever/Untitled Play.fountain")).toBe(SCRIPT("Untitled Play"));
  });

  it("puts the new name on the title page when asked", async () => {
    seedPlay("Untitled Play");
    await renamePlay("Untitled Play", "Hay Fever", { title: true }, NOW);
    expect(store.get("Hay Fever/Untitled Play.fountain")).toBe(SCRIPT("Hay Fever"));
  });

  it("keeps the oldest name the script carries through two renames, and clears it on the way back", async () => {
    seedPlay("A");
    await renamePlay("A", "B", { title: false }, NOW);
    await renamePlay("B", "C", { title: false }, NOW);
    expect(playIn("C").renamedFrom).toBe("A");
    await renamePlay("C", "A", { title: false }, NOW);
    expect(playIn("A").renamedFrom).toBeUndefined();
  });

  it("changes only the case of a name", async () => {
    seedPlay("hay fever");
    const dir = await renamePlay("hay fever", "Hay Fever", { title: false }, NOW);
    expect(dir).toBe("Hay Fever");
    expect(store.has("Hay Fever/Hay Fever.proscenium")).toBe(true);
  });

  it("refuses a name another play has, and moves nothing", async () => {
    seedPlay("Hay Fever");
    seedPlay("Fallen Angels");
    await expect(renamePlay("Hay Fever", "Fallen Angels", { title: false }, NOW)).rejects.toThrow(
      /already in your Plays folder/,
    );
    expect(store.has("Hay Fever/Hay Fever.proscenium")).toBe(true);
  });

  it("reads whether the title page shows the play's name", async () => {
    seedPlay("Hay Fever");
    expect(await titleFacts("Hay Fever", "Hay Fever.proscenium", "Hay Fever")).toEqual({
      title: "Hay Fever",
      isName: true,
    });
    expect((await titleFacts("Hay Fever", "Hay Fever.proscenium", "Other")).isName).toBe(false);
  });

  it("leaves no script to follow when another file has the play's name", () => {
    const play = {
      renamedFrom: "Old",
      binder: [
        { id: "S", type: "script", path: "Old.fountain" },
        { id: "T", type: "script", path: "New.fountain" },
      ],
    } as unknown as PlayFile;
    expect(scriptToFollow(play, "New")).toBeNull();
  });
});

describe("New Play Like This (docs/app/keeping-work/storage-and-file-format.md#STOR-198)", () => {
  it("keeps the setup and none of the writing", async () => {
    seedPlay("Hay Fever");
    const dir = await newPlayLike("Hay Fever", "Present Laughter", NOW, "idea");
    const play = playIn(dir);
    expect(play.id).not.toBe("01PLAYIDPLAYIDPLAYIDPLAYID");
    expect(play.status).toBe("idea");
    expect(play.logline).toBeUndefined();
    expect(play.settings).toEqual({
      format: "dg-modern",
      language: "en-GB",
      sceneAnchors: "manifest",
    });
    // Its pages, as they are; its folders, empty; no character sheets, no image.
    expect(store.get("Present Laughter/Front Matter/Title Page.md")).toBe("# {TITLE}\n");
    expect(store.has("Present Laughter/Characters/Judith.md")).toBe(false);
    expect(store.has("Present Laughter/Set.png")).toBe(false);
    const chars = play.binder.find((i) => i.path === "Characters");
    expect(chars?.children).toEqual([]);
    expect(chars?.id).not.toBe("CHARS");
    // The script: the old title page with the new title and no date, then a first scene.
    const script = mainScript(play.binder)!;
    expect(script.path).toBe("Present Laughter.fountain");
    expect(store.get(`Present Laughter/${script.path}`)).toBe(
      "Title: Present Laughter\nCredit: a play by\nAuthor: Noël Coward\nContact:\n    The Bliss house\n    Cookham\n\n# ACT ONE\n\n## Scene 1\n\nA bare stage.\n",
    );
    // The script still claims its pages, under their new ids.
    const front = play.binder.find((i) => i.path === "Front Matter")!;
    expect(play.scripts[script.id]).toEqual({
      scenes: [],
      orphans: [],
      frontMatter: { folder: front.id },
    });
    expect(front.children?.[0].id).not.toBe("TP");
  });

  it("leaves out a page whose file is gone, instead of stopping", async () => {
    seedPlay("Hay Fever");
    store.delete("Hay Fever/Front Matter/Title Page.md");
    const play = playIn(await newPlayLike("Hay Fever", "New", NOW, null));
    expect(play.binder.find((i) => i.path === "Front Matter")?.children).toEqual([]);
  });
});

describe("a play as one .zip (docs/app/keeping-work/storage-and-file-format.md#STOR-199, docs/app/keeping-work/storage-and-file-format.md#STOR-200)", () => {
  it("holds every file of the play under the play's folder, and comes back byte for byte", async () => {
    seedPlay("Hay Fever");
    const files = await playFiles("Hay Fever");
    expect(files).not.toContain(".DS_Store");
    const zip = await playZip("Hay Fever", "Hay Fever");
    const zipped = await readZippedPlay(zip);
    expect(zipped?.folder).toBe("Hay Fever");
    expect(zipped?.playFile).toBe("Hay Fever.proscenium");
    expect([...zipped!.files.keys()].sort()).toEqual(files);

    // Into a Plays folder that already has it: a name of its own and an id of its own.
    const dir = await addZippedPlay(zipped!, new Set(["01PLAYIDPLAYIDPLAYIDPLAYID"]));
    expect(dir).toBe("Hay Fever 2");
    expect(store.get("Hay Fever 2/Set.png")).toBe(PNG);
    expect(store.get("Hay Fever 2/Hay Fever.fountain")).toBe(SCRIPT("Hay Fever"));
    expect(playIn("Hay Fever 2").id).not.toBe("01PLAYIDPLAYIDPLAYIDPLAYID");
    const mine = written.filter((r) => r.startsWith("Hay Fever 2/"));
    expect(mine[mine.length - 1]).toBe("Hay Fever 2/Hay Fever 2.proscenium");
  });

  it("keeps the play's id where no play has it", async () => {
    seedPlay("Hay Fever");
    const zipped = await readZippedPlay(await playZip("Hay Fever", "Hay Fever"));
    store.clear();
    dirs.clear();
    const dir = await addZippedPlay(zipped!, new Set());
    expect(dir).toBe("Hay Fever");
    expect(playIn("Hay Fever").id).toBe("01PLAYIDPLAYIDPLAYIDPLAYID");
  });

  it("finds a play whose files are at the top of the .zip, and none in a .zip of something else", async () => {
    const { zipSync, strToU8 } = await import("fflate");
    seedPlay("Hay Fever");
    const loose = zipSync({
      "Hay Fever.proscenium": strToU8(store.get("Hay Fever/Hay Fever.proscenium")!),
      "Hay Fever.fountain": strToU8("Title: Hay Fever\n"),
      "__MACOSX/._Hay Fever.fountain": strToU8("x"),
    });
    const found = await readZippedPlay(loose);
    expect(found?.folder).toBe("Hay Fever");
    expect([...found!.files.keys()].sort()).toEqual(["Hay Fever.fountain", "Hay Fever.proscenium"]);
    expect(await readZippedPlay(zipSync({ "notes/a.txt": strToU8("a") }))).toBeNull();
  });

  it("refuses a .zip that names a file outside its folder", async () => {
    const { zipSync, strToU8 } = await import("fflate");
    const bad = zipSync({
      "Play/../../escape.txt": strToU8("x"),
      "Play/Play.proscenium": strToU8("{}"),
    });
    await expect(readZippedPlay(bad)).rejects.toThrow(/outside its own folder/);
  });
});
