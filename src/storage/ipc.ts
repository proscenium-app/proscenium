// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Typed client over the Rust vault IPC (docs/engineering/architecture.md#ARCH-D104).
 *
 * Tauri converts the snake_case Rust command parameters to camelCase at the JS
 * boundary, so e.g. `rel_dir` is passed as `relDir`. This is the ONLY module
 * that talks to the backend; everything else goes through the higher-level store.
 */
import type { FeedbackDraft } from "../feedback/model";
import { invoke } from "@tauri-apps/api/core";
import { listen as tauriListen, type EventCallback, type UnlistenFn } from "@tauri-apps/api/event";
import type { ErrorCode } from "../diagnostics/error-codes";
import { VaultWriteError } from "./save-failure";
import { decodeBytes } from "./import-bytes";
import { sendingWrite, vaultOpenedAt } from "./own-writes";
import type { Settings, SettingsPatch } from "./settings-model";

/** How often, and how long, letting go of a listener is tried again. */
const UNLISTEN_RETRY_MS = 20;
const UNLISTEN_TRIES = 50;

/**
 * Tauri's `listen`, with an unlisten that cannot throw, run twice or leak.
 *
 * Tauri adds the page's half of a listener with a script it runs after `listen`
 * has already answered. An unlisten that got there first, as it does when an
 * effect is torn down while it waits for its handle and lets go the moment the
 * handle arrives, found nothing on the page to remove and threw. So it never
 * told Rust to stop: the listener stayed subscribed, and the page logged an
 * unhandled rejection, which only a native run could show. Here the handler
 * goes quiet as soon as unlisten is called, and letting go is tried again on a
 * later task until the page's half is there to remove.
 */
export async function listen<T>(event: string, handler: EventCallback<T>): Promise<UnlistenFn> {
  let live = true;
  const unlisten = await tauriListen<T>(event, (e) => {
    if (live) handler(e);
  });
  return () => {
    if (!live) return;
    live = false;
    const letGo = (tries: number) => {
      // Typed as returning nothing; Tauri's unlisten returns its promise.
      Promise.resolve()
        .then(() => unlisten() as unknown)
        .catch(() => {
          if (tries > 1) setTimeout(() => letGo(tries - 1), UNLISTEN_RETRY_MS);
        });
    };
    letGo(UNLISTEN_TRIES);
  };
}

export interface VaultEntry {
  name: string;
  relPath: string;
  isDir: boolean;
  isSyncArtifact: boolean;
  /**
   * Last-modified time, epoch milliseconds; absent when the platform will not
   * say (and for an evicted iCloud stub, whose mtime is when eviction happened
   * rather than when the writer wrote). The only timestamp that moves when
   * something OTHER than the app writes a file.
   */
  modifiedMs?: number;
}

export interface OpenResult {
  root: string;
  /** Device and directory identity; survives renames, unlike the display path. */
  identity?: string;
  moves?: PendingMove[];
  /** Provider conflict copies found at open (docs/app/keeping-work/storage-and-file-format.md#STOR-D11). */
  conflicts: string[];
}

export interface PendingMove {
  id: string;
  from: string;
  to: string;
  manifest: string | null;
  payload: string | null;
}
export type MoveStart =
  | { status: "ok"; intent: PendingMove }
  | { status: "refused"; message: string; blocked: boolean };
export interface SavedCopy {
  id: string;
  rel: string;
  hash: string;
  createdMs: number;
}

export interface ReadResult {
  content: string;
  hash: string;
}

export type WriteOutcome =
  | { status: "ok"; hash: string }
  /**
   * The file changed under us. NOTHING was written and no sibling was made;
   * `hash` is what is actually on disk. The caller pins a version holding its
   * bytes and shows the banner (docs/app/keeping-work/storage-and-file-format.md#STOR-D9).
   */
  | { status: "collision"; hash: string }
  /**
   * The same mismatch on the play file, which has several legitimate writers.
   * `hash` is disk truth — rebuild the change on it and write again once.
   */
  | { status: "stale"; hash: string };

export interface ExternalChangeEvent {
  root?: string;
  relPath: string;
  /** Content hash, or null if the file was removed. */
  hash: string | null;
}

export interface ConflictCopyEvent {
  root?: string;
  relPath: string;
}

export interface WatchHealth {
  root: string;
  status: "watching" | "restarting" | "unavailable";
}
export const watcherHealth = {
  state: (): Promise<WatchHealth | null> =>
    USE_MOCK ? mock().then((m) => m.watcherHealth()) : invoke("watcher_status"),
  onState: (cb: (health: WatchHealth) => void): Promise<UnlistenFn> =>
    USE_MOCK
      ? mock().then((m) => m.onWatcherHealth(cb))
      : listen<WatchHealth>("vault://watcher-health", (event) => cb(event.payload)),
};

/** True when the real Tauri runtime is present. */
function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * In a plain browser during development, route to the in-memory dev vault so the
 * whole app runs without the native shell. Lazily + dynamically imported so the
 * production bundle (Tauri present) never includes it.
 */
/**
 * Route to the in-memory dev vault instead of the native shell.
 *
 * On in browser dev, and on in the SHIPPED bundle when a test page sets
 * `__PROSCENIUM_FIXTURE__` before the app boots (scripts/smoke.mjs). That seam
 * exists because `bun run dev` is not the app: it runs unminified React with a
 * different storage path, so a production-only failure never shows there — and
 * the native window cannot be driven at all, since tauri-driver is Linux and
 * Windows only. The smoke test drives the real `dist/` bundle instead.
 *
 * `!isTauri()` is the fence and it is not negotiable: inside the real app the
 * flag can be set and this still stays false, so no build can ship a webview
 * writing to an imaginary disk.
 */
const USE_MOCK =
  (import.meta.env.DEV ||
    (globalThis as { __PROSCENIUM_FIXTURE__?: boolean }).__PROSCENIUM_FIXTURE__ === true) &&
  !isTauri();
/**
 * The `expected` hash of a file that does not exist: every real hash differs,
 * so a guarded write with it lands only where nothing is (vault/mod.rs).
 */
export const NO_FILE_YET = "";

let mockPromise: Promise<typeof import("./dev-mock").devVault> | null = null;
function mock() {
  return (mockPromise ??= import("./dev-mock").then((m) => m.devVault));
}

interface FolderGrant {
  handle: string;
  path: string;
}
const folderGrants = new Map<string, FolderGrant>();
let beaconQueue = Promise.resolve();
function rememberFolder(grant: FolderGrant | null): string | null {
  if (!grant) return null;
  folderGrants.set(grant.path, grant);
  return grant.path;
}
/** Paths remain useful labels to the workspace. Only native-issued handles
 * cross an opening or remembering command; descendants are checked in Rust. */
async function folderHandle(path: string): Promise<string> {
  const known = folderGrants.get(path);
  if (known) return known.handle;
  const parent = [...folderGrants.values()]
    .filter((g) => path.startsWith(`${g.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
  if (!parent) throw new Error("Choose this folder in the folder panel before opening it.");
  const grant = await invoke<FolderGrant>("vault_folder_below", {
    handle: parent.handle,
    relative: path.slice(parent.path.length + 1),
  });
  rememberFolder(grant);
  return grant.handle;
}

/** App-owned practice only: callers cannot supply a filesystem path. */
export interface PracticeSource {
  session?: string;
  dir: string;
}
export const tutorials = {
  session: (id: string, create: boolean): Promise<string> =>
    USE_MOCK
      ? mock().then((m) => m.tutorialSession(id, create))
      : invoke<FolderGrant>("tutorials_session", { id, create }).then((g) => rememberFolder(g)!),
  sessions: (): Promise<string[]> =>
    USE_MOCK ? mock().then((m) => m.tutorialSessions()) : invoke("tutorials_sessions"),
  reserveCopy: (name: string): Promise<void> =>
    USE_MOCK
      ? mock().then((m) => m.tutorialReserveCopy(name))
      : invoke("tutorials_reserve_copy", { name }),
  copyFile: (source: PracticeSource, relative: string, destination: string): Promise<void> =>
    USE_MOCK
      ? mock().then((m) => m.tutorialCopyFile(source, relative, destination))
      : invoke("tutorials_copy_file", {
          id: source.session ?? null,
          legacy: source.session ? null : source.dir,
          relative,
          destination,
        }),
  trash: (id: string): Promise<void> =>
    USE_MOCK ? mock().then((m) => m.tutorialTrash(id)) : invoke("tutorials_trash", { id }),
  root: (): Promise<string> =>
    USE_MOCK
      ? mock().then((m) => m.tutorialRoot())
      : invoke<FolderGrant>("tutorials_root").then((g) => rememberFolder(g)!),
  read: (): Promise<{ content: string | null; hash: string }> =>
    USE_MOCK ? mock().then((m) => m.tutorialRead()) : invoke("tutorials_read"),
  write: (content: string, expected: string, preserve = false): Promise<string> =>
    USE_MOCK
      ? mock().then((m) => m.tutorialWrite(content, expected, preserve))
      : invoke("tutorials_write", { content, expected, preserve }),
};

export const vault = {
  savedCopies: (): Promise<SavedCopy[]> =>
    USE_MOCK ? mock().then((m) => m.savedCopies()) : invoke("vault_saved_copies"),
  readSavedCopy: (id: string): Promise<string> =>
    USE_MOCK ? mock().then((m) => m.readSavedCopy(id)) : invoke("vault_read_saved_copy", { id }),
  onSavedCopies: (cb: (root: string) => void): Promise<UnlistenFn> =>
    USE_MOCK
      ? mock().then((m) => m.onSavedCopies(cb))
      : listen<string>("vault://saved-copies", (event) => cb(event.payload)),
  /**
   * Open the platform folder picker; resolves to the chosen path or null.
   * `start` is the folder it opens at, when the app already knows which one
   * the writer means (a play opened from Finder whose folder needs a grant).
   */
  pickFolder: (start?: string, message?: string): Promise<string | null> =>
    USE_MOCK
      ? mock().then((m) => m.pickFolder())
      : invoke<FolderGrant | null>("vault_pick_folder", {
          start: start ?? null,
          message: message ?? null,
        }).then(rememberFolder),
  /**
   * What a folder is before it becomes the Plays folder (docs/app/keeping-work/storage-and-file-format.md#STOR-D2, docs/app/keeping-work/storage-and-file-format.md#STOR-D11): a
   * play, inside one, and which providers keep it.
   */
  folderFacts: (path: string): Promise<FolderFacts> =>
    USE_MOCK ? mock().then((m) => m.folderFacts(path)) : invoke("vault_folder_facts", { path }),
  /**
   * Point the app at a folder: the Plays folder, or one play. `playId` is
   * passed only for a play, and only so a recoverable delete on mobile lands
   * in that play's app data rather than inside the play folder (docs/app/keeping-work/storage-and-file-format.md#STOR-D10).
   */
  open: (path: string, playId?: string): Promise<OpenResult> => {
    // Nothing written from here until the open lands belongs to a play.
    vaultOpenedAt(null);
    return (
      USE_MOCK
        ? mock().then((m) => m.open(path))
        : folderHandle(path).then((handle) =>
            invoke<OpenResult>("vault_open", { handle, playId: playId ?? null }),
          )
    ).then((opened) => {
      vaultOpenedAt(playId ?? null);
      return opened;
    });
  },
  list: (relDir: string): Promise<VaultEntry[]> =>
    USE_MOCK ? mock().then((m) => m.list(relDir)) : invoke("vault_list", { relDir }),
  read: (rel: string): Promise<ReadResult> =>
    USE_MOCK ? mock().then((m) => m.read(rel)) : invoke("vault_read", { rel }),
  /**
   * Guarded write (docs/app/keeping-work/storage-and-file-format.md#STOR-D9). Neither failure writes anything.
   *
   * `rebasable` marks the PLAY FILE, which has several legitimate writers: a
   * mismatch comes back as `stale` carrying disk truth, and the caller rebuilds
   * its change on that base. Everything else comes back as `collision`, and the
   * caller pins a version — no conflict sibling is ever written into a play.
   *
   * A write that throws rejects with a `VaultWriteError`: the disk refused it
   * (save-failure.ts says why, in a writer's words).
   */
  write: (
    rel: string,
    content: string,
    expected: string | null,
    rebasable = false,
  ): Promise<WriteOutcome> => {
    // What lands is what the writer has: Changes follows it (own-writes.ts).
    const landed = sendingWrite(rel, content);
    return (
      USE_MOCK
        ? mock().then((m) => m.write(rel, content, expected, rebasable))
        : invoke<WriteOutcome>("vault_write", { rel, content, expected, rebasable })
    ).then(
      (out) => {
        landed(out.status === "ok");
        return out;
      },
      (said: unknown) => {
        throw new VaultWriteError(said);
      },
    );
  },
  /**
   * Write a file that must not exist yet: a new play's script and play file,
   * or the `.fdx` kept beside them. Anything already at `rel` is
   * left exactly as it is, and this rejects.
   *
   * It asks the guarded write to expect a hash no content has, so the write
   * refuses wherever a file already is — one check, in Rust, next to the
   * rename, rather than an `exists` a moment earlier.
   */
  create: async (rel: string, content: string): Promise<string> => {
    const out = await vault.write(rel, content, NO_FILE_YET);
    if (out.status !== "ok") throw new Error(`“${rel}” is already there, so it was left alone.`);
    return out.hash;
  },
  /** Binary originals use the same create-only guarded writer. */
  createBinary: async (rel: string, base64: string): Promise<string> => {
    decodeBytes(base64); // Enforce the document limit before crossing IPC.
    const out = USE_MOCK
      ? await mock().then((m) => m.write(rel, atob(base64), NO_FILE_YET))
      : await invoke<WriteOutcome>("vault_create_binary", { rel, base64 });
    if (out.status !== "ok") throw new Error(`“${rel}” is already there, so it was left alone.`);
    return out.hash;
  },
  exists: (rel: string): Promise<boolean> =>
    USE_MOCK ? mock().then((m) => m.exists(rel)) : invoke("vault_exists", { rel }),
  /** Move to the OS trash (recoverable) — the user-facing delete. */
  trash: (rel: string): Promise<void> =>
    USE_MOCK ? mock().then((m) => m.trash(rel)) : invoke("vault_trash", { rel }),
  /** Atomically relocate a file/dir within the vault (binder move/rename). */
  rename: (from: string, to: string): Promise<void> =>
    USE_MOCK ? mock().then((m) => m.rename(from, to)) : invoke("vault_rename", { from, to }),
  beginMove: (from: string, to: string, manifest: string, payload: string): Promise<MoveStart> =>
    USE_MOCK
      ? mock().then((m) => m.beginMove(from, to, manifest, payload))
      : invoke("vault_begin_move", { from, to, manifest, payload }),
  finishMove: (id: string): Promise<void> =>
    USE_MOCK ? mock().then((m) => m.finishMove(id)) : invoke("vault_finish_move", { id }),
  rollbackMove: (id: string): Promise<void> =>
    USE_MOCK ? mock().then((m) => m.rollbackMove(id)) : invoke("vault_rollback_move", { id }),
  /** Create a directory (and parents) — a new binder folder. */
  mkdir: (rel: string): Promise<void> =>
    USE_MOCK ? mock().then((m) => m.mkdir(rel)) : invoke("vault_mkdir", { rel }),
  /**
   * Show the folder in Finder (native only; browser dev is a no-op). With `rel`,
   * reveals and SELECTS that file, so "Reveal in Finder" on a binder row lands
   * on the row's own file instead of the vault root.
   */
  reveal: (rel?: string): Promise<void> =>
    USE_MOCK ? Promise.resolve() : invoke("vault_reveal", { rel: rel ?? null }),
  /**
   * The app's own iCloud Drive container — the zero-click default for where
   * plays live (docs/app/keeping-work/storage-and-file-format.md#STOR-D12), shown in Finder as iCloud Drive › Proscenium.
   * Null when iCloud is unavailable (not signed in, or disabled), in which
   * case the welcome screen does not offer it.
   */
  cloudRoot: (): Promise<string | null> =>
    USE_MOCK
      ? mock().then((m) => m.cloudRoot())
      : invoke<FolderGrant | null>("vault_cloud_root").then(rememberFolder),
  /**
   * The app's own Documents directory — always available, needing no picker
   * and no grant. Mobile's fallback when there is no container.
   */
  defaultRoot: (): Promise<string> =>
    USE_MOCK
      ? mock().then((m) => m.defaultRoot())
      : invoke<FolderGrant>("vault_default_root").then((grant) => {
          rememberFolder(grant);
          return grant.path;
        }),
};

/**
 * What this build can do. The UI branches on **capabilities, never on platform
 * names** — docs/engineering/cross-platform.md#PLAT-D100's rule is that an `if (platform === …)` in React
 * means platform difference has leaked above the vault. A new platform answers
 * this record; it does not edit the components.
 */
export interface Capabilities {
  canPickFolder: boolean;
  /** The picker can show why the last folder was refused (not the iOS document picker). */
  pickerShowsMessage: boolean;
  canReveal: boolean;
  canExportAnywhere: boolean;
  /** False where the external-change contract rests on foreground rescan. */
  canWatchFiles: boolean;
}

/** Browser dev is a desktop-shaped host: everything except the native bits. */
const MOCK_CAPABILITIES: Capabilities = {
  canPickFolder: true,
  pickerShowsMessage: true,
  canReveal: false,
  canExportAnywhere: false,
  canWatchFiles: true,
};

/** Memoized: a build's capabilities cannot change while it runs. */
let capsPromise: Promise<Capabilities> | null = null;

export const platform = {
  capabilities: (): Promise<Capabilities> =>
    (capsPromise ??= USE_MOCK
      ? Promise.resolve(MOCK_CAPABILITIES)
      : invoke<Capabilities>("capabilities")),
  /** The page's first frame is on screen (src-tauri/src/window_color.rs). */
  pagePainted: (): Promise<void> => (USE_MOCK ? Promise.resolve() : invoke<void>("page_painted")),
};

/** One version (docs/app/keeping-work/storage-and-file-format.md#STOR-D10), newest first from `list`. */
export interface VersionEntry {
  name: string;
  /** ISO-8601 UTC taken-at time. */
  ts: string;
  /** Why it was taken: save | pre-reload | pre-reload-at-banner | pre-keep |
   *  pre-restore | collision. */
  reason: string;
  size: number;
  /** True when the ring may never prune it — it is the only copy of something. */
  pinned: boolean;
}

/**
 * Versions — a script's earlier states, under the app's own data directory
 * keyed by play id (docs/app/keeping-work/storage-and-file-format.md#STOR-D10), never inside the Plays folder.
 *
 * Content-based: the caller supplies the state to preserve (the session's, not
 * the disk's), because before an external reload only the session still holds
 * "ours".
 */
export const versions = {
  snapshot: (
    playId: string,
    scriptId: string,
    reason: string,
    content: string,
    ext = "fountain",
  ): Promise<string> =>
    USE_MOCK
      ? mock().then((m) => m.versionSnapshot(playId, scriptId, reason, content, ext))
      : invoke("versions_snapshot", { playId, scriptId, reason, content, ext }),
  list: (playId: string, scriptId: string): Promise<VersionEntry[]> =>
    USE_MOCK
      ? mock().then((m) => m.versionList(playId, scriptId))
      : invoke("versions_list", { playId, scriptId }),
  read: (playId: string, scriptId: string, name: string): Promise<string> =>
    USE_MOCK
      ? mock().then((m) => m.versionRead(playId, scriptId, name))
      : invoke("versions_read", { playId, scriptId, name }),
};

/**
 * The rest of a play's app data (docs/app/keeping-work/storage-and-file-format.md#STOR-D10): the Changes baselines and
 * before-texts, recovery snapshots, the derived cache. Same directory as
 * Versions, same guarantee — deleting all of it loses no writing.
 */
export const playStore = {
  read: (playId: string, rel: string): Promise<string | null> =>
    USE_MOCK ? mock().then((m) => m.storeRead(playId, rel)) : invoke("store_read", { playId, rel }),
  write: (playId: string, rel: string, content: string): Promise<void> =>
    USE_MOCK
      ? mock().then((m) => m.storeWrite(playId, rel, content))
      : invoke("store_write", { playId, rel, content }),
  remove: (playId: string, rel: string): Promise<void> =>
    USE_MOCK
      ? mock().then((m) => m.storeRemove(playId, rel))
      : invoke("store_remove", { playId, rel }),
};

/**
 * Recovery snapshots (docs/app/keeping-work/storage-and-file-format.md#STOR-D10): what a script's buffer held while autosave
 * could not land it, one per editor session, in app data. The envelope and the policy
 * are the frontend's (recovery-policy.ts); these only move the bytes.
 */
export interface RecoveryFile {
  scriptId: string;
  owner: string;
  content: string;
}
export const recovery = {
  write: (playId: string, scriptId: string, content: string, owner: string): Promise<void> =>
    USE_MOCK
      ? mock().then((m) => m.recoveryWrite(playId, scriptId, content, owner))
      : invoke("recovery_write", { playId, scriptId, content, owner }),
  read: (playId: string, scriptId: string, owner: string): Promise<string | null> =>
    USE_MOCK
      ? mock().then((m) => m.recoveryRead(playId, scriptId, owner))
      : invoke("recovery_read", { playId, scriptId, owner }),
  remove: (playId: string, scriptId: string, owner: string): Promise<void> =>
    USE_MOCK
      ? mock().then((m) => m.recoveryRemove(playId, scriptId, owner))
      : invoke("recovery_remove", { playId, scriptId, owner }),
  release: (playId: string, scriptId: string, owner: string): Promise<void> =>
    USE_MOCK
      ? mock().then((m) => m.recoveryRelease(playId, scriptId, owner))
      : invoke("recovery_release", { playId, scriptId, owner }),
  list: (playId: string, scriptId?: string): Promise<RecoveryFile[]> =>
    USE_MOCK
      ? mock().then((m) => m.recoveryList(playId, scriptId))
      : invoke("recovery_list", { playId, scriptId: scriptId ?? null }),
};

/** What Rust saw about a folder (lib.rs `FolderFacts`). */
export interface FolderFacts {
  path: string;
  isPlay: boolean;
  insidePlay: string | null;
  /** `icloud`, `dropbox`, `syncthing`, … in detection order. */
  providers: string[];
  /**
   * Its contents can be listed now. False under the App Sandbox for a folder
   * the writer has not picked with the panel yet — it has to be granted before
   * it can be opened.
   */
  listable: boolean;
}

/** What Rust saw around a path opened from Finder (opens.rs `OpenedFacts`). */
export interface OpenedFacts {
  path: string;
  exists: boolean;
  isDir: boolean;
  /** Folders directly holding play files, nearest first. */
  playDirs: { dir: string; playFiles: string[] }[];
}

/**
 * Files opened from Finder (docs/app/keeping-work/storage-and-file-format.md#STOR-D5): drained when the UI is ready, and on
 * every `app://opened` signal after that. Facts and reads work only for paths
 * that arrived this way.
 */
export const opened = {
  take: (): Promise<string[]> =>
    USE_MOCK ? mock().then((m) => m.openedTake()) : invoke("opens_take"),
  facts: (path: string): Promise<OpenedFacts> =>
    USE_MOCK
      ? mock().then((m) => m.openedFacts(path))
      : invoke<OpenedFacts & { folder: FolderGrant | null }>("opened_facts", { path }).then(
          (facts) => {
            rememberFolder(facts.folder);
            return facts;
          },
        ),
  read: (path: string): Promise<ReadResult> =>
    USE_MOCK ? mock().then((m) => m.openedRead(path)) : invoke("opened_read", { path }),
  readBytes: async (path: string): Promise<Uint8Array> => {
    if (USE_MOCK) return mock().then((m) => m.openedReadBytes(path));
    return decodeBytes(await invoke<string>("opened_read_binary", { path }));
  },
  /** A package-form document (a `.pages` folder) as its files; null for a plain file. */
  readPackage: async (path: string): Promise<{ path: string; bytes: Uint8Array }[] | null> => {
    if (USE_MOCK) return mock().then((m) => m.openedReadPackage(path));
    const files = await invoke<{ path: string; base64: string }[] | null>("opened_read_package", {
      path,
    });
    return files && files.map((f) => ({ path: f.path, bytes: decodeBytes(f.base64) }));
  },
};

/** One user-authored format file from the per-app config dir. */
export interface UserFormatFile {
  fileName: string;
  content: string;
}

/**
 * The user's custom script-format files (<app-config-dir>/formats/*.json),
 * raw — parsing/validation is the format module's job (Rust stores bytes,
 * TypeScript assigns meaning). Every call names a bare file name, never a path.
 */
export const formats = {
  listUser: (): Promise<UserFormatFile[]> =>
    USE_MOCK ? mock().then((m) => m.listUserFormats()) : invoke("list_user_formats"),
  /** Write one format file into the formats folder, atomically (the designer's Save). */
  save: (fileName: string, content: string): Promise<void> =>
    USE_MOCK
      ? mock().then((m) => m.saveUserFormat(fileName, content))
      : invoke("save_user_format", { fileName, content }),
  /** Move one format file to the Trash; a file already gone is not an error. */
  trash: (fileName: string): Promise<void> =>
    USE_MOCK
      ? mock().then((m) => m.trashUserFormat(fileName))
      : invoke("trash_user_format", { fileName }),
  /** A format file the writer picks in the Open panel, not yet saved; null when they cancel. */
  importFile: (): Promise<UserFormatFile | null> =>
    USE_MOCK ? mock().then((m) => m.importFormatFile()) : invoke("import_format_file"),
  /** Save a copy wherever the writer chooses; resolves to where, or null when cancelled. */
  exportFile: (suggestedName: string, content: string): Promise<string | null> =>
    USE_MOCK
      ? mock().then((m) => m.exportFormatFile(suggestedName, content))
      : invoke("export_format_file", { suggestedName, content }),
};

/** Uint8Array → base64 without blowing the arg-spread stack on big files. */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** What an export writes: a PDF, or a document for a word processor
 * (docs/app/formatting/formats-and-layout.md#FMT-145). */
export type ExportFileType = "pdf" | "docx" | "odt";

/**
 * Export delivery. Native: platform save dialog, then the Rust `save_export`
 * command writes the bytes (temp + rename). Browser dev: a blob download.
 * `saveFile` returns a user-facing description of where the file went, or null
 * if the user cancelled. `type` names the panel and its file filter.
 */
export const exporter = {
  saveFile: async (
    suggestedName: string,
    bytes: Uint8Array,
    type: ExportFileType = "pdf",
  ): Promise<string | null> => {
    if (USE_MOCK) return mock().then((m) => m.saveFile(suggestedName, bytes, type));
    return invoke("save_export", { suggestedName, base64: toBase64(bytes), kind: type });
  },
  /**
   * Hand a finished PDF to the print panel. Native: the Rust `print_export`
   * command opens the system panel on the window (PDFKit, at 100%). Browser
   * dev: the PDF opens in a tab, whose viewer prints. Resolves once the panel
   * is up — what the writer does in it is the panel's business.
   */
  print: async (jobTitle: string, bytes: Uint8Array): Promise<void> => {
    if (USE_MOCK) return mock().then((m) => m.printFile(jobTitle, bytes));
    return invoke("print_export", { jobTitle, base64: toBase64(bytes) });
  },
};

/** Version, architecture and channel, for Settings › About and Updates. */
export interface AppInfo {
  /** The whole version: a track build's has its pre-release, `1.0.1-alpha.57`. */
  version: string;
  /** The running code's architecture: `aarch64`, `x86_64`, or `browser` in dev. */
  arch: string;
  /**
   * What updates this copy: `developer-id` the app itself, `app-store` the
   * store, `local` nothing (a copy built here by app:install). `browser` in dev.
   */
  channel: "developer-id" | "app-store" | "local" | "browser";
}

/**
 * App-global preferences, stored OUTSIDE any vault (in the per-app config dir):
 * the typed settings model (settings-model.ts, settings.rs), the last Plays
 * folder, and the few native actions Settings offers.
 */
export const settings = {
  /** Every preference, with its default where the writer has not chosen. */
  get: (): Promise<Settings> =>
    USE_MOCK ? mock().then((m) => m.getSettings()) : invoke("get_settings"),
  /**
   * Apply a partial patch. Validated and written atomically by settings.rs,
   * all or nothing; resolves to the settings as stored, and rejects — writing
   * nothing — when any part of the patch is invalid.
   */
  update: (patch: SettingsPatch): Promise<Settings> =>
    USE_MOCK ? mock().then((m) => m.updateSettings(patch)) : invoke("update_settings", { patch }),
  /** Show the Plays folder in Finder (Settings › General). Native only. */
  revealPlaysFolder: (): Promise<void> =>
    USE_MOCK ? Promise.resolve() : invoke("reveal_plays_folder"),
  /** Open `<app config>/formats`, creating it first (Settings › Formats). Native only. */
  openFormatsFolder: (): Promise<void> =>
    USE_MOCK ? Promise.resolve() : invoke("open_formats_folder"),
  /**
   * The GNU AGPL, in the writer's browser (Settings › About). The address is
   * Rust's (telemetry/allowlist.rs): the page names none. Browser dev opens
   * nothing.
   */
  openPrivacy: (): Promise<void> => (USE_MOCK ? Promise.resolve() : invoke("open_privacy")),
  openLicense: (): Promise<void> => (USE_MOCK ? Promise.resolve() : invoke("open_license")),
  /** What a sponsorship pays for, in the writer's browser (Settings › About › The Program). */
  openSupport: (): Promise<void> => (USE_MOCK ? Promise.resolve() : invoke("open_support")),
  appInfo: (): Promise<AppInfo> =>
    USE_MOCK ? mock().then((m) => m.appInfo()) : invoke("app_info"),
  /**
   * The Mac's accent colour as `#rrggbb` (accent.rs), for Follow Mac; null
   * where there is no Mac to ask, which leaves tokens.css's stand-in blue.
   */
  systemAccent: (): Promise<string | null> =>
    USE_MOCK
      ? mock().then((m) => m.systemAccent())
      : invoke<string | null>("system_accent").catch(() => null),
  getLastVault: (): Promise<string | null> =>
    USE_MOCK ? mock().then((m) => m.getLastVault()) : invoke("get_last_vault"),
  /**
   * The vault from the last launch, ready to open — the call the bootstrap
   * should make. Prefer this over `getLastVault`: on iOS a stored path is not
   * permission, and only this path resolves the security-scoped bookmark that
   * re-grants access (and re-persists it when iOS renews it). One command on
   * every platform, so the bootstrap needs no platform branch.
   */
  reopenLastVault: (): Promise<string | null> =>
    USE_MOCK
      ? mock().then((m) => m.getLastVault())
      : invoke<FolderGrant | null>("vault_reopen_last").then(rememberFolder),
  setLastVault: (path: string): Promise<void> =>
    USE_MOCK
      ? mock().then((m) => m.setLastVault(path))
      : folderHandle(path).then((handle) => invoke("set_last_vault", { handle })),
  /** Unsaved-work beacon the installer reads before replacing the app (docs/engineering/release-engineering.md#REL-63). */
  setBufferState: (dirty: boolean): Promise<void> => {
    const next = beaconQueue
      .catch(() => {})
      .then(() =>
        USE_MOCK
          ? mock().then((m) => m.setBufferState(dirty))
          : invoke<void>("set_buffer_state", { dirty }),
      );
    beaconQueue = next;
    return next;
  },
};

/**
 * Where updates stand (docs/engineering/release-engineering.md#REL-D6), as updates.rs reports it.
 * `unavailable` is this side's own: a build with no updater compiled in —
 * the App Store's and the iPad's, which their store updates.
 */
export type UpdateState =
  | { kind: "idle" }
  | { kind: "unconfigured" }
  | { kind: "unavailable" }
  | { kind: "checking" }
  | { kind: "upToDate"; checkedAt: number }
  | { kind: "downloading"; version: string; received: number; total: number | null }
  | { kind: "ready"; version: string; notes: string | null; publishedAt: number | null }
  | { kind: "installing"; version: string }
  | {
      kind: "failed";
      reason: "offline" | "signature" | "noKey" | "other";
      message: string;
      checkedAt: number;
    };

/** Why a restart did not happen: edits still saving, or nothing to install. */
export type RestartOutcome = { kind: "unsaved" } | { kind: "notReady" } | { kind: "installing" };

export interface FolderAccessIssue {
  path: string;
  message: string;
}
export const folderAccess = {
  state: (): Promise<FolderAccessIssue | null> =>
    USE_MOCK ? mock().then((m) => m.folderAccessState()) : invoke("folder_access_state"),
  retry: (): Promise<void> =>
    USE_MOCK ? mock().then((m) => m.folderAccessRetry()) : invoke("folder_access_retry"),
  onState: (cb: (state: FolderAccessIssue | null) => void): Promise<UnlistenFn> =>
    USE_MOCK
      ? mock().then((m) => m.onFolderAccess(cb))
      : listen<FolderAccessIssue | null>("folder-access://state", (e) => cb(e.payload)),
};

export const EVENT_UPDATE_STATE = "updates://state";

/**
 * The updater lives in Rust; the page only asks and listens. Browser dev and
 * smoke have no updater: they report a build that cannot check
 * (`unconfigured`), which is also what every development build says.
 */
export const updates = {
  state: (): Promise<UpdateState> =>
    USE_MOCK
      ? mock().then((m) => m.updateState())
      : invoke<UpdateState>("update_state").catch(() => ({ kind: "unavailable" }) as const),
  /** Check at once, whatever the automatic switch says. */
  check: (): Promise<UpdateState> =>
    USE_MOCK
      ? Promise.resolve({ kind: "unconfigured" })
      : invoke<UpdateState>("update_check").catch(() => ({ kind: "unavailable" }) as const),
  /** Install the downloaded update and relaunch into it; resolves only if it did not. */
  restart: (): Promise<RestartOutcome> =>
    USE_MOCK ? mock().then((m) => m.updateRestart()) : invoke("update_restart"),
  /**
   * One version's release notes, or the list of releases, in the writer's
   * browser. The address is Rust's; browser dev opens nothing.
   */
  openReleaseNotes: (version?: string): Promise<void> =>
    USE_MOCK ? Promise.resolve() : invoke("update_release_notes", { version: version ?? null }),
  onState: (cb: (state: UpdateState) => void): Promise<UnlistenFn> =>
    USE_MOCK
      ? mock().then((m) => m.onUpdateState(cb))
      : listen<UpdateState>(EVENT_UPDATE_STATE, (e) => cb(e.payload)),
};

/** The places a writer works, as `surface_shown` names them (telemetry/events.rs). */
export type Surface = "script" | "board" | "outline" | "cast" | "changes" | "format-designer";

/**
 * The events only the page sees happen (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D3). Closed,
 * as telemetry/events.rs `PageEvent` is: Rust refuses anything else, buckets
 * the count, turns a writer's own format id into `user`, and decides by itself
 * whether anything is sent at all.
 */
export type TelemetryEvent =
  | { name: "play_opened"; playsInFolder: number }
  | { name: "surface_shown"; surface: Surface }
  | { name: "pdf_exported"; kind: "whole" | "range" | "sides"; format: string }
  | { name: "format_saved" }
  /** Also kept in the local log of error codes, whatever the switch says. */
  | { name: "error_shown"; code: ErrorCode };

/**
 * Anonymous usage and crash reports go out from Rust only; the page can ask for
 * an event from the closed list and report an error's name and top frame, and
 * that is all. Fire and forget: a report never holds up, or breaks, what the
 * writer is doing.
 */
export const telemetry = {
  configured: (): Promise<boolean> =>
    USE_MOCK ? mock().then((m) => m.telemetryConfigured()) : invoke("telemetry_configured"),
  record: (event: TelemetryEvent): void => {
    const done = USE_MOCK
      ? mock().then((m) => m.recordTelemetry(event))
      : invoke("telemetry_record", { event });
    void done.catch(() => {});
  },
  /** An error the page did not catch, as a crash file: its name and top frame, never its message. */
  pageError: (name: string, frames: import("../diagnostics/page-error").PageFrame[]): void => {
    const done = USE_MOCK
      ? mock().then((m) => m.pageError(name, frames))
      : invoke("telemetry_page_error", { name, frames });
    void done.catch(() => {});
  },
};

/**
 * Help › Copy Diagnostics and Send Feedback (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D100
 * docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D5). Rust writes the text — no path, no play, no word — from what it keeps;
 * the page adds only the ids of the formats in use.
 */
export const diagnostics = {
  /** Put the diagnostics on the clipboard; resolves to the text copied. */
  copy: (formatsInUse: string[]): Promise<string> =>
    USE_MOCK
      ? mock().then((m) => m.copyDiagnostics(formatsInUse))
      : invoke("diagnostics_copy", { formatsInUse }),
  /** Read locally; neither the clipboard nor a browser is touched. */
  review: (formatsInUse: string[]): Promise<string> =>
    USE_MOCK
      ? mock().then((m) => m.reviewDiagnostics(formatsInUse))
      : invoke("diagnostics_review", { formatsInUse }),
};

export const EVENT_QUIT_REQUESTED = "app://quit-requested";

/**
 * Quitting (quit.rs, src/app/quit.ts): every quit asks the page first. The page
 * says it heard, keeps its words, and answers `go` — or not, and the app stays.
 * Desktop only: nothing asks on the iPad, so nothing answers there either.
 */
export const quit = {
  onRequested: (cb: (id: number) => void): Promise<UnlistenFn> =>
    USE_MOCK
      ? mock().then((m) => m.onQuitRequested(cb))
      : isTauri()
        ? listen<{ id: number }>(EVENT_QUIT_REQUESTED, (e) => cb(e.payload.id))
        : Promise.resolve(() => {}),
  heard: (id: number): Promise<void> =>
    USE_MOCK ? mock().then((m) => m.quitHeard(id)) : invoke("quit_heard", { id }),
  settled: (id: number, go: boolean): Promise<void> =>
    USE_MOCK ? mock().then((m) => m.quitSettled(id, go)) : invoke("quit_settled", { id, go }),
  /** Quit now, asking nothing: the writer chose Quit Anyway. */
  now: (): Promise<void> => (USE_MOCK ? mock().then((m) => m.quitNow()) : invoke("quit_now")),
};

export const EVENT_EXTERNAL_CHANGE = "vault://external-change";
export const EVENT_OPENED = "app://opened";

/** Finder opened something: `opened.take()` has it. The signal carries nothing. */
export function onOpened(cb: () => void): Promise<UnlistenFn> {
  if (USE_MOCK) return mock().then((m) => m.onOpened(cb));
  return listen(EVENT_OPENED, () => cb());
}
export const EVENT_CONFLICT_COPY = "vault://conflict-copy";

export function onExternalChange(cb: (e: ExternalChangeEvent) => void): Promise<UnlistenFn> {
  if (USE_MOCK) return mock().then((m) => m.onExternalChange(cb));
  return listen<ExternalChangeEvent>(EVENT_EXTERNAL_CHANGE, (e) => cb(e.payload));
}

export function onConflictCopy(cb: (e: ConflictCopyEvent) => void): Promise<UnlistenFn> {
  if (USE_MOCK) return mock().then((m) => m.onConflictCopy(cb));
  return listen<ConflictCopyEvent>(EVENT_CONFLICT_COPY, (e) => cb(e.payload));
}

/** Manual feedback is independent of the reports preference. */
export const feedback = {
  load: (): Promise<FeedbackDraft> =>
    USE_MOCK ? mock().then((m) => m.feedbackLoad()) : invoke("feedback_load"),
  save: (draft: FeedbackDraft): Promise<void> =>
    USE_MOCK ? mock().then((m) => m.feedbackSave(draft)) : invoke("feedback_save", { draft }),
  discard: (): Promise<void> =>
    USE_MOCK ? mock().then((m) => m.feedbackDiscard()) : invoke("feedback_discard"),
  send: (draft: FeedbackDraft, details: string | null): Promise<void> =>
    USE_MOCK
      ? mock().then((m) => m.feedbackSend(draft, details))
      : invoke("feedback_send", { draft, details }),
  copy: (message: string): Promise<void> =>
    USE_MOCK ? mock().then((m) => m.feedbackCopy(message)) : invoke("feedback_copy", { message }),
};
