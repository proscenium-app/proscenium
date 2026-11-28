# Script editor

[Writing](README.md) › Script editor

This contract covers entering and editing script text: element types, predictable keys, spelling and undo. The [Fountain data model](../../engineering/fountain-model.md) defines the stored representation.

[Elements](#EDIT-D101) · [Entry and correction](#EDIT-D107) · [Names in directions](#EDIT-D119) · [Spelling](#EDIT-D116) · [Undo](#EDIT-D118)

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
| **Horizontal Line** | A line between two passages of a scene | A hairline margin to margin, on a row of its own with a blank row above and below. | [EDIT-213](#EDIT-213) |

<a id="EDIT-11"></a>

**EDIT-11** Plus front-matter fields (Title, Author, Draft date, Contact, CHARACTERS, SETTING, TIME, AT RISE), edited in Cast & Pages and, in page view, on their own sheets, never as inline nodes — see [Front matter](../formatting/formats-and-layout.md#EDIT-D103).

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
- <a id="EDIT-195"></a> **EDIT-195** **The page is its format's shape at every zoom, so no zoom takes its type below the legible.** A WebKit view keeps text no smaller than 9 pixels however far its page is zoomed out (its smart minimum). Below the level that puts the format's type at 9 pixels, about 56% for 12-point type, a script's type stayed at 9 pixels while its page shrank, its lines wrapped where the layout engine had not broken them, and its sheets ran taller than the format: 1.39 times at 50%, 3.8 times at 25%, on a Mac and on an iPad, where Fit Width in a third of a Split View lands at 32%. So while a pane shows the script's page, the zoom is never below that level (`zoomFloor`, `src/app/use-zoom.ts`), whatever chose it: a fit, a preset, a step or a pinch. A fit held at the floor says so in its percentage, and the page scrolls rather than run off its shape. A document's page grows with its text and has no sheets to break, so with the script off screen a fit may go lower. Chromium has no such minimum and is held to the same floor, so the page is the same in every engine.
- <a id="EDIT-196"></a> **EDIT-196** **The script's words zoom with its page, on every system.** The zoom draws the script's page by its own lengths and type: every length the format gives (the sheet, its margins, the line, the header and footer) and the type size are the format's times the zoom (`--page-scale`, `src/format/css.ts`), and what is in `ch`, `em` and `lh` follows the type, so the page is laid out at the size it is drawn. It was CSS `zoom`, and on an iPad the system's text autosizing set a zoomed element's type back to its unzoomed size, at a contenteditable element whatever `-webkit-text-size-adjust` said: the sheet, its margins and spacing zoomed while the script's words stayed at 100%. At Fit Width in landscape, 111% on an 11-inch iPad, a page of dialogue measured 1.19 of its width where the format is 1.29, and from about 150%, where Fit Width lands on a 13-inch iPad with the binder shut, a page of dialogue was wider than tall; below 100% the words wrapped more and the pages ran tall. The Changes view's script page scales the same way, and so do the documents' pages ([WORK-52](../organizing/workspace-model.md#WORK-52)): no CSS `zoom` is left in the app, since under an ancestor's `zoom` an iPad gave back the unzoomed size to any element that sets its own type, and to an editable one even when it inherits, whatever `-webkit-text-size-adjust` said. The document carries `-webkit-text-size-adjust: none` (`src/app/styles/base.css`), so the system resizes none of the app's type. A Mac's WebKit and Chromium do no autosizing, so no smoke engine showed it; the iPad's native pass holds every page to its format's shape in the real app.
- <a id="EDIT-197"></a> **EDIT-197** **A page is its format's height however its lines are drawn.** The layout engine counts a page in rows of the format's exact pitch, and the page view draws a page's blank remainder in those rows. Apple's WebKit, in the iPad app and in the Mac app alike, draws each line of text a whole pixel tall, the pitch cut down (19 pixels for 19.2 at 100%, 10 for 10.944 at 57%), whether the line height is a ratio or a length, so a full page came out short of its format, by up to 5% at the zoom's floor and by about half a percent at 100%. The page measures what a line is drawn short by whenever its pitch can change (`--line-shortfall`, `src/editor/line-shortfall.ts`), and each remainder takes back as much for every row of text on its page, a dual pair's two halves counting as one. Chromium cuts a line only to its layout unit, a sixty-fourth of a pixel (19.1875 for 19.2), so there it takes back less than a pixel a page. The words keep the line the engine gave them, so the cut shows only as a little more paper under a full page's last line.
- <a id="EDIT-198"></a> **EDIT-198** **A zoom keeps the writer's place.** Changing the zoom, by a step, a preset, a fit, or a fit solving again as the pane resizes, holds one line of the page still in the pane: the line the caret is on, while the caret is in view, or else the line at the middle of the view, at the same height in the pane and the same point along it, so the scroll bar moves with the page and a step out and a step back in come back to the same place. The pane used to keep its scroll offset in pixels, and the same offset into a page drawn shorter is a later part of the play: a step out from the start of Act One showed Act Two. A line is held as a box (`src/ui/zoom-anchor.ts`), never by scaling the offset, because the desk between sheets and the chrome above the first one do not zoom, and on a long play that error grows with every page. Documents hold their place the same way, in Page and in Source, and so do the Changes view's pages when the pane resizes under them. A press on the zoom's − or + leaves the caret where it was, as the element bar's buttons do: on an iPad a press that took focus from the script took the keyboard's bar with it, and the pane, grown under the page at the script's end, could not keep the line's place.
- <a id="EDIT-211"></a> **EDIT-211** **A click or a drag lands on the line under the pointer, at every zoom.** A click on any line of the script puts the caret on that line, in the element the pointer is over, and a drag across a line selects inside that line: at every zoom the steps reach from 70% to 130%, straight after a zoom step, and straight after typing, while the page is still being drawn again. So does a click however busy the page is. The editor hears of a click's caret by `selectionchange`, which a busy page delivers late, and two things wrote the editor's old selection over a click it had not heard of yet: ProseMirror's look at the page 20 ms after the editor takes focus, and any update that draws the page again, such as the sheets drawn again 120 ms after an edit. The click was undone and the caret went back to where it stood: a writer clicked the first line of a speech and the caret stayed in the parenthetical a line above; a drag's highlight was taken back as the button was let go; and with the page quiet again it did not happen. A focus that comes with a press on the editor, by a mouse, a finger or a pen, is now marked as ProseMirror marks one and never gets that look; a focus by key or by the app's own call keeps it, since it exists for a browser that moves the caret on a focus by key (`src/ui/caret-on-focus.ts`). And an update that chooses no selection of its own takes the one the browser holds, when the editor has not read it yet (`src/ui/pending-selection.ts`). Never the editor's own note that it took the keyboard: the browser's caret at a focus is the focus's, at the script's very start when a page's editor has just closed, and a press on a sheet in the second before made it a pointer's, so a page ended about a second after a press on it left the script's caret at the top of the play. Smoke's "pages before the script · ending a page leaves the script's caret where it was" holds the press and ends the page inside that second. The proof of the click is smoke's "zoom · a click or a drag lands on the line under the pointer", which clicks every line of a parenthetical, the speech after it and the direction after that, each click straight after a scroll, with the editor's focus taken before each level's first click and the page's `selectionchange` held back 40 ms, as a busy page holds it, and runs in Chromium, WebKit, the Mac app and the Windows app.
- <a id="EDIT-200"></a> **EDIT-200** **Withdrawn** (2026-11-15). Replaced by [EDIT-212](#EDIT-212), which keeps its guarantee for the script and every document, and by [docs/app/formatting/formats-and-layout.md#FMT-169](../formatting/formats-and-layout.md#FMT-169): a tap or a click on a page before the script now opens that page where it prints.
- <a id="EDIT-212"></a> **EDIT-212** **An editor that takes the keyboard with no caret puts one where the play's caret stands.** Touched first in a play whose script had not yet held a caret, a page's tap once gave the script the keyboard and no caret, and an iPad's keyboard then typed nothing: every word until a Return was lost, and the Return itself came only by the editor's own fallback a fifth of a second later. The editor puts its own caret back whenever it has the keyboard and the page holds no selection in it: a moment after it takes the keyboard, so a tap's own caret lands first, and at a key, before the key is read. The words go where the play's caret stands: where the writer left it (`src/app/caret-memory.ts`), or at the top of the script. The script's editor and every document's do so (`src/ui/caret-on-focus.ts`); so does the script when a page before the script it never touched is put away with Esc.
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
  rest of the speech to action (round-trip rule 1). The same line stands under
  a cue that has no speech at all, so the cue is still a cue when the script is
  opened again, with an empty speech under it
  ([docs/engineering/fountain-model.md#EDIT-175](../../engineering/fountain-model.md#EDIT-175)). And it
  stands between two verses of one speech, where it is the break between them
  and comes back as no line of its own
  ([docs/engineering/fountain-model.md#EDIT-183](../../engineering/fountain-model.md#EDIT-183)).
  Each of those has a line of its block over it. With none over it the line
  has nothing to keep going, and is read and written as a blank line
  ([docs/engineering/fountain-model.md#EDIT-191](../../engineering/fountain-model.md#EDIT-191)).

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
- <a id="EDIT-54"></a> **EDIT-54** **Auto-caps**: Character cues, Act/Scene/Transition headings auto-uppercase as you type, and so do character names in the directions where the format asks ([EDIT-202](#EDIT-202)). Settings › Writing › **Capitalize as you type** turns it off, and it is on unless turned off ([docs/app/preferences-and-help/settings.md#SET-44](../preferences-and-help/settings.md#SET-44)); off, nothing goes into capitals as it is typed. The switch was described here from the first, and built on 2026-11-10. The system's own capitals stay off on those lines, so nothing fights auto-caps; in action and dialogue, which auto-caps leaves alone, a screen's keyboard begins each sentence with a capital, as in every other app (`autocapitalize` follows the caret's line). With the system's capitals off throughout, a writer on an iPad's glass began every sentence in lower case.

<a id="EDIT-176"></a>

**EDIT-176** **A cue that holds lower case keeps it.** Auto-caps reads the whole script on every change and upper-cases each Character that is not `forced`, an attribute of the block that only typing `@` set. A script read from disk carried none. The file says a cue keeps its case with the letters themselves, and `serialize` writes the `@` from them ([docs/engineering/fountain-model.md#EDIT-138](../../engineering/fountain-model.md#EDIT-138)). So after a reopen the first change anywhere in the script made `McTeague` read MCTEAGUE, and the next save wrote that. It took a cue with no `@` in the file too: `HANS (on the radio)` became `HANS (ON THE RADIO)`.

- **Where it is held.** On the page, in `forced`. From the letters alone auto-caps cannot tell a name read from a file from one half typed, so it has to be told. An attribute stays with its block through an undo and a move, and through a cut and a paste ([EDIT-177](#EDIT-177)).
- **Who sets it.** Typing `@` ([EDIT-53](#EDIT-53)), as before. And `toEditorDoc` (`src/editor/bridge.ts`), the one door every script comes onto the page through: opened, read again after it changed on disk, put back from Versions, or brought back after a change on the board. There a cue with a letter auto-caps would change is `forced`. The question is asked of the cue as the page shows it, so of its name and its extension ([docs/engineering/fountain-model.md#EDIT-124](../../engineering/fountain-model.md#EDIT-124)), and not of a comment on it: a comment in lower case on `MARA` leaves her a cue that upper-cases as it is typed.
- **What the script holds.** Nothing new. The parser sets no `forced` and the serializer reads none. The model carries the attribute out of the editor and back in, so a cue the writer forced stays theirs when a change made off the page brings the script back onto it. A cue typed with `@` and left in capitals is `forced` for as long as the page lives. After a reopen it is a cue like any other, because the file has no letters to say otherwise.
- **What did not change.** A new cue typed in lower case with no `@` is upper-cased as it is typed. So is a line set to Character, and so is a cue in capitals read from a script and typed in.
- **Why not in auto-caps.** Leaving alone every cue the change did not type in would keep the case through a keystroke elsewhere and lose it at the first change to the cue itself. Adding `(V.O.)` to `McTeague` would upper-case the name, and so would an undo that put the name back. What a cue is would depend on what last touched it, and every change the app makes itself (a script read again, a scene moved, a version put back) would have to say which kind it was.
- **Why not in the parser.** Set from the `@` in the file, `forced` would be set for every cue with a comment on it, which is written with an `@` whatever its capitals ([docs/engineering/fountain-model.md#EDIT-174](../../engineering/fountain-model.md#EDIT-174)), and auto-caps would stop for `MARA` the moment someone commented on her. Set from the letters, it would be a second copy of them in the model, for every other maker of a model to keep in step.

`src/editor/auto-caps.test.ts` pins a cue in mixed case read from a script, with and without an extension, a comment, a `^` and a speech under it, through a keystroke elsewhere, the next save and the reopen after it; a name in another alphabet; and what is still upper-cased as it is typed. `src/editor/bridge.test.ts` pins the page that comes back.

<a id="EDIT-177"></a>

**EDIT-177** **A cue is what it was after a cut and a paste.** The clipboard is the other door onto the page. A block goes onto it as the HTML the schema writes and comes off it through the schema's parse rules, and a yes-or-no attribute is written bare: `data-forced`, `data-dual`. Read back with `getAttribute`, a bare attribute is the empty string, which is no to everything that asks. So a cue in mixed case, cut and pasted, was upper-cased where it landed. A right-hand cue kept the quiet `^` the page draws wherever `data-dual` is, while the layout engine, which asks for `true`, no longer set it beside its partner, and it was saved without its `^`. Both are read back by whether the attribute is there (`flagAttr`, `src/editor/schema.ts`). `src/editor/schema.test.ts` pins that each attribute of a cue and of a scene heading is read back from the HTML it writes.

<a id="EDIT-193"></a>

**EDIT-193** **Every line of speech on the page has a cue over it.** A line of dialogue or a bracketed line with no cue over it is a stage direction to every Fountain reader ([docs/engineering/fountain-model.md#EDIT-191](../../engineering/fountain-model.md#EDIT-191)). The page let one stand as dialogue, and the next time the script was read (a reopen, a change on disk, a version put back) it was a stage direction, with nothing in between to say so: a shouted line in capitals came back a cue, and the line under it its speech. The gestures that made one are the ordinary ones. Enter after a speech gives a stage direction, and the speech typed after it and set to Dialogue had no cue. A direction opened between two paragraphs of a speech, or a paragraph of a speech set to Action, parted every paragraph below from its cue. A cue set to another element, deleted, or joined into the line above with Backspace left its speech with none.

So after each change the page is put the way the script will read, in the same undo step as the change (`src/editor/speech-cues.ts`):

- **A speech a direction parts from its cue** gets the speaker's name over it again, the way a printed play repeats it after a direction. The name is the cue's own, without its extension and in its own case. A line that stood under no cue before the change, such as a direction set to Dialogue, takes the last cue above it in its scene.
- **A speech whose cue is gone**, set to another element, deleted or joined into the line above, is the stage direction the file will make of it, now, where the writer sees it. So is a line set to Dialogue with no speaker above it in its scene. A bracketed line keeps its brackets as text. Backspace and Delete take no cue with a name away ([EDIT-210](#EDIT-210)); a cue set to another element, taken out in a selection, or taken with no name in it ([EDIT-215](#EDIT-215)) still is.
- **What is left alone.** A cue with no name yet is a cue, so a name deleted and typed again never moves the speech under it. A lyric stands with no cue, because its `~` makes it a lyric wherever it is. A page where every speech has its cue is not touched.
- **A name the page added stays** when the direction above it is taken away again; the cue is then the same speaker twice. ⌘Z takes back the gesture and the name together, and Backspace at the start of the second name makes the two speeches one ([EDIT-210](#EDIT-210)).

`src/editor/speech-cues.test.ts` pins each gesture, saves and reads back every page it leaves, and sweeps every page of one to three cues, speeches, brackets, directions and lyrics with each block set to each element and joined to the block above: none leaves a line of speech with no cue, and each reads back as the elements the page shows.

<a id="EDIT-210"></a>

**EDIT-210** **Backspace and Delete stop at a cue.** Both keys join the lines on either side of them, and a cue joined to another line is no longer a cue. Backspace at the start of a name ran it into the stage direction above, and every line of its speech became a stage direction with it ([EDIT-193](#EDIT-193)). Enter to part the two lines again left the name a stage direction too, so the speech never came back. One Backspace too many in a name being typed again did the same, and where a speech stood above instead of a direction, the speech was given to the speaker above. Backspace at the start of a speech ran its first line into the name, and auto-caps put it in capitals.

So neither key joins a cue to the line beside it (`cueStop`, `src/editor/speech-cues.ts`):

- **A name stays a line of its own.** Backspace at the start of a name changes nothing, and neither does Delete at the end of the line above it. The same goes for Backspace at the start of a speech and Delete at the end of its name.
- **A cue with no name yet** stays over its speech while its name is typed, so the name typed next goes where the old one was. That neither key took it away is withdrawn (2026-11-26): it goes as any empty line does ([EDIT-215](#EDIT-215)).
- **An empty line still goes.** An empty line above or below a cue is taken away as any empty line is. So Backspace takes back the empty line Enter opened under a name, and a speech deleted line by line takes its cue last. An empty line under a cue with no name yet goes, and the cue stays over the rest of the speech.
- **The same speaker twice in a row is one speech.** Backspace at the start of the second name, or Delete at the end of the speech above it, takes the name away and leaves the caret at the end of the first speech. It is the one cue the keys take, because the speech keeps its speaker. A name with a comment on it stays, so a comment never goes with it.
- **Every key the editor deletes with** stops the same way: Backspace and Delete, with ⌘, ⇧ or ⌥, and ⌃H, ⌃D and ⌥D on a Mac. An input rule's own undo comes first, so Backspace straight after a rule still takes the rule back.
- **What is left as it was.** Inside a line the keys delete as they always have, and every other pair of lines joins as before. A cue set to another element, or taken out in a selection, is still a choice made on the cue: its speech becomes the stage direction the file will make of it ([EDIT-193](#EDIT-193)).

`src/editor/speech-cues.test.ts` presses each key at each of these lines, and sweeps every page of two to four cues, speeches, brackets, directions and lyrics, each with words and empty, with both keys at the edge of every line: none runs a name into another line or a line into a name, and the only cue either key takes from over a speech is one with no name ([EDIT-215](#EDIT-215)). The smoke check "cues · Backspace and Delete leave a cue over its speech" presses the keys in the script and reads the speech back under its cue in the saved file.

<a id="EDIT-215"></a>

**EDIT-215** **A cue with no name is an empty line, and goes as one.** [EDIT-210](#EDIT-210) kept a cue with no name over its speech whatever was pressed, so that one Backspace too many in a name being typed again cost nothing. The price was a key that did nothing: a writer on an empty character line who wanted the line gone pressed Backspace, and nothing answered. An empty line is an empty line, so both keys take it (`cueStop`, `src/editor/speech-cues.ts`):

- **Each key at either edge of it takes it away:** Backspace in it, Delete at the end of the line above it, Delete in it, and Backspace at the start of the speech under it. The caret is left where the same key leaves it at any empty line.
- **Its speech is what the page makes of a speech whose cue is gone** ([EDIT-193](#EDIT-193)), in the same step: the speaker's above it when a speech or a name stands above, otherwise a stage direction, a bracketed line with its brackets. ⌘Z puts the cue and the speech back together.
- **A name with a letter in it is no empty line**, and both keys still stop at it ([EDIT-210](#EDIT-210)). A name deleted letter by letter leaves the cue, with no name, over its speech; it is the next press that takes it.
- **An empty line under it goes first**, and the cue stays over the rest of the speech, as before.
- **At the top of the script** the key is the editor's own: an empty first line becomes a stage direction, whatever it was, and the speech under it with it.

The cost is the one EDIT-210 closed, a press too many while a name is typed again. It is one ⌘Z, and it is seen at once, where the key that did nothing cost a writer the line they could not delete. `src/editor/speech-cues.test.ts` presses each of the four keys under a direction, under a speech and under a name, and sweeps every page of two or three lines with the page put right after each key: none leaves a line of speech with no cue. The smoke check "cues · a character line with no name goes with Backspace or Delete, and Undo brings it back" presses them in the script.

<a id="EDIT-178"></a>

**EDIT-178** **Auto-caps changes each run where it stands.** A letter can upper-case to more than one: `ß` is `SS`. Auto-caps makes all its replacements in one transaction, and placed each from where the run stood before any of them, so after one such letter every later replacement was a place off. Two headings holding `ß` were enough: the second was replaced across its own end, and `## Die Straße wieder` came out a stage direction reading `DIE STRASSE WIEDERr`. Each run is now found through what the transaction has already done. `src/editor/auto-caps.test.ts` pins three such lines in one script, and two such runs either side of a comment on one line.

<a id="EDIT-201"></a>

**EDIT-201** **Auto-caps leaves the caret where the writer typed.** Auto-caps replaced a run of text whole whenever a letter in it was lower case, and a caret inside the run went to the run's end. Typed into a heading anywhere but its end, a word broke in two: in a play opened with the caret at the top of its script, "Kept" typed into `ACT ONE` came out `KEACT ONEPT`. Auto-caps now replaces only the letters that change, each stretch of them alone, so the caret stays after the letter just typed, and after both letters where one upper-cases to two. `src/editor/auto-caps.test.ts` types into an act, a scene, a transition and a cue at their start or middle and pins the words and the caret.

<a id="EDIT-D119"></a>

#### Character names in the directions

In American stage formats a character's name in a stage direction is in capitals every time it appears, not only at an entrance: the Samuel French guide says so in as many words, and the Dramatists Guild's Modern sample writes MRS. BRISTOL in capitals inside a direction ([docs/app/formatting/formats-and-layout.md#FMT-2](../formatting/formats-and-layout.md#FMT-2) has each format's evidence). A writer trained on screenplays capitalizes the first appearance only. So where the format asks, a name goes into capitals as it is typed, and the writer's own case wins wherever they say so. The rule lives in `src/editor/names-in-directions.ts`.

<a id="EDIT-202"></a>

**EDIT-202** **The format decides.** A format's Action element says whether cast names typed in a direction go to capitals (`capitalizeCastNames`, [docs/app/formatting/formats-and-layout.md#FMT-163](../formatting/formats-and-layout.md#FMT-163)), and the Format designer shows it on the Action row. It covers both kinds of direction, stage directions and parentheticals. It is on in the Dramatists Guild's three formats, Samuel French, Stage (US) Modern and Sketch Comedy, and off in UK / International, whose directions print in capitals already, so there it would change only the script's text. Turning off auto-caps ([EDIT-54](#EDIT-54)) turns it off too.

<a id="EDIT-203"></a>

**EDIT-203** **What counts as a name.** The cast the editor already knows: the binder's characters and the cues in the open script, the pool character autocomplete draws from ([EDIT-55](#EDIT-55)), and the title page's Characters list. A name is a whole word, matched whatever its case, and never part of a word: `Junebug` is not JUNE. A possessive ending stays in the writer's case: `Charlie's` becomes `CHARLIE's`.

- **A name that is an ordinary word.** A character called IT or DO must not capitalize every "it" and "do". A one-word name is left as typed when the play's spelling dictionary has it as an ordinary lower-case word, unless the writer gave it a capital and the dictionary carries it as a name as well (a stem with a capital that takes a possessive). So `it`, `It`, `will`, `rose` and `charlie` are left alone, `Will`, `Rose` and `Charlie` go to capitals, and `June` or `Mara`, which the dictionary has only as names, go to capitals in any case. The dictionary has `charlie` in lower case as slang; read without the case, it would have left CHARLIE as typed for good. The writer types the others in capitals. Until the dictionary has loaded, no one-word name is capitalized; a language with no dictionary has no ordinary words.
- **A name of several words.** `THE HOST` typed whole (`The Host`, `the host`) is capitalized whole. Its last word alone is capitalized when it stands without the rest, or after the rest in lower case with a capital of its own: `the Host` becomes `the HOST`. A last word that is an ordinary word counts alone only with a capital, so "a host of lights" is left alone.

<a id="EDIT-204"></a>

**EDIT-204** **When it fires.** Only when the writer types a word boundary (a space, punctuation, Enter or Shift+Enter) directly after typing the name's last letter, in a stage direction or a parenthetical. Typing is what the page is handed as typed text (`handleTextInput`) or the Enter key, matched to the change that follows it. So it never fires on a paste, a drop, an undo or a redo, a composition, Find and Replace, autocomplete, a script read from disk or iCloud, a version put back, or a scene moved on the board; and never in a comment, a boneyard, dialogue, a cue, a heading, a synopsis or the title page. There is no pass over the whole script: auto-caps reads all of it on every change because a cue is in capitals whatever touched it last ([EDIT-176](#EDIT-176)), and here the writer's own case is the point, so only the keystroke that finishes a name may change it. A word already in the script is never capitalized because a key was typed after it.

<a id="EDIT-205"></a>

**EDIT-205** **The writer's override.** The capitals are their own undo step, after the keystroke that triggered them (`closeHistory`). ⌘Z straight after puts back the writer's case and keeps the boundary they typed. Backspace as the very next key does the same instead of deleting the boundary, as a word processor takes back an autocorrection; a second Backspace deletes as normal. Typing the name over itself in another case, or changing its case by hand, is the same revert. A revert is of that occurrence, not of the name: the next "June" typed goes to capitals.

<a id="EDIT-206"></a>

**EDIT-206** **A declined name stays declined, and the script holds nothing new.** The page holds whose case a name is in with its letters, as a cue holds `forced` ([EDIT-177](#EDIT-177)): a mark, `castKept`, on an occurrence the writer declined, and `castCaps` on capitals the editor made, which is how a later change of their case by hand is seen. Neither reaches past its letters, so the next name typed is the editor's again. Both stay with the text through further typing, a typo fixed inside the name, an undo and a redo, a cut and a paste (they are written to the clipboard as `data-cast-kept` and `data-cast-caps`), and a scene moved on the board (the model carries them out of the editor and back, as it carries `forced`). An undo of the capitals is itself a decline: the editor remembers the occurrences it capitalized and the letters they replaced, and an undo that puts those letters back marks them. Nothing is written to the `.fountain` file (`serializeInline` drops both marks). After a reopen [EDIT-204](#EDIT-204) is the protection: no word in the script is changed by a key typed after it.

<a id="EDIT-207"></a>

**EDIT-207** **Guards.** A stage direction whose letters are all capitals because of this rule (`Charlie.` that became `CHARLIE.`) stays a stage direction when Enter is pressed: Enter's promotion of an ALL-CAPS line to a cue ([EDIT-49](#EDIT-49)) does not read capitals the editor made, and the serializer's `!` keeps the line a direction after a reopen ([docs/engineering/fountain-model.md#EDIT-136](../../engineering/fountain-model.md#EDIT-136)). Every position is mapped through the change, as auto-caps maps its own ([EDIT-178](#EDIT-178)), so a name with a letter that upper-cases to two (`Groß`) leaves the caret where the writer typed.

<a id="EDIT-208"></a>

**EDIT-208** **Existing scripts: Capitalize Character Names in Directions….** A command in the document menu and the menu bar's Script menu lists every occurrence the rule would capitalize, each with its line, all ticked: each name in a direction, whole words only, under the same rules for ordinary words, not in capitals already and not declined. The writer unticks what to keep, and applying the rest is one undo step; with every one unticked, the button is **Keep All as Written**. Unticked occurrences are declined as in [EDIT-205](#EDIT-205) and are not offered again ([EDIT-209](#EDIT-209)).

<a id="EDIT-209"></a>

**EDIT-209** **A decline from the command outlasts a reopen.** The command keeps each occurrence the writer unticked in the play file, never the script ([docs/app/keeping-work/storage-and-file-format.md#STOR-194](../keeping-work/storage-and-file-format.md#STOR-194)), and does not offer it again: not while the play is open, where the page's own mark says so too, and not after it is opened again. An entry whose direction is rewritten or deleted is dropped at the next apply. Until 2026-11-10 a decline lasted only while the play was open.

`src/editor/names-in-directions.test.ts` types each case into a bare page with the history, auto-caps and the play's real dictionary, and pins the words, the marks, the undo steps and the saved script: each boundary in a direction and a parenthetical, none on a paste, an undo, a reload, a version put back or a composition; ⌘Z and Backspace; a decline through typing after it, a typo fixed inside it, an undo and a redo, a cut and a paste and a scene moved; the next occurrence; IT, DO and WILL; `Charlie's`, `The Host` and `the Host`; comments, speeches and cues untouched; the Enter guard and the `!`; and the rule off with its format field or auto-caps. `src/format/registry.test.ts` pins each built-in's default.

<a id="EDIT-D112"></a>

#### Character autocomplete

<a id="EDIT-55"></a>

**EDIT-55** In a Character element, typing offers names drawn from the cast (from `characters/*.md` sheets and previously used cues). Enter or Tab accepts the highlighted name. Keeps speaker entry to a few keystrokes and cue spelling consistent.

<a id="EDIT-56"></a>

**EDIT-56** **Empty-cue suggestions (Enter-Enter):** landing in an *empty* Character element opens the list immediately, ranked by dialogue alternation, with the predicted next speaker **pre-selected — a second Enter accepts it**. ↑/↓ or typing picks a different name; Tab deliberately does *not* accept here (it opens the element menu, keeping a different element one keystroke away). **Esc then Enter** opens the element menu on Action.

<a id="EDIT-57"></a>

**EDIT-57** **Caret popup accessibility:** Character suggestions name their listbox and active option from the focused script. Both caret popups accept click-only activation. The semicolon menu moves real focus between its rows with Up/Down and Home/End; Enter or Space chooses, Escape cancels, and the mnemonic letters still choose directly. Its keyboard layer uses the shared menu contract and returns focus to the script.

<a id="EDIT-58"></a>

**EDIT-58** **Leader menu:** `;` on an empty line now draws a caret-anchored menu of every element with its mnemonic key (the visible UI for the leader contract below); Esc cancels without typing the `;`. **Tab on an empty line opens the same menu** (Tab on a non-empty line still cycles the ring). **So does Enter on an empty line**, on the predicted next element rather than the first row. While the menu is open, **Shift+Enter and ⌘Enter keep their meaning**: the menu closes and the line break or page break goes in, never a choice of the focused row. An empty Parenthetical keeps its caret between its parens in every alignment. Its hint says what the keys do, and on a touch screen what a finger does: a tap on a row chooses it, and a tap anywhere else closes the menu, since the screen's keyboard has no Esc.

<a id="EDIT-59"></a>

**EDIT-59** **Soft line breaks:** **Shift+Enter** inserts a single line break inside Action, Dialogue and Lyric — the next line single-spaced under this one, same block; plain Enter keeps meaning "next element". The break is a `lineBreak` node that bridge.ts maps to a literal newline — galley (pre-wrap), engine (`splitParagraphs`), serializer and PDF all carry it natively. A sigil belongs to a line, not a block: `@` or `!` typed right after a soft break splits the block there and forces a Character or an Action on that line; any lines below it stay in the element they were in (`sigilAfterBreak`, breaks.ts). The other sigils still anchor to the block start.

<a id="EDIT-60"></a>

**EDIT-60** **Forced page breaks:** **⌘/Ctrl+Enter**, a `⤓ Page Break` button in the element bar, and `-` in the leader menu all insert the schema's `pageBreak` node — the same node Fountain's `===` parses to and the engine has always honored (`startsNewPage`). On an *empty* block the break replaces that block (the gesture a writer makes: caret on the blank line between two scenes); on a block with words in it the break lands *after* the whole block rather than splitting it mid-sentence. The caret goes to the line that already follows, which opens the new page with nothing above it: a break at the end of a scene puts the next scene's title on the new page's first line. Only when no line with text follows (the end of the play, or another break) does an empty Action come with the break, so the caret has somewhere to be and the document never ends on an atom.

<a id="EDIT-213"></a>

**EDIT-213** **A horizontal line** draws a line across the page between two passages, for a play that marks a shift inside a scene with one rather than with a new scene. It is a line of the script by itself, the schema's `horizontalRule` node, and is written to the file as `---` ([docs/engineering/fountain-model.md#EDIT-214](../../engineering/fountain-model.md#EDIT-214)). Three ways put one in: **Horizontal Line** in the element menu (`;` then `H`, or Tab or a second Enter on an empty line), the same row in the element bar's "What this line is" popup, which is how a finger reaches it, and `---` typed on an empty stage direction, the way `===` makes a page break (Backspace straight after gives the hyphens back). It is placed as a page break is ([EDIT-60](#EDIT-60)): in place of an empty line, or after the line with words the caret is on, with the caret on the line that follows, and an empty Action with it only when no line with text follows. Unlike a page break it prints: the format gives it a row of its own with a blank row above and below, margin to margin ([docs/app/formatting/formats-and-layout.md#FMT-172](../formatting/formats-and-layout.md#FMT-172)), and the page view draws it there as the PDF does. A click selects it and Backspace or Delete takes it away. It parts a speech as a stage direction does, so a speech it parts gets its speaker's name again ([EDIT-193](#EDIT-193)). A pasted `<hr>` is one too. In Changes a line that was added or cut takes the colour of the change.

<a id="EDIT-61"></a>

**EDIT-61** A forced page break prints nothing and contributes no layout space. It carries a `PAGE BREAK ✕` handle (`page-break.ts`), the same kind of chrome comments use: a widget decoration, absolutely positioned with auto offsets, so it draws at its static position and contributes zero width and zero height — the node stays collapsed and DOM geometry still matches the engine. Click the label to select the node (the collapsed node had nothing for the default selection outline to draw on), ✕ to delete it; Backspace at the head of the block below still works, as it always did. The handle is the presentation in both views.

<a id="EDIT-62"></a>

**EDIT-62** **Emphasis:** **⌘B / ⌘I / ⌘U** toggle `strong` / `em` / `underline`, which round-trip through Fountain's `**bold**` / `*italic*` / `_underline_`. They are allowed only in Action, Dialogue, Parenthetical, Lyric and Centered. A cue is a *name*, and a heading's weight comes from the format spec's `fontStyle`, which stays the single source of truth for element-level styling — so the fence covers the keys and the element bar's B/I/U buttons together, and the buttons *disable* there rather than silently no-op.

**EDIT-63 — Withdrawn 2026-09-25.** Replaced by [EDIT-170](#EDIT-170) and [EDIT-171](#EDIT-171): the chevron and the palette it expanded were deleted because Tab, `;` and each element's ⌘⌥ chord already reach every element, and the bar now has to fit a pane narrower than its row. The original wording is kept in [withdrawn requirements](../../engineering/withdrawn-requirements.md#EDIT-63).

<a id="EDIT-170"></a>

**EDIT-170** **The element bar is one quiet row** over the page: a popup naming the element you are in (every element, with its key), B/I/U, Line Break and Page Break, `+ Comment` and `Comments (N)`, and "Page N of M". There is no palette to expand. Every element type is also on Tab, on `;`, and on its ⌘⌥ chord. Holding ⌘ shows each button's shortcut, and so does hovering over one.

<a id="EDIT-171"></a>

**EDIT-171** **The element bar fits its pane.** It is as wide as the sheet (at least the sheet at 100%, so zooming out does not shrink it) and never wider than the pane can show, and nothing in it widens the desk the sheet lies on. When the page is wider than the pane, the bar stays in view as the page scrolls sideways. On a touch screen the hint says what a finger does instead ("Tap it to change the line"), since the screen's keyboard on an 11-inch iPad has no Tab. Where the row does not fit, it stays one row and gives way in this order: the hint goes; the breaks and comment buttons keep only their icons, still named for a screen reader; then Comments, the breaks and B/I/U, in that order, fold into a **More** menu (⏎ or ↓ opens it, with each action's shortcut). The element popup and "Page N of M" never leave the row; in the narrowest pane the element's name is shortened instead. Shortcut keys float under their buttons, so showing them takes no room and moves nothing.

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
| Dialogue | `d` | ⌘⌥D; ⌘⇧D on an iPad, whose Dock keeps ⌘⌥D whatever the app asks | <a id="EDIT-72"></a>EDIT-72 |
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

**EDIT-80** Misspellings get a wavy underline; right-click one for corrections, **Add to Dictionary**, or **Ignore in this session**. A finger's tap on one opens the same menu, as a tap on a misspelled word does across iPadOS: a long press by touch fires no right-click in WebKit, so until 2026-11 a finger had no way to a correction. Where the system's text editing takes the tap for its own, placing the caret, the page hears the touch and no click, and the finger's lift opens the menu when no click follows it. A pointer's click only places the caret, as before. Format ▸ **Check spelling** turns the whole layer off. Typos only — no grammar, no style, no rewriting a writer's sentences.

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

<a id="EDIT-194"></a>

**EDIT-194** **Where the system's own spelling may not run in a document, the script's checker marks its words.** On an iPad every field has spell checking off, so that the system's smart punctuation rewrites none of a writer's quotes and dashes ([PLAT-35](../../engineering/cross-platform.md#PLAT-35)), and the system marks no word. There the prose editor, wherever it is drawn (a material, a character's sheet, the outline's notes, the opening pages), carries the [spell check](#EDIT-D116) the script has: the same underlines, the same correction menu, opened as the script's is, and the same speller, so the cast is spelled as the play spells it and a word learned in a document is learned in the script. A document's headings, lists, quotes and tables are checked; its code, a code block or code in a line, is not. There the system's autocorrection is off in the documents too, as it is in the script, and its sentence capitals stay: it put its own guess in place of an underlined word as the tap on it moved the caret away, so the app's corrections never opened, and it knows nothing of the cast. Where the system's spelling may run, a Mac and a PC, the documents are the system's to check, and nothing is added to them.

<a id="EDIT-D118"></a>

### Undo / redo

<a id="EDIT-94"></a>

**EDIT-94** Standard ProseMirror history. Text edits, element-type changes, and **in-document scene reorders** (a script is a single ProseMirror document, so reordering scene cards is a transaction) are all undoable.

<a id="EDIT-95"></a>

**EDIT-95** The stack is **in-memory and ephemeral** — never persisted to disk:

- <a id="EDIT-96"></a> **EDIT-96** **Autosave does not clear it.** Saving is orthogonal to the history, so you keep undoing across autosaves (essential, since autosave fires continuously).
- <a id="EDIT-97"></a> **EDIT-97** **It resets on reload/reopen** — closing and reopening the script, or an external-change reload, starts a fresh history. You cannot undo *across* a reload. This is acceptable because the [conflict safety floor](../keeping-work/storage-and-file-format.md#STOR-D9) guarantees no data is lost at a reload.

<a id="EDIT-98"></a>

**EDIT-98** **Out of scope for v1:** a unified workspace-level undo covering binder operations (move/rename/delete materials, reorder sub-projects) and card metadata (color and notes, which live in the sidecar, not the ProseMirror doc). Those are protected instead by the safety floor — deletes go to the OS trash, both conflict versions are preserved, writes are atomic — not by the undo stack. A workspace command stack can be added later if wanted.

## Design

The editor uses the flat TipTap/ProseMirror schema in `src/editor/schema.ts`. `bridge.ts` translates the editable representation to the Fountain model without storing view decorations. Parsing, serialization, cue interpretation and scene extraction live in `src/fountain/`.

Element entry, leader keys and autocomplete share the editor commands. Pagination consumes the single layout engine; comment and spelling decorations do not change print geometry. Session controllers own autosave, conflict choices and the ephemeral undo lifetime. The tests exercise round-trip fidelity, input transactions and actual page geometry.

House geometry, opening-sheet pagination and tagged PDF output are specified in [Formats and layout](../formatting/formats-and-layout.md).
