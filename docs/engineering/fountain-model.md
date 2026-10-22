# Fountain data model

[Engineering](README.md) › Fountain data model

This reference defines the editable schema, Fountain mapping, normalization and round-trip guarantees. It supports the [script editor contract](../app/writing/editor-ux.md).

[Schema](#FOUN-D102) · [Front matter](#FOUN-D107) · [Serialization](#FOUN-D108) · [Fidelity](#FOUN-D111)

## Requirements

<a id="FOUN-D100"></a>

### Fountain data model

<a id="EDIT-99"></a>

**EDIT-99** How the structured editor document maps to and from Fountain. The internal model is a **ProseMirror/TipTap document**; the on-disk serialization is **Fountain**. Round-trip fidelity — open a `.fountain`, edit, save, and the result is valid, clean Fountain — is a hard requirement, so parse and serialize are designed together as one tested module (`src/fountain/`).

<a id="FOUN-D101"></a>

### Libraries

- <a id="EDIT-100"></a> **EDIT-100** **Parse:** [`fountain-js` (jonnygreenwald fork)](https://github.com/jonnygreenwald/fountain-js) — actively maintained, supports Fountain 1.1, and (as of 1.1.2) leaves inline markup intact in token text, which we need to re-map marks precisely.
- <a id="EDIT-101"></a> **EDIT-101** **Serialize:** Fountain serialization is written in-house, **referencing the `afterwriting` project's generator**, because `fountain-js` is parse-only.
- <a id="EDIT-102"></a> **EDIT-102** The parser must preserve the full element set we rely on — **Sections (`#`), Synopses (`=`), Notes (`[[ ]]`), Boneyard (`/* */`), dual dialogue (`^`), lyrics (`~`), scene numbers (`#n#`)**. Where the chosen library drops any of these, we extend it (MIT-licensed, forkable). This is an implementation gate, not an open question.

<a id="FOUN-D102"></a>

### ProseMirror schema

<a id="EDIT-103"></a>

**EDIT-103** The document is **flat**, mirroring Fountain's own flatness. We do **not** encode "dialogue must follow character" as a schema rule — that brittleness is unnecessary; element adjacency is guided by the keymap (see [editor-ux](../app/writing/editor-ux.md)), not enforced by the schema. Flatness also makes round-trip trivial: node order = line order.

```
doc        := topNode, content: "body+"
body group := act | scene | sceneHeading | action | character
            | parenthetical | dialogue | transition | lyric
            | centered | synopsis | pageBreak | boneyard
```

<a id="FOUN-D103"></a>

#### Node specs

| Node | group | content | attrs | notes | Requirement |
|------|-------|---------|-------|-------| --- |
| `doc` | — | `body+` | — | topNode. Body only; front matter is separate (below). | <a id="EDIT-104"></a>EDIT-104 |
| `act` | body | `inline*` | `{id}` | Fountain `#`. | <a id="EDIT-105"></a>EDIT-105 |
| `scene` | body | `inline*` | `{id}` | Fountain `##`. The card unit. | <a id="EDIT-106"></a>EDIT-106 |
| `sceneHeading` | body | `inline*` | `{id, sceneNumber, forced}` | Optional locale line. | <a id="EDIT-107"></a>EDIT-107 |
| `action` | body | `inline*` | `{centered}` | Stage direction. Default element. | <a id="EDIT-108"></a>EDIT-108 |
| `character` | body | `inline*` | `{extension, dual, forced}` | The cue (name + optional extension). `forced` is the editor's: neither `parse` nor `serialize` touches it ([docs/app/writing/editor-ux.md#EDIT-176](../app/writing/editor-ux.md#EDIT-176)). | <a id="EDIT-109"></a>EDIT-109 |
| `parenthetical` | body | `inline*` | — | Wryly. | <a id="EDIT-110"></a>EDIT-110 |
| `dialogue` | body | `inline*` | — | Spoken text. | <a id="EDIT-111"></a>EDIT-111 |
| `transition` | body | `inline*` | `{forced}` | | <a id="EDIT-112"></a>EDIT-112 |
| `lyric` | body | `inline*` | — | Fountain `~`. Always forced. | <a id="EDIT-113"></a>EDIT-113 |
| `centered` | body | `inline*` | — | Fountain `>text<`. | <a id="EDIT-114"></a>EDIT-114 |
| `synopsis` | body | `inline*` | — | Fountain `=`. The card description; describes the nearest preceding scene/section. | <a id="EDIT-115"></a>EDIT-115 |
| `pageBreak` | body | — (atom) | — | Fountain `===`. | <a id="EDIT-116"></a>EDIT-116 |
| `boneyard` | body | `text*` | — | Fountain `/* … */`. Omitted content; rendered collapsed, **never discarded**. | <a id="EDIT-117"></a>EDIT-117 |

<a id="FOUN-D104"></a>

#### Marks (inline emphasis + notes)

| Mark / inline node | Fountain | Render | Requirement |
|--------------------|----------|--------| --- |
| `strong` | `**bold**` | bold | <a id="EDIT-118"></a>EDIT-118 |
| `em` | `*italics*` | italic | <a id="EDIT-119"></a>EDIT-119 |
| `underline` | `_underline_` | underline (Fountain reserves `_` for underline, distinct from italics) | <a id="EDIT-120"></a>EDIT-120 |
| `note` (inline node, `inline*` content) | `[[ note ]]` | highlighted annotation chip; invisible in print output | <a id="EDIT-121"></a>EDIT-121 |

<a id="EDIT-122"></a>

**EDIT-122** `em` + `strong` + `underline` compose (`***bold italics***`, `_underlined *italic*_`), exactly as Fountain/Markdown emphasis composes.

<a id="FOUN-D105"></a>

#### A speech, and dual dialogue

<a id="EDIT-123"></a>

**EDIT-123** A "speech" is just the adjacency `character (parenthetical | dialogue)+` in the flat doc — no wrapper node. A `lyric` is a line of a speech too, where one stands in that run ([EDIT-175](#EDIT-175), [EDIT-183](#EDIT-183)). **Dual dialogue** is the second speech's `character` carrying `dual: true` (Fountain `^`); rendering the two speeches side-by-side is a view concern, not a model one.

<a id="EDIT-175"></a>

**EDIT-175** **A cue in the script always has a line under it.** To Fountain a line is a Character only when the line after it is not blank, and the tokenizer holds a forced cue to that too. So a `character` block followed by anything but its speech, or by nothing, was written over a blank line and came back as an `action`. The next save wrote `!MARA`. A cue in mixed case came back as a stage direction reading `@Ivo`. The writer makes such a cue by changing the element of the line under it, by deleting that line, or by setting a line to Character and going elsewhere; an import can hold one.

- **What stands under a cue.** A `parenthetical`, a `dialogue` or a `lyric`: bracketed, spoken or sung. They are the three lines Fountain allows in a dialogue block, and the blocks the layout engine lays out as the cue's speech. A cue followed by any other block, or by the end of the script, has no speech.
- **Writing.** `serialize` puts Fountain's two-space line under a cue that has no speech: `MARA`, a line of two spaces, then the blank line before the next element. Those are the bytes of a cue over a speech with no words yet ([docs/app/writing/editor-ux.md#EDIT-43](../app/writing/editor-ux.md#EDIT-43)), and any Fountain reader takes them for a cue and one empty line of dialogue. A lyric is written directly under its cue, with no blank line between, as a parenthetical and a dialogue are.
- **Reading.** The two-space line under a cue is an empty `dialogue` block, as it has been. So a cue with no speech comes back as the same cue (its name, its extension and its `^` as they were) with an empty speech under it. The model does not tell a cue with an empty speech from a cue with none, because the file cannot: the file is canonical, and Fountain has no cue without a line under it. This is the one case in which a reopen adds a block ([EDIT-158](#EDIT-158)). No block changes type, and from there the script and the page stay as they are. On the page the empty speech has its row, as it has while a writer types one. That is one row more under such a cue after a reopen, in every format that starts a speech on the row under its cue.
- **A sung speech.** The tokenizer throws on a speech whose first line is a lyric, and a throw leaves the whole script as one `action` block ([docs/app/keeping-work/storage-and-file-format.md#STOR-107](../app/keeping-work/storage-and-file-format.md#STOR-107)). `parse` stands a line of its own between a block's first line and a sung second line while the tokenizer reads, and takes it out again: as a line from a speech, and from a block the tokenizer took for something else so that the block reads exactly as written. The line is private-use characters, lengthened until the script holds none, as the two-space line's stand-in and the held notes' tags are ([EDIT-174](#EDIT-174)). A script written elsewhere with a cue directly over a `~` line reads as its cue and its song for the same reason.
- **What is left alone.** A cue with nothing on its line is an empty line, and is written as one. A cue whose own text holds a line break already has a line under it. A cue that holds a note and no name is forced ([EDIT-174](#EDIT-174)) and gets the two-space line, because a forced line alone came back as a direction reading `@`. A line that stands alone in a file is read as it always was. A script saved before this rule holds its lone cue over a blank line, where nothing tells `MARA` from a direction in capitals, so the app does not guess.
- **Why not otherwise.** Reading the two-space line under a cue as no block would keep a lone cue exactly and lose the line a writer stopped on after pressing Return on a name. That is the commoner case, and the one a paused lesson resumes on ([docs/app/preferences-and-help/tutorials.md#TUT-10](../app/preferences-and-help/tutorials.md#TUT-10)). A second spelling for one of the two, a wider run of spaces or a note of the app's own, would be a private mark in a file that is plain Fountain. Having the editor put a dialogue block under every cue would make adjacency a rule of the document, which [EDIT-103](#EDIT-103) declines, and Tab's ring passes through Character on its way to the other elements. Reading a forced cue with no line under it as a cue would keep the two apart, and a script written that way shows `@MARA` as a stage direction in every reader that holds to Fountain's rule, earlier versions of this app among them.

`src/fountain/roundtrip.test.ts` pins a cue with no speech in capitals and in mixed case, with and without an extension, in the middle of a script and at its end, as the right-hand cue of a dual pair, over every other element and with a comment on it; a sung speech under each kind of cue; and a script written elsewhere that holds one. `src/editor/bridge.test.ts` pins the page that comes back.

<a id="EDIT-183"></a>

**EDIT-183** **Every line of a speech is in the script what it is on the page, or is not in the script.** In the script a speech is one block of lines under its cue. A parenthetical or a dialogue is one only inside that block, and a blank line ends it. Four lines of a speech were written as something Fountain does not have, and came back as something else. An empty `lyric` was written `~`, which read back as a stage direction reading `~`, or under a cue as a speech reading `~`; every Return in a song makes one. An empty `parenthetical` was written `()` and read back as a speech reading `()`. A lyric that began with a space was written `~ Row`, which is no lyric to the tokenizer, and read back as a speech. A `dialogue` or a `parenthetical` after a lyric was written after a blank line and read back as a stage direction.

- **A speech's block.** `serialize` writes every line of a speech down to its last `parenthetical` or `dialogue` with no blank line between: those are the lines that need the cue, and a `lyric` among them stands in the block with them. A lyric after the last of them needs no cue, because `~` makes it a lyric wherever it stands. It is written as it always was, after a blank line, and with no parenthetical or dialogue in the speech the first lyric alone stands under the cue ([EDIT-175](#EDIT-175)). So a speech that ends on its song is the same bytes on its next save. The speeches written differently are the ones the old writing broke. All of this is under a cue that puts a line in the script. A lyric with no cue over it takes nothing into its block: `~Row` directly over `Spoken.` with no cue is one stage direction to the tokenizer.
- **Two verses.** The tokenizer runs sung lines that touch into one lyric, as it runs spoken ones into one dialogue. Two `dialogue` blocks may come back as one, because every shipped format prints them on the same rows. Two `lyric` blocks may not: four of the seven shipped formats set a row between two verses and none inside one, so the merged lyric would print a row shorter. In a speech's block two verses are parted by Fountain's two-space line, the empty line that does not end a block ([docs/app/writing/editor-ux.md#EDIT-43](../app/writing/editor-ux.md#EDIT-43)). Any Fountain reader shows it as an empty line between two sung ones.
- **Reading.** In a speech, an empty line directly between two sung lines, or a run of them, is the break between two `lyric` blocks and is no block. Read as the speech with no words that it is elsewhere, it would print as a row of its own between every two verses. Under a cue, at the end of a speech and beside a line that is not sung, the empty line is the empty `dialogue` it always was.
- **What is not written.** An empty `lyric`; an empty `parenthetical`; and a `dialogue` with no words that stands between two sung lines, where its line is the break. Fountain has no empty lyric and no empty parenthetical, and an empty stage direction and an empty cue are already written as nothing. The lines around such a block are written as if it were not there, so a cue over nothing else is a cue with no speech and comes back over an empty one ([EDIT-175](#EDIT-175)). A parenthetical that holds a space, or a comment and no words, is a line, and so is a speech that holds only a comment.
- **A line of a lyric.** Each is written behind its `~` without the space in front of it. The tokenizer's lyric is `~` with no space after it, and it reads every line of a speech without the space around it, so a spoken line never kept that space either. Emphasis that opens with a space is written behind its own mark and stays as it is. A line with nothing on it ends a verse: a lyric that holds an empty line is written as the verses on either side of it, and comes back as that many `lyric` blocks. Emphasis that ran across the empty line closes in one verse and opens in the next. A line break inside a note is the note's, and ends no line of the lyric.
- **What a writer can see.** The empty line a writer stopped on after Return in a song is not there after a reopen, as an empty stage direction is not. An empty parenthetical no longer prints its brackets after one. A lyric with an empty line in it is two lyrics afterwards: the same page in the four formats that set a row between two verses, and a row shorter in the three that set none. An empty lyric left between two verses as a gap goes the same way. In those three formats a song under one cue holds no empty row across a reopen; before this rule the row came back holding a `~`.
- **What is left alone.** A line already in a script reads as it did. A `~` on a line of its own, a `()` under a cue and a `~ Row` in a speech may have been left by an earlier save, and nothing on the line says a writer did not type it, so the app does not guess. A line that followed a song and has been saved after a blank line is a stage direction in the script, and stays one.
- **Why not otherwise.** Writing every speech as one block, the song that ends it included, is the simpler rule and reads back as the same blocks. It would rewrite every sung speech in every script on its next save, a blank line taken out above the song and two spaces put on the line between each two verses, for nothing a writer can see. Writing two verses with nothing between them would change the page of a script already written, in four formats, the second time it is opened. An empty lyric kept as the two-space line has no line of its own to be: after a sung line that line is a speech with no words, and between two it is the break. Telling it from either would take a mark of the app's own in a file that is plain Fountain. A bare `~` is what was written before, and every reader that holds to Fountain's rule shows it as a line reading `~`, earlier versions of this app among them. Keeping the space in front of a sung line would take an escape Fountain does not have.

`src/fountain/roundtrip.test.ts` pins a spoken and a bracketed line after a sung one under each kind of cue and on each side of a dual pair; two and three verses in one speech; that two verses and one verse of two lines are not the same page in every shipped format, and two speeches and one of two lines are; a song that ends its speech, byte for byte; a lyric with no cue over it; an empty lyric and an empty parenthetical in each place one can stand; a sung line with a space in front of it; a lyric that holds an empty line, with emphasis and with a comment that holds a line break; the reading of the empty line in each place; lines already in a script; and every run of up to four speech blocks, each read back with its lines in blocks of the type they had and no stray character.

<a id="FOUN-D106"></a>

#### A cue's extension

<a id="EDIT-124"></a>

**EDIT-124** `MARA (V.O.)` is MARA speaking in voice-over. The **model** holds the last trailing parenthetical in the `character` block's `extension` attribute, the name in its text — that is how `parse` reads a file, and what `serialize` writes back. The **editor** holds the extension as text, where the writer can see and change it: `src/editor/bridge.ts` folds the attribute into the cue's text on the way in and splits it back out on the way out, with the parser's own reading (`src/fountain/cue.ts`). The layout engine splits an extension that arrives as text the same way, so the page view and the PDF print one cue and one `(CONT'D)`.

<a id="EDIT-125"></a>

**EDIT-125** Who speaks is a different reading: everything before the first `(` that follows a name (`cueName`), so `MARA`, `MARA (V.O.)`, `MARA(V.O.)` and `MARA (V.O.) (CONT'D)` are one character to the Cast, part sizes, appearances, sides, autocomplete and Find.

<a id="FOUN-D107"></a>

### Front matter mapping

<a id="EDIT-126"></a>

**EDIT-126** Front matter is **not** in the ProseMirror doc. It is a structured object edited in the Front Matter panel and serialized to the Fountain **title page**:

```
frontMatter = {
  title, credit, authors[], source, draftDate, contact[],   // standard Fountain keys
  setting, time, place,                                       // custom keys (house)
  characters: [{ name, description }],                        // custom key (house)
  atRise                                                      // → opening stage direction
}
```

<a id="EDIT-127"></a>

**EDIT-127** Serialization:

```
Title: The Weight of Water
Credit: a play by
Author: A. Playwright
Draft date: <writer’s draft date>
Contact:
    playwright@example.com
Setting: A coastal kitchen and the rooms of memory around it.
Time: The last night of winter.
Characters:
    MARA — a hydrologist, 40s
    JONAH — her brother, 30s
```

- <a id="EDIT-128"></a> **EDIT-128** `Title`, `Credit`, `Author(s)`, `Source`, `Draft date`, `Contact` are **standard** Fountain title-page keys.
- <a id="EDIT-129"></a> **EDIT-129** `Setting`, `Time`, `Place`, `Characters` are **custom** keys. Fountain explicitly preserves unsupported keys ("they will be ignored, but you may find them useful as metadata"), so these round-trip; other tools simply don't render them as front-matter pages. (The durability tradeoff: a tool that strips custom keys loses them, and the alternative is to emit them as body front-matter pages.)
- <a id="EDIT-130"></a> **EDIT-130** **AT RISE** serializes as the first `action` node of the first scene — after the scene heading and any `=` synopsis, not necessarily the literal first block — with text beginning `AT RISE: …`. On parse, the first action node of the first scene whose text starts `AT RISE:` is lifted back into `frontMatter.atRise` (and re-emitted there on save) so the panel and the page stay in sync.

<a id="EDIT-190"></a>

**EDIT-190** **A key named twice is read as all it was given.** A title page typed by hand, or written by another tool, can name a key on two lines: `Author: One` over `Author: Two`. Each entry's value went to its field as it was read, so the later entry took the place of the earlier. The play had one author, Two, and the next save wrote the script without One. Every other key did the same, an unknown one among them. So did an entry with nothing after it: `Title: Play` over `Title:` read as a play with no title. The app writes each key once ([EDIT-127](#EDIT-127)), so no title page it wrote held such a pair.

- **Which keys are one key.** Two keys read into one field: `Author` and `Authors`, `Date` and `Draft date`, and a key in any case or spacing the reader takes for it (`TITLE`, `Draft  date`). An unknown key is kept under the key as it was written ([EDIT-150](#EDIT-150)), so two spellings of one, `Notes` and `notes`, are two keys. Both were kept and written back, and both are.
- **A list** (`authors`, `contact`, `characters`) holds the values of every entry, in the order they stand. Two `Author:` lines are two authors, written as `Authors:` with a line for each.
- **A text field** (`title`, `credit`, `source`, `draftDate`, `setting`, `time`, `place`) holds the lines of every entry, as one entry of several lines does. `Title: A` over `Title: B` is a title of two lines, written as `Title:` with `A` and `B` under it.
- **An unknown key** holds the lines of every entry of that name in `frontMatter._extra`, and is written the same way.
- **A whole value is not joined.** Four of the house's keys hold one value and not lines. `Title Page Text`, `Characters Page Text` and `Opening Notes` hold a page's text as one JSON string, and `Opening Notes First` holds `true` or `false`. Two such values joined are no value: the lines would read as neither, and the play would have no such page. So each entry is read alone. The field is the last entry that reads as its value, which is the page the play had before this rule. Every other entry of that key is kept in `frontMatter._extra` under the key as it was written, in the order they stand: an earlier one that reads as a value, and one that does not read as one, which was always kept there.
- **An entry with nothing after it** adds nothing and takes nothing away.
- **The save after.** `serialize` writes each field once, the unknown keys under the fields and the four whole values last. What it writes reads back to the same front matter, and is the same bytes at every save from then on. A whole value kept beside its field is written above the field's own line, so the field's line is the last that reads on the reopen too.
- **A title page that names each key once** reads as it did and is written as it was.
- **What is left alone.** A page's text kept beside its field stays in the script, as any unknown key does. If the writer then leaves that page's text out in the app, to print the page from its fields, the field's line is no longer written and the copy kept is read as the page on the next reopen. Leaving it out again takes it out of the script. A list key with nothing after it reads as a list of none, as before. Its line was not written then, and has been since [EDIT-192](#EDIT-192).
- **Why not otherwise.** The first entry alone, or the last, loses a line a writer typed. Refusing the title page has nothing to show the writer and still has to read something. Joining the texts of two pages would print both where the play printed one, and two versions of one page are the likeliest pair: the one read is the one the play already had, and the other is kept. Keeping each entry on a line of its own needs a front matter that holds a key twice, and the app's fields hold each once.

`src/fountain/titlepage.test.ts` pins the reported cases through `parse` and `serialize`; each list, with either key of the field; each text field, with an entry of several lines and an empty entry in each place; an unknown key, one named as something every object has, and two spellings kept apart; each page's text and the flag, twice and three times, with an entry that does not read on either side; the page kept beside a field the app then leaves out; title pages that name each key once, read and written as they were; and a sweep of 4,000 generated title pages, each read as its entries say, with no word missing, and at rest from its first save.

<a id="EDIT-131"></a>

**EDIT-131** A blank line terminates the title page; the body follows (Fountain's implicit post-title page break). What follows is the script, whatever its first line looks like ([EDIT-184](#EDIT-184)) and whatever white space stands over it ([EDIT-188](#EDIT-188)).

<a id="EDIT-184"></a>

**EDIT-184** **The script's first line is the script's.** A title page is `Key: value` lines at the top of a file, and two readers looked for one.

- **Ours** (`src/fountain/titlepage.ts`) takes a file's first block when its first line opens with a key, at the start of the line, and the block holds a key it knows: Fountain's standard keys and the house's ([EDIT-128](#EDIT-128), [EDIT-129](#EDIT-129)). The key may have a value on its line, none, or lines under it. A title page the app writes always holds such a key ([EDIT-192](#EDIT-192)).
- **The tokenizer** had a title page of its own, for a standard key (or `draftdate`) with a value on its line or indented under it, three spaces or a tab. It read past white space and blank lines to find one, and it was handed the script after our title page was off it.

So a script's first line that looked like a key was read as a title page. With no title page above it, a stage direction `Time: now.` went into the front matter as the play's time and left the script, and a cue `TIME:` went the same way with its speech for a value. Under a title page, a stage direction `Notes: buy milk` was a title page to the tokenizer, whose title page nothing reads: the line was in neither the front matter nor the script. A cue `TITLE: X` was lost the same way and its speech came back as a stage direction. Over a lyric the tokenizer threw, and the whole script came back as one stage direction ([docs/app/keeping-work/storage-and-file-format.md#STOR-107](../app/keeping-work/storage-and-file-format.md#STOR-107)).

- **Writing.** `serialize` asks each reader of the script it is about to write. Ours is asked where no title page is written above the script, since it looks only at the top of a file. The tokenizer is asked either way. If either would take the top for a title page, the block that puts the script's first line there is forced: `!` on a stage direction, `@` on a cue, `>` on a transition. A line of speech with no cue over it, and a cue the tokenizer takes neither way ([EDIT-179](#EDIT-179)), are stage directions to the next reader wherever they stand, and get the `!`.
- **Where the mark goes.** Directly in front of the line's first character, behind any white space: the tokenizer takes a `!` off there, and leaves one that has a space after it in the text. A block written as empty lines is no first line, so the mark goes on the block after it. A boneyard, a note or a section in front is the first line, and a key behind it is written as it always was.
- **Where it is needed and nowhere else.** The reader is asked, not a list of keys, as for a cue's name ([EDIT-179](#EDIT-179)). Under a title page the house's keys get no mark (`Time: now.`, `SETTING:` over a speech), and neither does a standard key with nothing after it: our reader does not look there and the tokenizer never took those. The tokenizer's rule for looking is wider than what it takes (a value under the key that opens as a key itself, `Notes:` over an indented `a: b`, it leaves with the whole block), so its title-page half is asked and not its rule. No script at rest is rewritten for this. A script with such a first line was not at rest: the line left it on the next reopen.
- **Reading.** `parse` asks no reader but ours for a title page. What `splitTitlePage` takes is the title page; the rest goes to the tokenizer's script half, which reads every line as script. So what follows a title page is the script in a script written elsewhere too. `Title: X`, a blank line, then `Author: Y` is a title page and a stage direction, as it is to any reader that ends the title page at its first blank line.
- **A title page reads as it did.** Everything our reader took it takes, to the same front matter. The tokenizer's own was never read: what it took alone was dropped. A title page behind a blank line or a space, and one that opens with `draftdate`, comes back as lines of the script.
- **Why both.** The serializer cannot help a script already on disk, or one written elsewhere, whose line under a title page the reading dropped. The parser cannot tell a stage direction `Time: now.` at the top of a file from a title page of one line that reads `Time: now.`: they are the same bytes, so the writing has to differ. And a version of this app from before the rule still hands the script to the tokenizer whole, so a standard key under a title page is marked for that reader.
- **What is left alone.** A script saved before this rule, with no title page and a key of ours as its first line, has the bytes of a title page and is read as one. Nothing on the line says a writer meant a stage direction, so the app does not guess. A first block is otherwise read at the top as it is anywhere: a cue with no speech comes back over an empty one ([EDIT-175](#EDIT-175)), and an empty first line does not come back. So a key of the house's behind an empty first line is safe from our reader, is written without a mark, and is marked by the save after the reopen, when it is the first line.
- **Why not otherwise.** Reading a key behind a blank line as the title page, as the tokenizer looked for one, would take a stage direction the app itself wrote under an empty first line and make it the play's title or draft date, out of sight in a field. As a line of the script it is on the page, where a writer can move it. A backslash in front of the colon stops both readers, and it is no escape Fountain has: every other reader shows the backslash. A mark on every first line that holds a colon would rewrite scripts no reader misreads. Forcing the cue alone, by the rule for a cue's name, would leave the stage direction and the transition, which are lost at the same place.

`src/fountain/roundtrip.test.ts` pins the reported cases with no title page and under one; every kind of block that can stand first; every key either reader knows, in each way a first line can hold it, with a mark exactly where a reader would take the line without; a cue in each shape; empty lines and white space in front of the key; a first line no reader takes, left as it was; a real title page, read as before; what follows a title page in a script written elsewhere; a title page only the tokenizer saw; and that the tokenizer's script half reads a script as the whole tokenizer did.

<a id="EDIT-192"></a>

**EDIT-192** **What is written as a title page is one to the reader.** Our reader takes a file's first block for a title page only when the block holds a key it knows ([EDIT-184](#EDIT-184)), and `serialize` wrote whatever the front matter held. A front matter of unknown keys alone, `Format: stage`, was written as that line over the script. On the reopen the line was a stage direction at the top of the script, on the page and in every export. No word was lost: the line moved out of the title page and into the script.

A title page got there by itself from a list key with nothing after it over an unknown key. `Author:` over `Format: stage` read as a list of no authors and the unknown key, the list of none was not written, and the save was `Format: stage` alone. The app gets there too, by taking out the last field the reader knew from a title page that otherwise holds only unknown keys: the last character removed in the cast view, or the characters page given back to the cast list. The title page sheet does not. Its save always writes the opening notes and their flag, which are keys the reader knows.

- **The reading does not change.** `Format: stage` over a blank line is the same bytes as a stage direction that reads `Format: stage`, which the app writes with no mark because no reader takes it ([EDIT-184](#EDIT-184)). A reader that took those bytes for a title page would take that stage direction off the page and put it in a field out of sight. The two cannot be told apart on the reopen, so the writing differs, and a script at rest is read and written as it was.
- **A list key with nothing after it keeps its line.** `Author:`, `Authors:`, `Contact:` and `Characters:` with nothing after them read as a list of none, as they did. `serialize` writes a list of none as its key alone, in the list's place among the fields, and `Author:` for either key of that field. The line used to be left out. So such a title page reads the same after its save as before it, a key the reader knows stays in it, and a page typed as the app writes one is at rest as typed. A text field with nothing after it (`Title:`) and an unknown key with nothing after it were written back already; the lists were the exception.
- **Unknown keys alone are written under `Author:`.** `serialize` asks the reader whether it would take the page it is about to write, as it asks it of the script's first line ([EDIT-184](#EDIT-184)). Where it would not, the page is written with `Author:` and nothing after it on its first line. On the reopen that is a list of no authors, and every unknown key is in `frontMatter._extra` as it was. The save after writes the same lines.
- **Only a front matter the app has changed gets the key.** One read from a script holds a key the reader knew, and each is written back: a field with its value, a list of none as its key alone, and a key kept with the unknown ones (`Notes`, `Copyright`, `Revision`, a house key whose lines were not its value) under the key as it was written. So no title page that was read has a key added to it.
- **Why `Author`.** The key has to be one the reader knows, and with nothing after it has to put nothing on a page. A text key with nothing after it is a text of no words, and prints as one: `Title:` takes the script's name out of a header that prints the title. A list of none prints nothing. The title page, a header and an export's properties name no author with the line and without it. `Author` is one of Fountain's standard keys, so a reader with a list of its own has it, where a key of the house's is unknown to every reader but ours.
- **What another reader shows.** A reader that takes any `Key: value` lines at the top of a file for a title page, as Fountain describes one, takes this page with the line and without it. The tokenizer this app is built on wants a standard key with a value. It takes neither: the page was one stage direction to it, `Format: stage`, and is one of two lines.
- **What a writer can see.** Nothing in the app: a list of none is no author on the title page, an empty field in its sheet and no one in the cast. In the script as text, a blank `Author:`, `Contact:` or `Characters:` line stays where the first save used to drop it, and a title page of unknown keys alone has `Author:` over it. The title page sheet saved with no author, or with no contact line, takes that blank line out, and the cast view does the same for `Characters:` at its next change.
- **What is left alone.** A script already saved with the unknown key's line at its top holds a stage direction. Nothing on the line says it was a title page, so the app does not guess. A value that holds an empty line, and a key the reader's rule for a key does not match, come from no reading and from no field of the app, and are written as they were.
- **Why not otherwise.** A reader with another test for a first block of key lines (every line a key, say) reads the stage direction as a title page: the same bytes. A key on every title page would rewrite each script on its next save for nothing a writer can see. Leaving the list of none unwritten and adding the key where it is needed would write `Author:` in place of a `Contact:` the page held, and would keep or drop the same blank `Author:` by what stood beside it. Keeping the list of none and adding no key leaves the app's own two ways to a page the reader refuses. Mending those two places in the app instead leaves `serialize` writing such a page for any front matter that reaches it another way.

`src/fountain/titlepage.test.ts` pins the reported script and the reported front matter through `parse` and `serialize`, with Windows line endings and with no script under the page; each list key with nothing after it, under either key of its field and in capitals or lower case, alone, over an unknown key and under one, named twice, beside a value, and each in its place among the fields; the app's two ways to unknown keys alone, and six such front matters, each written under `Author:`, read back whole and at rest from that save; no key written where the page holds any field the reader knows or a key it keeps, and no title page made of nothing; a first line of the script that reads as an unknown key, read and written as it was; the script under such a title page, whatever its first line looks like; and two sweeps, 4,000 generated front matters as the app holds them, the key written exactly where the page holds none the reader knows, and 4,000 generated title pages of list keys with nothing after them among unknown keys, each read back as it was read, with no word missing and at rest from its first save.

<a id="EDIT-188"></a>

**EDIT-188** **White space at the top of a script takes no block with it, and a script reads the same on every reading.** A first line of the script that held only white space (one space, three or more, a tab, a no-break space), with an empty line or another such line under it, lost the block that followed. `She waits.` after it was gone, and so was a cue with its whole speech, a heading or a boneyard, with no title page above and under one. A writer made that line with a first paragraph of spaces, which was written as typed ([EDIT-189](#EDIT-189)). And the loss came and went: read three times in a row, a script of that line and one block was no blocks, then the block with a line break in front of its text, then no blocks. A save after a reading without the block wrote the script without it.

- **Why the block was lost.** The tokenizer cuts a script into blocks at its blank lines, by one rule with two halves: a line break and every line of white space after it, or the first line of what it is handed, alone, where that line is white space. At the top of a script the second half took the first line and stopped, and the empty line under it was left on the front of the next block. The tokenizer then asks the same rule of each block, and a block that opens with an empty line is blank lines to it, whatever else the block holds.
- **Why it came and went.** That rule is one regular expression, which keeps the place its last match ended, and the tokenizer does not put it back. After a block was taken for blank lines, the next block asked, in that script or the next one read, was asked from past its start, where the rule's second half cannot match. So a script of that line and one block lost the block on one reading, kept it on the next with the empty line in its text, and lost it on the one after. With a second block under it the first was lost on every reading: the tokenizer reads a script's blocks last to first, and a block the rule does not match puts the rule back to its start.
- **Reading the top.** `parse` hands the tokenizer the script behind one line break. The top is then read by the rule's first half, as every other place in a script is: every line of white space over the first block is blank lines, however many there are, and the first block opens with its own first line. A boneyard is held as a block of its own between blank lines before the tokenizer reads anything ([EDIT-154](#EDIT-154)), so one behind a space at the top of a script was lost the same way and is kept the same way.
- **Reading the same every time.** No block is blank lines to the tokenizer now: none opens with a line of white space, and Fountain's two-space line is held as a word until the tokenizer is done ([docs/app/writing/editor-ux.md#EDIT-43](../app/writing/editor-ux.md#EDIT-43)), or made empty first where it opens a block ([EDIT-191](#EDIT-191)). A rule that matches no block is never moved from its start. `parse` also puts it there before each reading, for anything else in the process that has used it. What a script reads as depends on the script and on nothing read before it.
- **A script already saved.** A script reads as it did unless a block of it was being taken for blank lines: one that holds a line of white space at its top, directly over an empty line or another line of white space. That script reads as the same script does with no such lines over it. A script of white space and nothing else, which was no blocks on one reading and a stage direction of one space on the next, is no blocks. White space lower in a script was blank lines and is; a first line of white space directly over the first block took nothing and takes nothing. A first line of exactly two spaces over an empty line was white space and is; directly over the first block it was a character with no name, and has been a blank line since [EDIT-191](#EDIT-191).
- **What is not kept.** The line of white space. A paragraph of spaces is no block on the reopen anywhere in a script, and the save after writes the script without it.
- **What is left alone.** A block that was dropped, in a script saved since, is not in the script, and nothing brings it back. This rule is the reading's alone: a script written elsewhere holds such a line whatever the app writes, so the fault is put right where the script is read. What the app itself writes at the top of a script is [EDIT-189](#EDIT-189)'s.

`src/fountain/roundtrip.test.ts` pins the reported script and the same under a title page, each on twelve readings in a row; nineteen scripts, a first block of every kind, under each of 152 tops of one to three lines, with a title page and without, each read as the script is with nothing over it; a boneyard behind white space; a first paragraph of spaces as the editor hands it over, above every kind of block; readings started from seven places in the rule, each the same and each leaving the rule at its start, a script of white space among them; white space lower in a script and a first line of two spaces, read as they were; and a sweep of 4,000 generated scripts in which no word is lost and each script reads as it does with no white space over it.

<a id="EDIT-189"></a>

**EDIT-189** **No line of white space is written above a script's first words.** `serialize` wrote a first paragraph of spaces as typed: the spaces, then the blank line between two blocks. That is the one top the tokenizer's rule for blank lines takes a block with ([EDIT-188](#EDIT-188)). This app reads past it now. A version of the app from before that rule does not, and neither does any other reader built on the tokenizer: opened there, the script comes back without the block under the spaces, and that reader's next save writes the script without it.

- **Which blocks wrote one.** A first `action` of white space, and a first `character` with white space for a name: one space, three, a tab, a no-break space. A first `dialogue` of white space other than spaces and tabs; of spaces or tabs it is Fountain's two-space line ([docs/app/writing/editor-ux.md#EDIT-43](../app/writing/editor-ux.md#EDIT-43)), which is written empty there by its own rule ([EDIT-191](#EDIT-191)). Any of these behind a block that is not written, an empty lyric or parenthetical ([EDIT-183](#EDIT-183)). Under a title page, any of them behind an empty first block as well: our reader takes the empty lines off the top of the script with the title page, and the line of white space behind them is then the script's first. And one `action` whose own text opens with a line of white space over a blank one, which was itself the block lost.
- **Writing.** Every line above the script's first words that holds only white space is written empty: each line from the top down to the first that holds something. So a first paragraph of spaces is written as an empty one is, an empty line and the blank line between two blocks. Every reader reads past that, and the app has always written it for an empty first paragraph. No line is taken out of the script, so every block stands on the line it stood on.
- **Fountain's two-space line is one of them.** This rule left a first line of exactly two spaces as typed, because the reader then took it for something: alone it was a line with no words, and over a line it was a cue with no name. It opens the first block, and is a blank line to the reader and written empty since [EDIT-191](#EDIT-191). So every line of white space above a script's first words is written empty, the two-space line among them.
- **Nothing kept is given up.** A line of white space is no block on the reopen, at the top or anywhere else ([EDIT-188](#EDIT-188)), so the empty line holds all that was ever read back from the spaces. Read by this app, the script written with the line empty is the same document as the script written with the spaces in it, and the save after the reopen is the same bytes.
- **No script at rest is rewritten.** The reader makes no block of white space, so a document read from a script never opens with one. The rule changes the writing only of a document that came from the editor with such a block above its first words, and that script was not at rest: the block does not come back.
- **Why both rules.** [EDIT-188](#EDIT-188) cannot be done without: a script on disk, or one written elsewhere, holds the line whatever the app writes, and so does a script another editor saved with a byte-order mark in front of an empty first line or a boneyard. Reading alone leaves the app writing, at every save until the play is next reopened, the one top that costs a reader with the fault a block. Writing alone reaches no script already written.
- **What is left alone.** White space lower in a script is written as typed, and is a blank line to every reader. An indent on a line that holds words is the line's ([EDIT-185](#EDIT-185)). A boneyard typed into a stage direction behind an indent is written with its asterisks escaped ([EDIT-164](#EDIT-164)), and is no boneyard to any reader.
- **Why not otherwise.** Leaving the block out, line and all, does as much for the reader with the fault. An empty line is what an empty first paragraph is already written as, so the top has one shape and not two, and the lines of the script stay where they were. Writing Fountain's two-space line there is safe for an earlier version of this app, which holds that line as a word before it tokenizes, and not for another reader built on the tokenizer: handed a first line of two spaces as it stands, the tokenizer takes the next block exactly as it does under one space.

`src/fountain/roundtrip.test.ts` pins a first stage direction and a first cue of each kind of white space, over a stage direction and over a cue with its speech, with no title page and under one, each written as an empty line, read back whole and at rest from the save after; the same behind a block that is not written and behind an empty one; the white lines one block holds above its words; every other first line written as it was (an empty one, the two-space line, an indent on a line of words, white space lower in a script); the tokenizer itself, handed 1,440 such scripts as a reader with the fault hands them over, reading every block; 1,500 generated documents with white space first, each written with no line of white space above its first words and read at the top as it is lower in a script; and, of the reading the rule leans on, every character the tokenizer takes for white space with either line ending, and Fountain's two-space line in each mix with white space.

<a id="FOUN-D108"></a>

### Element ⇄ Fountain mapping (serialize direction, with forcing)

<a id="EDIT-132"></a>

**EDIT-132** Serialization is **canonical** and **defensive** — it forces elements whenever an un-forced line could re-parse as something else, which is what guarantees idempotency.

| Node | Fountain output | Forcing rule | Requirement |
|------|-----------------|--------------| --- |
| `act` | `# ACT ONE` | always a Section line | <a id="EDIT-133"></a>EDIT-133 |
| `scene` | `## SCENE 1` | always a Section line | <a id="EDIT-134"></a>EDIT-134 |
| `sceneHeading` | `.A kitchen. Night.` or `INT. …` | prefix `.` unless the text already begins with `INT/EXT/EST/I/E` (+ space/dot) | <a id="EDIT-135"></a>EDIT-135 |
| `action` | paragraph text | prefix `!` if the line is all-caps or otherwise risks parsing as a Character/Scene Heading, wherever the tokenizer would take the block for another element ([EDIT-186](#EDIT-186)), or if it is the script's first line and a reader would take it for a title page ([EDIT-184](#EDIT-184)); a line of only white space above the script's first words is written empty ([EDIT-189](#EDIT-189)), and so is a first line of two spaces wherever it would open a block ([EDIT-191](#EDIT-191)); an indent behind the `!` is the direction's, and a line's own `!` is written twice ([EDIT-185](#EDIT-185)); preserve intentional internal blank lines | <a id="EDIT-136"></a>EDIT-136 |
| `action` (centered) | `> text <` | its own `<` and `>` are written as they stand, and each line of the block between its own marks ([EDIT-187](#EDIT-187)) | <a id="EDIT-137"></a>EDIT-137 |
| `character` | `MARA` / `@McARDLE` / `MARA (O.S.)` / `MARA ^` | prefix `@` if mixed/lower case, if the cue holds a note ([EDIT-174](#EDIT-174)), if its name alone would make the line something else ([EDIT-179](#EDIT-179)), or if it is the script's first line and a reader would take it for a title page ([EDIT-184](#EDIT-184)); append `(ext)` for extension; append ` ^` if `dual`; the two-space line under a cue with no speech ([EDIT-175](#EDIT-175)); a name of only white space above the script's first words is written as an empty line ([EDIT-189](#EDIT-189)) | <a id="EDIT-138"></a>EDIT-138 |
| `parenthetical` | `(quietly)` | wrap in parens; one with no words is not written ([EDIT-183](#EDIT-183)) | <a id="EDIT-139"></a>EDIT-139 |
| `dialogue` | text | none; an empty line of it is written as Fountain's two-space line ([docs/app/writing/editor-ux.md#EDIT-43](../app/writing/editor-ux.md#EDIT-43)), and empty where no line of its block stands over it ([EDIT-191](#EDIT-191)) | <a id="EDIT-140"></a>EDIT-140 |
| `transition` | `CUT TO:` / `>BLACKOUT.` | prefix `>` unless the line is uppercase ending in `TO:`, always when it holds a note ([EDIT-180](#EDIT-180)), when it opens as a scene heading does ([EDIT-187](#EDIT-187)), and when it is the script's first line and a reader would take it for a title page ([EDIT-184](#EDIT-184)); a `<` that ends it is written `\<` ([EDIT-187](#EDIT-187)) | <a id="EDIT-141"></a>EDIT-141 |
| `lyric` | `~line` | prefix `~` on every line (always forced), a note's own lines among them ([EDIT-180](#EDIT-180)), with no space after it; a line with no words is not written, and parts two verses ([EDIT-183](#EDIT-183)) | <a id="EDIT-142"></a>EDIT-142 |
| `synopsis` | `= text` | | <a id="EDIT-143"></a>EDIT-143 |
| `pageBreak` | `===` | | <a id="EDIT-144"></a>EDIT-144 |
| `boneyard` | `/* text */` | the one element allowed to span blank lines | <a id="EDIT-145"></a>EDIT-145 |
| `note` (inline) | `[[ text ]]` | a blank line inside it is written as two spaces ([EDIT-180](#EDIT-180)) | <a id="EDIT-146"></a>EDIT-146 |
| `strong`/`em`/`underline` | `**`/`*`/`_` | escape literal `*` `_` in text with `\` | <a id="EDIT-147"></a>EDIT-147 |
| scene number (attr) | ` #1A#` appended to a scene heading | | <a id="EDIT-148"></a>EDIT-148 |

<a id="EDIT-179"></a>

**EDIT-179** **A cue's name does not change what the line is.** The tokenizer reads a line's kind from the name on it. With no `@` in front it refuses, as a cue:

- a line that opens with `!`, `.`, `>`, `~`, `=` or `#`, the marks that force or open another element (`#2 FAN`, `.38`, `...`);
- a line that is only digits, spaces, `*` and `_`, which is a number, bare or emphasised (`2`, `007`, `**2**`);
- a name that ends as a transition does, in `TO:`, `BLACK.` or `OUT.` (`CUT TO:`, `OTTO:`, `SCOUT.`).

A line that opens with `@` it takes for a forced cue, and the `@` is gone from the name. Each of these was written as it stood. `2` over `Hello.` came back as one `action` block holding both lines, the next save of `#2 FAN` wrote `!#2 FAN`, and `@HOME` came back as a cue named `HOME`. A cue with no speech under it ([EDIT-175](#EDIT-175)) failed the same way.

- **Writing.** `serialize` forces (`@`) a cue whose line the tokenizer would refuse as it stands and take behind an `@`. The test is the tokenizer's own rule for a cue, cut down to the cue's line and asked of the line about to be written, its extension and its `^` included. So the `@` goes where it is needed and nowhere else. The tokenizer takes `SCOUT. (V.O.)` and `2 (V.O.) ^` as they stand, and they are written so. A name that needs no `@` gets none, and no script on disk is rewritten for this by its next save.
- **Reading.** Unchanged. `@2` over a speech is a cue to any Fountain reader. `2` over a speech in a script written elsewhere is the stage direction it was.
- **What another rule would read first.** The tokenizer tries a scene heading, a centered line and a transition before it tries a cue, and its rule for each wants the line alone in its block. A cue is written with a line under it, so none of the three takes one. `INT. HOUSE` over a speech is a cue with no `@`. `CUT TO:`, `FADE OUT.` and `> THE END <` are refused by the cue's own rule and taken behind an `@`.
- **The limit.** The tokenizer has no cue, forced or not, whose name holds `^`, `(` or `)` anywhere but in one trailing bracket: `A^B`, `MARA (V.O.) AGAIN`. An `@` cannot help such a line and this rule adds none. The line still comes back as an `action`. A `^` that ends a name is the dual mark to it.
- **What is left alone.** A cue with lower case in its name or a note on it is forced as before ([EDIT-138](#EDIT-138), [EDIT-174](#EDIT-174)). A cue with no name, and one whose own text holds a line break, are written as they were.

`src/fountain/roundtrip.test.ts` pins each kind of name over a speech and with none, with and without an extension and a `^`, emphasised, with lower case, with a comment and over a song. It holds every printable character, in each place it can stand in a name, to the tokenizer's own rule: an `@` exactly where the line would not be taken without one. It also pins the limit, and the reading of a line that has no `@`.

<a id="FOUN-D109"></a>

#### Parse direction

<a id="EDIT-149"></a>

**EDIT-149** `fountain-js` tokens → model:

- <a id="EDIT-150"></a> **EDIT-150** Title-page tokens → `frontMatter` (standard keys mapped to fields; `Setting`/`Time`/`Place`/`Characters` to the house fields; everything else preserved in `frontMatter._extra` so unknown keys survive — storage "preserve-unknown-keys"). A key named twice is read as all it was given ([EDIT-190](#EDIT-190)), and unknown keys left alone on a title page are still its lines on the reopen ([EDIT-192](#EDIT-192)). The title page is read by `src/fountain/titlepage.ts` and by no other reader: the tokenizer is handed the script alone, and asked for no title page ([EDIT-184](#EDIT-184)).
- <a id="EDIT-151"></a> **EDIT-151** `#`/`##`/`###` → `act`/`scene`/(nested scene); deeper levels collapse to `scene` with a depth attr if needed.
- <a id="EDIT-152"></a> **EDIT-152** Scene-heading tokens → `sceneHeading` (record `sceneNumber`, whether it was forced).
- <a id="EDIT-153"></a> **EDIT-153** Character/parenthetical/dialogue → respective nodes; `^` → `dual`; extension captured.
- <a id="EDIT-154"></a> **EDIT-154** `=` → `synopsis`; `~` → `lyric`; `>text<` → `centered`; `>x` → `transition`; `===` → `pageBreak`; `/* */` → `boneyard`; `[[ ]]` → `note`.
- <a id="EDIT-155"></a> **EDIT-155** Inline `*`/`**`/`_` → marks.

<a id="FOUN-D110"></a>

#### Scene anchors (embedded mode)

<a id="EDIT-156"></a>

**EDIT-156** When `settings.sceneAnchors = embedded` ([docs/app/keeping-work/storage-and-file-format.md#STOR-D8](../app/keeping-work/storage-and-file-format.md#STOR-D8)), the app writes a note of the exact form `[[id:<ULID>]]` immediately after a scene heading. Such a note is treated as a **scene anchor, not author content**: it is recognized by its `id:` prefix, hidden from the rendered page, preserved verbatim through every open→edit→save cycle, and **never** surfaced as a note chip. Every other `[[ … ]]` is an author `note`. In the default `sidecar` mode, no anchor notes are written and scripts stay pristine.

<a id="EDIT-173"></a>

**EDIT-173** One more note is machinery and not author content: a **range marker**, of the exact form `[[{]]` or `[[}]]`, with or without a number after the brace (`[[{2]]`). A pair fences the text a comment is about ([docs/app/writing/comments.md#COMM-61](../app/writing/comments.md#COMM-61)). The **model** holds the two as `note` nodes, which is how `parse` reads them and `serialize` writes them. The **editor** holds neither: `src/editor/bridge.ts` turns a pair into a `commentRange` mark on the words between and a `commentRangeEnd` mark on the comment after, and writes the marks back as the two notes, each directly where it was read (`src/comments/ranges.ts`). A script the app wrote comes back from the editor byte for byte. A marker that fences nothing stays the note it is, hidden and never a chip, and is preserved verbatim.

<a id="EDIT-174"></a>

**EDIT-174** **A note on a cue or a heading does not change what the line is.** The tokenizer reads a line's kind from every character on it, a note's among them. A cue in capitals with a note in lower case is action to it; a forced cue is `@`, a name with no `(`, `)` or `^`, an optional `(extension)` and then spaces only, so a note with a bracket or a caret in it, or one standing after the extension, makes the line action too; and a note that holds a line break cuts a cue or a heading in two. Each of these turned a `character` or a heading with a comment on it into an `action` on the next read, the cue's speech run into the same block.

- **Writing.** `serialize` forces (`@`) every cue that holds a note, whatever its capitals.
- **Reading.** `parse` holds the notes of a forced cue back from the tokenizer (`src/fountain/name-notes.ts`). The tokenizer judges the line without them. A line it takes for a cue is then read from what was written, notes and all; a line it refuses (no speech under it, a caret in the name) is put back exactly as it stood. A cue or a heading whose note runs over a line break is one line again by the rule for every line, [EDIT-180](#EDIT-180).
- **The extension.** A cue's extension is still the last bracket of its own text ([EDIT-124](#EDIT-124)), read with the notes left out. It is the block's `extension` attribute only while every note stands in front of it: `@MARA[[x]] (V.O.)` is the name `MARA` with a note, and the extension `(V.O.)`. The attribute is a string and can hold no note, so with a note inside or after the bracket the bracket stays in the cue's text, `@MARA (V.O.)[[x]]`, which is how `src/editor/bridge.ts` hands such a cue over and where the layout engine already looks for it. White space between a name and its bracket is not part of the name, with a note in it or without.
- **What is left alone.** A cue with no `@` is read by the tokenizer as before: capitals with a note in capitals is a cue, and capitals with a note in lower case is action, because it may be a stage direction and every script on disk reads as it did. A line that is only notes is unchanged ([EDIT-172](#EDIT-172)).

`src/fountain/roundtrip.test.ts` pins a cue with a note before, inside and after its name, with an extension on either side of the note, as the right-hand cue of a dual pair, and with brackets, a caret and a line break in the note; and each kind of heading. `src/editor/bridge.test.ts` pins that such a cue comes back onto the page as it left it.

<a id="EDIT-180"></a>

**EDIT-180** **A line break in a note does not change what the line is.** A note may run over line breaks, and a comment has one wherever Enter was pressed in it ([docs/app/writing/comments.md#COMM-15](../app/writing/comments.md#COMM-15)). The tokenizer cuts a block into lines before it reads any of them and knows nothing of a note, so the break ended the line the note stood on. A `transition`, a `centered` line or a `synopsis` with such a note was two lines, and so an `action`. A `parenthetical` lost its closing bracket to the next line and became `dialogue`. A note's second line was read as script: one in brackets was a `parenthetical` in the middle of the note, and a note on a line of its own whose first line was in capitals was a cue with the rest of it for a speech. The tokenizer also did to a note's later lines what it does to a line of script: took a `!` off the front, turned a tab into spaces, trimmed the ends and emptied a line of two spaces.

- **Reading.** Before the body is tokenized, `parse` swaps every line break inside a note for a tag and gives each token's text its breaks back (`src/fountain/note-breaks.ts`). The tokenizer then reads a note that holds a line break exactly as it reads the same note written on one line. This runs before a forced cue's notes are held ([EDIT-174](#EDIT-174)). A note is `[[` to the next `]]` inside its block, as inline text reads one, with a backslash making the next character a literal; a `[[` with no `]]` before the blank line that ends its block is text.
- **What else is held.** On a `centered` line the `<` and `>` inside a note are held the same way: the line's text is read with every one of them stripped, and a note of `a > b` came back as `ab`. They are held with the line's own, by [EDIT-187](#EDIT-187).
- **Writing an `action`.** It is forced by its first line as the next reader is shown it, a note's line breaks not being the line's: `She walks [[a⏎b]] over TO:` is one line that ends in `TO:`, and a note whose first line is in capitals is not in capitals if its second is not.
- **Writing a `transition`.** One that holds a note is always forced (`>`), as a cue is. `CUT [[A]]TO:` passed for a natural transition and is none to the tokenizer, which wants a space before `TO:`. A transition written before this with a note and no mark is read as it was.
- **Writing a `lyric`.** Every line of a lyric is written with its `~`, a note's own later lines among them, which is what the script already held and keeps the block a lyric to any reader. The tokenizer takes the `~` off the lines it is shown, and `parse` takes it off the ones inside a note. A `~` that opens a line of the note itself is written after the lyric's, `~~`.
- **Writing a note.** A note may hold no blank line: one ends the block, and cuts the note and its line in two. A line of a note that is empty or white space is written as Fountain's two spaces, which keep a block going, and a line of two spaces in a note is kept when it is read, by whatever wrote it.
- **What is left alone.** A line with no forcing mark is still the tokenizer's to judge on every character, a note's among them ([EDIT-174](#EDIT-174)). `MARA[[CUT⏎THIS]]` over a line is the cue that `MARA[[CUT THIS]]` is, and `MARA[[Robin:⏎rename?]]` is the action that `MARA[[Robin: rename?]]` is; before, the first line of the note alone decided it, and the note was cut in two either way. A bare blank line still ends a block and any note open in it.

`src/fountain/roundtrip.test.ts` pins a note of two lines on every kind of line, in front of the line's text, inside it and after it; fourteen second lines the tokenizer would have acted on, each on every kind of line; the forcing of an action and a transition; a lyric written by the app, by the app before this and by hand; and a blank line in a note.

<a id="EDIT-181"></a>

**EDIT-181** **A forcing mark says what a line is, whatever the line ends in.** The tokenizer takes a line of its own that ends in ` TO:` for a transition before it looks at how the line opens, and hands back the whole line, mark and all. So `> Smash cut TO:` came back as a transition whose text began `> `, and every save put another `> ` in front of it; `!He points TO:` was a transition with a `!` in it; and `## Back TO:`, `= We go back TO:` and `~La la TO:` were no scene, no synopsis and no lyric. `parse` reads such a token by its mark, as the tokenizer's own rule for that mark would have: the `>` comes off a transition, and a line that opens with `#`, `=`, `~` or `!` is the section, synopsis, lyric or action it says it is. A line with no mark that ends in ` TO:` is a transition, as before. `serialize` writes a transition with no mark only when that is how it will be read: in capitals, with words and a space before `TO:`, and with no mark opening its own text. `TO:` alone and `CUT-TO:` are written with `>`, and so is `#1 CUT TO:`, which is a section without it. This was found because a note's line break used to keep such a line out of the rule by making it two lines ([EDIT-180](#EDIT-180)).

<a id="EDIT-182"></a>

**EDIT-182** **A note on a line of its own is the words it holds.** A line of notes and nothing else ([EDIT-172](#EDIT-172)) is read as inline text whether it holds one note or several, and inline text takes a note's words as they stand. A line of one note used to have its text read for emphasis, which the serializer does not write back: `[[see snake_case_name]]` lost its underscores on the next save, and `[[*really*]]` its asterisks. A note inside a line never was read so.

<a id="EDIT-185"></a>

**EDIT-185** **The `!` in front of a stage direction is its mark, and what stands behind it is the direction as it was typed.** The tokenizer takes one `!` off the front of each line of a stage direction, and only when no space follows it. So a forced `action` that opened with a space came back with the mark in its text: `    FADE` was written `!    FADE`, read as `!    FADE`, and saved as `!!    FADE` from then on. The same happened to every indented direction that has to be forced: one in capitals, one that opens with a slug or a mark, one that ends in `TO:`. And a line lower in the block that opened with a `!` of its own lost it: `She waits.` over `!bang` came back as `She waits.` over `bang`.

- **Reading.** Before the body is tokenized, `parse` parts the `!` that opens a block from the space after it (`src/fountain/own-marks.ts`), and the tokenizer takes it off as it takes any other. What follows the mark is the direction's text, its indent included. A line of its own that ends in ` TO:` is read by its mark as before ([EDIT-181](#EDIT-181)), and keeps its indent too.
- **Writing.** A forced `action` is `!` and then its text as it stands, which is what was already written. A line of the block that opens with a `!` the tokenizer would take, behind an indent or not, is written with a second: `!!bang`. The second is the one it takes. A `!` with a space after it on a later line is left alone by the tokenizer, and is written as it stands.
- **What is left alone.** Only the `!` that is the first character of a block, with a space after it, is read this way, and only where its line goes on to hold something. A `!` with nothing but white space after it on its line, one behind an indent (`  ! x`), one on a later line of a stage direction and one in a speech are read as they were. A tab that opens a stage direction is four spaces to the tokenizer, as it was.
- **A script already saved.** `!    FADE`, written once from a direction of `    FADE`, reads as `    FADE` again, and its next save writes the same bytes. Saved a second time it holds `!!    FADE`, which is also how a direction reading `!    FADE` is written. Nothing tells the two apart, so it reads as it did, and the `!` is the writer's to delete. A script written elsewhere with `!` and a space in front of a direction reads without the `!`, as a forced direction should.

<a id="EDIT-186"></a>

**EDIT-186** **A stage direction is forced wherever the tokenizer would take it for something else.** `serialize` forced an `action` on four tests of its own: a mark that opens it, a first line in capitals, a slug that opens it, a first line that ends in `TO:`. Its test for capitals looked for a capital letter. The tokenizer's rule for a cue wants only that the line holds none of the letters `a` to `z` and has a line under it, and leaves out a line of digits, spaces, `*` and `_` alone. So an `action` of `1984.` over `She waits.` was written with no mark and came back as a `character` and a `dialogue`. So did a first line of `…`, `—` or `12:00.`; a first line in a script with no Latin letters, `她等着。` or `Привет.`; and a name in capitals with a bracket in lower case, `PAUSE (a long one)`, which is a cue with an extension. A slug behind an indent or inside emphasis, ` int. house` or `*Ext. the yard*`, alone in its block, came back as a `sceneHeading`. A mark behind a no-break space came back as the element the mark opens.

- **Writing.** After its four tests, `serialize` asks the tokenizer's own rules (`rules` in `fountain-js`) whether the block about to be written would be read as a scene heading, a centered line, a transition, a cue and its speech, a section, a synopsis, a lyric or a page break. If so the block is forced (`!`). The block is the one the next reader has: a note's line breaks are not the block's ([EDIT-180](#EDIT-180)), and an empty line ends it. So the `!` goes where it is needed and nowhere else.
- **What is left alone.** The four older tests are wider than the tokenizer: they force a line in capitals with nothing under it, and a slug with a line under it. They stay as they are, so no script on disk is rewritten for this by its next save. `1984` and `12` over a line are no cue to the tokenizer and are written with no mark, and so is `1984.` with nothing under it.
- **Reading.** Unchanged. `1984.` over a line in a script written elsewhere is the cue it was.

<a id="EDIT-187"></a>

**EDIT-187** **A centered line's `<` and `>` are its text, and a transition is not read as another element.** The tokenizer takes a line that opens with `>` and ends with `<` for a centered one, and reads its text with every `<` and `>` stripped, and the white space around each. So a `centered` block of `a < b`, written `> a < b <`, came back as `ab`. A `transition` whose text ended in `<` was written `> FADE <` and came back `centered`. And a transition in capitals that opened as a scene heading does, `INT. HOUSE - CUT TO:`, was written with no mark and came back a `sceneHeading`, which is the first thing the tokenizer looks for.

- **Reading a centered line.** Its marks are the first `>` on the line and the last `<`. `parse` holds every `<` and `>` between the two back from the tokenizer, a note's among them ([EDIT-180](#EDIT-180)), and each token's text gets its own back (`src/fountain/own-marks.ts`). White space at the two ends of the text is trimmed by the tokenizer, as it was.
- **Writing a centered line.** Each line of a `centered` block is written between its own marks: `> THE END <` over `> of act one <`. That is how another tool writes two centered lines one under the other, and they are read as one block. Written with the marks around the block, `> THE END` over `of act one <`, the second line had none and the block came back as an `action`. A note's line breaks are the note's, and no line of the block ([EDIT-180](#EDIT-180)).
- **Writing a transition.** A `<` that would end the line is written behind a backslash, `> FADE \<`. A backslash makes the next character a literal in any inline text ([EDIT-164](#EDIT-164)), and `parse` holds that `<` back, so the tokenizer is shown a line with no closing mark, which is a transition. A transition that would be read as a scene heading with no mark is forced (`>`).
- **A script already saved.** `> a < b <` reads as `a < b`, which is what was saved, and its next save writes the same bytes. Before, it read as `ab` and the next save wrote that. `> FADE <` is the centered line it was read as: nothing in the script says it was a transition once. A line that opens with `>` and ends in `\<`, which the app never wrote, was a centered line ending in a backslash and is now a transition.
- **What is left alone.** A line that opens with `>` in a speech, or among the lines of a stage direction, is text as it was. A centered line with no `<` or `>` of its own, and a transition that does not end in `<`, are read and written as they were.
- **The limit.** A `transition` that holds a line break is not kept, and still comes back as an `action`: Fountain has no transition of two lines. The editor makes none.

`src/fountain/roundtrip.test.ts` pins the three: an indented direction through three saves, each kind of forcing with an indent, a `!` that opens a block read as its mark and every other `!` read as it was, and a line's own `!`; first lines with no lower case over another line, with a letter and without, and the lines that need no mark; a slug behind an indent and inside emphasis, and a mark behind a no-break space; a centered line's `<` and `>`, in a script already saved and beside a note, and a centered block of two lines; a transition that ends in `<` or opens as a heading does. Two sweeps of generated lines hold every stage direction, centered line and transition of the kinds above to its type, its text and the same bytes on the next save, and hold the `!` to the places where the block with no mark is read as something else.

<a id="FOUN-D111"></a>

<a id="EDIT-191"></a>

**EDIT-191** **Fountain's two-space line opens no block.** Two spaces on a line of their own are an empty line that does not end its block ([docs/app/writing/editor-ux.md#EDIT-43](../app/writing/editor-ux.md#EDIT-43)). Every use of it has a line of its block over it: under a cue it is the speech with no words yet ([EDIT-175](#EDIT-175)), between two sung lines it parts two verses ([EDIT-183](#EDIT-183)), and lower in a speech or a stage direction it is an empty line of it. With no line of a block over it, at the top of a script or after a blank line, it has nothing to keep going. Such a line directly over another line was read as a character with no name, and the rest of the block as that character's speech. `A room.`, a blank line, two spaces and `She waits.` came back as the stage direction, a cue with nothing on it, and a speech reading `She waits.` The save after wrote an empty line for the cue, and the reading after that was two stage directions. A cue with its speech under such a line was one speech reading `MARA` and `Hello.`, and a heading, a transition or a forced stage direction was a line of speech with its mark in its text, until the script had been saved and opened once more.

- **Why it was a cue.** The tokenizer has no reading of its own for such a block. Its rule for blank lines leaves a two-space line on the front of the block that follows, and a block that opens with a line of white space is blank lines to it, whatever else the block holds ([EDIT-188](#EDIT-188)). So `parse` holds each two-space line as a word until the tokenizer is done. The word is in capitals, and a line in capitals with a line under it is a cue to the tokenizer. Taken out of the cue's text afterwards, it left a `character` block with no name.
- **Which scripts hold one.** `serialize` wrote one for a speech with no words and no cue over it that is followed by another line of speech or a bracketed one; for a speech with no cue over it whose text opens with an empty line; for either of those under a cue with no name, which is written as an empty line; and for a stage direction typed with two spaces alone on its first line. A script written elsewhere may hold one anywhere.
- **Reading.** A two-space line with no line of a block over it is a blank line, as every other line of white space above a block is. `parse` makes each one empty before the tokenizer reads (`src/fountain/empty-line.ts`): after the notes' line breaks are held ([EDIT-180](#EDIT-180)), so a note's own two-space line is the note's, and before a line's own marks and a forced cue's notes are ([EDIT-185](#EDIT-185), [EDIT-174](#EDIT-174)), so the block under it is read from its own first line by every rule. A cue is a cue with its speech, a heading a heading, and a `!` the mark of a stage direction. Several such lines over one block are each a blank line, with other white space among them or without. The block reads exactly as it does with an empty line where the two spaces were, on the first reading and on every one after. A line that holds two spaces beside a line separator and nothing else, which the hold took the two spaces out of, is read the same way.
- **Writing.** `serialize` writes each such line empty, so no block in a script the app writes opens with a two-space line. The lines are judged as the reader is shown them: a boneyard is a line of its own between blank ones, and a note's line breaks are the note's, so the two-space lines inside either are written as they were. At the top of a script the line is one of the lines of white space above the first words. Those were written empty already ([EDIT-189](#EDIT-189)), and the two-space line was the one left as typed.
- **Every reader reads the same script.** An empty line is a blank line to every Fountain reader. A version of this app from before the rule reads the script written this way exactly as this one does. With the two spaces left in, it reads a character with no name, and a reader built on the tokenizer alone has no block there at all: `A room.`, a blank line, two spaces and `She waits.` is the stage direction and blank lines to it. So a play saved by this version is the same page in an earlier one.
- **A speech with no cue.** A line of speech with no cue over it is a stage direction to every Fountain reader, and comes back as one. A speech with no words and no cue is a line of white space, and does not come back. The two together were the one case that came back as a speech, under a cue nobody wrote. Now each comes back as it does alone.
- **A script already saved.** A script reads as it did unless it holds a two-space line with no line of a block over it. Under a cue, in a speech, between two verses, inside a stage direction, in a note and in a boneyard the line is what it was. A two-space line alone in its block was white space and is. Two or more alone in a block were a character with no name over a speech of empty lines, and are white space. A block under such a line reads on the first opening as the tokenizer reads the block by itself. For most scripts that is where the script settled before, after one more save and reopen. Where it is not, the detour through a speech had changed the lines: a speech's reading trims an indent, which is kept now, and parts a sung line from the lines around it, which are the one block they are with nothing over them.
- **No script at rest is rewritten.** A script at rest holds no such line: a block that opened with one was read as a character with no name, which is written as an empty line. The writing changes only for a document that holds such a line from the editor, or from a script that was not at rest.
- **What is not kept.** The empty line itself, as before: a line of white space with no block around it is no block on the reopen ([EDIT-188](#EDIT-188)).
- **What is left alone.** A forcing mark with no name after it, `@` alone over a line, is a cue with no name to the tokenizer and is read as one. That is the mark's reading and not this line's. A stage direction whose own text holds an empty line is written with a blank line there, and what follows it is read by itself, as it was.
- **Why not otherwise.** A stage direction that opens with an empty line is the other reading such a block could have, and the tokenizer gives it if the held word is in lower case. The app cannot give that direction back: an empty line in a stage direction is written as a blank line, which ends the block, so the line would be on the page for one reopen and gone on the next, and a cue under it would be a line of a stage direction first and a cue after. Keeping it by writing the two spaces there writes the one block a reader built on the tokenizer drops, and an earlier version of this app reads as a character with no name. Keeping the block a speech, with a mark for a cue with no name over it, would put a character on the page that no writer made. And reading the line as blank only when a line stands under it would leave two of them alone in a block as that character over an empty speech.

`src/fountain/roundtrip.test.ts` pins the reported scripts, each on twelve readings and at rest from the first save; thirty-three blocks of every kind under each of twelve tops of one to four lines, with a title page and without, at the top of a script and lower, each read as it is with the two spaces empty and none with a character of no name; the line inside a block, under a cue, in a speech, between two verses, in a stage direction, in a note and in a boneyard, read and written as it was; two or more of the lines alone in a block; each document that wrote such a line, written with the line empty and read back by a stand-in for the earlier reader with no character of no name; the top of a script, where the tokenizer handed the script as it stands has every block; the first-line mark behind such a line ([EDIT-184](#EDIT-184)); a sweep of 4,000 generated scripts, each read as it is with the lines empty; and 3,000 generated documents, none written with the line over a block.

### Round-trip rules & fidelity guarantees

<a id="EDIT-157"></a>

**EDIT-157** The module must satisfy these, and they are the test contract:

1. <a id="EDIT-158"></a> **EDIT-158** **Semantic round-trip:** `parse(serialize(doc))` is structurally equal to `doc` (same nodes, attrs, marks, text). No element silently changes type. A cue with no speech under it comes back with an empty one ([EDIT-175](#EDIT-175)). An empty lyric or parenthetical does not come back, and a lyric that holds an empty line comes back as its verses ([EDIT-183](#EDIT-183)). A speech with no words and no cue over it does not come back, and the line under it comes back as it does alone ([EDIT-191](#EDIT-191)).
2. <a id="EDIT-159"></a> **EDIT-159** **Textual idempotency:** `serialize(parse(serialize(doc))) === serialize(doc)`. Once in canonical form, re-saving is a no-op byte-for-byte. (This is what keeps Syncthing quiet and diffs clean.)
3. <a id="EDIT-160"></a> **EDIT-160** **Valid, clean Fountain out:** output always parses in a conformant Fountain reader; canonical blank-line discipline (one blank line before a Character cue and before a Scene Heading; none after a cue; etc.).
4. <a id="EDIT-161"></a> **EDIT-161** **Defensive forcing:** any node whose natural text could re-parse as a different element is force-prefixed (`.`/`@`/`!`/`>`/`~`). This is mandatory — it is the mechanism behind guarantees 1 and 2.
5. <a id="EDIT-162"></a> **EDIT-162** **Preserve author intent on import:** opening a hand-authored or third-party `.fountain` preserves (a) intentional internal whitespace in Action (Fountain treats line breaks as intentional), (b) unknown title-page keys, (c) notes and boneyard content. The **first save normalizes to canonical form** (that's "clean Fountain"), changing structural spacing but never content or semantics.
6. <a id="EDIT-163"></a> **EDIT-163** **Never lose unknown content:** boneyard, notes, and unrecognized title-page keys are retained through a full open→edit→save cycle. Unrecognized keys left alone on a title page are retained as the title page ([EDIT-192](#EDIT-192)).
7. <a id="EDIT-164"></a> **EDIT-164** **Escaping is reversible:** text containing `*`, `_`, `[`, `]`, `#`, leading `.`/`>`/`~`/`!` is escaped on output and unescaped on input so literal characters survive. So do a `!` that opens any line of a stage direction ([EDIT-185](#EDIT-185)) and the `<` and `>` of a centered line or a transition ([EDIT-187](#EDIT-187)).
8. <a id="EDIT-172"></a> **EDIT-172** **A line of several notes is several notes.** The tokenizer's rule for a note on a line of its own runs from the line's first `[[` to its last `]]`, so `[[a]][[b]]` came back as one note whose text was `a]][[b`, and a word between two notes on such a line was hidden inside it. A line the rule matches that holds a `]]` is read as inline text instead, which finds each note and leaves a word between them as script. A line of notes and nothing else is written back as it stands and is never force-prefixed, whatever its capitals. This is what lets a comment and its reply stand on a line of their own ([docs/app/writing/comments.md#COMM-50](../app/writing/comments.md#COMM-50)).

<a id="FOUN-D112"></a>

#### Normalization (the canonical form)

- <a id="EDIT-165"></a> **EDIT-165** One blank line between body elements; the cue→dialogue pair has no blank between cue and first parenthetical/dialogue line. A lyric directly under a cue has none either, and a cue with no speech is followed by the two-space line and then the blank one ([EDIT-175](#EDIT-175)). Every line of a speech down to its last parenthetical or dialogue stands in the cue's block, two verses there parted by the two-space line; a lyric after that line stands after a blank one, as each verse of a song with no cue does ([EDIT-183](#EDIT-183)).
- <a id="EDIT-166"></a> **EDIT-166** Scene/act Section lines preceded by a blank line.
- <a id="EDIT-167"></a> **EDIT-167** Title page first; single blank line then body.
- <a id="EDIT-168"></a> **EDIT-168** LF endings, UTF-8 (NFC), single trailing newline. (Same discipline as JSON files — docs/app/keeping-work/storage-and-file-format.md#STOR-D2.)

<a id="FOUN-D113"></a>

### Scenes for the corkboard

<a id="EDIT-169"></a>

**EDIT-169** Scene extraction for the workspace views reads the **same parse**: scene boundaries are `scene` (`##`) nodes, falling back to `sceneHeading`, falling back to whole-document (per [workspace-model](../app/organizing/workspace-model.md#WORK-D104)). Each scene's `synopsis` node text is its card description (the `_synopsis` cache in the index sidecar); the scene's identity/anchor handling and the card metadata live in `<basename>.index.json` (docs/app/keeping-work/storage-and-file-format.md#STOR-D6). The data-model module exposes `extractScenes(doc) → [{ id?, heading, synopsis, range }]` consumed by both the corkboard and the reconciliation step.

## Design

`src/fountain/` owns parsing, serialization and scene extraction. `src/editor/bridge.ts` translates between that model and the editable ProseMirror representation. [Editor behavior](../app/writing/editor-ux.md) governs the writing surface.
