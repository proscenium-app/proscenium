# Changelog

What changed in each version of Proscenium, written for the people who use it.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
versions follow [Semantic Versioning](https://semver.org/). Versions 0.9.x are
release candidates; 1.0.0 is the first public release.

Each release's notes on GitHub come from its section here, so write entries as
a playwright would want to read them: what you can do now, what works better,
what was broken and is fixed. `bun run version <x.y.z>` turns Unreleased into
that version's section.

## [Unreleased]

## [1.0.4] - 2026-10-23

### Changed

- Nothing you will see: 1.0.4 is the same Proscenium as 1.0.3, every
  feature, key and file as it was, under a new version number.

## [1.0.3] - 2026-10-22

### Added

- The board runs Across or Down. Across, each act is a band and its cards run
  left to right under it; Down, each act is a column and its cards run top to
  bottom, the acts side by side, and the board scrolls sideways when they do
  not all fit. Choose it at the top of the board; Proscenium remembers it on
  this computer, for every play. Tab and a screen reader still follow the
  script's order either way.

### Changed

- A scene's color is chosen where you see it: on its card, on its row in the
  outline, from its row in the rail (right-click, ⇧F10 or ⌃⏎) and in the
  inspector's Scene tab, from one list of names: No Color, Setup, Turns,
  Interior, Subplot, Revise, Parked. The dot beside a scene in the rail is its
  color, and No Color is an empty ring, where it drew as a dark dot in the
  dark appearance. Cards are bigger, with room for a longer summary, and a
  card's Notes are open when it has some. Scene status and labels are gone
  from the board, the outline, the inspector and Settings › Writing; a play
  keeps any it holds, unchanged in its file. A scene changed somewhere else is
  no longer marked on its card or row: the inspector's Scene tab says so, with
  a link to Changes.
- Changes counts only what you have not seen. Once Changes is in front, every
  change from outside and every kept copy in it is seen and the count on its
  tab goes at once; there is no Keep to press on each one. What was new stays
  marked New while you are there, and Revert still puts a change back. A
  script that another program saved forty times showed 40 until each was kept.
- A run of changes from outside is one change. Saves from another program or
  a sync to one file, one after another with nothing of yours between, are
  one entry in Changes, saying how many words were added and cut, where in the
  play, and how many saves made it. Each change shows only itself, where an
  older one showed everything that had come to the file since.
- Changes is a list beside a page. Each entry says who (You wrote, Kept by
  Proscenium, Changed somewhere else), when, which document, where in it and
  how many words; the one chosen is drawn beside it on the page, and it opens
  on the newest change you have not seen, without a click. Previous change and
  Next change step through what it holds. In a narrow window an entry opens
  under its line. A note, a character sheet or an outline that changed is
  drawn on its own page too, its headings, lists and emphasis as written, with
  cut words struck through and added ones underlined, where it showed its
  Markdown line by line; Line by Line still shows the file.
- Changes in text draws only the newest run of changes from outside on the
  script, word by word, each change once, with Previous change and Next change
  and how many there are. A cut line is drawn struck through in its own
  column, and what you type since is never marked as the change's. It drew
  every change you had not kept at once, the same cut line once for each, in
  the file's own markup. Once nothing is left unseen the toolbar stops offering
  it, and Show in Script on the change's entry in Changes draws it again.
- Start with Character Prompts sits in an empty character sheet's header,
  after Edit Tags. It had a strip of its own under the format bar, which the
  bar drew over.
- With Share anonymous usage and crash reports on, a copy also says once a day, once a week and once a
  month that it is in use, and whether it was installed in the last week, the
  last month or before, so we can count how many copies are in use. Nothing in
  it tells one copy from another. To send it no more than that, the app keeps
  on your computer, and never sends, the day it first ran and the last day,
  week and month it counted itself. Turning the switch off in Settings ›
  Privacy stops it with every other report.

### Fixed

- A page break puts the next line at the top of the new page. In page view
  the line after a break had a blank line above it, and a break pressed at the
  end of a scene brought an empty stage direction that pushed the next scene's
  title down. The title is the new page's first line now, and the cursor goes
  to it.
- A character's sheet in the Cast is the one in the Characters folder. A play
  that had put an earlier draft's sheets away in an archive folder opened the
  archived sheet for the character, and Appearances rewrote it. A sheet
  elsewhere is a file like any other now, and the Cast offers Add Notes for
  that character. Add Notes puts the new sheet in the Characters folder,
  making it when the play has none, where it went loose at the top of the
  binder. New in the binder still makes a sheet at the top level.
- Coming back to the window no longer takes Proscenium's own saves for changes
  from somewhere else. A save that finished just as you came back could make
  the outline say its notes had changed somewhere else and hold your next words
  behind that notice, and Changes listed your own words as a change from
  outside.
- A change another program makes while Proscenium is busy with the same file
  stays in view. One that arrived while its script was reloading could be
  missing from Changes, with no way back to your text, and the binder could go
  back to its own older order after another program had changed the play's
  order as Proscenium saved.
- Plays a sync client brings into the Plays folder after Proscenium opens are
  listed on the Plays screen as they arrive. They were listed only once the
  folder was looked at again.
- A script or note that another program saves no longer shows as missing, or
  drops from the binder, when Proscenium looks at the folder at the instant
  the save replaces it.
- On Windows, a play whose folder is deep enough for its path to pass 248
  characters opens, and its changes are seen. It never opened.
- On Windows, a file another program holds open is waited for when it is
  read, as it was when it was saved. Opened while another program held it,
  the file was refused at once.
- On Windows, with a contrast theme on, the focus is shown and what is chosen
  stands apart, a document shows one cursor where it showed two, and the
  accent colors in Settings › Appearance keep their colors, the chosen one
  ringed, where each was the same plain button.
- On Windows, Copy Diagnostics and Copy Message open the clipboard for
  Proscenium's window, and try again for a moment while another program holds
  it.
- In the dark appearance, the words of a hovered button in the view switch
  and in every other row of segments are as easy to read as the rest.
- Send Feedback writes its character limit in your computer's own number
  format, as it writes the count beside it: "10.001 / 10,000" became
  "10.001 / 10.000" in German.

## [1.0.2] - 2026-10-22

### Added

- Proscenium for Windows. The same app, on Windows 11 and Windows 10 (version
  22H2), on x64 and Arm PCs. Download it from proscenium.ink: it installs for
  you alone, without an administrator, and updates itself, as it does on a Mac.
  The installer is not signed, so Windows warns the first time you open it:
  choose More info, then Run anyway. Shortcuts use Ctrl where a Mac uses ⌘, and
  your plays are the same files on either system.
- Reply to a comment. Every comment has a Reply button, on its card beside the
  page and in the Comments list. The reply joins the comment it answers: one
  card, one row, one highlight in the script, and one in the count. Each reply
  can be edited or deleted on its own, and Resolve takes the comment and its
  replies together. Comment (⌘⌥M) at a place that already has a comment opens
  its reply instead of adding a second comment. In the script a reply is a
  note directly after the note it answers, so another app shows both.
- Sign your comments. The first time you add a comment, its field asks for
  your name, and remembers it: your comments and replies are written into the
  script as "Robin: too long?", so a reader can tell them from someone else's.
  Change the name in that field or in Settings › Writing, or clear it to add
  comments unsigned. Names in any alphabet are shown as the comment's author;
  a name with an accent was not.
- Copy from a comment. Drag across a comment's words, or double-click one, to
  select and copy it, on a card and in the Comments list. In the list, a click
  on the words still goes to the comment in the script, and Show in the Script
  does the same from the keyboard.

### Changed

- A comment is about the words you selected. Select words and choose Comment
  (⌘⌥M), and the highlight in the script paints those words and nothing else,
  a word or three speeches, where it painted the phrase just before the
  comment. The words stay marked as you type inside them, cut them, split a
  line among them or undo. In the script they sit between two short notes,
  [[{]] and [[}]], which another app shows beside the comment. With nothing
  selected the comment stands at a point and lights the phrase before it, as
  before. A comment on whole lines goes at the end of the last line selected,
  not in front of the next one.
- The space between pages is the desk's own colour, flat, where it was a
  shade darker at its edges. In the dark appearance the pages no longer have
  a pale glow down their sides.

### Fixed

- Opening a play no longer says "Checking file changes" and then "File
  changes are up to date". With VoiceOver on, the two were spoken each time a
  play or the practice play opened, over whatever was being read just then,
  such as a lesson's first step. A folder that takes more than two seconds to
  start being watched still shows and says it.
- Comment (⌘⌥M) always opens a field to type in. In a window with no room for
  comment cards beside the page, which is the size Proscenium opens at, it
  added an empty comment to the script and opened nothing. The Comments list
  opens now, with the new comment ready to type.
- Two comments written one after the other on a line of their own stay two
  comments. They came back as one after the script was saved and reopened.
- On the Beta track, What's new in Settings › Updates opens the notes of the
  test version on offer. It opened nothing.
- A copy installed from a test version follows Beta, and stays on Beta once it
  updates to the release. It started on Stable, so it was never offered the
  next test version. A Track you have chosen in Settings › Updates is never
  changed.
- The scene inspector counts the comments in its own scene. In a play with a
  Scene 1 in each act it gave both scenes the comments of the two together,
  and in a scene with a scene heading under its title it missed every comment
  after that heading. In the Comments list, two scenes with the same title are
  listed apart.
- A comment of more than one line leaves its line alone. Press Return in a
  comment and, once the play had been saved and reopened, a transition, a
  centered line or a synopsis it stood on had become a stage direction, a
  parenthetical had joined the speech, and the comment read on its card with
  its lines run together. Each line stays what it was now, and the comment
  keeps its lines, on its card and when you edit it. A comment on a line of
  its own also keeps an asterisk or an underscore typed in it.
- Typing over the words just before a comment no longer deletes the comment.
  Select up to a comment and type, and the comment went with the words you
  replaced.
- A comment on a character's name stays on it. The character and the speech
  under it came back as one stage direction once the play had been saved and
  reopened. Find's list of speakers and the names offered as you type a
  character read the name without its comment now: MARA with a comment on it
  was a speaker called "MARAROBIN: RENAME?". A comment on an act or scene
  title or on a scene heading has a card, a row in the Comments list and a
  highlight, and counts, as any other does; made there, it went into the
  script and was shown nowhere.
- A line that ends in TO: stays what it is. A stage direction, a scene title
  or a lyric that ended that way came back as a transition, and a transition
  in mixed case, like "Smash cut TO:", gained a > at its front each time the
  play was saved.
- A sung speech keeps its lines. A spoken line or a parenthetical after a
  lyric, in the same speech, came back as a stage direction once the play had
  been saved and reopened. Return in a song left an empty lyric that came back
  as a line reading ~, an empty parenthetical came back as a speech reading
  (), and a lyric that began with a space came back as a speech. Each line
  stays what it was now. An empty lyric or parenthetical is not kept when the
  play is reopened, and an empty line inside a lyric parts it into two verses.
- A character keeps its line, whatever its name. A character called 2, #2 FAN
  or .38, or one whose name ends in TO: or OUT., came back as a stage
  direction with the speech run into it once the play had been saved and
  reopened. Each stays a character now. In the script such a name is written
  with an @ in front of it, which is how Fountain marks a character's line;
  names that never needed one are written as they were.
- A character with no speech under it yet stays a character. At the end of the
  script, or with a stage direction or another character after it, it came
  back as a stage direction once the play had been saved and reopened, and a
  name in mixed case came back reading @Ivo. It opens as the character now,
  with an empty line of speech under it. A character whose speech begins with
  a song kept its line the same way, and a script made elsewhere with a
  character directly over a lyric opens as the character and the song, where
  it opened as one stage direction.
- A character's name keeps its case. A name in mixed case, like McTeague, or
  one with its direction in lower case, like HANS (on the radio), turned to
  capitals at the first change anywhere in a play that had been reopened, and
  the next save kept it so. Cut and pasted, such a name turned to capitals
  too, and the second of two speeches side by side, cut and pasted, was saved
  as a speech of its own.
- A ß no longer spoils a line in capitals after it. With two act or scene
  titles that held one, the second could come out as a stage direction in
  capitals with a stray letter at its end, like "DIE STRASSE WIEDERr".
- The first line of a script stays in the script. A first stage direction
  that read like a line of a title page, such as "Notes: buy milk" or "Date:
  June 1944.", was gone once the play had been saved and reopened, and so was
  a first character with a name like TITLE: X. In a play with no title page,
  a first line like "Time: now." moved into the title page. Each stays where
  you wrote it now. A script made elsewhere with such a line after its title
  page opens with the line in place; it used to open without it.
- Spaces at the top of a script no longer take the first line with them. If
  a play began with a paragraph that held only a space or a tab, the stage
  direction, heading or speech after it could be missing the next time the
  play was opened, and the next save wrote the play without it. It is there
  every time now. The empty paragraph itself is not kept, as before.
- A first paragraph that holds only spaces is saved as an empty line. Saved
  with the spaces in it, the play lost the line after them when it was opened
  in an earlier version of Proscenium, or in another app that reads a script
  the same way.
- An empty line of speech with no character over it no longer comes back as a
  character with no name. The line after it opened as that character's speech,
  whatever it was: a stage direction, a heading, or another character, whose
  name and speech ran together as one speech. It took one more save and reopen
  to come right. Each line opens as itself the first time now, and a stage
  direction typed with two spaces alone on its first line does too.
- A stage direction that begins with spaces stays as you typed it. One in
  capitals, or one that ended in TO:, came back with an exclamation mark in
  front of it once the play had been saved and reopened, and gained a second
  at the next save. A play saved once that way opens without the mark again.
  A line lower in a stage direction that began with an exclamation mark of its
  own lost it, and keeps it now.
- A stage direction of two lines stays a stage direction, whatever its first
  line is. A first line with no letters in it, like "1984." or "…", came back
  as a character with the second line for a speech. So did a first line in an
  alphabet other than the Latin one, and one like "PAUSE (a long one)".
- A centered line keeps a < or a > typed in it: "a < b" came back as "ab". A
  transition that ends in < stays a transition, where it came back centered,
  and one that begins as a scene heading does, like "INT. HOUSE - CUT TO:",
  stays one too. Two centered lines one under the other, in a script made
  elsewhere, stay centered when the play is saved.
- A title page that gives a line twice keeps both. In a script typed by hand
  or made in another app, two "Author:" lines opened as a play by the second
  author alone, and the next save wrote the play without the first. Any other
  line of the title page given twice lost its first the same way, and an empty
  "Title:" under the title took the title away. Both authors are there now, a
  title or a note given twice holds the lines of both, and the next save
  writes them together.
- A title page keeps a line Proscenium has no field for when that line is all
  it holds. In a script typed by hand or made in another app, "Format: stage"
  under an "Author:" with no name came back as a stage direction at the top of
  the script once the play had been saved and reopened. The same happened in
  a play whose title page held only such lines and its cast, when the last
  character was removed. The line stays in the title page now. An "Author:",
  "Contact:" or "Characters:" line with nothing after it is kept in the script
  as well; the first save used to take it out.

## [1.0.1] - 2026-10-06

### Added

- Changes shows your own writing. Versions…, in the script-name menu, opens
  Changes on the document in front of you: each session you wrote, newest
  first under its day, alongside what arrived from another app or device.
  Open a session to read what you changed in it, as a whole or one saved
  version at a time, and restore either. ↑ and ↓, or Newer and Older, step
  through the list; All, Mine and From Outside choose whose changes it shows.
  A session holds only what you wrote: a change that arrived from elsewhere
  ends it and is listed on its own, and a copy kept as that change arrived
  says when what it adds may be that change. With VoiceOver, Versions… says
  how many sessions it found. Changes takes the place of the Versions sheet.
- Changes shows a change on the page. Open one of your writing sessions, a
  change from another device, or a script someone sent back, and the script is
  drawn in your play's format with the words that were cut struck through and
  the words that were added underlined, and a rule in the margin beside each
  line a change touched. Line by Line, in the Changes bar, is the list of
  added and removed lines it showed before.
- Double-click the Characters page to edit it. In page view, a double-click on
  the Characters page opens Cast with the cursor in the description of the
  character you clicked.
- Numbered lists in a document can carry on or start again. A numbered list
  keeps counting past a paragraph that interrupts it, and in a numbered list
  the formatting bar offers Continue Numbering and Start at 1. Type `7.` and a
  space to start a list at 7.

### Changed

- Panes keep a width you can read. In a window too small for every pane, the
  smallest wait out of sight and come back when there is room, and Split says
  there is no room rather than making a sliver.
- Versions follow your writing more closely. Documents, character sheets and
  outline notes keep versions as scripts do, a session's first save keeps the
  text it began from, and a version is kept once you have stopped for two
  minutes, so a session ends on what you wrote.
- On an Intel Mac, Proscenium follows stable releases only, and Settings ›
  Updates shows Stable with no track to choose. Test versions are built for
  Apple silicon.

### Fixed

- A pane made with Split can be closed. Every pane of several now has its tab
  and close box, View › Close Pane closes the pane you are in, and a divider
  dragged all the way across a pane closes it. A split pane with one tab had
  nothing to close it with.
- Opening a play no longer saves it. A play said "Editing…" as it opened,
  wrote the same text back, and kept a version nobody had made.
- Lists in a document hold together. Backspace, or ⌘⌫, at the start of an
  item keeps its words in the list, as a new line of the item above, where it
  split the list in two. A line broken inside an item with Shift-Return is
  still a line of that item when the document is opened again. Tab and
  Shift-Tab indent and outdent an item and do nothing else, and two lists of
  one kind with nothing between them are one list.
- A click anywhere on a document's page puts the cursor in the text: in a
  margin, between two paragraphs, or on the blank paper under the last line.
- A list in a document lines up at every zoom. An item's first line starts
  with the lines under it, and its bullet or number hangs in the indent beside
  it, where on a zoomed page the first line began further left and a
  two-figure number stood out in the margin. The cursor in a document is the
  height of the type on every line and stands between two letters, where it
  sat on the first letter of a list item. It holds steady if your Mac is set
  to prefer a cursor that does not blink.
- The inspector's count of comments follows an undo that takes a comment
  away. It kept the old count until something else redrew it.
- Added lines in Changes are easier to read in the dark appearance. Their
  green did not stand out enough from the page behind it.
- File › New Play… and ⌘N now name a new play, from the Plays screen or from
  inside a play. The New Play button's menu said "Blank Play ⌘N" while ⌘N
  made nothing.
- The binder's row menu says F2 beside Rename, the key that renames a row;
  Return opens it. The menu said Return.
- The tutorial's last export step names the dialog's own buttons, Export PDF…
  and Print…. It said "Save PDF".
- The sheet for the title page, the characters page and the opening notes has
  one name, Edit Opening Pages…, in the menu bar as in the script-name menu.
  The menu bar said Edit Title Page….

## [1.0.0] - 2026-09-26

### Added

- Tutorials that teach at the work. Help › Tutorials puts one card beside the
  thing to click or the line to type, never over it, and draws the words to
  type faintly where they go. It notices when you have done it, however you
  did it, and moves on; a common wrong turn is named where it happened, with
  one click to put it right. All six lessons write one practice play, so each
  begins where the last one left off.
- Pages documents import directly. Open or drop a `.pages` file and it reaches
  the same review as a Word document, styles, tables and footnotes included,
  without exporting it to Word first.
- Import into a play. Inside a play, File › Import a Draft…, Import… in the
  binder's New menu, or a file dropped on the binder adds the draft to that play
  as a new script or a page in the binder, in the folder you chose, with the
  original kept in Originals. The Plays screen still makes a new play.
- Act-scene-page numbers. In a format's header or footer, Insert now offers
  `II-3-67` and `2-3-67` whole, along with the act number, the act in Roman
  numerals, the scene number and the draft date. The numbers come from your
  headings, and a one-act drops the act (`3-67`).
- An anonymous copy for blind submissions. Export PDF and Print leave your
  name and contact details off the title page, out of the headers and out of
  the file's properties, and tell you which pages still mention you.
- Export .docx and Export .odt. Send your play to someone who works in a word
  processor: every element arrives as a named style they can restyle (Act,
  Scene, Character, Dialogue and the rest), in your format's page, type,
  columns and spacing, with page numbers, the opening pages you choose and
  Courier Prime built in. The export dialog's choices all apply, including
  sides, page ranges, an anonymous copy and the play's language. A word
  processor sets its own page breaks, so they can differ from the PDF.
- An update track. Settings › Updates offers Stable, each new release, or
  Beta, which also brings test versions of the next release before it comes
  out. Going back to Stable waits for the release after the beta you have,
  and Settings says so while you wait.

### Changed

- Proscenium opens straight into the play you were writing. It no longer passes
  through the Welcome and Plays screens on the way; if the play is still coming
  down from iCloud, it says so until it arrives.
- Moving something to the Trash no longer asks you to let Proscenium control
  Finder.

### Fixed

- The first-run screen no longer says your plays will appear on an iPad.
  There is no iPad version yet. Choosing iCloud Drive keeps your plays on
  your other Macs.
- Clicking New in the binder's right-click menu opens its list of things to
  add, instead of closing the menu.
- macOS writing suggestions no longer swallow letters as you type in
  Proscenium's text fields, such as Send Feedback's message and the fields in
  Settings.
- The spelling menu (⌘;) stays open until you choose a word, instead of closing
  as the word scrolls into view.
- Words typed the instant a note opens are saved. Before, they could stay on
  the page without ever being saved.
- A new note's first line is no longer hidden under its formatting bar.
- The binder reaches VoiceOver as a tree. Its rows were given to it as unnamed
  groups, with no level and no word of which one is selected; they are items in
  a tree now, with both.
- A header that prints the act now shows the new act on the page that opens
  it, instead of the act before.
- The element menu (`;` on an empty line) now calls a comment a Comment, as
  the rest of the app does, instead of Note. Its key is still `n`.
- The bar above the script fits beside the binder and the inspector. It used
  to run off the right of a narrow window, taking Page Break, the comment
  buttons and the page count out of sight and pushing the page off centre.
  Now it gives up its hint, then the words on its buttons, then folds the
  comment buttons, the breaks and bold, italic and underline into a More menu.
  The page count always stays. Holding ⌘ shows each shortcut under its button
  without moving anything, and the find bar no longer covers it.

## [0.9.0] - 2026-09-21

### Added

- A sketch comedy format based on Sketchworks Comedy’s published template,
  with title, cast and setting above the sketch on page one.

- Four more script formats: UK / International (BBC), Samuel French / Concord
  Manuscript, Dramatists Guild Traditional and Dramatists Guild Musical.
- Play Language in the document menu. Choose American or British spelling for
  each play, with the same language carried into accessible PDFs.
- One download for every Mac: Proscenium runs natively on Apple silicon and on
  Intel Macs.
- Proscenium keeps itself up to date. It looks for a new version when it opens
  and once a day, downloads it in the background, and installs it only when you
  choose to restart. Your latest changes are saved first. Settings › Updates
  turns the checking off, and Proscenium › Check for Updates… asks at once.

### Changed

- Proscenium House has fixed bold character cues, wider upright directions,
  quieter headings and a tighter reading rhythm. Existing House scripts reflow
  into the revised layout.

- Proscenium requires macOS 14 Sonoma or later. Earlier versions of macOS are
  now told so by Finder instead of opening an app that cannot run.
- A new app icon: the arch, the lit stage and its floor, drawn flat. It follows
  your Mac's light, dark and tinted icon styles.

### Fixed

- Guild formats now use the line spacing shown in their samples. Modern’s
  block directions are upright, and Musical’s lyric indent follows its own
  sample.

- Toolbar, binder and page labels no longer select like text when you drag
  across them. The rule that prevents it had never reached the system's web
  engine.
