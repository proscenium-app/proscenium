// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, mock } from "bun:test";

// In-memory vault mirroring the Rust guarded-write semantics, rooted at the
// PLAYS FOLDER: its children that hold a `.proscenium` file are the plays.
const store = new Map<string, string>();
const hashOf = (s: string) =>
  "sha256:" +
  s.length +
  "-" +
  s
    .split("")
    .reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 0)
    .toString(16);
const mtimes = new Map<string, number>();
/** Folders whose listing fails, as one the App Sandbox has not granted does. */
const unlistable = new Set<string>();
/** Every folder listed, in order — to see what a scan cost. */
const listed: string[] = [];
const unreadable = new Set<string>();

function listOf(relDir: string) {
  const prefix = relDir && relDir !== "." ? relDir + "/" : "";
  const seen = new Map<string, boolean>();
  for (const key of store.keys()) {
    if (!key.startsWith(prefix)) continue;
    const rest = key.slice(prefix.length);
    if (!rest) continue;
    const slash = rest.indexOf("/");
    if (slash === -1) seen.set(rest, false);
    else seen.set(rest.slice(0, slash), true);
  }
  return [...seen].map(([name, isDir]) => ({
    name,
    relPath: prefix + name,
    isDir,
    isSyncArtifact: false,
    modifiedMs: mtimes.get(prefix + name),
  }));
}

const vaultMock = {
  async read(rel: string) {
    if (unreadable.has(rel)) throw new Error("EACCES " + rel);
    if (!store.has(rel)) throw new Error("ENOENT " + rel);
    const content = store.get(rel)!;
    return { content, hash: hashOf(content) };
  },
  async write(rel: string, content: string, expected: string | null, rebasable = false) {
    if (expected != null && store.has(rel) && hashOf(store.get(rel)!) !== expected) {
      const hash = hashOf(store.get(rel)!);
      return { status: rebasable ? ("stale" as const) : ("collision" as const), hash };
    }
    store.set(rel, content);
    return { status: "ok" as const, hash: hashOf(content) };
  },
  async list(relDir: string) {
    listed.push(relDir);
    if (unlistable.has(relDir)) throw new Error(`Operation not permitted: ${relDir}`);
    return listOf(relDir);
  },
  async exists(rel: string) {
    return store.has(rel);
  },
  // ipc.ts `vault.create`: a guarded write expecting a hash no file has.
  async create(rel: string, content: string) {
    const out = await vaultMock.write(rel, content, "");
    if (out.status !== "ok") throw new Error(`${rel} is already there`);
    return out.hash;
  },
  async createBinary(rel: string, base64: string) {
    return vaultMock.create(rel, atob(base64));
  },
};

// `vault-plays` reaches `../format` for the default format id, and that module
// reads user format files through the storage barrel — so the mock has to
// answer for it too, or the import graph fails before a single test runs.
mock.module("../storage", () => ({
  vault: vaultMock,
  formats: { listUser: async () => [] },
}));

const {
  discoverPlays,
  discoverPlaysBelow,
  LOOK_BELOW,
  scaffoldPlayAt,
  scaffoldPlayInVault,
  updatePlayMeta,
} = await import("./vault-plays");
// `resolvePlayFile` lists the OPEN PLAY's folder, which is a different vault
// scope from the Plays folder this store models. Its decision is `choosePlayFile`,
// which is pure — so that is what is exercised here.
const { choosePlayFile, readPlayFile } = await import("./play-file");

const NOW = "2026-07-20T18:00:00.000Z";

it("imports keep the exact source before publishing the play file", async () => {
  const binary = String.fromCharCode(0, 255, 128, 13, 10);
  const { dir } = await scaffoldPlayInVault("Imported", NOW, "# ACT ONE\n", undefined, null, {
    name: "Draft.docx",
    base64: btoa(binary),
  });
  expect(store.get(`${dir}/Originals/Draft.docx`)).toBe(binary);
  const order = [...store.keys()];
  expect(order.indexOf(`${dir}/Originals/Draft.docx`)).toBeLessThan(
    order.indexOf(`${dir}/${dir}.proscenium`),
  );
});

it("a failed source copy does not publish a partial play or overwrite the source", async () => {
  store.set("Incomplete/Originals/Draft.docx", "already there");
  await expect(
    scaffoldPlayAt("Incomplete", "Incomplete", NOW, "# ACT ONE\n", undefined, null, {
      name: "Draft.docx",
      base64: btoa("new"),
    }),
  ).rejects.toThrow("already there");
  expect(store.get("Incomplete/Originals/Draft.docx")).toBe("already there");
  expect(store.has("Incomplete/Incomplete.proscenium")).toBe(false);
});

/** A play at `dir`, which may be a folder inside a folder of the Plays folder. */
function seedPlay(
  dir: string,
  opts: { file?: string; extra?: Record<string, unknown>; scenes?: number } = {},
): void {
  const name = dir.slice(dir.lastIndexOf("/") + 1);
  const file = opts.file ?? `${name}.proscenium`;
  const scenes = Array.from({ length: opts.scenes ?? 0 }, (_, i) => ({
    id: `sc${i}`,
    anchor: { ordinal: i, headingHash: "h", embeddedId: null },
    card: { color: "cream", status: i === 0 ? "locked" : "draft", label: "", boardNote: "" },
  }));
  store.set(
    `${dir}/${file}`,
    JSON.stringify({
      kind: "proscenium/play",
      schemaVersion: 1,
      id: "01ABC",
      created: "2026-06-18T00:00:00Z",
      modified: "2026-06-18T00:00:00Z",
      generator: { app: "Proscenium", version: "1.0.0" },
      settings: {},
      binder: [{ id: "S1", type: "script", path: `${name}.fountain` }],
      scripts: { S1: { scenes, orphans: [] } },
      ...(opts.extra ?? {}),
    }),
  );
  store.set(`${dir}/${name}.fountain`, "# ACT ONE\n");
}

beforeEach(() => {
  store.clear();
  unreadable.clear();
  mtimes.clear();
  unlistable.clear();
  listed.length = 0;
});

describe("discovery (docs/app/keeping-work/storage-and-file-format.md#STOR-D2, docs/app/keeping-work/storage-and-file-format.md#STOR-D3)", () => {
  it("a directory is a play iff it holds a .proscenium file", async () => {
    seedPlay("Low Tide");
    store.set("dramaturgy/notes.md", "not a play");
    store.set("README.md", "not even a directory");

    const plays = await discoverPlays();
    expect(plays.map((p) => p.dir)).toEqual(["Low Tide"]);
  });

  it("takes the play's name from its folder — never from a field", async () => {
    // The filename IS the title (docs/app/keeping-work/storage-and-file-format.md#STOR-D4), and there is no `title` key in
    // the file to disagree with it.
    seedPlay("The Weight of Water", { extra: { title: "SOMETHING ELSE" } });
    const [play] = await discoverPlays();
    expect(play.title).toBe("The Weight of Water");
  });

  it("reads status and logline off the play file, and where its first script is", async () => {
    seedPlay("Second Act", { extra: { status: "revising", logline: "A pitch." }, scenes: 3 });
    const [play] = await discoverPlays();
    expect(play.status).toBe("revising");
    expect(play.logline).toBe("A pitch.");
    // Progress counts this script's pages (docs/app/keeping-work/storage-and-file-format.md#STOR-121); the card counts are gone.
    expect(play.script).toBe("Second Act/Second Act.fountain");
    expect("scenes" in play || "locked" in play).toBe(false);
  });

  it("keeps the script's own modified time for its page count, only when the filesystem says", async () => {
    seedPlay("Harbour Lights");
    seedPlay("Second Act");
    mtimes.set("Second Act/Second Act.fountain", Date.parse("2026-07-24T23:00:00Z"));
    const plays = await discoverPlays();
    expect(plays.find((p) => p.dir === "Second Act")?.scriptModified).toBe(
      "2026-07-24T23:00:00.000Z",
    );
    expect(plays.find((p) => p.dir === "Harbour Lights")?.scriptModified).toBeUndefined();
  });

  it("keeps malformed extension-discovered plays visible (docs/app/keeping-work/storage-and-file-format.md#STOR-107)", async () => {
    seedPlay("Good");
    store.set("Broken/Broken.proscenium", "{ not json");
    store.set("Wrong/Wrong.proscenium", JSON.stringify({ kind: "something/else" }));

    const plays = await discoverPlays();
    expect(plays.map((p) => p.dir).sort()).toEqual(["Broken", "Good", "Wrong"]);
    expect(plays.find((p) => p.dir === "Broken")?.problem).toBe("malformed");
    expect(await readPlayFile("Broken/Broken.proscenium")).toMatchObject({
      status: "malformed",
      raw: "{ not json",
    });
  });

  it("docs/app/keeping-work/storage-and-file-format.md#STOR-57: tells missing, unreadable, malformed and unsupported files apart", async () => {
    expect((await readPlayFile("Absent.proscenium")).status).toBe("absent");
    seedPlay("Unavailable");
    unreadable.add("Unavailable/Unavailable.proscenium");
    expect((await readPlayFile("Unavailable/Unavailable.proscenium")).status).toBe("unreadable");
    expect((await discoverPlays())[0].problem).toBe("unreadable");
    seedPlay("Future", { extra: { schemaVersion: 99 } });
    expect((await readPlayFile("Future/Future.proscenium")).status).toBe("unsupported");
    expect(await updatePlayMeta("Future", "Future.proscenium", { logline: "overwrite" }, NOW)).toBe(
      false,
    );
  });

  it("docs/app/keeping-work/storage-and-file-format.md#STOR-57: validates nested records without dropping the original bytes", async () => {
    for (const extra of [
      { binder: [null] },
      { scripts: { S1: { scenes: [null], orphans: [] } } },
      { scripts: [] },
      { settings: null },
      { binder: [{ id: "S1", type: "folder", path: "Notes", children: [null] }] },
    ]) {
      seedPlay("Broken", { extra });
      const raw = store.get("Broken/Broken.proscenium")!;
      expect(await readPlayFile("Broken/Broken.proscenium")).toMatchObject({
        status: "malformed",
        raw,
      });
      expect((await discoverPlays())[0].dir).toBe("Broken");
      expect(
        await updatePlayMeta("Broken", "Broken.proscenium", { logline: "overwrite" }, NOW),
      ).toBe(false);
      expect(store.get("Broken/Broken.proscenium")).toBe(raw);
    }
  });

  it("adopts a play file renamed in Finder, and says what it found", async () => {
    // Discovery is by EXTENSION, so a folder renamed underneath the app still
    // lists; the app renames the file to match on open (docs/app/keeping-work/storage-and-file-format.md#STOR-35).
    seedPlay("New Name", { file: "Old Name.proscenium" });
    const [play] = await discoverPlays();
    expect(play.dir).toBe("New Name");
    expect(play.file).toBe("Old Name.proscenium");
  });

  it("prefers the file named for the folder when several exist", () => {
    // A sync duplicate (`<Play> 2.proscenium`) is another version of the play
    // file, never the play (docs/app/keeping-work/storage-and-file-format.md#STOR-D5).
    expect(
      choosePlayFile("Second Act", ["Second Act 2.proscenium", "Second Act.proscenium", "x.md"]),
    ).toBe("Second Act.proscenium");
    // No exact match: the single remaining one is adopted (a Finder rename).
    expect(choosePlayFile("New Name", ["Old Name.proscenium"])).toBe("Old Name.proscenium");
    // Not a play at all.
    expect(choosePlayFile("Nothing", ["notes.md"])).toBeNull();
  });
});

describe("plays one folder down (docs/app/keeping-work/storage-and-file-format.md#STOR-D12)", () => {
  /**
   * The Plays folder was chosen one level too high: the real one is a folder
   * inside it. Looking below uses the Plays screen's own rule, so a folder it
   * points to is a folder that will list plays once it is open.
   */
  it("finds the folder the plays are in when the Plays folder holds none", async () => {
    seedPlay("Plays/Low Tide");
    seedPlay("Plays/Second Act");
    seedPlay("Plays/The Long Field");
    seedPlay("Plays/Harbour Lights");
    store.set("Research/tide-tables.md", "not a play");
    store.set("notes.md", "not a folder");

    expect(await discoverPlays()).toEqual([]);
    expect(await discoverPlaysBelow()).toEqual([{ dir: "Plays", plays: 4 }]);
  });

  it("counts only what the Plays screen would list, and only one folder down", async () => {
    seedPlay("Drafts/Good");
    store.set("Drafts/Broken/Broken.proscenium", "{ not json");
    store.set("Drafts/.Hidden/Hidden.proscenium", JSON.stringify({ kind: "proscenium/play" }));
    seedPlay("Archive/2019/Old Play");
    // A play file renamed in Finder still makes its folder a play (docs/app/keeping-work/storage-and-file-format.md#STOR-D4).
    seedPlay("Shelf/New Name", { file: "Old Name.proscenium" });

    expect(await discoverPlaysBelow()).toEqual([
      { dir: "Drafts", plays: 2 }, // the malformed play remains discoverable too
      { dir: "Shelf", plays: 1 },
    ]);
  });

  it("reads the play file named for the play's own folder, not for the path to it", async () => {
    // A broken sync duplicate sorts first. Naming the play by its path
    // ("Plays/Second Act") matched neither file and took the duplicate.
    seedPlay("Plays/Second Act");
    store.set("Plays/Second Act/Second Act 2.proscenium", "{ truncated");
    expect(await discoverPlaysBelow()).toEqual([{ dir: "Plays", plays: 1 }]);
  });

  it("passes over a folder it cannot list, and never throws", async () => {
    seedPlay("Plays/Second Act");
    store.set("Locked/Secret/Secret.proscenium", "{}");
    seedPlay("Shared/Harbour Lights");
    unlistable.add("Locked");
    unlistable.add("Shared/Harbour Lights");
    expect(await discoverPlaysBelow()).toEqual([{ dir: "Plays", plays: 1 }]);

    unlistable.add("");
    expect(await discoverPlaysBelow()).toEqual([]);
  });

  it("looks into small folders first and stops at its budget", async () => {
    for (let i = 0; i < 40; i++) store.set(`Photos/Album ${i}/IMG_${i}.jpg`, "jpeg");
    seedPlay("Writing/Second Act");
    seedPlay("Writing/Harbour Lights");

    // Two listings to size both folders, two for Writing's plays: Photos'
    // forty never fit, and are never listed.
    expect(await discoverPlaysBelow(10)).toEqual([{ dir: "Writing", plays: 2 }]);
    expect(listed.some((d) => d.startsWith("Photos/"))).toBe(false);
    expect(LOOK_BELOW).toBeGreaterThan(10);
  });

  it("sizes only as many folders as the budget holds", async () => {
    for (const name of ["A", "B", "C", "D"]) seedPlay(`${name}/Play ${name}`);
    // Three listings: all three spent on sizing A, B and C, none left to look
    // into them, and D is never listed at all.
    expect(await discoverPlaysBelow(3)).toEqual([]);
    expect(listed).toEqual(["", "A", "B", "C"]);
  });
});

describe("updatePlayMeta", () => {
  it("sets status + logline and bumps modified, canonically", async () => {
    seedPlay("wow");
    const ok = await updatePlayMeta(
      "wow",
      "wow.proscenium",
      { status: "drafting", logline: "A play about water." },
      NOW,
    );
    expect(ok).toBe(true);
    const saved = JSON.parse(store.get("wow/wow.proscenium")!);
    expect(saved.status).toBe("drafting");
    expect(saved.logline).toBe("A play about water.");
    expect(saved.modified).toBe(NOW);
    // Canonical key order, so two devices writing the same change agree byte
    // for byte (docs/app/keeping-work/storage-and-file-format.md#STOR-D5).
    expect(store.get("wow/wow.proscenium")!.startsWith('{\n  "kind": "proscenium/play",')).toBe(
      true,
    );
  });

  it("only touches the fields in the patch", async () => {
    seedPlay("wow", { extra: { status: "drafting" } });
    await updatePlayMeta("wow", "wow.proscenium", { logline: "new pitch" }, NOW);
    const saved = JSON.parse(store.get("wow/wow.proscenium")!);
    expect(saved.status).toBe("drafting"); // untouched
    expect(saved.logline).toBe("new pitch");
  });

  it("clears a field set to the empty string", async () => {
    seedPlay("wow", { extra: { status: "drafting", logline: "old" } });
    await updatePlayMeta("wow", "wow.proscenium", { logline: "" }, NOW);
    expect(JSON.parse(store.get("wow/wow.proscenium")!).logline).toBeUndefined();
  });

  it("refuses a file that is not a play file", async () => {
    store.set("notplay/notplay.proscenium", JSON.stringify({ kind: "something-else" }));
    expect(await updatePlayMeta("notplay", "notplay.proscenium", { status: "x" }, NOW)).toBe(false);
  });

  it("returns false when the play file is missing", async () => {
    expect(await updatePlayMeta("ghost", "ghost.proscenium", { status: "x" }, NOW)).toBe(false);
  });
});

describe("the MODIFIED column means when the play was written", () => {
  /**
   * The rule, and why each half of it is load-bearing:
   * the script FILE's own mtime wins, and the play file's `modified` is a
   * fallback only. Both failures were measured on a real vault — a play
   * whose script was written four days after the row said, and two whose rows
   * were up to ten days NEWER than any writing because a manifest edit moved
   * the stamp.
   *
   * Since 1.0 the play file's `modified` deliberately does not move while the
   * writer types (docs/app/keeping-work/storage-and-file-format.md#STOR-D5), which makes it an even worse answer to "when
   * did I last write in this play" — and a very good one to "when did the
   * cards last change".
   */
  it("prefers the script file's mtime over the play file's stamp", async () => {
    seedPlay("Second Act");
    mtimes.set("Second Act/Second Act.fountain", Date.parse("2026-07-24T23:00:00Z"));
    const [play] = await discoverPlays();
    expect(play.modified).toBe("2026-07-24T23:00:00.000Z");
  });

  it("falls back to the play file only when the filesystem will not say", async () => {
    seedPlay("Harbour Lights");
    const [play] = await discoverPlays();
    expect(play.modified).toBe("2026-06-18T00:00:00Z");
  });

  it("lists most recently written first", async () => {
    seedPlay("Older");
    seedPlay("Newer");
    mtimes.set("Older/Older.fountain", Date.parse("2026-07-01T00:00:00Z"));
    mtimes.set("Newer/Newer.fountain", Date.parse("2026-08-01T00:00:00Z"));
    expect((await discoverPlays()).map((p) => p.dir)).toEqual(["Newer", "Older"]);
  });
});

describe("a new play (docs/app/keeping-work/storage-and-file-format.md#STOR-D3)", () => {
  it("never writes over a play that is already there", async () => {
    seedPlay("Lear");
    const before = new Map(store);
    await expect(scaffoldPlayAt("Lear", "Lear", NOW, "Title: Another Lear\n")).rejects.toThrow();
    expect(store).toEqual(before);
  });

  it("takes the next name past a folder the disk lists decomposed", async () => {
    const decomposed = "Pi\u00e8ce".normalize("NFD");
    seedPlay(decomposed);
    const before = new Map(store);
    const made = await scaffoldPlayInVault("Pi\u00e8ce".normalize("NFC"), NOW, "Title: Pièce\n");
    expect(made.dir).toBe(`${"Pi\u00e8ce".normalize("NFC")} 2`);
    for (const [key, value] of before) expect(store.get(key)).toBe(value);
  });

  it("starts in the format new plays are set to, and discovery reads it back (T3b)", async () => {
    const made = await scaffoldPlayInVault("House Style", NOW, "Title: House Style\n", "my-house");
    const plays = await discoverPlays();
    expect(plays.find((p) => p.dir === made.dir)?.format).toBe("my-house");
    // Without a choice, the app's default, as before.
    const plain = await scaffoldPlayInVault("Plain", NOW, "Title: Plain\n");
    expect((await discoverPlays()).find((p) => p.dir === plain.dir)?.format).toBe("dg-modern");
  });

  it("starts as the first status in the writer's list, or none when the list is empty (docs/app/preferences-and-help/settings.md#SET-7)", async () => {
    const listed = await scaffoldPlayInVault(
      "Listed",
      NOW,
      "Title: Listed\n",
      undefined,
      "in rehearsal",
    );
    const bare = await scaffoldPlayInVault("Bare", NOW, "Title: Bare\n", undefined, null);
    const plain = await scaffoldPlayInVault("Shipped List", NOW, "Title: Shipped List\n");
    const plays = await discoverPlays();
    expect(plays.find((p) => p.dir === listed.dir)?.status).toBe("in rehearsal");
    expect(plays.find((p) => p.dir === bare.dir)?.status).toBeUndefined();
    expect(plays.find((p) => p.dir === plain.dir)?.status).toBe("idea");
  });
});
