// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * DEV-ONLY in-memory vault, seeded from the real sample-vault files (via Vite
 * `?raw` imports — no duplication). It lets the whole app run and be exercised in
 * a plain browser (`bun run dev`) without the Tauri shell, so frontend
 * functionality can be built and verified without launching the native app.
 *
 * Activated by ipc.ts ONLY when `import.meta.env.DEV` and there is no Tauri
 * runtime. The production build never imports this module.
 */
import { emptyDraft, type FeedbackDraft } from "../feedback/model";
import { assertDocumentText } from "./read-limit";
import { matchingPath } from "./path-key";
import wowPlay from "../../sample-vault/The Weight of Water/The Weight of Water.proscenium?raw";
import wowFountain from "../../sample-vault/The Weight of Water/The Weight of Water.fountain?raw";
import maraMd from "../../sample-vault/The Weight of Water/Characters/Mara.md?raw";
import jonahMd from "../../sample-vault/The Weight of Water/Characters/Jonah.md?raw";
import researchMd from "../../sample-vault/The Weight of Water/Research/1953 North Sea Flood.md?raw";
import notesMd from "../../sample-vault/The Weight of Water/Notes/Structure.md?raw";
import loglineMd from "../../sample-vault/The Weight of Water/Loglines/Logline.md?raw";
import lhPlay from "../../sample-vault/The Lighthouse/The Lighthouse.proscenium?raw";
import lhFountain from "../../sample-vault/The Lighthouse/The Lighthouse.fountain?raw";
import lhIdeasMd from "../../sample-vault/The Lighthouse/Notes/Ideas.md?raw";

import { version as APP_VERSION } from "../../package.json";
import type {
  AppInfo,
  ConflictCopyEvent,
  ExternalChangeEvent,
  FolderAccessIssue,
  FolderFacts,
  OpenedFacts,
  OpenResult,
  ReadResult,
  TelemetryEvent,
  UpdateState,
  RestartOutcome,
  UserFormatFile,
  VaultEntry,
  VersionEntry,
  WriteOutcome,
  WatchHealth,
  PendingMove,
  MoveStart,
  SavedCopy,
  RecoveryFile,
} from "./ipc";
import {
  applyPatchToObject,
  readSettings,
  validatePatch,
  type Settings,
  type SettingsPatch,
} from "./settings-model";
import { KEPT_AT_QUIT } from "./quit-note";

/** Each export's media type, so the download is what it says. */
const EXPORT_MEDIA_TYPE = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  odt: "application/vnd.oasis.opendocument.text",
} as const;

/*
 * Reports, as a distribution build with reports enabled would hold them (telemetry/mod.rs):
 * queued while Settings › Privacy's switch is on, dropped the moment it goes
 * off. Nothing is ever sent from here; smoke reads the queue through
 * `window.__prosceniumTelemetry` to check the switch and the words. The error
 * log and page errors are kept whatever the switch says, as Rust keeps them.
 */
const telemetryQueue: TelemetryEvent[] = [];
/** Everything the page asked to record, switch or no switch. */
const telemetryAsked: TelemetryEvent[] = [];
const errorLog: string[] = [];
const pageErrors: string[] = [];
const surfacesShown = new Set<string>();
const feedbackSent: { id: string; message: string; email?: string; details?: string }[] = [];
let feedbackCopied = "";
const feedbackKey = "proscenium:dev:feedback-draft";

// The mock models sample-vault as a PLAYS FOLDER (docs/app/keeping-work/storage-and-file-format.md#STOR-D2): two plays under
// one root, each a directory holding a `.proscenium` file. `open()` scopes the
// vault to the root or to one play, exactly like the real backend reopening at
// a play's folder; the store itself is keyed root-relative.
const ROOT = "/dev/sample-vault";
const LAST_VAULT_KEY = "proscenium:dev:lastVault";
/**
 * The native app's settings.json, as one JSON object in localStorage. Kept as
 * an OBJECT rather than as `Settings`, and patched with the same
 * `applyPatchToObject` the model defines, so browser dev exercises what
 * settings.rs promises: unknown keys survive a write, and an invalid patch
 * rejects without writing anything.
 */
const SETTINGS_KEY = "proscenium:dev:settings";
/** The user formats folder, as `{ fileName: content }`. */
const USER_FORMATS_KEY = "proscenium:dev:formats";

/** A bare, visible `.json` name — the rule formats.rs applies. */
function isFormatFileName(name: string): boolean {
  return (
    name.endsWith(".json") && name.length > 5 && !name.startsWith(".") && !/[/\\\0]/.test(name)
  );
}

function readUserFormats(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(USER_FORMATS_KEY) ?? "{}") as unknown;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
    return Object.fromEntries(
      Object.entries(raw as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

function writeUserFormats(all: Record<string, string>): void {
  try {
    localStorage.setItem(USER_FORMATS_KEY, JSON.stringify(all));
  } catch {
    /* a private window refuses storage; the formats last this session */
  }
}

function readSettingsObject(): Record<string, unknown> {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as unknown;
    return typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function seed(): Map<string, string> {
  const m = new Map<string, string>();
  const w = "The Weight of Water";
  m.set(`${w}/${w}.proscenium`, wowPlay);
  m.set(`${w}/${w}.fountain`, wowFountain);
  m.set(`${w}/Characters/Mara.md`, maraMd);
  m.set(`${w}/Characters/Jonah.md`, jonahMd);
  m.set(`${w}/Research/1953 North Sea Flood.md`, researchMd);
  m.set(`${w}/Notes/Structure.md`, notesMd);
  m.set(`${w}/Loglines/Logline.md`, loglineMd);
  const l = "The Lighthouse";
  m.set(`${l}/${l}.proscenium`, lhPlay);
  m.set(`${l}/${l}.fountain`, lhFountain);
  m.set(`${l}/Notes/Ideas.md`, lhIdeasMd);
  return m;
}

const store = seed();
/**
 * Modification times, so browser dev exercises the same MODIFIED path the
 * native app does. Seeded files share one arbitrary base instant; a write
 * stamps the current time.
 */
const mtimes = new Map<string, number>();
const SEED_MTIME = Date.parse("2026-06-18T22:10:13Z");
const dirs = new Set<string>(); // directories with no file in them yet
const TUTORIAL_BASE = "/dev/app-data/tutorials";
const TUTORIAL_ROOT = `${TUTORIAL_BASE}/practice`;
const tutorialSessionRoot = (id: string) => {
  if (!/^[A-Z0-9]{26}$/.test(id)) throw new Error("Invalid tutorial session");
  return `${TUTORIAL_BASE}/sessions/${id}`;
};
const TUTORIAL_FILES = "proscenium:dev:tutorial-files";
const TUTORIAL_PROGRESS = "proscenium:dev:tutorial-progress";
/**
 * App data (docs/app/keeping-work/storage-and-file-format.md#STOR-D10), keyed `<playId>/<rel>`. Deliberately a SEPARATE map
 * from the vault: the whole point of the 1.0 layout is that versions and the
 * Changes store are not files in the Plays folder, and a mock that kept them
 * in one map would let a bug that writes them into a play pass unnoticed.
 */
const appData = new Map<string, string>();
/** Version rings, keyed `<playId>/<scriptId>` — newest first. */
const rings = new Map<string, { name: string; ts: string; reason: string; content: string }[]>();
const RING_MAX = 300;
const PINNED = new Set(["collision", "pre-keep", "pre-reload-at-banner", "recovery"]);

/**
 * Recovery snapshots OUTLIVE the page, in sessionStorage — and nothing else in
 * the mock does, but the note a quit leaves. A reload is how browser dev and the smoke test stand in for a
 * crash: the vault comes back as its seed, exactly as an app that died before a
 * flush comes back to the file it last wrote, and the snapshot is still in "app
 * data" to be found. (sessionStorage: it outlives a reload in the same tab and
 * nothing else, which is exactly the crash browser dev and smoke can stage.)
 */
const RECOVERY_KEY = "proscenium:dev:recovery:";
function recoveryKey(playId: string, scriptId: string, owner: string): string {
  return `${RECOVERY_KEY}${playId}/${scriptId}${owner === "legacy" ? "" : `/${owner}`}`;
}
const recoveryOwners = new Set<string>();
const recoveryClaims = new Set<string>();
/** The note a quit leaves for the play's next open outlives the page the same way: a reload stands in for the relaunch. */
const QUIT_NOTE_KEY = "proscenium:dev:kept-at-quit:";

/*
 * Quitting (quit.rs), as the gate sees it: a question out to the page, what the
 * page said about it, and whether the app would be gone. Nothing ever exits;
 * smoke asks with `window.__prosceniumQuit()` and reads the answer.
 */
const quitListeners = new Set<Box<number>>();
const quitAnswers = new Map<
  number,
  { heard: boolean; go: boolean | null; answered: (go: boolean) => void }
>();
let quitAsked = 0;
let quitGone = false;

// Which folder is open, as an absolute path: the sample Plays folder, one play
// in it, or a folder that holds it — "/dev", which is a Plays folder chosen one
// level too high (docs/app/keeping-work/storage-and-file-format.md#STOR-D12), its own folders the sample Plays folder and the
// ones OUTSIDE it. App paths resolve under it, mirroring the real backend's
// root-relative addressing.
let openAt = ROOT;

/**
 * The key an app path is kept under. Inside the sample Plays folder that is the
 * root-relative key the store has always used; anywhere else it is the
 * absolute path, which is how OUTSIDE keys its files.
 */
function toKey(rel: string): string {
  const clean = rel === "." ? "" : rel;
  const abs = clean ? `${openAt}/${clean}` : openAt;
  if (abs === ROOT) return "";
  return abs.startsWith(ROOT + "/") ? abs.slice(ROOT.length + 1) : abs;
}

/** The map a key lives in: an absolute key is a file outside the sample Plays folder. */
function filesFor(key: string): Map<string, string> {
  return key.startsWith("/") ? OUTSIDE : store;
}

/** A key as the absolute path it stands for. */
function absoluteOf(key: string): string {
  return key.startsWith("/") ? key : key ? `${ROOT}/${key}` : ROOT;
}

function hashOf(s: string): string {
  return (
    "sha256:" +
    s.length +
    "-" +
    s
      .split("")
      .reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 0)
      .toString(16)
  );
}

function existsSync(key: string): boolean {
  if (filesFor(key).has(key) || dirs.has(key)) return true;
  const inside = absoluteOf(key) + "/";
  return [...store.keys(), ...OUTSIDE.keys(), ...dirs].some((k) =>
    absoluteOf(k).startsWith(inside),
  );
}

/**
 * The async boundary every mock vault op resolves on.
 *
 * It is a MessageChannel task, not `setTimeout`, and that matters more than it
 * looks. Browsers clamp timers in a backgrounded tab to ~1s, and an automated
 * verification run drives the page while it is hidden — so a `setTimeout(…, 30)`
 * here silently became ~1000ms per vault op. A single import (≈20 ops) then
 * took ~20s and looked like an application performance bug. It wasn't: the
 * native app reaches the vault over Tauri IPC and never touches a timer.
 *
 * MessageChannel keeps the real point of this — ops complete on a later task,
 * so callers must await and the UI's loading states are exercised — without
 * inviting the throttle back. Don't reintroduce a wall-clock delay; if you ever
 * need to simulate slow IO, do it behind an explicit opt-in flag.
 */
function delay<T>(v: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => {
      port1.close();
      resolve(v);
    };
    port2.postMessage(null);
  });
}

/*
 * Files OUTSIDE the Plays folder, for exercising "open from Finder" in browser
 * dev and smoke (docs/app/keeping-work/storage-and-file-format.md#STOR-144): a loose script, an `.fdx`, and
 * a play that lives in some other folder. Absolute paths, like Finder's.
 */
const OUTSIDE = new Map<string, string>([
  [
    "/dev/outside/Draft.fountain",
    "Title: The Undertow\n\nINT. PIER - DAWN\n\nThe water is very still.\n\nNELL\nIt was never this quiet.\n",
  ],
  [
    "/dev/outside/Hamlet.fdx",
    '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n' +
      '<FinalDraft DocumentType="Script" Template="No" Version="5">\n<Content>\n' +
      '<Paragraph Type="Scene Heading"><Text>INT. ELSINORE - NIGHT</Text></Paragraph>\n' +
      '<Paragraph Type="Action"><Text>A platform before the castle. Cold.</Text></Paragraph>\n' +
      '<Paragraph Type="Character"><Text>BARNARDO</Text></Paragraph>\n' +
      '<Paragraph Type="Dialogue"><Text>Who\'s there?</Text></Paragraph>\n' +
      "</Content>\n<TitlePage><Content><Paragraph><Text>Hamlet</Text></Paragraph></Content></TitlePage>\n" +
      "</FinalDraft>\n",
  ],
  ["/dev/elsewhere/Lear/Lear.proscenium", '{"kind":"proscenium/play","schemaVersion":1}\n'],
  ["/dev/elsewhere/Lear/Lear.fountain", "Title: Lear\n"],
]);
/**
 * Binary files outside the Plays folder, as Finder hands them over: a `.pages`
 * document, or each file of a package-form one under its folder. Smoke adds
 * them (`mockOutsideFile`); the sample has none.
 */
const OUTSIDE_BYTES = new Map<string, Uint8Array>();
try {
  for (const [path, content] of Object.entries(
    JSON.parse(localStorage.getItem(TUTORIAL_FILES) ?? "{}"),
  )) {
    if (path.startsWith(TUTORIAL_BASE + "/") && typeof content === "string")
      OUTSIDE.set(path, content);
  }
} catch {
  /* Corrupt fixture storage does not affect the sample vault. */
}
function persistPractice() {
  localStorage.setItem(
    TUTORIAL_FILES,
    JSON.stringify(
      Object.fromEntries([...OUTSIDE].filter(([p]) => p.startsWith(TUTORIAL_BASE + "/"))),
    ),
  );
}
/**
 * Gates: vault calls held back or failed on purpose, until opened. A held read
 * is a script still downloading from iCloud; a held write is a slow disk; a
 * failed read is a file Rust cannot read as text; a held listing is a folder
 * iCloud has not brought down yet. For the checks that race the writer against
 * the disk. Opt-in, as `delay` asks — nothing is slow unless a test says so.
 */
type GateOp = "read" | "write" | "list" | "versionSnapshot" | "versionRead";
interface Gate {
  op: GateOp;
  /** Store key the call must name, or null for every call of that kind. */
  key: string | null;
  fail: string | null;
  waiting: (() => void)[];
}
const gates: Gate[] = [];
/** Calls a gate failed, by kind: how a check knows a refused save was tried again. */
const failedAtGates = new Map<GateOp, number>();

/** Null when no gate stands in the way; otherwise the wait (or the failure). */
function gate(op: GateOp, key: string | null): Promise<void> | null {
  const g = gates.find((x) => x.op === op && (x.key === null || x.key === key));
  if (!g) return null;
  if (g.fail !== null) {
    failedAtGates.set(op, (failedAtGates.get(op) ?? 0) + 1);
    return Promise.reject(new Error(g.fail));
  }
  return new Promise<void>((resolve) => g.waiting.push(resolve));
}

function through<T>(op: GateOp, key: string | null, go: () => Promise<T>): Promise<T> {
  const g = gate(op, key);
  return g ? g.then(go) : go();
}

const openedQueue: string[] = [];
const openedListeners = new Set<Box<void>>();
/** The folder the next folder panel answers with, once; the sample Plays folder otherwise. */
let nextPick: string | null = null;

/** Facts for a mock path — the in-memory vault for ROOT, OUTSIDE for the rest. */
function mockFacts(path: string): OpenedFacts {
  const inVault = path === ROOT || path.startsWith(ROOT + "/");
  const has = (abs: string) =>
    inVault
      ? store.has(abs.slice(ROOT.length + 1)) || existsSync(abs.slice(ROOT.length + 1))
      : OUTSIDE.has(abs) ||
        OUTSIDE_BYTES.has(abs) ||
        dirs.has(abs) ||
        [...OUTSIDE.keys(), ...OUTSIDE_BYTES.keys(), ...dirs].some((k) => k.startsWith(abs + "/"));
  const exists = inVault ? path === ROOT || has(path) : has(path);
  const isDir =
    exists &&
    !(inVault
      ? store.has(path.slice(ROOT.length + 1))
      : OUTSIDE.has(path) || OUTSIDE_BYTES.has(path));
  const keys = inVault ? [...store.keys()].map((k) => `${ROOT}/${k}`) : [...OUTSIDE.keys()];
  const playDirs: OpenedFacts["playDirs"] = [];
  let dir: string | null = isDir ? path : path.slice(0, path.lastIndexOf("/"));
  while (dir) {
    const d: string = dir;
    const playFiles = keys
      .filter((k) => k.startsWith(d + "/") && !k.slice(d.length + 1).includes("/"))
      .map((k) => k.slice(d.length + 1))
      .filter((n) => n.endsWith(".proscenium") && !n.startsWith("."));
    if (playFiles.length) playDirs.push({ dir: d, playFiles });
    const up = d.lastIndexOf("/");
    dir = up > 0 ? d.slice(0, up) : null;
  }
  return { path, exists, isDir, playDirs };
}

/* --- external-change event bus (the native side emits these from Rust) --- */
/**
 * Subscriptions are held as one-per-CALL boxes, never as a Set of the callback
 * itself — and that is a correctness requirement, not a style choice.
 *
 * React's StrictMode mounts every effect twice in development, so the watcher
 * effect subscribes the SAME `handleExternalChange` identity twice and then
 * tears the first one down. A `Set<callback>` dedupes those two subscribes into
 * one entry, and the first teardown deletes the entry the second subscribe
 * believes it owns — leaving ZERO listeners, permanently, because the effect's
 * dependencies are stable afterwards and it never re-runs.
 *
 * The symptom is that every external change in browser dev silently does
 * nothing, which is indistinguishable from a dozen real bugs in the code the
 * mock exists to exercise. Tauri's own `listen()` gives each call an
 * independent handle, so production never had this; only the mock did, and it
 * made the whole external-change path untestable without the native shell.
 */
type Box<T> = { cb: (e: T) => void };
const extChangeListeners = new Set<Box<ExternalChangeEvent>>();
const watcherHealthListeners = new Set<Box<WatchHealth>>();
let mockWatchStatus: WatchHealth["status"] = "watching";
const pendingMoves = new Map<string, { root: string; intent: PendingMove }>();
const savedCopyStore = new Map<string, { root: string; copy: SavedCopy; content: string }>();
const savedCopyListeners = new Set<Box<string>>();
let moveSequence = 0;
const conflictCopyListeners = new Set<Box<ConflictCopyEvent>>();
const updateListeners = new Set<Box<UpdateState>>();
const accessListeners = new Set<Box<FolderAccessIssue | null>>();
let updateState: UpdateState = { kind: "unconfigured" };
let mockAccent: string | null = null;
let accessIssue: FolderAccessIssue | null = null;
let finishUpdate: (() => void) | null = null;
let dirtyBuffer = false;

/** Add one subscription and hand back the unsubscribe for THAT call alone. */
function subscribe<T>(set: Set<Box<T>>, cb: (e: T) => void): Promise<() => void> {
  const box: Box<T> = { cb };
  set.add(box);
  return Promise.resolve(() => {
    set.delete(box);
  });
}

export const devVault = {
  tutorialSession: async (id: string, create: boolean) => {
    const path = tutorialSessionRoot(id);
    if (create) {
      if (existsSync(path)) throw new Error("This practice already exists");
      dirs.add(path);
      dirs.add(path + "/Practice Play");
    } else if (!existsSync(path + "/Practice Play"))
      throw new Error("This practice is no longer available");
    return path;
  },
  tutorialSessions: async () =>
    [
      ...new Set(
        [...OUTSIDE.keys(), ...dirs]
          .filter((p) => p.startsWith(TUTORIAL_BASE + "/sessions/"))
          .map((p) => p.slice((TUTORIAL_BASE + "/sessions/").length).split("/")[0])
          .filter((id) => /^[A-Z0-9]{26}$/.test(id)),
      ),
    ]
      .sort()
      .reverse(),
  tutorialReserveCopy: async (name: string) => {
    if (!name || /[/\\]/.test(name) || [".", ".."].includes(name) || existsSync(toKey(name)))
      throw new Error("The destination already exists");
    dirs.add(toKey(name));
  },
  tutorialCopyFile: async (
    source: { session?: string; dir: string },
    relative: string,
    destination: string,
  ) => {
    if (
      [relative, destination].some(
        (p) =>
          p.startsWith("/") ||
          p.includes("\\") ||
          p.split("/").some((c) => !c || c === "." || c === ".."),
      )
    )
      throw new Error("Invalid practice copy path");
    if (
      !source.session &&
      (!source.dir || /[/\\]/.test(source.dir) || [".", ".."].includes(source.dir))
    )
      throw new Error("Invalid practice source");
    const base = source.session
      ? tutorialSessionRoot(source.session) + "/Practice Play"
      : TUTORIAL_ROOT + "/" + source.dir;
    const content = OUTSIDE.get(base + "/" + relative);
    if (content === undefined) throw new Error("The original practice file could not be read");
    const result = await devVault.write(destination, content, "");
    if (result.status !== "ok" || (await devVault.read(destination)).content !== content)
      throw new Error("The copy could not be verified. The original practice is kept.");
  },
  tutorialTrash: async (id: string) => {
    const path = tutorialSessionRoot(id);
    if (openAt === path || openAt.startsWith(path + "/"))
      throw new Error("Stop this practice before moving it to Trash.");
    for (const [key, value] of [...OUTSIDE])
      if (key.startsWith(path + "/")) {
        OUTSIDE.set(TUTORIAL_BASE + "/trash/" + id + key.slice(path.length), value);
        OUTSIDE.delete(key);
      }
    for (const dir of [...dirs]) if (dir === path || dir.startsWith(path + "/")) dirs.delete(dir);
    persistPractice();
  },
  tutorialRoot: async () => {
    dirs.add(TUTORIAL_ROOT);
    return TUTORIAL_ROOT;
  },
  tutorialRead: async () => {
    const content = localStorage.getItem(TUTORIAL_PROGRESS);
    return { content, hash: content === null ? "" : hashOf(content) };
  },
  tutorialWrite: async (content: string, expected: string, preserve = false) => {
    const before = await devVault.tutorialRead();
    if (before.hash !== expected)
      throw new Error(
        "Tutorial progress changed in another window. Choose Reload Saved Tutorial Progress in Help.",
      );
    if (JSON.parse(content).version !== 1) throw new Error("Unsupported tutorial progress");
    if (preserve && before.content !== null)
      localStorage.setItem(TUTORIAL_PROGRESS + ":preserved:" + before.hash, before.content);
    localStorage.setItem(TUTORIAL_PROGRESS, content);
    return hashOf(content);
  },
  savedCopies: (): Promise<SavedCopy[]> =>
    delay(
      [...savedCopyStore.values()]
        .filter((entry) => entry.root === openAt)
        .map((entry) => entry.copy),
    ),
  readSavedCopy: (id: string): Promise<string> => {
    const entry = savedCopyStore.get(id);
    return entry?.root === openAt
      ? delay(entry.content)
      : Promise.reject(new Error("The saved copy could not be read."));
  },
  onSavedCopies: (cb: (root: string) => void) => subscribe(savedCopyListeners, cb),
  mockSavedCopy: (rel: string, content: string): void => {
    const copy = {
      id: `copy${savedCopyStore.size + 1}`,
      rel,
      hash: hashOf(content),
      createdMs: Date.now(),
    };
    savedCopyStore.set(copy.id, { root: openAt, copy, content });
    for (const listener of savedCopyListeners) listener.cb(openAt);
  },
  setBufferState: (dirty: boolean): Promise<void> => {
    dirtyBuffer = dirty;
    return delay(undefined);
  },
  updateState: () => delay(updateState),
  onUpdateState: (cb: (state: UpdateState) => void) => subscribe(updateListeners, cb),
  updateRestart: (): Promise<RestartOutcome> => {
    if (dirtyBuffer) return Promise.resolve({ kind: "unsaved" });
    if (updateState.kind !== "ready") return Promise.resolve({ kind: "notReady" });
    return new Promise((_, reject) => {
      finishUpdate = () => {
        finishUpdate = null;
        reject(new Error("Test replacement refused"));
      };
    });
  },
  mockUpdate: (finish = false): void => {
    if (finish) {
      finishUpdate?.();
      return;
    }
    updateState = { kind: "ready", version: "9.9.9", notes: null, publishedAt: null };
    for (const l of updateListeners) l.cb(updateState);
  },
  /** Stand in for another build: `{ kind: "unavailable" }` is a store copy. Answers the state it replaced. */
  mockUpdateState: (next: UpdateState): UpdateState => {
    const was = updateState;
    updateState = next;
    for (const l of updateListeners) l.cb(updateState);
    return was;
  },
  folderAccessState: () => delay(accessIssue),
  onFolderAccess: (cb: (state: FolderAccessIssue | null) => void) => subscribe(accessListeners, cb),
  folderAccessRetry: (): Promise<void> => {
    accessIssue = null;
    for (const l of accessListeners) l.cb(null);
    return delay(undefined);
  },
  mockFolderAccess: (): void => {
    accessIssue = {
      path: ROOT,
      message: "The folder opened, but its access could not be renewed for the next launch.",
    };
    for (const l of accessListeners) l.cb(accessIssue);
  },
  pickFolder: (): Promise<string | null> => {
    const picked = nextPick ?? ROOT;
    nextPick = null;
    return delay<string | null>(picked);
  },
  defaultRoot: () => delay(ROOT),
  // Browser dev has no iCloud container, so the welcome screen offers only
  // "a folder I choose" — which is also what a Mac with iCloud off shows.
  cloudRoot: () => delay<string | null>(null),

  open: (path: string): Promise<OpenResult> => {
    // A folder the mock holds — the sample Plays folder, a play in it, the
    // folder above it, a folder outside it. Anything else (a stale persisted
    // path) opens the sample Plays folder.
    const dir = path.replace(/\/+$/, "");
    const facts = mockFacts(dir);
    openAt = dir === ROOT || (facts.exists && facts.isDir) ? dir : ROOT;
    return delay({
      root: openAt,
      identity: openAt,
      conflicts: [],
      moves: [...pendingMoves.values()]
        .filter((move) => move.root === openAt)
        .map((move) => move.intent),
    });
  },

  list: (relDir: string): Promise<VaultEntry[]> => {
    const dir = relDir === "." || relDir === "" ? "" : relDir;
    const appPrefix = dir ? dir + "/" : "";
    // Resolved before any gate, like a write: the folder the call named.
    const key = toKey(dir);
    const inside = absoluteOf(key) + "/";
    const go = (): Promise<VaultEntry[]> => {
      const seen = new Map<string, boolean>();
      const collect = (keys: Iterable<string>, isDir: boolean) => {
        for (const k of keys) {
          const path = absoluteOf(k);
          if (!path.startsWith(inside)) continue;
          const rest = path.slice(inside.length);
          if (!rest) continue;
          const slash = rest.indexOf("/");
          if (slash === -1) seen.set(rest, isDir);
          else seen.set(rest.slice(0, slash), true);
        }
      };
      collect([...store.keys(), ...OUTSIDE.keys()], false);
      collect(dirs, true);
      return delay(
        [...seen]
          .map(([name, isDir]) => ({
            name,
            relPath: appPrefix + name,
            isDir,
            isSyncArtifact: false,
            modifiedMs: isDir
              ? undefined
              : (mtimes.get(key ? `${key}/${name}` : name) ?? SEED_MTIME),
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    };
    return through("list", key, go);
  },

  read: (rel: string): Promise<ReadResult> => {
    const key = toKey(rel);
    const go = (): Promise<ReadResult> => {
      const files = filesFor(key);
      const actual = matchingPath(key, files.keys()) ?? key;
      const content = files.get(actual);
      if (content === undefined) return Promise.reject(new Error("ENOENT " + rel));
      try {
        assertDocumentText(content);
      } catch (error) {
        return Promise.reject(error);
      }
      return delay({ content, hash: hashOf(content) });
    };
    return through("read", key, go);
  },

  write: (
    rel: string,
    content: string,
    expected: string | null,
    rebasable = false,
  ): Promise<WriteOutcome> => {
    // Resolved before any gate: the vault the call was made against, not the
    // one open by the time a held write goes through.
    const key = toKey(rel);
    const root = openAt;
    return through("write", key, (): Promise<WriteOutcome> => {
      if (
        [...pendingMoves.values()].some(
          (move) => move.root === root && move.intent.manifest !== rel,
        )
      ) {
        return Promise.reject(new Error("A file move needs to finish before saving."));
      }
      const files = filesFor(key);
      const hash = files.has(key) ? hashOf(files.get(key)!) : "";
      if (expected != null && hash !== expected) {
        // Neither outcome writes anything, and NEITHER makes a sibling: the
        // caller pins a version or rebases (docs/app/keeping-work/storage-and-file-format.md#STOR-D9).
        return delay({ status: rebasable ? ("stale" as const) : ("collision" as const), hash });
      }
      files.set(key, content);
      if (key.startsWith(TUTORIAL_BASE + "/")) persistPractice();
      mtimes.set(key, Date.now());
      return delay({ status: "ok" as const, hash: hashOf(content) });
    });
  },

  exists: (rel: string): Promise<boolean> => delay(existsSync(toKey(rel))),

  trash: (rel: string): Promise<void> => {
    const key = toKey(rel);
    const files = filesFor(key);
    for (const k of [...files.keys()]) if (k === key || k.startsWith(key + "/")) files.delete(k);
    if (key.startsWith(TUTORIAL_BASE + "/")) persistPractice();
    return delay(undefined);
  },

  rename: (from: string, to: string): Promise<void> => {
    const fromKey = toKey(from);
    const toKeyPath = toKey(to);
    const source = filesFor(fromKey);
    const target = filesFor(toKeyPath);
    if (fromKey === toKeyPath) return delay(undefined);
    if (existsSync(toKeyPath))
      return Promise.reject(new Error("Something is already at that name, so nothing was moved."));
    if (!existsSync(fromKey)) return Promise.reject(new Error("The original file is missing."));
    for (const k of [...source.keys()]) {
      if (k === fromKey || k.startsWith(fromKey + "/")) {
        target.set(toKeyPath + k.slice(fromKey.length), source.get(k)!);
        source.delete(k);
      }
    }
    for (const dir of [...dirs]) {
      if (dir === fromKey || dir.startsWith(fromKey + "/")) {
        dirs.add(toKeyPath + dir.slice(fromKey.length));
        dirs.delete(dir);
      }
    }
    if (fromKey.startsWith(TUTORIAL_BASE + "/")) persistPractice();
    return delay(undefined);
  },

  mkdir: (rel: string): Promise<void> => {
    dirs.add(toKey(rel));
    return delay(undefined);
  },

  beginMove: async (
    from: string,
    to: string,
    manifest: string,
    payload: string,
  ): Promise<MoveStart> => {
    if ([...pendingMoves.values()].some((move) => move.root === openAt)) {
      return {
        status: "refused",
        message: "An earlier file move needs recovery. Reopen the play.",
        blocked: true,
      };
    }
    const intent: PendingMove = { id: `move${++moveSequence}`, from, to, manifest, payload };
    pendingMoves.set(intent.id, { root: openAt, intent });
    try {
      await devVault.rename(from, to);
      return { status: "ok", intent };
    } catch (error) {
      pendingMoves.delete(intent.id);
      return { status: "refused", message: String(error), blocked: false };
    }
  },
  finishMove: (id: string): Promise<void> => {
    pendingMoves.delete(id);
    return delay(undefined);
  },
  rollbackMove: async (id: string): Promise<void> => {
    const move = pendingMoves.get(id);
    if (!move || move.root !== openAt) throw new Error("The unfinished move is in another folder.");
    if (await devVault.exists(move.intent.from)) throw new Error("The original name is occupied.");
    await devVault.rename(move.intent.to, move.intent.from);
  },

  // Versions (docs/app/keeping-work/storage-and-file-format.md#STOR-D10) — same semantics as the Rust ring: dedup against
  // the newest entry, newest-first listing, bounded size, pinned reasons never
  // pruned. Keyed by PLAY id as well as script id, and held outside `store`,
  // because a version is not a file in the Plays folder any more.
  versionSnapshot: (
    playId: string,
    scriptId: string,
    reason: string,
    content: string,
    ext: string,
  ): Promise<string> =>
    through("versionSnapshot", null, () => {
      const key = `${playId}/${scriptId}`;
      const list = rings.get(key) ?? [];
      // Never dedup a pin into an entry the ring may prune (versions.rs).
      const newest = list[0];
      if (newest?.content === content && (PINNED.has(newest.reason) || !PINNED.has(reason))) {
        return delay(newest.name);
      }
      const d = new Date();
      const p = (n: number, w = 2) => String(n).padStart(w, "0");
      const stamp =
        `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
        `-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}` +
        `-${p(d.getUTCMilliseconds(), 3)}`;
      let name = `${stamp}-${reason}.${ext}`;
      let n = 1;
      while (list.some((e) => e.name === name)) name = `${stamp}-${reason}-${n++}.${ext}`;
      list.unshift({ name, ts: d.toISOString(), reason, content });
      // Prune only what may be pruned; a pinned entry does not occupy a slot.
      const pinned = list.filter((e) => PINNED.has(e.reason));
      const rest = list.filter((e) => !PINNED.has(e.reason)).slice(0, RING_MAX);
      rings.set(
        key,
        list.filter((e) => pinned.includes(e) || rest.includes(e)),
      );
      return delay(name);
    }),
  versionList: (playId: string, scriptId: string): Promise<VersionEntry[]> =>
    delay(
      (rings.get(`${playId}/${scriptId}`) ?? []).map(({ name, ts, reason, content }) => ({
        name,
        ts,
        reason,
        size: content.length,
        pinned: PINNED.has(reason),
      })),
    ),
  versionRead: (playId: string, scriptId: string, name: string): Promise<string> =>
    through("versionRead", null, () => {
      const entry = (rings.get(`${playId}/${scriptId}`) ?? []).find((e) => e.name === name);
      return entry ? delay(entry.content) : Promise.reject(new Error("ENOENT " + name));
    }),

  // The rest of a play's app data: Changes baselines and before-texts.
  storeRead: (playId: string, rel: string): Promise<string | null> =>
    delay(
      rel === KEPT_AT_QUIT
        ? sessionStorage.getItem(QUIT_NOTE_KEY + playId)
        : (appData.get(`${playId}/${rel}`) ?? null),
    ),
  storeWrite: (playId: string, rel: string, content: string): Promise<void> => {
    if (rel === KEPT_AT_QUIT) sessionStorage.setItem(QUIT_NOTE_KEY + playId, content);
    else appData.set(`${playId}/${rel}`, content);
    return delay(undefined);
  },
  storeRemove: (playId: string, rel: string): Promise<void> => {
    if (rel === KEPT_AT_QUIT) sessionStorage.removeItem(QUIT_NOTE_KEY + playId);
    else appData.delete(`${playId}/${rel}`);
    return delay(undefined);
  },

  onQuitRequested: (cb: (id: number) => void) => subscribe(quitListeners, cb),
  quitHeard: (id: number): Promise<void> => {
    const q = quitAnswers.get(id);
    if (q) q.heard = true;
    return delay(undefined);
  },
  quitSettled: (id: number, go: boolean): Promise<void> => {
    const q = quitAnswers.get(id);
    if (q && q.go === null) {
      q.go = go;
      if (go) quitGone = true;
      q.answered(go);
    }
    return delay(undefined);
  },
  quitNow: (): Promise<void> => {
    quitGone = true;
    return delay(undefined);
  },
  /**
   * Dev-only: quit, as ⌘Q would — ask the page, and resolve with what it said
   * once it answers. Also on `window.__prosceniumQuit`.
   */
  mockQuit: (): Promise<{ heard: boolean; go: boolean }> =>
    new Promise((resolve) => {
      const id = ++quitAsked;
      const entry = {
        heard: false,
        go: null as boolean | null,
        answered: (go: boolean) => resolve({ heard: entry.heard, go }),
      };
      quitAnswers.set(id, entry);
      for (const l of quitListeners) l.cb(id);
    }),
  /** Dev-only: the app would be gone — the page said go, or the writer chose Quit Anyway. */
  mockQuitGone: (): boolean => quitGone,

  recoveryWrite: (
    playId: string,
    scriptId: string,
    content: string,
    owner: string,
  ): Promise<void> => {
    const key = recoveryKey(playId, scriptId, owner);
    if (owner === "legacy" || (!recoveryOwners.has(key) && sessionStorage.getItem(key) !== null))
      return Promise.reject(new Error("An earlier session owns those recovery words."));
    recoveryOwners.add(key);
    sessionStorage.setItem(key, content);
    return delay(undefined);
  },
  recoveryRead: (playId: string, scriptId: string, owner: string): Promise<string | null> =>
    delay(sessionStorage.getItem(recoveryKey(playId, scriptId, owner))),
  recoveryRemove: (playId: string, scriptId: string, owner: string): Promise<void> => {
    const key = recoveryKey(playId, scriptId, owner);
    if (
      sessionStorage.getItem(key) !== null &&
      !recoveryOwners.has(key) &&
      !recoveryClaims.has(key)
    )
      return Promise.reject(new Error("The recovery file belongs to another session."));
    sessionStorage.removeItem(key);
    recoveryClaims.delete(key);
    return delay(undefined);
  },
  recoveryRelease: (playId: string, scriptId: string, owner: string): Promise<void> => {
    const key = recoveryKey(playId, scriptId, owner);
    recoveryOwners.delete(key);
    recoveryClaims.delete(key);
    return delay(undefined);
  },
  recoveryList: (playId: string, scriptId?: string): Promise<RecoveryFile[]> => {
    const files: RecoveryFile[] = [];
    const prefix = `${RECOVERY_KEY}${playId}/`;
    for (const key of Object.keys(sessionStorage)) {
      if (!key.startsWith(prefix) || recoveryOwners.has(key)) continue;
      const [id, owner = "legacy"] = key.slice(prefix.length).split("/");
      if (scriptId !== undefined && scriptId !== id) continue;
      const content = sessionStorage.getItem(key);
      if (content === null) continue;
      recoveryClaims.add(key);
      files.push({ scriptId: id, owner, content });
    }
    return delay(files);
  },

  // App prefs — persisted in localStorage so dev reloads reopen the vault, the
  // same way the real app reopens the last folder on launch.
  getLastVault: (): Promise<string | null> =>
    delay(typeof localStorage !== "undefined" ? localStorage.getItem(LAST_VAULT_KEY) : null),
  setLastVault: (path: string): Promise<void> => {
    try {
      localStorage.setItem(LAST_VAULT_KEY, path);
    } catch {
      /* ignore */
    }
    return delay(undefined);
  },
  getSettings: (): Promise<Settings> => delay(readSettings(readSettingsObject())),
  updateSettings: (patch: SettingsPatch): Promise<Settings> => {
    const invalid = validatePatch(patch);
    if (invalid) return Promise.reject(new Error(invalid));
    const next = applyPatchToObject(readSettingsObject(), patch);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {
      /* a private window refuses storage; the answer is still the new state */
    }
    if (!readSettings(next).shareAnalytics) telemetryQueue.length = 0;
    return delay(readSettings(next));
  },

  recordTelemetry: (event: TelemetryEvent): Promise<void> => {
    telemetryAsked.push(event);
    if (event.name === "error_shown") errorLog.push(event.code);
    if (!readSettings(readSettingsObject()).shareAnalytics) return delay(undefined);
    // A surface is reported once a launch, as Rust reports it.
    if (event.name === "surface_shown") {
      if (surfacesShown.has(event.surface)) return delay(undefined);
      surfacesShown.add(event.surface);
    }
    telemetryQueue.push(event);
    return delay(undefined);
  },
  pageError: (
    name: string,
    frames: import("../diagnostics/page-error").PageFrame[],
  ): Promise<void> => {
    pageErrors.push(`${name} ${frames.length} frames`.trim());
    return delay(undefined);
  },
  /** The same shape Rust writes (telemetry/diagnostics.rs), from what the mock knows. */
  reviewDiagnostics: async (formatsInUse: string[]): Promise<string> => {
    if (localStorage.getItem("proscenium:dev:feedback-details-fail") === "true")
      throw new Error("Unavailable");
    const s = readSettings(readSettingsObject());
    const onOff = (on: boolean) => (on ? "on" : "off");
    const text = [
      `Proscenium    ${APP_VERSION} (browser preview)`,
      `Accent        ${s.accent}`,
      `Formats       ${formatsInUse.length ? formatsInUse.join(", ") : "none open"}`,
      `Settings      spell check ${onOff(s.spellcheck)} · page map ${onOff(s.runningTimeStrip)}`,
      `Reports       usage and crash reports ${onOff(s.shareAnalytics)}`,
      "",
      "Recent errors, newest first",
      ...(errorLog.length ? [...errorLog].reverse().map((code) => `  ${code}`) : ["  none"]),
      "",
    ].join("\n");
    return text;
  },
  copyDiagnostics: async (formatsInUse: string[]): Promise<string> => {
    const text = await devVault.reviewDiagnostics(formatsInUse);
    try {
      await navigator.clipboard?.writeText(text);
    } catch {
      /* headless clipboard */
    }
    return text;
  },
  feedbackLoad: async (): Promise<FeedbackDraft> =>
    JSON.parse(localStorage.getItem(feedbackKey) ?? "null")?.draft ?? emptyDraft(),
  feedbackSave: async (draft: FeedbackDraft): Promise<void> => {
    const previous = JSON.parse(localStorage.getItem(feedbackKey) ?? "null");
    if (!draft.message && !draft.email && !draft.includeDetails)
      localStorage.removeItem(feedbackKey);
    else
      localStorage.setItem(
        feedbackKey,
        JSON.stringify({
          draft,
          id: JSON.stringify(previous?.draft) === JSON.stringify(draft) ? previous?.id : undefined,
        }),
      );
  },
  feedbackDiscard: async (): Promise<void> => {
    localStorage.removeItem(feedbackKey);
  },
  feedbackSend: async (draft: FeedbackDraft, details: string | null): Promise<void> => {
    await devVault.feedbackSave(draft);
    const saved = JSON.parse(localStorage.getItem(feedbackKey)!);
    saved.id ??= crypto.randomUUID();
    localStorage.setItem(feedbackKey, JSON.stringify(saved));
    await delay(undefined);
    if (localStorage.getItem("proscenium:dev:feedback-fail") === "true")
      throw new Error(
        "You're offline. Your message is saved here; try again once you're connected.",
      );
    feedbackSent.push({
      id: saved.id,
      message: draft.message,
      ...(draft.email.trim() ? { email: draft.email.trim() } : {}),
      ...(draft.includeDetails ? { details: details ?? "" } : {}),
    });
    localStorage.removeItem(feedbackKey);
  },
  feedbackCopy: async (message: string): Promise<void> => {
    feedbackCopied = message;
  },
  mockFeedback: () => ({
    sent: [...feedbackSent],
    copied: feedbackCopied,
    saved: JSON.parse(localStorage.getItem(feedbackKey) ?? "null"),
  }),
  telemetryConfigured: (): Promise<boolean> =>
    delay(localStorage.getItem("proscenium:dev:analytics-key") !== "false"),
  mockTelemetry: () => ({
    on: readSettings(readSettingsObject()).shareAnalytics,
    asked: [...telemetryAsked],
    queued: [...telemetryQueue],
    errors: [...errorLog],
    pageErrors: [...pageErrors],
  }),
  appInfo: (): Promise<AppInfo> =>
    delay({ version: APP_VERSION, arch: "browser", channel: "browser" }),
  /** No Mac here: the stand-in blue, unless a check chooses a colour. */
  systemAccent: (): Promise<string | null> => delay(mockAccent),
  /**
   * Stand in for the writer changing the accent in System Settings and coming
   * back: the page asks again on `proscenium:system-accent`, as the app does
   * when its window comes forward.
   */
  mockSystemAccent: (hex: string | null): void => {
    mockAccent = hex;
    window.dispatchEvent(new Event("proscenium:system-accent"));
  },

  // A folder about to become the Plays folder (docs/app/keeping-work/storage-and-file-format.md#STOR-D2, docs/app/keeping-work/storage-and-file-format.md#STOR-D11). The mock has
  // no providers; a play is a directory holding its `.proscenium`.
  folderFacts: (path: string): Promise<FolderFacts> => {
    const facts = mockFacts(path);
    const dir = path.replace(/\/+$/, "");
    return delay({
      path: dir,
      isPlay: facts.playDirs[0]?.dir === dir,
      insidePlay: facts.playDirs.find((d) => d.dir !== dir)?.dir ?? null,
      providers: [],
      listable: facts.exists,
    });
  },

  // Files opened from Finder (opens.rs): a queue drained by the UI.
  openedTake: (): Promise<string[]> => delay(openedQueue.splice(0)),
  openedFacts: (path: string): Promise<OpenedFacts> => delay(mockFacts(path)),
  openedRead: (path: string): Promise<ReadResult> => {
    const content = path.startsWith(ROOT + "/")
      ? store.get(path.slice(ROOT.length + 1))
      : OUTSIDE.get(path);
    if (content === undefined) return Promise.reject(new Error("ENOENT " + path));
    return delay({ content, hash: hashOf(content) });
  },
  openedReadBytes: async (path: string): Promise<Uint8Array> =>
    OUTSIDE_BYTES.get(path) ?? new TextEncoder().encode((await devVault.openedRead(path)).content),
  /** A package-form document's files, as `opened_read_package` answers; null for a file. */
  openedReadPackage: (path: string): Promise<{ path: string; bytes: Uint8Array }[] | null> => {
    if (OUTSIDE.has(path) || OUTSIDE_BYTES.has(path)) return delay(null);
    const files = [...OUTSIDE_BYTES]
      .filter(([k]) => k.startsWith(path + "/"))
      .map(([k, bytes]) => ({ path: k.slice(path.length + 1), bytes }))
      .sort((a, b) => (a.path < b.path ? -1 : 1));
    return files.length ? delay(files) : Promise.reject(new Error("ENOENT " + path));
  },
  /** Dev-only: a binary file outside the Plays folder, for Finder to open. Also
   * on `window.__prosceniumOutsideFile`. */
  mockOutsideFile: (path: string, base64: string): void => {
    OUTSIDE_BYTES.set(
      path,
      Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)),
    );
  },
  onOpened: (cb: () => void) => subscribe(openedListeners, cb),
  /**
   * Dev-only: pretend Finder opened these paths, the way `RunEvent::Opened`
   * does — queue them, then signal. Also on `window.__prosceniumOpenFiles`.
   */
  mockOpenFiles: (paths: string[]): void => {
    for (const p of paths) if (!openedQueue.includes(p)) openedQueue.push(p);
    for (const l of openedListeners) l.cb();
  },
  /**
   * Dev-only: the writer's next choice in the folder panel is `path` — "/dev",
   * say, the folder the sample Plays folder sits in. Also on
   * `window.__prosceniumNextPick`.
   */
  mockNextPick: (path: string): void => {
    nextPick = path;
  },

  /*
   * User formats, kept in localStorage as `{ fileName: content }`, so browser
   * dev and smoke save, import and delete formats through the same calls the
   * native folder answers — and a saved format survives a reload.
   */
  listUserFormats: (): Promise<UserFormatFile[]> =>
    delay(
      Object.entries(readUserFormats())
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([fileName, content]) => ({ fileName, content })),
    ),
  saveUserFormat: (fileName: string, content: string): Promise<void> => {
    if (!isFormatFileName(fileName)) {
      return Promise.reject(new Error(`"${fileName}" is not a format file name`));
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      return Promise.reject(new Error(`not valid JSON: ${(e as Error).message}`));
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return Promise.reject(new Error("a format file is a JSON object"));
    }
    writeUserFormats({ ...readUserFormats(), [fileName]: content });
    return delay(undefined);
  },
  trashUserFormat: (fileName: string): Promise<void> => {
    const all = readUserFormats();
    delete all[fileName];
    writeUserFormats(all);
    return delay(undefined);
  },
  /** Browser dev has no Open panel; a file input stands in for it. */
  importFormatFile: (): Promise<UserFormatFile | null> =>
    new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,application/json";
      input.addEventListener("change", () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        void file.text().then((content) => resolve({ fileName: file.name, content }));
      });
      input.addEventListener("cancel", () => resolve(null));
      input.click();
    }),
  /** Browser dev has no Save panel; the copy arrives as a download. */
  exportFormatFile: (suggestedName: string, content: string): Promise<string | null> => {
    const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = suggestedName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return delay<string | null>(`${suggestedName} (browser download)`);
  },

  // Browser dev has no save dialog: deliver exports as a download.
  saveFile: (
    suggestedName: string,
    bytes: Uint8Array,
    type: "pdf" | "docx" | "odt" = "pdf",
  ): Promise<string | null> => {
    const blob = new Blob([bytes.slice().buffer], { type: EXPORT_MEDIA_TYPE[type] });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = suggestedName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return delay<string | null>(`${suggestedName} (browser download)`);
  },

  /**
   * Browser dev has no print panel: the PDF opens in a tab, and the browser's
   * viewer prints it. Not a hidden frame calling print() — the app's policy
   * refuses frames (`frame-src 'none'`), and smoke serves dist/ under it.
   */
  printFile: (_jobTitle: string, bytes: Uint8Array): Promise<void> => {
    const blob = new Blob([bytes.slice().buffer], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return delay<void>(undefined);
  },

  /**
   * External changes have no watcher in browser dev, so this used to be a
   * no-op stub — which left the app's ext-change handler unreachable without
   * the native shell. It is a real bus now, driven by `mockExternalChange`
   * below: that handler is the half of the derived-sidecar fix (docs/app/keeping-work/storage-and-file-format.md#STOR-D7)
   * that cannot be unit-tested, and verifying it should not require poking a
   * live vault.
   */
  onExternalChange: (cb: (e: ExternalChangeEvent) => void) => subscribe(extChangeListeners, cb),
  watcherHealth: (): Promise<WatchHealth> => delay({ root: openAt, status: mockWatchStatus }),
  onWatcherHealth: (cb: (health: WatchHealth) => void) => subscribe(watcherHealthListeners, cb),
  mockWatcherHealth: (status: WatchHealth["status"]): void => {
    mockWatchStatus = status;
    for (const listener of watcherHealthListeners) listener.cb({ root: openAt, status });
  },
  onConflictCopy: (cb: (e: ConflictCopyEvent) => void) => subscribe(conflictCopyListeners, cb),

  /**
   * Dev-only: pretend an outside writer (a sync, another editor) changed a
   * file, exactly as the Rust watcher would report it. Writes the bytes first
   * so a handler that re-reads sees the new content, then emits the event.
   * Also on `window.__prosceniumExternalChange` for hand-driving from the
   * browser console.
   */
  /**
   * Dev-only: hold every `op` call naming `rel` (relative to what is open; null
   * for every call of that kind) until the gates open — or fail it with `fail`.
   */
  mockGate: (op: GateOp, rel: string | null, opts: { fail?: string } = {}): void => {
    gates.push({ op, key: rel === null ? null : toKey(rel), fail: opts.fail ?? null, waiting: [] });
  },
  /** Dev-only: how many `op` calls are waiting at a gate right now. */
  mockHeld: (op: GateOp): number =>
    gates.filter((g) => g.op === op).reduce((n, g) => n + g.waiting.length, 0),
  /** Dev-only: how many `op` calls a gate has failed since the page loaded. */
  mockFailed: (op: GateOp): number => failedAtGates.get(op) ?? 0,
  /**
   * Dev-only: open the gates for `op`, or every gate — the held calls go
   * through, in the order they arrived, and nothing is held after.
   */
  mockOpenGates: (op?: GateOp): void => {
    const opening = gates.filter((g) => op === undefined || g.op === op);
    for (const g of opening) gates.splice(gates.indexOf(g), 1);
    for (const g of opening) for (const go of g.waiting) go();
  },
  /** Dev-only: every version, in any play, whose text includes `text`. */
  mockVersionsWith: (text: string): { reason: string; pinned: boolean }[] =>
    [...rings.values()]
      .flat()
      .filter((e) => e.content.includes(text))
      .map((e) => ({ reason: e.reason, pinned: PINNED.has(e.reason) })),
  /** Dev-only: what the in-memory disk holds at `rel` right now, or null. */
  mockPeek: (rel: string): string | null => {
    const key = toKey(rel);
    return filesFor(key).get(key) ?? null;
  },
  /** Dev-only: the same, by store key (root-relative, whatever is open). */
  mockPeekKey: (key: string): string | null => store.get(key) ?? null,
  /** Dev-only: every file in the in-memory disk, by store key. */
  mockStoreKeys: (): string[] => [...store.keys()],
  /** Dev-only: put a file on the in-memory disk with no event — as if it was there before launch. */
  mockQuietWrite: (key: string, content: string): void => {
    store.set(key, content);
    mtimes.set(key, Date.now());
  },
  /** Dev-only: an outside tool removed `rel`, reported as the watcher would. */
  mockExternalRemove: (rel: string): void => {
    const key = toKey(rel);
    filesFor(key).delete(key);
    for (const l of extChangeListeners) l.cb({ relPath: rel, hash: null });
  },

  mockExternalChange: async (rel: string, content: string): Promise<string> => {
    const key = toKey(rel);
    filesFor(key).set(key, content);
    mtimes.set(key, Date.now());
    const hash = hashOf(content);
    for (const l of extChangeListeners) l.cb({ relPath: rel, hash });
    return hash;
  },
  /** The native watcher can spell an existing path differently from a read. */
  mockExternalAlias: (rel: string, eventRel: string, content: string): void => {
    const key = toKey(rel);
    filesFor(key).set(key, content);
    mtimes.set(key, Date.now());
    for (const l of extChangeListeners) l.cb({ relPath: eventRel, hash: hashOf(content) });
  },
};

export type DevVault = typeof devVault;

// Hand-drivable from the browser console:
//   await __prosceniumExternalChange("<Play>.fountain", "<fountain text>")
//
// `__prosceniumListenerCount()` reports how many handlers are actually on the
// external-change bus. It exists because the async-subscribe leak in
// useWorkspace has recurred more than once (a cleanup that runs before the
// subscribe promise resolves unsubscribes the handler that just arrived), and
// the symptom — "external changes silently do nothing" — is indistinguishable
// from a dozen other bugs until you can see this number. 1 is healthy; 0 means
// nothing is listening; >1 means every event is being handled repeatedly.
if (typeof window !== "undefined") {
  const w = window as unknown as Record<string, unknown>;
  w.__prosceniumExternalChange = devVault.mockExternalChange;
  w.__prosceniumExternalAlias = devVault.mockExternalAlias;
  w.__prosceniumListenerCount = () => extChangeListeners.size;
  w.__prosceniumOpenFiles = devVault.mockOpenFiles;
  w.__prosceniumOutsideFile = devVault.mockOutsideFile;
  w.__prosceniumNextPick = devVault.mockNextPick;
  w.__prosceniumGate = devVault.mockGate;
  w.__prosceniumHeld = devVault.mockHeld;
  w.__prosceniumFailed = devVault.mockFailed;
  w.__prosceniumOpenGates = devVault.mockOpenGates;
  w.__prosceniumVersionsWith = devVault.mockVersionsWith;
  w.__prosceniumPeek = devVault.mockPeek;
  w.__prosceniumPeekKey = devVault.mockPeekKey;
  w.__prosceniumStoreKeys = devVault.mockStoreKeys;
  w.__prosceniumQuietWrite = devVault.mockQuietWrite;
  w.__prosceniumExternalRemove = devVault.mockExternalRemove;
  w.__prosceniumWatcherHealth = devVault.mockWatcherHealth;
  w.__prosceniumSavedCopy = devVault.mockSavedCopy;
  w.__prosceniumFeedback = devVault.mockFeedback;
  w.__prosceniumTelemetry = devVault.mockTelemetry;
  w.__prosceniumQuit = devVault.mockQuit;
  w.__prosceniumQuitGone = devVault.mockQuitGone;
  w.__prosceniumUpdate = devVault.mockUpdate;
  w.__prosceniumUpdateState = devVault.mockUpdateState;
  w.__prosceniumSystemAccent = devVault.mockSystemAccent;
  w.__prosceniumUpdateHeld = () => finishUpdate !== null;
  w.__prosceniumFolderAccess = devVault.mockFolderAccess;
}
