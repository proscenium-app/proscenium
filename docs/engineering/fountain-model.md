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
| `character` | body | `inline*` | `{extension, dual, forced}` | The cue (name + optional extension). | <a id="EDIT-109"></a>EDIT-109 |
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

**EDIT-123** A "speech" is just the adjacency `character (parenthetical | dialogue)+` in the flat doc — no wrapper node. **Dual dialogue** is the second speech's `character` carrying `dual: true` (Fountain `^`); rendering the two speeches side-by-side is a view concern, not a model one.

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

<a id="EDIT-131"></a>

**EDIT-131** A blank line terminates the title page; the body follows (Fountain's implicit post-title page break).

<a id="FOUN-D108"></a>

### Element ⇄ Fountain mapping (serialize direction, with forcing)

<a id="EDIT-132"></a>

**EDIT-132** Serialization is **canonical** and **defensive** — it forces elements whenever an un-forced line could re-parse as something else, which is what guarantees idempotency.

| Node | Fountain output | Forcing rule | Requirement |
|------|-----------------|--------------| --- |
| `act` | `# ACT ONE` | always a Section line | <a id="EDIT-133"></a>EDIT-133 |
| `scene` | `## SCENE 1` | always a Section line | <a id="EDIT-134"></a>EDIT-134 |
| `sceneHeading` | `.A kitchen. Night.` or `INT. …` | prefix `.` unless the text already begins with `INT/EXT/EST/I/E` (+ space/dot) | <a id="EDIT-135"></a>EDIT-135 |
| `action` | paragraph text | prefix `!` if the line is all-caps or otherwise risks parsing as a Character/Scene Heading; preserve intentional internal blank lines | <a id="EDIT-136"></a>EDIT-136 |
| `action` (centered) | `> text <` | | <a id="EDIT-137"></a>EDIT-137 |
| `character` | `MARA` / `@McARDLE` / `MARA (O.S.)` / `MARA ^` | prefix `@` if mixed/lower case; append `(ext)` for extension; append ` ^` if `dual` | <a id="EDIT-138"></a>EDIT-138 |
| `parenthetical` | `(quietly)` | wrap in parens | <a id="EDIT-139"></a>EDIT-139 |
| `dialogue` | text | — | <a id="EDIT-140"></a>EDIT-140 |
| `transition` | `CUT TO:` / `>BLACKOUT.` | prefix `>` unless the line is uppercase ending in `TO:` | <a id="EDIT-141"></a>EDIT-141 |
| `lyric` | `~line` | prefix `~` on every line (always forced) | <a id="EDIT-142"></a>EDIT-142 |
| `synopsis` | `= text` | | <a id="EDIT-143"></a>EDIT-143 |
| `pageBreak` | `===` | | <a id="EDIT-144"></a>EDIT-144 |
| `boneyard` | `/* text */` | the one element allowed to span blank lines | <a id="EDIT-145"></a>EDIT-145 |
| `note` (inline) | `[[ text ]]` | | <a id="EDIT-146"></a>EDIT-146 |
| `strong`/`em`/`underline` | `**`/`*`/`_` | escape literal `*` `_` in text with `\` | <a id="EDIT-147"></a>EDIT-147 |
| scene number (attr) | ` #1A#` appended to a scene heading | | <a id="EDIT-148"></a>EDIT-148 |

<a id="FOUN-D109"></a>

#### Parse direction

<a id="EDIT-149"></a>

**EDIT-149** `fountain-js` tokens → model:

- <a id="EDIT-150"></a> **EDIT-150** Title-page tokens → `frontMatter` (standard keys mapped to fields; `Setting`/`Time`/`Place`/`Characters` to the house fields; everything else preserved in `frontMatter._extra` so unknown keys survive — storage "preserve-unknown-keys").
- <a id="EDIT-151"></a> **EDIT-151** `#`/`##`/`###` → `act`/`scene`/(nested scene); deeper levels collapse to `scene` with a depth attr if needed.
- <a id="EDIT-152"></a> **EDIT-152** Scene-heading tokens → `sceneHeading` (record `sceneNumber`, whether it was forced).
- <a id="EDIT-153"></a> **EDIT-153** Character/parenthetical/dialogue → respective nodes; `^` → `dual`; extension captured.
- <a id="EDIT-154"></a> **EDIT-154** `=` → `synopsis`; `~` → `lyric`; `>text<` → `centered`; `>x` → `transition`; `===` → `pageBreak`; `/* */` → `boneyard`; `[[ ]]` → `note`.
- <a id="EDIT-155"></a> **EDIT-155** Inline `*`/`**`/`_` → marks.

<a id="FOUN-D110"></a>

#### Scene anchors (embedded mode)

<a id="EDIT-156"></a>

**EDIT-156** When `settings.sceneAnchors = embedded` ([docs/app/keeping-work/storage-and-file-format.md#STOR-D8](../app/keeping-work/storage-and-file-format.md#STOR-D8)), the app writes a note of the exact form `[[id:<ULID>]]` immediately after a scene heading. Such a note is treated as a **scene anchor, not author content**: it is recognized by its `id:` prefix, hidden from the rendered page, preserved verbatim through every open→edit→save cycle, and **never** surfaced as a note chip. Every other `[[ … ]]` is an author `note`. In the default `sidecar` mode, no anchor notes are written and scripts stay pristine.

<a id="FOUN-D111"></a>

### Round-trip rules & fidelity guarantees

<a id="EDIT-157"></a>

**EDIT-157** The module must satisfy these, and they are the test contract:

1. <a id="EDIT-158"></a> **EDIT-158** **Semantic round-trip:** `parse(serialize(doc))` is structurally equal to `doc` (same nodes, attrs, marks, text). No element silently changes type.
2. <a id="EDIT-159"></a> **EDIT-159** **Textual idempotency:** `serialize(parse(serialize(doc))) === serialize(doc)`. Once in canonical form, re-saving is a no-op byte-for-byte. (This is what keeps Syncthing quiet and diffs clean.)
3. <a id="EDIT-160"></a> **EDIT-160** **Valid, clean Fountain out:** output always parses in a conformant Fountain reader; canonical blank-line discipline (one blank line before a Character cue and before a Scene Heading; none after a cue; etc.).
4. <a id="EDIT-161"></a> **EDIT-161** **Defensive forcing:** any node whose natural text could re-parse as a different element is force-prefixed (`.`/`@`/`!`/`>`/`~`). This is mandatory — it is the mechanism behind guarantees 1 and 2.
5. <a id="EDIT-162"></a> **EDIT-162** **Preserve author intent on import:** opening a hand-authored or third-party `.fountain` preserves (a) intentional internal whitespace in Action (Fountain treats line breaks as intentional), (b) unknown title-page keys, (c) notes and boneyard content. The **first save normalizes to canonical form** (that's "clean Fountain"), changing structural spacing but never content or semantics.
6. <a id="EDIT-163"></a> **EDIT-163** **Never lose unknown content:** boneyard, notes, and unrecognized title-page keys are retained through a full open→edit→save cycle.
7. <a id="EDIT-164"></a> **EDIT-164** **Escaping is reversible:** text containing `*`, `_`, `[`, `]`, `#`, leading `.`/`>`/`~`/`!` is escaped on output and unescaped on input so literal characters survive.

<a id="FOUN-D112"></a>

#### Normalization (the canonical form)

- <a id="EDIT-165"></a> **EDIT-165** One blank line between body elements; the cue→dialogue pair has no blank between cue and first parenthetical/dialogue line.
- <a id="EDIT-166"></a> **EDIT-166** Scene/act Section lines preceded by a blank line.
- <a id="EDIT-167"></a> **EDIT-167** Title page first; single blank line then body.
- <a id="EDIT-168"></a> **EDIT-168** LF endings, UTF-8 (NFC), single trailing newline. (Same discipline as JSON files — docs/app/keeping-work/storage-and-file-format.md#STOR-D2.)

<a id="FOUN-D113"></a>

### Scenes for the corkboard

<a id="EDIT-169"></a>

**EDIT-169** Scene extraction for the workspace views reads the **same parse**: scene boundaries are `scene` (`##`) nodes, falling back to `sceneHeading`, falling back to whole-document (per [workspace-model](../app/organizing/workspace-model.md#WORK-D104)). Each scene's `synopsis` node text is its card description (the `_synopsis` cache in the index sidecar); the scene's identity/anchor handling and the card metadata live in `<basename>.index.json` (docs/app/keeping-work/storage-and-file-format.md#STOR-D6). The data-model module exposes `extractScenes(doc) → [{ id?, heading, synopsis, range }]` consumed by both the corkboard and the reconciliation step.

## Design

`src/fountain/` owns parsing, serialization and scene extraction. `src/editor/bridge.ts` translates between that model and the editable ProseMirror representation. [Editor behavior](../app/writing/editor-ux.md) governs the writing surface.
