# Product scope

[App documentation](../README.md) › Product scope

The product contract defines who Proscenium serves, what belongs in the app, and the boundaries every feature must respect. Implementation structure is covered in [Architecture](../engineering/architecture.md).

[Purpose](#PRODUCT-D101) · [Principles](#PROD-D104) · [Scope limits](#PROD-D105)

## Requirements

<a id="PRODUCT-D100"></a>

<a id="PRODUCT-D101"></a>

### Product purpose

<a id="PROD-1"></a>

**PROD-1** A local-first playwriting environment where the writing surface feels
frictionless, the organization holds everything around the script, and the
folder of plain Fountain, Markdown and JSON files on disk
is as much the product as the app. No accounts, no cloud of its own, no AI —
your play is a file you own, in a folder you chose, that opens in any text
editor. Your plays and files stay on your Mac: the app checks for updates and,
unless the writer switches it off, sends anonymous usage and crash reports that
carry nothing of the writing (docs/app/keeping-work/privacy-and-telemetry.md). A folder placed
in iCloud Drive or Dropbox is synced by that service, not by the app.

<a id="PRODUCT-D103"></a>

### Register

<a id="PROD-2"></a>

**PROD-2** product — the design serves the writing. While drafting the app should feel
invisible: the page is the object of attention; chrome recedes.

<a id="PRODUCT-D104"></a>

### Brand / tone

<a id="PROD-3"></a>

**PROD-3** The drafting table: warm paper, ink, one oxide-red accent. A physical desk
with sheets of typescript on it, not a web app. Quiet, precise, craftsmanlike.
Typewriter monospace (Courier Prime) for script text; unobtrusive system UI
type for chrome. The corkboard palette (cream, oxide, ink, sea, moss, amber,
ash) is established vocabulary.

<a id="PRODUCT-D105"></a>

### Anti-references

- <a id="PROD-4"></a> **PROD-4** SaaS-clean dashboards, gradient heroes, glassmorphism, card grids.
- <a id="PROD-5"></a> **PROD-5** Cloud writing tools' "document in a webpage" feel; the page must feel like
  paper on a desk, not a div in a browser.
- <a id="PROD-6"></a> **PROD-6** The dated dialog-box chrome of desktop screenwriting software.
- <a id="PROD-7"></a> **PROD-7** Anything that reads as an AI product: sparkle glyphs, "suggestions",
  assistant panels, a composer waiting for a prompt.

<a id="PRODUCT-D106"></a>

### Strategic principles

1. <a id="PROD-8"></a> **PROD-8** The page is sacred: script geometry comes from the format spec, never from
   design whim. Design works on the desk around the page.
2. <a id="PROD-9"></a> **PROD-9** Chrome earns pixels: every toolbar element must justify itself against the
   blankness the writer needs to think.
3. <a id="PROD-10"></a> **PROD-10** Physicality over decoration: shadows and edges describe real stacking
   (sheet on desk, card strip above sheet), never ornament.
4. <a id="PROD-11"></a> **PROD-11** One accent: oxide carries selection/active; everything else is paper and ink.
5. <a id="PROD-12"></a> **PROD-12** The writing is the writer's. The app formats, organizes and remembers. It
   never composes, suggests, or rewrites.

<a id="PROD-D100"></a>

### Product scope

<a id="PROD-D101"></a>

### North star

<a id="PROD-13"></a>

**PROD-13** A focused, genuinely enjoyable environment for drafting stage plays, where the writer's work lives as plain, open, readable files in a folder they fully own and control.

- <a id="PROD-14"></a> **PROD-14** The **writing surface** feels frictionless — smart element entry, real-time stage formatting, hands on the home row.
- <a id="PROD-15"></a> **PROD-15** The **project organization** feels capable — workspaces, sub-projects, a corkboard of index cards, a binder of materials.

<a id="PROD-16"></a>

**PROD-16** The folder is the product as much as the app is. What the app writes to disk is a first-class part of the design, not an implementation detail — because that folder is what the writer still has in twenty years, whatever happens to this program.

<a id="PROD-D103"></a>

### What it must feel like

<a id="PROD-17"></a>

**PROD-17** **While drafting:** invisible. The writer types; the page formats itself in real time — centered ALL-CAPS character cues, full-width dialogue, indented italic stage directions, centered act and scene headings. Pressing Enter advances to the element they almost certainly want next. When the prediction is wrong, one keystroke fixes it. They never open a menu to say "this line is dialogue." The mechanics of format disappear and only the play is in front of them.

<a id="PROD-18"></a>

**PROD-18** **While organizing:** like handling physical cards and a ring binder. Scenes and beats are cards on a corkboard; drag one and the script reorders underneath. The binder on the left holds not just the script but the research, the character sheets, the loglines, the throwaway notes — all the materials of the piece, in one place you can open as a unit.

<a id="PROD-19"></a>

**PROD-19** **While owning it:** total confidence that the writing is *theirs*. Close the app and the play is still right there — readable Fountain in a folder they can zip, copy to a thumb drive, open in any text editor, or hand to a collaborator. Nothing important is trapped in a format only this app understands.

<a id="PROD-D104"></a>

### Non-negotiable principles

1. <a id="PROD-20"></a> **PROD-20** **Local-first, open-folder storage is the defining constraint.** The folder is the single source of truth. There is no hidden app database holding the real copy. The app reads, writes, and watches ordinary files on disk.

2. <a id="PROD-21"></a> **PROD-21** **Plain text, in a folder you own, that opens in TextEdit in twenty years.** Your script is Fountain — a play, written the way a play looks, in a file any text editor can read. Your notes are Markdown. The small amount of bookkeeping the app keeps for itself is JSON you can read. There is no database, no bundle, no container, no format that needs this program to make sense of it. If Proscenium disappears tomorrow, you lose an editor; you do not lose a word of your work, and you do not need anyone's permission or software to get it back.

3. <a id="PROD-22"></a> **PROD-22** **Your plays and files stay on your Mac.** Proscenium never sends your writing, a title, a character's name, or where your files are — not to its maker, not to anyone. It checks for updates, and unless you switch it off it sends a few anonymous facts — which version, which features get used, when it crashed — so it can get better. No accounts, no sign-in, and no cloud of its own: if the folder you choose is in iCloud Drive or Dropbox, that service syncs it, as it would any folder, and what you copy, export or share goes where you send it. ([privacy-and-telemetry.md](keeping-work/privacy-and-telemetry.md); privacy boundaries are specified in the privacy contract.)

4. <a id="PROD-23"></a> **PROD-23** **Sync is the writer's business, not the app's.** Put the folder in iCloud, Dropbox, Syncthing, or nothing at all. The app never talks to a sync service. But because sync *can* change files underneath the app, it carries a **mandatory safety floor**: never break, never lose data, always keep both versions, and say so plainly. When something changes a file while you were elsewhere, the app tells you what changed and offers you the way back.

5. <a id="PROD-24"></a> **PROD-24** **One codebase, everywhere.** macOS, iOS, and Android from a single Tauri v2 codebase.

6. <a id="PROD-25"></a> **PROD-25** **The writing feel is the product.** Real-time stage formatting and near-zero-friction element entry are requirements, not polish.

<a id="PROD-D105"></a>

### What this is not

- <a id="PROD-26"></a> **PROD-26** **Not an AI writing tool.** There is no assistant, no autocomplete that finishes your sentences, no "rewrite this scene," no model of any kind. The app formats what you type and keeps track of your files. The writing is yours.
- <a id="PROD-27"></a> **PROD-27** Not a screenwriting app. Stage-play format is the default house style. Screenplay support is out of scope (Fountain happens to serve both; the *formatting* and *element defaults* are stage-first).
- <a id="PROD-28"></a> **PROD-28** Not a collaboration platform. Single-writer-across-devices is the assumption. No real-time multi-user editing, no accounts.
- <a id="PROD-29"></a> **PROD-29** Not a sync engine, a cloud service, or a publishing pipeline. Export to print-ready PDF is a downstream concern, not part of the core loop.

<a id="PROD-D106"></a>

### The one-sentence test

<a id="PROD-30"></a>

**PROD-30** If a writer can close the app forever and still hold their entire body of work as clean, legible files they understand and control — while, with the app open, drafting feels effortless — the product has succeeded.

## Design

<a id="PRODUCT-D102"></a>

### Users

<a id="PROD-D102"></a>

A working playwright who wants their plays to be *files*. They draft on a Mac,
revise on an iPad, and read on an e-ink tablet. They keep their folder in iCloud,
Dropbox or on a thumb drive, and expect to open it without asking permission.
They want control over their work and a writing surface that stays out of the way.
