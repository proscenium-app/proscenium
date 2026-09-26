# Formats and layout

[Formatting and export](README.md) › Formats and layout

Formats supply page geometry, element treatment and pagination policy. This contract also covers opening pages, PDF structure, the format designer and the complete file schema.

[Bundled formats](#FMT-D101) · [Pagination](#FMT-D105) · [PDF](#EDIT-D104) · [Anonymous copies](#FMT-D108) · [.docx and .odt](#FMT-D109) · [Designer](#SET-D104) · [Schema](#SCHEMA-D100)

## Requirements

<a id="FMT-D100"></a>

<a id="FMT-1"></a>

**FMT-1** Requirements and calibration for the built-in formats. All seven built-ins use the shared
paginator and bundled Courier Prime. Changing format changes presentation,
never the script's words or block types. Existing plays keep their format
identifier; revisions to that preset can change page breaks. These are
source-based adaptations, not certified submission templates or exact
reproductions. The receiving theatre's requirements take precedence.

<a id="FMT-D101"></a>

### Sources and encoded treatments

<a id="FMT-2"></a>

**FMT-2** Measurements below are inches from the paper edge. Source PDFs are reference material, not bundled app assets.

| Built-in | Published guide and sample | Encoded treatment | Requirement |
| --- | --- | --- | --- |
| Dramatists Guild Modern | [Modern Play Format](https://www.dramatistsguild.com/sites/default/files/2019-12/modernformat-New.pdf) | Letter, binding margin 1.5, other margins 1; cue and upright block directions at 4, parentheticals at 3.5, full-width dialogue. Courier 12/14.4 substitutes for the sample's proportional type. | <a id="FMT-3"></a>FMT-3 |
| UK / International (BBC) | [BBC Writersroom Stage Format, Matt Carless, 6 February 2004](https://downloads.bbc.co.uk/writersroom/scripts/stage.pdf), pp. 2–3 | A4, one-inch margins, 12-point single-spaced Courier. Cue at 1, dialogue at 2.5 on the same row, capitalized directions at 3.5. Act and scene share a row; a standalone scene returns to the left margin. New acts/scenes start sheets. Bottom-centred `-1-` page numbers include the first script page. | <a id="FMT-4"></a>FMT-4 |
| Dramatists Guild Traditional | [Traditional Play Format](https://www.dramatistsguild.com/sites/default/files/2020-01/traditionalformat-New.pdf), annotated excerpt from *Not About Nightingales* | Letter; binding margin 1.5, other margins 1. Cue begins at 4, speech at 1.5, directions at 3, parentheticals at 3.5. Directions are roman and parenthesized. | <a id="FMT-5"></a>FMT-5 |
| Dramatists Guild Musical | [Musical Format](https://www.dramatistsguild.com/sites/default/files/2019-12/musicalformat-New.pdf), annotated excerpt from *Applause* | Traditional speech geometry; uppercase, roman lyrics indented from dialogue. Soft line breaks preserve phrasing inside a stanza; separate lyric blocks leave a blank row. Dual cues pair sung as well as spoken passages. | <a id="FMT-6"></a>FMT-6 |
| Samuel French / Concord Manuscript | [Samuel French Formatting Guide](https://www.dramatistsguild.com/sites/default/files/2020-01/General-SFI-Formatting-Guidelines-Complete.pdf), seven-page guide with manuscript sample | Bound submission margins, 12-point Courier, cues at 3.5, directions three indents from the left margin, indented uppercase lyrics. New scenes start sheets, a scene immediately following an act stays with it. Scene headings are underlined. Title starts halfway down; contact details sit at the lower right. Continuous script-page numbers and `(Cont.)` cues. | <a id="FMT-7"></a>FMT-7 |
| Sketch Comedy — Sketchworks | [Sketchworks Comedy formatting sample](https://www.sketchworkscomedy.com/downloads/Sketch-Formatting-Sample.pdf) | Letter, one-inch margins, Courier 12/13.6; bold left title, byline, date, characters and setting on page one. Cues at 3.5, dialogue at 2.5 in a 3.5-inch column, italic parentheticals at 3, full-width action. Right-aligned end cues and page numbers, including page one. | <a id="FMT-8"></a>FMT-8 |

<a id="FMT-9"></a>

**FMT-9** The [Guild's overview](https://www.dramatistsguild.com/script-formats) permits
12-point Courier and defines the binding margin. Its Traditional sample uses
Courier; the Musical sample uses proportional type. We retain Courier Prime
for its shared editor/PDF metrics. The Guild presets follow the samples'
14.4-point baseline pitch. Musical's lyric indent is 0.4 inches, normalized
from its own sample (about 1.925 inches from the edge versus dialogue at 1.517),
rather than borrowed from another guide. Traditional
cue placement follows the sample's fixed 4.017-inch start, normalized to 4,
rather than centring each differently sized name.

<a id="FMT-10"></a>

**FMT-10** The Samuel French entry is a **manuscript submission format**. It is not a
typeset acting edition. [Concord's acting editions](https://www.concordtheatricals.co.uk/resources/acting-editions)
are published books with edition-specific typography. No public, universal
acting-edition stylesheet was established in this research. Proportional book
typesetting remains separate work; this release must not claim to reproduce it.

<a id="FMT-D102"></a>

### Confidence and adaptations

<a id="FMT-11"></a>

**FMT-11** The guides are real and key positions were measured from the source PDFs.
That supports confidence in the named conventions, not 100% fidelity to every
sample or acceptance by every theatre. The Guild explicitly calls its formats
suggestions. UK / International here means the BBC stage convention, not a
claim that all countries or British theatres use it.



<a id="FMT-12"></a>

**FMT-12** Sketchworks is the source for the sketch preset. Second City's historical
[sketch handout](https://staging.secondcity.com/wp-content/uploads/2017/12/writing-sketch-format.pdf)
also puts identifying details on page one, but uses full-width dialogue and a
title/page header. These are different theatre conventions. This preset must
not be presented as an exact Second City template.

<a id="FMT-13"></a>

**FMT-13** Sketchworks uses Courier New and a different page-number face. We use bundled
Courier Prime throughout, normalize its measured indents to half inches, and
apply the body's 13.6-point grid to the opening too. The reference opening has
slightly looser byline/date spacing. Contact details, when supplied, remain
in the compact opening. Cast descriptions appear in parentheses. Technical
cue wording and underlining are authored text, not automatically inserted.

<a id="FMT-D103"></a>

### Proscenium House

<a id="FMT-14"></a>

**FMT-14** House optimizes a working script for finding a cue, reading aloud,
and making rehearsal notes. This is a design judgment, not a claim that one
layout is optimal for every play or that page count measures performance time.

- <a id="FMT-15"></a> **FMT-15** Keep Letter, 12-point Courier and a 1.5-inch binding margin. Familiar paper,
  legible type and space for binding are useful defaults.
- <a id="FMT-16"></a> **FMT-16** Use a 14.4-point line pitch: 45 body rows instead of the old 41. It keeps
  breathing room while reducing unnecessary page turns.
- <a id="FMT-17"></a> **FMT-17** Start every bold uppercase cue at the same 4-inch position. A stable left
  edge makes names easy to scan; bold separates them from dialogue.
- <a id="FMT-18"></a> **FMT-18** Keep speech full width. Long speeches use fewer lines and page turns.
- <a id="FMT-19"></a> **FMT-19** Put block directions in a broad five-inch column, inset half an inch from
  both text edges. Upright type keeps long directions readable; parentheses
  and surrounding space separate them from speech. Short parentheticals sit
  half an inch left of the cue, without a blank row before the spoken line.
- <a id="FMT-20"></a> **FMT-20** Keep act/scene headings centered and bold, without extra tracking. Acts
  start new pages; scenes can follow on the same page. Headings and cues travel
  with their following text, and continued speeches repeat their speaker.
- <a id="FMT-21"></a> **FMT-21** Put end cues on the right and number every script page. Keep lyrics uppercase
  in their own inset column, with a blank row between stanzas.

<a id="FMT-22"></a>

**FMT-22** House keeps its stored identifier. A play using House adopts these revisions;
its text, language and chosen format do not change. New plays still default to
DG Modern. A theatre-specific submission should follow that theatre's requirements.

<a id="FMT-D104"></a>

### Authoring conventions and limits

- <a id="FMT-23"></a> **FMT-23** Act/scene numbers remain the author's text. A format does not rewrite
  `ACT ONE` as `ACT I`, or change the case of a heading unless its spec asks.
- <a id="FMT-24"></a> **FMT-24** BBC cues occupy a fixed column. Long names wrap within it. A short
  Parenthetical runs into the following Dialogue, separated by one space.
  A direction that fills the speech column or contains an explicit line break
  keeps its own paragraph. Inline directions already written inside Dialogue
  stay where the author put them. Dual speech uses the app's two-column layout.
- <a id="FMT-25"></a> **FMT-25** The BBC guide does not specify lyrics or dual speeches. Those retain the
  app's authoring conventions. Guild one-page samples do not specify every
  heading or front sheet; those use the existing house conventions.
- <a id="FMT-26"></a> **FMT-26** Stage formats use separate title, cast and setting sheets; the sketch preset
  uses the same metadata in a compact opening on numbered script pages. The Samuel
  French guide's separate copyright box and list of musical numbers are not
  new structured fields in this release. Contact text can include copyright;
  dedicated song metadata stays parked. The Samuel French guide combines cast
  and setting on one sheet; our stage presets retain separate sheets.
- <a id="FMT-27"></a> **FMT-27** No text from the reference plays is redistributed. Regression fixtures use
  the app's sample play and original test dialogue.

<a id="FMT-D105"></a>

### Layout contract

<a id="FMT-28"></a>

**FMT-28** All dimensions remain in format JSON. `frontMatter.placement` chooses separate
front sheets or an inline opening. Inline metadata consumes rows in `paginate`,
so page counts, preview, tagged PDF and the editor agree, including overflow.
`besideNext` places a cue next to its
speech, or an act next to a scene, only when their columns do not overlap.
`standaloneIndentFromMargin` gives an unpaired scene its normal left margin.
`runInNext` joins a one-line parenthetical to dialogue when a space remains.
The engine preserves source offsets while wrapping the first speech line in
the remaining width. Longer directions fall back to separate paragraphs.

<a id="FMT-29"></a>

**FMT-29** The editor decorates the existing blocks. It never changes the document to
make a layout. Adjacent columns have one shared gap because floating boxes do
not collapse margins like paragraphs. The engine, export preview and PDF
consume the same positions. Continuations retain source positions, and cues
travel with speech at a page boundary. Act/scene headings stay together.

<a id="FMT-30"></a>

**FMT-30** `suffix` adds printed punctuation, `underline` sets element-level underlining,
and `frontMatter.contactAlign` places title-page contact text. Old custom
formats inherit neutral defaults. The designer preserves these fields when
duplicating or saving; the JSON exposes the advanced layout options.

<a id="FMT-D106"></a>

### Language contract

<a id="FMT-31"></a>

**FMT-31** Document menu > Play Language selects English (US), English (UK), or a BCP 47
code. The canonical code lives in `settings.language`, through the existing
guarded play-file writer. A failed save leaves the sheet open. Cancel changes
nothing. Export PDF offers the same setting. Older plays default to `en-US`.

<a id="FMT-32"></a>

**FMT-32** Format and language are independent. Selecting UK page geometry never changes
the language of an existing American play. The code sets the script and
document surfaces' accessibility language and the exported PDF language.
Script spelling selects the bundled American or British Hunspell data.
Bare `en` uses American spelling. Other regional English variants and other
languages retain their language tag but have no bundled spelling check; the
language sheet says so. They never fall back silently to American spelling.

<a id="FMT-33"></a>

**FMT-33** Loading is cached per dictionary. Changing language clears the old dictionary
immediately; a late load cannot overwrite the current selection. Learned words,
cast names and theatre vocabulary continue to apply. Language changes do not
dirty the script, change undo history, or replace its editor.

<a id="FMT-D107"></a>

### Verification

- <a id="FMT-34"></a> **FMT-34** Unit checks cover registry/serialization/designer round trips, source
  geometry, page boundaries, run-in directions, long cues and speeches,
  lyric stanzas, sung dual passages and regional spelling data.
- <a id="FMT-35"></a> **FMT-35** Shared smoke checks exercise the published formats and House with their export previews,
  compare actual cue/speech baselines, operate Play Language by keyboard, and
  check live British/American/unsupported-language transitions in both schemes.
- <a id="FMT-36"></a> **FMT-36** PDF review renders the sample play in each new format and inspects the
  resulting pages. Native self-test runs the shared checks in WKWebView.
- <a id="FMT-37"></a> **FMT-37** Public release still requires the signing setup and remote in `RELEASING.md`.

<a id="EDIT-D102"></a>

### House stage-format rules (`stage-us-modern`)

<a id="FMT-38"></a>

**FMT-38** House is an app-designed reading and rehearsal style, separate from the Guild's Modern format.
[Rationale and provenance](#FMT-D103).

<a id="FMT-39"></a>

**FMT-39** Every metric lives in `formats/stage-us-modern.json`; the engine and renderer
consume the spec. New plays still default to `dg-modern`. Existing House
plays keep their id and reflow with the revised preset.

| Property | Value | Requirement |
|----------|-------| --- |
| Paper | US Letter, 8.5" × 11" | <a id="FMT-40"></a>FMT-40 |
| Font | Courier Prime, 12-point type on a 14.4-point pitch; 45 body rows | <a id="FMT-41"></a>FMT-41 |
| Left (binding) margin | **1.5"** | <a id="FMT-42"></a>FMT-42 |
| Top / right / bottom margins | **1.0"** | <a id="FMT-43"></a>FMT-43 |
| Dialogue | Full width: left margin → right margin (1.5"–7.5") | <a id="FMT-44"></a>FMT-44 |
| Character cue | Bold uppercase, fixed left edge at 4 inches | <a id="FMT-45"></a>FMT-45 |
| Parenthetical (wryly) | Upright and parenthesized, left edge at 3.5 inches | <a id="FMT-46"></a>FMT-46 |
| Stage direction (Action) | Upright and parenthesized, 2–7 inches; blank row on either side | <a id="FMT-47"></a>FMT-47 |
| Act heading | **Centered**, ALL CAPS, bold. "ACT ONE" | <a id="FMT-48"></a>FMT-48 |
| Scene heading (structural) | **Centered**, bold. "SCENE 1" | <a id="FMT-49"></a>FMT-49 |
| Scene Heading (locale line) | Italic, same wide inset as block directions | <a id="FMT-50"></a>FMT-50 |
| Transition | Right-aligned, ALL CAPS | <a id="FMT-51"></a>FMT-51 |
| Lyrics | Uppercase, inset half an inch; blank row between stanzas | <a id="FMT-52"></a>FMT-52 |
| Page numbers | Top right on every script page | <a id="FMT-53"></a>FMT-53 |

<a id="EDIT-D103"></a>

#### Front matter

<a id="FMT-54"></a>

**FMT-54** House front matter, in order, each starting on a new page in print:

1. <a id="FMT-55"></a> **FMT-55** **Title page** — Title (centered), author/credit, contact + draft date (lower left).
2. <a id="FMT-56"></a> **FMT-56** **Character page** — heading **CHARACTERS** (or "CAST OF CHARACTERS"); the cast list with brief descriptions.
3. <a id="FMT-57"></a> **FMT-57** **Opening notes** — optional prose for setting, time, place, dedication or other introductory text. Writers can put it before or after Characters.
4. <a id="FMT-58"></a> **FMT-58** **AT RISE** — at the top of the first scene, a stage direction beginning "AT RISE:" describing what the audience sees as the lights come up.

<a id="FMT-59"></a>

**FMT-59** The title and notes are edited through **Edit Opening Pages**. The title can use structured fields or custom prose. The editable **Characters Page** sits above **Cast Tools**, and becomes independent of cast management after a writer edits it. Writers can return to an automatically generated page. Prose supports headings, bold, italic, lists and paragraph alignment. These values remain in the Fountain title page, using the extension fields documented in docs/app/keeping-work/storage-and-file-format.md#STOR-D6, with AT RISE as the opening stage direction. Exact serialization in [`fountain-data-model.md`](../../engineering/fountain-model.md#FOUN-D107). Because all of this is Fountain-expressible, it is canonical in the `.fountain` file, not a sidecar (storage rule 3).

<a id="FMT-60"></a>

**FMT-60** `paginateFrontMatter` in the shared layout engine supplies the editor and PDF
with every front-sheet line and position. Long titles, contact details, cast
entries and setting text continue onto additional unnumbered sheets. Spacing
and type styles come from the format's `frontMatter` fields; the export dialog
counts the actual sheets. Short cast entries stay together when they fit.

<a id="EDIT-D104"></a>

### PDF reading structure

<a id="FMT-61"></a>

**FMT-61** Export preserves the layout engine's drawing positions and adds a PDF 1.7
structure tree: headings, paragraphs, cast lists, and speech groups with speaker,
dialogue, and stage-direction roles. The tree follows source order, including
the whole left speech before the right speech in dual dialogue. Wrapped lines
share their paragraph across pages. Repeated page furniture and continuation
cues are artifacts; an excerpt retains its initial continuation cue as its
speaker. Front matter precedes the script in reading order.

<a id="FMT-62"></a>

**FMT-62** The Export PDF sheet accepts a BCP 47 language code (for example `en-US`, `fr`,
or `zh-Hant`). Export saves it for the play before writing the PDF. Cancel does
not change it, and a refused save leaves the dialog open. Existing plays default
to `en-US`. Document menu > Play Language offers the same setting and selects
American or British script spelling. Other languages have no bundled checker.
Script and document surfaces inherit the play's language for screen readers.
See [script-formats.md](formats-and-layout.md). The structure
and parent-tree links are tested against generated bytes; assistive-reader
verification remains a separate check. No PDF/UA conformance is claimed.

<a id="FMT-63"></a>

**FMT-63** Structure follows [ISO 32000 logical structure](https://pdf-issues.pdfa.org/32000-2-2020/clause14.html).

<a id="FMT-D108"></a>

### Anonymous copies

Many contests and festivals read a play without its writer's name. The copy
they receive is a choice made when exporting, not a property of the play: the
writer's own pages keep the name, and the next copy, for an agent or a
director, carries it without anything to switch back.

<a id="FMT-143"></a>

**FMT-143** Export PDF and Print offer **Anonymous copy**. It is off whenever
the dialog opens and is never saved with the play. When it is on, the title
page leaves out the byline, authors and contact details, `{author}` prints
nothing in a header or footer, and the file's properties name no author. A
title page written as prose cannot be taken apart safely, so the copy prints
the title alone in its place. The title, draft date, cast and opening notes
remain. The preview shows the copy, and the suggested file name ends
`(anonymous)`.

<a id="FMT-144"></a>

**FMT-144** When Anonymous copy is on, the dialog looks for each author's
name and each contact line, ignoring case, in every sheet that is going out:
script lines, front sheets, headers and footers, including a name wrapped
across two lines. It names the sheets where they still appear, beside the
option and to assistive technology. It removes nothing and does not stop the
export, because words the writer typed there may be meant.

<a id="FMT-D109"></a>

### Word-processor documents

A theatre's literary office, a dramaturg or a collaborator may ask for the play
in a file they can open, mark up and restyle in a word processor. Export
.docx and Export .odt make that file from the same play, format and choices as
Export PDF. The PDF stays the copy whose pages are exactly the editor's; a
word processor lays a .docx or .odt out again for itself.

<a id="FMT-145"></a>

**FMT-145** File menu › **Export .docx…** and **Export .odt…**, and the same
items in the document menu, open the export dialog with that file type chosen.
The dialog's **File type** choice (PDF, .docx, .odt) switches between them, its
title and export button name the type, and a hint beside the buttons says
that a word processor sets its own page breaks. Part, Pages, Include,
Anonymous copy and Language apply to every type, and the language is saved
for the play before the file is written, as for a PDF
([FMT-62](#FMT-62)). Print always prints the PDF. The suggested name follows
the PDF's rule with the type's extension. The file goes where the writer
chooses in the save panel, through the same atomic write as a PDF; nothing
is written until they choose.

<a id="FMT-146"></a>

**FMT-146** Every script element is a paragraph style named as the element bar
names it: Act, Scene, Scene Heading, Action, Character, Parenthetical,
Dialogue, Transition, Lyric and Centered Text. The opening pages use Title,
Title Page Text, Opening Heading, Opening Text and Cast List; the header and
footer use Header and Footer. An element's style holds its treatment from the
format: column (left and right indents), alignment, capitals, bold, italic,
underline, tracking, the space before it, and the page rules in
[FMT-148](#FMT-148). Capitals are a style property, so the words stay as typed
and a restyle can drop them. The writer's own bold, italic and underline stay
on their words. What the format prints around an element — parentheses, a
suffix, a cue's extension — is text in the paragraph, as it is on the page.
Changing one style changes every element of that kind.

<a id="FMT-147"></a>

**FMT-147** Page size, margins, header and footer distances, typeface, size
and line pitch come from the play's resolved format; the exporter supplies
none of its own. Every line is set at the format's exact pitch and every gap
is a whole number of its blank lines. A word processor adds one paragraph's
space after to the next one's space before, where the layout engine uses the
larger of the two ([FMT-124](#FMT-124)). So a style holds only its space
before, and a paragraph whose engine gap differs — after an element with more
space after, between stanzas of a tight stack, at the top of a page the
element starts — carries that gap itself. A header or footer line is as tall
as the type. A word processor pushes the text down by however far a header
line reaches past the top margin, and on a page exactly so many rows deep even
a point costs a row on every page. So a header or footer line that would
reach past its margin sits nearer the paper edge by the difference, 1.2
points in Dramatists Guild Modern, and the text keeps every row.

<a id="FMT-148"></a>

**FMT-148** The word processor paginates, following the format's rules as
style properties rather than hard breaks at the engine's pages. Keep-with-next
elements keep with the next paragraph. An element that starts a new page has a
page break before it, except a scene straight after its act heading
([FMT-138](#FMT-138)). Elements the engine never splits (headings, cues,
parentheticals, transitions, centered text) keep their lines together.
Dialogue keeps the format's minimum lines before and after a break, and
action and lyrics keep the minimum on either side. An .odt states those
minimums exactly; a .docx can only turn widow control on, which keeps two
lines. A dual-dialogue pair is one table row that never splits, and nothing
in it keeps with the next paragraph: in a table, a reader keeps such a row
with the row below, and a scene of pairs would move as one block. A page break
in the script is a page break. So page breaks and the page count can differ
from the PDF's, and a speech that the word processor splits across a page
does not repeat its cue with the continued marker. Hard breaks at the engine's
pages were rejected: a recipient's missing font, one edited word or a restyle
would push a line past each break onto a page of its own, which is the
opposite of a file meant to be changed.

<a id="FMT-149"></a>

**FMT-149** A dual-dialogue pair is a borderless two-column table at the
format's half-columns, the left speech in the first cell
([FMT-100](#FMT-100)). Paragraphs a format places on one row — a cue beside
its speech or an act beside its scene (`besideNext`), a one-line
parenthetical run into its speech (`runInNext`) — export one under the other,
each in its own column (`standaloneIndentFromMargin` applies). A paragraph
has one style, and a cue merged into its speech would lose which element it
is.

<a id="FMT-150"></a>

**FMT-150** The front sheets the writer includes come first, each kind of
sheet starting a new page, with the lines, alignment, type styles and row
positions of the PDF's sheets from `paginateFrontMatter`. They have no page
numbers, header or footer. A long cast list continues where the word
processor breaks it. A format with an inline opening puts it at the top of
the first script page, followed by its `inlineGapRows`. The script starts
on a new page after any front sheet.

<a id="FMT-151"></a>

**FMT-151** A header or footer is the format's three slots on one line at its
distance from the paper edge, in the body type. `{page}` is the word
processor's page-number field. The script is numbered from 1 and an excerpt
from its first printed page, with the front sheets unnumbered. A format that
suppresses the header or footer on page 1 leaves the first script page bare.
`{title}`, `{author}` and `{draftDate}` print as in the PDF. The act and scene
tokens ([FMT-101](#FMT-101), [FMT-140](#FMT-140) to [FMT-142](#FMT-142)) print
the act and scene in force where each of the word processor's pages begins,
headings that open a page included. An .odt sets them with a field at each act
or scene heading. A .docx starts a new section at each heading, carrying its
values: its header takes effect on the next page, or on the same page when
the heading opens it. A .docx reader that changes headers only at a section
that starts a new page shows the values of the last one that did.

<a id="FMT-152"></a>

**FMT-152** An **Anonymous copy** ([FMT-143](#FMT-143)) leaves the same things
out of a .docx or .odt: the title page's byline, authors and contact details,
whatever `{author}` would print, and the file's author property. The dialog
still names the sheets where the writer's name remains ([FMT-144](#FMT-144)).

<a id="FMT-153"></a>

**FMT-153** The play's language ([FMT-62](#FMT-62)) is the language of every
style and of the file's properties, so a word processor checks the spelling
and a screen reader speaks it in that language. The file's properties name
the play's title, its author (except in an anonymous copy) and Proscenium as
the application that made it. They hold no dates or machine details, so the
same play and choices make the same file. Act, Scene and Scene Heading carry
outline levels 1 to 3, so a reader's navigation and headings find them.

<a id="FMT-154"></a>

**FMT-154** Both files embed the four Courier Prime faces the format names
([FMT-115](#FMT-115)). The SIL Open Font License permits embedding and the
faces allow it. Both mark the family as fixed-pitch, and a .docx also names
the format's next family, Courier New, as its fallback. A reader that ignores
embedded fonts therefore still sets a monospace grid.

<a id="FMT-155"></a>

**FMT-155** Notes and comments stay out, and so do scene summaries and omitted
text unless the format prints them ([FMT-135](#FMT-135)), exactly as in the
PDF. A file sent outside the play is the script as it prints. A note written
for the writer should not travel with it, and a reader who wants to comment
can do so in their own word processor. A format that prints summaries or
omitted text gives them the styles Scene Summary and Omitted Text.

<a id="FMT-156"></a>

**FMT-156** Importing an exported file
([document import](../importing/document-import.md)) returns the same
elements, words and emphasis in the same order, recognized from their styles.
Four things come back differently, and the round-trip tests name them.
Printed decoration returns as text, so a direction the format parenthesizes
keeps its parentheses. Emphasis a format gives a whole element returns as
emphasis on its words. A dual pair returns one speech after the other. Page
breaks are not kept.

<a id="FMT-157"></a>

**FMT-157** Unit tests build both files from test plays and check their parts,
styles, geometry against the format, headers, sections and fields, anonymous
copies and language. They also run the round trip through the importer.
`textutil -convert txt` must read both files, here and on the Mac mini. A
smoke check exports each type from the dialog in the shipped bundle and
checks the file it downloads. The sample play and a Dramatists Guild Modern
play are exported, rendered to PDF by a word processor and checked by eye.


<a id="SET-D104"></a>

### Format designer

<a id="FMT-64"></a>

**FMT-64** A writer can create a format for a theatre, festival or publisher through the format designer.

<a id="SET-D105"></a>

#### Designer behavior

1. <a id="FMT-65"></a> **FMT-65** **Where it lives.** A format surface opened from Settings › Formats (**New
   Format**, **Edit**) and from the document menu's format section (**Edit
   Formats…**). It is large enough to need a live preview, so it is a pane
   surface (like Board or Changes) or a full-window sheet — choose whichever
   keeps the preview biggest, and record the reason in its design.
2. <a id="FMT-66"></a> **FMT-66** **The editor** (left side), grouped as the schema is grouped:
   - <a id="FMT-67"></a> **FMT-67** **Page:** size (Letter, A4); margins, in inches.
   - <a id="FMT-68"></a> **FMT-68** **Type:** Courier Prime only — the engine assumes a monospace grid, and
     non-monospace formats stay parked until a measured-font design exists; size in points; line
     height.
   - <a id="FMT-69"></a> **FMT-69** **Header and footer:** left, centre and right slots, with the tokens
     `{page}`, `{title}`, `{author}`, `{act}` and `{scene}` offered from a menu,
     not typed from memory; distance from the edge; suppress on page one.
   - <a id="FMT-139"></a> **FMT-139** **Page numbering:** the same menu offers the act and
     scene numbers, the act in Roman numerals and the draft date
     ([FMT-140](#FMT-140)), and inserts act-scene-page numbering whole —
     `II-3-67` or `2-3-67` — as ordinary tokens the writer can still edit.
   - <a id="FMT-70"></a> **FMT-70** **Elements:** one row per element type — indent from margin, maximum
     width, alignment, capitals, style, spacing before and after. Each element
     is named the way the element bar names it.
   - <a id="FMT-71"></a> **FMT-71** **Pagination:** the continued marker, whether a cue repeats after a split,
     and the minimum dialogue and action lines on either side of a break.
   - <a id="FMT-72"></a> **FMT-72** **Dual dialogue:** the gutter.
3. <a id="FMT-73"></a> **FMT-73** **The preview** (right side) is the layout engine's real pages at the format
   being edited. It uses the export preview's page renderer; never write a
   second one.
   - <a id="FMT-74"></a> **FMT-74** Sample text is a built-in **format sampler**: a short play that exercises
     every element, a dialogue split across a page, dual dialogue, act and
     scene headings, and a title page. A **Preview with This Play** switch uses
     the open script instead.
   - <a id="FMT-75"></a> **FMT-75** The preview updates as values change, and flags the elements a change
     moved.
4. <a id="FMT-76"></a> **FMT-76** **Rules.**
   - <a id="FMT-77"></a> **FMT-77** Built-ins are read-only. Edit one and you are asked to **Duplicate** it.
   - <a id="FMT-78"></a> **FMT-78** Values are validated with `src/format/validate.ts` as they are typed; an
     invalid value says why, and Save stays disabled until it is fixed.
   - <a id="FMT-79"></a> **FMT-79** Save writes `<app config>/formats/<id>.json` through a new Rust command,
     with the vault's atomic write. The id is a slug of the name, and a
     collision asks for another name.
   - <a id="FMT-80"></a> **FMT-80** Unsaved changes are named on close.
5. <a id="FMT-81"></a> **FMT-81** **Around a format.**
   - <a id="FMT-82"></a> **FMT-82** **Use for This Play** sets the play file's house style.
   - <a id="FMT-83"></a> **FMT-83** **Default for New Plays** is a setting.
   - <a id="FMT-84"></a> **FMT-84** **Import…** validates a `.json` and copies it in.
   - <a id="FMT-85"></a> **FMT-85** **Export…** saves one to share with a theatre, or to contribute to
     `formats/`.
   - <a id="FMT-86"></a> **FMT-86** **Delete** moves a user format to the Trash. A play that used it falls back
     to the default, and the writer is told which play.
6. <a id="FMT-87"></a> **FMT-87** **Accessibility.**
   - <a id="FMT-88"></a> **FMT-88** Every field has a visible label and a unit.
   - <a id="FMT-89"></a> **FMT-89** The preview has a text alternative, e.g. "Page 2 of 3: CHARACTER cue at
     3.7 inches".
   - <a id="FMT-90"></a> **FMT-90** The whole designer works from the keyboard.

<a id="SET-D107"></a>

#### Designer acceptance

- <a id="FMT-91"></a> **FMT-91** A writer duplicates DG Modern, moves the cue indent and the page-number slot,
  sees the preview move, saves, uses it for a play, and exports a PDF that
  matches the preview.
- <a id="FMT-92"></a> **FMT-92** Format round-trip tests (designer state → JSON → validate → the same state)
  pass.
- <a id="FMT-93"></a> **FMT-93** Built-in pagination is unchanged: the existing engine tests still pass.
- <a id="FMT-94"></a> **FMT-94** Smoke opens the designer and audits it.


<a id="SCHEMA-D100"></a>

### Format file schema

<a id="FMT-95"></a>

**FMT-95** A format file is one complete, declarative description of how a script lays
out on the page. The renderer and pagination engine are generic: they apply a
format spec to a document and contain **no layout constants of their own**.
One file = one format. Documents never store format values — the play file
(`<Play>.proscenium`) stores only a format **id** (`settings.format`), so
switching formats re-renders with zero document changes.

- <a id="FMT-96"></a> **FMT-96** **Built-in formats** live here (`formats/*.json`) and are bundled into the
  app. `dg-modern` is the app default.
- <a id="FMT-97"></a> **FMT-97** **User formats** are the same JSON shape, dropped into
  `<app-config-dir>/formats/` (macOS:
  `~/Library/Application Support/org.habiby.proscenium/formats/`). The app
  creates the directory on first run. A user format must have its own `id`; a file claiming a built-in id is skipped with a visible warning, and can be imported under a new name. Files are read in filename order.
- <a id="FMT-98"></a> **FMT-98** **The format designer** (Settings › Formats, or the document menu's Edit
  Formats…) makes and edits user formats with a live preview. It saves a new
  format as `<id>.json`, the id a slug of the name, and an existing one back to
  the file it came from; Import… copies a validated file in, Export… saves a
  copy anywhere, and Move to Trash sends a file to the Trash. Built-ins are
  never edited: the designer duplicates one instead. What it writes is compact —
  element fields at their defaults are left out, as they are here
  (`src/format/serialize.ts`).
- <a id="FMT-99"></a> **FMT-99** Loading and validation live in `src/format/` (fail-loud: an invalid user
  file is skipped with a surfaced warning; an invalid built-in throws).

<a id="SCHEMA-D101"></a>

### Schema

```jsonc
{
  "id": "dg-modern",              // [a-z0-9-], referenced by project.json
  "name": "Dramatists Guild — Modern",
  "page": {
    "size": "letter",             // "letter" | "a4"
    "margins": { "left": 1.5, "top": 1.0, "right": 1.0, "bottom": 1.0 } // inches
  },
  "type": {
    "family": "Courier Prime, Courier New, Courier, monospace",
    "size": 12,                   // points
    "lineHeight": 1.2             // × size; 12pt × 1.2 = 5 lines/inch
  },
  "header": {                     // likewise "footer"
    "content": { "right": "{page}." },  // slots: left | center | right; tokens: FMT-101, FMT-140
    "position": 0.85,             // inches from the paper edge: the top of the text
                                  // below the top edge; for a footer, the bottom
                                  // of the text above the bottom edge
    "suppressOnFirstPage": true
  },
  "elements": { /* per-block-type treatment, see below */ },
  "pagination": {
    "continuedMarker": " (CONT'D)",     // appended to a re-printed cue after a split
    "repeatCharacterOnSplit": true,     // re-print CHARACTER (CONT'D) after a page break
    "minDialogueLinesBeforeBreak": 2,   // never fewer dialogue lines at a page bottom
    "minDialogueLinesAfterBreak": 2,    // …or at the top of the next page
    "minActionLinesEitherSide": 2       // same rule for splitting long directions
  },
  "dualDialogue": {
    "gutterIn": 0.2                     // gap between the side-by-side half-columns
  }
}
```

<a id="FMT-100"></a>

**FMT-100** Dual dialogue (Fountain `^`): the pair renders in two half-columns of
`(blockWidth − gutterIn) / 2`. Inside a half, elements use the half's full
width with their own `align`; `indentFromMargin`/`maxWidth` are full-measure
concepts and do not apply. A pair never splits across pages (a pair taller
than a whole page falls back to sequential layout).

<a id="FMT-101"></a>

**FMT-101** Header/footer content strings may use the tokens `{page}`, `{title}`,
`{author}`, `{act}`, `{scene}`; `{act}` and `{scene}` are the ones in force where
the page begins. Both sit in the page margins and never move a line of the
script. The editor, export preview and PDF all draw the header and footer.

<a id="FMT-140"></a>

**FMT-140** Slots may also use `{actNumber}` (2), `{actRoman}` (II),
`{sceneNumber}` (3) and `{draftDate}`, the title page's draft date on one
line. A page that opens with act or scene headings begins in the act and scene
they start: the page that opens with ACT TWO is in Act Two, and it has no scene
until one is named.

<a id="FMT-141"></a>

**FMT-141** Act and scene numbers are the ones the headings give, in digits,
words or Roman numerals after "Act" or "Scene" (`ACT TWO`, `Scene 3: The
Kitchen`, `ACT II`). A heading that names a scene without a number, such as
`SCENE TBD`, takes the next number in its act, and scene numbers start again
after each act heading unless the headings say otherwise. A heading that
names neither, such as `PROLOGUE`, has no number.

<a id="FMT-142"></a>

**FMT-142** An act or scene number with nothing to print takes the separator
between it and the next token with it — or, at the end of a slot, the one
before it. A separator is up to three dashes, dots, colons, slashes or
spaces. So `{actRoman}-{sceneNumber}-{page}` prints `II-3-67`, `3-67` in a
one-act and `67` in a play without scenes, as the Academy for New Musical
Theatre's [Format Guidelines](https://nmi.org/wp-content/uploads/2024/01/Format-Guidelines-2024.pdf)
ask for.

<a id="SCHEMA-D102"></a>

### Front matter

<a id="FMT-102"></a>

**FMT-102** `frontMatter` supplies the shared engine's title, cast and setting layout.
The built-ins state their choices explicitly. Older custom formats
inherit omitted fields from `defaults/front-matter.json`:

| Field | Meaning | Requirement |
| --- | --- | --- |
| `placement` | `separate-pages` (default) makes unnumbered sheets; `inline` puts a compact opening on numbered script pages. | <a id="FMT-103"></a>FMT-103 |
| `inlineGapRows` | Blank rows between the inline opening and script (default 1). | <a id="FMT-104"></a>FMT-104 |
| `titleTopFraction` | Title text starts this fraction down the physical page (default 1/3). | <a id="FMT-105"></a>FMT-105 |
| `titleGapRows` | Blank rows between title, credit and authors. | <a id="FMT-106"></a>FMT-106 |
| `titleContactGapRows` | Minimum blank rows before the contact block, which otherwise sits at the bottom. | <a id="FMT-107"></a>FMT-107 |
| `sectionTopRows` | Rows above cast/setting content and continuation sheets. | <a id="FMT-108"></a>FMT-108 |
| `headingGapRows` | Blank rows below the cast heading. | <a id="FMT-109"></a>FMT-109 |
| `castGapRows` | Blank rows between cast entries. | <a id="FMT-110"></a>FMT-110 |
| `fieldGapRows` | Blank rows between setting fields and before a draft date after contact details. | <a id="FMT-111"></a>FMT-111 |
| `contactBottomRows` | Rows reserved below the title-page contact block. | <a id="FMT-112"></a>FMT-112 |
| `titleFontStyle`, `headingFontStyle`, `bodyFontStyle` | `regular`, `italic`, `bold` or `bold-italic`. | <a id="FMT-113"></a>FMT-113 |

<a id="FMT-114"></a>

**FMT-114** All row fields are nonnegative multiples of the format's line pitch. A short
cast entry stays together when it fits on a sheet; longer entries, titles,
contact details and prose wrap and continue. Separate front sheets remain unnumbered.
Inline openings use `sectionTopRows`, `titleGapRows`, `fieldGapRows` and the
body's wrapping grid; the paginator reserves those rows before placing dialogue.
A long opening continues onto more numbered pages. Title fractions, contact
alignment and bottom anchoring apply only to separate sheets.
The editor, PDF and export sheet count consume `paginateFrontMatter` in the
shared engine. The format designer preserves these fields on save; they can
be edited in the format JSON.

<a id="SCHEMA-D103"></a>

### Element entries

<a id="FMT-115"></a>

**FMT-115** `type.family` must start with `Courier Prime`, the bundled face used by both
the editor and PDF. Optional fallbacks are `Courier New`, `Courier`, and
`monospace`; other faces are rejected until their metrics and PDF embedding
are supported. Names may be quoted. Tracking contributes to the shared
character advance, wrapping, alignment, preview, and PDF text placement.

<a id="FMT-116"></a>

**FMT-116** Keys are the document model's block types (`src/fountain/model.ts`). These
**must** be present: `act`, `scene`, `sceneHeading`, `action`, `character`,
`parenthetical`, `dialogue`, `transition`, `lyric`, `centered`. These may be
omitted and default to non-printing: `synopsis`, `pageBreak`, `boneyard`.

<a id="FMT-117"></a>

**FMT-117** Every field is optional; defaults in parentheses.

| Field | Unit / values | Meaning | Requirement |
|-------|---------------|---------| --- |
| `indentFromMargin` (0) | inches | Column start, measured from the **left text margin** | <a id="FMT-118"></a>FMT-118 |
| `maxWidth` (`"full"`) | inches or `"full"` | Column width cap; `"full"` = indent → right margin | <a id="FMT-119"></a>FMT-119 |
| `align` (`"left"`) | `left/center/right` | Alignment within the element's column | <a id="FMT-120"></a>FMT-120 |
| `textTransform` (`"none"`) | `none/uppercase` | | <a id="FMT-121"></a>FMT-121 |
| `fontStyle` (`"regular"`) | `regular/italic/bold/bold-italic` | | <a id="FMT-122"></a>FMT-122 |
| `letterSpacing` (0) | em | Tracking, included in wrapping and text advance on every surface | <a id="FMT-123"></a>FMT-123 |
| `spacingBefore` (0) | blank lines | Gap above; **collapses**: gap between blocks = `max(prev.spacingAfter, next.spacingBefore)` | <a id="FMT-124"></a>FMT-124 |
| `spacingAfter` (0) | blank lines | Gap below (collapses, same rule) | <a id="FMT-125"></a>FMT-125 |
| `keepWithNext` (false) | bool | Never the last block on a page (cue + wryly stay with their dialogue) | <a id="FMT-126"></a>FMT-126 |
| `parenWrap` (false) | bool | Render literal `( )` around the content (model stays clean text) | <a id="FMT-127"></a>FMT-127 |
| `besideNext` (false) | bool | Place a following speech beside a cue, or a scene beside an act, when their columns do not overlap | <a id="FMT-128"></a>FMT-128 |
| `runInNext` (false) | bool | Run a one-line parenthetical into following dialogue with a space; longer directions retain their own paragraph | <a id="FMT-129"></a>FMT-129 |
| `standaloneIndentFromMargin` (null) | inches or null | Alternate left indent when the element is not beside a preceding block | <a id="FMT-130"></a>FMT-130 |
| `suffix` (empty) | up to eight punctuation characters | Printed punctuation, such as a cue's colon; never stored in the script | <a id="FMT-131"></a>FMT-131 |
| `underline` (false) | bool | Underline the printed element | <a id="FMT-132"></a>FMT-132 |
| `startsNewPage` (false) | bool | Force a page break before this element | <a id="FMT-133"></a>FMT-133 |
| `tightStack` (false) | bool | Zero gap between consecutive blocks of the same type (lyric stanzas) | <a id="FMT-134"></a>FMT-134 |
| `print` (true) | bool | Excluded from pagination/print when false (synopsis, boneyard) | <a id="FMT-135"></a>FMT-135 |

<a id="FMT-136"></a>

**FMT-136** All vertical rhythm is in **blank lines** (multiples of the line pitch,
`type.size × type.lineHeight`), the way typists and the DG samples count
spacing. All horizontal geometry is in **inches**.

<a id="SCHEMA-D105"></a>

### Additional published formats

<a id="FMT-137"></a>

**FMT-137** `stage-uk`, `samuel-french`, `dg-traditional` and `dg-musical` ship alongside
the original two. `sketch-comedy` follows Sketchworks Comedy's published
template, including its compact opening on page one.
[Sources, measured treatments and supported conventions](formats-and-layout.md)
record what each follows. Samuel French / Concord is explicitly the published
manuscript submission guide, not a typeset acting edition.

<a id="FMT-138"></a>

**FMT-138** `frontMatter.contactAlign` is `left` (default), `center` or `right`. It applies
to the contact and draft-date paragraphs on the title sheet. Scenes configured
to start a sheet stay with an immediately preceding act heading.

## Design

`formats/*.json` supplies all page geometry, element metrics and pagination policy. Validation, defaults, serialization and CSS generation live in `src/format/`; the designer in `src/app/formats/` edits that same schema.

`src/layout/engine.ts` is the single paginator. The editor, export preview and `src/pdf/` consume its positions, including opening pages and continuations. Font metrics come from bundled Courier Prime. The PDF exporter adds reading structure without recomputing line or page breaks.

`src/wordproc/` writes the .docx and .odt files ([FMT-145](#FMT-145) to [FMT-157](#FMT-157)). `model.ts` builds one document model that both writers serialize, and it decides nothing about layout. What goes in comes from `paginateDoc`: the text lines on the chosen pages, merged back into their paragraphs, so an excerpt holds exactly the words of those PDF pages. The text itself comes from `blocksFromDoc` under the same format with capitals and element underlining left to the style. The engine's uppercase keeps every string's length, so its line offsets index the same text. Front sheets come from `paginateFrontMatter`, whose lines carry their paragraph's whole text and alignment for writers that flow text. Act and scene numbers come from `numberHeadings` in `src/layout/furniture.ts`, the function the paginator uses. Dual pairs are found by the engine's own pairing rule. `docx.ts` writes WordprocessingML: the document, styles, settings, a font table with the four faces obfuscated as ECMA-376 requires, one header and footer part per distinct set of values, and core and app properties. `odt.ts` writes ODF 1.3: `mimetype` stored first, content, styles with a master page per kind of page, meta, a manifest, and the faces under `Fonts/`. `zip.ts` uses fflate, which the importer already depends on, with fixed entry dates. Delivery reuses the PDF's `save_export`, which takes the type for the panel's title and filter. A .docx or .odt export sends no report event: counting them would add an event to the closed list in [privacy and telemetry](../keeping-work/privacy-and-telemetry.md), which is a change to the published notice.

The header mechanism differs by file type because the readers differ. On 2026-09-24, on the Mac mini, a word processor rendered probe files headlessly. An .odt variable set at each heading printed the value in force at the top of every page, including a page that opens with the heading. A .docx section that starts partway down a page kept the previous header in that reader, which changes headers only at page-starting sections. The published behaviour of the other common .docx reader is to apply a continuous section's header from the next page. Both behaviours match the rule for where a page begins ([FMT-140](#FMT-140)) wherever the heading opens a page.

Calibration measured key positions from each guide's source PDF ([FMT-11](#FMT-11)). Format changes are verified with round trips, measured editor/preview geometry, sample PDFs and the shared browser/native smoke checks.
