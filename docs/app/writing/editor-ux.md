# Script editor

[Writing](README.md) › Script editor

This contract covers entering and editing script text: element types, predictable keys, spelling and undo. The [Fountain data model](../../engineering/fountain-model.md) defines the stored representation.

[Elements](#EDIT-D101) · [Entry and correction](#EDIT-D107) · [Spelling](#EDIT-D116) · [Undo](#EDIT-D118)

## Requirements

<a id="EDIT-D100"></a>

<a id="EDIT-1"></a>

**EDIT-1** The writing feel is the product. The two requirements: **real-time stage formatting** (the page formats itself as you type — not a separate preview pane) and **near-zero-friction element entry** (the app predicts the next element; you correct with one keystroke, hands on the home row). The [node schema and Fountain mapping](../../engineering/fountain-model.md) specify the stored representation; the format contract is in [Formats and layout](../formatting/formats-and-layout.md).

<a id="EDIT-D101"></a>

### Element types

<a id="EDIT-2"></a>

**EDIT-2** The structured document is made of these block elements. (Marks — bold/italic/underline/note — are in the data-model doc.)

| Element | Role | House treatment | Requirement |
|---------|------|------------------------------| --- |
| **Act** | Structural division | Centered, ALL CAPS, bold. "ACT ONE". | <a id="EDIT-3"></a>EDIT-3 |
| **Scene** | Structural division — the card unit | Centered, bold. "SCENE 1" or a scene title. | <a id="EDIT-4"></a>EDIT-4 |
| **Scene Heading** | Optional setting/locale line at a scene's top | Inset, italic. "A kitchen. Night." Often unused in pure stage plays (setting goes in an opening stage direction). | <a id="EDIT-5"></a>EDIT-5 |
| **Action / Stage Direction** | Description of the stage, business, blocking | Upright, indented from both margins, parenthesized. | <a id="EDIT-6"></a>EDIT-6 |
| **Character** | The speaker cue | Fixed left edge, bold ALL CAPS. "MARA". | <a id="EDIT-7"></a>EDIT-7 |
| **Parenthetical** | Wryly under a cue | Parenthesized, indented under the cue. "(quietly)". | <a id="EDIT-8"></a>EDIT-8 |
| **Dialogue** | Spoken text | Full width, left margin to right margin. | <a id="EDIT-9"></a>EDIT-9 |
| **Transition** | Act/scene transition | Right-aligned, ALL CAPS. "BLACKOUT." / "END OF ACT ONE". | <a id="EDIT-10"></a>EDIT-10 |

<a id="EDIT-11"></a>

**EDIT-11** Plus front-matter fields (Title, Author, Draft date, Contact, CHARACTERS, SETTING, TIME, AT RISE), edited in a structured panel rather than as inline nodes — see [Front matter](../formatting/formats-and-layout.md#EDIT-D103).

<a id="EDIT-12"></a>

**EDIT-12** "Action" and "Stage Direction" are the **same** element (stage plays use one concept); the names are interchangeable in the UI.

<a id="EDIT-13"></a>

**EDIT-13** This table is the primary, hand-used set. The complete node list — adding Lyric, Centered, Synopsis, Note, Page Break, and Boneyard — is in [Fountain data model](../../engineering/fountain-model.md#FOUN-D102); those are entered by auto-detection or direct jump, not picked from a menu.

<a id="EDIT-D106"></a>

### Real-time rendering (WYSIWYG, single surface)

<a id="EDIT-14"></a>

**EDIT-14** There is no separate preview pane and no parse-on-keystroke. The editor edits the **structured document directly**; each element is a ProseMirror node whose TipTap nodeView/CSS applies the stage format above. What you see *is* the formatted page. Fountain is only the on-disk serialization (written on autosave), never the thing you edit.

- <a id="EDIT-15"></a> **EDIT-15** **Horizontal format is always live** (required): centered cues, full-width dialogue, italic indented stage directions, centered headings, caps. This is the "stage formatting as you type" requirement.
- <a id="EDIT-16"></a> **EDIT-16** **Page styling** uses a Courier face on a page-width frame at the correct margins, so line breaks and the look match print closely.
- <a id="EDIT-17"></a> **EDIT-17** **Vertical pagination** is a **toggle (default ON).** The "Pages" toggle in the titlebar switches between the paginated page view (the layout engine's real page breaks, headers, page numbers, and CONT'D cues drawn live as decorations — the document is never mutated) and the continuous galley. The choice persists as app chrome (localStorage), not in the project. The same engine output drives PDF export, so the editor and the PDF can never disagree on page counts.
- <a id="EDIT-18"></a> **EDIT-18** **Element hints**: a subtle gutter label (decoration) shows the current element type; optional and unobtrusive (and e-ink-friendly — see [cross-platform](../../engineering/cross-platform.md)).

<a id="EDIT-D107"></a>

### Smart element entry

<a id="EDIT-19"></a>

**EDIT-19** The writer almost never picks an element from a menu. Three mechanisms cooperate: **predictive Enter**, **auto-detection**, and **one-keystroke correction**.

<a id="EDIT-D108"></a>

#### Predictive Enter (advance to the most likely next element)

<a id="EDIT-20"></a>

**EDIT-20** Pressing Enter on a **non-empty** element creates the next element the writer most likely wants:

| Current element | Enter creates | Requirement |
|-----------------|---------------| --- |
| Act | Scene | <a id="EDIT-21"></a>EDIT-21 |
| Scene | Action | <a id="EDIT-22"></a>EDIT-22 |
| Scene Heading (locale) | Action | <a id="EDIT-23"></a>EDIT-23 |
| Action / Stage Direction | Action | <a id="EDIT-24"></a>EDIT-24 |
| Character | Dialogue | <a id="EDIT-25"></a>EDIT-25 |
| Parenthetical | Dialogue | <a id="EDIT-26"></a>EDIT-26 |
| Dialogue | Action | <a id="EDIT-27"></a>EDIT-27 |
| Transition | Scene | <a id="EDIT-28"></a>EDIT-28 |

<a id="EDIT-29"></a>

**EDIT-29** Pressing Enter on an **empty** element (the second Enter of a pair) opens the element menu at the caret . The menu opens on that likely type, so a third Enter still takes it; a mnemonic letter takes any other:

| Current empty element | menu opens on | Requirement |
|-----------------------|---------------| --- |
| Action (empty) | Character | <a id="EDIT-30"></a>EDIT-30 |
| Dialogue (empty) | Action | <a id="EDIT-31"></a>EDIT-31 |
| Character (empty) | Action | <a id="EDIT-32"></a>EDIT-32 |
| Parenthetical (empty) | Dialogue | <a id="EDIT-33"></a>EDIT-33 |
| Lyric (empty) | Action | <a id="EDIT-34"></a>EDIT-34 |

<a id="EDIT-35"></a>

**EDIT-35** A line that holds only a Shift+Enter break is not empty: Enter advances from it as from any written line.

<a id="EDIT-36"></a>

**EDIT-36** So the core drafting loop is pure typing: type a cue → Enter → type the line → Enter → you're in Action; type an uppercase name (auto-detected as a Character) → Enter → dialogue. The writer rarely reaches for a command.

<a id="EDIT-D109"></a>

#### Breaks inside a block (spacing a speech out)

<a id="EDIT-37"></a>

**EDIT-37** A speech is often more than one paragraph, and a playwright wants real air
between them — not a tight wrap. **Enter keeps its habit everywhere** (advance
to the next element); the break is always Shift+Enter:

<a id="EDIT-38"></a>

**EDIT-38** **Shift+Enter is one line break, and it never changes what you are writing.**
The next line sits directly under this one, single-spaced, in the same block.
Enter is the predictive key — it advances to the next likely element, and can
promote an ALL-CAPS Action to a cue or a `… TO:` line to a Transition.

<a id="EDIT-39"></a>

**EDIT-39** The same in **Dialogue, Action and Lyric**: a speech, a stage direction and a
verse each hold many lines as ONE element.

<a id="EDIT-40"></a>

**EDIT-40** Air between two beats is **Enter's** job, not this key's — a new block, which
the format spaces by one line. Keeping the two gestures distinct is the point:
one moves to the next line, the other to the next thought.

Supporting mechanics:

- <a id="EDIT-42"></a> **EDIT-42** **In the editor a break is a `lineBreak` node**, not a `"\n"` in the text.
  A node preserves the break at the end of a block across contenteditable normalization.
  `src/editor/bridge.ts` converts nodes ⇄ newlines at the editor boundary; the
  model, engine, and PDF still see literal newlines.
- <a id="EDIT-43"></a> **EDIT-43** **A blank line inside a speech serializes as Fountain's two-space line.** A
  bare empty line would end the dialogue block on the next parse and demote the
  rest of the speech to action (round-trip rule 1).

<a id="EDIT-D110"></a>

#### Typographic ellipsis

<a id="EDIT-44"></a>

**EDIT-44** `…` is normalized back to three dots wherever text enters a script — typing
(input rule) and pasting (`transformPastedText`/`HTML`). A script is typed on a
monospace grid: an ellipsis occupies three cells, and the single glyph would
take one.

<a id="EDIT-45"></a>

**EDIT-45** Normalization is also a **floor on the document** — `EllipsisFloor`, an
`appendTransaction` in input-rules.ts. Whatever put a `…` in the document, it is
three dots again in the same dispatch: OS substitution, a drop, an IME, a
restored version. Marks are carried over, so a glyph inside emphasis stays
emphasized, and a boneyard is skipped (verbatim omitted content is not text the
format governs). It terminates because the appended transaction is itself
re-examined and finds nothing.

<a id="EDIT-46"></a>

**EDIT-46** macOS's substitution should be turned off
at the source for a script window — smart **quotes** and **dashes** corrupt a
`.fountain` exactly as much as the ellipsis does, and the floor does not cover
those (they are legitimate characters elsewhere).

<a id="EDIT-D111"></a>

#### Auto-detection (input rules)

<a id="EDIT-47"></a>

**EDIT-47** As you type, the editor recognizes Fountain-style cues and sets the element automatically:

- <a id="EDIT-48"></a> **EDIT-48** Line begins `INT`/`EXT`/`EST`/`I/E` (+ space or `.`) → **Scene Heading**. A leading `.` (then a non-space) forces **Scene Heading** for stage locale lines.
- <a id="EDIT-49"></a> **EDIT-49** An ALL-CAPS line (no lowercase) in an Action context, confirmed by Enter → **Character**.
- <a id="EDIT-50"></a> **EDIT-50** `(` at the start of a line after a Character or within Dialogue → **Parenthetical** (auto-inserts the closing `)`).
- <a id="EDIT-51"></a> **EDIT-51** Uppercase line ending in `TO:`, or a leading `>` → **Transition**. `>text<` → centered text.
- <a id="EDIT-52"></a> **EDIT-52** Leading `#` / `##` → **Act** / **Scene** (structural).
- <a id="EDIT-53"></a> **EDIT-53** `@Name` → forced **Character** (preserves mixed case). `!` → forced **Action**. `~` → **Lyric**. Leading `=` → **Synopsis** (the card description). `[[ … ]]` → **Note**.
- <a id="EDIT-54"></a> **EDIT-54** **Auto-caps**: Character cues, Act/Scene/Transition headings auto-uppercase as you type (toggleable).

<a id="EDIT-D112"></a>

#### Character autocomplete

<a id="EDIT-55"></a>

**EDIT-55** In a Character element, typing offers names drawn from the cast (from `characters/*.md` sheets and previously used cues). Enter or Tab accepts the highlighted name. Keeps speaker entry to a few keystrokes and cue spelling consistent.

<a id="EDIT-56"></a>

**EDIT-56** **Empty-cue suggestions (Enter-Enter):** landing in an *empty* Character element opens the list immediately, ranked by dialogue alternation, with the predicted next speaker **pre-selected — a second Enter accepts it**. ↑/↓ or typing picks a different name; Tab deliberately does *not* accept here (it opens the element menu, keeping a different element one keystroke away). **Esc then Enter** opens the element menu on Action.

<a id="EDIT-57"></a>

**EDIT-57** **Caret popup accessibility:** Character suggestions name their listbox and active option from the focused script. Both caret popups accept click-only activation. The semicolon menu moves real focus between its rows with Up/Down and Home/End; Enter or Space chooses, Escape cancels, and the mnemonic letters still choose directly. Its keyboard layer uses the shared menu contract and returns focus to the script.

<a id="EDIT-58"></a>

**EDIT-58** **Leader menu:** `;` on an empty line now draws a caret-anchored menu of every element with its mnemonic key (the visible UI for the leader contract below); Esc cancels without typing the `;`. **Tab on an empty line opens the same menu** (Tab on a non-empty line still cycles the ring). **So does Enter on an empty line**, on the predicted next element rather than the first row. While the menu is open, **Shift+Enter and ⌘Enter keep their meaning**: the menu closes and the line break or page break goes in, never a choice of the focused row. An empty Parenthetical keeps its caret between its parens in every alignment.

<a id="EDIT-59"></a>

**EDIT-59** **Soft line breaks:** **Shift+Enter** inserts a single line break inside Action, Dialogue and Lyric — the next line single-spaced under this one, same block; plain Enter keeps meaning "next element". The break is a `lineBreak` node that bridge.ts maps to a literal newline — galley (pre-wrap), engine (`splitParagraphs`), serializer and PDF all carry it natively. A sigil belongs to a line, not a block: `@` or `!` typed right after a soft break splits the block there and forces a Character or an Action on that line; any lines below it stay in the element they were in (`sigilAfterBreak`, breaks.ts). The other sigils still anchor to the block start.

<a id="EDIT-60"></a>

**EDIT-60** **Forced page breaks:** **⌘/Ctrl+Enter**, a `⤓ Page Break` button in the element bar, and `-` in the leader menu all insert the schema's `pageBreak` node — the same node Fountain's `===` parses to and the engine has always honored (`startsNewPage`). On an *empty* block the break replaces that block (the gesture a writer makes: caret on the blank line between two scenes); on a block with words in it the break lands *after* the whole block rather than splitting it mid-sentence. An Action always follows, so the caret has somewhere to be and the document never ends on an atom.

<a id="EDIT-61"></a>

**EDIT-61** A forced page break prints nothing and contributes no layout space. It carries a `PAGE BREAK ✕` handle (`page-break.ts`), the same kind of chrome comments use: a widget decoration, absolutely positioned with auto offsets, so it draws at its static position and contributes zero width and zero height — the node stays collapsed and DOM geometry still matches the engine. Click the label to select the node (the collapsed node had nothing for the default selection outline to draw on), ✕ to delete it; Backspace at the head of the block below still works, as it always did. The handle is the presentation in both views.

<a id="EDIT-62"></a>

**EDIT-62** **Emphasis:** **⌘B / ⌘I / ⌘U** toggle `strong` / `em` / `underline`, which round-trip through Fountain's `**bold**` / `*italic*` / `_underline_`. They are allowed only in Action, Dialogue, Parenthetical, Lyric and Centered. A cue is a *name*, and a heading's weight comes from the format spec's `fontStyle`, which stays the single source of truth for element-level styling — so the fence covers the keys and the element bar's B/I/U buttons together, and the buttons *disable* there rather than silently no-op.

**EDIT-63 — Withdrawn 2026-09-25.** Replaced by [EDIT-170](#EDIT-170) and [EDIT-171](#EDIT-171): the chevron and the palette it expanded were deleted because Tab, `;` and each element's ⌘⌥ chord already reach every element, and the bar now has to fit a pane narrower than its row. The original wording is kept in [withdrawn requirements](../../engineering/withdrawn-requirements.md#EDIT-63).

<a id="EDIT-170"></a>

**EDIT-170** **The element bar is one quiet row** over the page: a popup naming the element you are in (every element, with its key), B/I/U, Line Break and Page Break, `+ Comment` and `Comments (N)`, and "Page N of M". There is no palette to expand. Every element type is also on Tab, on `;`, and on its ⌘⌥ chord. Holding ⌘ shows each button's shortcut, and so does hovering over one.

<a id="EDIT-171"></a>

**EDIT-171** **The element bar fits its pane.** It is as wide as the sheet (at least the sheet at 100%, so zooming out does not shrink it) and never wider than the pane can show, and nothing in it widens the desk the sheet lies on. When the page is wider than the pane, the bar stays in view as the page scrolls sideways. Where the row does not fit, it stays one row and gives way in this order: the "Tab cycles · ; menu" hint goes; the breaks and comment buttons keep only their icons, still named for a screen reader; then Comments, the breaks and B/I/U, in that order, fold into a **More** menu (⏎ or ↓ opens it, with each action's shortcut). The element popup and "Page N of M" never leave the row; in the narrowest pane the element's name is shortened instead. Shortcut keys float under their buttons, so showing them takes no room and moves nothing.

<a id="EDIT-D113"></a>

#### One-keystroke correction

When the prediction is wrong:

- <a id="EDIT-65"></a> **EDIT-65** **Tab / Shift-Tab** cycles the current paragraph forward/back through the element ring:
  `Action → Character → Dialogue → Parenthetical → Scene Heading → Transition → Action…`
  Because the ring is ordered by likelihood-adjacency, the right element is usually **one Tab away** — this is the primary one-keystroke fix, hands on the home row. The ring deliberately holds only the frequent body elements; structural **Act**/**Scene** and the extended elements (Lyric, Synopsis, Note, Centered) are reached by direct jump, not by Tab.
- <a id="EDIT-66"></a> **EDIT-66** **Direct jump** sets the current line's element by mnemonic letter. Two equivalent bindings (configurable: the trigger is tuned by feel, while the letters stay fixed):
  - <a id="EDIT-67"></a> **EDIT-67** a **leader key** then the letter (leader keeps hands on the home row), and
  - <a id="EDIT-68"></a> **EDIT-68** **⌘/Ctrl + letter** as an always-available chord.

<a id="EDIT-D114"></a>

##### Element mnemonic keymap

| Element | Letter | ⌘/Ctrl chord | Requirement |
|---------|--------|--------------| --- |
| Scene Heading | `s` | ⌘S is reserved for save → use ⌘⌥S, or leader `s` | <a id="EDIT-69"></a>EDIT-69 |
| Action / Stage Direction | `a` | ⌘⌥A | <a id="EDIT-70"></a>EDIT-70 |
| Character | `c` | ⌘⌥C | <a id="EDIT-71"></a>EDIT-71 |
| Dialogue | `d` | ⌘⌥D | <a id="EDIT-72"></a>EDIT-72 |
| Parenthetical | `p` | ⌘⌥P | <a id="EDIT-73"></a>EDIT-73 |
| Transition | `t` | ⌘⌥T | <a id="EDIT-74"></a>EDIT-74 |
| Act (structural) | `1` | ⌘⌥1 | <a id="EDIT-75"></a>EDIT-75 |
| Scene (structural) | `2` | ⌘⌥2 | <a id="EDIT-76"></a>EDIT-76 |

<a id="EDIT-77"></a>

**EDIT-77** Extended (less frequent): Lyric `l`, Synopsis `=`, Comment `n` (a Fountain note, called a comment wherever the writer sees it: [Comments](comments.md#COMM-5)), Centered `>`.

> Recommended trigger (Q3): Tab/Shift-Tab to cycle, and a single leader key (default `;` when a line is empty or under a held leader modifier) followed by a mnemonic letter for a direct jump, with the ⌘⌥ chords as discoverable equivalents in menus. The mnemonic letters above are the contract regardless of which trigger ships.

<a id="EDIT-D115"></a>

#### Worked example

<a id="EDIT-78"></a>

**EDIT-78** Typing this, with only Enters and auto-detection (no manual element picks):

```
ACT ONE              ⌘⌥1 (or type "# ACT ONE")     → Act
SCENE 1              Enter → Scene
                    Enter → Action
AT RISE: A kitchen, before dawn. MARA stands at the sink.   (type; italic stage direction)
                    Enter → Action; type "MARA" → auto-detected Character on Enter
MARA                Enter → Dialogue
The pipe's been crying all night.
                    Enter → Action ("She turns off the tap.")
She turns off the tap.
                    type "JONAH" → Character; Enter → Dialogue
JONAH
(half asleep)        type "(" → Parenthetical; Enter → Dialogue
You and that pipe.
```

<a id="EDIT-79"></a>

**EDIT-79** The writer touched a non-letter command exactly once (to start the Act). Everything else was typing and Enter.

<a id="EDIT-D116"></a>

### Spell check

<a id="EDIT-80"></a>

**EDIT-80** Misspellings get a wavy underline; right-click one for corrections, **Add to Dictionary**, or **Ignore in this session**. Format ▸ **Check spelling** turns the whole layer off. Typos only — no grammar, no style, no rewriting a writer's sentences.

<a id="EDIT-81"></a>

**EDIT-81** The editable root sets `spellcheck="false"`; `src/spell` checks against the bundled hunspell English dictionaries under `dictionaries/`.

Spelling rules:

- <a id="EDIT-83"></a> **EDIT-83** **Cues, headings, transitions and act/scene lines are not checked at all** (`NO_SPELLCHECK` in schema.ts — the same set that opts those blocks out of the native check). A character name is a name.
- <a id="EDIT-84"></a> **EDIT-84** **ALL-CAPS words are skipped** wherever they appear. `A door SLAMS` and a name being introduced are conventions, not spellings.
- <a id="EDIT-85"></a> **EDIT-85** **Capitalized words are skipped** wherever they appear. A word that starts with a capital is almost always a name — a character, a town, `Craigslist` — and the app does not know the writer's world better than the writer. The accepted price: a typo in the first word of a sentence (`Teh door opens`) goes unmarked.
- <a id="EDIT-86"></a> **EDIT-86** **The cast is a dictionary.** The names the binder knows, and the words the writer teaches it, are fed straight in, so a name typed in lower case still passes.
- <a id="EDIT-87"></a> **EDIT-87** **A dropped g is not a typo.** `talkin'` is checked as `talkin`, then as `talking`; the whole dialect class passes with no word list behind it. Possessives are checked as their stem, and a suggestion comes back wearing the `'s` again, so accepting one fixes the name rather than eating the apostrophe.
- <a id="EDIT-88"></a> **EDIT-88** **Hyphens split.** `half-remembered` is two words the dictionary knows rather than one compound it doesn't.
- <a id="EDIT-89"></a> **EDIT-89** **Stage vocabulary ships with the app** (`src/spell/stage-words.ts`) — `theatre` first among them, since the dictionary is American and a play that says "theatre" is not making a mistake.

<a id="EDIT-90"></a>

**EDIT-90** **Underlines are decorations, never marks.** Nothing here can dirty the buffer, reach the `.fountain`, or appear in a PDF — the export path goes through the layout engine, which never sees them. Switching the check off leaves the play byte-identical.

<a id="EDIT-91"></a>

**EDIT-91** **Words the writer teaches it live in `settings.json`**, beside `lastVault` and outside every vault: a name learned while writing one play is still spelled the same in the next, and a word list is not play content. The on/off toggle is a view preference and lives in localStorage beside page view and zoom.

<a id="EDIT-92"></a>

**EDIT-92** **Cost is per keystroke, not per script.** A change re-checks only the blocks it touched; the full pass happens twice — when the dictionary finishes loading, and when the word list behind it changes.

<a id="EDIT-D117"></a>

### Editing materials (non-script)

<a id="EDIT-93"></a>

**EDIT-93** Markdown materials (characters, research, notes, loglines) open in a plain prose editor — standard Markdown editing, YAML front-matter shown as a small structured header. No play formatting; these are notes, not script.

<a id="EDIT-D118"></a>

### Undo / redo

<a id="EDIT-94"></a>

**EDIT-94** Standard ProseMirror history. Text edits, element-type changes, and **in-document scene reorders** (a script is a single ProseMirror document, so reordering scene cards is a transaction) are all undoable.

<a id="EDIT-95"></a>

**EDIT-95** The stack is **in-memory and ephemeral** — never persisted to disk:

- <a id="EDIT-96"></a> **EDIT-96** **Autosave does not clear it.** Saving is orthogonal to the history, so you keep undoing across autosaves (essential, since autosave fires continuously).
- <a id="EDIT-97"></a> **EDIT-97** **It resets on reload/reopen** — closing and reopening the script, or an external-change reload, starts a fresh history. You cannot undo *across* a reload. This is acceptable because the [conflict safety floor](../keeping-work/storage-and-file-format.md#STOR-D9) guarantees no data is lost at a reload.

<a id="EDIT-98"></a>

**EDIT-98** **Out of scope for v1:** a unified workspace-level undo covering binder operations (move/rename/delete materials, reorder sub-projects) and card metadata (color/status/label, which live in the sidecar, not the ProseMirror doc). Those are protected instead by the safety floor — deletes go to the OS trash, both conflict versions are preserved, writes are atomic — not by the undo stack. A workspace command stack can be added later if wanted.

## Design

The editor uses the flat TipTap/ProseMirror schema in `src/editor/schema.ts`. `bridge.ts` translates the editable representation to the Fountain model without storing view decorations. Parsing, serialization, cue interpretation and scene extraction live in `src/fountain/`.

Element entry, leader keys and autocomplete share the editor commands. Pagination consumes the single layout engine; comment and spelling decorations do not change print geometry. Session controllers own autosave, conflict choices and the ephemeral undo lifetime. The tests exercise round-trip fidelity, input transactions and actual page geometry.

House geometry, opening-sheet pagination and tagged PDF output are specified in [Formats and layout](../formatting/formats-and-layout.md).
