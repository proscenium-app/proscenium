# Storage and file format

[Keeping your work](README.md) › Storage and file format

This is the complete on-disk contract. It defines the folder and file schemas, save guarantees, conflict handling and recovery. Read the governing section before changing anything that writes a play.

[Folder layout](#STOR-D2) · [Play schema](#STOR-D5) · [Safe writes](#STOR-D9) · [Recovery and versions](#STOR-D10) · [Sync](#STOR-D11) · [Autosave](#STOR-D13)

## Requirements

<a id="STOR-D100"></a>

> The folder **is** the product. This is the contract for everything on disk:
> what a play looks like in Finder, what the one app file holds, how the app
> writes without losing anything, and how a play survives living in a synced
> folder. The app, and anyone reading a play without the app, code against it.


<a id="STOR-D0"></a>

### Principles (in priority order)

1. <a id="STOR-1"></a> **STOR-1** **The folder is the play.** There is no database, hidden or otherwise. The
   app reads, writes, and watches plain files. Delete the app and every play
   is intact and readable.
2. <a id="STOR-2"></a> **STOR-2** **Everything is plain text.** Fountain for scripts, Markdown for documents,
   JSON for the one app file. Openable in TextEdit in twenty years.
3. <a id="STOR-3"></a> **STOR-3** **The folder is for the writer.** One app file per play, named for the play,
   with the app's icon. Everything else in the folder is theirs. The app
   never scaffolds an empty directory, never leaves a hidden directory, never
   writes a file the writer did not ask for. Anything disposable lives in the
   app's own data directory, outside the folder.
4. <a id="STOR-4"></a> **STOR-4** **One home per datum.** The script owns everything Fountain can express.
   The play file owns only what Fountain cannot: card metadata, binder order,
   settings. The filename is the title. Nothing canonical is stored twice.
5. <a id="STOR-5"></a> **STOR-5** **Durability over convenience.** Atomic writes. No silent loss of an
   unsaved edit. Both sides of a collision are kept. Nothing is ever deleted
   by the app except to the OS trash.
6. <a id="STOR-6"></a> **STOR-6** **Sync is somebody else's folder sync.** The app talks to no service. The
   layout assumes nothing about what a provider does with dot-prefixed names,
   empty directories, or file contents it decides to evict, because every one
   of those assumptions has been wrong for some provider.
7. <a id="STOR-7"></a> **STOR-7** **Legible to a stranger.** A person with Finder, or a program with `cat`
   and docs/app/keeping-work/storage-and-file-format.md#STOR-D16, can reconstruct a whole play from the folder and the one app file.

<a id="STOR-D1"></a>

### Vocabulary

<a id="STOR-8"></a>

**STOR-8** Two columns, and the left one never reaches a writer. The right column is the
only vocabulary in the UI, the docs a writer sees, and error text.

| Internal (code, this doc) | Writer-facing | Requirement |
| --- | --- | --- |
| vault, vault root | **Plays folder** ("Where should your plays live?") | <a id="STOR-9"></a>STOR-9 |
| workspace, project | **Play** | <a id="STOR-10"></a>STOR-10 |
| script, `.fountain` | **Script** | <a id="STOR-11"></a>STOR-11 |
| binder | **Binder** | <a id="STOR-12"></a>STOR-12 |
| material (character, document, outline, reference) | **Document**, or the specific kind: **Character** | <a id="STOR-13"></a>STOR-13 |
| manifest, play file | never named; Finder shows it as kind **Proscenium Play** | <a id="STOR-14"></a>STOR-14 |
| history ring, snapshot | **Versions** (a version) | <a id="STOR-15"></a>STOR-15 |
| change ledger, external change | **Changes** (the play changed outside this window) | <a id="STOR-16"></a>STOR-16 |
| conflict, collision, conflict copy, sync artifact | **another version** of the script; never "conflict", never "sync" | <a id="STOR-17"></a>STOR-17 |
| sub-project, manuscript | gone | <a id="STOR-18"></a>STOR-18 |

<a id="STOR-19"></a>

**STOR-19** The old words are kept in identifiers so nothing has to be renamed in the
code. They are not kept anywhere a writer reads.

<a id="STOR-D2"></a>

### The Plays folder

<a id="STOR-20"></a>

**STOR-20** Any folder. Its children that are plays (docs/app/keeping-work/storage-and-file-format.md#STOR-D3) are shown; everything else in it
is ignored and never shown. The app writes **nothing** at the Plays folder
root: no index, no README, no marker, no cache. A freshly chosen Plays folder
is an empty folder, and it stays that way until the first play is created.

<a id="STOR-21"></a>

**STOR-21** **Discovery.** A directory is a play iff it directly contains a file with the
`.proscenium` extension (docs/app/keeping-work/storage-and-file-format.md#STOR-D5). That is the whole rule. No file at the root
lists the plays; the folder does.

<a id="STOR-22"></a>

**STOR-22** **Where it lives** is the writer's choice, made once (docs/app/keeping-work/storage-and-file-format.md#STOR-D12). Two placements are
rejected, in words a writer can act on:

- <a id="STOR-23"></a> **STOR-23** A Plays folder nested inside another Plays folder that holds plays, or a play
  inside a play. A folder inside a Plays folder with no plays is not nested in
  anything: that is the way down from a Plays folder chosen one level too high.
- <a id="STOR-24"></a> **STOR-24** A folder that two sync providers both manage (a Dropbox folder inside
  iCloud's Documents, a Syncthing share inside iCloud Drive). Eviction by one
  presents as deletion to the other. The app says so and asks for a different
  folder rather than opening it.

<a id="STOR-25"></a>

**STOR-25** One placement is **questioned, never refused**: a folder that holds no plays
while one or more of its own folders do. It is most likely the folder above the
Plays folder. Discovery, run one folder down, finds those folders. It lists a
couple of hundred folders at most, passes over a folder it cannot list, and
holds up neither the screen nor the next open while it looks. The Plays screen
then says so in one sentence, "Your plays look like
they are in “Plays” inside this folder.", with **Use “Plays”** (one button per
folder, most plays first, up to three) and **Keep This Folder**. An empty folder
is a legitimate new Plays folder, so keeping it is an ordinary answer.

<a id="STOR-D3"></a>

### A play folder

```
The Weight of Water/                     ← the play; folder name = play name
├── The Weight of Water.fountain         ← the script (Fountain, canonical)
├── The Weight of Water.proscenium       ← the one app file (JSON, §5)
├── Characters/
│   ├── Sophie.md                        ← character sheet (Markdown + front matter)
│   └── Clay.md
├── Notes/
│   ├── Outline.md                       ← the Outline surface's scratchpad
│   └── Retreat.md                       ← a document (blank Markdown)
├── Scenes/
│   └── Parked childhood bedroom.fountain← a second script, wherever it was filed
└── Research/
    └── tide-tables.pdf                  ← a reference: passes through untouched
```



- <a id="STOR-27"></a> **STOR-27** **The binder is the folder.** Every directory in the play is a binder
  folder. Every `.fountain` anywhere in the play is a script. Every `.md` is a
  document (a character when its front matter says so). Anything else is a
  reference that opens outside the app. There are no reserved folder names
  and nothing in the folder is ignored by name. What the writer sees in Finder
  and what they see in the binder are the same tree.
- <a id="STOR-28"></a> **STOR-28** **Order and nesting intent come from the play file**; existence and content
  come from disk (docs/app/keeping-work/storage-and-file-format.md#STOR-D8).
- <a id="STOR-29"></a> **STOR-29** **Folders exist when something is in them.** A new play is two files. The
  binder still shows Characters and Notes as folders so the writer sees where
  things go, and the directory is created when the first file lands. An empty
  directory on disk is still a binder folder; the app just never makes one.
- <a id="STOR-30"></a> **STOR-30** **Nothing hidden.** No `.proscenium/`, no `.gitkeep`, no cache, no history.
  The only dot-prefixed thing the app ever creates in a play is the momentary
  temp file of an atomic write or journalled move (docs/app/keeping-work/storage-and-file-format.md#STOR-D9), normally lasting
  milliseconds and retained if interrupted recovery needs it.
- <a id="STOR-31"></a> **STOR-31** **A second script goes wherever the writer files it**, default beside the
  main script at the root. There is no `script/` folder and no sub-project
  layer. "One play, two full drafts each with their own research" is roadmap
  and explicitly unsupported (docs/app/keeping-work/storage-and-file-format.md#STOR-D17); the answer today is two play folders.
- <a id="STOR-32"></a> **STOR-32** **Exports go through a save dialog** like any Mac app, defaulting to the
  last location used. A PDF saved into the play folder becomes a reference in
  the binder, which is honest.

<a id="STOR-D4"></a>

### Naming (normative)

<a id="STOR-33"></a>

**STOR-33** Document opens and imports are limited to **16 MiB of UTF-8**. Native reads
check the opened file's length and also bound the read itself, so growth after
the length check cannot bypass the limit. Dropped/chosen files are checked
before `File.text()`. Refusal leaves the original untouched and reports the
limit; an unreadable oversized manifest remains protected under docs/app/keeping-work/storage-and-file-format.md#STOR-D5.
Markdown scans delimiter runs once per nesting level, with at most 32 levels
and a 50,000-unit structure budget (including delimiter tokens and table
cells). Beyond that budget its entire source stays visible as literal text.
FDX accepts at most 128 nested tags and 100,000 tag/text events; incomplete or
over-budget XML is refused as a whole before a play is created. XML never
resolves external entities.

- <a id="STOR-34"></a> **STOR-34** **The filename is the title.** For a script, a document, a folder, and the
  play folder itself. Not a slug: the name as typed, spaces and capitals
  included. The only transform, `workspace/filename.ts`, removes what a
  filesystem cannot hold: `/ \ : * ? " < > |`, control characters, a leading
  dot, a trailing dot or space, and the Windows device names. Where the
  result differs from what was typed, the binder adopts the real filename.
  Slugs are gone from the layout entirely.
- <a id="STOR-35"></a> **STOR-35** **The play file is named for the play folder** (`<folder name>.proscenium`).
  Renaming the play in the app renames the folder and the file together. If
  they are found to differ (a rename in Finder), the app renames the file to
  match on open and records it under Changes. Discovery is by extension, so a
  mismatch never hides a play.
- <a id="STOR-36"></a> **STOR-36** **Encoding:** UTF-8, filenames NFC-normalized (macOS-NFD vs Linux-NFC is a
  silent sync mismatch otherwise). New names use NFC. Comparisons of directory
  entries, manifest paths, watcher events, uniqueness, Changes baselines and
  native write locks use the same NFC + lowercase + NFC key. The key is never
  used for I/O: reconciliation retains each identity and adopts the actual
  spelling returned by the directory listing. Exact spelling takes precedence
  when an external tool supplied case-colliding files; ambiguous aliases do not
  pick a file arbitrarily.
- <a id="STOR-37"></a> **STOR-37** **Case:** assume a case-insensitive, case-preserving filesystem. Never
  create two paths differing only by case. A case-only rename goes through a
  temporary name.
- <a id="STOR-38"></a> **STOR-38** **Identity is the ULID.** The play, every binder item, and every scene has a
  stable 26-character ULID `id`. Cross-references are by id, never by
  filename, which is what lets a rename keep its card data attached. A typed
  Markdown file's valid embedded ULID follows an external relocation only
  after a complete walk establishes that its old path is absent and only one
  file claims that ID. A copy cannot take the still-present original's ID.
- <a id="STOR-39"></a> **STOR-39** **Relative paths only**, forward-slash, relative to the play folder. No
  absolute path is ever stored (portability, docs/app/keeping-work/storage-and-file-format.md#STOR-D15).

<a id="STOR-D5"></a>

### The play file — `<Play>.proscenium`

<a id="STOR-40"></a>

**STOR-40** One JSON file per play holds the workspace manifest, binder and per-script card index. It is registered as a
document type (`org.habiby.proscenium.play`, conforming to `public.json`) so
Finder shows it with the app's icon and kind "Proscenium Play", and
double-clicking it opens the play. The `.fountain` type is registered too, so
a script opened from Finder opens its play: the app exports
`org.habiby.proscenium.fountain` (conforming to `public.plain-text`) for the
extension, because macOS otherwise gives a `.fountain` file a dynamic type no
app can claim. `.fdx` is claimed by extension only, as an Alternate viewer, so
whichever app owns `.fdx` keeps it (docs/app/keeping-work/storage-and-file-format.md#STOR-D12). Routing is docs/app/keeping-work/storage-and-file-format.md#STOR-D12's "Opening a file from
Finder".

```json
{
  "kind": "proscenium/play",
  "schemaVersion": 1,
  "id": "01KYFQCPT4C7J7D6VPZPJMSSJ5",
  "status": "drafting",
  "logline": "A daughter comes home to say why she left, and stays.",
  "created": "2026-07-26T17:26:01Z",
  "modified": "2026-09-05T20:11:03Z",
  "generator": { "app": "Proscenium", "version": "1.0.0" },
  "settings": {
    "format": "dg-modern",
    "sceneAnchors": "manifest",
    "autosave": { "debounceMs": 600, "maxWaitMs": 2000 }
  },
  "binder": [
    { "id": "01KYFQCPRAN26GEJ79GA4HQAVM", "type": "script", "path": "The Weight of Water.fountain" },
    {
      "id": "01KZWAQXMK01JPCPCHNMV49KZW",
      "type": "folder",
      "path": "Characters",
      "children": [
        { "id": "01KZ9X6P37ZBEC33GDEYDAV3DE", "type": "character", "path": "Characters/Sophie.md" }
      ]
    },
    {
      "id": "01KZWAQXMKNVQ76SJDH2VDNTPG",
      "type": "folder",
      "path": "Notes",
      "children": [
        { "id": "01M0B52KSK1QGWNNT7H2KCANQ0", "type": "outline", "path": "Notes/Outline.md" }
      ]
    }
  ],
  "scripts": {
    "01KYFQCPRAN26GEJ79GA4HQAVM": {
      "scenes": [
        {
          "id": "01J9ZS1AAAAAAAAAAAAAAAAAA1",
          "anchor": { "ordinal": 0, "headingHash": "6eafa9b29d1b9810", "embeddedId": null },
          "card": { "color": "oxide", "status": "draft", "label": "setup", "boardNote": "land the arrival harder" }
        }
      ],
      "orphans": [],
      "castHidden": ["VOICE"]
    }
  }
}
```

| Field | Meaning | Requirement |
| --- | --- | --- |
| `kind` | Always `"proscenium/play"`. | <a id="STOR-41"></a>STOR-41 |
| `schemaVersion` | Integer. Forward-only (docs/app/keeping-work/storage-and-file-format.md#STOR-D14). | <a id="STOR-42"></a>STOR-42 |
| `id` | The play's ULID. | <a id="STOR-43"></a>STOR-43 |
| `status` | Optional free-form workflow label shown on the Plays screen (`drafting`, `revising`…). Absent shows as nothing. | <a id="STOR-44"></a>STOR-44 |
| `logline` | Optional one line, shown on the Plays screen, editable there. | <a id="STOR-45"></a>STOR-45 |
| `created`, `modified` | ISO-8601 UTC. `modified` moves only when this file's canonical content changes, so a synced play file is quiet while the writer types. | <a id="STOR-46"></a>STOR-46 |
| `generator` | App and version that last wrote the file. Provenance only. | <a id="STOR-47"></a>STOR-47 |
| `settings.format` | A script-format **id** from `formats/` (`dg-modern` is the default written into new plays). Never format values. Unknown id resolves to the default with a notice. | <a id="STOR-48"></a>STOR-48 |
| `settings.language` | Optional BCP 47 writing and export language. Absent means `en-US`. Play Language and the export dialog save the canonical code through the guarded play-file writer. Script spelling selects American (`en-US`, or bare `en`) or British (`en-GB`) English; other languages have no bundled dictionary. Independent of `settings.format`. | <a id="STOR-49"></a>STOR-49 |
| `settings.sceneAnchors` | `manifest` (default) or `embedded`: how a card is bound to its scene (docs/app/keeping-work/storage-and-file-format.md#STOR-D6). | <a id="STOR-50"></a>STOR-50 |
| `settings.autosave` | Debounce and max-wait in ms (docs/app/keeping-work/storage-and-file-format.md#STOR-D13). | <a id="STOR-51"></a>STOR-51 |
| `binder[]` | The ordered tree. Folders carry `children[]`; leaves carry `path`. `type` ∈ `script · folder · character · document · outline · reference`. **No `title` field**: the title is the filename. **No `index` field**: card data is in `scripts`. | <a id="STOR-52"></a>STOR-52 |
| `scripts{}` | Keyed by the script's binder id. Each holds `scenes[]` (in script order), `orphans[]`, and optional `castHidden[]`. Only what Fountain cannot express. | <a id="STOR-53"></a>STOR-53 |

<a id="STOR-54"></a>

**STOR-54** **There is no title in the file.** The play's name is the folder's name; the
script's is its filename. The `Title:` key on the Fountain title page is the
*printed* title and may differ (a subtitle, capitals), which is a real
distinction, not a duplicate.

<a id="STOR-55"></a>

**STOR-55** **What is deliberately not here.** No `_act`, `_heading`, `_synopsis`,
`sourceHash`, or per-script `modified`. All of those are derivable from the
script and belong in the app's cache (docs/app/keeping-work/storage-and-file-format.md#STOR-D10). The play file changes only when
the writer changes something the file owns: a card, an order, a setting, a
scene coming into or leaving existence. Under folder sync, a file that rewrites
on every keystroke is a file that conflicts.

<a id="STOR-56"></a>

**STOR-56** **Serialization (normative).** UTF-8, keys in the order shown above, 2-space
indent, LF, single trailing newline. Deterministic bytes for deterministic
sync. Readers validate the known fields and nested shapes and **preserve
unknown keys on rewrite**. Anything another program adds survives the app.

<a id="STOR-57"></a>

**STOR-57** Reads distinguish a valid play, a newer unsupported schema, malformed bytes,
an absent file, and an unreadable file. Neither malformed nor unreadable data
can become a write baseline. Discovery still shows a play with damaged
metadata. Its raw original opens in a read-only, focusable sheet with Show in
Finder and Try Again; no repair is guessed and no bytes are replaced. A newer
schema remains protected on every commit, including a rebase read.

<a id="STOR-58"></a>

**STOR-58** **Several play files in one folder** (a sync duplicate such as `Reason for
Leaving 2.proscenium`): the one named for the folder is the play; the others
are listed under Changes as other versions of the play file, never silently
merged or removed.

<a id="STOR-D6"></a>

### Scripts

<a id="STOR-59"></a>

**STOR-59** **Fountain, one file per script**, scenes inside. The script is canonical for
everything Fountain can express: text, scene order, `#`/`##` act and scene
sections, `=` synopses, `[[ ]]` notes, the title page. Reordering a card on
the corkboard moves the scene block inside the `.fountain`.

<a id="STOR-60"></a>

**STOR-60** House mapping: Act ⇄ `#` section, Scene ⇄ `##` section; a forced scene
heading (`.A kitchen. Night.`) is an optional setting line inside a scene.
Sections round-trip losslessly as Fountain; other tools keep them and simply
do not print them centered.

<a id="STOR-61"></a>

**STOR-61** **Card metadata** (`scripts[id].scenes[].card`): `color` (a palette token),
`status` (a writer-defined label, up to 40 characters, empty for no status), `label` (one chip),
`boardNote` (free text). These four are canonical in the play file because
Fountain has nowhere to put them. `castHidden[]` is the other: ALL-CAPS cue
names the writer has deliberately removed from the cast tools list. The printed page initially follows that list, but a custom Characters page is independent. The Cast
surface adds every speaker automatically, so without this record a removal
would come back on the next save.

<a id="STOR-62"></a>

**STOR-62** **Scene identity.** Each scene record carries an `anchor` so its card survives
edits, external edits, and reorders:

- <a id="STOR-63"></a> **STOR-63** `embeddedId`: present only when `settings.sceneAnchors == "embedded"`; the
  app writes `[[id:<ULID>]]` after the heading. Strongest, visible in the
  source, off by default.
- <a id="STOR-64"></a> **STOR-64** `headingHash`: hash of the normalized, act-qualified heading path
  (`ACT TWO ▸ SCENE 1`). Survives reorders; breaks on a retitle.
- <a id="STOR-65"></a> **STOR-65** `ordinal`: index at last write. Positional fallback.

<a id="STOR-66"></a>

**STOR-66** **Reconciliation on open and on every external change:** parse the script;
bind each scene to a record by embedded id, then heading hash (nearest ordinal
breaks ties), then ordinal; new scenes get a fresh ULID and default card;
records with no scene move to `orphans[]` and are **retained, never deleted**
(I7). The writer can reattach or discard an orphan. Then rewrite `scripts[id]`
only if something canonical changed.

<a id="STOR-D101"></a>

#### Freely written opening pages

<a id="STOR-67"></a>

**STOR-67** The Fountain title page may carry `Title Page Text`, `Characters Page Text`,
`Opening Notes`, and `Opening Notes First`. The three text values are JSON
strings containing the prose editor's Markdown; JSON escaping preserves blank
lines, literal quotes and line breaks without terminating the Fountain title
page. The ordering value is `true` or `false`. Missing text fields retain the
legacy generated page; a present empty string explicitly omits that page.
`Characters:` remains the cast tools' ordered names and descriptions.
`Setting:`, `Time:` and `Place:` remain readable and are converted to prose
only when Opening Pages is saved. Unknown and malformed extension values stay
in the unknown-key bag. Other Fountain applications may not render these
application-specific opening-page fields.

<a id="STOR-68"></a>

**STOR-68** Prose alignment uses an inert `<!-- proscenium:align=center -->` or
`<!-- proscenium:align=right -->` comment before a paragraph or heading.
The page editor and PDF share the same interpretation. An unmatched comment
remains literal. Existing managed appearance markers stay in the file but are
hidden in the prose editor; new character notes start blank.

<a id="STOR-D7"></a>

### Documents

<a id="STOR-69"></a>

**STOR-69** Everything in the play that is not a script.

| Kind | File | Why it is a kind | Requirement |
| --- | --- | --- | --- |
| **document** | any `.md`, usually in `Notes/` | The default. A blank file: no front matter, no heading. The writer's first keystroke is the first byte. | <a id="STOR-70"></a>STOR-70 |
| **character** | `Characters/<Name>.md` | Front matter `type: character`; the Cast surface reads it, the script's cues bind to it, and the app maintains a fenced Appearances section inside it. | <a id="STOR-71"></a>STOR-71 |
| **outline** | `Notes/Outline.md` | The Outline surface's scratchpad; at most one per play, created on the first keystroke, `type: outline` in front matter. | <a id="STOR-72"></a>STOR-72 |
| **reference** | anything not `.md` or `.fountain` | Listed, opened outside the app, never rewritten. | <a id="STOR-73"></a>STOR-73 |

<a id="STOR-74"></a>

**STOR-74** Typed documents carry `id`, `type`, `created` in YAML front matter plus the
fields their schema declares (`src/materials/schema.ts` is the one source for
the template, the editor, and this table). The front-matter `id` is how a file
moved in Finder keeps its binder identity. Documents carry no front matter at
all.

<a id="STOR-75"></a>

**STOR-75** A document is written only when the writer edits it. Opening and closing one
leaves its bytes alone: serializing normalizes Markdown, and a reformat nobody
asked for is a file event in a watched, synced tree.

<a id="STOR-D8"></a>

### Reconciliation: disk vs the play file

<a id="STOR-76"></a>

**STOR-76** Disk is truth for **existence and content**. The play file is truth for
**order, nesting intent, and card metadata**. On every open and on every
change the watcher reports:

- <a id="STOR-77"></a> **STOR-77** **A file on disk with no binder entry** is filed automatically: appended to
  the end of the folder it sits in, with a fresh id (or the id from its front
  matter, if it has one). No "unfiled" state for the writer to learn.
- <a id="STOR-78"></a> **STOR-78** **A folder entry whose directory does not exist** is an empty folder, not a
  missing one. The directory is created when its first file is written.
- <a id="STOR-79"></a> **STOR-79** **A script entry whose file is gone** stays in the binder, shown as not in
  the folder any more, with *Remove* and *Restore from Versions*. It carries
  card metadata and a version ring, and a script vanishing is exactly when the
  app should say something.
- <a id="STOR-80"></a> **STOR-80** **A document or reference entry whose file is gone** is removed from the
  binder and the removal is listed under Changes, so the writer can see it
  happened.
- <a id="STOR-81"></a> **STOR-81** An iCloud stub (`.<name>.icloud`) or a File Provider dataless file is the
  file, not an absence (docs/app/keeping-work/storage-and-file-format.md#STOR-D11).

<a id="STOR-82"></a>

**STOR-82** The app never deletes a file to fix a mismatch, and never deletes a script
entry on its own.

<a id="STOR-D9"></a>

### Writing safely

<a id="STOR-D102"></a>

#### Atomic writes (I3)

<a id="STOR-83"></a>

**STOR-83** Every write is temp + `fsync` + atomic installation. The temp file is a **hidden
sibling in the target's own directory**, `.<name>.<random>.tmp`, so it is on
the same volume as its target. A new file uses an exclusive rename; an existing
file uses an atomic exchange that retains the displaced inode until its bytes
have been checked. Cooperating app processes hold a per-file OS lock. The
parent directory is synced before success is reported.

<a id="STOR-84"></a>

**STOR-84** A durable intent in app data precedes installation. If the displaced bytes
differ from the accepted baseline, an immutable, hash-checked copy is kept in
app data before rollback is attempted. An interrupted exchange is recovered
before the play opens. A failed preservation or rollback keeps the intent and
remaining files, blocks ordinary writes, and asks the writer to reopen. Such a
failure can leave the hidden sibling until recovery completes; it is never
discarded merely because it is old. The watcher and reconciler ignore the
temporary-file pattern. **Copies kept during a save** in Changes lets the
writer read and copy preserved bytes without changing a canonical file.

<a id="STOR-85"></a>

**STOR-85** On Android's Storage Access Framework, where same-directory rename is not
guaranteed, the backend writes a temp document, verifies length and hash, then
replaces via `DocumentsContract`; the contract is identical.

<a id="STOR-D103"></a>

#### Self-write suppression

<a id="STOR-86"></a>

**STOR-86** The vault records a `(path, hash, generation, time)` token before installation
makes bytes visible. A committed generation retires older tokens; failed
writes revoke theirs. Reading, hashing and classifying a watcher observation
share the token lock, so an old own-write token cannot hide a later external
rollback. The watcher retries failures, rescans after errors and directory
changes, and periodically checks the complete tree. An uncertain scan keeps
the previous map. The status bar exposes recovery as **Checking file changes…**;
returning to the app also revalidates open files on desktop.

<a id="STOR-D104"></a>

#### External change (the safety-critical path)

```
on change(file, newHash):
  if newHash == lastWrittenHash[file]: return           # our own write
  if file not open: invalidate cache; return
  if buffer clean: snapshot ours as version "pre-reload"; reload      # I1 holds
  else: banner "changed outside this window" [Keep this · Use the other · See both]
        buffer untouched, autosave for this file paused until chosen  # I1, I6
```

<a id="STOR-87"></a>

**STOR-87** The banner is ambient, never modal (I6). *See both* is a diff. Every choice is
preceded by a **pinned** version of the side being replaced, so it is
reversible from Versions.

<a id="STOR-D105"></a>

#### Collision on write (I2)

```
write(file, bytes):
  if on-disk hash != expected:
      if file is the play file: return STALE(current)    # caller rebases once, retries
      else: pin version(bytes, reason "collision"); return COLLISION   # banner as above
  install_with_exchange_and_displaced_content_check(file, bytes)
  expected = hash(bytes)                               # only after durable success
```

<a id="STOR-88"></a>

**STOR-88** **The app never writes a conflict file into the play folder.** Both versions
are still kept: theirs stays on disk, ours becomes a pinned version. The play file is the one file with several
legitimate writers (the reconciler, card edits, sync), so it rebases rather
than collides: re-read, rebuild the change on the new base, retry once; a
second mismatch is reported, never looped.

<a id="STOR-89"></a>

**STOR-89** An expected nonempty hash against a missing file is a collision, never
permission to recreate it. A stub or dataless file is unavailable, never an
empty baseline. Each operation also checks the opened root's device and inode;
a different folder later occupying the same path does not inherit authority.

<a id="STOR-D106"></a>

#### Moving files and their metadata

<a id="STOR-90"></a>

**STOR-90** A binder move or rename holds an OS lock for the play root and writes a durable
intent in app data before moving bytes. It records the item ID, old and new
paths, source identity and the metadata operation to replay. Destinations are
exclusive. Case-only renames journal the intermediate hidden name too. The
metadata operation is rebased by item ID against the latest valid play file;
unrelated edits and newly discovered descendants are retained. Trash undo
reinserts only its removed subtree and records into the current tree.

<a id="STOR-91"></a>

**STOR-91** Opening the play completes pending moves before reconciliation. While an
intent is unresolved, only its declared metadata file may be written. The
intent is removed only after metadata and directories are synced. A rollback
refuses an occupied original path and does not clear the intent until metadata
has been checked again. If completion is uncertain, editing remains blocked
with an explanation rather than writing to a guessed path.

<a id="STOR-D107"></a>

#### Several writers inside the app

<a id="STOR-92"></a>

**STOR-92** A file can have more than one writer in the app itself: the script has
autosave, board moves, restores and Keep this; a sheet has every pane showing
it, the inspector's fields and the appearances sync; the outline note has its
scratchpad. The same floor holds between them as against the outside world:

- <a id="STOR-93"></a> **STOR-93** **One at a time.** Each file's writes go through one line, and each expects
  the hash the write before it left.
- <a id="STOR-94"></a> **STOR-94** **Written on a version.** A buffer says which version of the file its words
  were written on — a sheet's, and the outline note's. A save whose version has
  since been replaced meets the banner rather than writing over words the
  writer never saw. A save the disk refused never became a version: words
  written on it count as written on what it was built on. An app-side
  write (the appearances sync) never replaces a buffer that holds unsaved
  words, and skips a sheet while it does.
- <a id="STOR-95"></a> **STOR-95** **Nothing unsaved goes with its buffer.** An editor that goes away — its
  tab switched, its pane split — hands what it holds, unsaved or still on its
  way, to the next editor of that file, each set of words to one editor.
  Leaving a play, closing a sheet's last tab, and trashing an open sheet or
  script land what they can and keep the rest as pinned `collision` versions.
  A script switch that cannot keep its words does not happen, and neither does
  a quit, unless the writer says to (docs/app/keeping-work/storage-and-file-format.md#STOR-D13).
- <a id="STOR-96"></a> **STOR-96** **Belongs to where it was asked.** A write, a card commit or a binder op
  that finishes after the writer has moved to another script or play acts on
  the one it was made for, or not at all. Opening a play, choosing a Plays
  folder and every binder op share one line, so leaving a play waits for a
  rename in progress instead of running it against the Plays folder.

<a id="STOR-D108"></a>

#### When the disk refuses a write

<a id="STOR-97"></a>

**STOR-97** A write can be refused outright: the file or its folder is locked in Finder,
the disk is full or read-only, the folder has gone, the writer may not change
it, or the drive stopped answering. Nothing is written (I3), and the buffer keeps
the words (I1); every authored buffer's recovery copy (docs/app/keeping-work/storage-and-file-format.md#STOR-D10) holds them within seconds.


- <a id="STOR-98"></a> **STOR-98** **One plain sentence for each cause**, in docs/app/keeping-work/storage-and-file-format.md#STOR-D1's vocabulary, never the OS's
  words: what happened ("“Hamlet” is locked in Finder.", "The disk is
  full."), that the words are still here — and that a copy is
  kept, except on a full disk, which is usually app data's disk too — and what
  would let the save go through. `src/storage/save-failure.ts` holds the
  mapping. The OS's words stay out of sight; diagnostics keep a code for each
  cause (`E-SAVE-LOCKED`, `E-SAVE-DISK-FULL`, …; docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D5).
- <a id="STOR-99"></a> **STOR-99** **Said once.** Autosave tries again at every pause in the typing, and when
  the window comes back into focus, since the writer was most likely in Finder
  doing what the sentence asked. A retry refused for the same reason says
  nothing new; the status line says "Not saved" until a save lands, and the
  save that lands is said too. A different reason is said again.
- <a id="STOR-100"></a> **STOR-100** **A change the writer asked for** (a card moved, a version restored, Keep
  this) that a refused write stopped says the same cause, and that nothing
  changed.
- <a id="STOR-101"></a> **STOR-101** **Words leaving the window.** Closing a refused sheet, or leaving the play,
  keeps its words as a pinned version and says so, with the cause. Its recovery
  copy also protects words while the window remains open.
  Quitting keeps them the same way, and says so when the play next opens (docs/app/keeping-work/storage-and-file-format.md#STOR-D13).
- <a id="STOR-102"></a> **STOR-102** **What only the vault can see.** macOS reports a Finder lock as EPERM, which
  is also what a privacy or sandbox refusal looks like, and a play on a
  disconnected drive as EACCES. The vault checks the lock flag and whether its
  own folder still exists, and names what it saw in front of the OS's words:
  `locked:`, `folder-locked:`, `folder-gone:`.
- <a id="STOR-103"></a> **STOR-103** **A write never makes the folder it belongs in.** A write into a play whose
  folder has gone, moved in Finder or on a drive that was disconnected, is
  refused.

<a id="STOR-D109"></a>

#### Invariants

- <a id="STOR-104"></a> **STOR-104** **I1** No silent loss of an unsaved edit.
- <a id="STOR-105"></a> **STOR-105** **I2** Both sides of a collision are kept: one on disk, one as a pinned
  version.
- <a id="STOR-106"></a> **STOR-106** **I3** Atomic writes only.
- <a id="STOR-107"></a> **STOR-107** **I4** Never break on bad input: an unparseable script or a malformed play
  file opens as raw text with a notice; the play still opens.
- <a id="STOR-108"></a> **STOR-108** **I5** No canonical datum in two places.
- <a id="STOR-109"></a> **STOR-109** **I6** Quiet, non-blocking surfacing.
- <a id="STOR-110"></a> **STOR-110** **I7** Orphaned card records are retained.
- <a id="STOR-111"></a> **STOR-111** **I8** The app writes nothing into a play folder that the writer did
  not create, except the play file and the momentary temp file.

<a id="STOR-D10"></a>

### App data: Versions, Changes, recovery, cache

<a id="STOR-176"></a>

**STOR-176** Tutorial practice is retained writing under app data, outside the Plays folder, in one practice play per course ([TUT-10](../preferences-and-help/tutorials.md#TUT-10)). Native code derives its root; callers supply only a validated session ID. The first lesson of a course, and every Start Over, reserve an exclusive directory at `tutorials/sessions/<sessionId>/Practice Play/` with a new play identity; every other lesson, Continue, a demonstration, a skip and a fix continue the course's play, which progress names ([STOR-170](#STOR-170)). The guide's own edits go only to that practice play, add or convert, and never remove the writer's words. Symlinks and path escapes are refused. Ordinary editor, manifest, note, recovery and Versions writers operate within that grant. Start Over and Reset preserve every earlier practice play. Deleting app data deletes practice; it is not a backup. It replaces [STOR-169](../../engineering/withdrawn-requirements.md#STOR-169), which gave every attempt its own play.

<a id="STOR-170"></a>

**STOR-170** Progress is separate from writing: `tutorials/progress.json`, version 1, with invitation disposition, lesson/step IDs, outcomes and retained-attempt identities, never script text or keystrokes. Writes hold the OS lock `progress.lock`, compare the accepted content hash, then write atomically. Unknown or corrupt progress disables ordinary progress writes and suppresses unsolicited invitations. Explicit Reset Progress preserves the previous bytes in `progress-preserved-<hash>.json`, clears lesson checkmarks, keeps every practice attempt and leaves the invitation dismissed. A progress failure never claims writing was saved.

<a id="STOR-171"></a>

**STOR-171** Keep as a Play settles every practice buffer before copying. It reserves a unique directory exclusively in the selected Plays folder, copies all files with create-only guarded writes, preserves binary references, verifies their bytes and writes the renamed `.proscenium` discovery signal last with a fresh play ID. It leaves the original practice intact on success or failure and retains incomplete copies after a failure. Opening the verified copy is a separate explicit choice.

<a id="STOR-172"></a>

**STOR-172** Tutorial transitions use the normal workspace settlement queue and preserve the selected Plays folder, bookmark, last real play and real-work layout. Progress never forces a paused guide open at launch. The catalogue discovers saved sessions independently of progress. An inactive attempt may move to recoverable Trash; an open attempt must be stopped first.

<a id="STOR-173"></a>

**STOR-173** Existing practice under `tutorials/practice/` remains readable and discoverable without moving or rewriting its files. Existing version-1 progress, including lesson outcomes and folder identities, remains resumable. Legacy copy sources are resolved only below that native app-owned practice root; no caller supplies an arbitrary source root.

<a id="STOR-113"></a>

**STOR-113** Everything disposable or local lives under the app's own data directory,
keyed by play id, never inside the Plays folder:

```
<app data>/
├── settings.json                      ← Plays folder bookmark + hint, accent, dictionary…
├── transactions/<root-device-inode>/  ← durable save/move intents, OS locks, saved copies
├── tutorials/                         ← retained practice, not disposable cache
│   ├── progress.json                  ← versioned invitation, steps, outcomes and attempts
│   ├── progress.lock                  ← stable native OS lock
│   ├── progress-preserved-<hash>.json  ← prior progress kept on reset
│   ├── sessions/<sessionId>/Practice Play/ ← one ordinary play per course
│   ├── practice/                      ← earlier practice, retained in place
│   └── trash/                         ← recoverable delete fallback
└── plays/<playId>/
    ├── versions/<scriptId>/<ts>-<reason>.fountain    ← the version ring
    ├── changes/                       ← baselines and before-texts for the Changes surface
    ├── recovery/<itemId>/<owner>.snapshot ← independently owned crash copies
    ├── recovery-owners/<itemId>/<owner>.lock ← OS ownership locks
    ├── kept-at-quit.json              ← what the last quit put in Versions, said at next open (§13)
    ├── cache/                         ← derived scene labels, counts, hashes
    └── trash/                         ← iOS/Android only: recoverable deletes
```

<a id="STOR-175"></a>

**STOR-175** On a sandboxed Mac app data resolves inside the app's container.
Deleting this directory keeps personal plays outside it, but deletes retained
tutorial practice, local history and any unsaved words whose only surviving
copy is recovery data. App data containing practice must not be treated as a
disposable cache.

<a id="STOR-115"></a>

**STOR-115** **Versions.** Snapshots of a script's state: first save of a session, then at
most one `save` per 5 minutes, plus always-on `pre-reload`, `pre-keep`,
`pre-restore`, and `collision`. Identical content dedups, except that a pinned
reason never dedups into an unpinned entry. Ring of 300 per
script, oldest pruned, **except pinned reasons** (`collision`, `pre-keep`,
`pre-reload` taken at a banner, `recovery`), which are never pruned. Unsaved
words that cannot reach the file when the writer leaves a script (behind a
banner, or refused by the disk) are kept as a `collision` version; if even that
fails, a switch to another script does not happen. Restore goes through
the same guarded write as any edit, after a `pre-restore` version, so restores
are reversible. Content comes from the session, not the disk, because before
an external reload only the session still holds "ours".

<a id="STOR-116"></a>

**STOR-116** **Recovery.** Every unsaved script, sheet and outline buffer is copied every
five seconds, including live, gated and parked variants and an outline whose
first file could not be created. A first save refusal also requests an immediate
copy. Copies use atomic writes and directory sync in app data. In the ordinary
case autosave gets there first; recovery protects words while a banner, refused
write or missing folder prevents that save.

<a id="STOR-117"></a>

**STOR-117** Each independently owned buffer writes `recovery/<itemId>/<owner>.snapshot`
under a stable OS ownership lock. One process cannot overwrite, read for
recovery, or remove a live owner's copy. Detaching releases ownership without
deleting words. On reopen the app claims abandoned owners independently; legacy
`recovery/<itemId>.snapshot` files are also read. Preserving a copy while typing
continues allocates a new owner for subsequent text. Replacement sheet/outline
copies must all succeed before obsolete copies can be retired.

<a id="STOR-118"></a>

**STOR-118** On opening a script, each abandoned copy matching the file can be removed;
every other copy is pinned as a `recovery` version before its original is
removed. A failed pin leaves the original intact. Eligible copies are offered
newest first ("Proscenium closed before these changes were saved": Review or
Discard). Applying one requires the writer's choice and the guarded restore
path. The decision is a pure function of snapshot time, file time and content
(`src/storage/recovery-policy.ts`). Abandoned sheet and outline copies remain
readable and selectable under **Recovered document copies** in Changes,
including a first outline without a binder entry; reading one never writes to
the play. These originals are retained.

<a id="STOR-119"></a>

**STOR-119** **Changes.** What changed in the play outside this window since the writer
last saw it, with the previous text kept so each change can be put back. It is
the surface a writer meets when the iPad, iCloud, or Dropbox did something
while the app was closed. Its store (baseline per file, before-text per
entry, an append-only ledger) lives here, not in the play. Store instances and
queues are play-scoped. An entry is a difference from the baseline, the last
text this device showed the writer or wrote itself; every write the app lands
moves it, at the guarded write rather than at each caller. A watcher event,
the watcher's start-up scan and a return to the app are only reasons to look:
the same bytes record nothing, and a file with no baseline gets one instead of
an entry, so the next change to it has a diff and a way back. Revert verifies
the reviewed after-hash, pins the exact current content under the item's ID,
then writes against that hash; newer or unsaved words require a fresh choice.

<a id="STOR-120"></a>

**STOR-120** **Versions and Changes are local to one device by design.** Two devices each
keep their own timeline. Syncing them would interleave rings and resurrect
deleted snapshots. A sync provider controls whether any directory inside its tree is synced; the contract cannot depend on that choice.

<a id="STOR-121"></a>

**STOR-121** **Cache.** Derived, disposable, and recomputed when missing. `cache/pages.json`
holds the play's first script's page count for the Plays screen's Progress
in pages: the engine's count in the play's format, with the script's path,
its modified time and a fingerprint of the format it was counted in. A count
whose key no longer matches is counted again; it is never written into the play
file.

<a id="STOR-122"></a>

**STOR-122** **Keyed by play id**, so a play copied whole to a second Plays folder on the
same Mac shares one timeline. Acceptable; noted.

<a id="STOR-D11"></a>

### Sync providers: recognize, never fight

<a id="STOR-123"></a>

**STOR-123** The app never syncs. It reads and writes a folder that something else syncs,
and it has to stay correct while that happens.

<a id="STOR-124"></a>

**STOR-124** **iCloud Drive evicts contents.** A file can become a hidden stub
`.<name>.icloud` with the bytes in the cloud. Inside the vault layer, and
nowhere above it: a stub is listed under the name it stands for (the real file
wins if both exist), and an unavailable read asks the platform to download and
reads again. When it still is not there, the error says the file is in iCloud
and has not finished downloading, deliberately not "missing". A macOS dataless
flag also marks a file unavailable until materialized; empty placeholder bytes
never become an accepted version. The same handling covers File Provider
online-only files from Dropbox, OneDrive, and Google Drive.

<a id="STOR-125"></a>

**STOR-125** **Provider conflict copies.** Where a provider's naming is documented and
stable, the file is recognized as *another version of X*, never listed as a
script, and surfaced under Changes with compare, keep this one, and move to
trash:

- <a id="STOR-126"></a> **STOR-126** Syncthing: `<name>.sync-conflict-YYYYMMDD-HHMMSS-<7 chars>.<ext>`, plus its
  `.stfolder`, `.stversions`, `.stignore`, `~syncthing~*.tmp` bookkeeping.
- <a id="STOR-127"></a> **STOR-127** Dropbox: `<name> (<who>'s conflicted copy <date>).<ext>` (English form; a
  localized form is an ordinary file).

<a id="STOR-128"></a>

**STOR-128** iCloud (`<name> 2`), OneDrive (`<name>-<Device>`), and Google Drive
(`<name> (1)`) produce copies indistinguishable from files a writer made. They
appear as ordinary scripts or documents in the binder, which is honest, and
the writer handles them as they would in Finder.

<a id="STOR-129"></a>

**STOR-129** **Never two providers on one tree** (docs/app/keeping-work/storage-and-file-format.md#STOR-D2).

<a id="STOR-130"></a>

**STOR-130** **Provider detection and the one sentence.** The Plays screen and Settings
say where the plays live, in one sentence: "Your plays live in iCloud Drive
and appear on your other devices." / "…in Dropbox…" / "…in a folder on this
Mac only. They will not appear on other devices." The last sentence is the one
that must exist; the rest is a should. Detection order on macOS: the platform
API for an iCloud item; the provider segment of `~/Library/CloudStorage/<Provider>-<account>/`
for File Provider clients; Dropbox's own `~/.dropbox/info.json` for its
classic client; a `.stfolder` marker at or above the folder for Syncthing;
otherwise local.

<a id="STOR-D12"></a>

### First run and where plays live

<a id="STOR-131"></a>

**STOR-131** **Default: the app's own iCloud Drive container**, shown in Finder as
iCloud Drive › Proscenium. It needs no folder picker, syncs to an iPad running
the app with no setup
there either, and is a real folder the writer can open, copy, or move things
out of. When iCloud Drive is unavailable (not signed in, or disabled), the
container is not offered.

<a id="STOR-132"></a>

**STOR-132** **One question**, on a welcome screen, answered with one click:

> **Where should your plays live?**
> ○ iCloud Drive *(recommended: your plays appear on your iPad too)*
> ○ A folder I choose…

<a id="STOR-133"></a>

**STOR-133** "A folder I choose…" opens the system folder panel with Documents
preselected and a New Folder button; the suggested name is *Plays*. It is
the door for Dropbox, OneDrive, Google Drive, Syncthing, and "just this Mac".
The choice is revisited in Settings, which shows the one sentence from docs/app/keeping-work/storage-and-file-format.md#STOR-D11 and
a *Change…* button. Changing does not move anything; it points the app at a
different folder.

<a id="STOR-134"></a>

**STOR-134** **What a writer sees before doing anything:** an empty Plays screen with New
Play, and the sentence saying where plays live. In Finder, an empty folder.

<a id="STOR-174"></a>

**STOR-174** Tutorials remain optional and reachable before a Plays folder is chosen. The compact, nonmodal first-use invitation appears only on the Plays screen after boot, authoritative settings, folder discovery, recovery questions and privacy notices are ready. It is remembered only after painting in the visible foreground window. Skip creates no practice, and choosing another task or leaving ends the invitation. Reset does not re-enable it.

<a id="STOR-135"></a>

**STOR-135** **The sample play waits.** An empty Plays screen offers "Open the Sample Play",
on the screen or in New Play's menu, only once it has looked one folder down and
found no plays there (docs/app/keeping-work/storage-and-file-format.md#STOR-D2), or once the writer has kept the folder. While it
looks, it offers no sample play; when the plays look to be in a folder inside,
it asks. A blank play or a draft stays available: a play the writer names is their answer.
Keeping the folder lasts while the app runs; the next launch asks again, until
a play is made there.

<a id="STOR-136"></a>

**STOR-136** **Sandbox consequences (App Store).** Entitlements: app sandbox,
user-selected read/write, app-scope bookmarks, and the iCloud container. A
sandboxed app reaches only its container and what the writer picks through
the panel, so:

<a id="STOR-137"></a>

**STOR-137** Rust also enforces folder authority in every build, so a compromised or buggy page cannot make any directory it names the Plays folder. Native
selection, a restored bookmark, an app-owned directory, or an actual OS open
mints a session-only opaque handle. `vault_open` and `set_last_vault` accept
that handle, never a bare path. The page retains paths as labels; Rust checks
descendants of a granted folder and refuses escapes and symlinks. A saved path
outside app-owned storage without a working bookmark requires selection again.

- <a id="STOR-138"></a> **STOR-138** The chosen folder is persisted as a **security-scoped bookmark** with the
  path as a hint, on every platform. This is the iOS design already in
  `settings.rs` (`lastVaultBookmark`), made universal. A bookmark can renew at
  resolve time; the renewal is persisted immediately.
- <a id="STOR-139"></a> **STOR-139** A failed bookmark renewal or settings write is reported as durable-access
  failure (`E-FOLDER-ACCESS`); a usable folder stays open. The app retains that
  failure until it can save access and offers **Try Again** and **Choose
  Folder…**. Retry can mint only for a folder already granted this session; an
  unresolved saved path requires the native panel. A stale grant is kept when
  renewal fails, but is never described as successfully refreshed.
- <a id="STOR-140"></a> **STOR-140** The container needs no bookmark.
- <a id="STOR-141"></a> **STOR-141** A folder inside the Plays folder that becomes the Plays folder (docs/app/keeping-work/storage-and-file-format.md#STOR-D2's answer
  to a folder chosen one level too high) receives a descendant handle, because the panel's
  grant for the folder around it reaches it. That grant lasts only while the app
  runs, so the folder takes a bookmark of its own when it is remembered. Where
  no bookmark can be made there (iOS makes them only in its picker), it keeps
  the grant of the folder around it, and the next launch opens it inside the
  folder that grant reopens. Where it cannot be listed, the panel opens on it,
  as for a play opened from Finder.
- <a id="STOR-142"></a> **STOR-142** The app's data directory (docs/app/keeping-work/storage-and-file-format.md#STOR-D10) resolves inside the container.
- <a id="STOR-143"></a> **STOR-143** Nothing can create a default folder under Documents without the panel,
  which is why the container is the zero-click default and not
  `~/Documents/Plays`.

<a id="STOR-144"></a>

**STOR-144** **Opening a file from Finder** (double-click, Open With, or the Dock icon;
`src/workspace/open-route.ts` classifies, `src/app/useFinderOpens.ts` routes):

- <a id="STOR-145"></a> **STOR-145** **A `.proscenium` file, or a `.fountain` inside a play**, opens that play,
  with that script in front. A play is the nearest folder above the file that
  holds a play file.
- <a id="STOR-146"></a> **STOR-146** **A play whose folder is not in the Plays folder** asks first: "This play is
  in a folder that isn't your Plays folder" — **Use Its Folder as the Plays
  Folder**, or **Cancel**. Nothing is moved. An OS open grants its containing
  play, not the parent Plays folder or sibling plays. Unless that parent
  already has a native grant, the folder panel opens on it, so the grant is
  one click, and the bookmark is taken there as for any chosen folder.
- <a id="STOR-147"></a> **STOR-147** **A `.fountain` outside any play** offers to make a play from it: a new play
  folder in the Plays folder, the script copied in, the original left where it
  was.
- <a id="STOR-148"></a> **STOR-148** **A loose document or script**, including FDX (`.fdx`), Word
  (`.docx`), OpenDocument, RTF and text, opens the review specified in
  `document-import.md`. Only **Create New Play** writes anything. The exact
  source bytes are kept in `Originals/` through a bounded binary create-only
  command using the same guarded atomic writer. Script and source are written
  before the `.proscenium` discovery signal; a source-copy failure cannot publish
  a partial play. A kept source already inside a play opens that play rather
  than converting again. Apps whose project files are not read directly use the
  editable export routes described by the import UI.
- <a id="STOR-149"></a> **STOR-149** A file that needs a Plays folder when none is chosen yet waits for the
  writer to choose one, then goes.

<a id="STOR-D13"></a>

### Autosave

<a id="STOR-150"></a>

**STOR-150** Any mutation marks the buffer dirty and arms a debounce (600 ms idle, 2000 ms
max wait, per play in `settings.autosave`). Blur, hide, tab close, and quit
flush immediately; ⌘S flushes as reassurance. Only the changed file is
written: dialogue rewrites the script, a recolor rewrites the play file, a
note rewrites the note. Between flushes a recovery snapshot lands in app data
every five seconds while there are words the disk does not have (docs/app/keeping-work/storage-and-file-format.md#STOR-D10), so a
crash costs seconds at most — including while a banner is holding autosave.

<a id="STOR-151"></a>

**STOR-151** **Quit waits for the words** (`src-tauri/src/quit.rs`, `src/app/quit.ts`).
Every way out of the app — ⌘Q, the Dock's Quit, an Apple Event, logging out,
the window's close button — asks the page first, and AppKit holds the quit
(`applicationShouldTerminate:`) until it answers. The page lands what it can, as leaving the play does, and
keeps the rest where the next launch finds it: a script's words in its
recovery snapshot, which the script offers back when it opens (or a pinned
version, when the snapshot cannot be written); a document's and the outline
notes' as pinned `collision` versions, named in `kept-at-quit.json`, which the
play says once its script has opened ("What was typed in “Mara” before
Proscenium quit is kept in Versions…", with the cause), and then removes.
Nothing is torn down, so a quit that does not happen leaves the play as it was.

- <a id="STOR-152"></a> **STOR-152** **Words that can be kept nowhere hold the quit** — refused by the disk, and
  by app data too, as a full disk refuses both. An alert says what quitting
  would lose and why, in save-failure.ts's words; Don't Quit is the default,
  for ⏎ and Escape alike, and Quit Anyway is the writer's to choose.
- <a id="STOR-153"></a> **STOR-153** **A settle that runs past ten seconds** (a drive that stopped answering)
  holds the quit the same way, saying Proscenium is still saving, and quits by
  itself once everything is saved or kept, unless the writer said Don't Quit.
- <a id="STOR-154"></a> **STOR-154** **A page that never acknowledges the question** gets two seconds with a
  clean unsaved-work beacon. With unsaved words, after ten seconds a native
  alert says "Proscenium couldn't confirm your latest words were saved."
  Don't Quit is the default; Quit Anyway is the writer's choice. The quit
  stays held until they answer. A page that heard and has not answered in
  thirty seconds is never cut short: the quit is called off instead.

<a id="STOR-D14"></a>

### Schema versioning

<a id="STOR-155"></a>

**STOR-155** `schemaVersion` is forward-only. A play file newer than the app understands
opens read-only with a notice and is never rewritten. A directory without a
`.proscenium` file is not a play, whatever else it contains; there is no
detection of, or migration from, any earlier layout in the app.

<a id="STOR-D15"></a>

### Portability and backup

<a id="STOR-156"></a>

**STOR-156** Because every reference is relative and by id, and nothing canonical lives
outside the folder: copy, zip, move, or sync a play and it opens identically
elsewhere; point another program at it and the script is valid Fountain, the
documents are Markdown, and the play file is JSON.

<a id="STOR-157"></a>

**STOR-157** The app does not back up. It guarantees atomic writes, both-sides-kept
collisions, autosave, and a local version ring. Durable backup is the
environment's: the sync provider's own version history, Time Machine, or a git
repository the writer initializes themselves (the folder is git-friendly:
plain text, deterministic serialization, no binaries). The app never runs
git.

<a id="STOR-D16"></a>

### Reading a play without the app

<a id="STOR-158"></a>

**STOR-158** For a person or a program with nothing but the folder:

1. <a id="STOR-159"></a> **STOR-159** A directory is a play iff it contains a `*.proscenium` file. Read it: it
   is JSON with the schema in docs/app/keeping-work/storage-and-file-format.md#STOR-D5.
2. <a id="STOR-160"></a> **STOR-160** `binder[]` is the ordered tree. Each leaf's `path` is relative to the play
   folder. Titles are filenames without extension.
3. <a id="STOR-161"></a> **STOR-161** A `.fountain` is a script. Structure is native Fountain: `#` acts, `##`
   scenes, `=` synopses, `[[ ]]` notes. Its card metadata is
   `scripts[<binder id>]`; scene records bind to scenes in file order by the
   anchors in docs/app/keeping-work/storage-and-file-format.md#STOR-D6.
4. <a id="STOR-162"></a> **STOR-162** A `.md` is a document. If it starts with YAML front matter carrying
   `type: character`, it is a character sheet with the sections in
   `src/materials/schema.ts`. Otherwise it is prose.
5. <a id="STOR-163"></a> **STOR-163** Anything not in the binder yet is still part of the play; the app will file
   it on next open. To add a document, write a file. To change a card, edit
   the play file and preserve every key you do not understand.
6. <a id="STOR-164"></a> **STOR-164** Never write a file whose name matches docs/app/keeping-work/storage-and-file-format.md#STOR-D9's temp pattern or docs/app/keeping-work/storage-and-file-format.md#STOR-D11's conflict
   patterns.



<a id="STOR-D17"></a>

### Unsupported scope

- <a id="STOR-166"></a> **STOR-166** Multiple full-length drafts inside one play, each with its own documents.
  Use two plays.
- <a id="STOR-167"></a> **STOR-167** Syncing Versions or Changes between devices.
- <a id="STOR-168"></a> **STOR-168** Any layout other than this one.

## Design

The native vault in `src-tauri/src/vault/` owns byte reads, guarded atomic writes, durable intents and root identity. The watcher classifies changes against the vault's generation tokens. TypeScript in `src/storage/` owns buffer ancestry, autosave, recovery choices and plain failure messages.

`src/workspace/play-file.ts` reads and serializes the play schema. Reconciliation joins the disk tree to binder identities and the parsed script to scene records. The app-data store holds Versions, Changes and recovery under the play id. Native folder authority is separate from a path displayed in the page.

The algorithms, schema, failure branches and limits above are normative. Storage tests exercise the native write boundary and the TypeScript session/reconciliation policies; browser and native smoke exercise the writer's recovery and conflict choices.
