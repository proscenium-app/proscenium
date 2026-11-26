// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A page before or after the script, edited where it prints
 * (docs/app/formatting/formats-and-layout.md#FMT-169): one click on its sheet
 * in the script's page view and the caret is in it, set as it prints
 * (docs/app/formatting/formats-and-layout.md#FMT-177). The page's formatting
 * bar stands at the top of the script where the element bar does, with the
 * page's name, Change Template… and Done: nothing of the app's is on the
 * paper. A field on the page is where the detail it shows is written, in
 * place (docs/app/formatting/formats-and-layout.md#FMT-180).
 *
 * A page is a Markdown file in the script's Front Matter folder, written
 * through the store every binder document is written through
 * (use-material-sessions.ts): its words are this editor's buffer, saved after
 * a pause and on the way out, checked against the version they were written
 * on, kept when they cannot land. Its header (`layout: title`) stays aside,
 * as a document's front matter does.
 *
 * A page the script's title page still prints (`legacy:` and its kind) is
 * edited the same way. Nothing is written until the writer changes a word
 * (docs/app/keeping-work/storage-and-file-format.md#STOR-75); the first change
 * writes every such page as a file, this one with its new words, and the
 * editor carries on with the file, the caret where it was.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { FormatSpec } from "../format";
import type { FrontMatter } from "../fountain";
import {
  FIELDS,
  fieldValue,
  frontSheetMetrics,
  legacyBlockAt,
  legacyPageFiles,
  pageBlockAt,
  readPageFile,
  type Field,
} from "../layout";
import { toDoc } from "../markdown/doc";
import { FIELD_NODE, fieldTextOf } from "../markdown/page-file-nodes";
import { isFieldName, type FieldName } from "../markdown/page-fields";
import { AutosaveScheduler, DEFAULT_AUTOSAVE } from "../storage/autosave";
import { Button } from "../ui";
import {
  splitFrontMatter,
  withFrontMatter,
  type BufferLease,
  type MaterialBuffer,
  type ParkedWords,
} from "../workspace";
import { FrontPageEditor, type DetailsAccess, type SheetSetting } from "./FrontPageEditor";
import { detailValue, sameDetail, type Details } from "./play-details";

const DEBOUNCE_MS = 400;
const LEGACY = "legacy:";

export interface PageOnSheetProps {
  /** The page: a page file's binder id, or `legacy:` and the kind of a page the title page prints. */
  source: string;
  /** The page's name, as the binder and the export name it. */
  name: string;
  /** The engine's id of the paragraph clicked, or null. */
  at: string | null;
  /** The script's front matter: the facts the page's fields show, and its pages. */
  frontMatter: FrontMatter;
  /** The page's file as the store last knew it on disk; null until it is held. */
  material: { content: string; reset: number } | null;
  /** Another version of the file arrived while these words were unsaved. */
  gate: { theirs: string } | null;
  onSave: (id: string, full: string, base: string) => Promise<boolean>;
  onRegisterBuffer: (id: string, buffer: MaterialBuffer) => BufferLease<ParkedWords>;
  onDirty: (id: string, dirty: boolean) => void;
  onResolveGate: (id: string, choice: "mine" | "theirs") => void;
  /** Hold the page's file in the store, for this editor to write. */
  onHold: (id: string) => void;
  /** Write the title page's pages as files, this one with its new words. */
  onMaterialize: (edited: { kind: string; text: string }) => Promise<Record<string, string> | null>;
  /** The page's words moved to a file: the page view names it by its id from here on. */
  onRetarget: (source: string) => void;
  onDone: () => void;
  /** The strip at the top of the script that holds the page's formatting bar. */
  bar: HTMLElement | null;
  /** The play's format: the page is set in its type, where its layout puts it. */
  spec: FormatSpec;
  /** Opens the templates, to give this page another; absent for a page that cannot take one. */
  onChangeTemplate?: (source: string) => void;
  /** Write details of the play, as a field edited on the page asks. */
  onSetDetails: (patch: Partial<Details>) => void;
}

/**
 * The field a paragraph is, when it is one field and nothing else: a press on
 * that line of the sheet is a press on the detail it shows.
 */
function loneFieldAt(text: string, block: number): FieldName | null {
  const node = toDoc(splitFrontMatter(text).body, { pageFile: true }).content?.[block];
  const inline = node?.content ?? [];
  if (inline.length !== 1 || inline[0]?.type !== FIELD_NODE) return null;
  const name = inline[0].attrs?.name;
  return isFieldName(name) ? name : null;
}

/** The page's whole file as the page view knows it before the store has it. */
export function startingText(source: string, fm: FrontMatter): string {
  if (source.startsWith(LEGACY)) {
    const kind = source.slice(LEGACY.length);
    return legacyPageFiles(fm).find((file) => file.kind === kind)?.text ?? "";
  }
  // A page before the script, or one after it: each is held where its side is.
  return (
    fm.pages?.find((page) => page.id === source)?.text ??
    fm.backPages?.find((page) => page.id === source)?.text ??
    ""
  );
}

export function PageOnSheet({
  source,
  name,
  at,
  frontMatter,
  material,
  gate,
  onSave,
  onRegisterBuffer,
  onDirty,
  onResolveGate,
  onHold,
  onMaterialize,
  onRetarget,
  onDone,
  bar,
  spec,
  onChangeTemplate,
  onSetDetails,
}: PageOnSheetProps) {
  const legacy = source.startsWith(LEGACY);
  // Taken once: the words and the paragraph the editor opens on.
  const [opening] = useState(() => {
    const text = startingText(source, frontMatter);
    const paragraph = source.startsWith(LEGACY)
      ? legacyBlockAt(source.slice(LEGACY.length), at, frontMatter)
      : pageBlockAt(text, at);
    // A press on a line that is one field opens that detail with the page.
    const field = at === null ? null : loneFieldAt(text, paragraph);
    // Whether the page's words were to hand: not so for a page just added,
    // edited before its folder has been read.
    const known =
      source.startsWith(LEGACY) ||
      [...(frontMatter.pages ?? []), ...(frontMatter.backPages ?? [])].some(
        (page) => page.id === source,
      );
    return { text, known, focusAt: { paragraph }, field, layout: readPageFile(text).layout };
  });
  const [body, setBody] = useState(() => splitFrontMatter(opening.text).body);
  /** The words as typed, read by every way out. */
  const latest = useRef(body);
  /** The words as they last went to, or came from, the file. */
  const savedBody = useRef(body);
  /** The file these words are written on: what was read, or what this editor last saved. */
  const base = useRef(opening.text);
  /** A save sent and not yet landed: its words are not on disk until the store says so. */
  const sending = useRef<{ full: string; builtOn: string; done: Promise<void> } | null>(null);
  /** Whether the store's copy of the file has been taken up since the page became a file. */
  const adopted = useRef(false);
  /** Whether the writer has changed a word here: then the store's first copy never replaces theirs. */
  const touched = useRef(false);
  const seenReset = useRef(material?.reset ?? 0);
  const id = legacy ? null : source;
  const idRef = useRef(id);
  idRef.current = id;

  const scheduler = useRef(
    new AutosaveScheduler(
      { debounceMs: DEBOUNCE_MS, maxWaitMs: DEFAULT_AUTOSAVE.maxWaitMs },
      () => void flushRef.current(),
    ),
  );

  // A page file is held in the store for as long as it is edited here: asked
  // again as the pages are read again, should the binder not have had the
  // page yet when it was first asked for.
  const pages = frontMatter.pages;
  const backPages = frontMatter.backPages;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the pages read again, on either side of the script, are a cause
  useEffect(() => {
    if (id && !material) onHold(id);
  }, [id, material, onHold, pages, backPages]);

  // The store's copy of the file, as it arrives and as it changes.
  useEffect(() => {
    if (!id || !material) return;
    const { content, reset } = material;
    const words = splitFrontMatter(content).body;
    if (!adopted.current) {
      // The first sight of the file: what this editor's words are written on.
      // Words typed before it came (the first edit of a page the title page
      // printed, still being written as a file) are kept and saved on it.
      adopted.current = true;
      seenReset.current = reset;
      base.current = content;
      savedBody.current = words;
      if (!touched.current) {
        latest.current = words;
        setBody(words);
      } else if (!opening.known && words.trim()) {
        // Typed on a page just added, in the moment before its own words
        // came: the page's words stand, and what was typed follows them. It
        // was the whole page, and its heading was written over.
        const kept = `${words.replace(/\s+$/, "")}\n\n${latest.current}`;
        latest.current = kept;
        setBody(kept);
      }
      if (latest.current !== savedBody.current) scheduler.current.schedule();
      return;
    }
    const forced = reset !== seenReset.current;
    seenReset.current = reset;
    if (
      !forced &&
      !sending.current &&
      latest.current !== savedBody.current &&
      words === latest.current
    ) {
      savedBody.current = latest.current;
      base.current = content;
      onDirty(id, false);
      return;
    }
    if (!forced && content === base.current) return;
    if (!forced && (latest.current !== savedBody.current || sending.current)) {
      // Words of our own: a new version that changed only the header is built on.
      if (words === splitFrontMatter(base.current).body) base.current = content;
      return;
    }
    latest.current = words;
    savedBody.current = words;
    base.current = content;
    setBody(words);
    onDirty(id, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, material]);

  /** Write now, if there is anything to write; the same function from every way out. */
  const flushRef = useRef<() => void | Promise<void>>(() => {});
  flushRef.current = () => {
    scheduler.current.cancel();
    const page = idRef.current;
    if (!page || !adopted.current) return;
    if (latest.current === savedBody.current) return sending.current?.done;
    const words = latest.current;
    const previous = savedBody.current;
    const builtOn = base.current;
    const full = withFrontMatter(splitFrontMatter(builtOn).header, words);
    savedBody.current = words;
    base.current = full;
    const done = onSave(page, full, builtOn).then((ok) => {
      if (sending.current?.full === full) sending.current = null;
      if (ok) {
        onDirty(page, latest.current !== savedBody.current);
        return;
      }
      if (savedBody.current === words) savedBody.current = previous;
      if (base.current === full) base.current = builtOn;
      onDirty(page, true);
    });
    sending.current = { full, builtOn, done };
    return done;
  };

  /** What this editor holds that the file does not, with what it was written on. */
  const unsaved = (): ParkedWords | null => {
    if (!adopted.current) return null;
    if (latest.current !== savedBody.current)
      return {
        full: withFrontMatter(splitFrontMatter(base.current).header, latest.current),
        base: base.current,
      };
    const out = sending.current;
    return out ? { full: out.full, base: out.full } : null;
  };
  const unsavedRef = useRef(unsaved);
  unsavedRef.current = unsaved;

  // Registered with the store for as long as this editor writes the file, so
  // closing the play, quitting or trashing the page reaches these words.
  useLayoutEffect(() => {
    if (!id) return;
    const lease = onRegisterBuffer(id, {
      flush: () => flushRef.current(),
      unsaved: () => unsavedRef.current()?.full ?? null,
      words: () => unsavedRef.current(),
      page: () => withFrontMatter(splitFrontMatter(base.current).header, latest.current),
    });
    const parked = lease.take();
    if (parked) {
      const words = splitFrontMatter(parked.full).body;
      latest.current = words;
      setBody(words);
      base.current = parked.base;
      adopted.current = true;
      scheduler.current.schedule();
    }
    return () => {
      scheduler.current.cancel();
      void flushRef.current();
      lease.release(unsavedRef.current());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Leaving the app is leaving the page.
  useEffect(() => {
    const onHide = () => void flushRef.current();
    const onVisible = () => {
      if (document.visibilityState === "hidden") void flushRef.current();
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

  /** The first change to a page the title page prints: every such page becomes a file. */
  const moving = useRef(false);
  const onChange = (next: string) => {
    touched.current = true;
    latest.current = next;
    setBody(next);
    if (idRef.current) {
      onDirty(idRef.current, true);
      scheduler.current.schedule();
      return;
    }
    if (moving.current) return;
    moving.current = true;
    const kind = source.slice(LEGACY.length);
    const { header } = splitFrontMatter(opening.text);
    void onMaterialize({ kind, text: withFrontMatter(header, next) }).then((ids) => {
      const made = ids?.[kind];
      if (made) onRetarget(made);
      // Not written: the words stay here, and the next change tries again.
      else moving.current = false;
    });
  };

  /**
   * Change Template…: what is typed is sent first, so the templates are shown
   * the page as it is. A page the title page still prints is written as a
   * file first, with the rest, as its first change would have written it.
   */
  const changeTemplate = async () => {
    if (!onChangeTemplate) return;
    if (idRef.current) {
      await flushRef.current();
      onChangeTemplate(idRef.current);
      return;
    }
    if (moving.current) return;
    moving.current = true;
    const kind = source.slice(LEGACY.length);
    const { header } = splitFrontMatter(opening.text);
    const ids = await onMaterialize({ kind, text: withFrontMatter(header, latest.current) });
    const made = ids?.[kind];
    if (!made) {
      moving.current = false;
      return;
    }
    onRetarget(made);
    onChangeTemplate(made);
  };

  const values = useMemo(() => {
    const out: Partial<Record<Field, string>> = {};
    for (const field of FIELDS) out[field] = fieldValue(field, frontMatter);
    return out;
  }, [frontMatter]);

  const root = useRef<HTMLDivElement | null>(null);
  const onKeyDown = (event: KeyboardEvent) => {
    // Taken on the way in: the prose editor keeps its own Esc. A menu of its
    // formatting bar is drawn elsewhere, and its Esc never comes here; nor
    // does Esc in a field's own words, which puts back what the field held.
    if (!(event.target instanceof Node) || !root.current?.contains(event.target)) return;
    if (fieldTextOf(event.target)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onDone();
    }
  };

  // The page as it prints: the format's type, its first line where the layout
  // puts it. A format whose opening runs in with the first numbered page has
  // no sheet of the page's own to set it on, so its words start at the top.
  const sheet = useMemo((): SheetSetting => {
    const policy = spec.frontMatter;
    const { topRows, gapRows } = frontSheetMetrics(spec, opening.layout);
    return {
      topRows: policy.placement === "inline" ? 0 : topRows,
      gapRows,
      title: opening.layout === "title",
      heading: policy.headingFontStyle,
      body: policy.bodyFontStyle,
      titleStyle: policy.titleFontStyle,
    };
  }, [spec, opening.layout]);

  const fm = useRef(frontMatter);
  fm.current = frontMatter;
  const details = useMemo(
    (): DetailsAccess => ({
      set: (detail, text) => {
        if (!sameDetail(fm.current, detail, text))
          onSetDetails({ [detail]: detailValue(detail, text) });
      },
    }),
    [onSetDetails],
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Esc from anywhere in the page's editor
    <div
      ref={root}
      className="frontedit"
      role="group"
      aria-label={name}
      onKeyDownCapture={onKeyDown}
      data-tutorial={/character|cast/i.test(name) ? "characters-page" : undefined}
    >
      {gate && id && (
        <div className="frontedit__gate" role="alert">
          <span>This page changed somewhere else while you were writing on it.</span>
          <Button onClick={() => onResolveGate(id, "mine")}>Keep Mine</Button>
          <Button onClick={() => onResolveGate(id, "theirs")}>Use Theirs</Button>
        </div>
      )}
      <FrontPageEditor
        label={`${name} text`}
        value={body}
        onChange={onChange}
        focusAt={opening.focusAt}
        barHost={bar}
        fields={values}
        name={name}
        onDone={onDone}
        onChangeTemplate={onChangeTemplate ? () => void changeTemplate() : undefined}
        details={details}
        openField={opening.field}
        sheet={sheet}
        // Leaving the page for a sheet (an export, a menu) sends its words.
        onBlur={() => void flushRef.current()}
      />
    </div>
  );
}
