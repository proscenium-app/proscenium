# Tutorials

[Preferences and help](README.md) › Guided tutorials

Tutorials provide optional practice beside the real editor. This is the full intended experience and acceptance contract.

[Experience](#TUT-D1) · [Entry and return](#TUT-D2) · [Practice safety](#TUT-D6) · [Acceptance](#TUT-D11)

## Requirements

### Tutorial boundaries

- <a id="TUT-1"></a> **TUT-1** Tutorials are optional, skippable and reachable again through Help.
- <a id="TUT-2"></a> **TUT-2** Practice uses the real editor and controls in a clearly marked practice play.
- **TUT-3 — Withdrawn 2026-09-22.** Replaced by [TUT-8](#TUT-8): the guide no longer stays in a panel beside the writing. The original wording is kept in [withdrawn requirements](../../engineering/withdrawn-requirements.md#TUT-3).
- <a id="TUT-4"></a> **TUT-4** The first two steps produce a speaker name and a formatted line of dialogue.
- <a id="TUT-5"></a> **TUT-5** Practice uses ordinary guarded writes, recovery and Versions in app data; it does not replace personal launch preferences.
- <a id="TUT-6"></a> **TUT-6** Tutorial progress is separate from script text; replay retains earlier practice attempts.
- <a id="TUT-7"></a> **TUT-7** No AI, account, internet connection or writing assessment is required.
- <a id="TUT-8"></a> **TUT-8** The guide appears at the work: one card beside the control to choose or the line to type on, pointing at it, with the text to type shown faintly in that line and the key that finishes it. The card never covers its target and never takes focus by itself. There is no separate panel of instructions.
- <a id="TUT-9"></a> **TUT-9** Each step reads its result from the play and the window, however the writer produced it. When the result appears the guide says so and moves on by itself after a short pause; a result already there, a demonstration and an observe step wait for Next. A recognizable wrong turn is named where it happened, with a one-action repair where the repair is certain. Nothing grades the writer's words.
- <a id="TUT-10"></a> **TUT-10** All lessons write one practice play, in course order. Each lesson begins where the previous one left that play; a lesson opened out of order is supplied, in the same play, with what the earlier lessons would have left. Stop and Continue return to the same play and step. Start Over begins a new practice play and keeps the old one.

## Design

<a id="TUT-D100"></a>

### Guided tutorials

The brief: a friendly, enjoyable, easy experience for people with very
different levels of computer confidence. Easy to skip, easy to find again,
optional deeper lessons, and guidance throughout. The earlier request for a
“really succinct tutorial” still governs the first lesson.

<a id="TUT-D1"></a>

#### 1. The experience

**A short guided rehearsal in the real app.** The writer makes a small exchange
in a clearly marked practice play. They use the actual editor and controls,
see the page format their words, and learn where help lives. The guide is not
a text to read: a small card sits beside the one thing to do next, and the
page itself shows where to type and what. Everything is optional.

The first useful result is a speaker's name followed by a formatted line of
dialogue. Reach that in the first two steps. A writer should leave the first
lesson knowing how to start, change a line's type, recognize a saved edit, and
get the guide back. Organization and advanced formatting can wait.

There is one route with adjustable help, not separate “beginner” and “expert”
versions. Computer confidence and knowledge of playwriting are different.
Never ask people to rate themselves. Experienced writers can choose a topic,
skip a step, or leave immediately; someone unfamiliar with software sees the
target, the words to type and the key to press, and can ask for more help or a
demonstration at every step.

**One play, written by the whole course** ([TUT-10](#TUT-10)). The six lessons
are chapters of the same practice play: the first names two speakers and gives
them lines; the second formats that exchange; the third adds a scene and orders
the scenes; the fourth makes the Characters page and the opening notes; the
fifth adds a note to the play; the sixth prepares its PDF. Finishing a lesson
offers the next, which starts exactly where the play was left.

This teaches **how to use Proscenium**. The optional creative-process guide for
a first draft is parked and remains separate. No story formula, writing assessment,
AI assistant, generated dialogue, account, or internet connection is required.
Example dialogue is bundled teaching material; the writer can use their own.

<a id="TUT-D2"></a>

#### 2. Entry, skip, and return

<a id="TUT-D101"></a>

##### First invitation

Keep the existing Welcome question, “Where should your plays live?” and its
folder choices. Do not add a setup wizard or require a tutorial to create a
play. After the folder has opened, offer one compact, nonmodal invitation on
the Plays screen, alongside the ordinary New Play action:

> **Try a short guided start**
>
> Write a few lines in a practice play. The guide shows you where, one step at a
> time.
>
> **Try the Tutorial** · **See All Tutorials** · **Skip for Now**
>
> You can return anytime from Help & Tutorials.

Starting is the only action that creates a practice play. Skipping does not
create files. New Play remains equally easy to reach.

- Wait for `ws.booted`, authoritative settings, folder discovery, and any
  pending recovery or folder-choice question. Never record a transient mount
  of Welcome as an invitation seen. Keep privacy notices independent and let
  them settle before adding another announcement.
- Record the invitation only after it has actually painted in a visible,
  foreground window. Offer it once per installation, including one visit on
  an upgrade, only on the Plays screen. Never interrupt a restored script.
- Starting, skipping, choosing another task, or leaving the screen ends this
  invitation. An unchanged invitation does not reappear on the next launch.
- Do not infer completion from an existing sample play or the old
  `proscenium:sawFirstRun` flag. That flag says only that a hint was dismissed.

<a id="TUT-D102"></a>

##### Permanent ways back

**Help & Tutorials** in the window toolbar is the canonical entry, available
with or without a play open, and Settings › Help & Feedback opens the same
sheet. It is a sheet you open, choose from and leave: it teaches nothing
itself, and opening it changes no play. It shows, in order:

- **Continue: Format the Script · Step 2 of 4** when a lesson is paused, or
  **Start:** the next lesson not yet finished — in the practice play, where
  the last lesson left it.
- The six lessons, numbered in course order, each with its status: about how
  long, **Step 3 of 5**, **Done**, or **Finished · 1 Step Skipped**.
- **Saved Practice**, **Start Over in a New Play**, **Keep as a Play…** while
  practicing, **Reset Progress…**, and **Return to My Play** while practicing.
- **Keyboard Shortcuts** and **Send Feedback…**, as reference.

A lesson row expands to its one-sentence outcome, **Continue** when paused,
**Start Tutorial** or **Start Again**, and its steps. Any step can be chosen;
what it builds on is supplied in the same play (§5). No unlocks: the course
has an order, not a gate.

Finished lessons say **Done** and remain replayable. Skipped steps are recorded
as skipped, not falsely shown as learned, with no warning, score, or pressure to
fix them. No overall completion percentage, streaks, or notifications about
unfinished lessons. Dismissing a tutorial never dismisses unrelated notices.

<a id="TUT-D3"></a>

#### 3. The guide is at the work

<a id="TUT-D103"></a>

##### One card, beside its target

The guide is one small card ([TUT-8](#TUT-8)), 300 points wide at most, placed
beside the step's target with an arrow pointing at it. The target is the
actual thing to act on: the empty line under the scene heading, the line-type
menu, a row in an open menu, the Board's New Scene card, a field in the Export
sheet, the save indicator. A ring outlines a control target; a script line is
lit in place instead.

- **Where to type, and how.** For a typing step the line itself is lit, the
  suggested words appear faintly where the letters will go (`MARA`), and the
  key that finishes the line follows as a key cap (**⏎ Return**). As the
  writer types the suggestion, the rest of it stays; their own words replace
  it. The suggestion is decoration only: it never enters the play, the undo
  history or a file, and it is hidden from assistive technology, which hears
  the card's sentence instead.
- **Never over the target.** The card tries below, above, right and left of the
  target and takes the first side where it fits on screen without covering the
  target or the menu a target row sits in. A line's whole extent stays clear,
  and a line too near the window's edge is scrolled to the middle first so the
  card has room. When nothing fits it stays on screen on the roomiest side.
  The line being written stays in view as the play grows: when a page added
  above it (the Characters page, with the first cue) pushes it out of the
  window, it comes back to the middle, with the lines before it.
- **Brought into view top first.** When a step starts pointing at a control or
  a page that its pane does not show whole, the pane scrolls once to show it.
  What a pane shows is its box less the chrome that sticks over it: a note's
  header and format bar are the note pane's scroll padding, so whatever is
  scrolled in there comes to rest below them, never behind them. A target
  taller than that, a note's page in a short window, is brought in by its top,
  and left where it is when its top already shows. The top is where the writer
  starts; bringing the page's bottom in instead put a new note's first line
  under its format bar, and left no side of the page for the card.
- **What it holds.** A **Practice** label; the lesson and **2 of 5**, which opens
  the step list (every step, with done, shown or skipped; All Tutorials…; Keep
  as a Play…; Stop Tutorial); a **×** named Stop Tutorial; one sentence with the
  control's visible name, the words to type and key caps; then the actions:
  a Fix when there is one, **Next** or **Finish** when the step waits for it,
  and **Show Me**, **Skip Step** and **More Help**.
- **Menus and sheets.** When the target is inside an open menu the card sits
  beside the menu. When a sheet is the step's target (Export PDF, Opening
  Pages) the card lives inside that sheet's accessible scope, so a keyboard
  and a screen reader reach it; any other sheet hides the card until it closes.
  Before a system Save or Print dialog, the card has already said what it does
  and that Cancel comes back; nothing is drawn over native dialogs.
- **When the target is not on screen** (the writer switched views) the step's
  sentence leads back — “Choose Board to come back to this step” — and a card
  with no target shows **Take Me There**.

The card is a named nonmodal region, `aside` “Tutorial”. It owns no keys while
the writer types and never takes focus by itself. Its step list is the shared
Menu; the layer rules apply.

<a id="TUT-D104"></a>

##### Moving through a step

- **Instruction as a sequence.** A step with two actions says the next one when
  the first is done: open the line-type menu → choose Character → type IVO →
  press Return. Base copy is one short sentence. **More Help** adds the longer
  explanation in the card and stays open as the writer moves on until they
  close it.
- **Result, not gesture** ([TUT-9](#TUT-9)). Each step reads the play and the
  window, counted against the moment the step began, so the lesson notices a
  new cue, a speech, a moved card, a tag, a format — however they were made.
  Pointer, keyboard, paste, dictation and menus count equally. Prose,
  capitalization of free text, spelling and speed are never graded.
- **It says so, then moves on.** When the result is there the card turns to a
  check and says what happened (“That's a character cue: MARA”). After a short
  pause — and only once the practice has saved — the guide moves to the next
  step by itself. For a speech that may still be growing, the pause is a pause
  in the typing. Moving on never moves focus: the writer keeps typing where
  they were, and the card simply moves to the next place.
- **What waits for Next.** A result already there when the step began, the
  result of a Show Me, and the two observe steps (the save indicator, the
  export preview) wait for **Next** or **Finish**. A step whose result was
  reached before (Continue after a stop, a step chosen again) says so and
  offers Next, or doing it again.
- **Wrong turns, named where they happened.** A name typed in lowercase is
  noticed as it is typed; after Return it is shown at its line as having
  become a stage direction, with **Make It a Name**. A speech whose type was
  changed gets **Make It Dialogue**; the wrong row chosen in the line-type menu
  is named; Return pressed where a Line Break was meant offers **Undo That**;
  a page number that is not in the script is named in the Export sheet. A fix
  makes the result the step wanted, in the practice, and only then does the
  guide move on.
- **Show Me** performs the step in place, in the practice play, through the same
  edits the writer would make: it adds or converts and never removes a word
  they wrote. The step then waits for Next and records the step as shown.
- **Skip Step** always works, including when detection has failed. When later
  steps build on the skipped result (the first lesson's cue, speech and second
  cue; a new scene; a new document), Skip performs it so nothing is left
  impossible, and records the step as skipped.
- **Back** is the step list: choosing an earlier step revisits it. It never
  undoes writing.

<a id="TUT-D105"></a>

##### Leaving and coming back

**Stop Tutorial** (the card's ×, its step list, or Escape with focus in the
card and no higher layer) is one action with no “Are you sure?” prompt. It
pauses at the current step, keeps the practice, and restores the previous play,
pane arrangement, selection and scroll position when that destination is still
available; otherwise it returns to Plays with a plain explanation. The keyboard
goes back once that place is on screen: in a play, to the writing in the focused
pane at the restored selection, where ⌃⇥ lands in the play; on Plays, to its
heading; on Welcome, to its first choice. A field the writer went into while the
play came back keeps the keyboard.

**Continue** reopens the same practice play at the same step and changes
nothing in it: it restores the view the step happens in and leaves the
writer's words and cursor as they were ([TUT-10](#TUT-10)).

Switching to another real play pauses the lesson automatically. Opening a sheet
the lesson does not use hides the card until it closes. Closing the app uses
normal save/recovery safeguards and retains the tutorial's place. On the next
launch, honor the writer's normal launch preference; resume only when they
choose Continue from Help & Tutorials.

Stopping never discards a dirty buffer or bypasses a save failure; unresolved
writing stays protected by the normal recovery flow. A save warning, a newer
practice file or a read-only practice holds the step with a plain sentence and
Stop still works.

<a id="TUT-D4"></a>

#### 4. The first lesson: Write Your First Exchange

**Outcome:** a short exchange between two characters, saved in the practice play.
**Target duration:** 3–5 minutes with help; faster users can skip or jump.

On starting, the regular editor shows the practice play (title **Practice
Play**) with a scene heading and an empty line lit under it, the cursor on that
line and the card beside it. Use the bundled default format, with the writer's
own interface text size, accent, and accessibility preferences. Do not run the
existing FirstRunCard over the guide. The card's **Practice** label stays
throughout.

| Step | What the page and card show | Done, and the wrong turns it names |
| --- | --- | --- |
| **1. Name the speaker** | The empty line lit, `MARA` faint on it and **⏎ Return** after; card: “Type MARA, then press Return.” While typing: “Now press Return.” | A new cue with a Dialogue line under it, any name. Lowercase while typing: “A speaker's name is typed in capitals” with **Use Capitals**. Lowercase then Return: “became a stage direction” at that line, with **Make It a Name**. The element menu (Return or Tab on the empty line) and the line-type menu are followed to Character. |
| **2. Give them a line** | The speech line lit with “You're early.” faint and **⏎ Return**. | A spoken line followed by the next line. Return on the empty speech opens a menu: the card says Escape and type first. A speech whose type changed gets **Make It Dialogue**. |
| **3. Choose the next speaker** | The line-type menu ringed, the empty line lit: “Open the line-type menu and choose Character — or press Tab.” Then the Character row; then `IVO` faint on the line. | A second cue with its Dialogue line. The wrong row chosen is named: “This line is Parenthetical. Choose Character instead.” |
| **4. Write the reply** | The reply line lit with the suggestion faint, no key: “Type IVO's reply. Any words will do.” | Any words; no Return needed. The guide moves on after a pause in the typing. |
| **5. See that it's saved** | The save indicator ringed. | Authoritative successful persistence, not a timer. A failed save is named at the indicator and the step waits. **Finish Lesson**. |

After Finish Lesson the card offers **Next Lesson** (which picks up in the same
play), **Keep Writing Here** and **Return to My Play**. No applause, score, or
confetti. The visible scene is the reward.

<a id="TUT-D106"></a>

##### The bridge into a real play stays guided

Not in this build. When it is, **Start My Play** keeps the guide visible
through the real New Play flow:

1. If no Plays folder has been selected, explain what it is and open the normal
   folder flow. A cancelled picker returns to the same guide with **Try Again**
   and **Back to Practice**. Choosing a folder does not move existing work.
2. Open New Play and point to its name field: “What would you like to call your
   play? You can change the name later.” Use the app's existing validation and
   creation controls. Do not introduce a second creation form.
3. Wait for the new play and editor to be ready, then point to the actual first
   writing line. “This is your play. Start with a speaker, or choose a line type
   from the menu.” Offer **Finish** and **Show the Writing Steps Again**.

Show the latter at the real document, with no automatic practice setup,
demonstration writes, or reset actions. Creation is complete only after its
normal write succeeds. Finish closes the guide and places focus on the writing
surface. If creation fails, the guide stays at that action and the existing
error explains recovery. Never leave the user on an unexplained blank screen.

<a id="TUT-D5"></a>

#### 5. The course, and deeper tutorials

Every lesson uses the same card, help, demonstration, skip and resume
behavior, and all of them write the one practice play ([TUT-10](#TUT-10)).
Each lesson starts from where the previous lesson leaves the play:

| Lesson | Steps, and where the play is left |
| --- | --- |
| **1. Write Your First Exchange** | Name the speaker → give them a line → choose the next speaker → write the reply → see that it's saved. Leaves a scene with a two-speaker exchange. |
| **2. Format the Script** | Emphasize a phrase in that exchange → a Line Break inside a speech → a Page Break → choose another format. Leaves the exchange formatted, with a page break after it. |
| **3. Arrange Scenes on the Board** | Open the Board → add a scene → describe it → move it earlier → see the Outline. Leaves two scenes in their new order. |
| **4. Characters and Opening Pages** | Open Cast → make the printed Characters page yours → add someone to the cast → write opening notes. Leaves the play's opening pages. |
| **5. Organize Files and Tags** | Create a document → write a note → tag it → name it. Leaves a named, tagged note in the play's Binder. |
| **6. Prepare a PDF or Print** | Open the preview → choose the pages → choose opening sheets → finish at the preview. Saving or printing is the writer's choice; finishing at the preview writes nothing. |

**Opened out of order.** A lesson that works on a speech (2, 4 and 6) gets the
bundled exchange, after whatever the play already holds, when the play has no
speech yet. A step chosen directly gets what it builds on (a cue for a speech,
a second scene to move, a document to write in). All of it goes to the same
play and removes nothing. **Start Over in a New Play** begins the course in a
fresh practice play; the earlier one is kept.

**Further lessons**, for when their features and fixtures are ready, follow the
same pattern and join the course where they belong: *Find Your Way Around*
(Binder, notes, Plays), *Find an Earlier Version* (Versions, guarded restore),
*Make the Page Comfortable* (page zoom, interface text, focus mode, restoring
only lesson-owned preferences), and *Write with Fewer Clicks* (predictive Return,
the element menu, the leader menu, direct shortcuts read from the active
bindings). Optional child lessons (character autocomplete, dual dialogue,
comments, actor sides, formats versus zoom) each carry a **Back to [Parent
Lesson]** that restores the parent's place. Only one lesson runs at a time.

Do not display lessons for features the app does not have. Musical workflows,
custom keyboard mapping (§62), named drafts, production copies, and locked
pages (§64) get version-matched lessons when those capabilities ship.
Contextual entry points (Guide Me Through This on the Board's empty state, the
Export sheet and Versions) can follow; they open the relevant lesson and say
first that it happens in the practice play. No unsolicited lessons or repeated
first-use popovers.

<a id="TUT-D6"></a>

#### 6. Practice is safe, real, and recoverable

Tutorial practice lives under the app-owned tutorials directory, outside the
Plays folder ([STOR-176](../keeping-work/storage-and-file-format.md#STOR-176)). The practice
play is an ordinary play operated through the existing storage client, editor,
paginator, save queue, conflict floor and recovery machinery. It is not a
second editor or a simulation.

- The first lesson of a course, and Start Over, reserve a new practice play.
  Every other lesson, Continue, Show Me, Skip and a fix continue the course's
  play. Opening Help & Tutorials alone writes nothing. An existing sample or a
  user play with the same name is never adopted, reset, or overwritten.
- The guide's own edits go only to the practice play the lesson is in, add or
  convert, and never remove the writer's words. In the real-play bridge, only
  the writer's own actions create or edit writing.
- Practice words are retained across restarts, completion, update, Start Over
  and Reset Progress. **Saved Practice** lists every practice play, with Open
  Practice (which makes it the play the lessons continue) and Move to Trash.
- **Keep as a Play** copies the complete practice play, through normal guarded
  creation, into the Plays folder ([STOR-171](../keeping-work/storage-and-file-format.md#STOR-171)).
- Opening or leaving practice settles the previous session through the normal
  guards. Practice never overwrites `lastPlay`, the selected Plays folder or its
  bookmark, or the writer's real-work layout ([STOR-172](../keeping-work/storage-and-file-format.md#STOR-172)).
- Export and Print keep their ordinary meaning in practice. Never open a save
  dialog, write a PDF, send a print job, or mark a cancelled action as
  successful on the writer's behalf.

<a id="TUT-D7"></a>

#### 7. Progress and interruptions

Progress is local app state, separate from a play's content and distinct from
the practice files, in the version-1 state file of
[STOR-170](../keeping-work/storage-and-file-format.md#STOR-170). It stores the invitation
disposition, the course's practice-play identity, and for each lesson in each
practice play its stable ID and revision, current step, status and per-step
outcome (tried, demonstrated, skipped), plus the More Help preference. A step's
outcome is recorded the moment its result is there, before the guide moves on.
No keystrokes or script text. Progress written before the course existed loads
with the play last practised in as the course's play.

| Event | Required behavior |
| --- | --- |
| Pause, close, or quit | Save practice through existing protections; checkpoint progress on results, step changes and pause. Never depend on an unload callback alone. |
| Resume | Reopen the matching practice play at the step, changing nothing in it. A step already done says so and offers Next. |
| Target not on screen | Keep the sentence; lead back to the step's view; offer Take Me There when nothing can be pointed at. Skip Step and Stop remain. |
| Writer goes elsewhere in the practice | Keep their edits. The card leads back to the step's place without deleting what they did. |
| Missing prerequisite | Supply it in the same play, adding only (§5). Never demand an exact sample be rebuilt by hand. |
| Save failure, newer file, read-only practice | The safeguard takes priority. The step holds with a plain sentence; it resumes only after the issue is resolved. Stop can hide the guide but cannot dismiss the data warning. |
| Progress cannot be saved | Keep practice safe through its own save path. The card says the tutorial place could not be saved and that Help & Tutorials can reload it; the lesson continues with session-local progress. |
| Unknown or corrupt progress | Preserve the stored file, report it, and offer Reset without deleting practice. Suppress unsolicited invitations when prior state is uncertain. |
| Lesson changed by an app update | Map stable step IDs; never reset all completions. |
| Start Over, Reset | Start Over begins a new practice play and keeps every earlier one. Reset clears lesson checkmarks, keeps every practice play and the course's play, and leaves the invitation dismissed. |

An idle writer is not a failed step. No countdowns, nagging after inactivity,
timeouts that fail a lesson, or cursor movement because the guide is impatient.

<a id="TUT-D8"></a>

#### 8. Words, visual design, and accessibility

**Scene:** a writer sits at a desk with the app open, uncertain where to begin;
the guide should feel like a patient person pointing at the page beside them.
Follow the current light/dark appearance, accent, and text settings. The card is
paper and ink with the menu anatomy's radius and shadow; its leading edge
carries the step's tone — the accent to do, amber to correct, green when done —
and the check and warning glyphs repeat it for anyone who does not see color.
The ring and the lit line use the accent; the suggestion uses the placeholder
color (4.5:1) and a dotted rule. No mascot, avatar or illustration. Nothing
pulses; under Reduce Motion the card appears without moving. Increase Contrast
strengthens the ring.

- Say “Choose Character in the line-type menu,” not “Set the node type.”
  Introduce an unfamiliar term where it is used. Use “Plays folder,” “play,”
  “script,” and “Binder,” following storage §1.
- Use the actual visible control name, bold in the sentence; words to type in
  the script's typeface; keys as key caps. Shortcuts are offered beside the
  visible-control route, never instead of it.
- Prefer “That's a character cue: MARA” to “Great job!” Never say “obviously,”
  “simply,” “even beginners,” or “you did it wrong.” Name what happened.
- Follow [DESIGN.md](../../../DESIGN.md) and [check:design](../../../scripts/check-design-tokens.sh):
  the type, radius and gap scales and theme tokens; 200% interface text wraps
  rather than clips.
- The card is a named region in ⌃⇥ navigation (`app/regions.ts`). Focus moves
  only on a deliberate action: starting a lesson or a step, Skip, a fix or Show
  Me puts focus where the writer acts next — the script for a typing step,
  otherwise the card's sentence — and a finished lesson focuses its message.
- The step, and each change of what the card says, is announced once through
  `ui/announce.ts`, after a short pause so typing is not narrated key by key.
  Everything the card shows is text; nothing depends on seeing the arrow, ring
  or suggestion.
- Buttons' accessible names contain their visible labels; the × is named Stop
  Tutorial. Pointer, keyboard, Voice Control and dictation reach the same
  results.

<a id="TUT-D9"></a>

#### 9. Implementation boundaries

A small explicit lesson runner around existing app actions; no generic tour
package guessing completion from clicks.

| Area | What it holds |
| --- | --- |
| `src/tutorial/lessons.ts` | The course: lessons in order, steps with their help, area, and whether they observe, settle on a pause, or carry forward on a skip. The practice play's seed and the bundled example text. |
| `src/tutorial/coach.ts` | The pure judgement: facts of the play and window plus the step's baseline in, one cue out (tone, sentence, target, suggestion, fix). |
| `src/tutorial/perform.ts` | The guide's own edits as editor transactions: step preparation, Show Me, Skip's carried results, fixes and the bundled exchange. Additive or converting only. |
| `src/tutorial/place.ts`, `ghost.ts`, `CueCard.tsx` | Card placement, the lit line and its suggestion (editor decorations), and the card. |
| `src/tutorial/ui-facts.ts` | What only the window knows: open menus and their rows, the open sheet, the focused control and uncommitted field text. |
| `src/tutorial/useTutorial.ts`, `model.ts`, `Catalogue.tsx` | The runner (course play, steps, baselines, moving on, announcing), progress, and Help & Tutorials. |
| Targets | Stable semantic IDs, never visible text or nth-child selectors: `data-tutorial` on controls, `data-menu-id` on menu rows, `data-seg` on the view switch, `data-tutorial-card` on Board cards. |
| Storage and native authority | [STOR-170](../keeping-work/storage-and-file-format.md#STOR-170) through [STOR-173](../keeping-work/storage-and-file-format.md#STOR-173) and [STOR-176](../keeping-work/storage-and-file-format.md#STOR-176); mirrored in browser dev fixtures. |
| Export, Board, Binder, Cast | Observe their ordinary results; enter through existing commands; never bypass their validation or save guards. |

Treat tutorial state as orchestration, never as an alternative storage engine.
The editor and PDF still consume the same resolved FormatSpec and paginator.
Lesson text, examples, and demonstrations are bundled and usable offline.

<a id="TUT-D10"></a>

#### 10. Delivery order

No priority over other backlog work is implied. Implement in useful slices:

- [ ] **A. Complete guided start:** retained practice, the course's one play,
  catalogue, the guide at the work with automatic results and named wrong
  turns, help/demonstrations, skip/stop/resume, permanent entry points and
  accessible keyboard/layer behavior — built; the native gate, participant
  sessions and the real-play bridge remain.
- [ ] **B. Further lessons:** navigation, Versions, comfort and fewer-clicks,
  joining the course where they belong, each whole when opened first.
- [ ] **C. Deeper help:** child lessons and deliberate contextual entry points.
  Add tutorials for future features with those features, not ahead of them.

<a id="TUT-D11"></a>

#### 11. Acceptance and validation

These are requirements for implementation, not claims about the current build.

| ID | Observable acceptance criterion |
| --- | --- |
| T01 | Fresh start reaches ordinary New Play without taking a lesson. The invitation appears only after real boot/folder readiness; restoring a script produces no tutorial flash or focus theft. |
| T02 | Skip for Now removes the invitation in one action and it stays dismissed across launch/update. Help & Tutorials can start it again. |
| T03 | Every instructional state, including a demonstration, a correction, a held step or a sheet, has an obvious route to Stop. No lesson requires completion to return to writing. |
| T04 | The first two steps produce a real Character/Dialogue pair. All five use the production editor; meaningful alternate wording and input methods are accepted. |
| T05 | Moving on reflects observed, saved results; it never moves focus while the writer types. Back preserves text; skipping cannot leave an impossible step. |
| T06 | More Help, Show Me and Skip work at every step. Show Me writes only the practice, in place, never removing the writer's words, and waits for Next. |
| T07 | Stopping, quitting, and restarting retains practice and the correct resumable step; Continue changes nothing in the play. Relaunch honors ordinary real-work restoration without forcing the tutorial open. |
| T08 | Starting, demonstrating, skipping, starting over, or deleting a tutorial cannot write to another play, overwrite an existing sample, change the selected Plays folder, or silently discard practice words. |
| T09 | Keep as a Play handles collisions and failed copies with the original intact. Earlier practice plays remain reachable in Saved Practice; Reset Progress leaves them untouched. |
| T10 | The real-play bridge remains guided through folder choice, naming, cancellation, creation errors, and editor readiness. It never auto-inserts demo content into that play. |
| T11 | Every lesson works from a direct catalogue entry with no prior lesson taken, in the course's play. Child lessons return to their parent's saved place. |
| T12 | Keyboard-only and VoiceOver users can operate the guide and its target, including in modal sheets, at 200% text. Escape closes only the top applicable layer; no keyboard trap or unreachable exit. Held by machine: the keys the tutorial checks press, and for VoiceOver the accessibility tree WebKit builds ([A11Y-16](accessibility.md#A11Y-16)); no person tests it. |
| T13 | Light/dark, all accents, narrow windows, coarse pointer, reduced motion, and increased contrast keep the instruction, target, focus, and exit legible and reachable. |
| T14 | Missing targets, changed examples, corrupt progress, interrupted writes, read-only practice, and real save failures produce a supported recovery/skip/stop route. A failed save cannot show “saved” or move a lesson on. |
| T15 | Help works offline. No lesson requires analytics, an account, printing, or export. |
| T16 | Export and Print happen only on the writer's explicit action. Cancelling returns to a usable step; Finish at Preview completes the lesson without writing or printing a file. |
| T17 | Shortcut descriptions match active bindings and the latest editor behavior. Targets do not depend on exact page positions or a particular font/format. |
| T18 | At every step the card is beside its target, on screen, and never covers the target or the menu it sits in; a typing step shows the words and the key in the line itself. |
| T19 | Each step moves on by itself once its result is there and saved; each wrong turn the coach knows is named at its place, and its fix produces the step's result. |
| T20 | The six lessons, taken in order, all write one practice play, each beginning where the last left it; a lesson taken first is whole in that same play. |

Unit tests hold the coach's judgement for every step and state, the placement
geometry, the guide's own edits on a real editor state (the whole course
written into one play, no word removed) and the progress model. Browser smoke,
shared with the native self-test, drives every lesson by hand and by Show Me,
the corrections, Skip, Stop and Continue, narrow windows and failed saves, with
axe on each card state. Browser-only success does not establish native
accessibility or storage correctness.

Before considering the experience finished, observe 5–6 people spanning low,
ordinary, and high computer confidence, including a keyboard/screen-reader
participant. Give tasks without verbally rescuing them: start a play, try the
lesson, leave halfway, find it again, resume, and open a later lesson directly.
Record where they hesitate, whether they understand practice versus real work,
whether “saved” is clear, and whether they can leave and return unaided.
A confident person skipping the tutorial is a successful outcome. Completion
rate is not the goal.

<a id="TUT-D12"></a>

#### 12. Source of truth and open validation

This design is grounded in [the vision](../../engineering/architecture.md), [PRODUCT.md](../../../PRODUCT.md),
[DESIGN.md](../../../DESIGN.md), [editor behavior](../writing/editor-ux.md),
[workspace interactions](../organizing/workspace-model.md), [storage](../keeping-work/storage-and-file-format.md),
and [privacy](../keeping-work/privacy-and-telemetry.md), plus the FirstRunCard, element bar,
keymap, region navigation, Welcome, and Help & Tutorials.

Validate in usability sessions: the time estimates, whether a writer notices the
card and the faint words at a glance, whether the pause before moving on feels
right, whether the one-play course reads as a story rather than as a pile of
exercises, and the novice's understanding of practice retention. Those findings
may change presentation; they must not weaken skip, replay, continuous
guidance, accessibility, or writing safety.
