<a id="CONTRIB-D100"></a>

# Contributing to Proscenium

Proscenium is written by one playwright, in the evenings. Issues, formats and
fixes are all read.

## Finding the feature you want to change

The [app documentation](docs/README.md) is organized by product area, then
feature. Read that feature's requirements and design before editing it.
[Engineering](docs/engineering/README.md) covers shared architecture and
implementation rules. These are the detailed references for you and your
coding agent; each requirement has a stable id that code and tests can cite.
The [documentation guide](docs/engineering/documentation.md) explains how to
keep those references intact when a feature changes.

<a id="CONTRIB-D101"></a>

## The most useful things to send

- **A format.** The page rules a theatre, festival or publisher asks for,
  written down. A format is one JSON file (schema: [formats/README.md](formats/README.md)).
  Format files are MIT licensed, so any tool can use them.
- **A bug you can reproduce**, with your macOS version, your Mac's chip (Apple
  silicon or Intel), the Proscenium version, and the steps. Never attach a play
  you don't want public.
- **Accessibility problems.** If someone using only a keyboard, VoiceOver or
  Voice Control cannot do what a pointer user can, that is a bug. The contract
  is [accessibility requirements](docs/app/preferences-and-help/accessibility.md#UI-D108).

<a id="CONTRIB-D102"></a>

## Before a first pull request: the CLA

Proscenium is licensed under the GNU AGPL, version 3 or later. Habiby LLC also
distributes it through app stores, whose terms the AGPL cannot satisfy on its
own. It can do that only while it holds the rights to every line, so
contributions come in under a Contributor License Agreement ([CLA.md](CLA.md)):

- you keep the copyright to what you wrote;
- you give Habiby LLC the right to distribute it under the AGPL and under other
  terms, such as an app store's;
- Habiby LLC promises that every version containing your work stays available
  under the AGPL or another open source license.

A bot asks for the signature on your first pull request: reply with the
sentence it gives you, once.

<a id="CONTRIB-D106"></a>

## How a pull request is taken in

The gates run on your pull request here, on GitHub's own Macs; a first-time
contributor's run waits for a maintainer to start it. A pull request is read,
and when it is taken in, it is carried into the development repository, where
the native self-test runs it in the real app before it can reach a release.
Your pull request is then closed with the commit it landed as, and your name
stays on that commit. Nothing is merged here directly.

<a id="CONTRIB-D103"></a>

## Building it

What you need installed is in the [README](README.md#building-it). Then:

```sh
bun install
bunx playwright install chromium webkit        # once, for smoke
bun run tauri dev                              # the macOS app
bun run dev                                    # the frontend in a browser, on a sample vault
```

Every change keeps these green:

```sh
bun test ./src                                 # unit tests
bun run typecheck
bun run lint                                   # Biome's rules, accessibility included
bun run format:check                           # Biome's and rustfmt's formatting (bun run format writes it)
bun run check:layout                           # no page geometry in code
bun run check:design                           # chrome on the design scales
bun run check:spdx                             # every source file licensed
bun run check:network                          # every address the app uses in one allowlist
bun run check:docs                             # documentation paths, sections and permanent ids
bun run check:names                            # no other writing app named outside the import tool
bun run check:webkit-floor                     # nothing newer than the oldest supported Mac's web engine
bun run check:version                          # one version number everywhere
bun run smoke                                  # the built app in a browser: layout, accessibility, keys
cargo test --manifest-path src-tauri/Cargo.toml
```

<a id="CONTRIB-D104"></a>

## Standards

- **Every source file starts with its SPDX header.** Copy the two lines from
  any neighbouring file.
- **Formatting is the formatters'.** `bun run format` writes Biome's formatting
  for TypeScript, scripts, stylesheets and the Worker, and rustfmt's for Rust,
  and `bun run format:check` is a gate, so a pull request that changes
  formatting by hand fails it. `bun run lint` runs Biome's recommended rules; the ones the
  tree did not meet when the gate went in are warnings until each is cleared,
  a rule at a time (`biome.jsonc` says which), so fixing one is welcome as its
  own pull request.
- **Page layout lives in `formats/`, never in code** ([formats/README.md](formats/README.md)).
- **Chrome stays on the design scales**, and the accessibility contract is part
  of the design ([DESIGN.md](DESIGN.md)).
- **What happens on disk follows [docs/app/keeping-work/storage-and-file-format.md](docs/app/keeping-work/storage-and-file-format.md)**:
  atomic writes, both versions kept, nothing silently overwritten.
- **A writer's work never leaves their computer.** No code may send a play's
  text, a title, a character name or a file path anywhere.
- **Comments say why**: the constraint, or the failure a rule exists to
  prevent. What the code does belongs in the code.

<a id="CONTRIB-D105"></a>

## Security

Please do not open a public issue for a security problem. See [SECURITY.md](SECURITY.md).
