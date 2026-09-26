# Settings

[Preferences and help](README.md) › Settings

Settings has one persisted model and a sectioned sheet. This contract covers preference behavior, keyboard access, wording and preserving existing choices.

[Sections and behavior](#SET-D102) · [Acceptance](#SET-D103) · [Wording](#SET-D108)

## Requirements

<a id="SET-D100"></a>

<a id="SET-1"></a>

**SET-1** Settings follows the shared design and accessibility contracts.

<a id="SET-D101"></a>

### Settings model and sections

<a id="SET-D102"></a>

#### Behavior

1. <a id="SET-2"></a> **SET-2** **One typed settings model.**
   - <a id="SET-3"></a> **SET-3** Rust side: `get_settings` returns every preference with its default;
     `update_settings` takes a partial patch, validates it and writes atomically.
     The existing `settings.json` keys are read unchanged, so no one loses a
     preference.
   - <a id="SET-4"></a> **SET-4** Frontend side: a typed `useSettings()` hook replaces the per-key calls.
   - <a id="SET-5"></a> **SET-5** Keep `lastVault` and its bookmark exactly as they are; docs/app/keeping-work/storage-and-file-format.md#STOR-D12 owns
     them.
2. <a id="SET-6"></a> **SET-6** **A sectioned Settings sheet.** A section list on the left: a vertical
   `tablist`, arrows between sections, one Tab stop. Each section is a file in
   `src/app/settings/`:
   - <a id="SET-7"></a> **SET-7** **General** — the Plays folder (where it is, which provider, Change…,
     Reveal in Finder), what opens at launch (the last play, or the Plays
     screen), and the Plays screen: Show Progress, and the list of statuses a
     play can have, added, renamed, deleted and reordered there.
   - <a id="SET-8"></a> **SET-8** **Appearance** — accent and interface text size (100–200%). Text size
     changes the shared interface tokens; page zoom stays independent.
     Appearance offers Follow Mac (default), Light and Dark.
   - <a id="SET-9"></a> **SET-9** **Writing** — the scene navigation strip (formerly Page map);
     spell check on or off (the same
     setting the document menu toggles); dictionary words with Add Word and Forget; editable scene status labels.
   - <a id="SET-10"></a> **SET-10** **Formats** — an empty slot with a working "Open Formats Folder". Part B
     fills it.
   - <a id="SET-11"></a> **SET-11** **Keyboard Shortcuts** — the shared shortcut reference.
   - <a id="SET-12"></a> **SET-12** **Help & Feedback** — short tutorial topics and a reviewed feedback/report action.
   - <a id="SET-13"></a> **SET-13** **Privacy** — the analytics switch and one concise explanation.
   - <a id="SET-14"></a> **SET-14** **Updates** — empty slot; T1 fills it.
   - **SET-31 — Withdrawn 2026-09-25.** Replaced by [SET-37](#SET-37),
     [SET-38](#SET-38) and [SET-39](#SET-39) when the maintainer made alpha his own track. The original
     wording is kept in [withdrawn requirements](../../engineering/withdrawn-requirements.md#SET-31).
   - <a id="SET-37"></a> **SET-37** **Updates › Update track** — Stable (the default) or Beta, each
     with one plain sentence saying what arrives on it. Alpha is offered only to a copy
     that holds alpha's key or is on alpha already. A note says, only while it is
     true, that moving to a slower track waits for that track to pass the version
     already installed, because Proscenium never installs an older one. The setting is
     `updateTrack` in `settings.json`. Stable brings tagged releases, Beta tagged
     pre-releases, and Alpha every change to the main line that passes its checks.
   - <a id="SET-38"></a> **SET-38** **Have a key?** — a small button under the track, while the copy
     holds no key, opens a field and Add Key. A key of the wrong shape is refused in
     words beside the field. An accepted one closes the field, adds Alpha to the
     menu, says so through `src/ui/announce.ts`, and moves focus to the menu. The
     key is `updateTrackKey` in `settings.json`: written by that patch or by
     `scripts/track-key.mjs`, sent only with alpha's checks and downloads, and never
     read back to the page, which learns only `hasUpdateTrackKey`.
   - <a id="SET-39"></a> **SET-39** **Alpha without a key** says, in place of alpha's sentence, that
     alpha needs a key this copy doesn't have and so it isn't checking, beside a Use
     Stable button, which moves focus to the menu. Such a copy asks nothing: the
     update service answers alpha only to its key.
   - <a id="SET-15"></a> **SET-15** **About** — version and architecture; "Free software under the GNU AGPL"
     linking to the license; acknowledgements (Courier Prime OFL, the SCOWL
     dictionary, Tauri, React, ProseMirror and TipTap, pdf-lib). Copy Diagnostics and Report a Problem are slots for T4.
     - <a id="SET-32"></a> **SET-32** **The Program** (the maintainer, 2026-09-25). Below the acknowledgements, Proscenium's
       GitHub sponsors by level, as a theatre program prints its donors: Benefactors ($25 a month or
       more), Patrons ($10 or more), Friends of the House (below that). A level with no one in it is
       left out. Sponsors who chose to sponsor privately are counted in one line ("And 2 more who
       prefer to remain in the wings.") and never named. With no sponsors at all, the section says
       the house is dark and the first name has yet to be written. A note says what the list is and
       links to the site's support page through `go.proscenium.ink/support`.
       - <a id="SET-34"></a> **SET-34** **Baked in, never fetched.** A release fetches the roll once, before
         building (`scripts/patrons.mjs`), from the services Worker
         (docs/engineering/services-and-feedback.md#SERV-D105), and bakes it into the page. The app
         asks no one for it, so a new name arrives with the next update. Every build that is not a
         release, and a release that cannot reach the roll, carries the empty roll; the release
         says so and is not held back.
       - <a id="SET-35"></a> **SET-35** **Release notes.** An edition published while it has Benefactors ends its
         notes with "This edition was underwritten by …", naming them.
       - <a id="SET-36"></a> **SET-36** **Recognition only.** Sponsoring unlocks nothing in the app, and no
         feature is ever held back for sponsors; Proscenium is free and stays free.
3. <a id="SET-16"></a> **SET-16** **Deep links.** `openSettings(section)`, so the Welcome notice can open Privacy
   and the document menu can open Formats.
4. <a id="SET-17"></a> **SET-17** **Plain words.** Every setting is a sentence a playwright understands, and
   every switch says what happens when it is off. The Words in Settings contract below also requires on-state wording and names off only when off costs something its label does not show.

<a id="SET-D103"></a>

#### Acceptance

- <a id="SET-18"></a> **SET-18** Every existing preference survives the upgrade.
- <a id="SET-19"></a> **SET-19** Each section is keyboard-operable and passes smoke's audit in both schemes.
- <a id="SET-20"></a> **SET-20** The sections T1, T3b and T4 fill exist as named, documented slots.
- <a id="SET-21"></a> **SET-21** The document menu's spell-check toggle and Settings stay in step.

<a id="SET-D108"></a>

### Words in Settings

<a id="SET-22"></a>

**SET-22** Headings, labels, notes, placeholders, empty states, tooltips and messages in Settings and the format designer follow these rules:

- <a id="SET-23"></a> **SET-23** **Short, factual labels.** Sentence case for setting labels and notes, Title
  Case for a button or menu item that names an action (docs/engineering/design-system.md#UI-D104), and a
  concrete verb on every button: Add Word, Import Format…, Report a Problem….
- <a id="SET-24"></a> **SET-24** **A note only where the label is not enough.** It says what the setting does
  when it is on. Off is named only when it costs something the label does not
  show: turning reports off discards the unsent ones.
- <a id="SET-25"></a> **SET-25** **Scope when it changes the choice:** this play, new plays, every script on
  this Mac, or this Mac.
- <a id="SET-26"></a> **SET-26** **Nothing else in a note.** No marketing, theatre metaphors, praise,
  implementation talk, clever asides, filler, em dashes, or remarks about other
  apps. A note does not repeat its heading, and does not explain how to operate
  the control beside it.
- <a id="SET-27"></a> **SET-27** **Warnings name the real cost, unsoftened:** unsaved writing, a replaced
  file, what reports carry, and where a problem report goes and what it needs.
- <a id="SET-28"></a> **SET-28** **One action, one name.** A setting, its menu item, its shortcut description
  and its accessible name use the same words (Check spelling as you type;
  Check Spelling as You Type). An accessible name starts with its visible
  label.
- <a id="SET-29"></a> **SET-29** **Two dictionaries, never blurred.** The Proscenium dictionary serves
  scripts. Documents and character sheets use the macOS dictionary, which the
  spelling switch does not affect.
- <a id="SET-30"></a> **SET-30** **US spelling** (color, center), as macOS writes it.
- <a id="SET-33"></a> **SET-33** **One exception to SET-26: The Program** (the maintainer, 2026-09-25). Its level
  names, its private-sponsors line and its empty state speak in the voice of a theatre program,
  wry where there is no one to thank yet. Its note and link follow the rules above.

## Design

`src-tauri/src/settings.rs` owns the typed persisted model and atomic patch updates. The frontend settings store and `useSettings()` expose the same model to the document menu and sectioned sheet. Folder authority remains owned by storage.

Each section lives in `src/app/settings/`. The shared Sheet and tabs supply keyboard ownership, focus and appearance. Format editing is governed by the formats and layout contract; privacy and update preferences use their domain contracts.
