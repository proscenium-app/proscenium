# Comments

[Writing](README.md) › Comments

Comments stay with the script. This contract defines their source representation, presentation, feed and editing behavior.

[Annotations](#COMM-D1) · [Rendering](#COMM-D4) · [Comment feed](#COMM-D5) · [Writing a comment](#COMM-D6)

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
- <a id="COMM-12"></a> **COMM-12** **Attribution is a leading `Name:` token, display-parsed only.**
  `[[Robin: is this earned?]]` · `[[Sam: repeats the sc. 3 argument]]`.
  Pattern: `^\s*([A-Za-z][A-Za-z0-9 .'-]{0,23}):\s`. The panel and margin
  bubble render the token as a chip; the source of truth remains the note
  text, verbatim, and a note with no token is simply unattributed. Never
  stored anywhere else, never required.
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
  - <a id="COMM-19"></a> **COMM-19** **The anchor highlight.** An inline decoration over the phrase the
    comment follows (`model.ts anchorSpan`: back to the last clause ending,
    inside that text run, capped at 64 characters). It sets a *background
    colour and nothing else* — no padding, no border, no metrics — so it
    cannot move a wrap. Clicking it reads that comment; clicking the card
    darkens it. This is presentation, not a stored range: docs/app/writing/comments.md#COMM-D7 still holds.
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
- <a id="COMM-35"></a> **COMM-35** **Comment on the selection**: **⌘⌥M** — Docs' key —
  and a `+ Comment` button in the element bar. The note lands immediately
  after the selection and its card opens in the margin for typing (⌘⏎ saves,
  Esc cancels and takes the empty note with it). Honesty about anchoring: a
  Fountain note anchors at a *point*, so "comment on this phrase" means "the
  comment sits immediately after the phrase" — a selection is a placement
  gesture, not a persisted range, and what the highlight then paints is
  derived from the text, not from what was selected (docs/app/writing/comments.md#COMM-D4, docs/app/writing/comments.md#COMM-D7). The note is
  born with placeholder text because an empty inline node cannot hold the
  DOM caret (breaks.ts); the first save replaces it, and a save with nothing
  in it deletes the note.
- <a id="COMM-36"></a> **COMM-36** Autosave, undo, find, and the conflict floor need no changes — a comment
  is document text on every one of those paths. (Find already scopes by
  element; a "comments" scope falls out of the same mechanism.)

<a id="COMM-D7"></a>

### Scope limits

- <a id="COMM-37"></a> **COMM-37** **Threads / replies.** A reply in the margin is an adjacent comment.
  Revisit only with real multi-human collaboration, which is itself out of
  scope.
- <a id="COMM-38"></a> **COMM-38** **Resolved-state flags.** Delete is resolve; anything else needs a home
  Fountain doesn't have and reintroduces the sidecar this spec rejected.
- <a id="COMM-39"></a> **COMM-39** **Range highlights.** Not expressible in Fountain without inventing
  markers other tools would print or display. Point anchors only — the
  margin's highlight (docs/app/writing/comments.md#COMM-D4) is *derived* from the phrase before the note on
  every render, and a different tool, a hand edit, or a re-parse changes
  what it paints without changing a byte. Nothing stores a range.
- <a id="COMM-40"></a> **COMM-40** **Colors / kinds** beyond the `todo:` filter. Convention can grow later
  without schema.
- <a id="COMM-41"></a> **COMM-41** **Dates in the text.** docs/app/writing/comments.md#COMM-D3.
- <a id="COMM-42"></a> **COMM-42** **Boneyard UI** (collapsed cut-text presentation) — real, separate, later.
- <a id="COMM-43"></a> **COMM-43** **An "export with comments" PDF.** Parked until wanted; the engine change
  is nil (notes are already stripped; an annotated export would be a second
  render mode, not a format change).

<a id="COMM-D9"></a>

### Rendering and editing safeguards

| Risk | Mitigation | Requirement |
|---|---| --- |
| Markers drift from anchors under zoom/resize | They can't: markers and highlights are ProseMirror decorations IN the text flow (the marker absolutely positioned with auto offsets), so the browser places them — no measured coordinates to go stale. | <a id="COMM-44"></a>COMM-44 |
| Margin cards drift from their anchors | They are measured, so they can: the answer is to re-measure on everything that moves the page — every transaction (the pagination pass arrives as one), a resize of the surface or the sheet, the window, and font load — coalesced into one rAF. Nothing measures on scroll, because the cards live inside the scrolled content. | <a id="COMM-45"></a>COMM-45 |
| Cards vanish while their highlights stay | `sameSpots` in stack.ts checks keys before values and is pinned by that exact case. A comment that cannot be measured is placed under the one before it rather than dropped: invisible is the one outcome this surface may not produce. | <a id="COMM-46"></a>COMM-46 |
| A comment-dense page overwhelms the margin | `stack.ts` guarantees no overlap and the reading order; the panel is still the dense list, and ⌘⇧C swaps to it. | <a id="COMM-47"></a>COMM-47 |
| A naive replace-all edits comment text | Find's element scoping already exists; exclude comments from replace by default, mirroring the cue-rename guard, which holds cue matches back from replace so a character is never half-renamed. | <a id="COMM-48"></a>COMM-48 |
| The `[[` chip surprises a writer who meant literal brackets | Galley chip + margin marker make the state visible; undo reverses the input rule as one step, and literal `[[` is a case no play has hit. | <a id="COMM-49"></a>COMM-49 |

## Design

Fountain `note` nodes are the sole stored comment content. `src/comments/model.ts` derives attribution, filtering, point anchors and a nearby phrase highlight; runtime identity tracks transactions without adding stored ids. `stack.ts` lays out the card column.

The margin and feed share the editor commands. ProseMirror decorations supply highlights and markers without altering measured text; both paginator block builders exclude note-only blocks. Find and Replace treat comments as a protected scope. The existing round-trip, layout, focus and smoke checks verify these boundaries.
