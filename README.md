# Proscenium

A playwriting app for people who want their plays to be **files**.

A page that formats itself as you type, a binder for everything around the
script, and every word stored as plain, readable Fountain in a folder you
choose, on a disk you own.

## What it does

You open a folder. The binder on the left holds the script and everything
around it — research, character sheets, loglines, the throwaway notes. You
type, and the page formats itself: centered ALL-CAPS character cues, full-width
dialogue, indented stage directions. Enter goes to the element you almost
certainly want next; one keystroke fixes it when it guesses wrong. You never
open a menu to say "this line is dialogue."

Scenes are cards on a corkboard. Drag one and the script reorders on disk.
There is an outline, a cast list built from who actually speaks, a running-time
estimate, and print-ready PDF export with the page geometry a theatre expects.

## What it doesn't do

**No AI.** There is no assistant, no autocomplete that finishes your sentences,
no "rewrite this scene." The app formats what you type and keeps track of your
files. The writing is yours.

**No accounts, no cloud of its own, and your plays stay on your Mac.** No
sign-in. The app never sends your writing, a title, a character's name, or
where your files are. It checks for updates, and unless you switch it off in
Settings › Privacy it sends a few anonymous facts — which version, which
features get used, when it crashed — so it can get better. Nothing it sends
could show anyone a word of your play
([docs/app/keeping-work/privacy-and-telemetry.md](docs/app/keeping-work/privacy-and-telemetry.md)). Your folder
is yours to place: in iCloud Drive or Dropbox, that service syncs it like any
other folder, and the app has nothing to do with that.

**No sync engine.** Put the folder in iCloud, Dropbox, Syncthing, or nowhere.
That is your business, not the app's. But because sync *can* change a file
while you are elsewhere, the app carries a safety floor: it never overwrites
your work, it always keeps both versions, and **Changes** shows you what
arrived from somewhere else with a one-click way back.

## Your files

The folder is the product as much as the app is.

| What | Stored as |
|------|-----------|
| The script | `.fountain` — plain text, opens in any editor |
| Notes, research, character sheets | Markdown |
| The app's own bookkeeping | small, readable JSON |

No database. No bundle. No container. If Proscenium disappears tomorrow you
lose an editor, not a word of your work — and you don't need anyone's software
or permission to get it back.

## Getting it

Proscenium 1.0 runs on macOS 14 or later, on Apple silicon and Intel. Download
it from [proscenium.ink](https://proscenium.ink), or with Homebrew:

```sh
brew install --cask proscenium-app/tap/proscenium
```

It updates itself; Settings › Updates chooses between Stable and Beta.

## Building it

You need a Mac on macOS 14 or later, with:

- Xcode's Command Line Tools (`xcode-select --install`);
- Rust, through [rustup](https://rustup.rs). `rust-toolchain.toml` names the
  version, and rustup fetches it the first time you build;
- [Bun](https://bun.sh) 1.3.14 and [Node.js](https://nodejs.org) 24.

Then, from a clone of this repository:

```sh
bun install
bun run tauri dev                    # the app, rebuilt as you change it
bun run dev                          # the frontend alone, in a browser, on the sample folder
node scripts/build-app.mjs --local   # Proscenium.app for this Mac, with no updater
```

The last one leaves the app in `src-tauri/target/release/bundle/macos/`. A build
you make yourself is unsigned and never updates itself; it says `local` in Help ›
Copy Diagnostics.

Every change keeps the gates in [CONTRIBUTING.md](CONTRIBUTING.md) green. The
browser checks need Playwright's Chromium once: `bunx playwright install chromium`.

## The two things that make or break this product

1. **How the files are stored.** The folder is the single source of truth;
   there is no hidden app database. See
   [`docs/app/keeping-work/storage-and-file-format.md`](docs/app/keeping-work/storage-and-file-format.md) — the
   load-bearing spec.
2. **How the writing feels.** Real-time stage formatting and near-zero-friction
   element entry. See [`docs/app/writing/editor-ux.md`](docs/app/writing/editor-ux.md).

## Documentation

The [app documentation](docs/README.md) follows product areas and features, with
full requirements and design for contributors and their coding agents.
[Engineering](docs/engineering/README.md) covers the shared implementation.
Writer-facing help is the website's Guide,
[docs.proscenium.ink](https://docs.proscenium.ink).

## License

Proscenium is free software under the **GNU Affero General Public License,
version 3 or later**, with an additional permission for app-store
distribution — see [LICENSE](LICENSE). The format files in `formats/` are MIT
licensed so other tools can use them, and the documentation in `docs/` (the
requirements, the file format, the design system) is CC BY 4.0 so anyone can
implement what it describes; Courier Prime is under the SIL Open Font License;
the spelling dictionary keeps SCOWL's terms. Every source file carries an SPDX
header, and [REUSE.toml](REUSE.toml) covers the rest.

Copyright © 2026 Habiby LLC. The name and the arch logo are trademarks — see
[TRADEMARK.md](TRADEMARK.md). Contributions come in under a CLA — see
[CONTRIBUTING.md](CONTRIBUTING.md).

## Stack

- **Shell:** Tauri v2 — Rust backend, web frontend, one codebase to macOS, iOS
  and Android with native filesystem access. Chosen over Electron because
  Electron can't target mobile.
- **Editor core:** TipTap 3 (on ProseMirror). A play is a structured document,
  and ProseMirror's schema maps onto play element node types — which is what
  makes real-time WYSIWYG tractable.
- **Frontend:** React + TypeScript.
- **Fountain:** parse and serialize in-tree, informed by
  [`jonnygreenwald/fountain-js`](https://github.com/jonnygreenwald/fountain-js)
  and `afterwriting`, rather than a grammar written from scratch.

## Repository layout

```
proscenium/
  docs/            ← the design set
  src/             ← React + TS frontend
  src-tauri/       ← Rust backend (the vault, the watcher, export)
  formats/         ← page geometry and pagination policy, as data
  sample-vault/    ← a tiny real workspace that doubles as a format example
```
