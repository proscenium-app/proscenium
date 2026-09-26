<!--
SPDX-FileCopyrightText: 2026 Habiby LLC
SPDX-License-Identifier: CC-BY-4.0
-->

## What this changes, and why

<!-- The problem a writer had, and what the change does about it. Cite the
requirement it meets or changes by its document path and id, for example
docs/app/keeping-work/storage-and-file-format.md#STOR-12. -->

## The gates

Every one of these is green on this branch (CONTRIBUTING.md lists them; CI runs
them again here):

- [ ] `bun test ./src`
- [ ] `bun run typecheck`
- [ ] `bun run check:layout`, `check:design`, `check:spdx`, `check:network`
- [ ] `bun run check:docs`, `check:names`, `check:webkit-floor`, `check:version`
- [ ] `bun run smoke`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml`
- [ ] `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
- [ ] Documentation changed with the behaviour, if it did

## The CLA

A first pull request is asked to sign the Contributor License Agreement
(CLA.md): you keep your copyright, and every version containing your work stays
available under the AGPL. The CLA check on this pull request tells you how.

A pull request here is not merged as it stands: when it is taken in, it goes
through the full native checks in the development repository first, and this
pull request is closed naming the commit it landed as.
