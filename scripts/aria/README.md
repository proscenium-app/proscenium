<!-- SPDX-FileCopyrightText: 2026 Habiby LLC -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Accessibility trees

What each surface tells a screen reader, held against the checks
([docs/app/preferences-and-help/accessibility.md](../../docs/app/preferences-and-help/accessibility.md#A11Y-D2)).
A change here is a change to what VoiceOver is given: read the diff as you would code.

- `<surface>.yml` holds Playwright's ARIA snapshot of a surface, taken by `bun run smoke` in
  Chromium. `<surface>.dark.yml` exists where the dark pass reads a surface otherwise. A
  dedicated check's file (`focus-order-settings.yml`) may have `<name>.webkit.yml` for
  WebKit's own reading. `bun run smoke -- --update-aria` rewrites them all.
- `native/<surface>.yml` holds WebKit's own accessibility tree in the real app, read by the
  native self-test on the build host, and `native/<surface>.dark.yml` where the dark pass
  reads a surface otherwise. `node scripts/aria-accept.mjs <run-id>` takes them from
  a pipeline run's evidence.
