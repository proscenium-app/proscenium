# Cross-platform behavior

[Engineering](README.md) › Platform behavior

Platform contracts define file authority and capabilities across desktop and mobile. They describe design obligations, not proof that every target is ready.

[Vault boundary](#PLAT-D101) · [macOS](#PLAT-D102) · [iOS](#PLAT-D103)

## Requirements

<a id="PLAT-D100"></a>

<a id="PLAT-1"></a>

**PLAT-1** One Tauri v2 codebase targets macOS, Windows, iOS and Android. The thing that actually differs across platforms is one thing: **how the app gains and keeps access to the user's chosen content folder.** Everything above the vault layer is platform-agnostic.

<a id="PLAT-D101"></a>

### The vault abstraction isolates all platform difference

<a id="PLAT-2"></a>

**PLAT-2** The Rust core exposes a single `Vault` trait; the frontend only ever sees it. Three backends implement it.

```
trait Vault {
  fn pick_folder() -> VaultHandle           // platform folder picker
  fn restore(handle: PersistedRef)          // re-open a previously granted folder
  fn list(dir) -> [Entry]
  fn read(path) -> bytes
  fn write_atomic(path, bytes)              // temp + verify + atomic replace
  fn remove(path)
  fn watch(cb) / rescan()                   // change notification (or foreground rescan)
}
```

| Platform | Picker | Persisting access | Read/write/list | Atomic write | Change watch | Requirement |
|----------|--------|-------------------|-----------------|--------------|--------------| --- |
| **macOS** | `plugin-dialog` folder picker, **or the app's iCloud container** (no picker) | **security-scoped bookmark**, path as a hint | own `LocalFsVault` | temp sibling + `fsync` + `rename` | `notify` | <a id="PLAT-3"></a>PLAT-3 |
| **iOS** (iPadOS) | our own document picker (`plugins/vault-picker`) | **security-scoped bookmark** | own `LocalFsVault` under scoped access; in iCloud Drive each listing and read inside a file coordinator's access ([PLAT-68](#PLAT-68)) | temp + rename within scoped access; in iCloud Drive inside a coordinated write | foreground rescan | <a id="PLAT-4"></a>PLAT-4 |
| **Android** | **SAF** tree picker | **persistable URI grant** | **`tauri-plugin-android-fs`** (SAF) | temp doc + verify + `DocumentsContract` replace | foreground rescan | <a id="PLAT-5"></a>PLAT-5 |
| **Windows** | `plugin-dialog` folder picker (no cloud container) | **the folder's NTFS identity**, recorded by Rust at the pick, path beside it | own `LocalFsVault` | hidden temp sibling + flush + write-through `MoveFileExW`; an exchange through `ReplaceFileW` | `notify` | <a id="PLAT-67"></a>PLAT-67 |

<a id="PLAT-6"></a>

**PLAT-6** **Bookmarks persist folder authority.** Under App Sandbox a stored
path is not permission on macOS either, so the security-scoped bookmark is the
durable identity on every platform that has one, and the path is only a hint
([docs/app/keeping-work/storage-and-file-format.md#STOR-D12](../app/keeping-work/storage-and-file-format.md)). `src-tauri/src/scope.rs` is the
macOS half; the iOS half is the picker plugin's. Windows has no sandbox and no
bookmark: Rust records the chosen folder's NTFS identity at the pick, and a
reopen holds the folder at that path to it
([docs/app/keeping-work/storage-and-file-format.md#STOR-179](../app/keeping-work/storage-and-file-format.md#STOR-179)).

<a id="PLAT-D102"></a>

### macOS (first runnable target)

<a id="PLAT-7"></a>

**PLAT-7** Two doors, and the writer chooses between them once on the welcome screen
([docs/app/keeping-work/storage-and-file-format.md#STOR-D12](../app/keeping-work/storage-and-file-format.md)):

- <a id="PLAT-8"></a> **PLAT-8** **The app's own iCloud Drive container** — shown in Finder as
  iCloud Drive › Proscenium. No picker, no
  bookmark, no entitlement beyond the container itself, and it syncs to an iPad
  running the app with no setup there either. This is the default, and it is
  the reason `~/Documents/Plays` is not: nothing can create a folder under
  Documents without the writer going through the panel anyway. **An iPad
  offers the same container first too**, as iCloud Drive › Proscenium in
  Files: its build declares the container in its entitlements and publishes
  the same public folder (`NSUbiquitousContainers`, in `src-tauri/Info.ios.plist`),
  and the folder-picker plugin asks for the container off the main thread
  (`FileManager.url(forUbiquityContainerIdentifier:)`), as Apple asks, since
  the first answer can take a while. The container is the app's own, so it
  needs no grant; a folder in it is in iCloud Drive, so every access there is
  coordinated ([PLAT-68](#PLAT-68)). Where there is no container to be had (no
  iCloud account, iCloud Drive off, or the app turned off in iCloud's
  settings) the Welcome screen does not offer it, on either system, and says
  nothing of it; Choose a Folder… stays the door to every other place.
- <a id="PLAT-9"></a> **PLAT-9** **A folder they choose** — the dialog plugin's folder picker, which is the
  door for Dropbox, OneDrive, Google Drive, Syncthing, and "just this Mac". The
  app takes a **security-scoped bookmark at that moment**, while the grant is
  fresh, because under the sandbox that click is the only thing that will ever
  make the folder readable again on a later launch.

<a id="PLAT-10"></a>

**PLAT-10** Read/write/list go through the app's own `LocalFsVault`, not `plugin-fs`.
Atomic write is a **hidden temp sibling in the target's own directory**,
`.<name>.<random>.tmp` → `fsync` → `rename` over the target
([docs/app/keeping-work/storage-and-file-format.md#STOR-D9](../app/keeping-work/storage-and-file-format.md)): same volume, so the rename is
really atomic, and the only dot-prefixed thing the app ever creates in a play.
 Filesystem watching uses the
`notify` crate with the debounce + self-write suppression from docs/app/keeping-work/storage-and-file-format.md#STOR-D9.

<a id="PLAT-11"></a>

**PLAT-11** Entitlements for the App Store build are in `src-tauri/Entitlements.plist`. A
locally installed build is signed ad hoc and gets none of them, which is
deliberate — see the comment in `scripts/install-app.mjs`.

<a id="PLAT-D103"></a>

### iOS

<a id="PLAT-12"></a>

**PLAT-12** The app is sandboxed; it reaches a user-chosen folder **outside** its container through the document picker, which returns a security-scoped URL. We persist a **security-scoped bookmark** so the folder re-opens on next launch. The picker plugin starts access to the folder when it is picked or its bookmark resolved, and holds it for as long as the app runs ([PLAT-25](#PLAT-25)), so the app's own `LocalFsVault` lists, reads and writes it with ordinary file calls, as on a Mac. A folder in the app's own Documents (On My iPad, shown in Files under Proscenium) needs no grant at all.

<a id="PLAT-68"></a>

**PLAT-68** **In iCloud Drive, every listing, read and replace is coordinated.** Apple's rule for a folder picked through the document picker is that its contents are read and written through a file coordinator, so that iCloud's own process, which syncs the folder, never meets a file half listed, half read or half replaced. When the vault opens a folder, the picker plugin says whether iCloud Drive syncs it (a ubiquitous item), and from then on each listing of it or of anything inside it, each read and each guarded write's check and replace runs inside access the plugin's `NSFileCoordinator` granted (`src-tauri/src/vault/coordination.rs`, `src-tauri/src/ipad.rs`). The write itself stays the vault's one atomic writer ([docs/app/keeping-work/storage-and-file-format.md#STOR-189](../app/keeping-work/storage-and-file-format.md#STOR-189)): the coordinator only says when it may run, holding a writing access `.forReplacing` while the vault writes its hidden sibling and renames it over the file. A listing asks for what is already known of a folder and fetches nothing, and what is not on the iPad is asked for by the app's own download passes ([PLAT-69](#PLAT-69)); a read waits for an evicted file to come down, and one that has not come down in twenty seconds is cancelled and read as "not finished downloading" ([PLAT-31](#PLAT-31)). Nothing inside a write's access asks for access again, since a read inside it would wait for the write, which would wait for the read. A folder on the iPad itself is not ubiquitous and pays nothing. A desktop vault coordinates nothing: a Mac's iCloud Drive materializes a file on read, and its File Provider takes the app's writes as any program's.

<a id="PLAT-69"></a>

**PLAT-69** **The app asks iCloud for the open folder itself.** Since iPadOS 16.4, iCloud Drive keeps what an iPad has not brought down as dataless items: a folder nothing has looked into has no entries on the iPad at all, and a file's bytes stay in the cloud. A listing coordinated for metadata alone waits for neither ([PLAT-68](#PLAT-68)). A Plays folder no app had looked into therefore listed as play folders with nothing in them: no play was found, the Plays screen said there were none and offered the sample play into a folder of plays, and the writer had to download the folder by hand in Files before any play appeared. So once a folder iCloud Drive keeps is open, the picker plugin's `downloadFolder` walks it a folder at a time. Each folder is listed inside a coordinated read with no options, which waits for iCloud to say what is in it, as Apple's own sample for a picked folder reads one; it is given up after ten seconds without an answer, and the pass after thirty. Each file that is not current is asked for with `startDownloadingUbiquitousItem`, one at a time, since asking for a folder is not documented to reach inside it; a stub `.<name>.icloud`, the form before dataless files, asks for the file it stands for ([PLAT-28](#PLAT-28)). It waits for none of them, and says how many it asked for, with each folder not looked into yet counted as one (`vault_download`, `src-tauri/src/ipad.rs`). Not used, and why: a metadata query in the scope of external documents finds nothing inside a picked folder (an open report to Apple since 2021), a file presenter's callbacks are a hint at best, and no API lets an app keep a folder downloaded, which on an iPad is the writer's own choice in Files.

- **In passes, while the folder is open** (`src/workspace/cloud-download.ts`): every second and a half while anything is still coming, every five seconds once nothing new has come for half a minute, once a minute after everything is down, and at once when the writer comes back to the app. Behind another app, nothing is asked.
- **What came down is found as before.** The Plays screen's discovery runs again whenever what is waiting changes, and with a play open its files are checked as a change from outside is ([PLAT-33](#PLAT-33)). A file another device changed is not current either, so the same passes bring a change made on the Mac to a play open on the iPad, with nothing asked of the writer.
- **Never "downloading" for ever.** An item whose download failed, or whose state iCloud does not say, is not waited for; a pass that gets no answer is no information, and nothing came down or went.
- **What the screen says** is [docs/app/keeping-work/storage-and-file-format.md#STOR-192](../app/keeping-work/storage-and-file-format.md#STOR-192): downloading, never "no plays", and no first play offered until the first pass has answered.
- **A folder iCloud Drive does not keep** is asked once and never again: a desktop's, whose iCloud Drive brings a file down as it is read, or one on the iPad itself.
- **Proven** in Chromium and WebKit against the in-memory vault under an iPad's record, and in the iPad simulator against a folder whose plays wait outside it, the probe build standing in for iCloud. The simulator has no iCloud account, so Apple's own download is proven on a writer's iPad, the first time it opens a folder it never downloaded.

<a id="PLAT-13"></a>

**PLAT-13** Realities to design around:

- <a id="PLAT-14"></a> **PLAT-14** **Watching is unreliable** under iOS backgrounding. Contract: the app **re-validates the open script and the play file on foreground** (cheap for small folders) in addition to best-effort notifications. The conflict floor (docs/app/keeping-work/storage-and-file-format.md#STOR-D9) makes a missed event safe — a stale buffer is detected on next read by hash, never silently overwritten.
- <a id="PLAT-15"></a> **PLAT-15** **Where the folder lives** is the writer's choice (On My iPad/iPhone, or an iCloud Drive / Files-provider location). Sync is out of scope for the app; the app neither knows nor cares which provider is behind the folder, beyond recognizing what one leaves behind ([docs/app/keeping-work/storage-and-file-format.md#STOR-D11](../app/keeping-work/storage-and-file-format.md)).
- <a id="PLAT-16"></a> **PLAT-16** **A recoverable delete has no OS trash to go to**, so it goes to Proscenium’s Trash: rings in app data, outside the Plays folder, so a delete on the iPad cannot be resurrected onto the Mac by the sync layer (`src-tauri/src/trash.rs`). What is deleted in a play goes to that play's ring, keyed by its id (`plays/<playId>/trash/`); practice from Help & Tutorials to `tutorials/trash/`; the writer's formats to `formats-trash/`; and the Plays folder has a ring beside the plays' (`trash/`), for a delete made with it open, which would be of a whole play. Each thing is kept whole under `<local time>-<name>`, and the ring's `manifest.json`, written whole or not at all ([docs/app/keeping-work/storage-and-file-format.md#STOR-106](../app/keeping-work/storage-and-file-format.md#STOR-106)), says where it came from, relative to the folder it was deleted from, when, and what the page said of it: for a binder row, the row, where it stood and its scripts' cards (`src/workspace/trash.ts`). The copy and its record are made before the original is removed, and a delete whose record cannot be written removes nothing. An entry kept before the manifest is read by its name, and a folder holding a play file of its own is a whole play. **The ring keeps a whole copy:** a play iCloud has evicted is a folder of names whose bytes are elsewhere, so what was evicted is fetched first, by a coordinated read ([PLAT-68](#PLAT-68)), and a delete with anything still in iCloud is refused before anything is copied: "Part of it is in iCloud and has not finished downloading to this device, so nothing was deleted." The page calls the ring by the record's trash word, Proscenium’s Trash ([PLAT-35](#PLAT-35)).
- <a id="PLAT-73"></a> **PLAT-73** **The writer puts a delete back from Proscenium’s Trash, on the Plays screen.** Where the capability record says the system keeps no trash of its own (`ownTrashDays`, an iPad's alone), the Plays screen offers Proscenium’s Trash, since every play is in its folder and anything kept can go back from there (`src/app/TrashSheet.tsx`). Each entry says what it was, which play it was in (or that it was a whole play, practice or a format), and when it was deleted. **Put Back** returns it where it was: into its play, found by the play's id since it may have been renamed, at its place in the binder with its cards; a whole play into the Plays folder; practice into Help & Tutorials; a format into the formats. It is made where nothing is, through the vault's own create-only writer, and where its name is taken it comes back beside its namesake as "<name> (put back)", never over it; practice, whose name is its identity, is refused instead, and so is an entry whose play is not in the Plays folder open, which stays in the trash. What happened is said aloud and under the list. A Mac and a PC show nothing new: their deletes go to the system's trash, where Finder and File Explorer put things back.
- <a id="PLAT-74"></a> **PLAT-74** **It keeps what it holds for as long as it says: 30 days.** The record's `ownTrashDays` is the span, and the page says it where a delete is made and where the trash is shown: a delete's toast says "Proscenium’s Trash, on the Plays screen, keeps it for 30 days if you need it later.", and the trash, "What you delete on this iPad is kept here for 30 days, and then removed for good." What has been kept longer is removed for good at launch and whenever the trash is read, as the iPad's own Recently Deleted empties itself after 30 days; a copy a stopped delete left half made, which was never an entry, goes after a day.

<a id="PLAT-D104"></a>

#### The folder picker is ours (`plugins/vault-picker`)

<a id="PLAT-17"></a>

**PLAT-17** **`tauri-plugin-dialog` implements file pickers on iOS but not a folder picker** ([plugins-workspace#933](https://github.com/tauri-apps/plugins-workspace/issues/933)) — `blocking_pick_folder` does not exist for the target and the app does not compile against it. Since a Plays folder *is* a folder, this is the one genuinely missing piece of the iOS port, so the app ships a small Tauri plugin: `UIDocumentPickerViewController` opened on `UTType.folder` with `asCopy: false`, then a bookmark so the grant survives relaunch.

<a id="PLAT-18"></a>

**PLAT-18** Two properties are the whole reason this shape was chosen over the obvious alternative (an app-owned iCloud container, which needs no picker at all). The iPad offers that container too, beside the picker and never instead of it, so that a writer who took a Mac's default finds their plays ([PLAT-8](#PLAT-8)); the picker keeps both properties:

- <a id="PLAT-19"></a> **PLAT-19** **It needs no entitlement.** Access comes from the writer choosing a folder, not from a capability — so no paid-membership entitlement, and nothing in the app is tied to iCloud.
- <a id="PLAT-20"></a> **PLAT-20** **It is sync-agnostic, and it is the same design Android needs.** The iPad can open any Files location; SAF's `ACTION_OPEN_DOCUMENT_TREE` + persistable URI grant is the identical shape behind the same type. An iCloud container would have been an iOS-only detour, thrown away when the Boox target lands.

Authority and build rules:

- <a id="PLAT-22"></a> **PLAT-22** **A path is not permission.** `settings.json` stores `lastVaultBookmark` beside `lastVault`; the bookmark is the durable identity and the path is a hint. Reopening goes through one command on every platform — `vault_reopen_last` — so the frontend bootstrap has no platform branch.
- <a id="PLAT-23"></a> **PLAT-23** **Resolving can renew.** iOS marks a bookmark stale when the item moves or its provider re-registers, and hands back a replacement *only* at resolve time. The replacement is persisted immediately; skipping that loses the grant a launch or two later, which would look like the plays randomly disappearing.
- <a id="PLAT-24"></a> **PLAT-24** **`.withSecurityScope` is macOS-only.** On iOS a bookmark made from a scoped URL resolves back to a scoped URL with no options — passing that flag is wrong here, not merely unnecessary.
- <a id="PLAT-25"></a> **PLAT-25** **Scope is held for the process lifetime.** `startAccessingSecurityScopedResource` is balanced in `deinit`; releasing it while a vault is open would fail every later read.
- <a id="PLAT-26"></a> **PLAT-26** **Deployment-target trap.** Tauri hands swift-rs an iOS floor of **13.0** unless `IPHONEOS_DEPLOYMENT_TARGET` is set (`tauri-utils::build::link_swift_library`), while the app's floor is iPadOS **17.0** ([PLAT-64](#PLAT-64)) — so the plugin's Swift would be compiled against a floor the app never ships. Inside Xcode's build the app target sets 17.0; outside it, in the iOS compile every batch with Rust files runs, nothing does, so the plugin's `build.rs` sets 17.0 when nothing has, and `Package.swift` declares `.iOS(.v17)` (tools 5.9) to match. swift-rs takes the triple from the former, not the latter, so both are needed. `tauri.conf.json`'s `bundle.iOS.minimumSystemVersion` says 17.0 too, and the committed Xcode project (`src-tauri/gen/apple`, generated from its `project.yml` and compared with git before it is trusted) holds the same floor and the iPad alone as its device family.
- <a id="PLAT-27"></a> **PLAT-27** The plugin exposes **no webview commands**. The app's own `vault_pick_folder` orchestrates pick → open → persist, keeping one guarded path into the vault.

<a id="PLAT-D105"></a>

#### iCloud eviction is a correctness problem, not a performance one

<a id="PLAT-28"></a>

**PLAT-28** **iCloud removes the contents of files it decides are not needed locally**, leaving a hidden stub named `.<original>.icloud` where the bytes used to be. A synced Plays folder on a fresh iPad is therefore a tree of *names* whose contents are in the cloud.

<a id="PLAT-29"></a>

**PLAT-29** Left unhandled this does not degrade gracefully — it lies. The binder would list hidden junk, every real play would be absent, and [docs/app/keeping-work/storage-and-file-format.md#STOR-D8](../app/keeping-work/storage-and-file-format.md) reconciliation would faithfully report the writer's scripts as gone from the folder. Two rules keep it honest, both inside the vault so nothing above it knows eviction exists:

- <a id="PLAT-30"></a> **PLAT-30** **`list` maps a stub to the name it stands for** (`vault::icloud::placeholder_target`), never its own. When both forms exist — the moment a download lands — the real file wins so nothing is listed twice.
- <a id="PLAT-31"></a> **PLAT-31** **`read` fetches on a miss.** A `NotFound` may be eviction rather than absence, so the command layer asks the platform to materialize and reads once more. The failure message is *"is in iCloud and has not finished downloading yet"*, deliberately **not** "missing": that wording is the difference between a slow network and a writer being told their play is gone.

<a id="PLAT-32"></a>

**PLAT-32** The fetch is `startDownloadingUbiquitousItem` plus polling, in the same Swift plugin. It short-circuits when the item is already local or is not a ubiquitous item at all (a Plays folder on the device itself), so a non-iCloud folder never pays a timeout. Polling rather than `NSMetadataQuery` because a read is a one-shot question with a caller already waiting, not a long-lived observation. Desktop needs none of this: APFS materializes dataless files transparently on read.

<a id="PLAT-D106"></a>

#### The foreground rescan

<a id="PLAT-33"></a>

**PLAT-33** Where the OS gives no reliable filesystem events, returning to the app is the moment to re-check: re-read the open script and its sidecar and hand the hashes to **the same handler a watcher event goes through**. There is exactly one place that judges "the file changed under us", so I1 (no silent loss of unsaved edits) holds on every platform for the same reason it holds on one — it is not re-implemented per platform.

<a id="PLAT-34"></a>

**PLAT-34** An evicted file that has not landed reports an error rather than content, and that is treated as "no information", never as a change or a deletion. Gated on `canWatchFiles`, so a build that grows a real watcher stops paying for the rescan automatically.

#### The iPad's own native layer

What the folder-picker plugin gives an iPad beside the folder: the Mac's menu, the keyboard's frame, a file opened from Files, and the plist the iPad's build carries. Rust hands the plugin what it needs at launch (`src-tauri/src/ipad.rs`), and what the plugin raises comes back on channels of Rust's own, emitted to the page in the order it was raised, from a thread of its own: a key command and a keyboard's change reach Rust inside UIKit's callback on the main thread, where an emit would run the page's script there and then.

<a id="PLAT-76"></a>

**PLAT-76** **The iPad's menu bar carries the Mac's menu.** The Mac's menus are tables in `src-tauri/src/menu.rs`, each item an id, a label and a chord. At launch Rust hands the same tables to the plugin, which builds iPadOS's main menu from them, in the Mac's order. An item chosen there, by its chord or in the menu bar, raises the same `menu://action` with the same id that a Mac's menu bar does, and `src/app/menu-actions.ts` answers it as it answers the Mac's.

- **iPadOS 26 and later:** iPadOS's main menu system, configured once, which iPadOS shows as its menu bar and, while ⌘ is held, as the list of shortcuts. File, View and Help take the app's items at the top of the system's own; Script and Play are menus of the app's own, after Edit and after View; Settings… (⌘,) is in the app's menu. The system's own document, printing, finding, text formatting, sidebar, toolbar, inspector and new-window items are left out, since the app's items carry those commands under the Mac's names and chords (⌘N, ⌘S, ⌘P, ⌘F, ⌘B) and the system's would be second copies; so is its Spelling menu, since the app's own checker marks words and Next Misspelling takes ⌘;. Edit's Undo, Redo, Cut, Copy, Paste and Select All stay the system's, as on a Mac.
- **iPadOS 17 to 25** have no menu bar, and their main menu is built only by the app's delegate, which is the windowing library's. So each item with a chord is a key command on the window's root view controller, on the responder chain whenever the page has focus, listed by its title while ⌘ is held. An item with no chord has no place there.
- **Left out:** Reveal in Finder, which an iPad cannot do. Check for Updates and the Window menu are not in the tables: TestFlight and the App Store update an iPad, and iPadOS keeps its windows' commands.
- **The menu takes a chord before the page does.** Pressed on a hardware keyboard in an iPad simulator (iPadOS 26.5, through Apple's UI testing), every chord the menu's items carry reached the menu and not the page's own listener, in the script and on a screen with nothing to type in, so a command runs once, by `menu://action`. The one exception is ⌘B, ⌘I and ⌘U while a line is being written, which WebKit hands the page first, and which the menu's item then has too: in an iPad simulator with a hardware keyboard each ⌘B reached the script's own binding and, 5 to 16 ms later, the menu's Bold, and the line was left as it was. They run once, by whichever way comes first (below). Where iPadOS's text system takes them instead, for its own bold, italic and underline, as it takes its screen keyboard's B, I and U, WebKit runs that as editing of its own and tells the page only by an input, `formatBold`, `formatItalic` or `formatUnderline`, with no key: in an iPad simulator with a hardware keyboard held attached, ⌘B reached neither the page's keys nor the menu, and the line stayed as it was. So each editor cancels those inputs and runs its own bold, italic or underline, the one its keys and its bar run (`src/ui/format-input.ts`), and nothing WebKit formats reaches the words behind the editor's back; a document, whose file has no underline, cancels its underline and does nothing. So one press can reach an editor by more than one way, its own key, the menu's item and the system's input, and a format asked of an editor another way within 300 ms of the same format is that press again: it runs once (`formatOnce`), and two presses the same way are two, however quick. A document's ⌘B and ⌘I are taken by its editor for this, ahead of its marks' own. The menu's Bold, Italic and Underline format the editor the keyboard is in, a document's as a document does, and the script only when no editor has the keyboard. The key commands iPadOS 17 to 25 are given routed the same, chord for chord, on iPadOS 26.5. A menu item waits behind a menu, a sheet or an alert, as its key does ([A11Y-3](../app/preferences-and-help/accessibility.md#A11Y-3)), all but a few that act over one (`src/app/menu-over-layers.ts`); Save is one of them while the format designer is up, so ⌘S saves the format in front of the writer. A Mac's page and a PC's hear ⌘S before their menu bar, and the designer takes it there; on an iPad the menu's Save waited behind the designer's own sheet and saved nothing.
- **No command run on the main thread asks the plugin's UIKit commands.** Tauri runs a command that is not async on the main thread, and the plugin's pasteboard, share sheet, print panel, link, background task and folder picker answer from it, so such a command that asked one waited on itself and the app answered nothing again: Send Feedback's Copy Message did, once its command was linked. Every command that reaches them is async or hands the call to a worker, and `scripts/main-thread-commands.test.ts` holds each command that is not async to never call them itself.
- **The page still binds every chord itself** (`menuBar` is false, [PLAT-35](#PLAT-35)), for a chord the menu does not take. Without the menu the page heard a chord only while something editable had focus, and nothing at all on the Plays screen or behind a sheet: on an iPad the menu is how a chord reaches a screen with nothing to type in.
- **What iPadOS and WebKit keep:** ⌘⌥D, a Mac's chord for Dialogue, is iPadOS's Dock, which also takes the keyboard from the app until the writer taps it again, so every chord after it reaches nothing. So on an iPad Dialogue is ⌘⇧D ([EDIT-72](../app/writing/editor-ux.md#EDIT-72)), the PC's chord for it: the menu takes it (`IPAD_KEYS`), the page binds it (`ipad` keys, [PLAT-35](#PLAT-35)), and iPadOS takes none of the ⌘⇧ chords. ⇧↩ and ⌘↩ reached neither the menu nor the page as keys, and neither did Escape. ⌘. reaches the page as an Escape keydown, iPadOS's own cancel: it closes what Escape closes and leaves Focus, the iPad's Escape for a keyboard with no Escape key. Asking UIKit to put the menu's key commands before the system's behaviour (`wantsPriorityOverSystemBehavior`) changed none of this: the Dock still took ⌘⌥D, and a key command of the app's for Escape was never called. So the menu leaves it as it is. ⌃⇥ and ⌃⇧⇥, which move between the window's areas ([A11Y-7](../app/preferences-and-help/accessibility.md#A11Y-7)), reached the page as the Control key alone, UIKit's own keyboard navigation taking the Tab: so the iPad's View menu, alone of the menus, carries Next Area and Previous Area at those chords (`IPAD_AREAS`), its Tab key commands put before the system's behaviour, and the page runs them as it runs its own ⌃⇥. The list of shortcuts iPadOS shows while ⌘ is held belongs to a hardware keyboard, which the simulator does not attach, so it is not proven here.

<a id="PLAT-77"></a>

**PLAT-77** **The keyboard's own frame.** The page is told how much of its window a docked keyboard covers, as UIKit lays the keyboard out: the screen's keyboard with its bar, or a hardware keyboard's shortcut bar, and 0 for a floating, split or hidden keyboard, which covers nothing the page could move out from under. The page's window is the web view's safe area (the viewport tag does not cover it), so what is told is the keyboard's overlap with the web view less the bottom safe area, the home indicator's strip, which the page never had. The plugin holds a hidden view between the web view's bottom and the top of UIKit's keyboard layout guide, with undocked keyboards not followed and the safe area not counted, and raises its height, less that strip, whenever it changes. Rust emits it as `app://keyboard`, `{ "inset": <CSS pixels> }`, and keeps the last one for a page that asks (`keyboard_inset`, an iPad's command alone). The page writes it into `--kb-inset` on the root element, where the shell pads by it, and once the app has spoken it reads nothing else (`src/app/use-keyboard-inset.ts`); a browser, a Mac and Windows, where the app never speaks, still measure the visual viewport, which on a desktop is 0. The visual viewport, which the page read before, follows what WebKit makes of the keyboard rather than the keyboard: a hardware keyboard's suggestion bar moved it in WebKit's bug 247410, and WebKit's own scroll moves it. A page that ever covers the safe area (`viewport-fit=cover`) is told too little by that strip, and the plugin must then measure against the whole web view. **The page is held where it is.** WebKit scrolls its whole page up to show the line being typed when a keyboard docks: in an iPad simulator (iPad Pro 11-inch, iPadOS 26.5), with the keyboard up under the script's last lines, it scrolled the web view 320 points, the page's top and its toolbar off the screen, while the shell's inset left a band as tall again above the keys. The page is a window, not a document, and scrolls inside its own panes, which ride above the keyboard by the inset; so the plugin holds the web view's own scroll at its top while the page is at its own zoom (a page the writer pinched larger may move), and with it the toolbar stays and the status bar rides on the keyboard's bar.

<a id="PLAT-78"></a>

**PLAT-78** **A file opened from Files is read where it is, through the grant Files gave.** The app opens documents in place ([PLAT-79](#PLAT-79)), so Files hands over the file itself, wherever it is, rather than a copy in the app's Inbox, as a URL that carries a grant to read it; a URL made again from its path carries none, and the read meets "Operation not permitted". The windowing library is the app's delegate, and passes on only the URL's text, so the plugin stands in front of its `application:openURL:options:` (`OpenedFiles.swift`), installed as the plugin starts, before UIKit starts the app, so that the file a launch from Files brings passes through it too. It starts the URL's access and keeps it, with a bookmark of it, for as long as the app runs, as the Plays folder's grant is kept ([PLAT-25](#PLAT-25)), and the URL goes on as before, to `RunEvent::Opened` and the page's open route ([docs/app/keeping-work/storage-and-file-format.md#STOR-D5](../app/keeping-work/storage-and-file-format.md)). Every read of an opened file is coordinated ([PLAT-68](#PLAT-68)), since Files may have opened it in iCloud Drive or another provider's folder. The grant reaches the file alone: a play opened from outside the Plays folder is offered as a new Plays folder, which the folder picker then grants, and a script no play holds is offered as a new play, its text read through the file's own grant.

<a id="PLAT-79"></a>

**PLAT-79** **The iPad's own plist.** The Tauri CLI writes an iOS build's `Info.plist` from, in order: the iOS project's own (`src-tauri/gen/apple/proscenium_iOS/Info.plist`), the version, the `Info.plist` beside `tauri.conf.json`, which is the Mac's, `src-tauri/Info.ios.plist`, and the document types from `tauri.conf.json`'s file associations. Each later file's keys replace the earlier ones' whole, and none takes a key away, so the Mac's keys reach the iPad too, where `LSApplicationCategoryType` and `LSRequiresNativeExecution` do nothing. What the iPad needs stands in `src-tauri/Info.ios.plist` on its own, never on the Mac's file: `ITSAppUsesNonExemptEncryption` false, which the iPad's bundle check refuses a build without; `LSSupportsOpeningDocumentsInPlace` and `UIFileSharingEnabled`, so a file opens where it is ([PLAT-78](#PLAT-78)) and the app's own Documents is On My iPad › Proscenium; and the container's public folder, `NSUbiquitousContainers` ([PLAT-8](#PLAT-8)). The container itself is in the app target's entitlements. The document types come from the file associations, as a Mac's do: a play (`org.habiby.proscenium.play`, which the app exports and owns) and a script (`org.habiby.proscenium.fountain`, which it exports, as an alternate); Pages documents, RTF and plain text by their system types. `.fdx`, `.docx`, `.odt` and `.md` reach the plist by their extension alone, which iPadOS does not read, so Files does not offer Proscenium for them; the import tool takes them through its own picker.

<a id="PLAT-80"></a>

**PLAT-80** **The window around the page.** Tauri's iPad window asks iPadOS for its minimal window controls (`.minimal`, the windowing library's choice), which iPadOS answers with a strip of its own along the window's top, holding its status bar and the controls, and widens the top safe area to take it; the home indicator's strip is the bottom safe area. The page lies inside the safe area (its viewport tag has no `viewport-fit=cover`), so WebKit sets it below the one and above the other, and nothing of the page is ever under the controls: in an iPad simulator, in a window and in full screen, either way up, light and dark, the web view's safe area was 32 points at the top and 20 or 25 at the bottom, and the toolbar's first button stood 3.75 points below the strip. WebKit hands a page nothing about the controls, and Apple publishes no size for them. What the strips show is what lies behind the page, the system's white or black, so the page names its chrome, `--chrome`, as its theme colour (`<meta name="theme-color">`, `src/ui/use-accent.ts`), light or dark as it is, and the folder-picker plugin paints that behind the web view, so the strips read as the app's own bars.

<a id="PLAT-D107"></a>

### Platform difference is a capability, not a branch

<a id="PLAT-35"></a>

**PLAT-35** The frontend asks the backend what this build can do (`capabilities()` → `canPickFolder`, `canReveal`, `canExportAnywhere`, `canWatchFiles`) and branches on that. This is how the "no `if (platform === …)` in React" rule below is actually kept: adding a platform means answering the record honestly, not editing components. The flags genuinely diverge — iOS has a folder picker but no file watching, Android has neither yet.
The record also says how this system speaks, since Windows joined (2026-10-14):
- **`keys`**, `mac`, `ipad` or `pc`: how every key the app shows is written, and which chord it binds. An iPad's is `ipad`: its keyboards have ⌘ and ⌥, and its chords are a Mac's in a Mac's glyphs but for Dialogue's, ⌘⇧D there, since iPadOS keeps ⌘⌥D for its Dock and nothing the app asks for wins it back ([EDIT-72](../app/writing/editor-ux.md#EDIT-72)); the iPad's menu takes the same chord (`IPAD_KEYS`, `src-tauri/src/menu.rs`). One formatter, `src/ui/keys.ts`, takes a shortcut written once in a Mac's glyphs and gives an iPad's chord, or a PC's in words (`Ctrl+Shift+E`), through one table for each where they differ. A PC's chords use Ctrl where a Mac's use ⌘, and never Ctrl+Alt, which is AltGr on many keyboards, nor the Windows key.
- **`words`**: the machine (`Mac`, `PC`, `iPad`), the system (`macOS`, `Windows`, `iPadOS`), its file manager (`Finder`, `File Explorer`, `Files`) and its trash (`Trash`, `Recycle Bin`, and on an iPad, which has no system trash, `Proscenium’s Trash`, the ring a delete goes to, [PLAT-16](#PLAT-16)), which `src/ui/system-words.ts` puts into every sentence that names them. No sentence names a Mac's word in the page's own code.
- **`suggestedFolder`**: where the Welcome screen suggests plays live first: `icloud` on a Mac and on an iPad, the app's own iCloud container, offered only where `vault_cloud_root` finds it ([PLAT-8](#PLAT-8)), so the record itself asks iCloud nothing at launch; `documents` (Documents › Plays) on Windows. Choose a Folder… is the door to every other place.
- **`print`**: `panel`, the system's print panel on the exported PDF (a Mac, and an iPad), or `pdf-app`, the exported PDF opened in the writer's own PDF app, which prints it (Windows).
- **`systemSpelling`**: whether the system's own spelling may run in the documents' editor. Not on an iPad: there WebKit turns smart quotes and smart dashes off only for an editable element whose spell checking is off, and iPadOS's Smart Punctuation would otherwise rewrite a writer's quotes and dashes in the file's bytes, where no rule can undo them. Every editable surface that holds a play's words has spell checking off there, and the app's own checker is the one that marks a word, in the documents as in the script ([EDIT-194](../app/writing/editor-ux.md#EDIT-194)).
- **`menuBar`**: whether a native menu bar carries the menu's commands and takes their chords before the page sees them. Not on an iPad, where the page binds every one of the menu's chords itself, and the play's document menu carries the commands a finger would otherwise have no way to ([PLAT-71](#PLAT-71)).
- **`titleBarOverlay`**: whether the window's title bar is drawn over the top of the page, its controls at the top left: a Mac's traffic lights (`titleBarStyle: Overlay`). There the top bar keeps their place clear and a sheet keeps a strip of title bar above it. Not on a PC, and not on an iPad, whose WebKit says it is a Mac's: the page asked the user agent until 2026-11, and gave an iPad 70 points of nothing beside its first control and a false title bar over every sheet.
- **`windowDrag`**: whether the page's top bars move the window, a press on their empty space asking it to start dragging (Tauri's drag regions, drawn through `dragRegion` in `src/ui/system-traits.ts`). Not on an iPad, whose windows move by the system's own handle and whose shell has no window to ask: until 2026-11 a tap on the toolbar's empty space there raised an error nothing caught.
- **`closeAt`**: which top corner this system puts a window's close control in: `left` on a Mac and an iPad (a Mac's traffic lights, an iPad window's controls), `right` on a PC. Settings, which stands in for a window of its own, puts its × there ([docs/app/preferences-and-help/settings.md#SET-43](../app/preferences-and-help/settings.md#SET-43)).
- **`ownTrashDays`**: where the system keeps no trash of its own (an iPad), how many days Proscenium’s Trash keeps what is deleted, which the Plays screen opens ([PLAT-73](#PLAT-73), [PLAT-74](#PLAT-74)); null where the system's trash takes a delete.

The page is given the record before its first render (`src/main.tsx`), so no component asks which system it is on. In the browser preview the record is a Mac's, which is what smoke's Chromium and WebKit passes hold.

<a id="PLAT-36"></a>

**PLAT-36** Two desktop-only surfaces are gated by it: **reveal-in-file-manager** and **export to a chosen path**. On an iPad, where no Save panel names a path, an export (a PDF, a `.docx`, an `.odt`, a format file) goes through the share sheet instead, to Files, a printer, Mail or AirDrop, staged in the app's cache under its own name; printing goes through the system's print panel, as on a Mac. One more differs beneath the vault: the `trash` crate has no iOS/Android platform module and *fails to compile* there, so mobile keeps the recoverable-delete contract with device-local `trash/<local time>-<name>` rings in **app data**, keyed by play id ([docs/app/keeping-work/storage-and-file-format.md#STOR-D10](../app/keeping-work/storage-and-file-format.md)) — outside the Plays folder deliberately, so a delete on the iPad cannot be resurrected onto the Mac by the sync layer — which the writer opens and puts back from as Proscenium’s Trash ([PLAT-16](#PLAT-16), [PLAT-73](#PLAT-73)).

<a id="PLAT-D113"></a>

### The iPad's page: any window, and a finger

Each of these asks the window and the pointer, never the platform ([PLAT-66](#PLAT-66)): a narrow window gets the narrow page on any system, and a finger gets a finger's page wherever the pointer is coarse. A Mac's window is never under 820 points and its pointer is never a finger, so a Mac's page is unchanged by any of them. Smoke holds them under the iPad's record, with a touch pointer, in an iPad's windows ([accessibility.md](../app/preferences-and-help/accessibility.md#A11Y-19)).

<a id="PLAT-75"></a>

**PLAT-75** **Any window an iPad gives the app,** from a third of a Split View (about 320 points) to the whole screen either way up, and a small Stage Manager window. The top bar folds rather than lay its centre over its own left side ([design-system.md](design-system.md#UI-65)). Below 700 points a rail lies over the page as a drawer, and the page keeps the window's width: beside it, at 320 points, the binder left the page 74 and pushed the window's content 400 past its edge. The drawer closes on what it opens. A menu is never wider than the window; a sheet takes nearly all of a narrow one, its sections run across its top where there is no room beside them (Settings), and its buttons, like the status bar's, take a second row rather than run past its side. A cast card's description goes under its name, a board's card is never wider than the board, and the Plays screen's bar keeps its search, with Import a Draft… left to New Play's menu.

<a id="PLAT-70"></a>

**PLAT-70** **A finger reaches every control.** On a coarse pointer each control is a 44-point target: the three control heights are 44 ([design-system.md](design-system.md#UI-48)); a switch, a checkbox and a radio keep their look and grow what a finger presses around it; what a pointer is shown on hover (a cast card's remove, a comment's actions, a card's "add a note") is shown to a finger at once; and a pull-down's chevron half opens its menu, where once only a one-point divider did. **A tooltip a finger can read:** a badge whose title carries news, a format's warnings, a play's pages "Not counted" and why, the binder's "missing" and its new-file dot, says so (`data-news`), and a finger's tap shows the title beside it and says it to a screen reader (`src/ui/TouchTip.tsx`). A pointer keeps its own tooltip. **A hover reveals nothing to a finger.** Whatever a hover shows (a pane tab's close box, an element's shortcut badge) is shown on hover only for a pointer that hovers, `@media (hover: hover)`, never `(any-hover: hover)`, which an iPad with a trackpad matches: a tap is a hover first, and WebKit on an iPad holds back the click of a tap whose hover shows something, so the tap only showed it and the writer tapped again (`src/app/hover-reveals.test.ts`). A component's own hover is the same: it runs on pointer events for a pointer that hovers alone (`src/ui/hover.ts`), and the same test refuses a component that listens for a mouse's hover itself. A comment card that marked its anchor in the script as a finger came onto it took every tap on its Save and its actions, and a menu row that opened its submenu on the hover held back its own click. **Nothing comes into view under a tap.** WebKit on an iPad gives a tap its click only if nothing it counts as actionable came into view while the finger was down, or in the moment after the tap's hover: anywhere in the page, not only under the finger. Every element inside the script's own text counts, and every button, field and link, and every element with a click listener of its own; a new one counts as much as one revealed (from `display: none`, `visibility: hidden` or no opacity at all). What only moves, or changes an attribute or its words, does not, and neither does a transition. So the page's own work that draws something new waits for a tap under way, until its click has landed or a moment after a lift that brought none, and never past a second and a half of a finger held down, a long press's, or one whose lift the system kept from the page (`src/ui/finger.ts`): the page view's sheets drawn again a beat after a change, the element bar's fit, which can unfold a group of buttons, and a document's format bar, whose list numbering came up as the caret went into a list. The tutorial's card holds its place while a tap is on its way, too: one that moved under the finger had the click land on its words, not the button tapped. **Two taps are a double tap only on one thing.** A binder row is renamed by a double-click only when both its presses were on that row (`src/workspace/BinderView.tsx`): on an iPad two quick taps on a folder and the row under it came as one double-click on the folder, and put it into its rename. And nothing the app draws is made anew at a tap: the keyboard's inset waits while a finger is down and for a moment after it lifts, and the hardware keyboard's bar, which grows and shrinks by a few points as a field is touched and is said before the page hears the touch, waits a moment more for that touch (`src/app/inset-gate.ts`), the element bar tries its fits on a hidden copy and keeps the one it chose, a bar's buttons are never made anew with each change to the page, and in Focus a tap brings the chrome back once its click has landed, not at the touch, where the bars came in under the finger and the first tap on the page put no caret there.

<a id="PLAT-71"></a>

**PLAT-71** **Writing with no keyboard attached.** Where no menu bar carries the Play and View menus (an iPad, [PLAT-35](#PLAT-35)), the play's document menu carries Find…, Find and Replace…, Go to Scene…, Previous Scene, Next Scene, Next Misspelling and Focus, each sending the id its menu bar item sends (`src/app/menu-actions.ts`), so a command runs the same way whichever route it came by. Find… opens its bar in the same turn as the tap that chose it: iPadOS brings up the screen's keyboard only for a field focused while it is still handling the tap, and a bar opened a moment later had the caret in its field and no keyboard. The split button asks a finger which way, having no ⌥ to click with. A tap on an underlined word opens its corrections ([editor-ux.md](../app/writing/editor-ux.md#EDIT-80)); in Focus a tap brings the chrome back, as a pointer's move does. The hints say what a finger does on a touch screen ([editor-ux.md](../app/writing/editor-ux.md#EDIT-171)). In action and dialogue a screen's keyboard begins a sentence with a capital ([editor-ux.md](../app/writing/editor-ux.md#EDIT-54)). A field that holds a word as the writer spells it takes no capital and no correction of iPadOS's (`autocapitalize="none"` and `autocorrect="off"`, `src/ui/as-typed.ts`): the dictionary's word, a status, a tag, the Plays search, the binder's filter, find and replace, and the play's language code. A word added to the dictionary came back capitalized, and a status typed in lowercase did not; with the capital off, autocorrection still put back the capital of a word iPadOS had learned, as Return added it. Prose fields keep the system's sentence capitals and corrections. A menu, the element menu, autocomplete, the spelling menu and a tutorial's card are placed in what the screen's keyboard leaves of the window, never under it (`src/ui/keyboard-inset.ts`), and a menu taller than that scrolls. A menu already open when the keyboard comes, goes or changes its bar is placed again, beside its control where the control now is: the keyboard's inset lands a moment after the tap that opened a spelling menu (`src/app/inset-gate.ts`), and placed only as it opened, the menu stayed where the keyboard came up over it.

<a id="PLAT-72"></a>

**PLAT-72** **A pinch zooms the page, never the window.** On a touch screen a pinch on the page drives the app's own zoom, a view of the page that moves no page break, as ⌘+ and ⌘− do; WebKit's zoom of the whole window, which scaled the toolbar and the sheets with the page, never runs (`touch-action` and the pinch's own events, `src/app/App.tsx`). The viewport tag still allows scaling: one that refused it would fail WCAG 1.4.4, and every audit with it.

<a id="PLAT-D114"></a>

### The desktop window opens where it was left

<a id="PLAT-81"></a>

**PLAT-81** On a Mac and a PC the main window opens at the size and place it was last left, and maximized (a PC's Maximize, a Mac's Zoom) if it was left so, with the frame it had before kept under it. The first launch, with nothing kept, opens on the whole of the main screen's work area: the screen less its menu bar, Dock or taskbar. A window that opened at a fixed 1100 × 760 had a writer resize it by hand at every launch. A full-screen or minimized window keeps the frame it had before. The frame is kept in points in `window.json`, in the app's own config folder beside `settings.json`, written atomically half a second after the window stops moving, so a drag is one write; it names no file and travels with nothing. A kept frame that no longer fits, its screen unplugged or smaller, is opened on the screen holding most of its title bar, shrunk to that screen and moved wholly onto it, or, where no screen holds enough of the title bar to drag by, at its size in the middle of the main screen. It is never smaller than the window's minimum. A self-test build sizes its window for each check and neither reads nor keeps a frame. `src-tauri/src/window_frame.rs` holds the rule and its tests.

<a id="PLAT-D108"></a>

### Sync is a deployment choice, not an architecture

<a id="PLAT-37"></a>

**PLAT-37** No single mechanism covers all three targets, which is exactly why the app opens *a folder* and never syncs anything itself.

| Mechanism | macOS | iPadOS | Android / Boox | Requirement |
|-----------|-------|--------|----------------| --- |
| **Syncthing** | native, mature | ✗ none (only Möbius Sync — paid, third-party, foreground-only) | native, mature | <a id="PLAT-38"></a>PLAT-38 |
| **iCloud Drive** | native | native | ✗ nothing | <a id="PLAT-39"></a>PLAT-39 |

<a id="PLAT-40"></a>

**PLAT-40** Because the picker reaches any Files location, the choice can change later without touching code. Current posture: iCloud Drive for Mac ↔ iPad (native both ends, no third-party software, no entitlement). When the Boox target lands, prefer picking **one** mechanism over running two.

> **Do not run Syncthing on a folder inside iCloud Drive.** iCloud eviction can present as a deletion to Syncthing, which then propagates it. Two sync daemons on one tree is a data-loss vector, not a clever hub.

<a id="PLAT-41"></a>

**PLAT-41** Nothing in a play needs an exclusion rule under iCloud any more, because there
is nothing in a play to exclude. Versions, the Changes store, recovery and the
cache all live in app data keyed by play id ([docs/app/keeping-work/storage-and-file-format.md#STOR-D10](../app/keeping-work/storage-and-file-format.md)),
and the only dot-prefixed thing the app writes into a play is an atomic write's
temp sibling, which exists for milliseconds. The storage contract does not depend on providers excluding a hidden directory.

<a id="PLAT-D109"></a>

### Android

<a id="PLAT-42"></a>

**PLAT-42** Android is the platform where the open-folder model needs deliberate engineering, because of a concrete limitation we verified:

> **Tauri's core `plugin-fs` cannot drive the open-folder model on Android.** Through the Storage Access Framework, a directory is addressed by *two* distinct URIs (one for the directory's own metadata, one for its children), and `plugin-fs`'s path type holds only a single path/URI — so it **cannot list a directory's contents or create new files** within a SAF tree. Tauri also ships **no plugin for requesting external-storage permission**. (Tracking: tauri-apps/tauri#14587.)

<a id="PLAT-43"></a>

**PLAT-43** The resolution: the Android vault backend uses **[`tauri-plugin-android-fs`](https://github.com/aiueo13/tauri-plugin-android-fs)** (community, MIT), which provides exactly what's missing — a SAF **directory picker with persistable URI grants**, `read_dir` to list, and file creation within a granted tree. Flow:

1. <a id="PLAT-44"></a> **PLAT-44** User picks the content folder via SAF (`ACTION_OPEN_DOCUMENT_TREE`).
2. <a id="PLAT-45"></a> **PLAT-45** The app **takes the persistable URI permission grant** so access survives app/device restarts (Android otherwise drops the grant on restart).
3. <a id="PLAT-46"></a> **PLAT-46** All vault operations go through the plugin's SAF-aware API: list children, read, create, write.
4. <a id="PLAT-47"></a> **PLAT-47** **Atomic write**: SAF does not guarantee an atomic same-dir rename. The backend writes a temp document, verifies its length+hash, then replaces the target via `DocumentsContract` (move/rename), falling back to a verified in-place replace only after a good temp exists. The durability contract (storage I3) is preserved; only the mechanism differs.
5. <a id="PLAT-48"></a> **PLAT-48** **Watching**: SAF gives no reliable directory watch. Contract is the same as iOS — **foreground rescan** plus the hash-based safety floor.

<a id="PLAT-49"></a>

**PLAT-49** If the community plugin proves insufficient, the fallback is a **small custom Tauri plugin** wrapping the same SAF calls (the surface area is narrow: pick-tree, take-grant, list, read, create, replace).

<a id="PLAT-D110"></a>

#### Boox / e-ink (Android)

<a id="PLAT-50"></a>

**PLAT-50** The Android target must run well on a Boox e-ink tablet — a primary reading/light-editing device. E-ink inverts several desktop UI assumptions; design for it now, implement on the mobile pass.

<a id="PLAT-51"></a>

**PLAT-51** Design rules (an **e-ink mode**, auto-enabled on detected e-ink hardware, manually toggleable):

- <a id="PLAT-52"></a> **PLAT-52** **High contrast, pure black on pure white.** No gray-on-gray, no subtle elevation/shadows, no low-contrast placeholder text. Bold weights read better on e-ink.
- <a id="PLAT-53"></a> **PLAT-53** **No animation or transitions.** Animations ghost and smear on e-ink. Disable fades, slides, spinners, smooth-scroll, caret blink, and motion-based affordances. State changes are instant.
- <a id="PLAT-54"></a> **PLAT-54** **Minimize partial-redraw churn.** Avoid large continuously-repainting regions (live word counts updating per keystroke, animated cursors). Batch UI updates; prefer discrete, full-region repaints over many tiny ones, which accumulate ghosting.
- <a id="PLAT-55"></a> **PLAT-55** **Larger tap targets.** ≥ 48 dp hit areas, generous spacing; assume an imprecise capacitive layer or a stylus.
- <a id="PLAT-56"></a> **PLAT-56** **Refresh-tolerant layout.** A manual "refresh screen" affordance (clears ghosting). Avoid UI that depends on hover or rapid feedback. Static, paginated-feeling layouts beat infinite-scroll jank.
- <a id="PLAT-57"></a> **PLAT-57** **Flat, monochrome iconography.** No color-coded-only information (the corkboard's `card.color` is also named in text, never shown by color alone — also an accessibility win).

<a id="PLAT-58"></a>

**PLAT-58** These are implemented as a theme + a motion-disable flag + a layout-density setting, all gated by the e-ink mode. The editor's real-time formatting still works; what changes is *how* updates are painted (discrete, high-contrast, motionless).

<a id="PLAT-D111"></a>

### Capabilities & permissions

<a id="PLAT-59"></a>

**PLAT-59** Tauri v2's security model denies plugin/filesystem access by default and requires explicit, scoped capabilities. The app ships per-platform capability files (`src-tauri/capabilities/`) that grant:

- <a id="PLAT-60"></a> **PLAT-60** Filesystem access **scoped to the chosen Plays folder** subtree (desktop/iOS), plus the app's own data directory.
- <a id="PLAT-61"></a> **PLAT-61** `dialog` (open folder) on desktop/iOS; the Android SAF picker via the android-fs plugin.
- <a id="PLAT-62"></a> **PLAT-62** Nothing else. **No network capability for the webview**: its content security policy allows the app's own files and IPC, and nothing in the page can reach another host. The webview refuses the rest itself, so the policy is never the only fence: on a Mac, WebKit's content rules, compiled before the window exists; on an iPad, the same rules, compiled before the window exists and added to its web view in the same turn of the main thread that makes it, before the page has a byte of its own, since Tauri takes a ready WebKit configuration on a Mac alone (`src-tauri/src/ipad.rs`); on Windows, WebView2's resource filter, which answers every request but the page's own origin (`http://tauri.localhost`) and its IPC with a 403 that never leaves the machine. A Windows release build also clears WebView2's override variables (`WEBVIEW2_*`) before WebView2 starts, so nothing in a writer's environment can open a debugging port into their copy, move its data or point it at another runtime. The app's two outbound connections — the update check, and anonymous usage and crash reports a writer can switch off — go from Rust, to the hosts in `src-tauri/src/telemetry/allowlist.rs` ([privacy-and-telemetry.md](../app/keeping-work/privacy-and-telemetry.md)). There is no sync code. (Any future feature that needs the network adds its host to the allowlist, with its reason.)

<a id="PLAT-D112"></a>

### Build and tooling

- <a id="PLAT-63"></a> **PLAT-63** One codebase; `tauri ios init` / `tauri android init` generate the platform projects under `src-tauri/gen/` (transient build output gitignored; project files committed selectively).
- <a id="PLAT-64"></a> **PLAT-64** **The iPad's floor is iPadOS 17, and the iPad alone** (device family 2; decided 2026-11-03). The page is built for Safari 17, the Mac floor's WebKit (`scripts/webkit-floor.ts`), so an older iPadOS would be handed code it cannot run, and every API the port uses is older. An iPhone needs its own way of showing a page 816 points wide, and a device family can be added to a released app, never taken away. Android's floor is still to confirm against the android-fs plugin's.
- <a id="PLAT-65"></a> **PLAT-65** **The iPad's builds are signed for the App Store,** by the build host's Apple Distribution identity, the one that signs the Mac App Store's, with an App Store profile made through App Store Connect's API ([release-engineering.md](release-engineering.md)); nothing is signed for a device by hand, and no device is registered. An uploaded build carries the privacy manifest App Store Connect requires of an iOS app (`src-tauri/gen/apple/proscenium_iOS/PrivacyInfo.xcprivacy`): no tracking; what the build collects, as the store's privacy answers say it for the Mac and the iPad alike ([PRIV-82](../app/keeping-work/privacy-and-telemetry.md#PRIV-82)): product interaction, crash data and other diagnostics, none linked to anyone, and, only when the writer sends feedback, its words and the address they give; and each required-reason API its binary imports with why. Every upload is built with the reports compiled in, and its whole version is the Mac's of the same commit, `X.Y.Z-alpha.N` for an alpha, in the app's own `ProsceniumVersion`, so the reports service refuses an alpha's as it refuses every alpha's ([SERV-272](services-and-feedback.md#SERV-272)); the bundle's check holds both. Android's keystore is still out of scope.
- <a id="PLAT-66"></a> **PLAT-66** The frontend has **no platform branches** — only the Rust vault backend and the capability files differ. Keep it that way; any `if (platform === …)` in React is a smell that platform difference has leaked above the vault.

## Design

The platform vault and native picker retain folder authority. React consumes a capability record rather than choosing an operating-system path. The iOS picker lives under `src-tauri/plugins/vault-picker/`; native macOS folder and WebKit policy live under `src-tauri/src/`. Foreground revalidation feeds the same hash-based safety floor as watcher events.

The mobile and e-ink requirements above define the platform design; they are not proof that every backend or theme is implemented. Platform execution and verification evidence is kept outside this contract.
