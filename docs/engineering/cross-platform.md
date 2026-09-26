# Cross-platform behavior

[Engineering](README.md) › Platform behavior

Platform contracts define file authority and capabilities across desktop and mobile. They describe design obligations, not proof that every target is ready.

[Vault boundary](#PLAT-D101) · [macOS](#PLAT-D102) · [iOS](#PLAT-D103)

## Requirements

<a id="PLAT-D100"></a>

<a id="PLAT-1"></a>

**PLAT-1** One Tauri v2 codebase targets macOS, iOS and Android. The thing that actually differs across platforms is one thing: **how the app gains and keeps access to the user's chosen content folder.** Everything above the vault layer is platform-agnostic.

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
| **iOS** | our own document picker (`plugins/vault-picker`) | **security-scoped bookmark** | own `LocalFsVault` under scoped access | temp + rename within scoped access | foreground rescan | <a id="PLAT-4"></a>PLAT-4 |
| **Android** | **SAF** tree picker | **persistable URI grant** | **`tauri-plugin-android-fs`** (SAF) | temp doc + verify + `DocumentsContract` replace | foreground rescan | <a id="PLAT-5"></a>PLAT-5 |

<a id="PLAT-6"></a>

**PLAT-6** **Bookmarks persist folder authority.** Under App Sandbox a stored
path is not permission on macOS either, so the security-scoped bookmark is the
durable identity on every platform and the path is only a hint
([docs/app/keeping-work/storage-and-file-format.md#STOR-D12](../app/keeping-work/storage-and-file-format.md)). `src-tauri/src/scope.rs` is the
macOS half; the iOS half is the picker plugin's.

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
  Documents without the writer going through the panel anyway.
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

**PLAT-12** The app is sandboxed; it reaches a user-chosen folder **outside** its container through the document picker, which returns a security-scoped URL. We persist a **security-scoped bookmark** so the folder re-opens on next launch. Tauri's `plugin-fs` **automatically manages** access to security-scoped resources when a file URL is accessed (start on access, with `stopAccessingSecurityScopedResource` on release) — so once the bookmark is resolved, ordinary read/write works.

<a id="PLAT-13"></a>

**PLAT-13** Realities to design around:

- <a id="PLAT-14"></a> **PLAT-14** **Watching is unreliable** under iOS backgrounding. Contract: the app **re-validates the open script and the play file on foreground** (cheap for small folders) in addition to best-effort notifications. The conflict floor (docs/app/keeping-work/storage-and-file-format.md#STOR-D9) makes a missed event safe — a stale buffer is detected on next read by hash, never silently overwritten.
- <a id="PLAT-15"></a> **PLAT-15** **Where the folder lives** is the writer's choice (On My iPad/iPhone, or an iCloud Drive / Files-provider location). Sync is out of scope for the app; the app neither knows nor cares which provider is behind the folder, beyond recognizing what one leaves behind ([docs/app/keeping-work/storage-and-file-format.md#STOR-D11](../app/keeping-work/storage-and-file-format.md)).
- <a id="PLAT-16"></a> **PLAT-16** **A recoverable delete has no OS trash to go to**, so it goes to a ring in app data keyed by play id — outside the Plays folder, so a delete on the iPad cannot be resurrected onto the Mac by the sync layer.

<a id="PLAT-D104"></a>

#### The folder picker is ours (`plugins/vault-picker`)

<a id="PLAT-17"></a>

**PLAT-17** **`tauri-plugin-dialog` implements file pickers on iOS but not a folder picker** ([plugins-workspace#933](https://github.com/tauri-apps/plugins-workspace/issues/933)) — `blocking_pick_folder` does not exist for the target and the app does not compile against it. Since a Plays folder *is* a folder, this is the one genuinely missing piece of the iOS port, so the app ships a small Tauri plugin: `UIDocumentPickerViewController` opened on `UTType.folder` with `asCopy: false`, then a bookmark so the grant survives relaunch.

<a id="PLAT-18"></a>

**PLAT-18** Two properties are the whole reason this shape was chosen over the obvious alternative (an app-owned iCloud container, which needs no picker at all):

- <a id="PLAT-19"></a> **PLAT-19** **It needs no entitlement.** Access comes from the writer choosing a folder, not from a capability — so no paid-membership entitlement, and nothing in the app is tied to iCloud.
- <a id="PLAT-20"></a> **PLAT-20** **It is sync-agnostic, and it is the same design Android needs.** The iPad can open any Files location; SAF's `ACTION_OPEN_DOCUMENT_TREE` + persistable URI grant is the identical shape behind the same type. An iCloud container would have been an iOS-only detour, thrown away when the Boox target lands.

Authority and build rules:

- <a id="PLAT-22"></a> **PLAT-22** **A path is not permission.** `settings.json` stores `lastVaultBookmark` beside `lastVault`; the bookmark is the durable identity and the path is a hint. Reopening goes through one command on every platform — `vault_reopen_last` — so the frontend bootstrap has no platform branch.
- <a id="PLAT-23"></a> **PLAT-23** **Resolving can renew.** iOS marks a bookmark stale when the item moves or its provider re-registers, and hands back a replacement *only* at resolve time. The replacement is persisted immediately; skipping that loses the grant a launch or two later, which would look like the plays randomly disappearing.
- <a id="PLAT-24"></a> **PLAT-24** **`.withSecurityScope` is macOS-only.** On iOS a bookmark made from a scoped URL resolves back to a scoped URL with no options — passing that flag is wrong here, not merely unnecessary.
- <a id="PLAT-25"></a> **PLAT-25** **Scope is held for the process lifetime.** `startAccessingSecurityScopedResource` is balanced in `deinit`; releasing it while a vault is open would fail every later read.
- <a id="PLAT-26"></a> **PLAT-26** **Deployment-target trap.** Tauri hands swift-rs an iOS floor of **13.0** unless `IPHONEOS_DEPLOYMENT_TARGET` is set (`tauri-utils::build::link_swift_library`), while the generated app target is 14.0 — so `UTType.folder` fails to compile against a floor the app never ships. The plugin's `build.rs` sets 14.0; `Package.swift` declares `.iOS(.v14)` to match. swift-rs takes the triple from the former, not the latter, so both are needed.
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

<a id="PLAT-D107"></a>

### Platform difference is a capability, not a branch

<a id="PLAT-35"></a>

**PLAT-35** The frontend asks the backend what this build can do (`capabilities()` → `canPickFolder`, `canReveal`, `canExportAnywhere`, `canWatchFiles`) and branches on that. This is how the "no `if (platform === …)` in React" rule below is actually kept: adding a platform means answering the record honestly, not editing components. The flags genuinely diverge — iOS has a folder picker but no file watching, Android has neither yet.

<a id="PLAT-36"></a>

**PLAT-36** Two desktop-only surfaces are gated by it: **reveal-in-file-manager** and **export to a chosen path**. One more differs beneath the vault: the `trash` crate has no iOS/Android platform module and *fails to compile* there, so mobile keeps the recoverable-delete contract with a device-local `trash/<UTC>-<name>` ring in **app data**, keyed by play id ([docs/app/keeping-work/storage-and-file-format.md#STOR-D10](../app/keeping-work/storage-and-file-format.md)) — outside the Plays folder deliberately, so a delete on the iPad cannot be resurrected onto the Mac by the sync layer.

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
- <a id="PLAT-57"></a> **PLAT-57** **Flat, monochrome iconography.** No color-coded-only information (the corkboard's `card.color` must also encode status via a label/pattern, not color alone — also an accessibility win).

<a id="PLAT-58"></a>

**PLAT-58** These are implemented as a theme + a motion-disable flag + a layout-density setting, all gated by the e-ink mode. The editor's real-time formatting still works; what changes is *how* updates are painted (discrete, high-contrast, motionless).

<a id="PLAT-D111"></a>

### Capabilities & permissions

<a id="PLAT-59"></a>

**PLAT-59** Tauri v2's security model denies plugin/filesystem access by default and requires explicit, scoped capabilities. The app ships per-platform capability files (`src-tauri/capabilities/`) that grant:

- <a id="PLAT-60"></a> **PLAT-60** Filesystem access **scoped to the chosen Plays folder** subtree (desktop/iOS), plus the app's own data directory.
- <a id="PLAT-61"></a> **PLAT-61** `dialog` (open folder) on desktop/iOS; the Android SAF picker via the android-fs plugin.
- <a id="PLAT-62"></a> **PLAT-62** Nothing else. **No network capability for the webview**: its content security policy allows the app's own files and IPC, and nothing in the page can reach another host. The app's two outbound connections — the update check, and anonymous usage and crash reports a writer can switch off — go from Rust, to the hosts in `src-tauri/src/telemetry/allowlist.rs` ([privacy-and-telemetry.md](../app/keeping-work/privacy-and-telemetry.md)). There is no sync code. (Any future feature that needs the network adds its host to the allowlist, with its reason.)

<a id="PLAT-D112"></a>

### Build and tooling

- <a id="PLAT-63"></a> **PLAT-63** One codebase; `tauri ios init` / `tauri android init` generate the platform projects under `src-tauri/gen/` (transient build output gitignored; project files committed selectively).
- <a id="PLAT-64"></a> **PLAT-64** Minimum OS targets are a decision for the impl session; default to current-minus-two major versions and confirm against the android-fs plugin's floor and iOS security-scoped-bookmark support.
- <a id="PLAT-65"></a> **PLAT-65** Signing/provisioning (Apple Developer, Android keystore) are deployment concerns, out of scope for the first macOS milestone.
- <a id="PLAT-66"></a> **PLAT-66** The frontend has **no platform branches** — only the Rust vault backend and the capability files differ. Keep it that way; any `if (platform === …)` in React is a smell that platform difference has leaked above the vault.

## Design

The platform vault and native picker retain folder authority. React consumes a capability record rather than choosing an operating-system path. The iOS picker lives under `src-tauri/plugins/vault-picker/`; native macOS folder and WebKit policy live under `src-tauri/src/`. Foreground revalidation feeds the same hash-based safety floor as watcher events.

The mobile and e-ink requirements above define the platform design; they are not proof that every backend or theme is implemented. Platform execution and verification evidence is kept outside this contract.
