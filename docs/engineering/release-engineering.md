# Release engineering

[Engineering](README.md) › Release engineering

Release requirements cover build artifacts, compatibility, signing, updates and contribution readiness. The procedure retains the detailed steps and acceptance criteria.

[Builds](#REL-D1) · [Native verification](#REL-D4) · [Updates](#REL-D6) · [Public repository](#PUBLIC-D100) · [Release procedure](#SHIP-D100)

## Requirements

<a id="REL-D100"></a>

<a id="REL-122"></a>

**REL-122** **The release contract:** one universal Proscenium, meant to launch correctly on
every Mac from Sonoma up, Apple silicon and Intel alike; signed, notarized and
self-updating. What is proven, and by what, is the machine's alone, and no
release waits on a person: the frontend against the floor's Safari on every run
(`check:webkit-floor`); the native app on the build host's macOS on Apple
silicon, and its Intel slice under Rosetta, launch to export; the update itself
on the build host, by the Stable update proof ([launch day](#SHIP-D104), step 8).
A native launch on Sonoma and a launch on Intel hardware are not proven, because
no machine this project uses can give either, and the release record says so.
This replaces REL-1
(docs/engineering/withdrawn-requirements.md#REL-1), whose "proven on those Macs
by CI" no machine this project uses can give for Sonoma or Intel hardware.

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

### The macOS floor

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

<a id="REL-D3"></a>

### CI

<a id="REL-10"></a>

**REL-10** GitHub Actions, in the `proscenium-app` organization.

Every push and pull request to the private development repository runs the gates on the build
host, a self-hosted runner registered to that repository alone, then the native self-test
(docs/engineering/release-engineering.md#REL-D4) natively and, for the Intel slice, under Rosetta,
with its negative control. A red result anywhere stops that commit, and a branch reaches `main`
only once its run is green; a tag builds, signs and notarizes a release there. The public
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
    - <a id="REL-42"></a> **REL-42** The App Store build embeds its own Mac App Store profile, from
      `tauri.appstore.conf.json`.
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

**REL-56** **Channel 2 (after 1.0): the Mac App Store.** Spec only for now:
`tauri.appstore.conf.json`, the full `Entitlements.plist`, a Mac App Store
provisioning profile, a Transporter upload, and the `app-store` channel flag.
The updater is compiled out of that channel — the store updates it.

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
    notes link.
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
release script. There is no analytics account or key. Rehearsals and local
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
5. Write the results into the release proof record under
   `docs/backstage/records/`. Nothing is published before launch.

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
3. *Agent,* on the maintainer's go: create `proscenium-app/proscenium`, public, and push
   the whole project as its one commit; create `proscenium-app/homebrew-tap`,
   public and empty.
4. *Maintainer:* make the Homebrew token (below), and the release job's token for
   `proscenium-app/proscenium` (Contents read and write on that one repository),
   which the build host needs to draft a release there: its runner's own token cannot write to the public repository.
5. *Agent:* make sure the Tagged release run of the last 0.9.x kept its files,
   because step 8 starts from its DMG.
6. *Agent:* `bun run version 1.0.0` if it is not already, tag `v1.0.0`, push
   the tag, then `node scripts/release.mjs --publish`. It refuses unless the
   tag on GitHub is exactly the tree it builds.
7. Check the draft ([Every release](#every-release), steps 6–7), then publish it
   (step 8 there). Publish only once `https://proscenium.ink/privacy` serves
   the website's privacy page (its launch deploy, the website repository's
   SPEC.md, privacy section): 1.0 is the first distributed copy that sends automatic reports,
   and the page must be public before it does.
8. *Agent:* run the **Stable update proof** workflow on the build host from the
   last 0.9.x to 1.0.0 and read its report. It installs the older copy under a
   scratch home with reports off, types a line into a scratch play, and presses
   Check Now and Restart to Update against the real update address. It passes
   only when the copy came back as 1.0.0, notarized and running, with the line
   in its play. This is the first update through the real address on the stable
   track, so it passes before anyone is told about the release.

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

<a id="SHIP-D107"></a>

#### Prepare

*Agent:*

1. Every gate green on `main`.
2. [CHANGELOG.md](../../CHANGELOG.md) under **Unreleased**, in words a playwright
   reads: what they can do now, what is better, what was broken and is fixed.
3. `bun run version 1.0.1`. That updates every file that states the version and
   turns Unreleased into this version's section. Versions are `x.y.z`; release
   candidates were 0.9.x.
   - Add the version to `RELEASED_VERSIONS_JSON` in
     [services/edge/wrangler.jsonc](../../services/edge/wrangler.jsonc).
     `updates.proscenium.ink` answers only for versions on that list.
4. Commit (`Proscenium 1.0.1`), tag `v1.0.1`, push both.

<a id="SHIP-D108"></a>

#### Build and draft

5. *Agent:* `node scripts/release.mjs --publish`. It takes 15–30 minutes, most of
   it Apple. The first notarization for a new team can take hours; the script
   waits. If it fails, its last line names the step. The common ones:
   - **missing signing material:** `node scripts/release-keychain.mjs status`
     names what is gone, and the setup step above makes it again.
   - **notarization rejected:** the output has a submission ID;
     `node scripts/release-keychain.mjs log <id>` shows Apple's reasons.
   - **stapling failed:** Apple's ticket had not reached its servers yet. Run
     the script again.
   - **the tag on GitHub is not this tree:** the commit that was tagged is not
     the commit checked out. Check out the tag and run it again.

<a id="SHIP-D109"></a>

#### Check the draft

6. *Agent:* download the draft's DMG with `gh release download`, mark it as
   downloaded (as in setup step 7), and check it: `spctl -a -vv` on the app
   inside says `source=Notarized Developer ID`, and its Info.plist says the
   right version. The draft must hold:
   - `Proscenium_1.0.1_universal.dmg`
   - `Proscenium_1.0.1_universal.app.tar.gz` and its `.sig` (what the updater downloads)
   - `latest.json` (what the updater reads), `notes.md`, `SHA256SUMS`, `build.json`
7. *Agent,* for 1.0.0 and for any release that changes signing, entitlements or
   the updater: setup step 7's file checks on the draft's app, and, once the
   release is published, the Stable update proof (step 8 of launch day) from the
   release before it.

<a id="SHIP-D110"></a>

#### Publish

8. The *maintainer* says publish, and says yes to deploying the Worker. The *agent* runs
   `node scripts/edge-wrangler.mjs deploy` first, so `updates.proscenium.ink`
   admits 1.0.1. Otherwise it answers 502 and every copy updates from GitHub
   directly. Then the agent runs `gh release edit v1.0.1 --draft=false`.
   Homebrew's workflow runs within a minute; the agent checks it went green and
   that `brew install --cask proscenium-app/tap/proscenium` installs 1.0.1.

A bad published release is fixed by publishing a better one, never by deleting
it: installed copies may already be updating to it.

---

<a id="SHIP-D111"></a>

#### Renewals and rotations

| What | Lasts | When it ends | What to do |
|---|---|---|---|
| Developer ID Application certificate | 5 years | Apps already signed keep working; new builds cannot be signed | Setup step 2 again, **then step 4's profile again** (a profile names its certificate) |
| Developer ID provisioning profile | 18 years, or until the certificate is replaced or the App ID's capabilities change | **The app stops launching** once its profile expires | Regenerate it (setup step 4, point 3), file it, ship a release |
| App Store Connect API key | No expiry | — | If it leaks, revoke it in App Store Connect and repeat setup step 3 |
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

#### Later: the Mac App Store

After 1.0 (docs/engineering/release-engineering.md#REL-D5, channel 2). What it will take:

- `src-tauri/tauri.appstore.conf.json`, signing with the sandboxed
  [src-tauri/Entitlements.plist](../../src-tauri/Entitlements.plist);
- a Mac App Store provisioning profile and an Apple Distribution certificate;
- a build without the updater (`--no-default-features --features custom-protocol`),
  because the store updates the app itself;
- an upload with Transporter.

The App Store build is sandboxed, so its preferences live inside its container.
The download build is not, so moving between the two channels means choosing
the Plays folder once more.
