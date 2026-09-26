# Document import

[Bringing work in](README.md) › Document import

Import converts a source into a new play after review. The requirements below cover supported sources, recognition, fidelity and failure handling.

[Supported sources](#IMPT-D3) · [Choose](#IMPT-D5) · [Review](#IMPT-D6) · [Preserve content](#IMPT-D7) · [Create or cancel](#IMPT-D8)

## Requirements

<a id="IMPT-D100"></a>

<a id="IMPT-1"></a>

**IMPT-1** Import reads local source files, presents a correctable interpretation, and creates a new play only on confirmation.

<a id="IMPT-D1"></a>

### The experience

<a id="IMPT-2"></a>

**IMPT-2** **Bring an existing draft into Proscenium, see how it was understood, correct
its structure, and start writing without risking the original.**

<a id="IMPT-3"></a>

**IMPT-3** The writer is at their usual desk, often in an evening session. They have a
draft from another app and want to know whether their words arrived intact.
Use the current light or dark preference, paper-and-ink surfaces, the user's
accent, familiar controls and script typography. No new visual theme.

<a id="IMPT-4"></a>

**IMPT-4** The main anxiety is missing or misclassified writing, not which converter to
choose. Lead with the draft, show the reading, explain limitations where they
matter. A writer should never have to understand XML, ZIP containers or
Fountain syntax to fix an import.

<a id="IMPT-D101"></a>

#### Non-negotiable promises

- <a id="IMPT-5"></a> **IMPT-5** The chosen source is read only. Its bytes are copied into the new play.
- <a id="IMPT-6"></a> **IMPT-6** Nothing is written until **Create New Play**.
- <a id="IMPT-7"></a> **IMPT-7** The import creates a separate play. It does not append to or replace an open
  script, and never overwrites an existing file.
- <a id="IMPT-8"></a> **IMPT-8** Reading is deterministic, local and cancellable. No accounts or AI.
- <a id="IMPT-9"></a> **IMPT-9** Recognized source elements, inferred elements and manual choices are
  distinguishable. Unrecognized elements retain their text.
- <a id="IMPT-10"></a> **IMPT-10** Conversion fidelity is explained before committing. Formatting that the
  source app alone understands remains available in the source copy.
- <a id="IMPT-11"></a> **IMPT-11** A filename extension is not proof that its content can be read.

<a id="IMPT-D2"></a>

### Source export guidance

<a id="IMPT-12"></a>

**IMPT-12** Final Draft's documented import flow treats external word-processor formatting
as information that may need correction. Its supported PDF import is explicitly
for text-based files. Borrow the script-element vocabulary; improve the moment
before committing by showing a correctable reading.
[Final Draft import guidance](https://kb.finaldraft.com/hc/en-us/articles/15575344441620-Importing-a-script-from-another-program-such-as-Word),
[PDF support](https://kb.finaldraft.com/hc/en-us/articles/15573804499604-Can-Final-Draft-import-a-PDF).

<a id="IMPT-13"></a>

**IMPT-13** WriterDuet lets writers choose documents and their order when exporting. It
exports FDX, Fountain, Word and RTF, as well as its own WDZ project. Recommend
FDX or Fountain here because those name script elements. A WDZ project is not
equivalent to a single script and must not be treated as an arbitrary ZIP of
text. [WriterDuet export documentation](https://www.writerduet.com/article/261-export-a-document).

<a id="IMPT-14"></a>

**IMPT-14** Scrivener distinguishes compiling the manuscript from exporting individual
Binder documents. Preserve that distinction in the instructions: Compile for
one assembled draft; Export Files for an individual document. Its manuscript
order is meaningful. Do not promise to migrate the entire Binder through a
compiled export. [Scrivener Compile basics](https://www.literatureandlatte.com/blog/compiling-your-scrivener-project-the-basics).

**IMPT-15 — Withdrawn 2026-09-24.** Replaced by [IMPT-91](#IMPT-91): a `.pages`
document now imports directly, so Pages' Word export is the route for the
documents the reader refuses rather than the way in. The original wording is
kept in [withdrawn requirements](../../engineering/withdrawn-requirements.md#IMPT-15).

<a id="IMPT-D3"></a>

### Support matrix

<a id="IMPT-16"></a>

**IMPT-16** “Direct” means the selected file can reach a review without another app.
“Export first” is a supported migration route, not native format support.

| Source | Route in this implementation | Fidelity / boundary | Requirement |
| --- | --- | --- | --- |
| Word `.docx` | Direct | Paragraph order, named styles, basic bold/italic/underline, tabs, line breaks, body text and available text boxes. | <a id="IMPT-17"></a>IMPT-17 |
| Google Docs | Download Microsoft Word, then import | `.gdoc` is a pointer, not document content. No Google sign-in. | <a id="IMPT-18"></a>IMPT-18 |
| Pages `.pages`, single file or package | Direct | Paragraph order, named styles, bold/italic/underline, tabs, line breaks, table text, text boxes, visible captions and footnotes. Page layout, headers and footers, images, comments and list numbering stay in the original. Password-protected, tracked-change and Pages ’09 documents: File → Export To → Word. | [IMPT-87](#IMPT-87), [IMPT-88](#IMPT-88) |
| OpenDocument `.odt` | Direct | Paragraphs, style inheritance and supported inline emphasis. Tables become sequential text. | <a id="IMPT-20"></a>IMPT-20 |
| Rich Text `.rtf` | Direct | Text, basic styles and emphasis, Unicode escapes and supported Windows code pages. | <a id="IMPT-21"></a>IMPT-21 |
| Text `.txt` | Direct | UTF-8 or BOM-marked UTF-16. Line types are inferred and reviewable. | <a id="IMPT-22"></a>IMPT-22 |
| Markdown `.md` | Direct | Text and compatible inline emphasis. This is a script import, not a rich document or website migration. | <a id="IMPT-23"></a>IMPT-23 |
| Fountain `.fountain`, `.spmd` | Direct | Existing parser; unchanged imports retain source text without reserialization. | <a id="IMPT-24"></a>IMPT-24 |
| Final Draft `.fdx` | Direct | Named script elements, basic emphasis, lyrics, dual-dialogue cue flag. Unknown types remain stage directions and are flagged. | <a id="IMPT-25"></a>IMPT-25 |
| WriterDuet / WriterSolo | Export FDX or Fountain; Word/RTF also accepted | Select the wanted documents in export order. Native `.wdz` / `.wdx` projects are not parsed. | <a id="IMPT-26"></a>IMPT-26 |
| Scrivener | Compile FDX/Fountain/Word/RTF, or Export Files | Imports the exported draft. Native `.scriv` / `.scrivx` Binder migration is not implemented. | <a id="IMPT-27"></a>IMPT-27 |
| Legacy Word `.doc` | Save As `.docx` | No platform-dependent Word automation. | <a id="IMPT-28"></a>IMPT-28 |
| PDF, scans, ZIP archives | Specific guidance | No PDF text extraction, OCR or general archive import in this release. | <a id="IMPT-29"></a>IMPT-29 |

**IMPT-19 — Withdrawn 2026-09-24.** It made Pages an export-first route and
said native `.pages` packages are not parsed. Replaced by [IMPT-87](#IMPT-87) and
[IMPT-88](#IMPT-88); the original row is kept in
[withdrawn requirements](../../engineering/withdrawn-requirements.md#IMPT-19).

<a id="IMPT-30"></a>

**IMPT-30** Password-protected, malformed, empty and oversized inputs fail before creation.
The picker includes guided formats so writers can select what they have and
receive useful instructions, instead of wondering why their file is greyed out.

<a id="IMPT-D12"></a>

### Pages documents

<a id="IMPT-87"></a>

**IMPT-87** A `.pages` document saved by Pages 5 or later (2013 onward) imports
directly, with no Pages installation, automation or network. Both of its forms
are accepted, chosen, dropped or opened from Finder: the single file Pages saves
by default, and the package folder. A package reaches the reader zipped whole
with its folder at the root. The web view hands a chosen or dropped package over
that way as `Name.pages.zip`, Finder's Compress makes the same file, and a
package opened from Finder is zipped the same way before reading. A
`Name.pages.zip` is read as that document, and the play is named `Name`.

<a id="IMPT-88"></a>

**IMPT-88** What carries across from a Pages document, and where it lands:

- The body text in order, split into paragraphs at paragraph, section, page and
  column breaks, with its line breaks and tabs.
- Each paragraph's named style, which is the reading's source style. A one-off
  change made in the document reads as the named style it varies, and a
  paragraph the document gives no style keeps the one before it. Named script
  styles become their elements ([IMPT-60](#IMPT-60)); any other style, Body
  among them, is read from the text and marked for review ([IMPT-61](#IMPT-61),
  [IMPT-62](#IMPT-62)).
- Bold, italic and underline, from the character style over the paragraph
  style, each followed through the styles it is based on.
- Tables anchored in the text, cell by cell in row order, for text and styled-text
  cells. A number, date, duration or formula result is counted in a notice and
  left in the original, not guessed at.
- Text boxes anchored in the text, after their paragraph. Text boxes and tables
  placed on the page follow the body under “Text boxes from the original
  document”. Linked text boxes are read once. An object's visible title and
  caption go with it.
- Footnotes, after that, under “Footnotes from the original document”.

Page layout, fonts, sizes and colours, list bullets and numbering, headers and
footers, images, charts, comments, a table of contents (Pages builds it from the
headings, which are imported), page templates (designs a page can be added from,
not pages), hidden captions and image descriptions stay in the original. The
review's notices name what the document holds of these.

<a id="IMPT-89"></a>

**IMPT-89** A package opened from Finder is read within the one-document bound:
16 MiB for the whole package, at most 4,096 files and 16 folder levels, and no
link inside it is followed. The play keeps it as `Originals/Name.pages.zip`,
which opens back into the package. A single-file document is kept as it is
([IMPT-71](#IMPT-71)).

<a id="IMPT-90"></a>

**IMPT-90** These Pages documents are refused before creation, each with a
plain reason and File › Export To › Word as the next step ([IMPT-30](#IMPT-30),
[IMPT-46](#IMPT-46)): a password-protected document, recognized by the password
verifier a package carries or by a part no ZIP method can read; a document with
tracked changes, whose current text cannot be told from deleted text until they
are resolved; one saved by Pages ’09 or earlier; an archive holding no Pages
document, or more than one; and a damaged one. Reading is bounded before it
allocates: 64 MiB decompressed across the document, the ZIP bounds of
[IMPT-80](#IMPT-80) for the file and for a package's inner `Index.zip`, and
250,000 objects.

<a id="IMPT-91"></a>

**IMPT-91** Choosing a file names Pages among the direct formats, and the Pages
guide says to choose the `.pages` document itself. The guide names Pages' Word
export, File › Export To › Word, as the route for a document the reader refuses,
and each refusal in [IMPT-90](#IMPT-90) repeats it.
[Apple's Pages export guide](https://support.apple.com/en-gb/guide/pages/tance1161f26/mac).

<a id="IMPT-92"></a>

**IMPT-92** Pages acceptance coverage: a real Pages document with a permissive
licence, committed as a fixture, read for its text, table and placed text box;
the package forms of [IMPT-87](#IMPT-87), including one opened from Finder;
named styles, their variations, styles carried forward and emphasis; breaks and
anchored objects; a table in the current cell layout; every refusal of
[IMPT-90](#IMPT-90); the package bound and link handling of [IMPT-89](#IMPT-89);
and smoke through the picker for both forms and through Finder for a package.
A wider fidelity claim waits for real documents compared with Pages' own reading
of them ([IMPT-86](#IMPT-86)).

<a id="IMPT-D4"></a>

### Entry points and destination

<a id="IMPT-31"></a>

**IMPT-31** One review flow owns all entry points:

1. <a id="IMPT-32"></a> **IMPT-32** **Import a Draft…** is visible beside New Play on the Plays screen and in
   the New Play menu.
2. <a id="IMPT-33"></a> **IMPT-33** **File → Import a Draft…**, with ⌘⇧I, works from a play or the Plays screen.
3. <a id="IMPT-34"></a> **IMPT-34** Dropping files on the Plays screen opens review, never immediate creation.
4. <a id="IMPT-35"></a> **IMPT-35** Opening a supported loose document with Proscenium opens the same review.

<a id="IMPT-36"></a>

**IMPT-36** A file already inside a play opens that play through the existing Finder
router. In particular, opening a kept original never creates another play.
An existing Fountain script still opens in its own play.

<a id="IMPT-37"></a>

**IMPT-37** The destination is the current Plays folder, displayed in review. Choosing the
folder remains the existing onboarding/Settings action. Import does not quietly
switch it. A Finder request waits until a Plays folder exists.

<a id="IMPT-38"></a>

**IMPT-38** The review uses a wide, temporary document sheet, like Export. One sheet serves imports from both Plays and an open play without implying a persistent import draft. The sheet keeps the current
writing mounted, owns focus during this transaction and can be cancelled.

<a id="IMPT-D5"></a>

### Screen one: choose a draft

<a id="IMPT-39"></a>

**IMPT-39** Heading: **Import a Draft**. Subtitle: **Review your draft before creating a play.**

<a id="IMPT-40"></a>

**IMPT-40** The leading area says “Choose a draft to bring in,” offers **Choose Files…**
and accepts drops. Under it, list the direct formats in everyday language and
explain multiple selection: one file becomes one play, reviewed in sequence.

<a id="IMPT-41"></a>

**IMPT-41** Below, **Coming from another app?** has a Source App popup, the recommended
export, and instructions for that app alone. Pages is initially shown. Choosing
an app changes the help, never how a file is parsed. The writer never has to
select an app before selecting a readable file. The opening sheet is 720px wide;
the paragraph review expands to 1060px, both constrained by the window. Body
copy uses the shared 13px UI scale. The drop area uses a neutral field surface.

<a id="IMPT-42"></a>

**IMPT-42** States:

| State | What the writer sees / can do | Requirement |
| --- | --- | --- |
| Ready | Choose files, drop files, read source-app instructions, Cancel. | <a id="IMPT-43"></a>IMPT-43 |
| Reading | Filename, explanation of current work, Cancel. No invented percent. | <a id="IMPT-44"></a>IMPT-44 |
| Export required | Filename and app-specific export instructions; Choose Files remains available. | <a id="IMPT-45"></a>IMPT-45 |
| Unreadable | Plain-language reason and a next action. No stack trace or partial script. | <a id="IMPT-46"></a>IMPT-46 |
| Too many files | Ask for at most 20. Never silently discard extra selections. | <a id="IMPT-47"></a>IMPT-47 |

<a id="IMPT-D6"></a>

### Screen two: review the reading

<a id="IMPT-48"></a>

**IMPT-48** Hierarchy from top to bottom:

1. <a id="IMPT-49"></a> **IMPT-49** **Review Your Draft**, with source filename and detected format.
2. <a id="IMPT-50"></a> **IMPT-50** Editable **New play name**; visible Plays folder; **Choose Different Files…**.
3. <a id="IMPT-51"></a> **IMPT-51** A compact sentence-like summary: paragraphs, scene headings, distinct
   character cues, inferred/unrecognized count. These are interpretation counts,
   not proof that every part of the source was imported.
4. <a id="IMPT-52"></a> **IMPT-52** **What carries across**, expandable, with conversion notices. Keep it in the
   reading path, before the preview and commit button.
5. <a id="IMPT-53"></a> **IMPT-53** Find text; **Inferred or Unrecognized Only**; an unstyled-text reading choice.
6. <a id="IMPT-54"></a> **IMPT-54** Paragraph preview beside the correction inspector.
7. <a id="IMPT-55"></a> **IMPT-55** Fixed footer: the create/copy consequence, Cancel, optional Skip This File,
   and **Create New Play**.

<a id="IMPT-D102"></a>

#### Paragraph preview

<a id="IMPT-56"></a>

**IMPT-56** Show source text, supported emphasis, paragraph number and resulting element.
This is a reading preview, deliberately labelled as such. It does not pretend
to reproduce Word's pages or introduce a second pagination engine. The actual
script uses the existing format and paginator after import.

<a id="IMPT-57"></a>

**IMPT-57** Selecting a paragraph shows its current element, source style, and the reason
for the classification. The inspector's Element popup changes that paragraph.
**Use for This Source Style** applies its chosen element to matching paragraphs;
the affected count is visible. Individual corrections take priority. **Reset All
Corrections** restores the initial reading without rereading the source.

<a id="IMPT-58"></a>

**IMPT-58** Unrecognized and inferred lines carry both a question marker and accessible
words. Colour alone never encodes uncertainty. No fake confidence percentages.
Review is available, not a checklist that forces approval of every line.

<a id="IMPT-59"></a>

**IMPT-59** Long drafts have a searchable, paged preview of 50 paragraphs per view. Every
paragraph is reachable. Filtering never changes the imported content. Changing
reading mode or fixing a cue recomputes the interpretation of following lines.

<a id="IMPT-D103"></a>

#### Recognition policy

- <a id="IMPT-60"></a> **IMPT-60** Explicit source semantics win, followed by named paragraph styles.
- <a id="IMPT-61"></a> **IMPT-61** Unstyled text can recognize act/scene headings, conventional scene slugs,
  short uppercase cues, parentheticals and dialogue following a cue.
- <a id="IMPT-62"></a> **IMPT-62** Every heuristic result is marked for review. Prose stage directions can
  resemble dialogue; the app never claims certainty about them.
- <a id="IMPT-63"></a> **IMPT-63** **Keep as Stage Directions** disables guesses for unstyled paragraphs.
- <a id="IMPT-64"></a> **IMPT-64** Unknown FDX elements keep their text as stage directions rather than being
  guessed from capitals.
- <a id="IMPT-65"></a> **IMPT-65** An orphan Dialogue or Parenthetical blocks creation with its paragraph
  number and a correction instruction. The preview must not promise a speech
  that Fountain would reopen as action.
- <a id="IMPT-66"></a> **IMPT-66** Import does not edit a writer's wording. General editing happens after
  creation in the normal editor.

<a id="IMPT-D7"></a>

### Preservation and fidelity

<a id="IMPT-67"></a>

**IMPT-67** Word tables are flattened by row and cell. Text boxes are included without
duplicating their nested paragraphs. Images, source page geometry and running
headers/footers remain in the original. Inserted tracked text is included and
deleted tracked text omitted, with a notice. Footnotes, endnotes and comments
are appended under named headings; source anchors remain in the original.

<a id="IMPT-68"></a>

**IMPT-68** FDX title-page text is retained: the first nonempty paragraph supplies the
title, and additional title-page text is placed in Contact with a notice to
review it. This avoids inventing author/contact semantics from visual position.
Production revision colours, locked pages and proprietary app metadata are not
converted. Basic emphasis is supported, not the full source app style system.

<a id="IMPT-69"></a>

**IMPT-69** RTF and ODT are editable text routes, not facsimile conversion. Complex notes,
tables and revision metadata require review. Scrivener exports cannot carry a
whole Binder's research, snapshots, labels, corkboard cards and compile settings.
Those remain in the Scrivener project.

<a id="IMPT-D8"></a>

### Commit, cancellation and failures

<a id="IMPT-70"></a>

**IMPT-70** Creating a play follows the existing workspace transition queue and guarded
writers. An open play must settle its unsaved buffers before the vault scope
changes. If that fails, import stays in review.

<a id="IMPT-71"></a>

**IMPT-71** The scaffold creates the Fountain script and `Originals/<source filename>`,
then writes the `.proscenium` file last. That last file is the discovery signal.
The source name is sanitized with the existing cross-platform naming rules;
its extension is retained. A colliding play name receives the existing unique
name suffix. Every file is create-only, including the binary source.

<a id="IMPT-72"></a>

**IMPT-72** If creation fails, the original selection and corrections remain in memory.
The app says an incomplete folder may remain. Do not delete that folder
automatically: another process could have added writing. If opening a completed
play fails, report that separately rather than encouraging another import.

<a id="IMPT-73"></a>

**IMPT-73** While creation is in progress the commit latch prevents double submission and
the controls that could replace the source are disabled. Cancel is available
while reading/reviewing; it terminates the parser and writes nothing. Closing
the application does not persist an unfinished review.

<a id="IMPT-74"></a>

**IMPT-74** After success, open the new play and announce where the original is kept.
For multiple selections, advance to the next review with the completed count;
Skip affects only the current file. Earlier successful imports remain when the
writer chooses Done. This is a sequence of independent imports, not an
all-or-nothing batch transaction.

<a id="IMPT-D9"></a>

### Accessibility and responsive behavior

<a id="IMPT-75"></a>

**IMPT-75** Reuse `Sheet`, `Button`, `PopupButton`, `Checkbox`, the layer stack and live
announcer. Tab stays in the sheet; Escape closes the topmost popup before it
can cancel import. There is deliberately no implicit Enter-to-create action:
Return in the name field must not create a play before the writer reviews it.

<a id="IMPT-76"></a>

**IMPT-76** Use visible labels that appear in accessible names. The filename and reading
completion are announced. A keyboard can choose every paragraph, change its
element, map a style, search, change pages and create/cancel without dragging.
The sheet footer stays available while the body scrolls. At narrow widths the
inspector stacks below the preview. Existing theme, enlarged-text and
reduced-motion preferences apply. Shared sheets keep a 52px window title bar
above their content, clear of the native traffic lights. The modal's title bar
and sheet heading both pass mouse events to Tauri's drag handler; pressing
either never dismisses the import. Interactive heading controls remain controls.

<a id="IMPT-D10"></a>

### Engineering boundaries

- <a id="IMPT-77"></a> **IMPT-77** Adapters produce `ImportDocument`: ordered paragraphs, inline marks, source
  styles, optional explicit element types, front matter and notices.
- <a id="IMPT-78"></a> **IMPT-78** Classification and corrections are pure TypeScript. The existing Fountain
  serializer owns output syntax; the existing layout engine owns pagination.
- <a id="IMPT-79"></a> **IMPT-79** Adapters run in a cancellable module worker with a 30-second watchdog.
- <a id="IMPT-80"></a> **IMPT-80** The document bound is 16 MiB for selected files and individual archive members,
  64 MiB for total declared ZIP expansion, 4,096 entries, 20,000 paragraphs,
  100 XML/RTF nesting levels and 250,000 XML nodes.
- <a id="IMPT-81"></a> **IMPT-81** XML DTDs/entities are refused. No scripts, document macros, network resources
  or external relationships execute. The review renders text through React.
- <a id="IMPT-82"></a> **IMPT-82** `fflate` supplies archive decoding; `@xmldom/xmldom` supplies a DOM in the
  worker and test runtime. No converter service or shell automation.
- <a id="IMPT-83"></a> **IMPT-83** Native source reads require an existing OS-open grant and use bounded reads.
  Binary creation decodes a bounded payload into the existing atomic guarded
  writer, with an impossible expected hash to refuse replacement.
- <a id="IMPT-84"></a> **IMPT-84** No changes to real writer data or the installed application are part of
  verification. Use fixtures, browser mock storage and native temporary vaults.

<a id="IMPT-D11"></a>

### Acceptance

<a id="IMPT-85"></a>

**IMPT-85** Required acceptance coverage: styled Word, real macOS-produced Word output,
RTF Unicode and group scopes, ODT styles, FDX emphasis/lyrics/dual cues, unchanged
Fountain, correction precedence, malformed and oversized inputs, source-byte
round trips, source-copy failure ordering, native no-clobber writes and Finder
routing. Full unit/native suites and the layout/design/type gates remain required.

<a id="IMPT-86"></a>

**IMPT-86** Before advertising unrestricted Word-template fidelity, collect actual
playwright documents across Word, Google Docs, Pages and Scrivener; compare the
first, middle and last scenes, every character and every non-body note against
the source. Synthetic fixtures and one platform-produced document do not prove
coverage of every real-world template. Native VoiceOver/WKWebView and platform
open-event checks are release QA, distinct from browser smoke tests: the native
self-test in the real WKWebView, whose accessibility tree it holds
(docs/app/preferences-and-help/accessibility.md#A11Y-16), never a person's pass.

## Design

The import pipeline in `src/import/` reads bounded source bytes into an intermediate paragraph model. Recognized styles, deterministic inference and writer corrections remain distinct. The review sheet owns cancellation and focus while preserving the open writing session.

A Pages document is an object graph ([IMPT-D12](#IMPT-D12)). `iwa.ts` decodes its archives: each `Index/*.iwa` is a run of raw Snappy chunks, and the decompressed stream is a sequence of objects, each a header naming its identifier and message types, then its protocol-buffer messages. That decoder is the import's own, about two hundred bounded lines, rather than a dependency: the wire format is small and stable, and a general protocol-buffer library would bring schemas Apple does not publish. `pages.ts` walks what it can account for, from the document object to its body text storage, the storage's run tables (paragraph styles, character styles, anchored objects, footnotes), the styles' names and parents, and the tables' tiles and value lists. Anything else stays in the original.

Commit creates script and original source bytes through create-only guarded writes before publishing the play file. Finder, picker and drop routes share the pipeline. Parsing tests cover malformed and oversized input; native tests cover source preservation and no-clobber writes; smoke drives the correction and commit flow.
