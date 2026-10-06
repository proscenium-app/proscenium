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
