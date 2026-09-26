// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The outliner (docs/app/organizing/workspace-model.md#WORK-D3) — two halves of the same job.
 *
 * The TABLE is what the play is: acts, scenes, synopses, status, in order.
 * Editing a synopsis writes the `=` line to the script; status/label write the
 * play file; reordering rows reorders scenes exactly as the board.
 *
 * The SCRATCHPAD above it is what the play might be. Structure has no room for
 * "what if the brother arrives in act two" — so that goes here, in freeform
 * prose, beside the structure it's about instead of in another app. It is a
 * plain Markdown material (outline-note.ts), born on the first keystroke and
 * autosaved from then on.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { pageCountLabel, pageRangeLabel, type ScenePageMap, type ScenePages } from "../layout";
import { ProseEditor } from "../markdown/ProseEditor";
import type { SceneCard } from "./card-reconcile";
import { useFieldDraft } from "./field-draft";
import { AutosaveScheduler, DEFAULT_AUTOSAVE } from "../storage/autosave";
import type { BufferLease, MaterialBuffer, ParkedWords } from "./material-buffer";
import { useSceneStatusOptions } from "../app/settings/scene-statuses";
import type { Card } from "./play-file";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  OutlineIcon,
  PopupButton,
} from "../ui";


/** Collapsed state is a view preference, so it rides along app-level. */
const NOTES_OPEN_KEY = "proscenium:outlineNotesOpen";

export interface OutlinerProps {
  cards: SceneCard[];
  onReorder: (from: number, to: number) => void;
  onSetCard: (sceneId: string, partial: Partial<Card>) => void;
  onEditSynopsis: (ordinal: number, text: string) => void;
  /** Jump to this scene in the script editor. */
  onOpenScene: (ordinal: number) => void;
  /** Where each scene sits in the paginated script, and how long it runs. */
  scenePages?: ScenePageMap;
  /** The scratchpad's prose — "" before the writer has started one. */
  notes: string;
  /** Vault-relative path, once the note exists. */
  notesPath: string | null;
  /** Save the scratchpad; resolves false when nothing was written. */
  onEditNotes: (body: string, base: string) => void | Promise<boolean>;
  /** Report unsaved scratchpad edits up (the installer's unsaved-work beacon). */
  onNotesDirty?: (dirty: boolean) => void;
  /** Bumped when the scratchpad must take `notes` whatever it holds. */
  notesReset?: number;
  /** False while the note is still being read: not writable until it is. */
  notesReady?: boolean;
  /** Another version of the note, waiting on the writer's choice. */
  notesGate?: { theirs: string } | null;
  onResolveNotesGate?: (choice: "mine" | "theirs") => void;
  /** The scratchpad's buffer, leased like a sheet's (material-buffer.ts). */
  onRegisterNotesBuffer?: (buffer: MaterialBuffer) => BufferLease<ParkedWords>;
  /** Scenes touched by a change that arrived from outside. */
  changedScenes?: Set<number>;
}

export function OutlinerView({
  cards,
  onReorder,
  onSetCard,
  onEditSynopsis,
  onOpenScene,
  scenePages,
  notes,
  notesPath,
  onEditNotes,
  onNotesDirty,
  notesReset = 0,
  notesReady = true,
  notesGate = null,
  onResolveNotesGate,
  onRegisterNotesBuffer,
  changedScenes,
}: OutlinerProps) {
  const ordered = [...cards].sort((a, b) => a.anchor.ordinal - b.anchor.ordinal);
  const pagesFor = new Map((scenePages?.scenes ?? []).map((s) => [s.ordinal, s]));
  return (
    <div className="outline-surface">
      <OutlineNotes
        notes={notes}
        path={notesPath}
        onEdit={onEditNotes}
        onDirty={onNotesDirty}
        reset={notesReset}
        ready={notesReady}
        gate={notesGate}
        onResolveGate={onResolveNotesGate}
        onRegisterBuffer={onRegisterNotesBuffer}
      />
      {ordered.length === 0 ? (
        <div className="board board--empty">
          <div className="emptysurface">
            <span className="emptysurface__glyph">
              <OutlineIcon size={22} />
            </span>
            <p className="emptysurface__title">No scenes yet</p>
            <p className="emptysurface__body">
              Type <span className="mono">## Scene</span> in the script, or{" "}
              <span className="mono">;</span> then <span className="mono">2</span>, and a
              row appears here.
            </p>
          </div>
        </div>
      ) : (
        <table className="outliner">
          <thead>
            <tr>
              <th>
                <span className="sr-only">Move</span>
              </th>
              <th>Act</th>
              <th>Scene</th>
              <th>Pages</th>
              <th>Summary</th>
              <th>Notes</th>
              <th>Status</th>
              <th>Label</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((rec, i) => (
              <OutlineRow
                key={rec.id}
                rec={rec}
                canUp={i > 0}
                canDown={i < ordered.length - 1}
                onUp={() => onReorder(rec.anchor.ordinal, rec.anchor.ordinal - 1)}
                onDown={() => onReorder(rec.anchor.ordinal, rec.anchor.ordinal + 1)}
                onSetCard={(p) => onSetCard(rec.id, p)}
                onEditSynopsis={(t) => onEditSynopsis(rec.anchor.ordinal, t)}
                onOpen={() => onOpenScene(rec.anchor.ordinal)}
                pages={pagesFor.get(rec.anchor.ordinal)}
                changed={changedScenes?.has(rec.anchor.ordinal) ?? false}
                /* An act change takes the hairline, so the table's own groups
                   are visible without a band row breaking the columns. */
                actStart={i > 0 && rec.act !== ordered[i - 1].act}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

interface NotesProps {
  /** The note's body as the store knows the disk holds it. */
  notes: string;
  path: string | null;
  /** Save `body`, written on the note as `base` — refused, and met with the choice, if it has moved on. */
  onEdit: (body: string, base: string) => void | Promise<boolean>;
  onDirty?: (dirty: boolean) => void;
  reset: number;
  ready: boolean;
  gate: { theirs: string } | null;
  onResolveGate?: (choice: "mine" | "theirs") => void;
  onRegisterBuffer?: (buffer: MaterialBuffer) => BufferLease<ParkedWords>;
}

/**
 * Freeform, autosaved on the same 600ms debounce as every other prose surface,
 * flushed on blur so leaving the view can't strand a sentence.
 *
 * The same page editor the materials use (src/markdown/ProseEditor.tsx): it is
 * Markdown on disk, and it looks like what it is while you write it. No modes —
 * this is a place to think, and a scratchpad you have to switch into is one you
 * stop using.
 */
function OutlineNotes({
  notes,
  path,
  onEdit,
  onDirty,
  reset,
  ready,
  gate,
  onResolveGate,
  onRegisterBuffer,
}: NotesProps) {
  const [body, setBody] = useState(notes);
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(NOTES_OPEN_KEY) !== "0";
    } catch {
      return true;
    }
  });
  // Idle debounce with a ceiling, like the script and the sheets (docs/app/keeping-work/storage-and-file-format.md#STOR-150).
  const scheduler = useRef(
    new AutosaveScheduler({ debounceMs: 600, maxWaitMs: DEFAULT_AUTOSAVE.maxWaitMs }, () => void saveRef.current()),
  );
  const latest = useRef(notes);
  /** What the note holds on disk as far as this buffer knows: read, or last saved. */
  const saved = useRef(notes);
  /**
   * The note these words are written on: what was read, or what this buffer
   * last saved (taken as it saves, so the next save builds on it). A save
   * written on notes another pane or device has since replaced meets the
   * choice — it used to go over them.
   */
  const base = useRef(notes);
  /** A save sent and not landed: its words are still unsaved until the store says so. */
  const sending = useRef<{ text: string; builtOn: string; done: Promise<void> } | null>(null);
  const seenReset = useRef(reset);
  // A new version of the note: taken when the store says so, or when there is
  // nothing unsaved here — never over words the writer is typing, or sending.
  useEffect(() => {
    const forced = reset !== seenReset.current;
    seenReset.current = reset;
    // Exactly the words on this page (an earlier scratchpad's save, landing
    // after this one took its words over): saved.
    if (!forced && !sending.current && latest.current !== saved.current && notes === latest.current) {
      saved.current = notes;
      base.current = notes;
      onDirty?.(false);
      return;
    }
    if (!forced && notes === base.current) return;
    // Nothing unsaved and nothing on its way: what arrives is the newest note,
    // even when it matches an earlier save of this scratchpad (see MaterialEditor).
    if (!forced && (latest.current !== saved.current || sending.current)) return;
    scheduler.current.cancel();
    setBody(notes);
    latest.current = notes;
    saved.current = notes;
    base.current = notes;
    onDirty?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, reset]);

  const saveRef = useRef<() => void | Promise<void>>(() => {});
  saveRef.current = () => {
    scheduler.current.cancel();
    // The note is born on the first real keystroke, never on a look: an empty
    // buffer that was already empty must not create a file (outline-note.ts).
    if (latest.current === saved.current) return sending.current?.done;
    const text = latest.current;
    const previous = saved.current;
    const builtOn = base.current;
    saved.current = text;
    base.current = text;
    const done = Promise.resolve(onEdit(text, builtOn)).then((ok) => {
      if (sending.current?.text === text) sending.current = null;
      if (ok !== false) {
        onDirty?.(latest.current !== saved.current);
        return;
      }
      // Nothing was written: still unsaved, and still written on what it was.
      if (saved.current === text) saved.current = previous;
      if (base.current === text) base.current = builtOn;
      onDirty?.(true);
    });
    sending.current = { text, builtOn, done };
    return done;
  };
  const words = (): ParkedWords | null => {
    if (latest.current !== saved.current) return { full: latest.current, base: base.current };
    // A save still on its way: the next scratchpad builds on it.
    const out = sending.current;
    return out ? { full: out.text, base: out.text } : null;
  };
  const wordsRef = useRef(words);
  wordsRef.current = words;
  const registerRef = useRef(onRegisterBuffer);
  registerRef.current = onRegisterBuffer;
  // Leased for as long as it is on screen, in layout effects so a scratchpad
  // going away (a surface switched, a pane split) releases its words before the
  // one arriving takes them (see MaterialEditor).
  useLayoutEffect(() => {
    const lease = registerRef.current?.({
      flush: () => saveRef.current(),
      unsaved: () => wordsRef.current()?.full ?? null,
      words: () => wordsRef.current(),
      page: () => latest.current,
    });
    const parked = lease?.take() ?? null;
    if (parked) {
      setBody(parked.full);
      latest.current = parked.full;
      // Unsaved against the note as the store knows it now (see MaterialEditor).
      saved.current = notes;
      base.current = parked.base;
      onDirty?.(parked.full !== notes);
    }
    return () => {
      scheduler.current.cancel();
      void saveRef.current();
      lease?.release(wordsRef.current());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const change = (next: string) => {
    setBody(next);
    latest.current = next;
    onDirty?.(true);
    scheduler.current.schedule();
  };
  const flush = () => void saveRef.current();
  const toggle = () => {
    setOpen((wasOpen) => {
      const next = !wasOpen;
      try {
        localStorage.setItem(NOTES_OPEN_KEY, next ? "1" : "0");
      } catch {
        /* a preference that won't persist still works this session */
      }
      return next;
    });
  };

  return (
    <section className="outline-notes">
      <header className="outline-notes__head">
        <button
          className="outline-notes__toggle"
          onClick={toggle}
          aria-expanded={open}
          title={open ? "Collapse notes" : "Expand notes"}
        >
          <span className="outline-notes__chevron">{open ? "▾" : "▸"}</span>
          Outline notes
        </button>
        {path && <span className="outline-notes__path">{path}</span>}
        {!open && body.trim() && (
          <span className="outline-notes__peek">{firstLine(body)}</span>
        )}
      </header>
      {gate && (
        <div className="material__gate" role="status">
          <span className="material__gatetext">
            These notes changed somewhere else while you were writing. Nothing has been
            overwritten.
          </span>
          <button onClick={() => onResolveGate?.("theirs")}>Use the other</button>
          <button onClick={() => onResolveGate?.("mine")}>Keep this one</button>
        </div>
      )}
      {open && (
        <div className="outline-notes__body">
          <ProseEditor markdown={body} onChange={change} onBlur={flush} editable={ready} />
        </div>
      )}
    </section>
  );
}

/** A one-line taste of the notes while they're collapsed. */
function firstLine(body: string): string {
  const line = body.split("\n").find((l) => l.trim()) ?? "";
  const clean = line.replace(/^#+\s*/, "").trim();
  return clean.length > 90 ? `${clean.slice(0, 89)}…` : clean;
}

interface RowProps {
  rec: SceneCard;
  canUp: boolean;
  canDown: boolean;
  onUp: () => void;
  onDown: () => void;
  onSetCard: (p: Partial<Card>) => void;
  onEditSynopsis: (t: string) => void;
  onOpen: () => void;
  pages?: ScenePages;
  changed: boolean;
  actStart: boolean;
}

function OutlineRow({
  rec,
  canUp,
  canDown,
  onUp,
  onDown,
  onSetCard,
  onEditSynopsis,
  onOpen,
  pages,
  changed,
  actStart,
}: RowProps) {
  const statusOptions = useSceneStatusOptions(rec.card.status);
  const sceneName = `${rec.act ? `${rec.act} · ` : ""}${rec.heading || `Scene ${rec.anchor.ordinal + 1}`}`;
  const synopsis = useFieldDraft(rec.synopsis ?? "");
  const label = useFieldDraft(rec.card.label ?? "");
  // Follows a note written from outside the app (the play file is live-adopted).
  const note = useFieldDraft(rec.card.boardNote ?? "");
  return (
    <tr
      className={`outliner__row card--${rec.card.color}${changed ? " is-changed" : ""}${
        actStart ? " is-actstart" : ""
      }`}
    >
      <td className="outliner__move">
        <button
          disabled={!canUp}
          onClick={onUp}
          title="Move up"
          aria-label={`Move ${rec.heading || `scene ${rec.anchor.ordinal + 1}`} up`}
        >
          <ArrowUpIcon size={11} />
        </button>
        <button
          disabled={!canDown}
          onClick={onDown}
          title="Move down"
          aria-label={`Move ${rec.heading || `scene ${rec.anchor.ordinal + 1}`} down`}
        >
          <ArrowDownIcon size={11} />
        </button>
      </td>
      <td className="outliner__act">{rec.act ?? ""}</td>
      <th scope="row" className="outliner__scene">
        <button className="outliner__open" title="Open this scene in the script" onClick={onOpen}>
          {/* The card's hue, as a dot beside the name — never instead of it. */}
          <span className="outliner__huedot" aria-hidden="true" />
          {rec.act && <span className="sr-only">{rec.act} · </span>}
          {rec.heading || `Scene ${rec.anchor.ordinal + 1}`}
        </button>
        {changed && (
          <span className="outliner__changed" title="Changed from outside the app — see Changes">
            changed
          </span>
        )}
      </th>
      {/* Length beside the structure: this column is how the table answers "is
          act one running long?". Its count was a minute estimate, one page to
          a minute, but a page is not a minute; it counts pages now, as the board does. */}
      <td className="outliner__pages">
        {pages ? (
          <>
            <span className="outliner__pagerange">{pageRangeLabel(pages)}</span>
            {" · "}
            <span className="outliner__pagecount">{pageCountLabel(pages.pages)}</span>
          </>
        ) : (
          ""
        )}
      </td>
      <td>
        {/* A textarea, not an input: the synopsis is the one column on this
            surface that carries a thought, and a single line clipped it mid-word
            ("Mara, alone before dawn, can't stop the dripping. Jonah arrives ur…")
            while the same text showed in full on the board. It wraps and grows
            with the row instead. */}
        <textarea
          aria-label={`Summary — ${sceneName}`}
          className="outliner__synopsis"
          value={synopsis.draft}
          rows={2}
          placeholder="Scene summary…"
          onChange={(e) => synopsis.change(e.target.value)}
          onBlur={() => {
            const next = synopsis.take();
            if (next !== null) onEditSynopsis(next);
          }}
        />
      </td>
      {/* Scene thinking that is not in the script yet — canonical in the
          play file (`card.boardNote`), unlike the synopsis beside it which is a
          `=` line in the .fountain. Editable from outside the app, and until now
          invisible everywhere in the app. */}
      <td>
        <textarea
          aria-label={`Notes — ${sceneName}`}
          className="outliner__synopsis"
          value={note.draft}
          rows={2}
          placeholder="Notes…"
          onChange={(e) => note.change(e.target.value)}
          onBlur={() => {
            const next = note.take();
            if (next !== null) onSetCard({ boardNote: next });
          }}
        />
      </td>
      <td>
        <PopupButton
          size="mini"
          label={`Scene status — ${sceneName}`}
          options={statusOptions}
          value={rec.card.status}
          onChange={(v) => onSetCard({ status: v })}
          menuWidth={150}
        />
      </td>
      <td>
        <input
          aria-label={`Label — ${sceneName}`}
          className="outliner__label"
          value={label.draft}
          placeholder="label"
          onChange={(e) => label.change(e.target.value)}
          onBlur={() => {
            const next = label.take();
            if (next !== null) onSetCard({ label: next });
          }}
        />
      </td>
    </tr>
  );
}
