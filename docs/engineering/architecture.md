# Architecture

[Engineering](README.md) › Architecture

The app separates durable storage from document meaning. This reference maps the process boundary, modules and document lifetimes.

[Stack](#ARCH-D101) · [Storage boundary](#ARCH-D102) · [Modules](#ARCH-D104) · [Sessions](#ARCH-D105)

## Requirements

Product boundaries are defined in [the product contract](../app/product.md).

## Design

<a id="ARCH-D100"></a>

### Architecture

<a id="ARCH-D101"></a>

#### Stack (decided — rationale, not relitigation)

| Layer | Choice | Why |
|-------|--------|-----|
| App shell | **Tauri v2** | Rust backend + web frontend + native filesystem, one codebase to macOS/iOS/Android. Electron was rejected because it cannot target mobile. |
| Editor core | **TipTap 3** (on ProseMirror) | A play is a structured document. ProseMirror's schema model maps directly onto play element node types, making real-time WYSIWYG tractable instead of a `contenteditable` nightmare. TipTap 3 is stable and ships the Decorations API and content-migration tooling we lean on. |
| Frontend | **React + TypeScript** | Mainstream, typed, pairs cleanly with TipTap's React bindings. |
| Fountain | **`fountain-js` (jonnygreenwald fork) for parse; `afterwriting`-derived serializer for write** | Don't write a grammar from scratch. Round-trip fidelity is a first-class requirement, so parse and serialize are treated as one tested module. |
| Storage | **Tauri `fs` + a platform vault abstraction** | Read/write/watch a user-chosen directory. Fountain for scripts, JSON sidecars for what Fountain can't express, one manifest per workspace. |
| Sync | **External Syncthing** | Never in the app. The app only stays *safe* in the presence of external changes. |

<a id="ARCH-D102"></a>

#### The single most important boundary

> **Rust stores bytes. TypeScript assigns meaning.**

The Rust core never needs to understand Fountain, the play schema, or card metadata to do its job. It opens a folder, lists it, reads and writes files **atomically and durably**, watches for external changes, and detects conflict artifacts. Everything semantic — parsing Fountain into a structured document, the ProseMirror schema, manifest interpretation, card↔scene reconciliation — lives in TypeScript.

This boundary is deliberate and load-bearing:

- It keeps a **single** Fountain implementation (in TS). Two parsers in two languages would drift, and drift breaks round-trip fidelity.
- It makes the Rust core small, auditable, and identical across platforms — which is exactly the code path where correctness (no data loss) matters most.
- It means nothing else ever needs the app at all: scripts are Fountain, structure is JSON, both are readable without any Proscenium code.

One consequence to accept: a future command-line tool that needs *structured* access to scripts must reuse the TS module (via Node or a wasm build), or accept that it only sees raw Fountain. We consider this acceptable because Fountain *is* the structured form for outside consumers.

<a id="ARCH-D103"></a>

#### Component map

```
┌──────────────────────────────────────────────────────────────────────┐
│  WEBVIEW  (React + TypeScript)                                         │
│                                                                        │
│  ┌────────────┐  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  Editor    │  │  Workspace  │  │   Fountain   │  │   Storage    │  │
│  │  (TipTap)  │  │  (binder /  │  │   engine     │  │   client     │  │
│  │  schema,   │  │  corkboard /│  │  parse ⇄     │  │  (wraps IPC, │  │
│  │  input     │  │  outliner)  │  │  serialize,  │  │  dirty-state,│  │
│  │  rules,    │  │  manifest   │  │  scene       │  │  conflict    │  │
│  │  keymap    │  │  client     │  │  reconcile   │  │  state)      │  │
│  └─────┬──────┘  └──────┬──────┘  └──────┬───────┘  └──────┬───────┘  │
│        └─────────────┬──┴────────────────┴─────────────────┘          │
│                      │   open / read / write / events                 │
└──────────────────────┼─────────────────────────────────────────────-─┘
                       │  Tauri IPC (commands + events)
┌──────────────────────┼────────────────────────────────────────────-──┐
│  RUST CORE (Tauri)   ▼                                                 │
│                                                                        │
│  ┌───────────────┐  ┌──────────────┐  ┌───────────────┐               │
│  │   vault       │  │   watcher    │  │   conflict    │               │
│  │  open folder, │  │  notify on   │  │  detect       │               │
│  │  list/read/   │  │  external    │  │  *.sync-      │               │
│  │  write,       │  │  change,     │  │  conflict-*,  │               │
│  │  ATOMIC write │  │  debounce,   │  │  surface,     │               │
│  │  (tmp+rename) │  │  self-write  │  │  never delete │               │
│  │               │  │  suppression │  │               │               │
│  └──────┬────────┘  └──────────────┘  └───────────────┘               │
│         │ platform backend (trait)                                     │
│   ┌─────┴───────────────────────────────────────────┐                 │
│   │ macOS/iOS: plugin-fs (+ iOS security-scoped      │                 │
│   │ bookmarks).  Android: tauri-plugin-android-fs    │                 │
│   │ (SAF tree URI).  See cross-platform.md.          │                 │
│   └──────────────────────────────────────────────────┘                │
└────────────────────────────────────────────────────────────────────-─┘
                       │ plain files
┌──────────────────────▼────────────────────────────────────────────-──┐
│  THE PLAYS FOLDER  (canonical — owned by the user)                     │
│  one folder per play: <Play>.proscenium (manifest, binder, cards)       │
│  +  *.fountain  +  characters/notes/research as .md   (a sync service   │
│     syncs this; storage-and-file-format.md is the contract)             │
└────────────────────────────────────────────────────────────────────-──┘
```

<a id="ARCH-D104"></a>

#### Frontend modules (`src/`)

- **`editor/`** — the TipTap schema (play element nodes + emphasis marks), input rules, the smart-entry keymap, and the live stage-format rendering (CSS + decorations). The heart of "how the writing feels." Spec: [`editor-ux.md`](../app/writing/editor-ux.md), [Fountain data model](fountain-model.md).
- **`workspace/`** — reads the manifest, renders the binder/outliner and the corkboard, maps drag-reorder back to disk ordering. Spec: [`workspace-model.md`](../app/organizing/workspace-model.md).
- **`fountain/`** — parse (`fountain-js`) and serialize (`afterwriting`-derived), plus scene extraction and the card↔scene reconciliation algorithm. Owns round-trip fidelity. Spec: [Fountain data model](fountain-model.md).
- **`storage/`** — the typed client over Tauri IPC. Tracks each open document's dirty flag and last-written content hash (the inputs to the conflict safety floor), debounces autosave, and reflects conflict state from the core. Spec: [`storage-and-file-format.md`](../app/keeping-work/storage-and-file-format.md).
- **`app/`, `ui/`** — shell, routing, panels, theming (including the e-ink theme).

<a id="ARCH-D105"></a>

#### Document sessions and the app shell

`app/useWorkspace.ts` adapts the script, binder and platform services to React.
`use-material-sessions.ts` owns each sheet's buffers, hash ancestry, serial
write queue, conflict choice and preservation. `use-outline-session.ts` owns
the same lifetime for the scratchpad, including words typed before its first
file exists. Their maps and buffer leases stay private; watchers, binder
changes, recovery and Versions use the controllers' operations.

Document operations capture a play and lifetime through `document-scope.ts`.
That lifetime lasts through save settlement and ends when the workspace is
cleared. Cancelling pending opens has a separate generation, so leaving can
cancel a late read while still allowing already accepted saves to finish.
`workspace-transition.ts` collects each session's settlement result before
leaving or quitting. Words kept nowhere hold the play open; a cancelled quit
keeps the same buffers attached.

`use-workspace-panes.ts` owns pane routing and the mounted editor's placement.
`use-shell-commands.ts` routes window keys and native menu actions through
narrow document and shell actions. `AppDialogs.tsx` hosts the existing dialogs
in their existing order; `ExportDialog.tsx` owns export preparation. The
stylesheet entrypoint lists feature sheets in a fixed cascade order, as
specified in DESIGN.md.

<a id="ARCH-D106"></a>

#### Rust modules (`src-tauri/src/`)

- **`vault/`** — the storage abstraction: a `Vault` trait (open a folder handle, `list`, `read`, `write_atomic`, `trash`, `exists`) with platform backends behind it. Atomic write = write to a sibling temp file, fsync, rename over the target. Emits a "self-write" token the watcher uses to suppress echo events.
- **`watcher/`** — wraps filesystem notifications, debounces bursts, drops events that match a recent self-write, and forwards real external changes to the frontend as events.
- **`conflict/`** — globs for `*.sync-conflict-*` and other Syncthing artifacts, tracks their presence per file, and exposes them to the frontend. **Never** deletes or rewrites them.

The vault is the only module that touches the **play folder**. The app-data store (`store/`: Versions, the Changes ledger, recovery snapshots) writes under Application Support through the vault's own atomic writer, and nothing else touches a file. Everything else asks one of the two.

<a id="ARCH-D107"></a>

#### Data flow

<a id="ARCH-D108"></a>

#### Opening a workspace

```mermaid
sequenceDiagram
  participant U as User
  participant FE as Frontend
  participant V as vault (Rust)
  participant FS as Folder
  U->>FE: Open folder…
  FE->>V: open_vault(path | picker)
  V->>FS: acquire handle (path / bookmark / SAF URI)
  V-->>FE: vault handle + permission persisted
  FE->>V: list(plays folder), read(<Play>.proscenium)
  V->>FS: read bytes
  V-->>FE: bytes
  FE->>FE: parse the play file, build binder/corkboard
  FE->>V: read(script.fountain)
  V-->>FE: bytes
  FE->>FE: fountain-js parse → scenes; reconcile cards by anchor
  FE->>FE: build ProseMirror doc; render stage format
  FE->>V: start_watch(vault)
```

<a id="ARCH-D109"></a>

#### Editing and autosave

The editor mutates the ProseMirror document in memory. A debounced autosave (default 600 ms idle, 2 s max wait) serializes the changed script to Fountain and writes it **atomically**; the play file is written the same way when card metadata or ordering changes. The frontend records the hash of exactly what it wrote, so the watcher can recognize and ignore the resulting change event.

```
ProseMirror doc --(serialize)--> Fountain text --(write_atomic)--> *.fountain
card/order change ---------------> JSON --------(write_atomic)----> <Play>.proscenium
                                   |
                                   └─ frontend stores lastWrittenHash[file]
```

<a id="ARCH-D110"></a>

#### External change arrives (the safety-critical path)

```
watcher sees change to F
   │
   ├─ hash(F) == lastWrittenHash[F]?  ── yes ─▶ ignore (our own write echoing back)
   │
   └─ no ─▶ is F open with unsaved edits?
              ├─ no  ─▶ reload F (re-parse, re-reconcile), update UI
              └─ yes ─▶ DO NOT discard in-memory edits.
                        Raise a quiet, non-blocking banner:
                        "This file changed on disk." → Keep mine / Load theirs / View diff
conflict module sees  *.sync-conflict-*  ─▶ quiet notice, list it, never touch it
```

This path is specified in full, with invariants, in [`storage-and-file-format.md`](../app/keeping-work/storage-and-file-format.md#STOR-D9). It is the part of the system most worth getting right.

<a id="ARCH-D111"></a>

#### Threading and performance notes

- File I/O and watching run on the Rust side off the UI thread; the webview never blocks on disk.
- Scripts are small (a full play is tens of kilobytes of text). Parsing and serializing on every autosave is cheap; no incremental-diff machinery is needed for v1. If profiling ever shows cost, serialize only the changed script, never the whole workspace (already the design).
- The corkboard and binder render from the manifest + per-script index, not by parsing every file on every interaction. Scene-level parse happens when a script is opened.

<a id="ARCH-D112"></a>

#### Security and trust posture

- The app accesses exactly one user-chosen folder tree (plus its own disposable cache). Tauri v2's capability model denies filesystem access by default; the app's capabilities grant scoped access to the selected vault only. See [`cross-platform.md`](cross-platform.md).
- Two outbound connections, both from Rust and both named in `src-tauri/src/telemetry/allowlist.rs`: the update check (GitHub) and anonymous usage and crash reports (Aptabase, EU; on by default, off in Settings › Privacy). The webview reaches nothing: its content security policy allows the app's own files and IPC only. See [`privacy-and-telemetry.md`](../app/keeping-work/privacy-and-telemetry.md). Sync, if any, is Syncthing, outside the app.
- Links inside research/notes are content, not executed. Opening external URLs is an explicit user action.
