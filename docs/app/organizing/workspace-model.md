# Workspace: binder, board, outline and cast

[Organizing a play](README.md) › Workspace

The workspace connects scripts, scenes and supporting materials. Its views share one model; each section below defines a feature and its boundaries.

[Binder](#WORK-D1) · [Corkboard](#WORK-D2) · [Outline](#WORK-D3) · [Materials](#WORK-D105) · [Cast](#WORK-D110)

## Requirements

<a id="WORK-D100"></a>

<a id="WORK-1"></a>

**WORK-1** How the binder-and-corkboard organization works, and — the part that matters — exactly how every reorder maps to the canonical files on disk. Schemas live in [`storage-and-file-format.md`](../keeping-work/storage-and-file-format.md); this doc is the *model and interactions*.

<a id="WORK-D101"></a>

### The hierarchy

```
Plays folder  (any folder — you choose it once)     nothing is written here
└── Play  (the thing you open)                      <Play>/<Play>.proscenium
    └── Binder item  (script | folder | document)   the play file → binder[]
        └── (for a script) Scenes / beats           scenes inside the .fountain
```

- <a id="WORK-2"></a> **WORK-2** A **Plays folder** holds plays as its immediate children. A directory is a play iff it directly contains a `.proscenium` file; everything else in the folder is ignored and never shown. The app writes **nothing** at the root.
- <a id="WORK-3"></a> **WORK-3** A **play** = one piece. It is portable as a unit (copy/zip/move) and readable without the app.
- <a id="WORK-4"></a> **WORK-4** A **binder item** is a script, a folder, or a document, arranged in an ordered tree. There is no title on it: the filename is the title (docs/app/keeping-work/storage-and-file-format.md#STOR-D4).
- <a id="WORK-5"></a> **WORK-5** **Scenes** live inside a script's `.fountain` file; the corkboard treats each as a card, and the card metadata lives in the play file under `scripts[<binder id>]`.

<a id="WORK-6"></a>

**WORK-6** **There is no sub-project layer.** "One play, two full drafts each with
their own research" is roadmap and explicitly unsupported; the answer today is
two plays (docs/app/keeping-work/storage-and-file-format.md#STOR-D17).

<a id="WORK-D102"></a>

### Three views over one model

<a id="WORK-7"></a>

**WORK-7** The editor aside, the workspace presents three coordinated views. All three read the same manifests and the same parsed scenes; they are lenses, not separate data.

<a id="WORK-D1"></a>

#### Binder (left rail) — the materials tree

<a id="WORK-8"></a>

**WORK-8** An ordered outline of everything in the play. Renders the play file's `binder[]` tree. Folders expand; scripts and documents are leaves.

<a id="WORK-9"></a>

**WORK-9** **The binder is the folder.** Every directory in the play is a binder folder,
every `.fountain` is a script, every `.md` a document, and anything else a
reference. There are no reserved folder names and nothing is ignored by name —
what the writer sees in Finder and what they see in the binder are the same
tree. `archive/`, `exports/` and `chats/` are ordinary folders. Selecting a script opens it in the editor; selecting a material opens it (Markdown materials open as an editable page — see *Editing a material* below; references like PDFs open read-only / externally).

<a id="WORK-10"></a>

**WORK-10** **Disk mapping of binder operations:**

| Action | Disk effect | Requirement |
|--------|-------------| --- |
| Reorder an item within its folder | Reorder the entries in the parent's `binder[]` array → rewrite the play file. No file moves. | <a id="WORK-11"></a>WORK-11 |
| Move an item into another folder | Move the entry in the `binder[]` tree **and** move the file on disk into that folder; update the entry's `path`. | <a id="WORK-12"></a>WORK-12 |
| Rename an item | Rename the file or directory, via `fileName(title)`, and update `path`. There is no `title` to update — renaming *is* the path change (see *One name* below). Identity (`id`) is unchanged, so card data and references survive. | <a id="WORK-13"></a>WORK-13 |
| New folder | Add an ordered `binder[]` entry and **write nothing**. The directory appears when the first file lands in it (create-on-demand, docs/app/keeping-work/storage-and-file-format.md#STOR-D3). | <a id="WORK-14"></a>WORK-14 |
| New script / document | Create the file and add an ordered `binder[]` entry, next to the selection rather than at the end. | <a id="WORK-15"></a>WORK-15 |
| Duplicate a file | Copy it to `<name> copy` beside the original. A script's copy starts with no card records: scene ids are unique to a script, so sharing them would give one scene two boards. Files only — a folder has no recursive copy behind it. | <a id="WORK-16"></a>WORK-16 |
| Delete | Moves the file to the OS trash, removes the `binder[]` entry, and drops that script's `scripts[]` entry. Never a silent unlink. A folder with no directory just loses its row. | <a id="WORK-17"></a>WORK-17 |

<a id="WORK-18"></a>

**WORK-18** **Every drop gesture resolves through one pure function**, `binder.ts` `dropPlan`,
which turns (dragged, target, before/after/inside) into the single
`(parent, index)` a move needs. `atIndex` is a position in the array *after* the
dragged item has been spliced out, so a drop within one folder subtracts one when
moving downward. That arithmetic is the thing drag-and-drop gets wrong
invisibly — the row simply doesn't move, which reads as "drag is broken" — so it
lives in a tested function rather than in the component.

<a id="WORK-19"></a>

**WORK-19** **The rail draws what will happen.** An insertion line at the depth the item will
land at, a ring on the folder that will receive it, a shut folder that springs
open under a hovering drag, and the blank below the last row as a "move to the
top level" target. A tree without those is a tree where a drop that misses by
three pixels does nothing and says nothing.

> Native builds set `dragDropEnabled: false` in `tauri.conf.json`. Tauri's own
> OS-level drag handler otherwise sits in front of the webview and can swallow
> HTML5 drag events; nothing in the app wants an OS file drop, so the setting
> costs nothing and removes a whole class of "it works in the browser" bug.

<a id="WORK-D103"></a>

##### One name

<a id="WORK-20"></a>

**WORK-20** A material's **filename is its title**. Not a slug derived from one — the name
itself, spaces and capitals included (`characters/Sophie Barrow.md`).
`workspace/filename.ts` is the only transform and it removes only what a
filesystem cannot hold: `/ \ : * ? " < > |`, control characters, a leading dot,
a trailing dot or space, and the Windows device names. Where the result differs
from what was typed, **the binder adopts the real filename**, so the row and the
folder never disagree.

<a id="WORK-21"></a>

**WORK-21** The filename is the only title; paths use the writer's words rather than slugs (docs/app/keeping-work/storage-and-file-format.md#STOR-D4).

<a id="WORK-22"></a>

**WORK-22** All writes are atomic (docs/app/keeping-work/storage-and-file-format.md#STOR-D9). A file appearing on disk that isn't in the
binder is **filed automatically**, at the end of the folder it sits in, and
shown with a dot until the writer has looked at it. There is no "unfiled" state
for them to learn (docs/app/keeping-work/storage-and-file-format.md#STOR-D8).

<a id="WORK-D2"></a>

#### Corkboard — scenes and beats as index cards

<a id="WORK-23"></a>

**WORK-23** The corkboard is the heart of structural work. For a selected script it shows **one card per scene**, in document order, laid out as a grid of index cards.

<a id="WORK-24"></a>

**WORK-24** Each card shows: the scene heading (or act/scene label), the **synopsis** (the Fountain `=` line — editable on the card, writes back to the script), and the card chips — **color**, **status** (`idea · outline · draft · revised · locked`), and **label**. Heading and synopsis come from the script and are recomputed on every reconcile, never stored; color/status/label come from the play file (`scripts[<binder id>].scenes[].card`, canonical there). This is the one-home-per-datum rule from docs/app/keeping-work/storage-and-file-format.md#STOR-D6 made visible.

<a id="WORK-25"></a>

**WORK-25** **Reordering a card reorders the underlying structure on disk** — the defining requirement:

1. <a id="WORK-26"></a> **WORK-26** The user drags scene card B before scene card A.
2. <a id="WORK-27"></a> **WORK-27** The app moves the **entire scene block** (heading + its body, up to the next scene heading) within the `.fountain` file and serializes — the script is canonical for order (docs/app/keeping-work/storage-and-file-format.md#STOR-D6).
3. <a id="WORK-28"></a> **WORK-28** The app rewrites the order of `scripts[<id>].scenes[]` in the play file to match, carrying each scene's `card.*` and `id` with it (identity follows the scene, not the position — anchors in docs/app/keeping-work/storage-and-file-format.md#STOR-D6 guarantee this even after the move).
4. <a id="WORK-29"></a> **WORK-29** Both writes are atomic; the corkboard re-renders from the new order.

<a id="WORK-30"></a>

**WORK-30** Card-level edits that *don't* touch the script (recolor, change status, set a label) rewrite only the play file. Editing a card's synopsis writes the `=` line into the `.fountain` (it's Fountain-expressible, so the file owns it).

<a id="WORK-31"></a>

**WORK-31** **A card can come first.** "New Scene" on the board appends an empty scene to the `.fountain` and the card arrives through the ordinary reconcile — the board is still a lens on the script, but the lens can now create what it looks at. Without this a card existed only *because* a scene did, which made the board unusable for the thing a corkboard is for at the start of a play, and made the board↔script relationship genuinely hard to read. The new scene matches the boundary the script already uses: `##` where the script has `##` scenes, a forced `.heading` where it uses scene headings, and `##` in an empty script. Getting that wrong is not cosmetic — `extractScenes` prefers `scene` over `sceneHeading`, so a stray `##` in a heading-based script would make every existing card vanish from the board with the file untouched.

<a id="WORK-32"></a>

**WORK-32** **Card granularity / zoom.** Default card = a Scene. The corkboard can group cards by **Act** (a band per `#` section) and can drill to **beat** cards within a scene, where a beat is a `=` synopsis or a `###` sub-section. Beat-cards reorder beats the same way scene-cards reorder scenes.

<a id="WORK-D3"></a>

#### Outliner — the scratchpad and the structured table

<a id="WORK-33"></a>

**WORK-33** Two halves of one surface.

<a id="WORK-34"></a>

**WORK-34** **The scratchpad**, at the top: a freeform Markdown page for thinking about shape. The table below can only hold what the play *is* — you cannot type "what if the brother arrives in act two instead" into a status dropdown — so the loose thinking that precedes structure lives here, beside the structure it is about instead of in another app. One per play, autosaved, collapsible (with a one-line peek when collapsed). It is a real binder material of type `outline` at `notes/outline.md` (docs/app/keeping-work/storage-and-file-format.md#STOR-D5), created only when the writer actually types something, and the Outline surface is its only editor.

<a id="WORK-35"></a>

**WORK-35** **The table**, below it: the same scenes as rows in a sortable, scannable list — heading · synopsis · status · label · length (estimated pages/lines). Good for a bird's-eye pass: retitle, rewrite synopses, bulk-set status, spot a sagging act. Editing a synopsis or heading writes to the script; editing status/label writes to the sidecar. Reordering rows reorders scenes exactly as the corkboard does.

<a id="WORK-D104"></a>

### Act / Scene structure mapping

<a id="WORK-36"></a>

**WORK-36** Stage plays are organized by **Acts and Scenes**, not by `INT./EXT.` sluglines. The house mapping:

- <a id="WORK-37"></a> **WORK-37** **Act** ⇄ Fountain Section `#` (`# ACT ONE`).
- <a id="WORK-38"></a> **WORK-38** **Scene** ⇄ Fountain Section `##` (`## SCENE 1`).
- <a id="WORK-39"></a> **WORK-39** The app renders these centered (house style, [editor-ux](../writing/editor-ux.md)) **and** uses them as the navigable hierarchy for the binder/corkboard/outliner. A scene is the default **card** unit.
- <a id="WORK-40"></a> **WORK-40** The **Scene Heading element** (a forced Fountain scene heading, e.g. `.A kitchen. Night.`) is an *optional* setting line inside a scene, printed as a centered/italic locale line. It is not the structural unit.
- <a id="WORK-41"></a> **WORK-41** Fallbacks: a one-act with no `##` sections → cards fall back to Scene Heading elements; a fully undivided script → one card, with beats (`=` lines) as sub-rows.

<a id="WORK-42"></a>

**WORK-42** **Round-trip note.** Sections round-trip losslessly as Fountain text (open→edit→save is byte-stable for the structure). Other Fountain tools treat `#`/`##` as *navigation-only* and won't print "ACT ONE" the way our renderer does — they preserve it, they just don't render it centered. We accept this: round-trip fidelity is about the *file* staying valid and lossless, not about other apps reproducing our house pixels. (If cross-tool *printing* of act/scene labels ever becomes a requirement, the alternative is forced scene headings.)

<a id="WORK-D105"></a>

### Materials

<a id="WORK-43"></a>

**WORK-43** Everything that isn't the script. Each is a file in a conventional folder, listed in the binder.

<a id="WORK-44"></a>

**WORK-44** Each material type has a distinct behavior:

| Kind | File | Why it is a type | Requirement |
|------|------|------------------| --- |
| `character` | `Characters/<Name>.md` | The Cast surface reads it, the script's cues bind to it, and the app maintains an Appearances section inside it. | <a id="WORK-45"></a>WORK-45 |
| `document` | anywhere, usually `Notes/` | **The default.** A blank `.md` file — no front matter, no heading, nothing. Not a type so much as the absence of one. | <a id="WORK-46"></a>WORK-46 |
| `outline` | `Notes/Outline.md` | The singleton scratchpad the Outline surface owns. App-created; never offered in a menu. Carries `type: outline` so a resync can re-find it. | <a id="WORK-47"></a>WORK-47 |
| `reference` | `*.pdf`, images, anything not Markdown | Passes through untouched and opens read-only/externally. | <a id="WORK-48"></a>WORK-48 |

<a id="WORK-49"></a>

**WORK-49** `note`, `research` and `logline` still parse **in a file's own front matter** —
plenty of files on disk say them — and resolve to `document` through
`normalizeType`. They are gone from `BinderItemType` entirely: no play file
says them, because no play file predates the 1.0 schema. `Research/` and
`Loglines/` in an older play are simply folders, which is what a writer always
took them for; a new play's binder offers `Characters` and `Notes` only.

<a id="WORK-50"></a>

**WORK-50** A typed material carries light metadata (id, type, tags, timestamps) in
front-matter; its substance is the prose body. A document carries none. None of
them is ever required for the script to open.

<a id="WORK-D106"></a>

#### Editing a material

<a id="WORK-51"></a>

**WORK-51** A material opens as a **page**, not as source: the body is edited in a prose editor where a heading looks like a heading and `## ` becomes one as you type it (src/markdown/ProseEditor.tsx), with a formatting bar over it (src/markdown/FormatBar.tsx). A **Source** toggle (⌘E) shows the raw file. Front-matter is never in either — it is lifted into the header strip, where the title is an editable field that renames the file.

<a id="WORK-52"></a>

**WORK-52** **The page is the script's page.** Page and Source both draw the play's own sheet: the format's page size and margins, at the status bar's zoom, at least one page tall and growing with the text. At the same zoom a note is exactly as wide as the script, and a new, empty note is a whole blank page rather than a card. In a pane narrower than a page it does what the script's page does — keeps its size while the pane scrolls — and Fit Width is the fix for both. The fits solve for whichever pane holds the page on screen: the script's, or with no pane showing the script, the note in the focused pane. The level stays one level for both, and Fit Page keeps the whole page in view under the note's header and format bar (in Page) as it does under the script's element bar.

<a id="WORK-53"></a>

**WORK-53** **The bar offers only what round-trips.** No underline and no strikethrough:
Markdown has no underline at all, and `~~strike~~` is not in the dialect doc.ts
writes, so either would apply, look applied, and vanish on the next save. Both
extensions are switched off in the editor so their keyboard shortcuts and input
rules cannot smuggle them back in.

<a id="WORK-54"></a>

**WORK-54** Markdown stays the thing on disk. src/markdown/doc.ts bridges the two directions and carries the rule the whole feature rests on:

> **Meaning round-trips; formatting normalizes.**

<a id="WORK-55"></a>

**WORK-55** A file that comes back from the editor may be spelled differently (`*em*` → `_em_`, `+ item` → `- item`, a hard-wrapped paragraph joined into one line). It must never *mean* differently: `toDoc(toMarkdown(toDoc(src)))` equals `toDoc(src)`, asserted over the sample vault in doc.test.ts.

<a id="WORK-56"></a>

**WORK-56** Because serializing normalizes, **a material is written only when the writer actually edits it**. Opening one, reading it, and closing it must leave the bytes alone — reformatting a file nobody touched is a change with no author, and every write is a file event in a watched tree (docs/app/keeping-work/storage-and-file-format.md#STOR-D9). The comparison is against **the body as last saved**, not against the body as parsed back from the store: `reconstruct` normalizes trailing whitespace, so a round trip through the store is a newline different from the buffer that produced it, and comparing to it answers "has anything changed?" YES forever.

<a id="WORK-57"></a>

**WORK-57** Once there IS an edit, every exit writes it: the idle debounce, blur, the Source
toggle, closing the tab, hiding the window, quitting. A tab close frees the
buffer *synchronously*, before React unmounts the editor, so the surface
registers a flush with the store (`registerMaterialFlush`) and the store calls it
first — otherwise the pending debounce fires into a store that has already
forgotten the file.

<a id="WORK-58"></a>

**WORK-58** **A binder operation re-points every open material.** `runBinderOp` awaits every open material's flush, then follows each buffer to its new path.

<a id="WORK-D107"></a>

#### One layout, declared once

<a id="WORK-59"></a>

**WORK-59** The homes above are **derived from `src/materials/schema.ts`, not restated**, by
`src/workspace/play-shape.ts` — the single declaration of a play's on-disk
shape. Every scaffolder consumes it:

```
<Play>/
  <Play>.proscenium     ← the one app file (binder, cards, settings)
  <Play>.fountain       ← the script
```

<a id="WORK-60"></a>

**WORK-60** **That is the whole of a new play: two files.** The binder still shows
`Characters` and `Notes`, so a writer can see where a character sheet is meant
to go before they have one — but neither directory exists until the first file
lands in it, because every write creates its parents. The app never scaffolds
an empty directory, never writes a `.gitkeep`, and never leaves a hidden
directory (storage I8).

<a id="WORK-61"></a>

**WORK-61** The binder folder and the directory still have to agree on a name, and that
pairing is still load-bearing: `newMaterial` writes into `Characters/`, the
reconciler finds the file there, and it has a folder whose `path` matches to
file it into. That is why `defaultDirFor` returns a capitalized name — since
1.0 the name in Finder and the name in the binder are the same string.

<a id="WORK-62"></a>

**WORK-62** There is one scaffolder, `scaffoldPlayAt`, parameterized by path prefix. No code reads the pre-1.0 layout. A directory without a `.proscenium` file is not a play (docs/app/keeping-work/storage-and-file-format.md#STOR-D14).

<a id="WORK-D108"></a>

### Opening, switching, and scope

- <a id="WORK-63"></a> **WORK-63** **Open** points the app at the **Plays folder** and lists the plays in it. The app writes nothing there.
- <a id="WORK-64"></a> **WORK-64** **Entering a play** reopens the vault at that play's own folder, so every path the rest of the app handles — binder entries, autosave, the watcher — is relative to the play and needs no prefix.
- <a id="WORK-65"></a> **WORK-65** **Where the plays live** is an app-level preference (outside the folder), stored as a security-scoped bookmark with the path as a hint, on every platform (docs/app/keeping-work/storage-and-file-format.md#STOR-D12). No play content is ever stored outside its folder.
- <a id="WORK-66"></a> **WORK-66** **Versions and Changes** live in the app's own data directory keyed by play id, never inside the Plays folder (docs/app/keeping-work/storage-and-file-format.md#STOR-D10). Deleting all of it loses no writing.

<a id="WORK-D109"></a>

### What the workspace model deliberately does not do

- <a id="WORK-67"></a> **WORK-67** No global cross-play database or library index inside the app, and no file at the Plays folder root listing what is in it. The folder is the index. Searching across many plays at once is what the writer's own file search is for — the folders are plain text, so anything that reads files can do it (docs/app/keeping-work/storage-and-file-format.md#STOR-D16).
- <a id="WORK-68"></a> **WORK-68** No canonical ordering outside the manifests and the script files. Position is never implied by mtime or filename sort; it is always explicit in an ordered array.

<a id="WORK-D110"></a>

### Cast and workspace controls

<a id="WORK-69"></a>

**WORK-69** The Cast surface separates an editable printed Characters page from cast
management. Cast rows have a writer-controlled order and no role ranking.
New character notes start blank; character prompts are optional. The
redundant Cast & Characters shortcut above binder files is removed. The
binder remains an unrestricted file tree. Tags are editable beside a
document name as well as through metadata controls.

<a id="WORK-70"></a>

**WORK-70** Board cards use a drag handle and keyboard-accessible move buttons; notes and
labels live under Details. Outline summaries and notes share a text-control
treatment. Scene status is a free-form label, with the offered choices edited
in Settings → Writing. Existing labels are preserved when that list changes.

## Design

`src/workspace/` joins the binder tree, script scene extraction and per-scene card metadata. File operations pass through the storage contract; views do not maintain a second ordering or canonical copy. The pane model presents Script, Board, Outline, Cast, Comments, Changes and documents over the same sessions.

Cast derives speakers from cues while storing authored descriptions in Fountain and character notes in Markdown. Printed Characters prose becomes independent when edited. `src/materials/schema.ts` declares typed material metadata and the new-play scaffold consumes that declaration. The session controllers preserve buffers and hash ancestry across pane changes, moves and closes.
