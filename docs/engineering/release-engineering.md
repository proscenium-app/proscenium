# Release engineering

[Engineering](README.md) › Release engineering

Release requirements cover build artifacts, compatibility, signing, updates and contribution readiness. The procedure retains the detailed steps and acceptance criteria.

[Builds](#REL-D1) · [Native verification](#REL-D4) · [Updates](#REL-D6) · [Public repository](#PUBLIC-D100) · [Release procedure](#SHIP-D100)

## Requirements

<a id="REL-D100"></a>

<a id="REL-123"></a>

**REL-123** **The release contract:** one universal Proscenium, meant to launch correctly on
every Mac from Sonoma up, Apple silicon and Intel alike; signed, notarized and
self-updating. What is proven, and by what, is the machine's alone, and no
release waits on a person: the frontend against the floor's Safari on every run
(`check:webkit-floor`); the native app on the build host's macOS on Apple
silicon, and its Intel slice under Rosetta, launch to export; the update itself
on the build host, by the Stable update proof ([every release](#SHIP-D109), step 7),
from 1.0.0 on. The first update through the real address, 0.9.x to 1.0.0, is
not proven: the proof builds the version updated from, and no 0.9.x carries it.
A native launch on Sonoma and a launch on Intel hardware are not proven, because
no machine this project uses can give either, and the release record says so.
This replaces REL-122
(docs/engineering/withdrawn-requirements.md#REL-122), which counted that first
update as proven.

<a id="REL-D1"></a>

### Universal binary

- <a id="REL-2"></a> **REL-2** `rustup target add aarch64-apple-darwin x86_64-apple-darwin`; release builds
  run `tauri build --target universal-apple-darwin`.
- <a id="REL-3"></a> **REL-3** `bun run app:install` may stay host-arch for speed. Add
  `bun run build:universal` for the real artifact.
- <a id="REL-4"></a> **REL-4** **Gate:** after every universal build, `lipo -archs` on the app's executable
  must print both `x86_64` and `arm64`, or the job fails.
- <a id="REL-5"></a> **REL-5** Watch for anything arch-specific in the Rust tree: `smartsubs.rs`
  (NSUserDefaults), `scope.rs` (Foundation calls), `window-id.swift`, the
  vault-picker plugin. Each builds and runs on both slices.

**Acceptance** for both slices: the Intel slice passes the self-test under
Rosetta on the build host, launch to export. No launch on Intel hardware is
made or claimed: Rosetta is not an Intel Mac, and a fault only Intel hardware
shows is not covered.

<a id="REL-D2"></a>

### The macOS and WebView2 floors

- <a id="REL-7"></a> **REL-7** Set `bundle.macOS.minimumSystemVersion` to `"14.0"` in `tauri.conf.json`, and
  assert the built `Info.plist` says so.
- <a id="REL-8"></a> **REL-8** Keep the floor honest in the frontend too: the webview is the system's WebKit,
  so macOS 14 means Safari 17. Set Vite's `build.target` to `safari17`, and add
  **`bun run check:webkit-floor`** (the static first layer of proof for the floor, beneath the native self-test): compile-time checking
  of `dist/` CSS and JS against `safari >= 17` (browserslist + a feature
  checker, or Lightning CSS targets), failing on anything newer. Wire it into
  the gate list in AGENTS.md and CONTRIBUTING.md.

<a id="REL-9"></a>

**REL-9** **Acceptance:** the plist floor is 14.0, `check:webkit-floor` is in CI, and a
deliberately newer CSS feature makes it fail.

<a id="REL-127"></a>

**REL-127** **The Windows engine floor.** On Windows the webview is WebView2's
Evergreen runtime, which updates itself, so no Windows release fixes the engine
the way a macOS release fixes Safari's: the floor is a runtime that has stopped
updating. It is WebView2 131 (Chromium 131), declared once, with its reasons,
as `WEBVIEW2_FLOOR` in `scripts/webkit-floor.ts`. `check:webkit-floor` reads
`dist/` against it as well as against Safari 17, from the compat data's Edge
statements, each engine with its own canary and its own allowed exceptions. A
Windows release is built and proven on the current runtime, which its workflow
installs and records before it tests. The floor is not given to Tauri as
`minimumWebview2Version`: the per-user installer would then update an older
runtime itself, and that asks for an administrator.

<a id="REL-D3"></a>

### CI

<a id="REL-10"></a>

**REL-10** GitHub Actions, in the `proscenium-app` organization.

The private development repository's `main` is one queue on the build host, a self-hosted runner
registered to that repository alone. Each run tests the tip of `main` as it stands when the run
starts, covering every push since the last run, with the gates the changed files call for: the
documents' checks always, the unit tests, smoke and the native self-test
(docs/engineering/release-engineering.md#REL-D4) with its negative control for app changes, the
Rust tests for Rust changes, everything for a change to the pipeline itself. A tag is tested in
full before it builds, signs and notarizes: a release adds the universal build and the Intel
slice under Rosetta, which is where the Intel slice is proven (docs/engineering/release-engineering.md#REL-124). The public
repository's pull requests run the gates, not the native self-test, on GitHub's hosted runners,
with no secrets. The requirements that stood here assumed no
repository before launch and a matrix of GitHub-hosted macOS runners; the maintainer ruled out
both on 2026-09-22, and they are withdrawn (docs/engineering/withdrawn-requirements.md).

<a id="REL-D4"></a>

### A self-test in the real webview

<a id="REL-23"></a>

**REL-23** Smoke drives Chromium; the shipped app is WKWebView. Native verification runs inside the real webview.

- <a id="REL-24"></a> **REL-24** **Build it behind a Cargo feature, `selftest`,** off in release builds. With
  the feature on and `PROSCENIUM_SELFTEST=<report.json>` set, the app:
  1. <a id="REL-25"></a> **REL-25** opens a temporary copy of `sample-vault/` as its Plays folder, through the
     real Rust vault, not the browser fixture;
  2. <a id="REL-26"></a> **REL-26** runs, inside the webview, the assertions `scripts/smoke.mjs` makes — a real
     box on every surface — reusing the check definitions instead of forking
     them;
  3. <a id="REL-27"></a> **REL-27** writes a JSON report through an IPC command, captures the window
     (`screencapture -l`), and exits non-zero on any failure.
- <a id="REL-28"></a> **REL-28** The CI job runs it with a timeout and uploads the report and screenshot.
- <a id="REL-29"></a> **REL-29** It must never be reachable in a shipped build: no feature, no command, no
  environment variable honoured.
- <a id="REL-121"></a> **REL-121** **Launch to export in one run.** The self-test answers the save
  panel as it answers the folder picker, the one panel it cannot drive: an
  export's bytes are written by the app's own writer, atomically, into the
  run's evidence (`<report dir>/exports/`). A check exports the open play as a
  PDF through the Export sheet's own button and reads the file back: a PDF, its
  pages, its title and its language (docs/app/preferences-and-help/accessibility.md#A11Y-13).
  Under Rosetta that is the Intel slice's launch to export, which is the Intel
  slice's whole proof. Reveal in Finder is kept
  the same way: what the app asked Finder to show is recorded, not opened.
- <a id="REL-128"></a> **REL-128** **On Windows it is driven from outside.** WebView2 can be
  driven, as Microsoft and Playwright document, so the Windows test build
  (`node scripts/build-app.mjs --selftest` there) carries no harness in the
  page: it is the release build with its own identifier, WebView2's DevTools
  port opened on the loopback address when `PROSCENIUM_SELFTEST_DEVTOOLS`
  names one (an elevated process ignores WebView2's own variables), and the
  folder picker, the save panel and Reveal in File Explorer answered as on a
  Mac. `node scripts/smoke.mjs --engine webview2
  --app <proscenium.exe>` (scripts/smoke-webview2.mjs) starts it for each act
  with a scratch home, a fresh copy of `sample-vault/` and its DevTools port on
  the loopback address, attaches Playwright, and runs smoke's own checks, acts
  and audits against it, pressing a PC's keys for a Mac's. The PC copy's tree
  is held against `scripts/aria/windows/`. `--break flex` is its negative
  control. Every check runs there, the faults it stages included
  (docs/engineering/release-engineering.md#REL-129). An act that stages what a
  PC does to a writer's files, another program holding a file open or Windows'
  Read-only, runs in this engine alone: its checks reach the act's Plays
  folder, and a program of their own on the PC, through `page.host`
  (scripts/smoke-pc-host.mjs), and the other engines skip it and say why. Such
  a check is proven on a PC, with `--prove` and `--engine webview2`. Its
  acceptance is this section's: three clean passes in a row, and the negative
  control caught. Variant passes (`--variants`, scripts/smoke-variants.mjs) run
  the acts again in this engine as a writer's PC is set up otherwise: the
  screen at 150% and 200%, forced colours, and another display language, which
  the test build passes to WebView2 from `PROSCENIUM_SELFTEST_LANG`. Each is
  checked to have taken before its act starts. A variant's tree has a file of
  its own only where it reads a surface otherwise; dates and times in the
  language's own forms read as the English ones do (scripts/aria-snapshots.mjs).
- <a id="REL-129"></a> **REL-129** **The faults a check stages, staged in the
  real apps.** In a browser a check stages a failure through the in-memory
  vault's hooks (`window.__prosceniumGate` holds or refuses a vault call,
  `__prosceniumPeek` reads the disk, `__prosceniumExternalChange` is another
  program's write, and the rest in `src/storage/dev-mock.ts`). A test build
  answers the same hooks on the real Rust vault, its app data and its watcher
  (`src-tauri/src/selftest_fixture.rs`, through one command, `selftest_fixture`);
  the page's half, `scripts/selftest/fixture.mjs`, is carried by the Mac's
  harness and injected by smoke's WebView2 driver. So the check is written once,
  and its failure path is proven in Chromium, in WebKit, in the Mac app and in
  the Windows app. A hook answers a promise there, so a check awaits what it
  reads. The fault a check stages is the one that system's vault gives: a file
  locked in Finder on a Mac is a Read-only file on a PC, and a check says each
  through `said()`. What would leave the test machine is kept instead: a test
  build sends no feedback and no report, and a quit a check asks for never ends
  it. What the test machine cannot give is stood in for, and said: Windows
  refuses its clipboard to a session that is not in front, as the locked test
  PC's never is, so there a test build keeps what it would have copied, and its
  log says so. The module, its command and every call into it exist with
  the `selftest` feature alone; a release build has none of them, which
  `scripts/check-bundle.mjs --release` proves of a Mac's binary and the Windows
  release build's own scan of each executable (`scripts/windows/release-build.mjs`)
  proves of a PC's. No check is the browser's alone: none is skipped in either
  app for staging its fault through the in-memory vault
  (`scripts/selftest/fixture.test.ts`). An act made for one engine (`engines`)
  runs there alone, and the others say so.

**Acceptance** on the build host: three clean passes on `main` in a row, the negative control
(`--break flex`) caught on the collapsed frame, snapshots of the real surfaces kept as the run's
evidence, and nothing on the host changed (no power assertion held, no display, lock or security
setting touched); and the release
build has no `selftest` symbols (docs/engineering/release-engineering.md#REL-29).

<a id="REL-D5"></a>

### Signing and notarization

<a id="REL-31"></a>

**REL-31** **Channel 1: Developer ID, a DMG on GitHub Releases.**

- <a id="REL-32"></a> **REL-32** **Hardened runtime**, as notarization requires.
- <a id="REL-33"></a> **REL-33** **The download build is not sandboxed, so it updates itself.** Both channels ship, the download first and the App Store
  listing later, and the download must update automatically: going without,
  is outside the release contract. A sandbox cannot give it that.
  tauri-plugin-updater installs by replacing the app in /Applications, and App
  Sandbox forbids that, so a sandboxed download could fetch an update and never
  install it (tauri-apps/tauri#8258, no workaround; confirmed
  in the plugin's source). A sandboxed Developer ID build would also look for
  settings inside a container, so an existing install's Plays folder, accent
  and learned words would not carry over. So there are two entitlement files:
  - <a id="REL-34"></a> **REL-34** the Developer ID build signs with `Entitlements.developer-id.plist`: the
    iCloud Documents keys plus `icloud-container-environment: Production`,
    hardened runtime, no sandbox;
  - <a id="REL-35"></a> **REL-35** the App Store build signs with `Entitlements.plist`, sandbox included, and
    compiles the updater out, because the store updates it.

  Readest, another Tauri app, ships this configuration. What it gives up: a
  compromised download build could reach any file the writer can, not only the
  Plays folder. Hardened runtime, notarization, and macOS's own prompts before
  an app reads Desktop, Documents or Downloads still apply. Sandboxing the
  download later would first need an updater that installs from inside the
  sandbox (Sparkle has one), or every installed copy would stop updating.
- <a id="REL-36"></a> **REL-36** **One iCloud container for both channels.** Both entitlement files carry the
  iCloud Documents container ("iCloud Drive › Proscenium", docs/app/keeping-work/storage-and-file-format.md#STOR-D12);
  `Entitlements.plist` adds the sandbox, user-selected read-write, app-scoped
  bookmarks, and printing (File › Print…, which a sandboxed app cannot reach without it).
  - <a id="REL-37"></a> **REL-37** **Why this is allowed.** Apple's supported-capabilities table for macOS lists
    "iCloud: iCloud documents" for Developer ID .
  - <a id="REL-38"></a> **REL-38** **What it needs.** iCloud is a restricted entitlement, so the build must
    carry a provisioning profile that authorises it:
    - <a id="REL-39"></a> **REL-39** Enable iCloud (with CloudKit support, container
      `iCloud.org.habiby.proscenium`) on the App ID.
    - <a id="REL-40"></a> **REL-40** Create a **Developer ID** provisioning profile for it.
    - <a id="REL-41"></a> **REL-41** Embed it as `Contents/embedded.provisionprofile` through
      `bundle.macOS.files` in `tauri.conf.json`.
    - <a id="REL-42"></a> **REL-42** The App Store build embeds its own Mac App Store profile:
      `tauri.appstore.conf.json` names it at `.release/appstore.provisionprofile`,
      where `scripts/release-app-store.mjs` stages it from the release keychain's
      folder before it signs.
    - <a id="REL-43"></a> **REL-43** Profiles are not secret, but they expire with the certificate: keep them
      out of the repository (in the login keychain before launch, through
      `scripts/release-keychain.mjs`; an Actions secret if releases move
      there) and put renewal in `RELEASING.md`.
  - <a id="REL-44"></a> **REL-44** **Prove it on enrollment day, before building anything on top of it.** Sign
    and notarize one Developer ID build with the profile. On a second Mac
    account signed into iCloud, confirm that:
    - <a id="REL-45"></a> **REL-45** it launches;
    - <a id="REL-46"></a> **REL-46** `URLForUbiquityContainerIdentifier` resolves;
    - <a id="REL-47"></a> **REL-47** iCloud Drive › Proscenium appears in Finder.
  - <a id="REL-48"></a> **REL-48** **Fallback, only if Apple refuses it in practice:** a second
    `Entitlements.developer-id.plist` without the iCloud keys, a build-time
    channel flag, and a Welcome choice that opens the folder panel inside iCloud
    Drive. Record the evidence first, then coordinate the Welcome change with
    T2.
- **Where signed builds are made, and what a tag does:** a tag runs
  `scripts/release.mjs` on the build host, signing from its own keychain
  (docs/engineering/release-engineering.md#SHIP-D102).
- <a id="REL-54"></a> **REL-54** **`RELEASING.md`** — the whole path, click by click: creating the Developer ID
  Application certificate and exporting the `.p12`, creating the API key, which
  secret takes which value, bumping the version, tagging, checking the draft,
  publishing. Written for someone who has never done it. **No agent handles
  certificate, key or password values; the document tells the maintainer where each one
  goes.**
- <a id="REL-55"></a> **REL-55** **Verify on a clean Mac account:** download the DMG in Safari (so it is
  quarantined), drag to Applications, open. No Gatekeeper warning, and
  `spctl -a -vv` says "Notarized Developer ID".

<a id="REL-56"></a>

**REL-56** **Channel 2 (after 1.0): the Mac App Store.** The build is
`node scripts/build-app.mjs --universal --app-store`: Cargo's default features
off, so no updater (the store updates it) and no private WebKit key, which App
Review refuses; `src-tauri/tauri.appstore.conf.json`, which drops the updater's
configuration and names the full `Entitlements.plist` and the Mac App Store
profile; and `check-bundle.mjs --app-store`, which fails a binary carrying
either and an Info.plist without the category and export-compliance keys App
Store Connect requires. The channel reports itself as `app-store`, and the
Updates pane says the store updates it. Everything the app hands to the
system goes through NSWorkspace (`shell.rs`), never a child process, which
would inherit the sandbox. Exports write only the file the Save panel granted
(docs/app/keeping-work/storage-and-file-format.md#STOR-187).

The release half is `scripts/release-app-store.mjs` and
`scripts/app-store-connect.mjs`, on the build host, from its release keychain,
as a stable release's last stage, after the download's release has closed. A
stable release is the maintainer's word for its store version too: the store
follows it with nothing more asked.

- **Built from the release's tag**, with automatic reports compiled in and the
  sponsors' roll fetched, as the download is. The store's privacy answers say
  it sends reports, so `check-bundle.mjs --reports` refuses a signed app whose
  binary does not carry the mark `src-tauri/build.rs` gives a build compiled
  with `PROSCENIUM_REPORTS=1`; every release's download is held to it too.
- **Its build number rises with every upload.** CFBundleVersion is
  `X.Y.(Z×1000+N)`, N the upload's number for that version (1.0.3's first is
  1.0.3001): App Store Connect takes at most three integers there and never
  the same one twice, and the next release always reads higher.
  CFBundleShortVersionString stays `X.Y.Z`. Only stable releases go to the
  store.
- **Signed for the store**: the Apple Distribution identity the store profile
  names (the profile itself made through the App Store Connect API whenever
  there is none, it names another certificate, or it lapses within a month); `Entitlements.plist` completed with the application and team
  identifiers read from that profile, since codesign does not expand Xcode's
  variables; the profile embedded as `Contents/embedded.provisionprofile`; the
  hardened runtime. Any other code in the bundle is signed first, with the
  sandbox's inheritance.
- **Audited against its own profile** (`scripts/release-profile.mjs`
  `assertStoreProfileAuthorizes`), before the build and on the signed app: a
  Mac App Store profile (no devices, not every Mac), the team, the
  application identifier, its expiry, the signing certificate among the
  profile's, the sandbox and the iCloud container signed exactly, every other
  restricted entitlement authorised by the profile, and no `get-task-allow`.
- **Packaged** with `productbuild --component … /Applications`, signed with
  the Mac Installer Distribution identity, which `pkgutil --check-signature`
  must name and trust.
- **Validated, uploaded and waited on** with `xcrun altool`
  (`--validate-app`, then `--upload-package --wait`), with the App Store
  Connect API key that notarizes the download. The key file lives in a
  private temporary folder for the one command, and nothing prints a value.
- **Written and submitted**, through the App Store Connect API
  (`release-app-store.mjs submit`): the version made if it is missing, set to
  go on sale once App Review approves it; its build chosen; its What's New, on
  every version after the first, from the release's own notes without the
  lines about the updater or Windows; its listing from
  `scripts/store/listing.json`, held to App Store Connect's limits; the
  screenshots `bun run store:screenshots` makes from the release's commit; and
  one review submission sent. It refuses only a release with no notes.
- **App Review's answer** is read by the release machine. An approval puts the
  version on sale by itself. A rejection, whose reason only App Store
  Connect's Resolution Center shows, goes to the maintainer as a question and
  an incident: a refused listing is mended in `listing.json` and the same
  build goes again by itself; a refused build is mended for the next release.
- **Until the store's certificates and the app's record exist** the build says
  what is missing and uploads nothing, and the release goes on without it.
- **A stand-in proves the path** with none of Apple's material: a self-signed
  identity of each kind and a profile in Apple's form, in a scratch keychain
  made and removed by the run. The audit, `productbuild` and `pkgutil` run as
  for a release, and App Store Connect's validation must refuse the package
  for what it is, never for the key; its submission is a dry run that makes
  the What's New, the listing and the screenshots and sends nothing.

**The sandbox is proven by the native self-test, not claimed.**
`node scripts/build-app.mjs --selftest --sandbox` builds the store's features
with the self-test's as an app of its own, signed ad hoc into the App Sandbox
with `src-tauri/Entitlements.selftest-sandbox.plist`: the store's entitlements
without the iCloud keys, which need a provisioning profile and kill an ad-hoc
app at launch. The self-test drives no system panel, so under the sandbox its
driver stands in for each one with the grant that panel gives, a sandbox
extension for that one path: the folder picked, the file the Save panel
names, the file Finder opens, read and written for a play or a script and
read only for a document the app imports (`src-tauri/src/selftest_sandbox.rs`,
`scripts/selftest/sandbox.mjs`). Each launch's Plays folder is laid out
outside the container, where only that grant reaches it. Every act then runs
as it does unsandboxed, and the run fails unless the sandbox refused a write
nothing granted, the app's data resolved inside its container
(docs/app/keeping-work/storage-and-file-format.md#STOR-142), no iCloud
container appeared without iCloud (docs/app/keeping-work/storage-and-file-format.md#STOR-131), and the
exports folder holds only the files the Save panel named
(docs/app/keeping-work/storage-and-file-format.md#STOR-187). A relaunch then
proves the bookmark: a second process, with the first one's settings and no
grant, finds the Plays folder refused, and listed once the bookmark it stored
resolves. A store copy has no updater, so the three checks that install an
update or change its settings are reported skipped, and its Updates pane is
held to a tree of its own (`scripts/aria/native/settings-updates.store.yml`).
The pipeline runs every act this way in a full or T2 run, and the acts where
the sandbox draws its lines, with the relaunch, in every batch with app or
Rust files.

Still to come: the iCloud container itself, which only a build signed with
its provisioning profile can reach.

<a id="REL-57"></a>

**REL-57** **Acceptance:** a `v0.9.0` tag produces a notarized, stapled universal DMG as a
draft release, which opens cleanly from a quarantined download.

<a id="REL-D6"></a>

### Updater

- **`tauri-plugin-updater`**, with the public key in `tauri.conf.json`. Where a copy asks is
  `updates.proscenium.ink/v1/<track>/…` with its whole version, and GitHub's `latest.json` as an
  independent fallback for stable only (docs/engineering/services-and-feedback.md#SERV-D1). The
  private key has exactly four copies: the maintainer's login keychain, the build host's release
  keychain, an encrypted archive and the Actions secrets. It is never committed and
  never printed.
- **Windows updates through the same key (since 2026-10-14).** Each release's and
  each beta's per-user installers, x64 and Arm64, are built unsigned on GitHub's
  hosted Windows machines and signed for the updater by the build host, with the
  same private key and nowhere else (`tauri signer sign`); each signature is
  checked against the key the app trusts before anything is written, since the
  CLI only warns on a mismatch. A version's manifest names each platform's build:
  a track's `latest.json` is merged per platform whenever one is written, the
  Mac's entries never rewritten by Windows' or Windows' by the Mac's, and never
  one version beside another; alpha is the Mac's alone. On Windows the updater
  runs the signed installer for the current user, passively, after the save
  beacon, and the installer starts the new version (REL-63's restart, as a
  writer's word). A Windows track build's whole version, `X.Y.Z-beta.N`, is
  compiled in and kept whole in the executable (`version.rs`), where a check
  from outside reads it as a Mac's reads `ProsceniumVersion`.
- <a id="REL-60"></a> **REL-60** **Behaviour:**
  - <a id="REL-61"></a> **REL-61** Check at launch and every 24 hours while the app runs, only if "Check for
    updates automatically" is on (on by default).
  - <a id="REL-62"></a> **REL-62** Download in the background.
  - <a id="REL-63"></a> **REL-63** Never restart on its own: a quiet notice says an update is ready, and the
    restart is the writer's choice. Editing is held before the whole workspace
    settles; the native save beacon must acknowledge a clean state before any
    install. An unreadable beacon is unsafe. A failed install releases editing.
  - <a id="REL-64"></a> **REL-64** The app menu gets "Check for Updates…". The Updates section in Settings
    (T3a's slot) has the switch, Check Now, the current version and the release
    notes link. Once an update is downloaded the link names it, "What’s new in
    <version>", and opens that version's notes through
    `go.proscenium.ink/releases/v<version>`
    (docs/engineering/services-and-feedback.md#SERV-281). The app makes that
    address only from a release's `X.Y.Z` or a beta's `X.Y.Z-beta.N`, the whole
    version the update was offered as, and opens nothing for anything else.
- <a id="REL-124"></a> **REL-124** **An Intel Mac takes stable releases alone.** Alpha and beta builds are
  Apple silicon only (`aarch64-apple-darwin`), and each one's manifest names
  `darwin-aarch64` alone; a release stays universal. The Intel build follows
  stable whatever `settings.json` holds, leaves a stored track as it is, and
  refuses a change to another (docs/app/preferences-and-help/settings.md#SET-40).
  The update service answers an older Intel copy that still asks a track as
  stable answers it (docs/engineering/services-and-feedback.md#SERV-265). So the
  Intel slice is built, and proven under Rosetta, once per release, and a
  pre-release costs half the build.
- <a id="REL-65"></a> **REL-65** **The network allowlist.** The update host is one of only two destinations the
  app may contact; T4 owns the allowlist and the proof. Use the plugin's
  Rust-side check, so the webview needs no network permission at all.
- <a id="REL-66"></a> **REL-66** **Archive and installation.** An outside review found that the pinned plugin, left alone, could delete the only working app when a swap failed, fail on read-only, translocated or cross-volume locations, install an older signed archive under a newer manifest version, and fetch an archive from any host, through any redirect, at any size before verifying it. The pinned
  plugin checks metadata; Proscenium's bounded transport uses the same minisign
  verification before inspecting any archive entry. Both clients allow only
  HTTPS on the three exact GitHub hosts, with at most four redirect hops.
  Downloads stop at 512 MiB even without a length header. Expanded archives
  stop at 2 GiB or 100,000 entries. One app's identifier and version must match
  the manifest, its executable must exist, and its version must be newer.
  Before Ready, a location preflight rejects translocation and unwritable
  folders with a move-and-reopen instruction. Writable locations on another
  volume work: staging is beside the app. On macOS, an atomic bundle exchange
  replaces the plugin's installer. The old bundle stays in the persistent stage
  until the swap is durable; failed durability reverses the exchange. If that
  also fails, the error names the retained recovery copy. A process interrupted
  around the exchange leaves a complete app at the original path.

<a id="REL-67"></a>

**REL-67** **Acceptance:** a notarized 0.9.0 updates itself to 0.9.1 on a real Mac, with a
dirty buffer present, and loses nothing.

<a id="REL-125"></a>

**REL-125** **Every build proves it can take an update.** `cargo test` runs the update
path as the app runs it, on every push: the pinned plugin's check against a served
manifest, the archive's signature against the key, and the installer's check against
this copy's whole version, through the one function the app's check calls, then the
install into a scratch bundle (`src-tauri/src/updates/tests/update_path.rs`). Only the
transport is loopback, and the fixtures are signed by a throwaway key. A newer version
is taken and installed on every track: stable to stable, alpha to alpha, stable to
alpha, and alpha to the release that supersedes it. The same or an older version is up
to date, and nothing is downloaded. An archive that is not the signed offer is refused.
Each part had passing tests of its own while every copy built from 2026-09-23 refused
every update, because the installer was handed the offer's version as this copy's; the
test runs the parts together, and fails when that mistake is put back.

<a id="REL-D7"></a>

### The app icon

<a id="REL-68"></a>

**REL-68** The app adopts the flat mark, option 3a in
the website repository's `design_handoff_proscenium_ink/Logos.dc.html`. Adopt it
exactly.

- <a id="REL-69"></a> **REL-69** **Geometry** — a 1024 canvas; tile `rect x=100 y=100 w=824 h=824 rx=186`.
  - <a id="REL-70"></a> **REL-70** Arch, even-odd: `M280 826V430a232 232 0 0 1 464 0v232H338v164Z M338 604V430a174 174 0 0 1 348 0v174Z`
  - <a id="REL-71"></a> **REL-71** Stage: `M338 604V430a174 174 0 0 1 348 0v174Z`
  - <a id="REL-72"></a> **REL-72** Floor strip: `rect x=338 y=590 w=348 h=14`
- <a id="REL-73"></a> **REL-73** **Light:** tile `#f4ecd8`, arch `#1f2933`, stage `#c9a227`, strip `#f8ecc4`.
- <a id="REL-74"></a> **REL-74** **Dark:** tile `#1b1f24`, arch `#efe6d2`, stage `#d9b23c`, strip `#fbf3d8`.
- <a id="REL-75"></a> **REL-75** **At 16px the strip is dropped.** The glyph for menus and favicons uses the
  viewBox `180 160 664 700`.
- <a id="REL-76"></a> **REL-76** **Replace** the procedural gradient in `scripts/make-icon.mjs` with this
  geometry, rendered from vector (a vetted dev dependency such as resvg is fine).
  Regenerate the `tauri icon` outputs, the Icon Composer `Proscenium.icon`
  layers and the light, dark and tinted `Assets.car` that `install-app.mjs`
  embeds. Update `AppMarkIcon` in `src/ui/Icons.tsx` so the in-app mark
  matches.
- <a id="REL-77"></a> **REL-77** **The site's repository is read-only to this thread.** Copy the geometry; never
  edit anything there.

<a id="REL-78"></a>

**REL-78** **Acceptance:** the Dock, Finder and the About box show the flat mark in light,
dark and tinted modes, and it holds up at 16px.

<a id="REL-D8"></a>

### Versions, release notes, Homebrew

- <a id="REL-79"></a> **REL-79** **One version everywhere.** `bun run version <x.y.z>` sets `package.json`,
  `Cargo.toml` and `tauri.conf.json` together, and a CI check fails if they
  differ.
- <a id="REL-80"></a> **REL-80** **`CHANGELOG.md`** in Keep a Changelog form; the release draft takes its notes
  from it.
- <a id="REL-126"></a> **REL-126** **The public changelog says what is released.** The export sends
  `CHANGELOG.md` out with nothing under Unreleased: what only a pre-release build of
  `main` holds is not public until its version is a beta's or a release's. The heading
  stays, since the version's own tooling reads it, and a version's section, dated or
  still in beta, goes out as it is.
- <a id="REL-81"></a> **REL-81** **Numbering.** 0.9.x for release candidates and updater tests, then 1.0.0.
- <a id="REL-82"></a> **REL-82** **Homebrew.** A personal tap, `proscenium-app/homebrew-tap`, with a cask for the
  universal DMG (with `livecheck`), updated by the release workflow. Submission
  to homebrew-cask comes later: it needs 30 days and 75 stars.

<a id="PUBLIC-D100"></a>

### Public repository

<a id="REL-83"></a>

**REL-83** The public tree must be readable, buildable and free of private material.

<a id="REL-119"></a>

**REL-119** **Full documentation for public contributors and their agents.** The
open source repository carries the detailed product and feature contracts,
architecture, file formats, design rationale, failure handling and acceptance
criteria needed to build and change the app. It follows the same product-area
and feature hierarchy as the local app docs. Public documentation is not
reduced to a tutorial or a summary; the website's Guide serves that audience.

<a id="REL-120"></a>

**REL-120** **A self-contained public reading path.** Internal investigations,
personal operational details and working records may remain private. Their
removal must leave public contributors and agents with working links, stable
requirement ids, the governing technical detail and usable contribution
instructions. A required explanation is retained or generalized in a public
contract before its private source is omitted. Validate documentation in the
exported tree as well as the development tree.

<a id="PUBLIC-D1"></a>

### The split

- <a id="REL-84"></a> **REL-84** **The private repository keeps its full history.**
- <a id="REL-85"></a> **REL-85** **The public repository, `proscenium-app/proscenium`, starts from a clean tree
  with fresh history.** The private history holds personal paths, vault names,
  working notes and prompts; rewriting it is riskier than starting clean.
- <a id="REL-86"></a> **REL-86** **Before the first public push:**
  - <a id="REL-87"></a> **REL-87** run a secrets scan (gitleaks) over the tree;
  - <a id="REL-88"></a> **REL-88** grep for personal paths (`/Users/`), email addresses, play titles that are
    not the sample's, the maintainer's first name, the name of his automation system and the
    private network's name.
  - <a id="REL-89"></a> **REL-89** Every hit is fixed or explained in the handoff.

<a id="PUBLIC-D3"></a>

### Comments that read without the private docs

<a id="REL-90"></a>

**REL-90** **The rule: keep the failure, drop the diary.**

- <a id="REL-91"></a> **REL-91** A comment that says what broke and what the code does about it is the best
  documentation in this tree. Keep it, reworded so it does not depend on a
  document or a person the reader cannot see.
- <a id="REL-92"></a> **REL-92** A comment that only narrates the order things happened in goes.
- <a id="REL-93"></a> **REL-93** **References:**
  - <a id="REL-94"></a> **REL-94** a section of a shipped doc stays as a link;
  - <a id="REL-95"></a> **REL-95** a private reference is replaced by the reasoning it pointed to;
  - <a id="REL-96"></a> **REL-96** a person becomes the problem they reported.
- <a id="REL-97"></a> **REL-97** **No behaviour changes in this pass.** Every commit is comments and docs only,
  and the gates prove it.

<a id="PUBLIC-D5"></a>

### The sample play

<a id="REL-98"></a>

**REL-98** `sample-vault/The Weight of Water/The Weight of Water.fountain` carries
the maintainer's personal email address in its title page. Replace the contact with a neutral
placeholder. The site treats the sample as a placeholder to be rewritten, so
keep the app's copy in step with whatever replaces it.

<a id="PUBLIC-D6"></a>

### Standards a machine enforces

- <a id="REL-99"></a> **REL-99** **Formatter and linter:** Biome for TypeScript, TSX, CSS and JSON, with its
  accessibility lint rules on; `rustfmt` and `cargo clippy -- -D warnings` for
  Rust.
  - <a id="REL-100"></a> **REL-100** Match the current style (two-space indent, double quotes, trailing commas,
    width 100), so the formatting commit is small.
  - <a id="REL-101"></a> **REL-101** Format the whole tree in **one** commit, when no other thread is active.
  - <a id="REL-102"></a> **REL-102** Add `bun run lint` and `bun run format:check` to the gates, CI and
    CONTRIBUTING.
- <a id="REL-103"></a> **REL-103** **TypeScript:** strict is already on. List every `any` and `@ts-ignore`;
  remove each one or give it a comment saying why.
- <a id="REL-104"></a> **REL-104** **Rust:** every `unwrap()` and `expect()` reachable from a Tauri command
  becomes an error the UI can show, unless it guards a true invariant, in which
  case a comment says which.
- <a id="REL-105"></a> **REL-105** **File size:** `useWorkspace.ts` (about 3,200 lines), `styles.css` (about
  5,700) and `App.tsx` (about 1,500) are candidates for splitting along
  existing seams. That is not required for 1.0; record a plan if it is not done.
  Measured after 1.0.0: `styles.css` is a 39-line index over 34 sheets in
  `src/app/styles/`, so it is done; `App.tsx` is about 1,200 lines and
  `useWorkspace.ts` about 4,700. The plan, in order of risk: `App.tsx` gives up
  its chrome state, caret context, focus mode and banners as hooks and a
  component, each named by a smoke check; `useWorkspace.ts` gives up its pure
  helpers, then the play's format and export, the change ledger, the binder
  operations and the Plays folder as units on the pattern of
  `use-material-sessions.ts` (docs/engineering/architecture.md#ARCH-D105); the
  script session, the safety path, waits for a session contract decided on its
  own. Every step moves code along a seam that exists, changes no behaviour,
  keeps every ARIA snapshot, and lands alone.

<a id="PUBLIC-D7"></a>

### The repository itself

- <a id="REL-106"></a> **REL-106** **CLA bot:** CLA Assistant Lite (a GitHub Action that stores signatures in the
  repository) or cla-assistant.io, pointing at `CLA.md`, required on pull
  requests.
- <a id="REL-107"></a> **REL-107** **Templates:**
  - <a id="REL-108"></a> **REL-108** issue templates for a bug (asking for Copy Diagnostics), a format request
    or submission, and an accessibility problem;
  - <a id="REL-109"></a> **REL-109** a pull request template with the gate checklist and the CLA note.
- <a id="REL-110"></a> **REL-110** **Settings:**
  - <a id="REL-111"></a> **REL-111** private vulnerability reporting on;
  - <a id="REL-112"></a> **REL-112** main protected, with CI required and no force-push;
  - <a id="REL-113"></a> **REL-113** `FUNDING.yml` for GitHub Sponsors, the primary way to donate: it takes no fee on a sponsorship from a personal account.
- <a id="REL-114"></a> **REL-114** **Topics and description:** "Playwriting software for macOS. Fountain-native,
  local files, free and open source."

<a id="PUBLIC-D8"></a>

### Before the public push

1. <a id="REL-115"></a> **REL-115** Every gate green on the clean tree, including `lint` and `format:check`.
2. <a id="REL-116"></a> **REL-116** `reuse lint` passes, so every file's license is known.
3. <a id="REL-117"></a> **REL-117** The secrets scan and the personal-data grep come back clean.
4. <a id="REL-118"></a> **REL-118** A fresh clone on another Mac account builds with only the README's
   instructions.

## Design

<a id="LAUNCH-D103"></a>

### How every thread works in this repo

1. **Look before you start.** `git status` in the main checkout, and
   `ps aux | grep claude` with each process's working directory, at the moment
   you begin — not what an earlier session saw. Work you did not write, still
   uncommitted, means stop and report.
2. **Your own worktree.** If your session already started inside a fresh
   worktree, use it on a branch named `launch/<thread>`. Otherwise run
   `git worktree add .claude/worktrees/<thread> -b launch/<thread> main`.
   Never edit the shared checkout. A new worktree has no dependencies yet: run
   `bun install` before the gates (Cargo builds its own target the first time).
3. **Stay in your lane** (ownership table below). A necessary edit to a file
   another thread owns stays minimal and is named in the commit message.
4. **Gates before every merge**, all green: `bun test ./src` · `bun run typecheck` ·
   `bun run check:layout` · `bun run check:design` · `bun run check:spdx` ·
   `bun run check:network` · `bun run check:names` · `bun run check:docs` · `bun run check:webkit-floor` ·
   `bun run check:version` · `bun run smoke` ·
   `cargo test --manifest-path src-tauri/Cargo.toml`. New files
   carry the SPDX header. UI changes keep the DESIGN.md accessibility contract,
   and new surfaces are added to smoke's audit.
5. **Merging.** Rebase on main and push the branch; CI on the build host is the
   authority: every push runs the gates and the native self-test there. Fast-forward main only when the
   branch's run is green. Never merge red; never force-push main.
6. **Delivering.** Nothing is installed by hand. A green main becomes an alpha, and
   the updater brings it to the maintainer's own copy, which offers to restart into it.
   `bun run app:install` is for local development builds only.
7. **Reporting.** What landed (commit hashes), what was verified and how, what
   was not, what is left — and update the domain’s proof record, which keeps dates, proof and status out of the contracts.

<a id="LAUNCH-D104"></a>

#### Who owns which files

| Area | Owner |
|---|---|
| `.github/`, build/icon/install/release scripts, `src-tauri/tauri.conf.json` (bundle, plugins, updater), `src-tauri/icons/`, `RELEASING.md`, `CHANGELOG.md`, the Updates settings section | T1 |
| `src-tauri/src/lib.rs` run loop and open events, `src/storage/**` except the settings API, `src/app/useWorkspace.ts`, `src/editor/find*`, `src/fountain/fdx*`, `src-tauri/src/vault/**`, `src-tauri/src/debuglog.rs` | T2 |
| `src/app/SettingsPanel.tsx` → `src/app/settings/**` and its CSS; `src-tauri/src/settings.rs`; the `settings` API in `src/storage/ipc.ts` and its counterpart in `src/storage/dev-mock.ts` | T3a |
| `src/format/**`, `formats/**`, `src-tauri/src/formats.rs`, the format designer surface | T3b |
| `src-tauri/src/telemetry*`, error hooks in `src/main.tsx`, `security.csp` in `tauri.conf.json`, the Welcome notice, the Privacy and About sections, the promise in `docs/app/product.md`, `README.md`, `PRODUCT.md` | T4 |
| `services/edge/**`, `src/feedback/**`, the Send Feedback menu, toolbar and About entries, `telemetry/allowlist.rs` and `telemetry/client.rs` (under T4's rules in privacy-and-telemetry.md), the updater `endpoints` in `tauri.conf.json` | T7 |
| Everything, last | T5 |

`lib.rs` and `tauri.conf.json` are shared by necessity: T1 and T4 add plugin
registrations and their own keys, T2 owns the run loop, T3a registers its
settings commands. `src/storage/ipc.ts` and `dev-mock.ts` are shared the same
way: T3a owns the settings API in them, and T2 owns everything else. Keep those
edits small and expect to resolve a trivial conflict on rebase.


<a id="SHIP-D100"></a>

### Release procedure

How a version of Proscenium gets from a commit to a writer's Mac: signed with
Habiby LLC's Developer ID, notarized by Apple, checked, published on GitHub,
and picked up by every installed copy's updater and by Homebrew.

**Who does what.** The maintainer clicks: on Apple's websites, in Xcode, in a dialog, in
a password manager. An agent does everything else, including every command in this
file. Where a step says *Maintainer*, it is a website or a window; nothing here asks
the maintainer to open Terminal.

**Nobody but the maintainer ever sees a certificate, a key, a password or a profile's
contents.** They go from Apple's websites into this Mac's login keychain, and
from there to the build host's keychain, the Drive archive and the Actions
secrets, and a key has no copy anywhere else. The scripts move them
without printing them, and agents never read, print or type their values.

The design behind all of this is [docs/engineering/release-engineering.md](release-engineering.md).

---

<a id="SHIP-D101"></a>

#### How a release works

1. An agent sets the version and turns the changelog's Unreleased section into
   that version's notes.
2. Pushing the tag runs [scripts/release.mjs](../../scripts/release.mjs) on the build host
   (a `v*` tag starts the release workflow on its self-hosted runner). It builds one universal app, for Apple
   silicon and Intel, then:
   - signs it with the Developer ID certificate in the build host's keychain;
   - has Apple notarize it, and staples the ticket to the app;
   - notarizes and staples the DMG too;
   - makes the archive installed copies update from, signs it with the updater
     key, and writes `latest.json`, which they read to find it;
   - checks all of it before calling it done: both architectures, the macOS 14
     floor, no test code, the iCloud entitlements and no sandbox, Gatekeeper's
     verdict on the app and the DMG, and that the DMG and the archive hold the
     very app that was checked.

   The files land in `.release-artifacts/v<version>/` and in the run's artifacts.
3. From launch on, the same run drafts a GitHub release with those files. A
   draft is invisible to everyone but the repository's members.
4. The draft is checked, then published. From that moment:
   - every copy with automatic updates on finds it within a day, or at once
     with Settings › Updates › Check Now;
   - [.github/workflows/homebrew.yml](../../.github/workflows/homebrew.yml) updates the Homebrew cask.

<a id="SHIP-D102"></a>

#### Where releases are made

- **On the build host, from a tag.** A `vX.Y.Z`
  tag on the development repository runs `release.mjs` in GitHub Actions on the build host's
  self-hosted runner, signing from its own keychain. Before launch it builds and checks the
  release and keeps the files with the run; from launch it drafts the release on the public
  repository, where stable releases live, with a token that can write there.
- **This Mac keeps its copies** of every key, so a release can still be made here by running
  `node scripts/release.mjs` in this checkout, if the build host is ever unavailable.
- **The tag is the maintainer's decision.** No agent pushes a `v*` tag or publishes a release
  without the maintainer's yes in chat; that yes is what makes a release.

---

<a id="SHIP-D103"></a>

#### One-time setup: the enrollment sitting

Do this together, the maintainer and an agent, once Apple has approved Habiby LLC's
enrollment in the Apple Developer Program. It takes about half an hour. Most steps need the
**Account Holder** role, which is whoever enrolled.

At any point the agent can show what is in place, without showing any value:

```bash
node scripts/release-keychain.mjs status
```

<a id="SHIP-D1"></a>

#### 1. Xcode knows the team

*Maintainer:* open **Xcode → Settings… → Accounts**. If your Apple Account is not in
the list, click **+**, choose **Apple Account**, and sign in. Select the account;
**Habiby LLC** appears among its teams.

<a id="SHIP-D2"></a>

#### 2. The Developer ID Application certificate

This certificate is what makes macOS say an app comes from Habiby LLC. It lasts
five years.

*Maintainer:*

1. In **Xcode → Settings… → Accounts**, select the Habiby LLC team and click
   **Manage Certificates…**.
2. Click **+** at the bottom left and choose **Developer ID Application**.
3. It appears in the list as *Developer ID Application*. Click **Done**.

Xcode keeps the certificate and its private key in this Mac's login keychain,
where the release script signs with it. The first signed build may ask whether
`codesign` may use the key, and waits until someone answers: click **Always
Allow**. That build happens in step 7, with you there.

*Agent:* `status` shows `certificate  Developer ID Application: Habiby LLC (XXXXXXXXXX)`.
The ten characters are the **Team ID**.

There is nothing to export. If this Mac is ever lost, make a new certificate the
same way and a new profile (step 4); apps already shipped keep working.

**Alternative: use the website.**

1. *Agent:* make a signing request on this Mac with `openssl` (RSA 2048), and
   `security import` its private key straight into the login keychain with
   `-T /usr/bin/codesign`. Delete the key file at once, and print nothing of it.
2. *Agent, in Chrome:* Certificates → **+** → **Developer ID Application** →
   **G2 Sub-CA**. The previous Sub-CA has the expiry recorded in the release notes. Upload the request, then **Download**.
3. *Agent:* `security import` the `.cer` into the login keychain.
   - If `security find-identity -v -p codesigning` then finds no valid
     identity, Apple's Developer ID G2 intermediate is missing, which Xcode
     normally installs.
   - Import it from `https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer`,
     after checking that it issued the certificate and that
     `security verify-cert` chains it to Apple Root CA.

codesign uses a key imported this way without asking.

<a id="SHIP-D3"></a>

#### 3. The notarization key

Notarization is Apple scanning the app and issuing a ticket that Gatekeeper
trusts. The release script asks for it with this key.

*Maintainer:*

1. Go to [appstoreconnect.apple.com](https://appstoreconnect.apple.com) →
   **Users and Access → Integrations → App Store Connect API**. The first time,
   you may have to request access and accept terms.
2. Under **Team Keys**, click **+**. Individual keys cannot notarize.
   - Name: `Proscenium notarization`.
   - Access: **Developer**.
3. Click **Generate**, then **Download API Key** on the new row. It downloads
   `AuthKey_<Key ID>.p8` to Downloads **once**; Apple never offers it again.
4. Leave the page open, and tell the agent.

*Agent:* `node scripts/release-keychain.mjs notary`. A dialog opens.

*Maintainer:* copy the **Issuer ID** shown above the list of keys, paste it into the
dialog, and click **Save**. An agent in Chrome can click **Copy** beside it
first, so the paste is only ⌘V. The dialog refuses anything that is not
Issuer-ID-shaped and stores nothing, so a wrong paste costs only a second run.

The script asks Apple whether the key works, stores the key, its Key ID and the
Issuer ID in the login keychain, and moves the `.p8` file to the Desktop folder
**Proscenium keys to archive** (step 6).

<a id="SHIP-D4"></a>

#### 4. iCloud, the App ID and the provisioning profile

The app's own iCloud Drive folder, iCloud Drive › Proscenium, needs Apple to
know the app may use it. A provisioning profile carries that permission inside
the app.

*Maintainer,* at [developer.apple.com/account](https://developer.apple.com/account) →
**Certificates, Identifiers & Profiles**:

1. **Identifiers → +** → **iCloud Containers** → Continue.
   - Description: `Proscenium`.
   - Identifier: `iCloud.org.habiby.proscenium`. It must be exactly this: the
     app asks for it by name.
     - The field types `iCloud.` itself as soon as you start, so type only
       `org.habiby.proscenium` after it.
     - Read the confirmation page before Register: a container can never be
       deleted.
   - Register.
2. **Identifiers → +** → **App IDs** → **App** → Continue.
   - Description: `Proscenium`.
   - Bundle ID: **Explicit**, `org.habiby.proscenium`.
   - Under Capabilities, tick **iCloud**. **Include CloudKit support** is the
     default.
   - Continue, then Register.
   - Open the new App ID, click **Configure** beside iCloud, and tick the
     `iCloud.org.habiby.proscenium` container. The container can be chosen
     only once the App ID exists.
   - Continue, **Save**, then **Confirm**. The notice about invalidated
     profiles is harmless before any profile exists.
3. **Profiles → +** → under **Distribution**, choose **Developer ID** → Continue.
   - Profile type: **Mac**.
   - App ID: `org.habiby.proscenium`.
   - Certificate: the Developer ID Application certificate from step 2.
   - Name: `Proscenium Developer ID`.
   - Generate, then **Download**.

*Agent:* `node scripts/release-keychain.mjs profile`. It checks the profile is
the Developer ID profile for `org.habiby.proscenium` and files it in
`~/Library/Application Support/Proscenium Release/`. A profile is not secret and
can be downloaded again at any time, so it is not archived.

<a id="SHIP-D5"></a>

#### 5. The updater key

Every update is signed with this key, and every installed copy checks updates
against its public half. **If the private key is lost, no installed copy can
ever be updated again. Writers would have to download the app by hand.**

*Agent,* with the maintainer present: `node scripts/updater-keygen.mjs`. It:

- stores the private key in the login keychain, printing nothing of it;
- writes a copy to `proscenium-updater.key` in the Desktop folder
  **Proscenium keys to archive**;
- puts the public key into `src-tauri/tauri.conf.json`, and the agent commits it.

Builds from that commit on can verify updates, and the release script refuses
to run without the public key.

Distribution builds enable reports with `PROSCENIUM_REPORTS=1`, set by the
release script, and `check-bundle.mjs --reports` refuses a release whose binary
lacks the mark such a build carries. There is no analytics account or key. Rehearsals and local
installs keep automatic usage and crash reports off. The owned update endpoint
is the update endpoint; reports and feedback follow the service
readiness checks in [docs/engineering/services-and-feedback.md](services-and-feedback.md).

<a id="SHIP-D6"></a>

#### 6. Into the key archive

The Desktop folder **Proscenium keys to archive** now holds two files that exist
nowhere else outside this Mac's keychain. They go into one encrypted file kept
off-site by the maintainer, which holds only what cannot be made again. Its
passphrase is generated for it and stored apart from it.

*Agent:* `node scripts/release-keychain.mjs move --host <user@build-host>` gives
the build host its copies, then `node scripts/keys-archive.mjs` seals the
archive. Two dialogs ask for the passphrase; the maintainer pastes it into both.

*Agent:* store the archive and its plain note off-site, fetch the archive back
and check it against the hash the script printed, then, with the maintainer's
yes, move the Desktop folder and the local archive to the Trash.

To put the updater key back on a new Mac: `node scripts/updater-keygen.mjs --restore <file>`,
which refuses any key the installed copies do not trust.

<a id="SHIP-D7"></a>

#### 7. Prove the iCloud folder works outside the App Store

The download build uses the app's own iCloud Drive container, as the App Store
build will. Apple's capability table allows it for Developer ID, but it has
never been tried with this app. Prove it before building anything else on it
(docs/engineering/release-engineering.md#REL-D5).

*Agent:*

1. `bun run version 0.9.0`, commit, then `node scripts/release.mjs`.
   `updates.proscenium.ink` admits the rehearsal version 0.9.0, so this build
   checks through it from its first launch.
2. Check the signed app from the command line and record the output:
   `spctl -a -vv` must say `source=Notarized Developer ID`, and
   `codesign -d --entitlements -` must list the three iCloud keys and
   `com.apple.developer.icloud-container-environment`.
3. Check that the built app's Info.plist declares the container public
   (`NSUbiquitousContainers`, `NSUbiquitousContainerIsDocumentScopePublic`,
   named "Proscenium"), which is what makes it a folder in iCloud Drive.
4. On a Mac where a signed copy has run, check that the container resolved:
   `~/Library/Mobile Documents/iCloud~org~habiby~proscenium` exists, and
   `brctl status iCloud.org.habiby.proscenium` finds it and reports its sync.
   The maintainer's own Mac runs the signed alpha, so a session reads it there,
   from files, with no window touched.
5. Write the results into the release's proof record. Nothing is published
   before launch.

No person opens the build to check it: there is no human pass (the
maintainer's decision, 2026-09-25). A person on a second macOS account used
to, and that check is withdrawn
(docs/engineering/withdrawn-requirements.md#SHIP-D7-second-account).
What steps 2–4 do not show: Finder drawing the folder, and the Welcome screen's
iCloud choice on a Mac that has never run the app. Both follow from the facts
above, but no one looks at them.

If the container does not resolve, record exactly what happened first. The
fallback in docs/engineering/release-engineering.md#REL-D5 (no iCloud keys, and a Welcome choice that
opens the folder panel inside iCloud Drive) is built only on that evidence.

---

<a id="SHIP-D104"></a>

#### Launch day

In this order, once T5's clean tree is ready (the public-repository pass, docs/engineering/release-engineering.md#PUBLIC-D100):

1. ~~*Maintainer:* the organization `proscenium-app`~~: made 2026-09-22, with the private
   development repository, which keeps the project's whole history.
2. ~~*Agent:* `gh auth login` on this Mac~~: signed in as the maintainer's GitHub account.
3. ~~*Agent,* on the maintainer's go: create `proscenium-app/proscenium`, public, and push
   the whole project as its one commit; create `proscenium-app/homebrew-tap`, public~~:
   both made 2026-09-25, the project's first commit pushed 2026-09-26. The tap was
   left with no commits, and 1.0.0's first publish failed on it: the Homebrew
   workflow checks the tap out before it writes the cask, and a repository with no
   commits has no `main`. A new tap gets one commit on `main` before its first
   release (a README naming the cask and
   `brew install --cask proscenium-app/tap/proscenium`).
4. ~~*Maintainer:* make the Homebrew token (below), and the release job's token for
   `proscenium-app/proscenium` (Contents read and write on that one repository),
   which the build host needs to draft a release there~~: both made 2026-09-25. The
   build host's runner token cannot write to the public repository, which is why
   the release job has its own.
5. ~~*Agent:* make sure the Tagged release run of the last 0.9.x kept its files~~:
   nothing starts from a 0.9.x DMG (step 8).
6. ~~*Agent:* `bun run version 1.0.0` if it is not already, tag `v1.0.0`, push
   the tag, then `node scripts/release.mjs --publish`~~: tagged and drafted
   2026-09-26. It refuses unless the tag on GitHub is exactly the tree it builds.
7. ~~Check the draft ([Every release](#every-release), steps 6–7), then publish it
   (step 8 there)~~: published 2026-09-26, after `https://proscenium.ink/privacy`
   served the website's privacy page (1.0 is the first distributed copy that
   sends automatic reports, and the page had to be public before it did).
8. ~~*Agent:* nothing to run, and nothing to wait for~~. The Stable update proof
   builds the version updated from out of its own tag, and no 0.9.x carries it,
   so the first update through the real address on stable, 0.9.x to 1.0.0, is
   unproven. The proof runs from 1.0.1 on
   ([every release](#SHIP-D109), step 7).

<a id="SHIP-D105"></a>

#### The Homebrew token

*Maintainer:* GitHub → your avatar → **Settings → Developer settings → Personal
access tokens → Fine-grained tokens → Generate new token**.

- Resource owner: `proscenium-app`.
- Repository access: **Only select repositories → homebrew-tap**.
- Permissions: **Contents: Read and write**.
- Expiration: one year. Put a reminder in your calendar to replace it.

Paste it straight into the secret, at `proscenium-app/proscenium` → **Settings →
Secrets and variables → Actions → New repository secret**. It can never be
viewed again, only replaced.

Writers install with `brew install --cask proscenium-app/tap/proscenium`. The
full name is how Homebrew 6 lets someone trust a single cask from a tap.

---

<a id="SHIP-D106"></a>

#### Every release

A release goes alpha, then beta, then stable, and every stable release first
went out as a beta from the same line.

- **Alpha** is every green batch of `main`, built for Apple silicon and offered
  only to a copy that holds the alpha track's key.
- **Beta** is the maintainer's choice to send one out. The first beta of a
  version cuts its line, `release/X.Y.Z`, at the newest green alpha's commit,
  with one commit, `X.Y.Z on its line`: every file that states the version
  says X.Y.Z, and the changelog's Unreleased entries become an undated
  `## [X.Y.Z]` section (`node scripts/version.mjs line X.Y.Z`). The same
  change lands on `main` the same minute, so `main`'s next release is X.Y.Z+1
  and its alphas go on. The beta's tag, `vX.Y.Z-beta.N`, is tested and built
  in one job and published to the beta track, and the release before it, set
  to Beta, is proven to update to it. A fix during the soak lands on `main`
  first; a commit whose message says `Beta: X.Y.Z` is carried to the line and
  rides the next beta, which starts the soak again.
- **The soak** counts days from the beta's publishing. A day is clean when the
  beta reported no crash, no feedback from a copy on it is still unmarked as no
  blocker, no incident is open, its proofs are green and no advisory is open
  against what it ships. A day that is not clean holds the beta until the
  maintainer lets it go. From day 7 the maintainer may send a clean beta to
  stable; on day 14 it goes by itself unless held; before day 7 only the
  maintainer's override, with its reason, sends it.
- **Stable** is then a machine's, stage by stage, each recorded as it begins
  and ends and each able to run again: the steps below. From its first stage
  to its close nothing changes how releases are made.

<a id="SHIP-D107"></a>

#### Prepare

1. **Preflight,** before anything is built: the build host's disk and the test
   bench free; the signing identity, the notarization key and the Cloudflare
   token in its keychain; the release token more than 30 days from its expiry;
   the tap's `main`; the deployed update service answering; the version the
   same in every file; the changelog's section written; no advisory open.
2. **The changelog's date,** the line's only change from the beta that soaked:
   `node scripts/version.mjs date X.Y.Z`.

<a id="SHIP-D108"></a>

#### Build and draft

3. **The public sync:** the commit's public tree, committed to the public
   repository with a one-line message and no attribution, and its `vX.Y.Z` tag.
4. **The tag,** whose one job tests the commit in full, with the universal
   build and the Intel slice under Rosetta, and builds it with
   `node scripts/release.mjs`: universal, signed, notarized and checked, its
   seven files kept. Nothing takes the build host between the test and the
   build. If the build fails, its last line names the step. The common ones:
   - **missing signing material:** `node scripts/release-keychain.mjs status`
     names what is gone, and the setup step above makes it again.
   - **notarization rejected:** the output has a submission ID;
     `node scripts/release-keychain.mjs log <id>` shows Apple's reasons.
   - **stapling failed:** Apple's ticket had not reached its servers yet. Run
     the stage again.
5. **The draft,** on the public repository, from those seven files
   (`node scripts/release.mjs --draft <folder>`), its id recorded: that draft,
   and nothing else, is what is published.

<a id="SHIP-D109"></a>

#### Check the draft

6. The draft's seven files download, each is the file `SHA256SUMS` names,
   `latest.json` says the version, `build.json` names the tag's commit, and
   Gatekeeper accepts the image as notarized:
   - `Proscenium_1.0.1_universal.dmg`
   - `Proscenium_1.0.1_universal.app.tar.gz` and its `.sig` (what the updater downloads)
   - `latest.json` (what the updater reads), `notes.md`, `SHA256SUMS`, `build.json`

<a id="SHIP-D110"></a>

#### Publish

7. **Admit** the version: the update service's list of what it admits and what
   it has halted is a file in the tracks' bucket, which the service reads
   within a minute, so a release is admitted by writing it there, with no
   deploy (docs/engineering/services-and-feedback.md#SERV-268). Until it is admitted, a copy of the new version is refused its own
   check and its archive is not served.
8. **Publish that draft, by its id.** One release on the tag, never a second
   one made by hand: a second, empty release beside the draft makes GitHub
   serve no `latest.json` and the website's Download answer 404, as it did for
   five minutes on 2026-09-26.
9. **From outside:** `proscenium.ink/download` redirects to the DMG whose
   SHA-256 is `SHA256SUMS`'s, GitHub's `latest.json` answers the version, and
   so does the update service.
10. **Homebrew:** the tap's workflow names the version within a minute, and an
    install of the cask (`brew install --cask proscenium-app/tap/proscenium`,
    into a scratch folder) gives it.
11. **The update proof:** the release before it, built from its tag as a test
    copy with the app's real identity and driven by the current harness,
    updates itself through the real update address, with a line typed just
    before Restart to Update, and passes only when the scratch folder holds
    this release, notarized and running, with the line in the play.
12. **The line merged back** into `main`, the **record** written from the
    release's own file, and the release **closed**.

A bad published release is fixed by publishing a better one, never by deleting
it: installed copies may already be updating to it. A halt stops the update
service offering it, through the same list, and deletes nothing.

---

<a id="SHIP-D111"></a>

#### Renewals and rotations

| What | Lasts | When it ends | What to do |
|---|---|---|---|
| Developer ID Application certificate | 5 years | Apps already signed keep working; new builds cannot be signed | Setup step 2 again, **then step 4's profile again** (a profile names its certificate) |
| Developer ID provisioning profile | 18 years, or until the certificate is replaced or the App ID's capabilities change | **The app stops launching** once its profile expires | Regenerate it (setup step 4, point 3), file it, ship a release |
| App Store Connect API key | No expiry | — | If it leaks, revoke it in App Store Connect and repeat setup step 3, with App Manager access while the store channel is on |
| Apple Distribution and Mac Installer Distribution certificates | 1 year | New store builds cannot be signed or packaged; the store keeps selling what it has | The Mac App Store's step 1 again, then `move`; the profile follows by itself |
| Mac App Store provisioning profile | Until its certificate expires or is replaced | — | The store build makes it again through the API a month before it lapses |
| Updater key | Forever | — | Rotate only if the private key leaks: ship one release signed with the OLD key that contains the NEW public key, then sign everything after with the new key. Copies that skip that release can't update. |
| `HOMEBREW_TAP_TOKEN` | What you chose (a year) | Homebrew's workflow fails on publish | Make a new token and replace the secret |

Revoking the Developer ID certificate, unlike letting it expire, makes every app
it ever signed stop opening. Only do that if its private key has leaked.

---

<a id="SHIP-D112"></a>

#### Releases in GitHub Actions

Releases are made in GitHub Actions, on the build host, from its own keychain:
`scripts/release-keychain.mjs move` fills it from this Mac's, and `release.mjs` signs from it
whenever `PROSCENIUM_KEYCHAIN` names it. The repository's Actions secrets are a
redundant copy, not a source, under the names `release.mjs` reads in CI, so a signed build can be made
from any Mac that can reach GitHub. No runner
reads them.

| Secret | What it is |
|---|---|
| `APPLE_CERTIFICATE` | the Developer ID certificate and its private key, as a `.p12`, base64 |
| `APPLE_CERTIFICATE_PASSWORD` | the password that `.p12` was exported with |
| `APPLE_API_KEY` · `APPLE_API_ISSUER` · `APPLE_API_KEY_P8` | the notarization key's Key ID, Issuer ID, and the `.p8` file's text |
| `APPLE_PROVISIONING_PROFILE` | the provisioning profile, base64 |
| `TAURI_SIGNING_PRIVATE_KEY` | the updater private key file's text |

`APPLE_SIGNING_IDENTITY`, `Developer ID Application: Habiby LLC (<Team ID>)`, is a public
name, so it is a repository variable rather than a secret.

*Agent:* `node scripts/release-keychain.mjs secrets` sets all of them from this Mac's
keychain. The maintainer clicks Allow once, on the certificate-export dialog. `gh secret set` encrypts
each value on this Mac with the repository's public key, so nothing crosses a clipboard
(which Universal Clipboard would sync to every device on the Apple Account), a screen or a
command line. Before it uploads anything, it checks that the exported certificate reads
back the way `release.mjs` reads it: macOS writes a legacy PKCS#12, which OpenSSL 3
opens only with `-legacy`.

---

<a id="SHIP-D113"></a>

#### The Mac App Store

After 1.0 (docs/engineering/release-engineering.md#REL-56). The app's side and
the release's are built: `build-app.mjs --app-store`,
`tauri.appstore.conf.json`, the sandboxed
[src-tauri/Entitlements.plist](../../src-tauri/Entitlements.plist), and
`scripts/release-app-store.mjs`, which builds, signs, packages, validates,
uploads and submits each stable release's store build by itself. Until the
material below exists, each release says what is missing and goes on without
the store. Everything that recurs (the profile, the listing, What's New, the
screenshots, the submission and its release once approved) is the machine's;
what follows has no API, or is a private key, and is done once.

*Maintainer,* once, at
[developer.apple.com/account](https://developer.apple.com/account) and
[appstoreconnect.apple.com](https://appstoreconnect.apple.com):

1. **The two certificates.** In **Xcode → Settings… → Accounts → Manage
   Certificates…**, click **+** and choose **Apple Distribution**, then **+**
   again and choose **Mac Installer Distribution**. Xcode keeps both, with
   their private keys, in the login keychain beside the Developer ID one.
2. **The app's record.** In App Store Connect, **Apps → + → New App**:
   platform macOS, name Proscenium, the bundle ID `org.habiby.proscenium`, a
   SKU of your choosing. Then, once, the pages no API writes: **App
   Privacy**, the **age rating**, **Pricing and Availability** (free, every
   territory), the **categories**, and **App Review Information** (contact and
   notes). The listing's text, What's New and the screenshots are the
   machine's, with each release.
3. **The key's access.** The notarization key (setup step 3) has
   **Developer** access, which may upload a build but not submit one for
   review or make a profile. In **Users and Access → Integrations → Team
   Keys**, give that key **App Manager** access. If App Store Connect offers
   no change of access, generate one team key with App Manager access in its
   place and run `notary` with it: one key notarizes and uploads, never a
   second beside it.
4. **Each year, the certificates again.** Both last a year; step 1 again, then
   `move`. The profile follows by itself.

*Agent:* `node scripts/release-keychain.mjs move` takes both new identities
and their chains to the build host with the rest; its `status` there names
each. `node scripts/release-app-store.mjs material`, on the build host, says
what the store build still lacks. Should App Store Connect refuse the key a
profile, the build says so, and `node scripts/release-keychain.mjs profile`
files one made by hand (**Profiles → +** → **Mac App Store Connect**, type
Mac, App ID `org.habiby.proscenium`, the Apple Distribution certificate).

The App Store build is sandboxed, so its preferences live inside its container.
The download build is not, so moving between the two channels means choosing
the Plays folder once more.
