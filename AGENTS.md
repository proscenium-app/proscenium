# Proscenium — agent guide

Tauri v2 + React/TS playwriting app for macOS. Bun for everything JS. The
[documentation index](docs/README.md) leads from product areas to feature
contracts; read the feature's requirements and design before changing it.
Shared implementation references live in [Engineering](docs/engineering/README.md),
and [CONTRIBUTING.md](CONTRIBUTING.md) is how a change comes in.

Cite the full repository-relative document path and stable id, for example
`docs/app/keeping-work/storage-and-file-format.md#STOR-12`. Requirement ids never
change meaning or get reused; withdraw one explicitly when replacing its
behavior. The [documentation guide](docs/engineering/documentation.md) governs
organization and moves.

CLAUDE.md holds the single line `@AGENTS.md`, so every agent reads this one file.

## Commands (all must stay green)

```bash
bun test ./src                                # unit tests (./src: a bare `src` is a name filter
                                              # that scans the whole checkout)
bun run typecheck                             # tsc --noEmit
bun run check:layout                          # no physical layout constants outside formats/
bun run check:design                          # chrome type/radius/gap on the scale, no undefined tokens
bun run check:spdx                            # every source file carries its SPDX header
bun run check:network                         # no http(s) address outside src-tauri/src/telemetry/allowlist.rs
bun run check:docs                            # documentation paths and stable requirement/design ids
bun run check:names                           # no other writing app named outside the import tool (src/import/)
bun run check:webkit-floor                    # dist/ CSS + JS against the macOS floor's Safari (14 → 17)
bun run check:version                         # one version in package.json, Cargo.toml, tauri.conf.json…
bun run smoke                                 # drives the built dist/ bundle in a browser; axe + key checks
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
bun run dev                                   # browser dev on :1420 (sample vault, no Tauri)
bun run tauri dev                             # native dev
node scripts/build-app.mjs --local            # Proscenium.app for this Mac, no updater
```

CI (`.github/workflows/ci.yml`) runs every one of these on each pull request.
The native self-test (below) runs before a change is released, not here.

## Load-bearing rules

- docs/app/keeping-work/storage-and-file-format.md is the contract for everything
  on disk (atomic writes, conflict floor, manifests, reserved names). Read it
  before touching autosave, manifests, watchers, or anything that writes a
  writer's folder. Never lose a writer's words: keep both versions, never
  silently overwrite.
- **Chrome layout lives in the token block, and check:design enforces it.**
  DESIGN.md is the contract for the visual system: six chrome type sizes, one
  radius scale, one menu anatomy, seven accent tokens. A `font-size`,
  `border-radius` or `gap` off the scale fails the build, as does reading a
  `--token` nothing defines.
- **Accessibility is part of that contract**
  (docs/app/preferences-and-help/accessibility.md#UI-D108), and smoke enforces
  it: axe-core fails the run on a serious WCAG 2.2 AA finding, and keyboard
  checks press the keys. New floating chrome goes through `src/ui/Menu.tsx` or
  `src/ui/Sheet.tsx`, which own the keyboard through `src/ui/layers.ts`.
  Anything that changes without focus speaks through `src/ui/announce.ts`;
  every drag gets a key.
- The accent is a preference (`settings.json`, default gilt), applied as
  `data-accent` on the document element. Nothing else in the CSS may hold an
  accent literal; oxide means destructive.
- **No other writing app is named outside the import tool**, and
  `bun run check:names` enforces it. Comments, test names and docs describe a
  behaviour on its own terms, and name a file format by its extension (`.fdx`).
  The import tool keeps the names, because a writer needs them to find a source
  app's export menu: `src/import/` and docs/app/importing/document-import.md. A
  line elsewhere that has to name one carries `names: import tool` in a comment.
- Script layout never lives in code. Page geometry, indents, spacing and
  pagination policy come from formats/*.json (schema: formats/README.md); the
  renderer, engine and PDF consume a resolved FormatSpec. check:layout enforces
  this (no in/pt literals in src/editor, src/layout, src/pdf).
- One paginator: src/layout/engine.ts is the single source of truth for page
  breaks; the editor's page view and PDF export both consume its output.
- **No AI in the app.** PRODUCT.md and docs/app/product.md rule it out: no
  assistant, no model, nothing that reads as an AI product. Don't add one behind
  a flag or a setting.
- The document import contract is docs/app/importing/document-import.md: the
  source is read only, nothing is written until Create New Play, and an import
  makes a new play without replacing or overwriting anything. Reading is local,
  deterministic and cancellable.
- **A writer's work never leaves their computer.** No code may send a play's
  text, a title, a character name or a file path anywhere; the only addresses
  the app contacts are in `src-tauri/src/telemetry/allowlist.rs`
  (docs/app/keeping-work/privacy-and-telemetry.md).
- Fixtures are synthetic: never commit a real person's play, name or path.

## Map

- docs/app/product.md — product north star; PRODUCT.md/DESIGN.md — design context
- src/format/ spec+validation+registry+serializer+generated CSS ·
  src/app/formats/ the format designer (draft, sampler, preview) ·
  src/app/settings/ the Settings sheet and the settings store · src/layout/ engine ·
  src/pdf/ export · src/import/ the document import tool ·
  src/spell/ spell checker (pure; data in dictionaries/) ·
  src/editor/ TipTap surface ·
  src/workspace/ manifests+binder+cards · src/storage/ vault client+floor
- src-tauri/src/ — vault (bytes only), watcher, export/formats commands
- sample-vault/ — a small real folder that doubles as a format example

## Verification habits

**`bun run dev` is not the app, and a selector is not a screen.** A stylesheet
edit once collapsed the editor's frame: every element stayed in the DOM, every
`querySelector(…).click()` kept working, and the built app opened on an empty
window. Dev runs unminified React on a different storage path, and every check
that navigates by selector passes straight through a collapsed layout.

So: **`bun run smoke`** before saying a UI change works. It builds `dist/` and
drives the shipped bundle in headless Chromium and in Playwright's WebKit on the
app's own in-memory vault (`__PROSCENIUM_FIXTURE__`, fenced behind `!isTauri()`),
and it asserts every surface has a real box — "present in the DOM, invisible on
screen" is a failure. It also scans each surface with axe-core in both schemes,
presses the keys the accessibility contract promises, and holds each surface's
ARIA snapshot against `scripts/aria/<surface>.yml` (`--update-aria` rewrites
them after a deliberate change). `bun run smoke -- --shots` writes PNGs to
`.smoke/` for both schemes. Playwright's WebKit is not Apple's WKWebView.

**The native self-test runs the same checks inside the real app** (WKWebView,
the Rust vault, native keys and clicks; docs/engineering/release-engineering.md#REL-D4).
A new smoke check is written once, in `scripts/smoke-checks.mjs`, and both
drivers pick it up:

```bash
node scripts/build-app.mjs --selftest   # this Mac's slice
node scripts/selftest.mjs               # opens a window and drives it; leave the Mac alone
node scripts/selftest.mjs --break flex  # the negative control: must report the collapsed frame
```

The self-test app has its own bundle id and storage, so it never touches a
writer's real Proscenium. `tauri-driver` cannot help here: WebDriver support is
Linux and Windows only, because safaridriver will not attach to an in-app
WKWebView.

Browser dev is the right tool for iterating (its vault seeds from
sample-vault/). PDF changes: generate from sample-vault and look at the pages.
