# Proscenium

[![Latest release](https://img.shields.io/github/v/release/proscenium-app/proscenium?label=release&color=1f2933)](https://github.com/proscenium-app/proscenium/releases/latest)
[![macOS 14 or later](https://img.shields.io/badge/macOS-14%20or%20later-1f2933)](https://proscenium.ink/download)
[![Universal build](https://img.shields.io/badge/build-Apple%20silicon%20%2B%20Intel-1f2933)](https://github.com/proscenium-app/proscenium/releases/latest)
[![License AGPL-3.0-or-later](https://img.shields.io/badge/license-AGPL--3.0--or--later-c9a227)](LICENSE)
[![CI](https://github.com/proscenium-app/proscenium/actions/workflows/ci.yml/badge.svg)](https://github.com/proscenium-app/proscenium/actions/workflows/ci.yml)

**Playwriting software.** Free forever and made for plays and theater makers.
Also theater-making, sketch-writing and script-revision software.

[Download for Mac](https://proscenium.ink/download) ·
[Guide](https://docs.proscenium.ink) ·
[What’s inside](#whats-inside) ·
[Questions](#questions) ·
[Support](#support-the-work) ·
[Privacy](#privacy) ·
[Fountain](https://fountain.io) ·
[License](LICENSE)

Free and open source. Version 1.0.0 · macOS 14 or later, Apple silicon and
Intel in one universal build.

| Key | |
|---|---|
| Enter | next element |
| Tab | change it |
| ; | shortcuts |

In the window, the binder is on the left and the scene inspector on the right.
Each line takes its format as it’s written: the semicolon menu sets the act
heading, capitals become a character cue, and the cast list offers the next
speaker.

This page is [proscenium.ink](https://proscenium.ink), arranged for the reader
who arrives through GitHub, with what that reader needs and the site does not
carry: what the app is [made of](#what-it-is-made-of), how it is
[built](#building-it) and [checked](#checking-it), how to
[contribute](#contributing), how [updates](#updates) and [privacy](#privacy)
work in technical terms, and where the [documentation](#documentation) is.

## Getting it

**Proscenium for Mac.** [Download](https://proscenium.ink/download) the
universal DMG (the address answers with the
[latest release](https://github.com/proscenium-app/proscenium/releases/latest)),
or with Homebrew:

```sh
brew install --cask proscenium-app/tap/proscenium
```

It updates itself; Settings › Updates chooses between Stable and Beta
([Updates](#updates), below).

## Made for plays, not screenplays.

Most playwriting software was built for the screen and had a stage play bolted
on afterward. Proscenium was built for playwrights from the very start.

- Dialogue runs the full width. A screenplay squeezes it into a column.
- Stage directions in italics, set in from the left.

## Free, forever.

```
                              YOU
                        (suspiciously)
          Is it really free?
```

Yes. No subscription, no trial, no “monetization strategy”, and nothing held
back for a paid tier. The code is public and you can build it yourself.

## Your play is nobody’s business but yours.

```
                              YOU
                        (lowering voice)
          Will anyone see my play? Will it end up in some AI?
```

There is no account to open, no cloud to sign into, nothing reading over your
shoulder, and no machine offering to finish your sentences. The play lives in
a folder on your own Mac, as ordinary files you can open with anything, print,
or hand to a director.

The play’s folder on disk: a Fountain script, character sheets, notes and one
project file. This one is [`sample-vault/`](sample-vault/)’s:

```
The Weight of Water/
  The Weight of Water.fountain
  The Weight of Water.proscenium
  Characters/
    Jonah.md
    Mara.md
  Loglines/
    Logline.md
  Notes/
    Structure.md
  Research/
    1953 North Sea Flood.md
```

## Everything about the play, in one place.

Hold the script and everything around it: the research, the character sheets,
the idea you had at breakfast. Scenes are cards on a corkboard; move a card and
the play moves with it. There is an outline, a cast list made from whoever
actually speaks, and a page count that keeps up as you write.

## Every element, one key each.

Enter goes to the line you probably want next - dialogue after a cue, a stage
direction after a speech. When the guess is wrong, Tab cycles the line through
the everyday elements. And a semicolon on an empty line opens the lot, a letter
beside each.

The semicolon menu, on an empty line:

| Key | Element | Key | Element |
|---|---|---|---|
| `a` | action | `1` | act |
| `c` | character | `2` | scene |
| `d` | dialogue | `l` | lyric |
| `p` | parenthetical | `=` | scene summary (not printed) |
| `s` | scene heading | `>` | centered text |
| `t` | transition | `n` | note |
| | | `-` | page break |

## Whatever the theatre asks for, the page obliges.

Export is one window (whether you want the whole play or one actor’s sides)
and the PDF comes out, with page thumbnails and a preview of the first page.
When a theatre or festival sends its own rules - the margins, where the names
sit - pick the format that matches and the script reflows.

## If you can write a play, you can use it.

There is nothing technical to learn first. Help & Tutorials, in the title bar,
has six guided lessons of about three minutes each. They show you where to
type, notice when you have done it, and Show Me does a step for you when you
would rather watch.

[How the lessons work](https://docs.proscenium.ink/help#tutorials) ·
[Everything it does](#whats-inside)

## What’s inside

Everything Proscenium does, in roughly the order you’ll need it. The names are
the app’s own, so you can find them when you get there. Only shipped features
are here: nothing planned, nothing on an iPad.

### Learning it

- **Help & Tutorials.** Six guided lessons of about three minutes, in a
  practice play of their own. Show Me does a step for you.
- **Open the Sample Play.** On the Plays screen. Two acts, four characters and
  every element the editor knows.
- **Keyboard Shortcuts.** Every key in one list, from the Help menu, or ⌘/.

### Writing

- **Enter, Tab and ;.** Each new line is the kind you probably want. Tab
  changes it; a semicolon opens every element, a letter beside each.
- **(CONT’D).** A speech that runs over a page takes its name with it, and no
  name is left alone at the foot of a page.
- **Check Spelling as You Type.** It knows your cast’s names and the theatre’s
  words, and each play can be American or British.
- **Find.** Search the whole script, or only dialogue, stage directions, cues,
  or one character’s speeches.
- **Comments.** Notes to yourself in the margin, in amber. They never print.
- **Focus.** Everything but the page slides away. Esc brings it back.

### Seeing the play whole

- **Board.** Scenes as cards. Move a card and the script moves with it.
- **Outline.** Every scene in a table, with its pages, summary, notes, status
  and label.
- **Cast.** A cast list made from whoever speaks, and Who’s on stage, scene by
  scene.
- **Scene navigation strip.** Under the script, each scene sized by its pages,
  so a long one shows while you’re in it.

### Around the script

- **Binder.** Research, character sheets and notes beside the script. Anything
  in the play’s folder appears there.
- **Character sheets.** Start with Want, Obstacle, Voice, Backstory and
  Relationships, and keep a list of the scenes each person speaks in.
- **Split Side by Side.** Keep the Board, a character sheet or a dramaturg’s
  notes open beside the script.

### In and out

- **Import a Draft.** `.fdx`, `.docx`, `.pages`, `.rtf` and plain text come in
  as a new play, with your original kept. The programs those files come from
  are named where a writer needs them, in the Guide’s
  [Import a draft](https://docs.proscenium.ink/import) and the import tool’s
  [contract](docs/app/importing/document-import.md).
- **Export PDF.** Seven formats, from the Dramatists Guild’s to a UK layout, or
  design your own in Settings.
- **Sides.** One actor’s speeches, each after the few words that cue it.
- **Anonymous copy.** For a blind reading: no name or contact details.
- **Edit Opening Pages.** The title page, the characters page and any opening
  notes.
- **Export .docx and .odt.** For the theatre that wants a `.docx`.

### Keeping it

- **Plain files.** Each play is a folder of ordinary files you can open with
  anything.
- **Versions.** A copy about every five minutes as you write, what changed
  since, and a way back.
- **Changes.** If a file changes on another Mac, both versions are kept and you
  choose.
- **The Plays screen.** Every play with its length and a status, from idea to
  produced. Shelved is a status, not a verdict.
- **Where you left off.** It opens on the play you were writing.

### Comfortable to use

- **Light and Dark.** Or follow your Mac. The page stays paper either way.
- **Text size.** The interface up to 200%, and the printed page stays as it is.
- **The keyboard.** Anything you can drag, you can also do from the keyboard.

[Download for Mac](https://proscenium.ink/download) ·
[Read the Guide](https://docs.proscenium.ink)

## What it is made of

The [architecture](docs/engineering/architecture.md#ARCH-D101) is decided;
this is the short form.

| Layer | Choice | Why |
|---|---|---|
| App shell | **Tauri v2** | A Rust backend, a web frontend and native file access in one codebase. Chosen over Electron because it can also target iOS and Android; today Proscenium ships for macOS. |
| Editor | **TipTap 3** on ProseMirror | A play is a structured document. ProseMirror’s schema maps onto play element node types, which is what makes real-time formatting tractable. |
| Frontend | **React + TypeScript**, strict | With TipTap’s React bindings. |
| Script on disk | **Fountain** | Parsed and serialized in-tree, informed by the [`fountain-js`](https://github.com/jonnygreenwald/fountain-js) fork and `afterwriting`, rather than a grammar written from scratch. Round-trip fidelity is a tested requirement ([Fountain data model](docs/engineering/fountain-model.md)). |
| Page layout | **JSON in [`formats/`](formats/)** | Page geometry, indents, spacing and pagination policy are data ([schema](docs/app/formatting/formats-and-layout.md#SCHEMA-D100)). The editor’s page view, the one paginator (`src/layout/engine.ts`) and the PDF export consume a resolved format; `check:layout` fails the build on an inch or point literal in code. |
| Storage | **The Rust vault** | Reads, writes, watches a folder the writer chose. Atomic writes; both versions kept. |
| Services | **One Cloudflare Worker** in [`services/edge/`](services/edge/) | Behind the update check, the anonymous reports and Send Feedback ([Services](docs/engineering/services-and-feedback.md#SERV-D1)). |

**The single most important boundary:**
[Rust stores bytes, TypeScript assigns meaning](docs/engineering/architecture.md#ARCH-D102).
The Rust core never understands Fountain, the play schema or card metadata. It
opens a folder, lists it, reads and writes files atomically and durably,
watches for external changes, and detects conflict artifacts. Everything
semantic lives in TypeScript, so there is one Fountain implementation, the
Rust core stays small and auditable, and nothing on disk needs the app to make
sense of it.

```
proscenium/
  docs/            the contracts: app/ by product area, engineering/ for the shared references
  src/             React + TypeScript: editor/, workspace/, format/, layout/, pdf/, import/,
                   wordproc/, spell/, comments/, tutorial/, storage/, ui/, app/
  src-tauri/       Rust: the vault (bytes only), the watcher, export and format commands,
                   the updater, and the one network allowlist
  formats/         page geometry and pagination policy, as data (MIT)
  services/edge/   the Worker behind updates.proscenium.ink, reports and feedback
  dictionaries/    the spelling word lists, derived from SCOWL
  sample-vault/    a small real Plays folder that doubles as a format example
  scripts/         the gates, smoke, the native self-test and the release tooling
```

## Your files, in technical terms

The folder is the product as much as the app is, and
[storage and file format](docs/app/keeping-work/storage-and-file-format.md) is
the complete contract for everything on disk. The short form:

- **Any folder is a Plays folder.** The app writes nothing at its root: no
  index, no marker, no cache. A directory is a play iff it directly contains a
  file with the `.proscenium` extension; that is the whole rule
  ([the Plays folder](docs/app/keeping-work/storage-and-file-format.md#STOR-D2)).
- **One app file per play**, named for the play, small readable JSON that
  holds only what Fountain cannot express: card metadata, binder order,
  settings. Finder shows it as kind *Proscenium Play*
  ([play schema](docs/app/keeping-work/storage-and-file-format.md#STOR-D5)).
- **The script is `.fountain`**, plain text that opens in any editor and owns
  everything Fountain can express. Documents are Markdown. Everything else in
  the folder is the writer’s, and appears in the binder.
- **Atomic writes, both versions kept, nothing silently overwritten.** Nothing
  is ever deleted by the app except to the OS trash
  ([safe writes](docs/app/keeping-work/storage-and-file-format.md#STOR-D9)).
  Versions, a copy about every five minutes, live in the app’s own data
  directory, outside the folder
  ([recovery and versions](docs/app/keeping-work/storage-and-file-format.md#STOR-D10)).
- **Sync is somebody else’s folder sync.** The app talks to no service. Put the
  folder in iCloud Drive, Dropbox, Syncthing, or nowhere. Because sync *can*
  change a file while you are elsewhere, the app carries a safety floor: when
  something changes a file outside this window, both versions are kept and
  **Changes** shows what arrived, line by line, to keep or undo
  ([sync](docs/app/keeping-work/storage-and-file-format.md#STOR-D11)).
- **Legible to a stranger.** A person with Finder, or a program with `cat`,
  can reconstruct a whole play from the folder and the one app file.

No database. No bundle. No container. If Proscenium disappears tomorrow you
lose an editor, not a word of your work, and you don’t need anyone’s software
or permission to get it back.

## Building it

You need a Mac on macOS 14 or later, with:

- Xcode’s Command Line Tools (`xcode-select --install`);
- Rust, through [rustup](https://rustup.rs). `rust-toolchain.toml` names the
  version, and rustup fetches it the first time you build;
- [Bun](https://bun.sh) 1.3.14 and [Node.js](https://nodejs.org) 24;
- [ripgrep](https://github.com/BurntSushi/ripgrep) (`brew install ripgrep`),
  which two of the gates use.

Then, from a clone of this repository:

```sh
bun install
bunx playwright install chromium webkit   # once, for smoke
bun run tauri dev                         # the app, rebuilt as you change it
bun run dev                               # the frontend alone, in a browser, on the sample folder
node scripts/build-app.mjs --local        # Proscenium.app for this Mac, with no updater
```

The last one leaves the app in `src-tauri/target/release/bundle/macos/`. A
build you make yourself is unsigned and never updates itself; it says `local`
in Help › Copy Diagnostics.

## Checking it

Every change keeps these green:

```sh
bun test ./src                                 # unit tests
bun run typecheck
bun run check:layout                           # no page geometry in code
bun run check:design                           # chrome on the design scales
bun run check:spdx                             # every source file licensed
bun run check:network                          # every address the app uses in one allowlist
bun run check:docs                             # documentation paths, sections and permanent ids
bun run check:names                            # no other writing app named outside the import tool
bun run check:webkit-floor                     # nothing newer than the oldest supported Mac’s web engine
bun run check:version                          # one version number everywhere
bun run smoke                                  # the built app in a browser: layout, accessibility, keys
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

**`bun run dev` is not the app, and a selector is not a screen.** `bun run
smoke` builds `dist/` and drives the shipped bundle in headless Chromium and in
Playwright’s WebKit, on the app’s own in-memory Plays folder, and asserts that
every surface has a real box: present in the DOM but invisible on screen is a
failure. At every surface it runs axe-core against WCAG 2.2 A and AA in the
light and the dark scheme, presses the keys the
[accessibility contract](docs/app/preferences-and-help/accessibility.md#A11Y-19)
promises, and holds the surface’s ARIA snapshot against
[`scripts/aria/<surface>.yml`](scripts/aria/): a change to what a screen reader
is told is a change to that file, written with `bun run smoke -- --update-aria`
and reviewed like code.

**The native self-test runs the same checks inside the real app**: WKWebView,
the Rust vault, native keys and clicks
([native verification](docs/engineering/release-engineering.md#REL-D4)). On
every surface it audits, it reads WebKit’s own accessibility tree, the one
VoiceOver reads, through the app’s in-process Web Inspector, and holds it
against `scripts/aria/native/<surface>.yml`
([A11Y-16](docs/app/preferences-and-help/accessibility.md#A11Y-16)). A smoke
check is written once, in `scripts/smoke-checks.mjs`, and both drivers pick it
up:

```sh
node scripts/build-app.mjs --selftest   # this Mac’s slice
node scripts/selftest.mjs               # opens a window and drives it; leave the Mac alone
node scripts/selftest.mjs --break flex  # the negative control: must report the collapsed frame
```

**What may be claimed** is what those checks hold
([A11Y-17](docs/app/preferences-and-help/accessibility.md#A11Y-17)): WCAG 2.2
AA as axe-core checks it, the keyboard behaviour the checks press, and an
accessibility tree WebKit builds as expected on every surface the checks
visit. No screen reader has been used, and nothing here claims one has.

**Where each runs.** Every push and pull request on this repository runs every
gate above on GitHub’s hosted macOS runners
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)): no secrets, a
read-only token, and a first-time contributor’s run waits for a maintainer to
start it. The native self-test runs in the development repository, on the
maintainer’s build host, before a change can reach a release.

## Contributing

Proscenium is written by one playwright, in the evenings. Issues, formats and
fixes are all read. [CONTRIBUTING.md](CONTRIBUTING.md) is the whole of it;
the short form:

- **The most useful things to send**
  ([CONTRIB-D101](CONTRIBUTING.md#CONTRIB-D101)): a format, which is one JSON
  file ([formats/README.md](formats/README.md)) that any tool can use because
  format files are MIT licensed; a bug you can reproduce, with your macOS
  version, your Mac’s chip, the Proscenium version and the steps, and never a
  play you don’t want public; and an accessibility problem, because if someone
  using only a keyboard, VoiceOver or Voice Control cannot do what a pointer
  user can, that is a bug.
- **The CLA** ([CONTRIB-D102](CONTRIBUTING.md#CONTRIB-D102), [CLA.md](CLA.md)):
  Proscenium is AGPL-3.0-or-later, and Habiby LLC also distributes it through
  app stores whose terms the AGPL cannot satisfy on its own. It can do that
  only while it holds the rights to every line, so contributions come in under
  a Contributor License Agreement. You keep your copyright; Habiby LLC may
  distribute your work under the AGPL and under other terms; every version
  containing your work stays available under the AGPL or another open source
  license. A bot asks for the signature on your first pull request.
- **How a pull request is taken in**
  ([CONTRIB-D106](CONTRIBUTING.md#CONTRIB-D106)): the gates run here, on
  GitHub’s own Macs. A pull request is read, and when it is taken in, it is
  carried into the development repository, where the native self-test runs it
  in the real app before it can reach a release. Your pull request is then
  closed with the commit it landed as, and your name stays on that commit.
  Nothing is merged here directly.
- **The standards** ([CONTRIB-D104](CONTRIBUTING.md#CONTRIB-D104)): every
  source file starts with its SPDX header; page layout lives in `formats/`,
  never in code; chrome stays on the design scales of [DESIGN.md](DESIGN.md);
  what happens on disk follows the storage contract; a writer’s work never
  leaves their computer; comments say why.

Coding agents read [AGENTS.md](AGENTS.md), which holds the same rules in the
form an agent needs.

## Updates

- **Two tracks a writer chooses in Settings › Updates**
  ([SET-37](docs/app/preferences-and-help/settings.md#SET-37)): **Stable**,
  the default, is each release, tagged `vX.Y.Z`. **Beta** is each test version
  before it, tagged `vX.Y.Z-beta.N`. A third track, alpha, is the maintainer’s
  own, built from every green commit of the development repository and served
  only to a copy that holds its key. An Intel Mac takes Stable alone: alpha and
  beta are built for Apple silicon only, and a release stays universal
  ([REL-124](docs/engineering/release-engineering.md#REL-124)).
- **The update service** is `updates.proscenium.ink/v1/<track>/{{target}}/{{arch}}/{{current_version}}`
  ([the addresses](docs/engineering/services-and-feedback.md#SERV-D1)). The
  check carries the three values in that address and one header,
  `Proscenium-OS: <major>.<minor>`, and nothing else. It answers with the
  track’s manifest, whose archive addresses stream the file from the GitHub
  release. If the service cannot be reached, a stable copy asks GitHub’s own
  `latest.json` directly, the one address outside the project’s domain, so a
  copy that cannot update never stays that way.
- **The updater** is `tauri-plugin-updater` behind a bounded transport of the
  app’s own ([the updater](docs/engineering/release-engineering.md#REL-D6)):
  HTTPS on the named hosts only, at most four redirect hops, downloads that
  stop at 512 MiB, minisign verification against the public key in
  `tauri.conf.json` before any archive entry is inspected, one app whose
  identifier matches and whose version is newer, and an atomic bundle exchange
  that keeps the old app until the swap is durable. It checks at launch and
  every 24 hours while the app runs, only if "Check for updates automatically"
  is on, downloads in the background, and never restarts on its own: a quiet
  notice says an update is ready, editing is held until a clean save is
  acknowledged, and the restart is the writer’s choice.
- **Each release** is built universal on the maintainer’s build host, signed
  with a Developer ID, notarized by Apple, and published on this repository’s
  [releases](https://github.com/proscenium-app/proscenium/releases) with its
  DMG, its signed archive, `latest.json`, `SHA256SUMS` and its notes from
  [CHANGELOG.md](CHANGELOG.md). Publishing a release updates the Homebrew cask.

## Privacy

In technical terms first: every address the app can contact is in one Rust
file, [`src-tauri/src/telemetry/allowlist.rs`](src-tauri/src/telemetry/allowlist.rs),
a unit test holds the list, and `bun run check:network` fails the build on an
`http(s)://` literal anywhere else in `src/` or `src-tauri/src/`. All network
traffic leaves from Rust: the webview gets a strict content security policy,
and on macOS a content rule list compiled before the window exists blocks every
URL except the app’s local schemes and IPC, which closes the speculative
preconnects that bypass CSP. Smoke records every request the page makes and
fails on any that is not to the local test server
([the network, locked down](docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D2)).
Usage counts are named from a closed enum and kept only as daily totals;
crash reports carry a stack trace and no message; feedback sends only the
words you put in its form ([privacy and telemetry](docs/app/keeping-work/privacy-and-telemetry.md)).
Settings › Privacy turns usage and crash reports off; update checks have their
own switch. Development builds and builds you make yourself send no reports.

What follows is [proscenium.ink/privacy](https://proscenium.ink/privacy), the
page a writer reads.

Your plays and files stay on your Mac. Proscenium never collects your writing:
no play text, titles, character names, filenames or paths. Usage counts record
which features are used, never what you write with them. Send Feedback sends
only the words you choose to put in its form. Exporting, copying and sharing a
file do what you ask them to do. A Plays folder in a sync service and macOS
features such as Writing Tools, Services and Universal Clipboard follow their
own settings.

**Everything Proscenium collects, and why.** The table below is the complete
list of data that may leave your Mac; anything not in it is not collected. No
reason, no field. A test holds the table to the app's list of events and to our
service's, so neither can send something this page does not list.

| What is sent | Fields and allowed values | Why |
|---|---|---|
| Update check | platform `darwin`; chip `aarch64` or `x86_64`; current app version; macOS major/minor in `Proscenium-OS` | Find a compatible update and count how often copies of each version are used on each system. This is an estimate of copies, not a count of people. |
| Release download | release version and one of its own DMG, signed archive or signature filenames | Deliver the chosen release and count downloads by version. These are our release filenames, never yours. |
| Every usage batch | `version`, `platform`, `arch`, `os`, `channel` (`developer-id` or `app-store`) | See which releases, systems and delivery channels need support. |
| Usage batch shape | `events`: up to 25 items, each with `name` and `props` from the rows below | Group counts into fewer requests without identifying a session. |
| `app_launched` | no extra properties | Count how often the app opens each day. |
| `play_opened` | `plays`: `1`, `2-5`, `6-20`, `21+` | Guide work on the Plays screen without an exact play count. |
| `surface_shown` | `surface`: `script`, `board`, `outline`, `cast`, `changes`, `format-designer` | See which parts of the app get used and which need work. |
| `pdf_exported` | `kind`: `whole`, `range`, `sides`; `format`: `dg-modern`, `stage-us-modern`, `stage-uk`, `samuel-french`, `dg-traditional`, `dg-musical`, `sketch-comedy`, `user` | Decide which exports and built-in formats to improve. |
| `format_saved` | no extra properties | Know whether writers make their own formats. |
| `update_installed` | `from`: released version numbers; `to`: released version numbers | Check whether updates arrive and how far behind copies fall. |
| `error_shown` | `code`: `E-BOOT`, `E-FOLDER-OPEN`, `E-FOLDER-REFUSED`, `E-FOLDER-ACCESS`, `E-ICLOUD`, `E-PLAY-OPEN`, `E-PLAY-MISSING`, `E-PLAY-CREATE`, `E-SAVE`, `E-SAVE-LOCKED`, `E-SAVE-PERMISSION`, `E-SAVE-NOT-ALLOWED`, `E-SAVE-DISK-FULL`, `E-SAVE-READ-ONLY`, `E-SAVE-FOLDER-GONE`, `E-SAVE-UNREACHABLE`, `E-CHANGED-ON-DISK`, `E-VERSIONS`, `E-BINDER`, `E-ACTION-STALE`, `E-VAULT-READ`, `E-VAULT-PERMISSION`, `E-EXPORT-PDF`, `E-EXPORT-FONT`, `E-PRINT`, `E-FORMAT-READ`, `E-FORMAT-IMPORT`, `E-FORMAT-EXPORT`, `E-FORMAT-SAVE`, `E-FORMAT-TRASH`, `E-FORMATS-FOLDER`, `E-REVEAL`, `E-FINDER-OPEN`, `E-UPDATE-RESTART`, `E-WATCH`, `E-WORKSPACE`, `E-OTHER` | Fix the errors writers actually meet without collecting error messages. |
| One crash | `event_id`: a random UUID for that crash, repeated in the envelope | Let Sentry recognize a retry of the same crash. It does not identify a writer, device or session. |
| Crash context | `release`: app version; `platform`: javascript (omitted for native, the protocol default); `tags`: app platform, chip and macOS major/minor; `timestamp`: UTC day at midnight, as Unix seconds | Find the affected build and system, and the day it failed. No precise crash time leaves the Mac. |
| Crash failure | `level`: fatal; one `exception` with a kind from the closed list and a `stacktrace` | Group failures by where execution stopped. No exception message or value is allowed. |
| Each stack frame | `module`: native or webview; optional compiled `function`, `lineno`, `colno` | Locate the failing code. No filename, path, source line, memory address or local variable is sent. |
| Crash envelope | item `type`: event; byte `length`; event id | Give Sentry the format and size of its single crash event. No other item type is allowed. |
| Feedback | `id`: one random submission UUID; `message`: your text | Store the message once, including when a response is lost, and let you tell us what you need. |
| Optional feedback email | `email`: only when you enter it | Reply to you. It is not used for marketing or added to a usage or crash report. |
| Optional feedback details | The exact text under View Details, only when Include technical details is checked | Help understand the problem you are reporting. |
| Included diagnostic facts | app version/channel, chip, macOS version, accent, built-in format ids or `user`, default format, preference switches, sync-provider kind | Reproduce the setup that matters to your feedback. No play, user-format name, learned word or path appears. |
| Included diagnostic history | last 20 error codes with their local times/repeat counts; safe local crash summaries | Understand the failures you chose to show us. These precise local times appear only in details you inspect and include. |
| A browser link you choose | releases, one release version, license, support or privacy | Open the page you requested. These links are not usage events. |

The failure kinds are `RustPanic` for a native panic and `Error`, `TypeError`, `RangeError`, `SyntaxError`, `ReferenceError`, `EvalError`, `URIError`, `AggregateError`, `InternalError`, `UnhandledRejection`, `PageError`, `AbortError`, `DataCloneError`, `InvalidStateError`, `NotFoundError`, `NotAllowedError`, `NotSupportedError`, `SecurityError`, `QuotaExceededError`, `NetworkError`, `TimeoutError`, `InvalidCharacterError`, `HierarchyRequestError`, `IndexSizeError` for a page failure. An unrecognized page failure uses `Error`.

The built-in format values are `dg-modern`, `stage-us-modern`, `stage-uk`, `samuel-french`, `dg-traditional`, `dg-musical`, `sketch-comedy`, and
`user` for every format you made. The error code values are `E-BOOT`, `E-FOLDER-OPEN`, `E-FOLDER-REFUSED`, `E-FOLDER-ACCESS`, `E-ICLOUD`, `E-PLAY-OPEN`, `E-PLAY-MISSING`, `E-PLAY-CREATE`, `E-SAVE`, `E-SAVE-LOCKED`, `E-SAVE-PERMISSION`, `E-SAVE-NOT-ALLOWED`, `E-SAVE-DISK-FULL`, `E-SAVE-READ-ONLY`, `E-SAVE-FOLDER-GONE`, `E-SAVE-UNREACHABLE`, `E-CHANGED-ON-DISK`, `E-VERSIONS`, `E-BINDER`, `E-ACTION-STALE`, `E-VAULT-READ`, `E-VAULT-PERMISSION`, `E-EXPORT-PDF`, `E-EXPORT-FONT`, `E-PRINT`, `E-FORMAT-READ`, `E-FORMAT-IMPORT`, `E-FORMAT-EXPORT`, `E-FORMAT-SAVE`, `E-FORMAT-TRASH`, `E-FORMATS-FOLDER`, `E-REVEAL`, `E-FINDER-OPEN`, `E-UPDATE-RESTART`, `E-WATCH`, `E-WORKSPACE`, `E-OTHER`.

There are no usage/session/user ids, exact play counts, location fields,
locale, device names, cookies, custom user-agent strings or writing in the
automatic reports. Any connection shows your internet address to the service
that answers it. Our service uses it only while answering, to handle the
connection and limit abuse; it is not stored, turned into an identifier or
passed on. Sentry labels each crash report with an approximate country and
city, worked out from the server that passed the report on: one near you,
never your own address. We do not use that label. If our update service
cannot be reached, the app checks GitHub for updates instead, connecting to it
directly.

Our service runs on Cloudflare, and crash reports are stored with Sentry.
Both handle this data only on our behalf. Update checks, downloads and usage
counts are kept only as daily totals, for two years, with no record of any
single request. Crash reports are kept for 30 days, and our service keeps no
copy of them. On your Mac, unsent usage counts wait only in memory, for up to
seven days, and at most 20 crash records wait until they are sent or replaced
by newer ones.

Feedback is held privately and securely by the Proscenium team, and every
copy is deleted after one year. Only the team reads it, and it is never
forwarded or shared. Your address is used only to reply to you. The app keeps one unsent
draft outside the Plays folder until a confirmed send or Discard Draft. It is
never sent in the background. Technical details are gathered fresh and are not
saved in the draft.

Settings > Privacy turns usage and crash reports off immediately and discards
queued reports. Update checks have their own switch. Feedback remains available
with both off. Opening or closing Feedback sends nothing.

**The website** counts visits with Cloudflare Web Analytics: totals such as
the pages viewed, the site that sent you there and your country. It sets no
cookies, stores nothing in your browser and does not follow you from site to
site. A link you open from the app is an ordinary visit; the app itself sends
nothing to the website.

**Sponsors** give through GitHub Sponsors, and GitHub handles the payment; we
never see card details. GitHub tells us each sponsorship's amount and date and,
unless you sponsor privately, your public GitHub name. We keep that only to
thank you by name on this website and in the app's About. A private sponsor is
counted, never named. A monthly sponsor is removed when the sponsorship ends,
and a one-time gift after a year. The app never asks for the list: each release
carries it as it stood when that release was built. GitHub's own terms cover
what GitHub keeps and shows us.

## Questions

"Is it really free?" and "Will it end up in some AI?" are answered above, as
[Free](#free-forever) and [Private](#your-play-is-nobodys-business-but-yours).
Every answer here was checked against the app's code on 2026-09-24; the names
in them are the app's own.

### Before you switch

**My play is in another program’s file (an `.fdx`, a `.docx`, a `.pages`, or
my archaic writing system’s), can Proscenium open it?**

Bring it. Proscenium opens `.fdx`, `.docx`, `.pages`, `.rtf` and plain text
files. Choose File › Import a Draft, or drop the file on the Plays screen. You
see how each line was read before the play is made, and your original file is
kept, untouched, in the play’s Originals folder. From an online document
editor, download a `.docx` copy first. The programs those files come from are
named where a writer needs them, in the Guide’s
[Import a draft](https://docs.proscenium.ink/import) and the import tool’s
[contract](docs/app/importing/document-import.md).

**Where is my play saved? What if this app disappears?**

In the folder you chose the first time you opened it - iCloud Drive, or one of
your own. Each play is its own folder: the script is a plain text file, the
notes are plain text, and the rest is small enough to read. If Proscenium
vanished tomorrow you would lose a program, not a line.

**Does it meet accessibility standards?**

Every build is checked against the WCAG 2.2 AA standard by automated tests,
which also press the keys: everything works from the keyboard, and interface
text scales to 200% without moving the printed page. It has not been tried
with a screen reader such as VoiceOver, so it makes no promise there yet - if
something gets in your way, please tell us. An exported PDF carries its title,
language and reading order.

**Can my co-writer and I work on it together?**

Yes. Each of you writes on your own Mac, and the play travels between you in a
shared folder. When your co-writer’s edits arrive, Changes shows exactly what
they altered, line by line, to keep or undo. Leave each other comments in the
margin - start one with a name, like “Sam: cut this?”, and they’ll know who’s
asking.

**Is this for screenplays too?**

No. It was built for plays and it stays there. Everything: the page, the
defaults, and the keys are for the stage.

### While you write

**Every theatre wants a different format.**

Choose it from the title menu and the page reflows. Your words do not change;
only the page does. Seven layouts ship, among them the Dramatists Guild’s
modern and traditional, Samuel French, and a UK layout with the names on the
left. A format is one small file, and Settings has a designer, so the style
sheet your festival sent can become one.

**The festival wants a blind copy.**

Tick Anonymous copy in the export window and the title page goes out without
your name or contact details. If your name turns up anywhere else in the
script, it tells you where. Your own copy keeps your name.

**Where do the title page and character list go?**

In Edit Opening Pages, in the title menu: the title page, the characters page
and any opening notes. The names and descriptions come from your Cast, and
each export lets you choose which of those pages go with it.

**They want it as a `.docx` file.**

Choose Export .docx… or Export .odt… from the title menu. Each line arrives
with a named style - Character, Dialogue and the rest - on your format’s page,
with Courier Prime built in. Their word processor sets its own page breaks, so
the pages can differ a little from the PDF.

**I need sides for a reading tomorrow.**

Choose their name under Part in the export window. You get their speeches,
each after the few words that cue it, with the scene headings, in the play’s
format.

**Can I get back something I cut last week?**

Yes. Versions, in the title menu, keeps a copy as you write - about one every
five minutes - and shows what changed between any of them and the script now.
Restore puts one back, and the script you had is kept too.

**A dramaturg sent notes. Where do they go?**

In the binder, beside the script. Drop anything into the play’s folder from
anywhere - a PDF from a dramaturg, a note from your phone - and it appears.
Your own notes go in the margin as comments, in amber, and never print.

## From a playwright

I produce shows and write plays and quickly got frustrated by there being no
dedicated application for playwriting. I used to write in screenwriting
software, and every submission ended with an hour of fighting the formatting.
Everything on the market was built for the movies first, and the free ones
kept dying. So I built the one I wanted, and improved it over time based on my
needs. Other playwrights started asking, and I'm happy to give back to this
incredible community something for free to help them. Happy writing.

Alexander

## Support the work

Proscenium is free and will stay that way but it has costs. Donating supports
future features, updates, and this playwright getting a cup of coffee during
his next build session. One-time or monthly with no fees.

Proscenium is free and stays free. It still costs money to make. Here is
roughly what a year of it costs, so you know what a sponsorship pays for.

**A year of Proscenium**, in US dollars:

| | What it pays for | A year |
|---|---|---|
| Signing | Apple’s yearly fee, so your Mac opens Proscenium without a warning. | $99 |
| The website and updates | The address, this site, the Guide, and the service that tells the app a new version is out. | about $25 |
| Equipment | The machines that build, sign and test every release, over the years they last. | about $175 |
| **A year** | | **about $300** |

**Not on the bill.** The time. Evenings and weekends, after the day job, for
as long as it has taken. Anything a sponsorship brings in over the bill buys
the next feature some of it.

[**Support the work**](https://proscenium.ink/support), one-time or monthly
with no fees, through GitHub Sponsors.

**The Program.** Sponsors are listed by level, the way a theatre program thanks
its patrons: Benefactors at $25 a month, Patrons at $10, Friends of the House
at $5. Sponsor privately and you’re counted but not named. A level unlocks
nothing in the app; this is the thank-you. The card is headed *With grateful
thanks to*, private sponsors follow the named ones as “and one more who prefers
to remain in the wings”, and until the first name is written it reads: “The
house is dark, the ushers are playing cards in the lobby, and the first name
in this program has yet to be written. It could be yours.”

## Documentation

The [app documentation](docs/README.md) follows product area, then feature,
then requirements and design, with a stable id on every requirement that code
and tests cite:

1. [Writing](docs/app/writing/README.md): script elements, dialogue, spelling,
   undo and comments.
2. [Organizing a play](docs/app/organizing/README.md): the binder, scenes,
   outline, materials and cast.
3. [Formatting and export](docs/app/formatting/README.md): page formats,
   opening pages, PDF and the format designer.
4. [Bringing work in](docs/app/importing/README.md): supported documents,
   import review and creating a play.
5. [Keeping your work](docs/app/keeping-work/README.md): files, saving,
   recovery, sync and privacy.
6. [Preferences and help](docs/app/preferences-and-help/README.md): settings,
   accessibility, guided practice and feedback.

[Engineering](docs/engineering/README.md) covers the shared implementation:
architecture, the Fountain model, the design system, platform behaviour,
services and release engineering. [Product scope](docs/app/product.md) is the
north star, and [PRODUCT.md](PRODUCT.md) and [DESIGN.md](DESIGN.md) the design
context. The two things that make or break this product are
[how the files are stored](docs/app/keeping-work/storage-and-file-format.md)
and [how the writing feels](docs/app/writing/editor-ux.md).
Writer-facing help is the website’s Guide,
[docs.proscenium.ink](https://docs.proscenium.ink).

## Security

Please do not open a public issue for a security problem. See
[SECURITY.md](SECURITY.md).

## License

Proscenium is free software under the **GNU Affero General Public License,
version 3 or later**, with an additional permission under its section 7 for
distribution through an app store, provided the corresponding source stays
available under the AGPL, free of the store’s restrictions; see
[LICENSE](LICENSE). The format files in `formats/` are MIT licensed so other
tools can use them, and the documentation in `docs/` (the requirements, the
file format, the design system) is CC BY 4.0 so anyone can implement what it
describes; Courier Prime is under the SIL Open Font License; the spelling
dictionary keeps SCOWL’s terms. Every source file carries an SPDX header, and
[REUSE.toml](REUSE.toml) covers the rest.

Copyright © 2026 Habiby LLC. The name and the arch logo are trademarks; see
[TRADEMARK.md](TRADEMARK.md). Contributions come in under a CLA; see
[CONTRIBUTING.md](CONTRIBUTING.md).
