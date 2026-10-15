# Comments

[Writing](README.md) › Comments

Comments stay with the script. This contract defines their source representation, presentation, feed and editing behavior.

[Annotations](#COMM-D1) · [Rendering](#COMM-D4) · [Comment feed](#COMM-D5) · [Writing a comment](#COMM-D6) · [Replies](#COMM-D10) · [Signing](#COMM-D11) · [What a comment is about](#COMM-D13) · [On a cue or a heading](#COMM-D14) · [Which scene it is in](#COMM-D15) · [With a line break](#COMM-D16)

## Requirements

<a id="COMM-D100"></a>

> Anchored, non-printing annotations on the script — the writer's margin. It
> rides on [storage-and-file-format.md](../keeping-work/storage-and-file-format.md) and may not
> bypass it. The one-line decision: **a comment is a Fountain note (`[[ ]]`),
> rendered well — not a new data store.**

<a id="COMM-D0"></a>

### Vocabulary

<a id="COMM-1"></a>

**COMM-1** The word "note" is claimed three times in this codebase, so the feature is
called **Comments** everywhere a writer sees it:

| Term | What it is | Where | Requirement |
|---|---|---| --- |
| Fountain note `[[ ]]` | The inline annotation element | The script; node type `note` | <a id="COMM-2"></a>COMM-2 |
| `notes/` materials | Markdown documents in the binder | `subproject.json`, binder type `note` | <a id="COMM-3"></a>COMM-3 |
| `card.boardNote` | Scene-level board-only free text | The card sidecar | <a id="COMM-4"></a>COMM-4 |

<a id="COMM-5"></a>

**COMM-5** A **comment** is the first of these plus presentation. The node type stays
`note` in code (it is the Fountain name); every surface label says Comments.
`card.boardNote` is *not* folded in: a board note is thinking about a scene
from the board's altitude, a comment is anchored to a spot in the text. Both
stay.

<a id="COMM-D1"></a>

### Fountain annotations

- <a id="COMM-6"></a> **COMM-6** **Notes are standard Fountain.** `[[ ]]` is in the core syntax: an
  annotation, inline or on its own line, **removed from printed output** by
  every conforming tool. This is the portable container for comments, and the
  reason the feature needs no new file format.
- <a id="COMM-7"></a> **COMM-7** **Boneyard `/* */` is the *other* "comment"** — commented-*out* text
  (omitted scenes, cut lines kept for later). Already modeled and preserved
  through round-trip (`boneyard` block). It is a different feature and out of
  scope here; naming it prevents the two being conflated.
- <a id="COMM-8"></a> **COMM-8** **There is no standard for comment *metadata*.** Author, timestamp, thread,
  resolved-state — Fountain has none of it, and the ecosystem never converged:
  one app keeps its notes in FDX XML, not Fountain; another hides an
  app-private JSON blob inside the boneyard; others render
  notes as plain annotations. Anything beyond the bare note is a convention we
  choose, and the choice below is the lightest one that works.

<a id="COMM-D2"></a>

### Comments live in the script

<a id="COMM-9"></a>

**COMM-9** docs/app/keeping-work/storage-and-file-format.md#STOR-D0 rule 3: the Fountain file owns everything Fountain can express.
Notes are Fountain-expressible, so the note text's one home is the script.
What the app adds is *presentation* (margins, a panel, attribution chips) —
all derived, none stored.

<a id="COMM-10"></a>

**COMM-10** Comments travel with the text so external edits, sync, Versions and Changes retain the annotation at its point in the script without a second store.

<a id="COMM-D3"></a>

### Source format & conventions

- <a id="COMM-11"></a> **COMM-11** **Anatomy.** Inline: `She pauses [[Robin: too long?]] at the door.` — the
  note sits at a *point* in the text. Standalone: a `[[ ]]` line between
  blocks (parses as an action block containing only a note). Both already
  round-trip byte-faithfully (`src/fountain/roundtrip.test.ts`).
- **COMM-12 — Withdrawn 2026-10-06.** Replaced by [COMM-51](#COMM-51): the
  token is still a leading `Name:`, display-parsed only, but a name is no
  longer ASCII alone. The original wording is kept in
  [withdrawn requirements](../../engineering/withdrawn-requirements.md#COMM-12).
- <a id="COMM-13"></a> **COMM-13** **Reserved prefixes.** `id:` stays the embedded scene anchor
  (docs/engineering/fountain-model.md#FOUN-D110) — already excluded from author notes by the
  parser, and every comment surface must exclude it too. `todo:` is
  recognized for filtering (a `todo` chip and a panel filter), nothing more.
- <a id="COMM-14"></a> **COMM-14** **No dates in the text.** "When was this written" is the history ring's and
  the ledger's job; a timestamp convention would make every comment cost a
  glance more than it should.
- <a id="COMM-15"></a> **COMM-15** **Multi-line.** Fountain notes may contain line breaks but not blank lines;
  the composer enforces it (Enter inside a comment inserts a line break,
  never a blank line).

<a id="COMM-D4"></a>

### Rendering

<a id="COMM-16"></a>

**COMM-16** The invariant that governs all of it: **comment content contributes zero
width and zero height to the measured text**, because the engine strips notes
from print (`engine.ts` — "print-invisible: skipped, contributing no width")
and the page view must wrap and break identically to the engine.

- <a id="COMM-17"></a> **COMM-17** **The margin**: a card on the desk beside the page,
  level with the line it annotates. Reading, editing and resolving happen
  there. Three parts, all of them derived:
  - <a id="COMM-18"></a> **COMM-18** **The card column.** Positions come from `coordsAtPos` on the rendered
    document, so zoom, a format change and the page chrome are already in
    them; cards are absolutely positioned inside the *scrolled content*, so
    scrolling costs nothing and nothing recomputes on scroll. Collision is
    pure arithmetic (`stack.ts`, tested): cards may not overlap, the focused
    card sits exactly at its anchor, its neighbours give way, and the top of
    the column outranks the anchor.
  - **COMM-19 — Withdrawn 2026-10-07.** Replaced by [COMM-59](#COMM-59): the
    highlight is the text the comment was made on when the script marks it,
    and the phrase before the comment only when it does not. The original
    wording is kept in
    [withdrawn requirements](../../engineering/withdrawn-requirements.md#COMM-19).
  - <a id="COMM-59"></a> **COMM-59** **The anchor highlight.** An inline decoration over the text the
    comment is about: the stretch it was made on when the script marks one
    ([COMM-61](#COMM-61)), else the phrase it follows (`model.ts anchorSpan`:
    back to the last clause ending, inside that text run, capped at 64
    characters). It sets a *background colour and nothing else* — no padding,
    no border, no metrics — so it cannot move a wrap. Clicking it reads that
    comment; clicking the card darkens it. The phrase is a reading of the
    text, stored nowhere: a comment typed as `[[ ]]`, made with nothing
    selected or left by another tool has a point to go on and no more.
  - <a id="COMM-20"></a> **COMM-20** **Three levels of emphasis, one class at a time**: hover a
    card or a panel row and its phrase lights *lightly*; the comment being
    read is brighter; hovering **Resolve** turns the phrase oxide, so the
    script itself says which comment the click would take. Deliberately not a
    strikethrough on the script — resolving removes the note, not the line it
    is attached to, and struck script text would say the writing is going.
    The card's own text IS struck, because that text is what disappears. A
    comment with no phrase to paint (one opening a block, one standing alone)
    carries all three on its marker instead — which is why a standalone
    comment's marker now hangs off its BLOCK's position: inside, it would be
    hidden along with the block that page view collapses.
  - <a id="COMM-21"></a> **COMM-21** **Room.** The sheet is centred, so the margin asks PlayEditor to hold
    desk clear on the right (`marginRight`) and the sheet shifts left. When
    the desk is short the column may borrow the page's own right margin —
    an inch of blank paper the script never prints into — but never the text
    column: a card never covers a word. Below ~168px of column the margin
    stands down entirely and the panel (docs/app/writing/comments.md#COMM-D5) is the surface.
- <a id="COMM-22"></a> **COMM-22** **Galley and page view show the same thing.** With the margin up the inline
  chip is hidden in BOTH (the card already carries those words) and the
  marker says *here*; with it down, the galley falls back to its amber chips.
- <a id="COMM-23"></a> **COMM-23** **Page view**: the note content stays hidden
  (`.pl-note { display: none; }` — wrapping identical to the engine), and a
  small **marker** at the anchor point carries the comment's presence: an
  absolutely-positioned chrome widget with auto offsets, so it renders at its
  static position while occupying zero flow space — it cannot move a wrap or
  a break by construction. It is what marks the comments a highlight can't:
  one that opens a block, one standing alone.
- <a id="COMM-24"></a> **COMM-24** **Markers are chrome, never content** — the same rule as page headers, the
  re-printed `(CONT'D)` cue, and tracked-changes decorations: widget/overlay
  presentation keyed to document positions, no document mutation, no
  second source of truth.
- <a id="COMM-25"></a> **COMM-25** **Standalone comments**: a block whose only content is
  comments gets a `pl-commentonly` node decoration; page view hides the
  whole block, matching the engine's skip (below). Its marker renders from
  the same anchor.
- <a id="COMM-26"></a> **COMM-26** **Engine**: both block builders (`blocksFromDoc` for PDF/scene-pages,
  `blocksFromPmDoc` for live pagination) skip a block with ≥1 note and
  no text outright; a genuinely empty block keeps its line (it is the
  caret's row while typing). engine.test.ts pins all three behaviors;
  css.test.ts pins the `pl-commentonly` rule.

<a id="COMM-D5"></a>

### The comment feed

<a id="COMM-27"></a>

**COMM-27** A **pane**, like the Board and Changes — not an overlay. Every comment in the
script, in script order, grouped under its scene, and clicking one goes to it.
Opened by ⌘⇧C or the element bar's `Comments (N)` chip, closed the same way,
and it survives a reload with the rest of the layout (`{ kind: "comments" }`
in panes.ts; pinned in panes.test.ts).

- <a id="COMM-28"></a> **COMM-28** Row: attribution chip · the text · under its act/scene heading. Click → the
  script scrolls to that comment, the caret lands on the phrase it annotates,
  and the comment becomes the one being read (its card and highlight light up).
- <a id="COMM-29"></a> **COMM-29** **Never jump to the note's own position.** Page view hides the note, and a
  hidden node has no coordinates — `coordsAtPos` answers 0 and the jump lands
  at the top of the script. `commentJumpTarget` returns the text the comment is
  *about* instead: the end of its highlighted phrase, else its block, else —
  for a standalone comment, whose whole block is hidden — the nearest block
  that isn't.
- <a id="COMM-30"></a> **COMM-30** Hovering a row lights its phrase in the script; hovering its ✓ marks what the
  click would take (docs/app/writing/comments.md#COMM-D4). Edit in place; **delete is resolve** — the trail lives
  in the history ring and the ledger, so a resolved comment needs no tombstone
  in the text.
- <a id="COMM-31"></a> **COMM-31** Filter: All · `todo:` · by author chip. A count on the bar's chip.
- <a id="COMM-32"></a> **COMM-32** Save and Cancel return keyboard focus to that comment's Edit control. Resolve
  moves it to the next surviving comment, or the feed's count heading when
  empty; an empty margin returns to the script. Every action announces its
  result and the remaining count. Runtime identities follow notes through
  editor transactions without adding identifiers to the Fountain file.
- <a id="COMM-33"></a> **COMM-33** Board and outline count chips are outside the current comments scope.

<a id="COMM-D6"></a>

### Writing a comment

- <a id="COMM-34"></a> **COMM-34** **Typing `[[`** opens a comment with the cursor
  inside; `]]` steps back out (an empty pair vanishes whole); Enter and
  Shift+Enter inside a comment insert a line break and can never produce the
  blank line that would end the note on reparse. The leader menu's Comment
  row (`n`) inserts the same node (one shared command, breaks.ts).
- **COMM-35 — Withdrawn 2026-10-07.** Replaced by [COMM-60](#COMM-60): a
  selection is what the comment is about, and no longer only where it is put.
  The original wording is kept in
  [withdrawn requirements](../../engineering/withdrawn-requirements.md#COMM-35).
- <a id="COMM-60"></a> **COMM-60** **Comment on the selection**: **⌘⌥M** and a `+ Comment` button in
  the element bar. The note lands immediately after the selection and its
  card opens for typing (⌘⏎ saves, Esc cancels and takes the empty note with
  it). The selected words are what the comment is about: the script marks
  them ([COMM-61](#COMM-61)) and the highlight paints them and nothing else,
  a word or three speeches. With nothing selected the comment is at a point,
  and its highlight is the phrase before it ([COMM-59](#COMM-59)). A
  selection of whole lines ends where the next line begins; the comment goes
  at the end of the last line selected, never in front of the next. The note
  is born with placeholder text because an empty inline node cannot hold the
  DOM caret (breaks.ts); the first save replaces it, and a save with nothing
  in it deletes the note.
- <a id="COMM-36"></a> **COMM-36** Autosave, undo, find, and the conflict floor need no changes — a comment
  is document text on every one of those paths. (Find already scopes by
  element; a "comments" scope falls out of the same mechanism.)

<a id="COMM-D7"></a>

### Scope limits

- **COMM-37 — Withdrawn 2026-10-06.** Threads and replies were out of scope while a
  script had one voice in its margin. A script traded with a reader, or read by
  a tool that leaves notes, has two, and the second needs answering where it
  spoke. Replaced by [COMM-50](#COMM-50), which keeps this requirement's one
  idea: a reply is an adjacent comment. The original wording is kept in
  [withdrawn requirements](../../engineering/withdrawn-requirements.md#COMM-37).
- <a id="COMM-58"></a> **COMM-58** **Stored thread structure.** A thread is read from where the
  comments sit ([COMM-50](#COMM-50)). No id, parent pointer or nesting is
  written into a note, so a reply answers the comment, never another reply.
- <a id="COMM-38"></a> **COMM-38** **Resolved-state flags.** Delete is resolve; anything else needs a home
  Fountain doesn't have and reintroduces the sidecar this spec rejected.
- **COMM-39 — Withdrawn 2026-10-07.** Range highlights were out of scope
  because Fountain cannot express one without markers another tool would
  display. A highlight that ran back to the last full stop, whatever the
  writer had selected, was the cost, and it was the wrong one to pay. Replaced
  by [COMM-61](#COMM-61) and the requirements beside it. The original wording
  is kept in
  [withdrawn requirements](../../engineering/withdrawn-requirements.md#COMM-39).
- <a id="COMM-40"></a> **COMM-40** **Colors / kinds** beyond the `todo:` filter. Convention can grow later
  without schema.
- <a id="COMM-41"></a> **COMM-41** **Dates in the text.** docs/app/writing/comments.md#COMM-D3.
- <a id="COMM-42"></a> **COMM-42** **Boneyard UI** (collapsed cut-text presentation) — real, separate, later.
- <a id="COMM-43"></a> **COMM-43** **An "export with comments" PDF.** Parked until wanted; the engine change
  is nil (notes are already stripped; an annotated export would be a second
  render mode, not a format change).

<a id="COMM-D10"></a>

### Replies

- <a id="COMM-50"></a> **COMM-50** **A reply is a comment directly after another.** A run of comments in one
  block with nothing between them but white space is one conversation: the
  first is the comment, the rest are its replies, in the order they stand.
  `She pauses [[Robin: too long?]][[Sam: it earns it]] at the door.` It is
  standard Fountain and nothing else is stored: another tool shows two notes
  side by side, and a hand edit that puts a note after a note has written a
  reply. White space is a space, or a line break between two notes on
  consecutive lines; a word between two comments is script, and the comment
  after it is about that word. A line holding nothing but a comment and its
  replies (`[[a]][[b]]`) is read as that many notes
  (docs/engineering/fountain-model.md#EDIT-172) and is still a line that
  prints nothing ([COMM-25](#COMM-25)).
- <a id="COMM-53"></a> **COMM-53** **One conversation, one of everything.** A comment and its replies share
  one card in the margin and one row in the feed, the replies under the comment
  with a rule between. They share one marker and one highlight, the comment's:
  a reply is about what its comment is about. And they count once: the bar's
  `Comments (N)`, the feed's heading, the inspector's "N in this scene" and
  every spoken "N comments remaining" count conversations. A to-do anywhere in
  a conversation makes it one for the filter and the scene's count, and a
  conversation is listed under an author when any part of it is theirs.
- <a id="COMM-54"></a> **COMM-54** **Replying.** Every comment has a **Reply** control on its card and its
  row. It opens a field under the last reply; ⌘⏎ saves, Esc cancels, and a
  reply saved empty is a reply cancelled. The reply is written directly after
  the last comment of the conversation. **⌘⌥M** and `+ Comment` at a place
  that already has a comment open that comment's reply field instead of
  adding a second comment in front of it: a note put there would become the
  head of the conversation and turn the comment into its reply.
- <a id="COMM-55"></a> **COMM-55** **Changing a conversation.** Each reply has its own Edit and Delete;
  the comment has Edit and Resolve. Resolve takes the comment and every reply
  under it, and its hover marks all of it ([COMM-20](#COMM-20)). A comment
  saved empty while it has replies is taken out alone, and the first reply is
  the comment from then on. After a reply is added, cancelled or deleted,
  keyboard focus returns to the conversation's Reply control; after a reply is
  edited, to that reply's Edit control. Each is announced, without the count,
  which a reply does not change.

<a id="COMM-D11"></a>

### Signing

- <a id="COMM-51"></a> **COMM-51** **Attribution is a leading `Name:` token, display-parsed only.**
  `[[Robin: is this earned?]]` · `[[Zoë: repeats the sc. 3 argument]]`. A
  letter to open, then up to 23 more of a name's characters (letters of any
  script and the marks that ride on them, digits, a space, `.`, `'` straight
  or curled, `-`), a colon, and white space before the body. The feed and the
  margin show the token as the comment's author; the source of truth remains
  the note text, verbatim, and a note with no token is simply unattributed.
  Never stored anywhere else, never required. A to-do keeps whose it is:
  `[[Robin: todo: verify tide times]]` is Robin's, and a to-do.
- <a id="COMM-52"></a> **COMM-52** **The writer's own name.** A comment made with ⌘⌥M or `+ Comment`, and
  every reply, is typed in a field headed by a **Your name** field. What is in
  it is the name the comment is signed with: the composer writes
  `Name: the comment` into the script, or the comment alone when the field is
  empty. The name is kept (`commentName` in `settings.json`,
  [SET-41](../preferences-and-help/settings.md#SET-41)) and fills the field
  the next time, so it is asked once, where the first comment is made, and can
  be changed in that field or in Settings › Writing. Only the composer signs:
  a note typed into the script as `[[ ]]` stays as typed, a comment that
  already opens with the same name is not signed twice, and editing a comment
  shows it as the script holds it, signature and all, so a name is corrected
  there with the words. The name is written nowhere but into a script, with a
  comment the writer makes.

<a id="COMM-D12"></a>

### Where a comment is typed, and copied

- <a id="COMM-56"></a> **COMM-56** **A new comment always has a field.** With room beside the page it is
  typed in its card ([COMM-60](#COMM-60)). Without room, which is the app's
  own window at its opening size, the margin has stood down
  ([COMM-21](#COMM-21)) and the comment is typed in the feed: the feed opens,
  in the inspector or as its pane, shows every comment whatever its filter
  said, and the new comment's field has the keyboard. The same goes for a
  reply asked for from the script ([COMM-54](#COMM-54)). Room is measured
  from the desk, before the first comment exists, so the first comment of a
  script goes to one surface and never to both. A comment abandoned with Esc
  leaves nothing in the script and puts the keyboard back in it.
- <a id="COMM-57"></a> **COMM-57** **A comment's words can be selected and copied**, in the card and in
  the feed: a drag across them or a double-click selects, and ⌘C copies. A
  press that selects nothing does what it did before. On a card it reads the
  comment and leaves the caret where it was in the script. In the feed it
  goes to the comment ([COMM-28](#COMM-28)), and the row's **Show in the
  script** control does the same from the keyboard, since the words are text
  now and no longer a button.

<a id="COMM-D13"></a>

### What a comment is about

- <a id="COMM-61"></a> **COMM-61** **A stretch of text is fenced by two marker notes.** Fountain has no
  way to say "from here to there", so the script says it with two more notes:
  `[[{]]` directly before the first word of the stretch, and `[[}]]` directly
  before the comment.
  `She pauses [[{]]at the door[[}]][[Robin: too long?]] and turns.` Both are
  standard notes. No conforming tool prints them, and another editor shows
  them as two short notes beside the comment, which is the whole cost. A `}`
  closes the nearest `{` before it that nothing has closed, as brackets do,
  so one stretch may lie inside another. Two that overlap without one holding
  the other cannot be told apart that way, and one of them carries a number on
  both its markers, `[[{1]]` … `[[}1]]`, which finds its own whatever stands
  between. The app writes a number only where the script would otherwise be
  read back wrong, and reads any it finds.
- <a id="COMM-62"></a> **COMM-62** **The stretch is the writer's text, and follows what they do to
  it.** The editor holds no marker. There the stretch is a mark on its words
  (`commentRange`) and one on its comment (`commentRangeEnd`), with one id
  between them, written as the two notes when the script is saved and read
  from them when it is opened (`ranges.ts`): a hidden note in the middle of a
  sentence is a place a caret is lost in and a thing a deletion takes half
  of. A word typed inside the stretch or at its
  end is part of it; one typed in front of it, or after its comment, is not.
  Words typed over the whole of it are the stretch. Deleting its first words
  leaves it beginning at what is left, and a line split inside it leaves it
  running across the two. Deleting every word of it leaves the comment at a
  point; deleting the comment leaves the words unmarked. Either way nothing
  of it stays in the script, and undo puts all of it back. Resolve takes the
  markers with the comment. When a comment is taken out and its first reply
  becomes the comment ([COMM-55](#COMM-55)), the stretch is the reply's. A
  stretch copied with its comment is a second stretch, and words copied
  without the comment are plain words.
- <a id="COMM-63"></a> **COMM-63** **No marker stands in a cue or a heading.** A cue, a scene heading
  and an act or scene label are names the app reads: who speaks, where a
  scene begins. A selection that begins in one starts its stretch at the
  first word after it, and a comment that lands in one has no stretch and is
  a comment at a point. A cue or a heading between the two ends of a stretch
  is highlighted with the rest of it.
- <a id="COMM-64"></a> **COMM-64** **A marker is never a comment.** Like a scene anchor it is
  machinery: not counted, not listed, not shown as a chip and not read as a
  reply or as the thing between two, in the script, the feed, the inspector
  or the margin. Changes reads two versions On the Page without them, so
  marking a stretch is no change to the words; Line by Line shows the file's
  own lines, markers and all. A pair the app would not have written marks
  nothing: a `{` with no `}`, a `}` with no comment directly after it, a `{`
  with no word directly after it, or either of them in a cue or a heading.
  Both notes stay hidden, and are written back exactly as they were read.

<a id="COMM-D14"></a>

### A comment on a cue or a heading

Decided 2026-10-07. A cue, an act or scene title and a scene heading are names
the app reads, and a comment may stand on one all the same: a reader asks
whether a character should be renamed, or whether a scene is in the right
room. A comment on a cue did not survive a reopen, and one on a heading was
never shown.

- <a id="COMM-66"></a> **COMM-66** **It is a comment like any other, and it is shown.** A comment on
  a cue, an act or scene title or a scene heading has a card in the margin, a
  row in the feed, a marker and a highlight, and it counts, whether it was
  made there with ⌘⌥M or `+ Comment`, typed as `[[ ]]`, or left by another
  tool. It is listed under the heading it stands on: a comment on a scene's
  title belongs to that scene, and one on an act's title to that act and to no
  scene. It can be answered, edited and resolved as any comment can. Comments
  on headings used not to be collected, so one made there went into the
  script and onto no surface, with no card to type it in; that was an
  omission, never a choice, and a comment nobody can see is the one outcome
  this feature may not produce ([COMM-46](#COMM-46)). It has no stretch
  ([COMM-63](#COMM-63)).
- <a id="COMM-69"></a> **COMM-69** **Its highlight is the name in front of it.** On a cue or a
  heading the highlight paints all of the name's text that stands directly
  before the comment (`model.ts nameSpan`). The phrase rule
  ([COMM-59](#COMM-59)) ends a phrase at a full stop, and a name is not a
  sentence: it painted `SMITH` for a comment on `MR. SMITH`, and `KITCHEN`
  for one on `INT. KITCHEN`.
- <a id="COMM-67"></a> **COMM-67** **A line is read without its comments.** Whatever reads a line
  for what it says reads the text typed on it (`own-text.ts`) and never the
  text of a comment standing on it. That is who speaks, in Find's speaker
  scope and its list of speakers and in the names the cue autocomplete
  offers; which act and scene a comment is listed under; and whether a line
  in capitals is a name when Enter is pressed on it. A cue of `MARA` with a
  comment on it was a speaker called `MARAROBIN: RENAME?`, and a heading with
  one headed the comments under it with the comment's own words. The
  inspector matched that label against the scene's title and counted none of
  the scene's comments; it reads no heading now ([COMM-70](#COMM-70)). The
  cue autocomplete completes the name's own letters, counts the
  caret in them, and never takes a comment: one in front of the name or after
  it stays where it was, and a name with a comment inside it is offered no
  suggestion, since the letters a suggestion replaces would take the comment
  with them. What reads the script and not the page (the Cast, part sizes,
  sides, the outline, the layout engine) reads text and has always left notes
  out.
- <a id="COMM-68"></a> **COMM-68** **It is kept in the script on the name's own line, and the line
  is still the name.** A cue that holds a comment is written forced,
  `@MARA[[Robin: rename?]]`: a note in lower case makes a name in capitals a
  stage direction to any Fountain reader, and that is how the cue and the
  speech under it came back as one stage direction. The comment may stand
  before the name, inside it or after it, and may hold brackets, a caret or a
  line break; a heading's may too. A comment in front of a cue's extension is
  with the name, `@MARA[[Robin: rename?]] (V.O.)`. One after the extension or
  inside it keeps the bracket in the cue's text,
  `@MARA (V.O.)[[Robin: rename?]]`, and the cue prints and is counted as it
  would with no comment. The rules are
  [docs/engineering/fountain-model.md#EDIT-174](../../engineering/fountain-model.md#EDIT-174).
  A script saved before this with a comment on a cue holds the cue with no
  `@`, and is read as it was read then, as one stage direction: a line in
  capitals with a note in lower case may be exactly that, so the app does not
  guess. Nothing in such a line is lost, and it is put right by making it a
  Character line and a speech again.

<a id="COMM-D15"></a>

### Which scene a comment is in

Decided 2026-10-07. Two surfaces say where a comment is, and they answer
different questions. The feed is a list to read down, and its headings say
what each comment stands under. The inspector describes one scene of the
outline and says how many comments are in it. Both used one reading, the
nearest heading above the comment, matched by its text, and the inspector's
number was wrong wherever that heading was not the outline's scene or was
not the only one with that text.

- <a id="COMM-70"></a> **COMM-70** **The inspector counts the comments standing in its scene.** The
  scene is the outline's
  ([docs/app/organizing/workspace-model.md#WORK-D104](../organizing/workspace-model.md#WORK-D104)):
  a `##` scene title begins one when the script has any, and a scene heading
  begins one only when it has none. It runs from the line it begins at to the
  line the next scene begins at, and "N in this scene" is the conversations
  standing in that stretch, one on the scene's own first line among them. No
  heading's text is read. That stretch is where the caret is while the
  inspector shows the scene, so a comment is counted for the scene the
  inspector shows with the caret on it, and for that one alone. The count
  used to take the comments whose listed heading had the scene's title. In a
  script with both kinds of heading a comment under a scene heading was then
  counted for no scene, and two scenes with one title each counted the
  comments of both, which every play in two acts met in its two `SCENE 1`s.
  The stretch is the outline's as it stands: it takes in the title of the act
  that follows the scene, and anything between that title and the act's first
  scene, as the scene's pages and its speakers already do. The feed lists
  such a comment under the act ([COMM-66](#COMM-66)); the inspector's number
  is about a stretch of the script, not about a heading. A comment before the
  first scene is in no scene, and a script with no scene line of either kind
  has no scene to count for.
- <a id="COMM-71"></a> **COMM-71** **The feed lists a comment under the nearest heading above it,
  and a heading is a line, not its text.** A group is headed with the act and
  the nearest scene title or scene heading since that act's title, whichever
  of the two is nearer; under an act's title and before any scene line it is
  headed with the act alone, and before every heading with `Front of script`.
  In a script with both kinds of heading this is finer than the outline: a
  titled scene with two scene headings in it has its comments in up to three
  groups, and the inspector's number for the scene is the rows of all of
  them. The list is for finding a comment, and the nearest heading is the
  line the writer sees above it in the script; the outline's scene is the
  inspector's business. Two headings that read alike are two groups with one
  label: two scenes with one title, or two scenes in one room whose scene
  headings both say `The same. Later.` Grouped by the label's words they were
  one group, and the comments of two scenes read as one scene's.

<a id="COMM-D16"></a>

### A comment that holds a line break

Decided 2026-10-07. Enter in a comment makes a line break
([COMM-15](#COMM-15)), so a comment of two lines is an ordinary one. In the
script its second line is a line like any other to whatever reads the file a
line at a time, and that is where it did damage.

- <a id="COMM-72"></a> **COMM-72** **The line it stands on stays what it is.** A comment may hold
  line breaks on any line: a stage direction, a speech, a parenthetical, a
  lyric, a transition, a centered line, a synopsis, a cue, a heading, or a
  line of its own. The line is read back as what it was, with the comment
  whole and its words as they were typed:
  `> BLACKOUT.[[Sam: or⏎fade]]` is a transition with a comment. It used to
  come back as a stage direction, as a centered line and a synopsis did; a
  parenthetical became part of the speech; a comment in a speech whose second
  line was in brackets was cut in three, with a parenthetical in the middle;
  and a comment on a line of its own whose first line was in capitals became a
  character and a speech. A second line that opened with `!` lost it, one that
  opened with a tab got spaces, and one that was indented lost its indent. A
  transition that holds a comment is written with its `>`, and a comment's
  own lines in a lyric with the lyric's `~`, which is taken off again when the
  script is read. The rules are
  [docs/engineering/fountain-model.md#EDIT-180](../../engineering/fountain-model.md#EDIT-180).
- <a id="COMM-73"></a> **COMM-73** **It reads with its line breaks.** The card, the feed and the field
  that edits a comment show it as the script holds it, a line to a line
  (`own-text.ts commentText`). On the page a line break is not a character,
  and the comment's text was taken without it: after the script had been
  opened again `[[Sam: one⏎two]]` read `Sam: onetwo`, and an edit saved it so.
  A comment saved from its field goes onto the page with its line breaks as
  the page holds them (`actions.ts commentContent`), so the page after a save
  is the page the script would be read back as, and a script changed on disk
  finds nothing to put right in a comment nobody touched.
- <a id="COMM-74"></a> **COMM-74** **It holds no blank line.** A blank line ends a block in the script,
  and would cut the comment and its line in two. The composer takes blank
  lines out of a comment when it is saved, and a line of spaces is a blank
  line ([COMM-15](#COMM-15)). One that gets in another way, by Enter, a
  space and Enter in a comment typed in the script, is written as Fountain's
  line of two spaces, which keeps the comment one note, and a comment another
  tool wrote that way is read with that line in it.

<a id="COMM-D9"></a>

### Rendering and editing safeguards

| Risk | Mitigation | Requirement |
|---|---| --- |
| Markers drift from anchors under zoom/resize | They can't: markers and highlights are ProseMirror decorations IN the text flow (the marker absolutely positioned with auto offsets), so the browser places them — no measured coordinates to go stale. | <a id="COMM-44"></a>COMM-44 |
| Margin cards drift from their anchors | They are measured, so they can: the answer is to re-measure on everything that moves the page — every transaction (the pagination pass arrives as one), a resize of the surface or the sheet, the window, and font load — coalesced into one rAF. Nothing measures on scroll, because the cards live inside the scrolled content. | <a id="COMM-45"></a>COMM-45 |
| Cards vanish while their highlights stay | `sameSpots` in stack.ts checks keys before values and is pinned by that exact case. A comment that cannot be measured is placed under the one before it rather than dropped: invisible is the one outcome this surface may not produce. | <a id="COMM-46"></a>COMM-46 |
| A comment-dense page overwhelms the margin | `stack.ts` guarantees no overlap and the reading order; the panel is still the dense list, and ⌘⇧C swaps to it. | <a id="COMM-47"></a>COMM-47 |
| A naive replace-all edits comment text | Find's element scoping already exists; exclude comments from replace by default, mirroring the cue-rename guard, which holds cue matches back from replace so a character is never half-renamed. | <a id="COMM-48"></a>COMM-48 |
| Words selected up to a comment are typed over, and the hidden comment goes with them | The marker is drawn past the caret, so a caret or a selection that ends at a comment ends in the words before it. Drawn before the caret, it left the selection's end between the marker and the hidden comment, and both engines took the comment out with the words. Smoke types over a commented stretch in each engine and reads the comment back. | <a id="COMM-65"></a>COMM-65 |
| The `[[` chip surprises a writer who meant literal brackets | Galley chip + margin marker make the state visible; undo reverses the input rule as one step, and literal `[[` is a case no play has hit. | <a id="COMM-49"></a>COMM-49 |

## Design

Fountain `note` nodes are the sole stored comment content. `src/comments/model.ts` derives attribution, signing, filtering, point anchors, a nearby phrase highlight and which comments form a conversation; runtime identity tracks transactions without adding stored ids. `stack.ts` lays out the card column.

`ranges.ts` is the one place the text a comment is about changes form: two marker notes in the script, a mark in the editor. The editor's bridge calls it in both directions, so everything that reads the script (the layout engine, export, the scene inspector) sees notes, and everything on the page sees a mark. The plugin reads a range as the first text carrying its id and the first comment carrying it, which is the reading the script is written from, and takes the marks of a range that has lost either off the page in the step that lost it.

`plugin.ts` collects the comments of the live document and groups them into threads; markers, highlights, emphasis and the count are per thread. The margin and the feed draw a thread with one component (`Thread.tsx`), hold what the writer is in the middle of in one hook (`use-thread-editing.ts`) and change the document through one set of transactions (`actions.ts`), so the two surfaces cannot come to treat a comment differently. The margin measures whether it has room and says so in the extension's storage; that one fact decides which surface types a new comment.

A cue and a heading are lines like the rest to the plugin: their comments are collected, and the act and scene a comment is listed under are read from the heading's own text. `own-text.ts` is that reading for the editor's nodes, and everything on the page that asks what a line says goes through it. In the script, `src/fountain/note-breaks.ts` holds every comment's line breaks back from the tokenizer and `src/fountain/name-notes.ts` the notes on a forced cue, and each puts back what it held as written, so a comment cannot change what its line is. `own-text.ts` also reads a comment's own text for the page, line breaks and all.

Where a comment is has two readings, kept apart. The plugin records the heading each comment is listed under and where that heading stands, and `groups.ts` makes the feed's groups from the position, never from the words. The inspector's count is `src/app/scene-comments.ts`: the threads standing between two scene starts, which `src/editor/scene-starts.ts` finds by the outline's rule and the caret's scene is read from too. It lives with the app because it joins the editor's reading of scenes to this feature, and neither imports the other for it.

ProseMirror decorations supply highlights and markers without altering measured text; both paginator block builders exclude note-only blocks. Find and Replace treat comments as a protected scope. The round-trip, thread, layout, focus and smoke checks verify these boundaries.
