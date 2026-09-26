# Interface design system

[Engineering](README.md) › Interface design

Shared tokens and controls define the app chrome. Script geometry belongs to [formats and layout](../app/formatting/formats-and-layout.md).

[Surfaces](#UI-D101) · [Accent](#UI-D102) · [Type](#UI-D104) · [Controls](#UI-D106) · [Menus](#UI-D107)

## Requirements

<a id="UI-D100"></a>

<a id="UI-1"></a>

**UI-1** Apple's structure, Proscenium's palette. Every measurable decision here — control
heights, menu anatomy, sheet semantics, the 13px chrome type — is macOS's;
every colour is the drafting table's.

<a id="UI-2"></a>

**UI-2** **This file is checkable, and it is checked.** `bun run check:design` fails the
build on a chrome `font-size`, `border-radius` or `gap` outside the scales
below, on a `font-size` in relative units, and on a `--token` that is read but
never defined. `bun run smoke` fails it on a WCAG 2.2 AA finding and on a key
that stopped working (docs/app/preferences-and-help/accessibility.md#UI-D108).

<a id="UI-3"></a>

**UI-3** Tokens live as CSS custom properties in `src/app/styles/tokens.css`. The
`src/app/styles.css` entry point imports the shared controls, shell and feature
styles from `src/app/styles/` in an explicit, fixed cascade order. Keep later
overrides (touch controls, focus mode, enlarged text) after the surfaces they
refine; do not move imports as part of an unrelated feature change. The split
preserves the original rule order. `src/editor/stage-format.css` owns the
editor's own chrome. `check:design` scans every app stylesheet and the editor
sheet; the stylesheet import test refuses an omitted or duplicate module.
Script-page geometry lives in `formats/*.json` and never in CSS
(`check:layout`). A material's sheet is that same page, not a card with a
measure of its own: `.material__page` and `.material__body` read the format's
`--fmt-*` size and margins and take the script's zoom, so a note and the script
are the same width on the desk.

<a id="UI-D101"></a>

### Surfaces

| Token | Light | Dark | Role | Requirement |
|---|---|---|---| --- |
| `--paper` | `#FCF8EF` | `#332E28` | cards, menus, popovers, fields, buttons | <a id="UI-4"></a>UI-4 |
| `--chrome` | `#F0E7D2` | `#2E2A25` | toolbar, status bar | <a id="UI-5"></a>UI-5 |
| `--rail` | `#EBE1C9` | `#262320` | binder, inspector | <a id="UI-6"></a>UI-6 |
| `--desk` | `#DCD2C0` | `#191714` | the well the sheets sit on — flat, never textured | <a id="UI-7"></a>UI-7 |
| `--cream` | `#F4ECD8` | `#3A342D` | default card hue, field tint, table header band | <a id="UI-8"></a>UI-8 |
| `--field` | `#FFFDF8` | `rgba(0,0,0,.24)` | text-field fill | <a id="UI-9"></a>UI-9 |
| `--ink` | `#1F2933` | `#EDE7DA` | primary label (chrome only — on paper, ink stays dark) | <a id="UI-10"></a>UI-10 |
| `--ink-2` | `#565C65` | `#B7AEA3` | secondary label — slate | <a id="UI-11"></a>UI-11 |
| `--ash` | `#625A52` | `#A39C92` | tertiary label and icons at rest — pencil; never under 11px | <a id="UI-12"></a>UI-12 |
| `--placeholder` | `#736A5D` | `#A39C92` | a field's hint — text, so 4.5:1 on a field | <a id="UI-13"></a>UI-13 |
| `--faint` | `#8A8F98` | `#8F877E` | disabled controls, absence marks — never text a writer must read | <a id="UI-14"></a>UI-14 |
| `--rule` | ink 12% | white 13% | hairline, drawn at **0.5px** on retina, never 1px | <a id="UI-15"></a>UI-15 |
| `--rule-strong` | ink 20% | white 18% | control borders | <a id="UI-16"></a>UI-16 |

<a id="UI-17"></a>

**UI-17** **`--paper` is dark at night and that is not a mistake.** It is the card
surface — menus, fields, buttons, the board's cards — and `--ink` is light at
night, so a lit `--paper` makes every one of them cream-on-cream. The *page*
stays lit through one re-pin: `.play-page`, `.titlesheet`, `.material__page`,
`.material__body` and `.exportpanel__paper` set `--paper` back to `#FCF8EF`
inside the dark fork. One selector list buys print fidelity everywhere, and it
is the smartest rule in the file.

<a id="UI-18"></a>

**UI-18** There is **one** `prefers-color-scheme` fork. Nothing may write a light hex by
hand and bypass it.

<a id="UI-19"></a>

**UI-19** **Every label clears 4.5:1 on every surface it sits on, in both schemes.** At 4.5:1 on the darkest surface a tertiary grey *is* as
dark as the secondary one, so the two are told apart by hue — warm pencil beside
cool slate — and by size, never by faintness. Faintness is kept for the one thing
WCAG lets be faint: a control that is switched off (`--faint`).

<a id="UI-D102"></a>

### The accent — seven tokens, one preference

<a id="UI-20"></a>

**UI-20** Gilt is the default: `#C9A227`, theatre's own gold. The preference lives in
`settings.json` and is applied as `data-accent` on the document element, so
Settings recolours the whole app in one paint, portals included. The other four
are Velvet, Ink, Iris and Follow Mac.

<a id="UI-21"></a>

**UI-21** **Follow Mac** (id `system`) is the Mac's own accent colour. `accent.rs` reads
it from AppKit and `ui/system-accent.ts` derives the seven tokens, day and
night, to the floors below, since no one can tune by eye a colour the writer
picks in System Settings: words on the fill (ink or cream, whichever reads)
reach 4.5:1, accent text reaches 4.5:1 on every surface it sits on, and at night
the fill lifts to the others' lightness and carries `#1A1613`. Lightness moves
in OKLCH with the hue held. An orange or yellow Mac accent sets
`data-accent-warm`, and warnings go neutral as they do under gilt. The page
asks again whenever the window comes forward, and remembers the answer for the
next launch's first frame. Where there is no Mac to ask (browser dev, smoke),
tokens.css's stand-in is macOS's blue.

| Token | Gilt | Use | Requirement |
|---|---|---| --- |
| `--accent` | `#C9A227` | fills, selection, rings, badges, switches | <a id="UI-22"></a>UI-22 |
| `--accent-deep` | `#AE8B1F` | hover/pressed fill | <a id="UI-23"></a>UI-23 |
| `--accent-soft` | gilt 20% | tint fills: toggle capsules, author capsules, drop zones | <a id="UI-24"></a>UI-24 |
| `--accent-softer` | gilt 10% | row hover and selected tint | <a id="UI-25"></a>UI-25 |
| `--accent-ring` | gilt 50% | the soft halo of the focus ring | <a id="UI-26"></a>UI-26 |
| `--accent-text` | `#735817` | accent **as text**: links, active labels, caret, the focus line | <a id="UI-27"></a>UI-27 |
| `--on-accent` | `#1F2933` | text and glyphs **on** an accent fill | <a id="UI-28"></a>UI-28 |

<a id="UI-29"></a>

**UI-29** Gilt splits into fill and text because gold on cream is 2.3:1. Exactly like
macOS's own Yellow accent, its fills carry ink text (6.1:1) and text carries
bronze — 6.4:1 on paper and 4.5:1 on the desk, because accent text sits on the
toolbar and the rails too. The other four set
`--accent-text = --accent` (Follow Mac's text is derived, darker where it must be)
and `--on-accent` to cream. At night every accent lifts and its fills take
`#1A1613`.

<a id="UI-30"></a>

**UI-30** **Under gilt only,** the warn tint goes neutral, so amber cannot be mistaken for
the accent; the triangle glyph and the words carry the meaning instead. Colour
is never the only carrier anywhere in this system.

<a id="UI-D103"></a>

### Card hues and semantics

<a id="UI-31"></a>

**UI-31** Hues — board, outline, binder dots, the running-time strip. **Never chrome.**
`cream` unmarked · `oxide` setup · `ink` turns · `sea` interior · `moss`
subplot · `amber` revise · `ash` parked. Always paired with a glyph or a word.

<a id="UI-32"></a>

**UI-32** Three semantics: **warn** (format warnings, conflict copies, a change that
arrived from outside, `todo`), **ok** (kept, `+` diff lines), **destructive**
(Move to Trash, Revert, Unlink, `−` diff lines, a failed export).

<a id="UI-33"></a>

**UI-33** **Oxide means destructive in chrome.** It retains its card-hue role.

<a id="UI-D104"></a>

### Type — six sizes

| Token | Size | Weight | Use | Requirement |
|---|---|---|---| --- |
| `--t-title` | 17px | 600, −0.01em | window title, sheet heading | <a id="UI-34"></a>UI-34 |
| `--t-head` | 15px | 600 | surface heading | <a id="UI-35"></a>UI-35 |
| `--t-body` | 13px | 400 (500 selected) | control label, menu item, binder row — the workhorse | <a id="UI-36"></a>UI-36 |
| `--t-small` | 12px | 400 | small controls, tab labels, secondary lines | <a id="UI-37"></a>UI-37 |
| `--t-mini` | 11px | 400 | status bar, chips, shortcuts, help — **the floor** | <a id="UI-38"></a>UI-38 |
| `--t-label` | 10px | 600, 0.09em, caps | section labels only | <a id="UI-39"></a>UI-39 |

<a id="UI-40"></a>

**UI-40** Chrome: `-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui`. Script:
`--font-script` (Courier Prime), sized by the active FormatSpec. There is no `--font-mono` token.

<a id="UI-41"></a>

**UI-41** Diffs, paths, page ranges and cue names are Courier Prime at 11–12px: they are
the script's own units, so they wear the script's face. `--t-inline-script`
(0.9em) is the one relative size in the system, for inline code inside prose —
relative on purpose, because it has to follow what it sits in.

<a id="UI-42"></a>

**UI-42** Title Case for every menu item and button that names an action; sentence case
for descriptive text.

<a id="UI-D105"></a>

### Space, radius, motion, shadow

- <a id="UI-43"></a> **UI-43** **Space:** 2 · 4 · 6 · 8 · 12 · 16 · 24 — hairline gaps · icon-to-label ·
  between controls · row padding · card inset · panel inset · sheet inset.
  `gap` is gated on these; padding is not, because the design itself lands on
  9, 11, 14 and 20px insets and a rule the design does not keep is a rule that
  gets disabled.
- <a id="UI-44"></a> **UI-44** **Radius:** 2 paper · 4 chip/mini · 6 control/card/row · 8 menu/popover ·
  10 sheet/window. Small controls step down one (6→5, 4→3.5). A pill is
  `--r-pill` (999px), not a radius step: rounding the ends is a different idea
  from a corner.
- <a id="UI-45"></a> **UI-45** **Motion:** hover/press/tint `120ms ease-out`; the sheet drop `200ms
  ease-out`. Menus, popovers, autocomplete, rail collapse, split resize and
  zoom have **none** — nothing a writer touches mid-sentence animates. The
  sheet drop stays because macOS users read it as "this is modal".
- <a id="UI-46"></a> **UI-46** **Shadows:** sheet `0 1px 2px/.08` · card `0 1px 3px/.08` · control
  `0 .5px 1px/.08` · primary button `0 .5px 1px/.18` · menu `0 0 0 .5px/.05,
  0 12px 34px/.22` · toast `…0 14px 38px/.20` · sheet/alert `0 0 0 .5px/.14,
  0 18px 60px/.30` · window `0 1px 2px/.10, 0 30px 70px/.24`.
  **Rails are separated by hairlines, never by shadow.**
- <a id="UI-47"></a> **UI-47** **Elevation:** L0 desk (flat) · L1 sheet · L2 card · L3 rail · L4
  toolbar/status bar (opaque) · L5 menu/popover/sheet — the only vibrancy.

<a id="UI-D106"></a>

### Controls

<a id="UI-48"></a>

**UI-48** Regular **28px**, small **22px**, mini **20px**. The `@media (pointer: coarse)`
pass lifts everything to 44pt — gated on the pointer, not on the platform,
which is what makes the iPad fork a values change rather than a layout change.

<a id="UI-49"></a>

**UI-49** One `.btn` with four treatments (`--primary`, default, `--borderless`,
`--destructive`) and one `.iconbtn`. A disabled control goes grey and stays
put: a control you cannot find teaches nothing.

<a id="UI-50"></a>

**UI-50** `ui/controls.tsx` also owns the segmented control, switch, checkbox, radio,
field, chip, capsule, badge, meter, and the **popup button** used for every select control in the app. A native select cannot show a Courier Prime cue
name, cannot carry the access menu's "script gated" hint, and looks like a web
form on cream.

<a id="UI-51"></a>

**UI-51** **Focus** is `--focus-ring` on `:focus-visible` only: a 1.5px line in
`--accent-text` inside a 4px `--accent-ring` halo. The line supplies the required 3:1 contrast; the halo supplies the surrounding appearance.

<a id="UI-D107"></a>

### Menus — one anatomy

<a id="UI-52"></a>

**UI-52** `ui/Menu.tsx` is the only floating chrome: vibrant paper, 0.5px hairline,
radius 8, 5px padding, the menu shadow, no open or close animation. A 24px row
on a `16px 1fr auto` grid — check column, label, shortcut or submenu chevron.
Labels never wrap; a menu gets wider instead. Highlight is the accent fill with
`--on-accent` text. Arrow only when the popover belongs to a control.

<a id="UI-53"></a>

**UI-53** The two caret
popups (cue autocomplete, the leader menu) are drawn by ProseMirror plugins
rather than React, so they share the chrome by sharing its values rather than
the component — and say what they offer through the announcer, because focus
never leaves the page while they are up.

<a id="UI-54"></a>

**UI-54** **The highlight is DOM focus.** Arrows, Home, End and
type-select move focus; Tab and Escape close and hand focus back to whatever
opened the menu; a menu holding a text field (Go to Scene) keeps focus in the
field and names the lit row with `aria-activedescendant`.

<a id="UI-D110"></a>

### Appearance preference

<a id="UI-55"></a>

**UI-55** Appearance defaults to Follow Mac, with Light and Dark overrides in Settings.
`data-appearance` records the preference; `data-theme` records the resolved
scheme. Both accent and scheme apply at the document root, including portals.
Scheme-scoped component rules use a zero-specificity `:where()` prefix so
selected and active states retain their text contrast. Script paper keeps its
print colours. Formatting buttons use locally rendered macOS SF Symbols with
vector fallbacks on other platforms.

<a id="EDIT-D105"></a>

### Card colors and theming

<a id="UI-56"></a>

**UI-56** `card.color` ([docs/app/keeping-work/storage-and-file-format.md#STOR-D6](../app/keeping-work/storage-and-file-format.md#STOR-D5)) is a **named palette token**, never a raw hex in the data — so the theme controls the actual color, and high-contrast / e-ink modes can remap it. The drafting-table palette:

| Token | Light value | Typical use | Requirement |
|-------|-------------|-------------| --- |
| `cream` | `#F4ECD8` | default / unmarked | <a id="UI-57"></a>UI-57 |
| `oxide` | `#9C4A2F` | setup / exposition | <a id="UI-58"></a>UI-58 |
| `ink` | `#1F2933` | turns, reversals | <a id="UI-59"></a>UI-59 |
| `sea` | `#3A6B7E` | quiet / interior beats | <a id="UI-60"></a>UI-60 |
| `moss` | `#5A6B3B` | subplot threads | <a id="UI-61"></a>UI-61 |
| `amber` | `#C08A2E` | flagged for revision | <a id="UI-62"></a>UI-62 |
| `ash` | `#8A8F98` | parked / maybe-cut | <a id="UI-63"></a>UI-63 |

<a id="UI-64"></a>

**UI-64** Color is **never the only carrier of meaning**: a card's `status` and `label` are shown as text/shape chips too, so the board stays legible in monochrome high-contrast mode and for color-blind users ([cross-platform e-ink rules](cross-platform.md#PLAT-D110)). In e-ink mode the tokens map to high-contrast fills/patterns rather than hues.

## Design

Chrome values live in `src/app/styles/tokens.css`. Feature styles consume those values in a fixed cascade through `src/app/styles.css`. Shared controls, Menu, Sheet, layers and announcements supply the reusable interaction primitives. Script geometry comes only from the format specification.

`check:design` enforces type, radius, gap and token definitions. Accessibility requirements are maintained in [accessibility.md](../app/preferences-and-help/accessibility.md); browser smoke exercises their actual rendered boxes and keyboard behavior.
