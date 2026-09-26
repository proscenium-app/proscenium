# Accessibility

[Preferences and help](README.md) › Accessibility

Accessibility applies across the app: keyboard navigation, focus, assistive technology, text size and system appearance preferences. Every claim here is held by a machine check. No release, and no claim, waits on a person using the app with a screen reader: there is no human pass, so what a machine cannot hold is not claimed.

[Interaction contract](#UI-D108) · [Verification](#A11Y-D2) · [Public facts](#A11Y-D1)

## Requirements

<a id="UI-D108"></a>

### Accessibility — the contract

<a id="A11Y-18"></a>

**A11Y-18** Full keyboard use, the accessibility tree that VoiceOver and Voice
Control read, Increase Contrast, Reduce Motion and Reduce Transparency are
requirements of this system, not a pass made over it. Each is held by a machine
check (the [verification](#A11Y-D2) below). What VoiceOver speaks from that tree,
and how a person gets on with it, is not tested, and nothing claims it. This
replaces A11Y-1 (docs/engineering/withdrawn-requirements.md#A11Y-1).


- <a id="A11Y-2"></a> **A11Y-2** **Interface text scales through 200%** in Settings › Appearance. The six type
  tokens and shared control heights follow that preference; chrome wraps and
  sheets remain scrollable. Script page zoom and print geometry are independent.
- <a id="A11Y-3"></a> **A11Y-3** **Layers own the keyboard top-down** (`ui/layers.ts`). Menus, sheets and alerts
  bind at the window, so only the top layer acts: Escape in a popup inside a
  sheet closes the popup, not the sheet. Each layer returns focus to where it
  came from; nothing leaves focus on `<body>`.
- <a id="A11Y-4"></a> **A11Y-4** **A page someone just made takes the cursor** (`ui/page-focus.ts`). New ▸
  Document and a sheet made from the Cast go straight to their page; a
  character or a script is named in the binder first, and ⏎ or ⎋ in the name
  carries the cursor on. The page takes it once its editor is ready — never
  over a layer, and never from a writer who has clicked or typed elsewhere.
- <a id="A11Y-5"></a> **A11Y-5** **A sheet keeps Tab inside it, and ⏎ belongs to the focused control.** ⏎ runs
  the default only when it was not pressed on a button. A field with `autoFocus` keeps focus when the sheet opens.
- <a id="A11Y-6"></a> **A11Y-6** **One Tab stop per composite control, arrows inside it**: segmented controls,
  radio groups (the card colours), the binder tree. Chrome that exists only for
  the pointer — a row's hover buttons, the running-time strip — is not a Tab
  stop, and always has a key or a menu item that does the same thing.
- <a id="A11Y-7"></a> **A11Y-7** **⌃⇥ / ⌃⇧⇥ move between the areas** (`app/regions.ts`): toolbar, a banner
  waiting on an answer, binder, the play, inspector, status bar. Tab in the
  script is the element ring, so without this the page is a keyboard trap. A
  banner lands on the answer it leads with, arrows reach the others.
- <a id="A11Y-8"></a> **A11Y-8** **Every drag has keys and a click-through alternative.** Binder rows move
  with ⌃⌘ + arrows or Actions › Move… (folder and position); scenes move from
  the outline's Move buttons; splitters take arrows. Right-click has ⇧F10 and ⌘;.
- <a id="A11Y-9"></a> **A11Y-9** **Every control has a name that contains its visible words** (Voice Control
  says what it sees), and a popup says its value: "What to export: Whole Script".
- <a id="A11Y-10"></a> **A11Y-10** **What changes without focus is spoken** through `ui/announce.ts` — two live
  regions mounted before use in the workspace and inside each modal dialog.
  Menus portal into that same modal scope, beside the painted panel so its
  animation and clipping cannot displace them. Toasts, the element kind at the caret, the cue
  autocomplete's pick, the leader menu's alphabet. Never a live region that
  mounts already full: WebKit does not read one.
- <a id="A11Y-11"></a> **A11Y-11** **Targets are 24px, or 24px apart** (WCAG 2.5.8). The zoom steps, tab close boxes and outline Move buttons retain their glyph sizes inside compliant targets.
- <a id="A11Y-12"></a> **A11Y-12** **Contrast**: labels 4.5:1 on every surface in both schemes and every accent;
  icons and the focus line 3:1 (docs/engineering/design-system.md#UI-D101). `prefers-contrast: more` steps past
  that; `prefers-reduced-motion` stops the sheet drop; `prefers-reduced-
  transparency` makes the vibrant layer opaque.
- <a id="A11Y-13"></a> **A11Y-13** **The PDF names itself**: title shown in the viewer's title bar, language set.

<a id="A11Y-D2"></a>

### Verification

What VoiceOver reads is the accessibility tree, so the tree is what is checked.
These replace A11Y-14 (docs/engineering/withdrawn-requirements.md#A11Y-14), whose
last promise was a human VoiceOver pass that will never run.

- **A11Y-15 — Withdrawn 2026-09-26.** Replaced by [A11Y-19](#A11Y-19), which audits every surface in both schemes from one pass per engine ([withdrawn requirements](../../engineering/withdrawn-requirements.md#A11Y-15)).
- <a id="A11Y-19"></a> **A11Y-19** **Smoke, in two engines and both schemes.** `bun run smoke` runs every check in
  Chromium and in Playwright's WebKit, one pass per engine in the light scheme.
  At every surface a check opens it runs axe-core against WCAG 2.2 A and AA,
  then switches the page to the dark scheme, runs it again and switches back,
  failing on a serious or critical finding in either (best-practice advice is
  printed and does not fail); it presses the keys the rules above promise. So
  both schemes are read from the same page, in the same state, and a check that
  only drives behaviour runs once. In Chromium, in both schemes at each of those
  surfaces, it takes Playwright's ARIA snapshot (`locator.ariaSnapshot()`)
  and holds it against the checked-in `scripts/aria/<surface>.yml` (or
  `<surface>.dark.yml` where the dark scheme reads it otherwise): roles,
  names, states and the live regions, with the page's own words and other
  timing left out. In both engines, dedicated checks hold the script as a named
  text box whose words are what was just typed, a live region whose words in
  the tree are what `src/ui/announce.ts` just said, and the order Tab takes
  through a sheet, each engine's own file where they differ. Limits: the
  snapshot is Playwright's own reading of the ARIA and HTML-AAM rules, which
  reads the same in both engines, so it is held once and is not either
  engine's platform tree; it gives an editable element no value; a page that
  boots in the dark scheme is the native self-test's, whose dark pass launches
  so (A11Y-16), not smoke's; and Playwright's WebKit is a WebKit, not Apple's
  WKWebView and not the floor's Safari.
- <a id="A11Y-16"></a> **A11Y-16** **The native self-test, in WebKit's own tree.** In the real
  app's WKWebView, on every surface the checks audit, the self-test reads the
  tree WebKit hands its NSAccessibility wrapper, which is what VoiceOver
  reads: the role WebKit computed, the name, the states, the live regions and
  a text box's words. It reads it through the app's own Web Inspector,
  connected in-process in the self-test build (`selftest_ax` in
  `src-tauri/src/selftest.rs`), which needs no grant a person clicks: the AX
  API on the app's own pid needs the Accessibility permission, and an
  NSAccessibility walk from the window stops at WebKit's remote element. Each
  surface's tree is held against the checked-in
  `scripts/aria/native/<surface>.yml`, and the dedicated checks of A11Y-19
  ask the same questions of it. It runs natively and for the Intel slice under
  Rosetta, on the macOS the build host runs. Limits: the tree is not speech,
  and the Mac's own VoiceOver settings, verbosity and rotor never enter it.
- <a id="A11Y-17"></a> **A11Y-17** **What may be claimed.** The app, the site and the records
  claim only what A11Y-19 and A11Y-16 hold: WCAG 2.2 AA as axe-core checks it,
  the keyboard behaviour the checks press, and an accessibility tree WebKit
  builds as expected on every surface the checks visit. None of them claims a
  screen reader was used, a VoiceOver or Voice Control pass, a participant
  walkthrough, or conformance or certification beyond those checks.

## Design

Keyboard ownership is centralized in `src/ui/layers.ts`. Menu and Sheet establish focus behavior; `src/ui/announce.ts` reports changes in the same modal scope. Region navigation and editor keys retain separate responsibilities.

The shared smoke definitions (`scripts/smoke-checks.mjs`) drive Chromium, Playwright's WebKit and the native WKWebView harness. The two drivers hold a surface's tree through one module, `scripts/aria-snapshots.mjs`. It normalizes what changes between runs: dates, the self-test's temporary folders, version numbers, session ids, the autosave's status and the scene a pane is scrolled to. A whole-surface snapshot leaves out timing and the play itself:

- the live regions' words, because which of several asynchronous announcements landed last is timing, not the surface (the regions themselves stay);
- a toast;
- a text box's words, which are the play;
- the pressed state of Bold, Italic and Underline, which is wherever the caret was left.

A snapshot that differs is read again for up to three seconds before it fails, as Playwright's own `toMatchAriaSnapshot` waits. A changed surface is accepted by writing its file: `bun run smoke -- --update-aria` for Playwright's, and `node scripts/aria-accept.mjs <run>` from a pipeline run's evidence for WebKit's.

WebKit reads some markup differently from Chromium, and the native tree is where that shows. On 2026-09-25 its first reading found the binder's tree read as unnamed `generic` rows. WebKit keeps a `tree` only while everything between it and its `treeitem`s is a group, a treeitem or `presentation`, and it does not count the ARIA synonym `none`. The binder uses `presentation` now (`src/workspace/BinderView.tsx`).

<a id="A11Y-D1"></a>

### Facts for the site

| Fact | Source | Limit |
|---|---|---|
| Interface text has a 100–200% preference independent of script zoom. | [Interface text requirement](#A11Y-2); `src/app/settings/Appearance.tsx` | Verify usable layout in both schemes. |
| Menus and sheets support keyboard focus, focus return and top-layer Escape. | [Layer requirement](#A11Y-3), [sheet requirement](#A11Y-5); `src/ui/Menu.tsx`, `src/ui/Sheet.tsx` | Keys pressed by the checks, in two browser engines and the real app; not a person's session. |
| PDF export includes document title, language and reading structure. | [Metadata requirement](#A11Y-13); [PDF structure](../formatting/formats-and-layout.md#FMT-61); `src/pdf/` | Title, language and pages are read back from the written file ([REL-121](../../engineering/release-engineering.md#REL-121)); no PDF reader or screen reader is tested. |
| Every surface smoke visits is scanned with axe (WCAG 2.2 AA) and its ARIA snapshot held, in Chromium and WebKit. | [Smoke verification](#A11Y-19); `scripts/smoke-checks.mjs`, `scripts/aria/` | Playwright's reading of the ARIA rules, not a platform tree. |
| In the real app, WebKit's own accessibility tree is held on every surface the checks visit. | [Native verification](#A11Y-16); [native test design](../../engineering/release-engineering.md#REL-D4); `scripts/aria/native/` | The tree VoiceOver reads, not VoiceOver's speech; the current macOS on Apple silicon, and the Intel slice under Rosetta. |

The website's Guide owns writer-facing explanations. Site accessibility wording may draw from these facts and cited records, and claims only what [A11Y-17](#A11Y-17) allows. It says no screen reader was used, and claims no certification.
