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
| Dramatists Guild Modern | [Modern Play Format](https://www.dramatistsguild.com/sites/default/files/2019-12/modernformat-New.pdf) | Letter, binding margin 1.5, other margins 1; cue and upright block directions at 4, parentheticals at 3.5, full-width dialogue. Courier 12/14.4 substitutes for the sample's proportional type. Character names in directions go to capitals as typed ([FMT-163](#FMT-163)): the sample writes MRS. BRISTOL in capitals inside a direction, at her entrance (p. 16), and names no rule. | <a id="FMT-3"></a>FMT-3 |
| UK / International (BBC) | [BBC Writersroom Stage Format, Matt Carless, 6 February 2004](https://downloads.bbc.co.uk/writersroom/scripts/stage.pdf), pp. 2–3 | A4, one-inch margins, 12-point single-spaced Courier. Cue at 1, dialogue at 2.5 on the same row, capitalized directions at 3.5. Act and scene share a row; a standalone scene returns to the left margin. New acts/scenes start sheets. Bottom-centred `-1-` page numbers include the first script page. Character names in directions are left as typed ([FMT-163](#FMT-163)): the directions print in capitals already, so capitals typed would change only the script's text. | <a id="FMT-4"></a>FMT-4 |
| Dramatists Guild Traditional | [Traditional Play Format](https://www.dramatistsguild.com/sites/default/files/2020-01/traditionalformat-New.pdf), annotated excerpt from *Not About Nightingales* | Letter; binding margin 1.5, other margins 1. Cue begins at 4, speech at 1.5, directions at 3, parentheticals at 3.5. Directions are roman and parenthesized. Character names in directions go to capitals as typed ([FMT-163](#FMT-163)), as in the Guild's other American formats and the Samuel French guide it links. The excerpt itself leaves a name in its own case, in “(Jim takes two.)” (p. 16), and names no rule. | <a id="FMT-5"></a>FMT-5 |
| Dramatists Guild Musical | [Musical Format](https://www.dramatistsguild.com/sites/default/files/2019-12/musicalformat-New.pdf), annotated excerpt from *Applause* | Traditional speech geometry; uppercase, roman lyrics indented from dialogue. Soft line breaks preserve phrasing inside a stanza; separate lyric blocks leave a blank row. Dual cues pair sung as well as spoken passages. Character names in directions go to capitals as typed ([FMT-163](#FMT-163)), as for Traditional. The excerpt itself leaves names in their own case in its parentheticals, “(to Margo)” (p. 56), and names no rule. | <a id="FMT-6"></a>FMT-6 |
| Samuel French / Concord Manuscript | [Samuel French Formatting Guide](https://www.dramatistsguild.com/sites/default/files/2020-01/General-SFI-Formatting-Guidelines-Complete.pdf), seven-page guide with manuscript sample | Bound submission margins, 12-point Courier, cues at 3.5, directions three indents from the left margin, indented uppercase lyrics. New scenes start sheets, a scene immediately following an act stays with it. Scene headings are underlined. Title starts halfway down; contact details sit at the lower right. Continuous script-page numbers and `(Cont.)` cues. Character names in directions go to capitals as typed ([FMT-163](#FMT-163)): the guide says “characters' names in directions are in ALL CAPS” (p. 2), and its sample writes “(Exit JOHN, left.)” after John has spoken (p. 7). Its At Rise placeholder is the one exception. | <a id="FMT-7"></a>FMT-7 |
| Sketch Comedy — Sketchworks | [Sketchworks Comedy formatting sample](https://www.sketchworkscomedy.com/downloads/Sketch-Formatting-Sample.pdf) | Letter, one-inch margins, Courier 12/13.6; bold left title, byline, date, characters and setting on page one. Cues at 3.5, dialogue at 2.5 in a 3.5-inch column, italic parentheticals at 3, full-width action. Right-aligned end cues and page numbers, including page one. Character names in directions go to capitals as typed ([FMT-163](#FMT-163)): the sample's one action line with a name writes CHARACTER 1 in capitals after that character has spoken, and names no rule. | <a id="FMT-8"></a>FMT-8 |

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

<a id="FMT-158"></a>

**FMT-158** The format's minimum lines on either side of a page break hold
for the paragraph the break falls in, as well as for the speech or stage
direction. A paragraph is a run of lines with no empty line in it, and a
break between two paragraphs keeps every minimum. So a speech whose last
paragraph opens with a short line, `And` over the rest, never leaves that
word alone at the foot of a page under the paragraphs above it: the page ends
at the empty line before it, and the paragraph opens the next page under the
continued cue. Of the breaks that keep the minimums, the engine takes the
lowest that puts words on the next page's first line, then the lowest that
opens it with an empty line. Where none is on the page the block moves to the
next page whole, as a speech too short to split always has. A paragraph
taller than a fresh page splits where the page ends. A song keeps the rule
it had: a lyric may end a page at any line.

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
| Names in directions | Capitals as typed ([FMT-163](#FMT-163)): an American stage style, which capitalizes a character's name in a direction every time, as the Samuel French guide does ([FMT-7](#FMT-7)) | <a id="FMT-164"></a>FMT-164 |

<a id="EDIT-D103"></a>

#### Front matter

<a id="FMT-54"></a>

**FMT-54** House front matter, in order, each starting on a new page in print:

1. <a id="FMT-55"></a> **FMT-55** **Title page** — Title (centered), author/credit, contact + draft date (lower left).
2. <a id="FMT-56"></a> **FMT-56** **Character page** — heading **CHARACTERS** (or "CAST OF CHARACTERS"); the cast list with brief descriptions.
3. <a id="FMT-57"></a> **FMT-57** **Opening notes** — optional prose for setting, time, place, dedication or other introductory text. Writers can put it before or after Characters.
4. <a id="FMT-160"></a> **FMT-160** **Production notes** — optional notes for whoever stages the play, on a sheet of their own after every other opening page, so they are the last thing read before the script. The sheet is headed **PRODUCTION NOTES**, centered in the format's heading style, with the writer's notes under it at the format's heading and field gaps. Notes with no word to print make no page and no lone heading. Long notes continue on more unnumbered sheets, and a heading in them travels with the line under it. A format with an inline opening ends the opening with them, the heading at the left. [Why, and how they are edited and exported](#FMT-D110).
5. <a id="FMT-58"></a> **FMT-58** **AT RISE** — at the top of the first scene, a stage direction beginning "AT RISE:" describing what the audience sees as the lights come up.

<a id="FMT-59"></a>

**FMT-59** **Withdrawn** (2026-11-15). Replaced by [FMT-169](#FMT-169): every page before the script is a page of its own, written where it prints, and the play's details stay in the Fountain title page as fields the pages show.

<a id="FMT-60"></a>

**FMT-60** `paginateFrontMatter` in the shared layout engine supplies the editor and PDF
with every front-sheet line and position. Long titles, contact details, cast
entries and setting text continue onto additional unnumbered sheets. Spacing
and type styles come from the format's `frontMatter` fields; the export dialog
counts the actual sheets. Short cast entries stay together when they fit.

<a id="FMT-D110"></a>

#### Production notes

A play's production notes tell whoever stages it what the script assumes: how
the parts double, what the set needs or can do without, the music, how the text
marks overlapping lines. The Dramatists Guild's
[script formats](https://www.dramatistsguild.com/script-formats) call
themselves guidelines, not requirements, and put a page of character breakdown
between the title page and the first page of the play. The Samuel French guide
the Guild links from that page adds time and place notes, and any doubling,
with the cast after the cover. Neither names a heading or a place for
production notes. So they follow every page those guides describe, as the last
page before the script, under the plain heading the page's purpose gives it.
Many plays have none, so the page is optional and a play prints none until the
writer fills it.

<a id="FMT-161"></a>

**FMT-161** **Withdrawn** (2026-11-15). Replaced by [FMT-169](#FMT-169): production notes are a page like any other, added from the Production Notes scaffold, which starts unticked for export.

<a id="FMT-165"></a>

**FMT-165** **Withdrawn** (2026-11-15). Replaced by [FMT-169](#FMT-169): every page before the script, the title page among them, is edited where it stands, with one click.

<a id="FMT-166"></a>

**FMT-166** **Withdrawn** (2026-11-15). Replaced by [FMT-170](#FMT-170): Cast reads the pages and never keeps a list of its own in step with them.

<a id="FMT-167"></a>

**FMT-167** **Withdrawn** (2026-11-15). Replaced by [FMT-169](#FMT-169) and [FMT-170](#FMT-170): the pages are written where they print, and the fourth view is Cast again.

<a id="FMT-168"></a>

**FMT-168** **Withdrawn** (2026-11-15). Replaced by [FMT-169](#FMT-169): there is no switch between a title page's fields and a title page written freely; every title page is a page, its facts shown as fields.

<a id="FMT-169"></a>

**FMT-169** **Every page before the script is a page, written where it prints.**
A script's pages before the script (its title page, a Characters page, a note
on the text, a dedication, production notes, any page) are Markdown files in a
folder of the binder that the play file names as that script's
([docs/app/keeping-work/storage-and-file-format.md#STOR-195](../keeping-work/storage-and-file-format.md#STOR-195)),
one file per page, in binder order. In page view they stand above the script in
that order, and one click on any of them, or Return on one reached with Tab,
puts the caret on that page where the click was: the page turns into the prose
editor on the sheet it prints on, set as it prints ([FMT-177](#FMT-177)), its
formatting bar at the top of the script in the element bar's place. Done, Esc
or a click into the script lays it out again. A page with nothing on it yet
stands as a sheet with its name to click.
A page is saved as a binder document is: after a pause and on the way out,
against the version it was written on, kept in Versions, and a change from
elsewhere while words are unsaved asks Keep Mine or Use Theirs. The play's
details (title, subtitle, credit, authors, contact, draft date, source) stay in the
script's Fountain title page, and each is written where a field shows one, on
the page ([FMT-180](#FMT-180)); there is no form that lists them. They are
details, and not only words on a page, because more than the page reads them:
a header or footer prints the title, the author or the draft date, a file's
properties name the title and the author, and an anonymous copy leaves the
author and the contact out. The credit and the source print only where their
fields stand, and are kept as details so any app that reads a Fountain title
page finds them. A page shows them as fields (`{TITLE}`, `{author}`…), so
headers, file properties and an anonymous copy keep working on any title page.
**Add Page…** in the document menu and the Script menu, and beside the pages
themselves ([FMT-175](#FMT-175)), adds a page from a scaffold, where such a
page usually goes, and **Change Template…** gives a page already in the play
another one ([FMT-178](#FMT-178)). A page whose file says `export: false`
starts unticked in an export's Include list. A script's pages after it are kept
and written the same way ([FMT-174](#FMT-174)).

A play begun blank starts with its title page and its Characters page as
files ([FMT-183](#FMT-183)), in a Front Matter folder above its script
([docs/app/keeping-work/storage-and-file-format.md#STOR-195](../keeping-work/storage-and-file-format.md#STOR-195)),
so the binder lists the play's pages from its first minute. A script whose
pages are still its title page's keys (every play made before 2026-11-15, and
one begun from a script the writer already had) prints them as it always did, and nothing is written until the
writer changes a word on one: that change writes every such page as a file, in
an order that cannot lose a word (the script kept in Versions; each file
created, never written over; the folder and the script's claim on it in one
write of the play file; the keys taken out of the script last), and the editing
carries on in the file with the caret where it was.

<a id="FMT-170"></a>

**FMT-170** **Cast is the company, and reads the pages.** The fourth view (⌘4)
lists everyone a page of the play names, before the script or after it, as it
names them, then everyone else who speaks, in the order they first speak, with
their lines, scenes, appearances, sides and notes, and the presence grid. It
edits no page. Each row says which page names that character ("On the
Characters page"), and those words are a way there: a press shows that page
in the script's page view with the caret in it. One who speaks and is named on none
is offered **Add to Characters Page**, which writes their name as a paragraph
of its own on the page that names most of the cast (in bold when that page's
names are), or on a new Characters page when none does, and **Leave Off**,
which the play file keeps (`castHidden`) so Cast does not ask again. A page that holds the cast as a component ([FMT-183](#FMT-183))
names everyone who speaks, so Cast says so of each ("On the Characters page")
and offers nothing to add; a name is in bold on a page that names no one yet.
Names in
directions take the speakers and the names the pages list.

<a id="FMT-171"></a>

**FMT-171** **A script leaves its folder whole, as one Fountain file.** File
menu › **Export Fountain…**, and the same item in the document menu after
**Export .odt…**, save the open script as one `.fountain` file with its pages
before the script in it, for any Fountain app: pages kept as files in a Front
Matter folder ([FMT-169](#FMT-169)) are the play's, and a script that went out
without them would not be the play. There is no dialog. The file goes where
the writer chooses in the save panel (on an iPad, the share sheet:
[docs/engineering/cross-platform.md#PLAT-36](../../engineering/cross-platform.md#PLAT-36)),
named for the script, through the same atomic write as a PDF
([FMT-145](#FMT-145)); nothing is written until they choose.

The file is the script as the app writes it once its pages are files
([docs/app/keeping-work/storage-and-file-format.md#STOR-195](../keeping-work/storage-and-file-format.md#STOR-195)):
its title page holds the play's details (title, subtitle, credit, authors,
source, draft date, contact) and any key the app does not know, and never a page, so a
script whose pages are still its title page's keys goes out as one whose
pages are files does, its pages once. Between the title page and the script's
first line come the pages, in their order, a page whose file says
`export: false` among them, since this is the whole play. A note opens them,
`[[Proscenium: the pages before the script, as written in its Front Matter folder]]`,
and one closes them, `[[Proscenium: end of the pages before the script]]`.
Each page is written as it prints: its fields filled in; a heading, in
capitals, and a centered paragraph as centered text (`> … <`); every other
paragraph as a stage direction forced with `!`, so that no reader takes a line
in capitals for a character's cue; bold, italic and underline as Fountain's
own `**`, `*` and `_`; a list's items one line each, with their markers; and a
page break (`===`) after the page. A page whose words are only fields is the
title page the details already make, and is left out. After the script's last
line come its pages after the script ([FMT-174](#FMT-174)), each after a page
break, written the same way, between
`[[Proscenium: the pages after the script, as written in its Back Matter folder]]`
and `[[Proscenium: end of the pages after the script]]`; one of them that is
only fields is written as what it prints, since no title page stands in for
it. Notes never print, so
another app prints the pages and then the script from a new page, and this app
reads the file back as the same scenes under the pages. An export of a
Fountain file sends no report event, as a .docx or .odt does not.

<a id="FMT-174"></a>

**FMT-174** **A script has pages after it, too.** What follows a play (an
author's note, a production history, production notes, a word about the
author, acknowledgments, a glossary) is written as the pages before it are:
Markdown files in a second folder of the binder, **Back Matter**, that the
play file names as that script's
([docs/app/keeping-work/storage-and-file-format.md#STOR-195](../keeping-work/storage-and-file-format.md#STOR-195)),
one file per page, in binder order. The folder is made with its first page,
just below the script. In page view the pages stand under the script's last
sheet in that order, each on a sheet of its own, and are edited there as any
page is ([FMT-169](#FMT-169)). They are laid out by the loop that lays out the
pages before the script: unnumbered, with no header or footer, from the
format's section top (or a third of the way down, as the file's `layout`
says), in every format, one whose opening runs in with the first numbered page
included, since nothing at the end runs in with a numbered page. The script's
own pages, their numbers and "Page N of M" are unchanged by them. A page
moves between the two sides by being dragged from one folder to the other.

Every export carries them after the script. The export window's rail and
preview show them after the numbered pages, and its Include list names them
under **After the script**; they start ticked when the export runs to the
script's last page and is not sides, and a page whose file says
`export: false` starts unticked. A PDF draws them after the last numbered
sheet, names each in its page labels, and tags them after the script in
reading order; a .docx, an .odt and an .rtf write them as a last section with
no header, footer or page number, each from a new page; Export Fountain writes
them after the script's last line ([FMT-171](#FMT-171)). The anonymous-copy
check reads their sheets as it reads every other.

<a id="FMT-175"></a>

**FMT-175** **The pages' controls stand beside the pages.** A writer who wants
another page, or wants to change one, finds the way where the pages are.

- **In page view**, every sheet before and after the script carries its
  page's name in the corner of the paper outside the text block, where nothing
  prints, and under a pointer or the keyboard's focus the word Edit beside it;
  where there is no hover, it is always shown. **Add Page** stands in the gap
  between the last page before the script and the script's first sheet, and
  in the corner of that sheet's own margin when no page stands before the
  script; a second one stands in the corner of the last sheet's bottom margin,
  for a page after the script. They are the pointer's and the finger's way to
  Add Page…, which the keyboard and a screen reader have in the document menu,
  the Script menu and the folder of pages' own menu: on the page they are no
  control of their own to either, as a sheet's name is not, since a small
  control that scrolls half under the bar at the top of the script is a
  target too small to press. None of it is drawn where the play cannot be
  written, and none of it prints.
- **A page just added opens in view.** Its sheet's top comes under the bar
  with the caret on it, wherever the writer was looking when they added it.
- **In the binder**, a script's folder of pages is drawn as pages, not as a
  folder of notes, and each page in it as a page. A click on a page's row
  shows that page in the script's page view and puts the caret on it, turning
  page view on if it was off: a page has one editor, on its sheet. While a
  page is edited its row is lit, as the open document's is. The folder's menu
  offers **Add Page…** where another folder's offers New, and a page's menu
  offers it first, then **Change Template…** ([FMT-178](#FMT-178)), which the
  folder's menu does not. Open in New Pane still opens a page as a document beside
  the script, with its fields shown as they are on its sheet.
- **A folder of pages is asked about before it goes to the Trash.** It looks
  like any folder, and with it go every page on that side of the script, the
  title page among them. The question names how many pages it holds and says
  the script will print without them; Keep the Pages is the answer Return
  gives. The toast that follows has **Undo**, which puts the folder back with
  every page in it and the script's claim on it, as it does for a single
  document. Any folder that holds only documents is put back the same way; one
  that holds a script, a file that is not text, or more than sixty files is
  not read into memory for it, and its toast says where it went.
- **Add a Page** lists the pages a script can have by where they go, **Before
  the script**, **After the script** and **Either**, each by its name, with
  "In this play" beside one the play already has. Before the script, after
  Epigraph, it lists **Contents** ([FMT-179](#FMT-179)). Beside the list stands the
  chosen page at a size that can be read, laid out by the engine in the play's
  format with the play's details in its fields; a page that starts with no
  words is pictured with a line of what goes on it. Under the picture: what
  the page is for, where it will land among the play's pages ("Goes after
  Title Page."), and a switch that puts it on the other side of the script.
  Opened from a control on one side of the script, it starts on that side's
  pages, at the first one the play does not have. A play has one title page:
  chosen in a play that has one, the button is **Show Title Page**, which
  shows that page in place of making a second. The arrows move between the
  pages, Return adds the chosen one, and a double-click adds the one clicked.

<a id="FMT-176"></a>

**FMT-176** **Withdrawn** (2026-11-25). Replaced by [FMT-180](#FMT-180): a detail is written in its field, on the page, with no box beside the field and no Play Details… form that lists them all.

<a id="FMT-180"></a>

**FMT-180** **A field is where its detail is written, in the field itself.**
On a page being edited, a field (the title, the title in capitals, the
subtitle, the credit, the author, the contact block, the draft date, the
source) is words to write
in, as the rest of the page is: there is no box beside it and no form that
lists the details. A press in a field's words puts the caret where the press
was, and a press on a line of a sheet that is one field alone opens the page
with the caret at the end of that field. On a line that is one field and
nothing else the caret never stands beside the field, only in it, so the
arrows walk from line to line through the fields (Down from the title goes
into the credit, then the author). A field among other words is one object:
Return, Space, or typing with it selected goes into it, and what is typed
replaces its words. The field the caret is in wears the accent ring. The title
in capitals is set in capitals while the caret is elsewhere and shown as the
play keeps it while it is written. A field with no words shows a prompt for
what goes there ("Author's name", "Contact details", "Draft date"), never the
field's name set as if it were the page's words. A page opened in a pane of
its own (Open in New Pane) still shows each field as one object, written
nowhere.

In a field, Return in a one-line field starts a new line of the page under it,
set as that line is (centered under a centered author; under the title, a
line of the page's own words, set where the title is), or above it at the
very start of a field with words; in the contact block, Return is a new row of
the contact. Tab and Shift+Tab go to the next and previous field of the page,
all of its words selected. Esc puts back what the field held and leaves it,
the field selected as one object, and a second Esc ends the page. Backspace or
Delete in a field with no words takes the field off the page, and undo on the
page puts it back; a field selected as one object goes whole, as before. ⌘A
(Ctrl+A on a PC) selects the field's words only, never the whole script that
the next key typed would replace. ⌘→ or End in the middle of a field's words
keeps the caret in the field, at its end. ⌘Z takes back what was typed in the
field and stops there. **Insert Field** with the caret in a field adds the new
field after it, on a line of its own under a field that is its whole line, and
never in its place.

What is left in a field becomes the play's detail as the caret leaves it (a
press elsewhere, Tab, Return, Done, the page ending), written to the script's
Fountain title page as it always was (`Title:`, `Credit:`, `Author:` or
`Authors:`, `Contact:`, `Draft date:`, `Source:`; authors split at commas, the
contact one line a row), so the page, the headers, the file's properties and an
anonymous copy all have it. A one-line field keeps one line; blank rows at
either end of the contact are dropped. A field left as it was writes nothing.

While the caret is in a field, one quiet line beside it says what that detail
is and what else shows it. The line is a caption over the page, never on it:
it stands on the field's own line where the paper beside it is clear, under
the field where it is not, takes no press, and is the field's description to
a screen reader. It says: the
title, "Also in headers and the file's properties."; the subtitle, "A line
under the title. Left empty, it prints nothing."; the credit, "The line
between the title and the author."; the author, "Also in headers. An anonymous
copy leaves it out."; the contact, "An anonymous copy leaves it out."; the
draft date, "Printed as you write it."; the source, "What the play is based
on." With the caret in no field there is no line.

A play with no author says so where the name will print: in page view, on a
sheet that can be written on, the line reads **Author's name**, quieter than
the page's words and marked as something to fill in, and a press on it opens
the page with the caret in the empty author field. It is drawn in the app
alone; print and every export lay out the play's own details and never draw it.

Unit tests write a field in place and read back what it keeps: the title in
capitals written as the play keeps it, and what is left in a field kept as one
line or as the contact block's rows.

<a id="FMT-177"></a>

**FMT-177** **A page is edited as it prints.** The page's editor is set in the
format's own type on the script's character grid, with no box round it: its
first line stands where the layout puts the page's first line (a third of the
paper down for a title page or a page laid out as one, the format's section
top for any other), the format's gap stands between its paragraphs, a heading
and a title page's title take the format's styles for them, and what follows
the rule that begins a title page's bottom stands at the bottom of the sheet.
So a click on a page changes nothing but the caret. The rule, labelled
**Bottom of the page**, and the shading of a field are the app's and never
print. Nothing else of the app's is on the paper: the page's name, its
formatting, **Move** ([FMT-182](#FMT-182)), the Trash ([FMT-183](#FMT-183)),
**Change Template…** ([FMT-178](#FMT-178)) and **Done** stand in
the bar at the top of the script, and the line that says what the detail
under the caret is ([FMT-180](#FMT-180)) floats beside its field.
Where a paragraph wraps and where a long page breaks onto a second sheet are
still the shared paginator's, when the editing ends. A format whose opening
runs in with the first numbered page has no sheet of the page's own, so there
the page's words start at the top of the editor's sheet.

A line waiting for words keeps how it is set. On a page, a paragraph that is
centered or at the right and has no words is written to its file as a comment
of its own, `<!-- proscenium:line=center -->`, and read back as that empty
line, so a Dedication starts centered a third of the way down and prints
centered once it is written, and an Epigraph's source stands at the right. It
is its own mark, never the alignment's with nothing under it: that one sets
whatever paragraph follows, and an empty centered line written as it would
center the next paragraph when the file was read again. A line with no
alignment and no words is a blank row of the page, kept as
`<!-- proscenium:line -->` when words stand under it
([FMT-182](#FMT-182)); a document that is not a page writes nothing for any
empty line, as before.

Unit tests write plays whose pages are title-page keys and plays whose pages
are files (a title page written freely, centered and right-aligned text, bold
names, lists, fields, an unticked page) and read each file back: the same
title-page keys, the pages as notes, centered text, stage directions and page
breaks before the first scene, and the script's scenes unchanged. A shared
smoke check exports the fixture play from the document menu and reads the
file it saved.

<a id="FMT-178"></a>

**FMT-178** **A page already in the play can take another template.**
**Change Template…** stands in the bar of a page being edited
([FMT-177](#FMT-177)), and in the binder menu of a page's row, second, after
**Add Page…** ([FMT-175](#FMT-175)); the folder of pages has none. For a page
the title page still prints (not yet a file), the bar's button first writes
every such page as a file, as its first change would ([FMT-169](#FMT-169)).

It opens Add a Page's own sheet, titled **Change Template**. Under the title a
line names the page and says it keeps its words and takes the template's
heading and its place on the sheet. The list is the same list of templates by
where they go: the template the page has now is chosen and marked **This
page**, and others the play has are marked **In this play**. The picture is
this page's own words as the chosen template would set them, and a page with
no words is pictured as the template's sample. The line under the picture says
what choosing does: "This page uses this template.", "This play has a title
page.", "The page has no words yet, so it starts as this template does.",
"Keeps its words, and is named NEW NAME." or "Keeps its words and its name."
The sheet's button is **Use Template**, disabled for a second title page, and
for the template the page has while the page stays on its side. Return uses
the chosen one; a double-click uses the one clicked.

**The switch for where the page goes** stands under that line, as it does in
Add a Page (2026-11-25: it was left out of this sheet at first, and a writer
with a page on one side of the script had no way here to put it on the other).
It starts on the side the page is on and stays there whatever template is
chosen, one listed under the other side included: where a template usually
goes says nothing of where this writer wants this page, so a page changes
sides only when the switch is pressed. Pressed, the line under the picture
says where the page will stand as well: "Moves after the script's last page.",
"Moves after LAST PAGE, at the end.", "Moves after PAGE.", "Moves first, before
every other page." or "Moves before the script.", after what the page keeps
when the template changes too. With the template the page has, the button
reads **Move Page** and moves it and nothing else. A title page goes before
the script, so with Title Page chosen there is no switch.

Changing keeps the writer's words, which are all of the page but what its old
template put there (its headings, its lines still waiting for words, and for a
title page or a contents page its fields and the foot rule). They stand under
the new template's first heading, its other headings after them each with a
line waiting for words, and the page sits where the new template's does (at
the top, a third of the way down, or as a title page). A Dedication centers
its lines; an Epigraph centers them and puts the last at the right; a page
that leaves either goes back to the format's own alignment. A page with no
words of the writer's simply becomes the new template's page. A page still
called what a template called it ("Characters", "Blank Page 2") takes the new
template's name, numbered past the play's other pages; a name the writer gave
it is kept. The page stays where it is in the binder and on its side of the
script unless the switch says the other side.

A page sent to the other side goes into that side's folder, its file with its
row, as a row dragged there in the binder does: last, after the script; before
it, where a page of its template is put when one is added
([FMT-175](#FMT-175)). A side with no folder gets one first, as a page added
there would, and a play whose title page still holds its pages has them
written as files first ([FMT-169](#FMT-169)).

A toast follows, saying the page's old and new names when it was renamed and
otherwise which template it now uses, then ", after the script" or ", before
the script" when it moved as well; a page only moved is said to be "now after
the script" or "now before the script". Its **Undo** puts the file and the
name back, and the page where it stood among its side's pages. A folder made
for the move stays, empty, as one whose last page went to the Trash does. The
page is shown where it prints with the caret in it, set as the new template
sets it, and its editor stays open.

The template a page has is the Title Page for a page laid out as a title
page; otherwise the template whose name it still has; otherwise the one whose
headings it has (Characters & Setting before Characters); otherwise, for a
page a third of the way down, Epigraph when a line stands at the right and
Dedication when none does; otherwise Blank Page.

Unit tests change pages from one template to another: each template's own
page known as that template's and a renamed one by its layout and headings,
the writer's words kept under the new heading, a blank page with words become
a centered Dedication, a scaffold's name numbered and a writer's kept, a title
page leaving its fields behind and a page becoming a title page, and every
change laid out in every built-in format with no marker printed. Another
makes the empty folder after the script and moves a page into it and back, its
words whole. Smoke's act "change template" presses the switch: the template
that does not move it, the title page with no switch, Move Page, both at
once, the way back, and Undo from each side.

<a id="FMT-179"></a>

**FMT-179** **A Contents page lists the acts and scenes with their pages.**
**Add a Page** lists **Contents** under **Before the script**, after Epigraph:
"The acts and scenes, each with the page it starts on. It follows the script,
so there is nothing to keep up." Its picture is the play's own contents, and a
script with no act or scene is pictured with the line "The acts and scenes,
with the page each starts on". It lands after the title page, a dedication and
an epigraph, before the characters.

The page is a heading, CONTENTS, and one field, `{contents}`. The field is not
written by hand: in the editor it is one object, shaded as a field, which a
screen reader hears as its rows' names and pages ("Contents: ACT ONE, page 1,
SCENE 1, page 1, …"), never their dots. With no act or scene it shows the
prompt "The acts and scenes, once the script has them" and prints nothing, and
a Contents page that then holds its heading alone prints nothing either
([FMT-183](#FMT-183)). The heading and anything else on the page are the
writer's. **Insert Field** offers **Contents** on any page. The contents are a
component of the page, with a setting of their own: whether an act carries
its page ([FMT-184](#FMT-184)).

The rows are every act and scene in order, each named as the format prints
its heading, so a renamed act or scene is listed by its new name. A scene
stands two cells in under its act, leader dots fill every other cell, and at
the right stands the number of the script's page its heading is on. Every row
is the same width, two cells short of the text block (58 cells in the default
format). A blank row parts one act from the next. A name too long for its row
runs on to a second line, which carries the page. Scenes are the script's
scene lines, or its scene headings when it has none.

The rows are worked out with the script's page numbers in the binder, after a
save and never at a keystroke, and only for a play with such a page. Every
writer of the pages gets the same rows: the page view, the export window's
preview, a PDF, a .docx, an .odt, an .rtf and Export Fountain
([FMT-171](#FMT-171)). They are never written to the script's title page. In
a format whose opening runs in with the first numbered page, the contents are
part of what the script is paginated around, so the script is paginated with
rows of the same count standing in for them.

Unit tests hold the rows' order, indent, width, dots and pages, the blank row
between acts, a long name's second line, a play with scenes alone and a script
with neither, a page that prints its heading alone, the pages of a format
whose opening runs in with the contents among them, a title page that never
holds the rows, and what a screen reader hears for the field. A page that
holds its heading alone, for a script with no act or scene, prints nothing.

<a id="FMT-181"></a>

**FMT-181** **A play can have a subtitle.** The subtitle is a detail of the
play, kept in the script's Fountain title page as `Subtitle:`, after the
title. A title page shows it through a field, `{subtitle}`, on a line of its
own under the title, centered, in the format's body type, with the format's
title gap above it. A title page from a new play, and one the script's title
page still prints, has that line: while the page is edited it reads
**Subtitle**, as a prompt, until it has words, and it is written in place as
any field is ([FMT-180](#FMT-180)). With no words it prints nothing and takes
no room, so a play without a subtitle prints as it always did. A title page
that is already a file gains the line from **Insert Field**, which offers
**Subtitle** after the title. A format whose opening runs in with the first
numbered page sets the subtitle under the title there. An anonymous copy
keeps it, as it keeps the title. A subtitle typed as words of the page, with
no field, prints the same and is not a detail.

Unit tests read and write the key, print the subtitle under the title on a
title page from the script's keys and on one that is a file (the same lines
on the same rows), print nothing and take no room without one, set it in an
opening that runs in, and find its line of the file from a press on its line
of the sheet.
<a id="FMT-182"></a>

**FMT-182** **Every block of a page can be moved, and prints where its writer
put it.** A page before or after the script arrives laid out by its template
and prints so with nothing touched. Any paragraph or heading of it, a line
that is a field included, can be put anywhere on its sheet: on any row, at
any cell, beside another block, at the very top or at the bottom. The
template is where the blocks start, never where they must stay.

A page is still lines in order, and a place is never a loose position on the
paper. A block's place is the blank rows above it, the cell its lines start
at, and whether it stands beside the block before it. So two blocks never
print over each other, the order a page is read in is the order it shows, and
every writer of the pages (the page view, the export window's preview, a PDF,
a .docx, an .odt, an .rtf) sets them from the one paginator's rows.

- **A blank line is a row.** A line with no words between two lines of a page
  prints as a blank row, with the gap any line has above it, as the sheet
  shows it while it is written. Return pushes what is under the caret down;
  Backspace on a blank line takes it back up. The blank lines at the very end
  of a page are nothing.
- **Three ways to move a block.** A handle stands just left of the words of
  the block under the pointer (or, with no pointer over the page, the block
  the caret is in): dragged, it carries an outline of the block that snaps to
  the sheet's rows and cells and stands only where the block can. **Move** in
  the page's bar ([FMT-177](#FMT-177)) lists Up a Row, Down a Row, Left a
  Cell and Right a Cell for the block the caret is in. The keys beside each
  do the same: ⌃⌘ and an arrow on a Mac and an iPad, Alt+Shift and an arrow
  on a PC, from a field's own words too. A move is one step to undo, the
  caret stays in the block, and where it now stands is spoken ("Moved to row
  14, cell 27."). The handle is the pointer's and the finger's: it is no
  control to the keyboard or a screen reader, which have the menu and the
  keys.
- **Nothing else moves.** Every other block stays on its row and at its cell:
  the block that followed the moved one is told the rows that keep it there,
  and a block left where the format's own gap would put it is told nothing.
  A block cannot stand where another's words are, or with less than a cell
  between them: a drag's outline stays at the last place it could, and the
  keys step past what is in the way, as a line moved down goes under the
  line below it. The file's order follows the sheet's, top to bottom and left
  to right.
- **Across the sheet.** At the sheet's left a block is set left; with its
  last cell at the right edge it is set at the right; dragged to within a
  cell of the middle it is centered; anywhere else its lines start at that
  cell. Align Left, Center and Align Right in the bar take a block at a cell
  back to the sheet's own columns. Return under a line at a cell starts the
  next line at that cell.
- **Beside another block.** A block put on rows another block has, where
  their words do not meet, stands beside it: a contact at the left and a
  draft date at the right on the same rows. What follows starts under the
  taller of them. If words later grow until the two would meet, the second
  prints under the first.
- **The top and the bottom of the page.** A block moved above the page's own
  first line (above a third of the way down, on a title page) stands in the
  page's head, set from the top of the sheet; a rule labelled **Top of the
  page** under it says so, as **Bottom of the page** does for the foot, and
  neither prints. Any page can have a foot, not only a title page. A block of
  the foot stays in it as it moves up, and the foot still ends on the sheet's
  last row unless a blank row at its end holds it up. The page's own first
  line stays where its layout puts it whatever stands in the head, or under a
  head that reaches further. A head or a foot left with nothing in it loses
  its rule.
- **In the file.** A place is a comment on the line above its block:
  `<!-- proscenium:place rows=3 cell=24 beside -->`, any of the three. A
  blank row is `<!-- proscenium:line -->`. The head's rule is
  `<!-- proscenium:head -->`, a line of its own above the foot's. An app that
  does not know them shows the page's words in order
  ([docs/app/keeping-work/storage-and-file-format.md#STOR-195](../keeping-work/storage-and-file-format.md#STOR-195)).
- **In another format.** Rows and cells are counts of the play's format, not
  inches, so a page keeps its shape on another sheet. A block whose cell
  would run its words off the text block is pulled in. A page that would run
  on to a second sheet only because of rows its writer left gives those rows
  up, the last first, until it stands on one; a page too long for one sheet
  whatever is given up keeps every row.
- **In a file for a word processor.** A .docx, an .odt and an .rtf write a
  block at a cell as a paragraph indented by it, the rows above a block as
  space before it, and blocks side by side as one paragraph for each row
  they take, each block's words at a tab stop where the paginator put them.
  Export Fountain writes each block as a line, in the sheet's order
  ([FMT-171](#FMT-171)): a place on a sheet is not Fountain's to say.
- **What does not move.** A list, a table, a quotation and a rule keep their
  place in the page's order. A page that runs on to a second sheet moves
  only what the move leaves on the sheets it had. A format whose opening runs
  in with the first numbered page has no sheet of the page's own, and there
  nothing moves. A page given another template
  ([FMT-178](#FMT-178)) keeps its words in their order and takes the new
  template's places.

A move is never trusted to its own arithmetic. It is written to the page's
words, laid out by the paginator, and kept only when the moved block stands
where it was asked to and every other block where it stood; otherwise there
is no move. It is worked out on the page as its editor shows it, a prompt in
each detail not yet written ([FMT-180](#FMT-180)), since that is the page
being moved about.

On the sheet, a block's rows and cell are set from the block itself, and a
block beside another is put on its row by measuring where the blocks stand,
as is the page's own first line under a head. As with the rest of a page set
as it prints ([FMT-177](#FMT-177)), this agrees with the paginator on a page
whose lines do not wrap.

Unit tests hold what a file says of a place and reads back; a blank row's
row; rows, a cell, a block beside another and one whose words would meet it;
a head and any page's foot; the rows a page gives up on a shorter sheet; a
move down, up, across, over the line in its way, into the head and back,
beside another at the foot, and up within the foot, each with every other
block where it was; a move refused; a detail not yet written; every built-in
format; and the indent, the rows and the tab stops in a .docx, an .odt and an
.rtf. Shared smoke checks move a block of the title page with the keys, the
menu and the handle and read the page's file and the sheet it prints.

<a id="FMT-183"></a>

**FMT-183** **A play begins with a title page and a Characters page, and any
page can be taken out of it.** A play begun blank has two pages before its
script, each a file from its first minute
([docs/app/keeping-work/storage-and-file-format.md#STOR-195](../keeping-work/storage-and-file-format.md#STOR-195)):
the title page, and a Characters page, since most plays want one. A play
begun from a script the writer already had keeps the pages that script's
title page says.

The Characters page fills itself. It is a heading, CHARACTERS, and the cast,
a component that follows the script: everyone who speaks, in the order they
first speak, each name on a line of its own under the last, in bold. Nothing
is kept up by hand: a new speaker is on the page with the next save, and one
who no longer speaks is off it. The Characters template in **Add a Page** and
**Change Template** is the same page, as is the Characters half of Characters
& Setting, and **Insert Field** offers **Cast** on any page. In the editor
the cast is one object, as the contents are ([FMT-179](#FMT-179)), which a
screen reader hears as its names ("Cast: MARA, JONAH"); with no one speaking
it shows the prompt "Everyone who speaks, once someone does". A writer who
wants a few words beside each name selects it and chooses **Turn into Text**
from its settings ([FMT-184](#FMT-184)): each name becomes a line of the
page, in bold, to be written on, and the page no longer follows the script.
Cast reads either kind of page ([FMT-170](#FMT-170)).

**A page with nothing written on it prints nothing.** A page that holds only
what its template put there (its heading, or its headings, and a component
with nothing to show yet) is a page not yet written. It is no sheet of the
script's print, of an export or of its Include list, and it goes to no
Fountain file; in page view it stands as a sheet with its name, "Click to
write on this page." So a new play's Characters page costs a writer nothing
until someone speaks, and neither does a page added from any template and
left for later. The first word written under a heading prints the heading
with it. A heading the writer gave a page is words of theirs and prints
alone, and so does a title page's title.

**Any page goes to the Trash, the title page too.** A page's row in the
binder has **Move to Trash** in its menu and takes ⌘⌫, as any document's
does. The bar of a page being edited ([FMT-177](#FMT-177)) has it too, as a
button named for the page ("Move to Trash: Characters"), so a page is taken
out where it is written: the editing ends, the file goes to the Trash (the
Recycle Bin on a PC, Proscenium's own on an iPad), its row leaves the binder
and its sheet the script. A page the script's title page still prints is
written as a file first, with every such page, as its first change would
([FMT-169](#FMT-169)), since a page is taken out of a play as a file is. The
toast that follows has **Undo**, which puts the file, its row and its place
among the pages back. A play with no title page prints without one: its
title, its author and its other details stay in the script, where headers, a
file's properties and an anonymous copy read them, and **Add a Page** offers
the title page again. The whole folder of pages is still asked about before
it goes ([FMT-175](#FMT-175)).

Unit tests hold the files a blank play is made with; that every template's
page prints nothing until a word is written on it, before the script and
after it, and goes to no Fountain file; that a heading the writer gave a page
and a title page's title print; the cast's lines, their emphasis and their
rows, nothing while no one speaks, and what Cast is told a page names. Shared
smoke checks begin a play, find its Characters page a sheet to click and no
print, send it and then the title page to the Trash from the page's own bar
and bring each back; write the play's first speech and find the Characters
page printed with the speaker, in bold, and Cast saying the page names her.

<a id="FMT-184"></a>

**FMT-184** **A page is built from components, each with settings of its
own.** What stands on a page is words the writer types and components the
app fills in: the play's details ([FMT-180](#FMT-180)), the contents
([FMT-179](#FMT-179)) and the cast ([FMT-183](#FMT-183)). Each can be put on
any page from **Insert Field**, moved anywhere on its sheet as any block can
([FMT-182](#FMT-182)), and taken off it. A template is an arrangement of
them, already made and already set; nothing about a template's page is fixed
once it is in the play.

A component that follows the script (the contents, the cast) has settings.
Selected, by a press or by the arrow keys, it shows a button just past its
first line, named for it ("Contents settings"); the button, or Return with
the component selected, opens a menu of what can be set. The contents have
**Page Numbers on Acts**, ticked as they come: unticked, an act is its name
alone over its scenes, since an act's page is its first scene's whenever
that scene opens the act, and the number is printed twice. The cast has
**Turn into Text** ([FMT-183](#FMT-183)). A change is one step to undo, the
component stays selected, and the page shows it at once.

A setting is kept with the component, in the page's file, inside the
component's own braces after its name: `{contents acts=plain}`. Each is a
word, an equals sign and a word; a component as it comes has none. A setting
the app does not know is kept as it is written and changes nothing
([docs/app/keeping-work/storage-and-file-format.md#STOR-195](../keeping-work/storage-and-file-format.md#STOR-195)).
Every writer of the pages prints a component as it is set: the page view,
the export window's preview, a PDF, a .docx, an .odt, an .rtf and Export
Fountain.

Unit tests hold what a token says of its settings and reads back, through
the editor's document and to the file again; the contents with and without a
page beside each act, from one pagination, the same rows either way; and
that each page prints its own component as it is set. A shared smoke check
puts the contents on a page, opens their settings by a press and by Return,
unticks Page Numbers on Acts and reads the file, the component and the
printed sheet.

<a id="FMT-185"></a>

**FMT-185** **A play can have a version, which prints on its title page and,
as the writer chooses, in the page header or footer.** The version is free
text ("Draft 3", "Rev. 11/26/2026"), a detail of the play kept in the
script's Fountain title page as `Version:`, after the draft date. It is set
in **Play Version…** in the document menu, after **Add Page…**, a sheet and
never a control on the page: a **Version** box, **Also in** (**Header**, the
first choice, **Footer**, or **Title Page Only**) and, for a header or a
footer, **Side** (**Left**, **Center** or **Right**). Save writes the
version and where it prints; Cancel and Esc change nothing.

On the title page the version stands in the foot, the format's field gap
under the draft date (under the contact when there is no date), set as the
draft date is. A title page the script's keys still print shows it there by
itself, and keeps it when its pages become files. A title page that is
already a file shows it through a field, `{version}`, which **Insert Field**
offers as **Version** and which is written in place as any field is
([FMT-180](#FMT-180)); its caption says "Also in a header or footer, from
Play Version… in the document menu." When the play's title page is a file
with no such field, the sheet adds a tick, **Add a Version line to the title
page**, ticked: Save writes the field as a paragraph of its own under the
draft date's, or at the end of the page, kept in Versions as any page's
change is. Unticked, the page is left as it is, and the field can be put on
it, moved or taken off it later like any other.

Where else it prints is the writer's choice and is kept in the play file
([docs/app/keeping-work/storage-and-file-format.md#STOR-196](../keeping-work/storage-and-file-format.md#STOR-196)).
A play that has not said prints it in the header, on the first side its
format leaves empty (left, then right, then center), so a version written
in a format with the page number on the right prints on the left of the same
line. Header and footer slots may also use the token `{version}`
([FMT-101](#FMT-101)), the version on one line; a format that prints it
itself is left as it is, and the choice adds it nowhere else, so it never
prints twice. In a slot the format already fills, the version comes first,
two spaces before what the format prints there ("Draft 3  12."). The
header's and footer's own rules hold: a format that leaves page 1's header
off leaves the version off it too. A play with no version prints exactly as
its format does, wherever the choice says, and like a number token
([FMT-142](#FMT-142)) an empty `{version}` takes its separator with it. The
page view, the export window's preview, a PDF, a .docx, an .odt and an .rtf
print the version where the choice puts it; an anonymous copy keeps it, as
it keeps the title.

Unit tests read and write the key; print the version on a title page from
the script's keys and on one that is a file, on the same rows, and nothing
without one; add the field to a title page's file under the draft date and
at the end, and not twice; put the version in each band and side, before
what a filled slot prints, nowhere with no version or with Title Page Only,
and not again where the format prints it; and read and refuse the play
file's key. Shared smoke checks open Play Version… from the document menu,
write a version, find it on the title page and in the header of a numbered
page, move it to the footer's right and find it there and not in the
header, and choose Title Page Only and find it in neither.

<a id="FMT-162"></a>

**FMT-162** Export PDF, Export .docx, Export .odt, an .rtf and Print list **Production
notes** among the opening pages under **Include**. Like the others, it starts
ticked for a script that starts at page 1 and unticked for an excerpt or
sides, and the writer can tick or untick it for any export. The preview names
the sheet "Production notes", and a PDF viewer's page labels name it
"Production" ([FMT-159](#FMT-159)). The PDF tags its heading and paragraphs as
it tags the other opening pages' ([FMT-61](#FMT-61)); a .docx or .odt sets them
in Opening Heading and Opening Text, on a page of their own
([FMT-150](#FMT-150)). An Anonymous copy keeps the notes, and the dialog's
search for the writer's name reads them as it reads every sheet going out
([FMT-144](#FMT-144)).

Unit tests hold the sheet's place and order under every built-in format with
separate sheets, its heading, gaps and paragraph ids, notes that print nothing,
long notes over several sheets, the inline opening, the export plan's names and
page labels, the .docx and .odt model, and the block a double-clicked line
opens at. A shared smoke check fills the section from the keyboard, finds the
sheet in page view and in each export dialog's preview, leaves it out of an
export, double-clicks it back into the editor, and empties it.

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

<a id="FMT-159"></a>

**FMT-159** A PDF's page labels are the numbers the script prints, so a
viewer's sidebar, page field and "Go to page" agree with the paper and the
editor's "Page N of M". Script pages are labelled with their printed page
number, an excerpt from its first page, and a gap in an excerpt starts again at
the page after it. Front sheets carry the names the export preview gives them
("Title", "Characters 2") and never a number, so a title page does not move
the script's numbers on by one.

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
the title alone in its place. The title, draft date, cast, opening notes and
production notes remain. The preview shows the copy, and the suggested file name ends
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
Export PDF, and so does an .rtf for a reader that opens neither
([FMT-173](#FMT-173)). The PDF stays the copy whose pages are exactly the
editor's; a word processor lays a .docx, .odt or .rtf out again for itself.

<a id="FMT-145"></a>

**FMT-145** File menu › **Export .docx…** and **Export .odt…**, and the same
items in the document menu, open the export dialog with that file type chosen.
The dialog's **File type** choice (PDF, .docx, .odt, .rtf) switches between
them; an .rtf is chosen there, with no menu item of its own. The dialog's
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
minimums exactly; a .docx or .rtf can only turn widow control on, which keeps
two lines. A dual-dialogue pair is one table row that never splits, and nothing
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
or scene heading. A .docx or .rtf starts a new section at each heading,
carrying its values: its header takes effect on the next page, or on the same
page when the heading opens it. A reader that changes headers only at a
section that starts a new page shows the values of the last one that did.

<a id="FMT-152"></a>

**FMT-152** An **Anonymous copy** ([FMT-143](#FMT-143)) leaves the same things
out of a .docx, .odt or .rtf: the title page's byline, authors and contact details,
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

**FMT-154** A .docx and an .odt embed the four Courier Prime faces the format
names ([FMT-115](#FMT-115)). The SIL Open Font License permits embedding and
the faces allow it. Both mark the family as fixed-pitch, and a .docx also
names the format's next family, Courier New, as its fallback. A reader that
ignores embedded fonts therefore still sets a monospace grid. An .rtf cannot
carry a face in a form readers use, and a reader without the face it names
sets a proportional one, whatever alternative the file gives. So an .rtf sets
the format's next family, Courier New, which every Mac and Windows reader
has. It is marked fixed-pitch, and Courier Prime is drawn to its width, so
lines and pages break in the same places.

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

**FMT-157** Unit tests build each file from test plays and check their parts,
styles, geometry against the format, headers, sections and fields, anonymous
copies and language. They also run the round trip through the importer.
`textutil -convert txt` must read each file, here and on the Mac mini. A
smoke check exports each type from the dialog in the shipped bundle and
checks the file it downloads. The sample play and a Dramatists Guild Modern
play are exported, rendered to PDF by a word processor and checked by eye.

<a id="FMT-173"></a>

**FMT-173** **An .rtf is for a reader that opens neither a .docx nor an
.odt**: an older word processor, a text editor that reads rich text, or a
submission system that asks for one. It holds what a .docx holds, in Rich
Text Format: the same paragraph styles ([FMT-146](#FMT-146)), geometry
([FMT-147](#FMT-147)), page rules ([FMT-148](#FMT-148)), dual pairs as a
borderless row ([FMT-149](#FMT-149)), front sheets ([FMT-150](#FMT-150)), and
a section per heading with its header and footer and a page-number field
([FMT-151](#FMT-151)). A reader of the format does not apply a style to the
paragraphs that name it, so every paragraph states its style's treatment
again. The file is plain ASCII: every other character is a Unicode escape,
so it needs no code page. The language is named by its Windows language
number, from the tag's region or the region the language most likely means;
a language with none is left to the reader. The file's properties name the
title and the author (except in an anonymous copy) and Proscenium, and hold
no dates, so the same play and choices make the same file. Its type is
[FMT-154](#FMT-154)'s.


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
     is named the way the element bar names it. The Action row also has
     **Character names in capitals as you type** ([FMT-163](#FMT-163)).
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
   - <a id="FMT-86"></a> **FMT-86** **Delete** moves a user format to the Trash, or on a system with no trash
     of its own, to Proscenium’s Trash
     ([docs/engineering/cross-platform.md#PLAT-16](../../engineering/cross-platform.md#PLAT-16)). A play that used it falls back
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
`{author}`, `{act}`, `{scene}` (and `{version}`, [FMT-185](#FMT-185)); `{act}` and `{scene}` are the ones in force where
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
`horizontalRule` may be omitted too, and prints ([FMT-172](#FMT-172)).

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
| `capitalizeCastNames` (false) | bool, `action` only | A character's name typed in a stage direction or a parenthetical goes to capitals as it is typed ([docs/app/writing/editor-ux.md#EDIT-202](../writing/editor-ux.md#EDIT-202)). A rule for typing, not printing: the script holds the capitals. Refused on any other element | <a id="FMT-163"></a>FMT-163 |

<a id="FMT-172"></a>

**FMT-172** **A horizontal line is a row of the page with a hairline through
it** ([docs/app/writing/editor-ux.md#EDIT-213](../writing/editor-ux.md#EDIT-213)).
Its entry, `horizontalRule`, defaults to the full text block, margin to margin,
with one blank line above and below (`spacingBefore` and `spacingAfter` 1),
which collapse with its neighbours' as every gap does ([FMT-124](#FMT-124)). A
format may give it another column with `indentFromMargin` and `maxWidth`, or
other gaps; the shipped formats say nothing and take the default, so a format
file written before the line existed draws it the same way. It holds exactly
one row and is never split. The page view, the export preview and the PDF draw
the hairline through the middle of that row, across the column; the PDF draws
it as an artifact, with nothing for a reader to say. On screen it is a border,
which Windows high contrast keeps in the text's colour: drawn as a gradient, it
was taken away there and the row stood empty. A `.docx` or `.odt` writes
it as an empty paragraph in a style named Horizontal Line with a rule along its
foot, the way a word processor draws one, and the importer reads that style
back as a line ([docs/app/importing/document-import.md#IMPT-104](../importing/document-import.md#IMPT-104)).

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

The pages before the script reach the paginator as a list of pages of blocks (`src/layout/front-pages.ts`): which pages a play prints, in order, and each paragraph with its gap, style, alignment and id already chosen from the format. One loop, `layoutFrontPages`, lays out every page: a title page from a third of the paper down, the rest from the section top, each wrapping on the script's grid, continuing onto more sheets, and a title page's contact block set at its foot. The same pages flow as the compact opening of an inline format. `frontPagesOf` reads the front matter's fields and texts into those pages, and `src/layout/front-pages.test.ts` holds the loop to the four hand-written sheets it replaced, line for line, under every built-in format.

`src/wordproc/` writes the .docx and .odt files ([FMT-145](#FMT-145) to [FMT-157](#FMT-157)). `model.ts` builds one document model that both writers serialize, and it decides nothing about layout. What goes in comes from `paginateDoc`: the text lines on the chosen pages, merged back into their paragraphs, so an excerpt holds exactly the words of those PDF pages. The text itself comes from `blocksFromDoc` under the same format with capitals and element underlining left to the style. The engine's uppercase keeps every string's length, so its line offsets index the same text. Front sheets come from `paginateFrontMatter`, whose lines carry their paragraph's whole text and alignment for writers that flow text. Act and scene numbers come from `numberHeadings` in `src/layout/furniture.ts`, the function the paginator uses. Dual pairs are found by the engine's own pairing rule. `docx.ts` writes WordprocessingML: the document, styles, settings, a font table with the four faces obfuscated as ECMA-376 requires, one header and footer part per distinct set of values, and core and app properties. `odt.ts` writes ODF 1.3: `mimetype` stored first, content, styles with a master page per kind of page, meta, a manifest, and the faces under `Fonts/`. `zip.ts` uses fflate, which the importer already depends on, with fixed entry dates. Delivery reuses the PDF's `save_export`, which takes the type for the panel's title and filter. A .docx or .odt export sends no report event: counting them would add an event to the closed list in [privacy and telemetry](../keeping-work/privacy-and-telemetry.md), which is a change to the published notice.

`src/layout/fountain-with-pages.ts` writes Export Fountain's file ([FMT-171](#FMT-171)). It reads each page as the page view does, through `openingParagraphs` and `fillFields`, never parsing its Markdown a second way, and puts the pages between the title page and the script that `serialize` writes, so the script's own lines go out as a save writes them. The workspace hands it the front matter without the keys that held pages (`withoutPageKeys`) and the pages `frontPageList` gives, the list the page view draws. Delivery is `save_export` again, with the kind `fountain`.

The header mechanism differs by file type because the readers differ. On 2026-09-24, on the Mac mini, a word processor rendered probe files headlessly. An .odt variable set at each heading printed the value in force at the top of every page, including a page that opens with the heading. A .docx section that starts partway down a page kept the previous header in that reader, which changes headers only at page-starting sections. The published behaviour of the other common .docx reader is to apply a continuous section's header from the next page. Both behaviours match the rule for where a page begins ([FMT-140](#FMT-140)) wherever the heading opens a page.

Calibration measured key positions from each guide's source PDF ([FMT-11](#FMT-11)). Format changes are verified with round trips, measured editor/preview geometry, sample PDFs and the shared browser/native smoke checks.
