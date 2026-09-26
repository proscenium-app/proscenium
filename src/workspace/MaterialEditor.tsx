// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Material editor (docs/app/organizing/workspace-model.md#WORK-D106) — the page for
 * Markdown materials: documents and character sheets. YAML front-matter, where
 * a material has any, is shown as a small structured header; the body is a
 * document you type on.
 *
 * The page IS the editor. A note is prose, and prose is edited the way every
 * other writing tool edits it — headings look like headings while you type
 * them, and there is a bar to apply them with. Markdown remains the thing on
 * disk; src/markdown/doc.ts is the bridge, and its contract (meaning
 * round-trips, formatting normalizes) is what makes that safe. Source is kept
 * as an escape hatch, because sometimes the file is what you want to see.
 *
 * ## One name
 *
 * The title in this header is the FILENAME (workspace/filename.ts). Editing it
 * renames the file and the binder row together, because they are one name.
 * There used to be a `title:` key in front-matter as well, which meant a
 * material could be called three different things at once.
 *
 * ## Saving
 *
 * The file is written only when the writer actually changes something —
 * serializing normalizes formatting, so an unprompted save would reformat a
 * file nobody touched, and every write is a file event in a watched tree. But
 * once there IS a change, it must reach disk, and there are more ways to leave
 * a page than clicking away from it. Every one of them flushes: the debounce,
 * blur, switching to Source, closing the tab, hiding the window, quitting the
 * app. The old version had only the first two, so a note typed and immediately
 * closed lost its last few seconds.
 *
 * ## The sheet
 *
 * A material is written on the play's own page: the format's size and margins,
 * at the status bar's zoom — the same numbers, from the same spec, that the
 * script's page is drawn with (format/css.ts), so a note and the script read as
 * two pages off one desk. The sheet used to be a 520px card 60% of the window
 * tall, whatever the format or the zoom said.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { formatCssVars, type FormatSpec } from "../format";
import { FormatBar } from "../markdown/FormatBar";
import { firstLineOffset, toFirstLine } from "../markdown/first-line";
import { ProseEditor } from "../markdown/ProseEditor";
import { Button, CloseIcon, IconButton, onScreen, usePageTarget } from "../ui";
import { parseTags, reconstruct, split } from "./front-matter";
import { normalizeType, schemaFor } from "../materials/schema";
import { titleOf } from "./binder";
import { AutosaveScheduler, DEFAULT_AUTOSAVE } from "../storage/autosave";
import type { BinderItem } from "./play-file";
import type { BufferLease, MaterialBuffer, ParkedWords } from "./material-buffer";

export type { BufferLease, MaterialBuffer, ParkedWords };

type Mode = "page" | "source";

const MODE_KEY = "proscenium.material.mode";

/** Idle time before an edit is written. Short enough that "did it save?" never
 *  becomes a question; long enough that a sentence is one write, not twelve. */
const DEBOUNCE_MS = 400;

function storedMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === "source" ? "source" : "page";
  } catch {
    return "page";
  }
}

export interface MaterialEditorProps {
  item: BinderItem;
  /** The file as the store last knew it on disk. */
  content: string;
  /**
   * Bumped when the store means this buffer to be replaced whatever it holds:
   * the sheet was read fresh, or the writer chose "Use the other". Any other
   * change of `content` is taken only by a buffer with nothing unsaved in it.
   */
  reset?: number;
  /**
   * Save the full file (front-matter + edited body). `base` is the version of
   * the file these words were written on top of: the store refuses a save
   * whose base has since been replaced — by another pane, the inspector, the
   * app's own appearances sync — and raises the gate instead of writing over
   * it. Resolves false when nothing was written.
   */
  onSave: (fullContent: string, base: string) => void | Promise<boolean | void>;
  /** Rename the file. The header title and the binder row are the same name. */
  onRename?: (id: string, title: string) => void;
  onEditTags?: (edit: (tags: string[]) => string[]) => void;
  /** Unsaved edits appeared or went away (the installer's unsaved-work beacon listens). */
  onDirty?: (dirty: boolean) => void;
  /**
   * Hand the store this buffer. Closing a tab, trashing the sheet and leaving
   * the play all have to reach words that exist only here. The lease hands
   * back words an editor of this sheet left a moment ago, and takes this one's
   * when it goes (material-buffer.ts).
   */
  onRegisterBuffer?: (buffer: MaterialBuffer) => BufferLease<ParkedWords>;
  /** An external change arrived while this buffer was dirty. Nothing is lost. */
  gate?: { theirs: string } | null;
  onResolveGate?: (choice: "mine" | "theirs") => void;
  /**
   * The play's resolved format. The sheet is the script's page — this spec's
   * page size and margins — read through the same `--fmt-*` properties the
   * script's surface sets (formatCssVars), never a number of its own.
   */
  format: FormatSpec;
  /**
   * Page zoom, exactly as PlayEditor takes it: a view transform on the sheet
   * alone, so at the same zoom a material and the script are the same width.
   */
  zoom?: number;
  language?: string;
  /**
   * What sits above the sheet changed, so the sheet moved down or up its pane:
   * the format bar came with Page (once the editor is ready) or went with
   * Source, or the conflict choice appeared or was answered. Fit Page counts
   * those rows (use-zoom.ts), and nothing outside this editor sees them change.
   */
  onSheetMoved?: () => void;
}


export function MaterialEditor({
  item,
  content,
  reset = 0,
  onSave,
  onRename,
  onEditTags,
  onDirty,
  onRegisterBuffer,
  gate,
  onResolveGate,
  format,
  zoom = 1,
  language = "en-US",
  onSheetMoved,
}: MaterialEditorProps) {
  const parsed = useMemo(() => split(content), [content]);
  // The page's geometry, set on the editor's root so the sheet (and nothing
  // outside this editor) can read it — as ExportPanel does for its sheets.
  const pageVars = useMemo(() => formatCssVars(format) as React.CSSProperties, [format]);
  // `zoom` (not transform), as on .play-page, so scroll extents track the size.
  const sheetZoom = zoom !== 1 ? { zoom } : undefined;
  const [body, setBody] = useState(parsed.body);
  const [mode, setMode] = useState<Mode>(storedMode);
  const [saveState, setSaveState] = useState<"clean" | "dirty" | "saved">("clean");
  const [name, setName] = useState(titleOf(item));
  const [editingTags, setEditingTags] = useState(false);
  const [tag, setTag] = useState("");
  // The script's own scheduler: idle debounce AND a ceiling on the wait, so a
  // long unbroken stream of typing lands every two seconds instead of only
  // when it pauses.
  const scheduler = useRef(
    new AutosaveScheduler({ debounceMs: DEBOUNCE_MS, maxWaitMs: DEFAULT_AUTOSAVE.maxWaitMs }, () => void flushRef.current()),
  );
  const box = useRef<HTMLTextAreaElement | null>(null);
  const latest = useRef(parsed.body);
  /**
   * The body as it last went to (or came from) disk.
   *
   * Comparing against `parsed.body` instead — which is what this did — never
   * settles: `reconstruct` normalizes trailing whitespace, so the text that
   * comes back through the store is a newline different from the buffer that
   * produced it. "Has anything changed?" therefore answered YES forever, and
   * every flush wrote the file again: on blur, on window hide, on tab switch,
   * on unmount. Writes that raced each other in a watched tree, for a file
   * nobody had touched since the last one.
   */
  const savedBody = useRef(parsed.body);
  /**
   * The version of the file these words are written on top of: what was read,
   * or what this editor last saved (taken the moment it saves, so the next
   * save is built on it even while that one is still out).
   */
  const base = useRef(content);
  /**
   * A save sent and not yet landed. Its words are still unsaved: the disk does
   * not have them until the store says so, and treating them as safe the moment
   * they were sent let an outside change replace them while they were out.
   */
  const sending = useRef<{ full: string; builtOn: string; done: Promise<void> } | null>(null);
  const seenReset = useRef(reset);
  const savedFlash = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The formatting bar needs the live editor. It is rendered HERE rather than
  // inside ProseEditor so it sits on the desk above the sheet — inside, it
  // would print on the paper, above the first line the writer types.
  const [editor, setEditor] = useState<Editor | null>(null);

  /* A page just made takes the cursor as soon as it can, not leaving it in the binder: a new
     document, a sheet made from the Cast, a character once it is named. The
     request comes from whoever made it (ui/page-focus.ts); this page answers
     once its editor exists — a task after the sheet mounts — or, in Source,
     with its text box. The caret goes where the first words belong: on a
     character sheet, under its first heading rather than inside it. */
  usePageTarget(
    item.id,
    mode === "page"
      ? editor && {
          hasFocus: () => editor.view.hasFocus(),
          ready: () => !editor.isDestroyed && onScreen(editor.view.dom),
          focus: () => {
            editor.view.dispatch(toFirstLine(editor.state));
            editor.view.focus();
            editor.commands.scrollIntoView();
          },
        }
      : {
          hasFocus: () => !!box.current && document.activeElement === box.current,
          ready: () => onScreen(box.current),
          focus: () => {
            const el = box.current;
            if (!el) return;
            const at = firstLineOffset(el.value);
            el.focus();
            el.setSelectionRange(at, at);
          },
        },
  );

  // Before paint, whenever the rows above the sheet change (and on arrival), so
  // a fit that counts them never draws the page off the bottom for a frame.
  const sheetMovedRef = useRef(onSheetMoved);
  sheetMovedRef.current = onSheetMoved;
  const formatBarUp = mode === "page" && editor !== null;
  const gateUp = !!gate;
  useLayoutEffect(() => {
    sheetMovedRef.current?.();
  }, [mode, formatBarUp, gateUp]);

  // The header and, on the page, the format bar stick over the top of the pane
  // that scrolls this sheet. The pane's scroll padding says how much of it they
  // cover, so what is scrolled into view there, the page the guide brings in
  // (docs/app/preferences-and-help/tutorials.md#TUT-D103) among it, comes to
  // rest below them rather than behind them. Measured, because both bars wrap
  // in a narrow pane.
  const root = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const pane = root.current?.closest<HTMLElement>(".pane__body");
    const bars = [...(root.current?.querySelectorAll<HTMLElement>(":scope > .material__head, :scope > .fmt") ?? [])];
    if (!pane || !bars.length) return;
    const measure = () => {
      const covered = Math.max(...bars.map((bar) => (parseFloat(getComputedStyle(bar).top) || 0) + bar.offsetHeight));
      pane.style.scrollPaddingTop = `${covered}px`;
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const bar of bars) observer.observe(bar);
    return () => {
      observer.disconnect();
      pane.style.removeProperty("scroll-padding-top");
    };
  }, [mode, formatBarUp]);

  // A new version of the file from the store. Taken when the store says so
  // (`reset`), or when there is nothing unsaved here to lose. A buffer with
  // words of its own keeps them — replacing it used to delete what the writer
  // was typing whenever the appearances sync or another pane wrote the sheet —
  // and its next save meets the gate instead of writing over the new version.
  useEffect(() => {
    const forced = reset !== seenReset.current;
    seenReset.current = reset;
    // The version that arrived holds exactly the words on this page: a save an
    // earlier editor of this sheet sent, landing after this one took its words
    // over. They are saved — left "unsaved", the sheet said Saving… for good.
    if (!forced && !sending.current && latest.current !== savedBody.current && parsed.body === latest.current) {
      savedBody.current = latest.current;
      base.current = content;
      setSaveState("clean");
      onDirty?.(false);
      return;
    }
    if (!forced && content === base.current) return;
    // Not skipped for being one of this editor's own earlier saves: with nothing
    // unsaved and nothing on its way, what arrives is the newest version — the
    // other pane's save of that same text included. Skipping it left this
    // pane on a version already replaced, and its next save met a false choice.
    if (!forced && (latest.current !== savedBody.current || sending.current)) {
      // Words of our own. A new version that changed only the front matter
      // (the inspector) is built on, not argued with: the page's words go on
      // top of it.
      if (parsed.body === split(base.current).body) base.current = content;
      return;
    }
    setBody(parsed.body);
    latest.current = parsed.body;
    savedBody.current = parsed.body;
    base.current = content;
    setSaveState("clean");
    onDirty?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, reset]);

  useEffect(() => setName(titleOf(item)), [item]);

  // The source sheet is as long as the file: the frame scrolls, not a box
  // inside the page.
  useEffect(() => {
    const el = box.current;
    if (!el || mode !== "source") return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [body, mode]);

  /**
   * Write now, if there is anything to write. Held in a ref so every exit path
   * — unmount, tab close, window hide — calls the SAME function with the
   * current buffer, rather than each closing over a stale one.
   */
  const flushRef = useRef<() => void | Promise<void>>(() => {});
  flushRef.current = () => {
    scheduler.current.cancel();
    // Only a real change reaches disk. Reformatting a file the writer merely
    // LOOKED at would be a change with no author. A save still out is what
    // "written" waits on.
    if (latest.current === savedBody.current) return sending.current?.done;
    const body = latest.current;
    const previous = savedBody.current;
    const builtOn = base.current;
    const full = reconstruct(split(builtOn).header, body);
    // Claim it BEFORE the await, so a second flush arriving mid-write (blur
    // and unmount fire together when a tab closes) does not write it twice —
    // and so the next save is built on this one.
    savedBody.current = body;
    base.current = full;
    setSaveState("saved");
    if (savedFlash.current) clearTimeout(savedFlash.current);
    savedFlash.current = setTimeout(() => setSaveState("clean"), 1600);
    const done = Promise.resolve(onSave(full, builtOn)).then((ok) => {
      if (sending.current?.full === full) sending.current = null;
      if (ok !== false) {
        onDirty?.(latest.current !== savedBody.current);
        return;
      }
      // Nothing was written (the gate is up, or the disk refused): these words
      // are unsaved again, and say so.
      if (savedBody.current === body) savedBody.current = previous;
      if (base.current === full) base.current = builtOn;
      if (savedFlash.current) clearTimeout(savedFlash.current);
      setSaveState("dirty");
      onDirty?.(true);
    });
    sending.current = { full, builtOn, done };
    return done;
  };
  const flush = () => void flushRef.current();

  // Register with the store, and withdraw on unmount so a closed tab cannot be
  // flushed into.
  const unsavedRef = useRef<() => ParkedWords | null>(() => null);
  unsavedRef.current = () => {
    if (latest.current !== savedBody.current) {
      return { full: reconstruct(split(base.current).header, latest.current), base: base.current };
    }
    // A save still on its way: the next editor builds on it.
    const out = sending.current;
    return out ? { full: out.full, base: out.full } : null;
  };
  const registerRef = useRef(onRegisterBuffer);
  registerRef.current = onRegisterBuffer;
  // Registered for as long as this editor is on screen. In layout effects, on
  // purpose: when a pane is split or a tab switched back, the editor going away
  // releases its words in the same commit, before the one arriving takes them —
  // read any later, the arriving editor started without them and they were
  // parked where nothing showed them.
  useLayoutEffect(() => {
    const lease = registerRef.current?.({
      flush: () => flushRef.current(),
      unsaved: () => unsavedRef.current()?.full ?? null,
      words: () => unsavedRef.current(),
      page: () => reconstruct(split(base.current).header, latest.current),
    });
    const parked = lease?.take() ?? null;
    if (parked) {
      const words = split(parked.full).body;
      setBody(words);
      latest.current = words;
      // Unsaved against what the store says the disk holds now — not against
      // what the editor that left them knew. That one had its own save still
      // out, and a second switch took the save for landed: the page went back
      // to the old text, and a refused save then lost the words.
      savedBody.current = parsed.body;
      base.current = parked.base;
      const dirty = words !== parsed.body;
      setSaveState(dirty ? "dirty" : "clean");
      onDirty?.(dirty);
    }
    return () => {
      scheduler.current.cancel();
      if (savedFlash.current) clearTimeout(savedFlash.current);
      // The last exit: what is pending is sent, and whatever has not landed —
      // behind the choice, or still on its way — is handed to the store.
      void flushRef.current();
      lease?.release(unsavedRef.current());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Leaving the app is leaving the page. `visibilitychange` covers ⌘Tab and
  // hiding the window; `pagehide` covers a quit that never fires anything else.
  useEffect(() => {
    const onHide = () => flushRef.current();
    const onVisible = () => {
      if (document.visibilityState === "hidden") flushRef.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pagehide", onHide);
    window.addEventListener("blur", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("blur", onHide);
    };
  }, []);

  const onChange = (next: string) => {
    setBody(next);
    latest.current = next;
    setSaveState("dirty");
    onDirty?.(true);
    scheduler.current.schedule();
  };

  const show = (next: Mode) => {
    flush();
    setMode(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      /* a preference that won't persist still works this session */
    }
  };

  function commitName() {
    const next = name.trim();
    if (!next || next === titleOf(item)) {
      setName(titleOf(item));
      return;
    }
    onRename?.(item.id, next);
  }

  /**
   * ⌘E toggles Page/Source, and it is caught on the way DOWN so TipTap never
   * sees it — the editor binds ⌘E to the inline-code mark, and without the
   * capture both would fire on one press.
   */
  const onKeyDownCapture = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "e") {
      e.preventDefault();
      e.stopPropagation();
      show(mode === "page" ? "source" : "page");
    }
  };

  const tags = parseTags(parsed.fields.tags);
  const kind = normalizeType(parsed.fields.type ?? item.type);
  // A document is the default and needs no badge; a chip on every row would be
  // a label that says "file".
  const showKind = kind !== "document";

  return (
    <div ref={root} className="material" lang={language} style={pageVars} onKeyDownCapture={onKeyDownCapture}>
      <header className="material__head">
        <div className="material__headinner">
          <div className="material__titleblock">
            <input
              className="material__title"
              data-tutorial="material-name"
              value={name}
              size={Math.max(6, Math.min(48, [...name].length + 1))}
              spellCheck={false}
              aria-label="File name"
              title="The file's name on disk. Editing it renames the file."
              readOnly={!onRename}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                } else if (e.key === "Escape") {
                  setName(titleOf(item));
                  e.currentTarget.blur();
                }
              }}
            />
            {showKind && <span className={`material__kind material__kind--${kind}`}>{kind}</span>}
            {tags.map((t) => (
              <span className="material__tag" key={t}>
                {t}
                {editingTags && <IconButton size="mini" label={`Remove tag “${t}”`} disabled={!!gate}
                  onClick={() => onEditTags?.((now) => now.filter((x) => x !== t))}><CloseIcon size={10} /></IconButton>}
              </span>
            ))}
            {onEditTags && <Button size="small" treatment="borderless" data-tutorial="material-tags" onClick={() => setEditingTags(!editingTags)} aria-expanded={editingTags}>
              {editingTags ? "Done Editing Tags" : "Edit Tags"}
            </Button>}
            {editingTags && <form className="settings__actions" onSubmit={(e) => {
              e.preventDefault(); const value = tag.trim();
              if (value && !/[\n\r,\[\]]/.test(value)) { onEditTags?.((now) => now.includes(value) ? now : [...now, value]); setTag(""); }
            }}>
              <input className="field" data-tutorial="tag-field" aria-label="New tag" value={tag} maxLength={80} placeholder="New tag" disabled={!!gate} onChange={(e) => setTag(e.target.value)} />
              <Button type="submit" size="small" data-tutorial="add-tag" disabled={!!gate || !tag.trim() || /[\n\r,\[\]]/.test(tag)}>Add Tag</Button>
            </form>}
          </div>
          <div className="material__headright">
            <span
              className={`material__save material__save--${saveState}`}
              role="status"
              aria-live="polite"
            >
              {saveState === "dirty" ? "Saving…" : saveState === "saved" ? "Saved" : ""}
            </span>
            <div className="material__modes" role="group" aria-label="View">
              <button
                className={`material__mode${mode === "page" ? " material__mode--on" : ""}`}
                onClick={() => show("page")}
                aria-pressed={mode === "page"}
                title="Write on the page · ⌘E"
              >
                Page
              </button>
              <button
                className={`material__mode${mode === "source" ? " material__mode--on" : ""}`}
                onClick={() => show("source")}
                aria-pressed={mode === "source"}
                title="Edit the Markdown source · ⌘E"
              >
                Source
              </button>
            </div>
          </div>
        </div>
      </header>
      {gate && (
        <div className="material__gate" role="status">
          <span className="material__gatetext">
            This changed somewhere else while you were writing. Nothing has been
            overwritten.
          </span>
          <button onClick={() => onResolveGate?.("theirs")}>Use the other</button>
          <button onClick={() => onResolveGate?.("mine")}>Keep this one</button>
        </div>
      )}
      {mode === "page" ? (
        <>
          <FormatBar editor={editor} />
          {kind === "character" && !body.trim() && <div className="settings__actions">
            <Button size="small" treatment="borderless" onClick={() => onChange((schemaFor("character")?.sections ?? [])
              .filter((s) => !s.managed).map((s) => `## ${s.heading}\n\n`).join(""))}>Start with Character Prompts</Button>
          </div>}
          <div className="material__desk">
            <div className="material__page" data-tutorial="material-page" style={sheetZoom}>
              <ProseEditor
                markdown={body}
                onChange={onChange}
                onBlur={flush}
                onReady={setEditor}
              />
            </div>
          </div>
        </>
      ) : (
        <div className="material__desk">
          <textarea
            ref={box}
            className="material__body"
            style={sheetZoom}
            value={body}
            placeholder="Write…"
            spellCheck
            onChange={(e) => onChange(e.target.value)}
            onBlur={flush}
          />
        </div>
      )}
    </div>
  );
}
