// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useMemo, useRef, useState } from "react";
import type { BlockType, InlineNode } from "../fountain/model";
import { Button, Checkbox, PopupButton, Sheet, announce } from "../ui";
import { opened } from "../storage";
import { assertDocumentSize } from "../storage/read-limit";
import { encodeBytes, type KeptFile } from "../storage/import-bytes";
import { analyze } from "./analyze";
import { guidance, IMPORT_ACCEPT, isPagesName, SOURCE_GUIDES } from "./formats";
import { zipPackage } from "./package";
import { documentMarkdown, hasUnderline, headingLevel, looksLikeScript } from "./document";
import {
  documentTitle,
  ELEMENTS,
  EMPTY_CORRECTIONS,
  makeScript,
  paragraphText,
  reviewLines,
  type Corrections,
  type ImportDocument,
  type Reading,
} from "./model";

export type ImportSource = { file: File } | { path: string };
export interface ImportRequest {
  sources: ImportSource[];
  finish?: () => void;
  /** The open play the import goes into, by title
   * (docs/app/importing/document-import.md#IMPT-96). A new play when absent. */
  play?: string;
  /** The binder folder it goes into, when Import… or a drop named one. */
  parentId?: string | null;
  /** That folder's name, for the review to show. */
  folder?: string;
}
export type AddAs = "script" | "document";

const sourceName = (source: ImportSource) =>
  "file" in source ? source.file.name : source.path.split(/[\\/]/).pop()!;
const PAGE_SIZE = 50;
/** How a paragraph reads in a binder document. */
const documentLabel = (p: { style: string; kind?: BlockType; content: InlineNode[] }) => {
  const level = headingLevel(p);
  return level ? `Heading ${level}` : "Paragraph";
};

function Text({ content }: { content: InlineNode[] }) {
  return (
    <>
      {content.map((n, i) =>
        n.type === "note" ? (
          <span key={i} className="import-desk__note">
            [{n.content && <Text content={n.content} />}]
          </span>
        ) : (
          <span
            key={i}
            style={{
              fontWeight: n.marks?.some((m) => m.type === "strong") ? 700 : undefined,
              fontStyle: n.marks?.some((m) => m.type === "em") ? "italic" : undefined,
              textDecoration: n.marks?.some((m) => m.type === "underline")
                ? "underline"
                : undefined,
            }}
          >
            {n.text}
          </span>
        ),
      )}
    </>
  );
}

/** A temporary review transaction, using the same focus-owning sheet as Export.
 * The writing behind it remains mounted until an explicit Create New Play, or
 * Add Script or Add Document when the import goes into the open play. */
export function ImportPanel({
  request,
  destination,
  onClose,
  onCreate,
  onAdd,
}: {
  request: ImportRequest;
  destination: string;
  onClose: () => void;
  onCreate: (title: string, script: string, original: KeptFile) => Promise<boolean>;
  /** Adds to the open play when the request names one. */
  onAdd?: (as: AddAs, title: string, content: string, original: KeptFile) => Promise<boolean>;
}) {
  const play = request.play;
  const [queue, setQueue] = useState(request.sources);
  const [doc, setDoc] = useState<ImportDocument | null>(null);
  const [original, setOriginal] = useState<Uint8Array | null>(null);
  const [title, setTitle] = useState("");
  const [reading, setReading] = useState<Reading>("detect");
  const [corrections, setCorrections] = useState<Corrections>(EMPTY_CORRECTIONS);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(0);
  const [reviewOnly, setReviewOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [made, setMade] = useState(0);
  const [sourceApp, setSourceApp] = useState("Pages");
  const [addAs, setAddAs] = useState<AddAs>("script");
  const busy = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const cancel = useRef<AbortController | null>(null);
  const source = queue[0];
  useEffect(() => {
    const controller = new AbortController();
    cancel.current = controller;
    setDoc(null);
    setOriginal(null);
    setError("");
    setCorrections(EMPTY_CORRECTIONS);
    setReading("detect");
    setSelected(0);
    setPage(0);
    setSearch("");
    setReviewOnly(false);
    if (!source) {
      setLoading(false);
      return () => controller.abort();
    }
    setLoading(true);
    const load = async () => {
      let name = sourceName(source);
      const help = guidance(name);
      if (help) throw new Error(help);
      if ("file" in source) assertDocumentSize(source.file.size);
      let bytes: Uint8Array;
      if ("file" in source) bytes = new Uint8Array(await source.file.arrayBuffer());
      else {
        // A package-form .pages opened from Finder is a folder: zipped whole,
        // it reads and is kept like one chosen here.
        const files = isPagesName(name) ? await opened.readPackage(source.path) : null;
        if (files) ({ name, bytes } = zipPackage(name, files));
        else bytes = await opened.readBytes(source.path);
      }
      if (controller.signal.aborted) return;
      const document = await analyze(name, bytes, controller.signal);
      if (controller.signal.aborted) return;
      setDoc(document);
      setOriginal(bytes);
      setTitle(documentTitle(document));
      if (play)
        setAddAs(
          looksLikeScript(document, reviewLines(document, "detect", EMPTY_CORRECTIONS))
            ? "script"
            : "document",
        );
      announce(
        `${name} is ready to review. ${document.paragraphs.length} paragraphs. Nothing has been imported yet.`,
      );
    };
    void load()
      .catch((e) => {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [source]);
  useEffect(() => {
    if (doc) titleInput.current?.focus();
  }, [doc]);
  const lines = useMemo(
    () => (doc ? reviewLines(doc, reading, corrections) : []),
    [doc, reading, corrections],
  );
  const toReview = lines.filter((p) => p.review).length;
  const filtered = useMemo(
    () =>
      lines
        .map((line, index) => ({ line, index }))
        .filter(
          ({ line }) =>
            (!reviewOnly || line.review) &&
            paragraphText(line).toLocaleLowerCase().includes(search.toLocaleLowerCase()),
        ),
    [lines, reviewOnly, search],
  );
  const lastPage = Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const shown = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const active = lines[selected];
  const sourceStyleCount = active ? lines.filter((line) => line.style === active.style).length : 0;
  const scenes = lines.filter((p) => p.kind === "scene" || p.kind === "sceneHeading").length;
  const headings = doc ? doc.paragraphs.filter((p) => headingLevel(p)).length : 0;
  const asDocument = !!play && addAs === "document";
  const characters = new Set(
    lines.filter((p) => p.kind === "character").map((p) => paragraphText(p).toUpperCase()),
  ).size;
  const close = () => {
    if (!busy.current) {
      cancel.current?.abort();
      onClose();
    }
  };
  const takeFiles = (files: FileList | File[]) => {
    if (busy.current) return;
    const all = Array.from(files);
    if (all.length > 20) {
      setError("Choose up to 20 files at a time. Each becomes its own play.");
      return;
    }
    setQueue(all.map((file) => ({ file })));
  };
  const create = async () => {
    if (busy.current || !doc || !original || !title.trim()) return;
    busy.current = true;
    setSaving(true);
    setError("");
    try {
      const kept = { name: doc.name, base64: encodeBytes(original) };
      const content = asDocument
        ? documentMarkdown(doc)
        : makeScript(doc, title.trim(), reading, corrections);
      const ok =
        play && onAdd
          ? await onAdd(addAs, title.trim(), content, kept)
          : await onCreate(title.trim(), content, kept);
      if (!ok) {
        setError(
          play
            ? `“${title.trim()}” could not be added to ${play}. Your review is still here. Check the app’s message before trying again; the original may already be in the play's Originals folder.`
            : "The play could not be created or opened. Your review is still here. Check the app’s save message before trying again; an incomplete folder may remain in your Plays folder.",
        );
        return;
      }
      announce(
        play
          ? `“${title.trim()}” was added to ${play} as ${asDocument ? "a document" : "a script"}. The original is in its Originals folder.`
          : `“${title.trim()}” was imported. The original is in its Originals folder.`,
      );
      if (queue.length > 1) {
        setMade((n) => n + 1);
        setQueue((q) => q.slice(1));
      } else onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };
  const correct = (kind: BlockType) =>
    setCorrections((c) => ({ ...c, lines: { ...c.lines, [selected]: kind } }));
  return (
    <Sheet
      title={doc ? "Review Your Draft" : "Import a Draft"}
      subtitle={
        doc
          ? `${doc.name} · ${doc.format}${queue.length > 1 ? ` · ${queue.length} files remaining` : ""}`
          : play
            ? `Review your draft before adding it to ${play}.`
            : "Review your draft before creating a play."
      }
      width={doc ? 1060 : 720}
      onClose={close}
      footer={
        <>
          <span className="import-desk__footnote">
            {made ? `${made} imported. ` : ""}
            {!doc
              ? "Files are read on your device."
              : play
                ? `Adds ${asDocument ? "a document" : "a script"} to ${play}. Keeps a copy of the original.`
                : "Creates a new play. Keeps a copy of the original."}
          </span>
          <Button disabled={saving} onClick={close}>
            {made ? "Done" : "Cancel"}
          </Button>
          {queue.length > 1 && (
            <Button disabled={saving} onClick={() => setQueue((q) => q.slice(1))}>
              Skip This File
            </Button>
          )}
          {doc && (
            <Button
              treatment="primary"
              disabled={saving || !title.trim()}
              onClick={() => void create()}
            >
              {play
                ? saving
                  ? "Adding…"
                  : asDocument
                    ? "Add Document"
                    : "Add Script"
                : saving
                  ? "Creating Play…"
                  : "Create New Play"}
            </Button>
          )}
        </>
      }
    >
      <div
        className="import-desk"
        onDragOver={(e) => {
          if (!doc && !saving) e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (!doc && !saving) takeFiles(e.dataTransfer.files);
        }}
      >
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={IMPORT_ACCEPT}
          hidden
          onChange={(e) => {
            if (e.target.files?.length) takeFiles(e.target.files);
            e.target.value = "";
          }}
        />
        {error && (
          <div className="import-desk__error" role="alert">
            <strong>{source ? `About “${sourceName(source)}”` : "Import needs attention"}</strong>
            <p>{error}</p>
          </div>
        )}
        {loading ? (
          <div className="import-desk__reading" role="status">
            <h3>Reading {source ? sourceName(source) : "your draft"}…</h3>
            <p>Preparing the text and checking its structure. You can cancel at any time.</p>
          </div>
        ) : !doc ? (
          <>
            <div className="import-desk__choose">
              <h3>Choose a draft to bring in</h3>
              <p>Drop your file here, or choose it below. The original stays untouched.</p>
              <Button treatment="primary" onClick={() => fileInput.current?.click()}>
                Choose Files…
              </Button>
              <p className="import-desk__hint">
                Word (.docx), Pages, OpenDocument (.odt), RTF, text, Markdown, Fountain and Final
                Draft.
              </p>
            </div>
            <p className="import-desk__batchhint">
              Bringing several drafts? Choose them together and review each before it becomes a
              separate play.
            </p>
            <div className="import-desk__guides">
              <h3>Coming from another app?</h3>
              <div className="import-desk__guidechoice">
                <PopupButton
                  label="Source App"
                  value={sourceApp}
                  options={SOURCE_GUIDES.map((g) => ({
                    value: g.name,
                    label: g.name,
                  }))}
                  onChange={setSourceApp}
                />
                <span className="import-desk__hint">
                  {SOURCE_GUIDES.find((g) => g.name === sourceApp)?.file}
                </span>
              </div>
              <p className="import-desk__guidance" aria-live="polite">
                {SOURCE_GUIDES.find((g) => g.name === sourceApp)?.text}
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="import-desk__destination">
              <label htmlFor="import-play-title">
                {play ? (asDocument ? "Document name" : "New script name") : "New play name"}
                <input
                  ref={titleInput}
                  id="import-play-title"
                  className="field"
                  value={title}
                  disabled={saving}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={120}
                />
              </label>
              {play ? (
                <div>
                  <span className="import-desk__hint">
                    In {play}
                    {request.folder ? ` › ${request.folder}` : ""}
                  </span>
                  <PopupButton
                    label="Add as"
                    value={addAs}
                    disabled={saving}
                    options={[
                      { value: "script", label: "New Script" },
                      { value: "document", label: "Binder Document" },
                    ]}
                    onChange={setAddAs}
                  />
                </div>
              ) : (
                <div>
                  <span className="import-desk__hint">In your Plays folder</span>
                  <p className="import-desk__path" title={destination}>
                    {destination}
                  </p>
                </div>
              )}
              <Button disabled={saving} onClick={() => fileInput.current?.click()}>
                Choose Different Files…
              </Button>
            </div>
            <div className="import-desk__summary" aria-live="polite">
              <strong>{lines.length} paragraphs</strong>
              {asDocument ? (
                <>
                  <span>
                    {headings} {headings === 1 ? "heading" : "headings"}
                  </span>
                  <span>Headings come from the source’s Title and Heading styles</span>
                </>
              ) : (
                <>
                  <span>
                    {scenes} scene {scenes === 1 ? "heading" : "headings"}
                  </span>
                  <span>{characters} characters</span>
                  <span>
                    {toReview
                      ? `${toReview} inferred or unrecognized`
                      : "All elements come from the source or your choices"}
                  </span>
                </>
              )}
            </div>
            <details className="import-desk__limits">
              <summary>
                What carries across
                {doc.notices.length
                  ? ` · ${doc.notices.length} ${doc.notices.length === 1 ? "note" : "notes"}`
                  : ""}
              </summary>
              <p>
                {asDocument
                  ? `Your words, headings, bold and italic become a page in the binder that you edit like any note.${hasUnderline(doc) ? " Underlined words keep their text; a page has no underline." : ""} Your original file is kept in Originals.`
                  : "Your words and supported emphasis become an editable script. Proscenium’s script format determines page layout. Your original file is kept in Originals."}
              </p>
              {doc.notices.length > 0 && (
                <ul>
                  {doc.notices.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
            </details>
            <div className="import-desk__tools">
              <input
                className="field"
                aria-label="Find text in import"
                placeholder="Find a line…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
              />
              {!asDocument && (
                <span className="import-desk__reviewfilter">
                  <Checkbox
                    on={reviewOnly}
                    onChange={(v) => {
                      setReviewOnly(v);
                      setPage(0);
                    }}
                    label="Inferred or Unrecognized Only"
                  />
                  <span>Inferred or Unrecognized Only</span>
                </span>
              )}
              {!asDocument && (
                <PopupButton
                  label="Unstyled text"
                  value={reading}
                  disabled={saving}
                  options={[
                    { value: "detect", label: "Recognize Script Elements" },
                    { value: "directions", label: "Keep as Stage Directions" },
                  ]}
                  onChange={setReading}
                />
              )}
            </div>
            <div className="import-desk__review">
              <section className="import-desk__preview" aria-label="Paragraph preview">
                <div className="import-desk__previewhead">
                  <h3>Reading preview</h3>
                  <span>
                    {asDocument
                      ? "How each paragraph will read in the document."
                      : "Choose a paragraph to adjust its element."}
                  </span>
                </div>
                <div className="import-desk__lines">
                  {shown.length ? (
                    shown.map(({ line, index }) => (
                      <button
                        type="button"
                        key={index}
                        className={`import-desk__line${selected === index ? " is-selected" : ""}`}
                        aria-pressed={selected === index}
                        aria-label={`Paragraph ${index + 1}, ${asDocument ? documentLabel(line) : `${ELEMENTS.find((e) => e.value === line.kind)?.label ?? line.kind}${line.review ? ", inferred or unrecognized" : ""}`}: ${paragraphText(line)}`}
                        onClick={() => setSelected(index)}
                      >
                        <span className="import-desk__number">{index + 1}</span>
                        <span className={`import-desk__words import-desk__words--${line.kind}`}>
                          <Text content={line.content} />
                          {line.kind === "pageBreak" && "Page break"}
                        </span>
                        <span className="import-desk__kind">
                          {asDocument
                            ? documentLabel(line)
                            : `${line.review ? "? " : ""}${ELEMENTS.find((e) => e.value === line.kind)?.label ?? line.kind}`}
                        </span>
                      </button>
                    ))
                  ) : (
                    <p className="import-desk__empty">
                      {search
                        ? "No paragraphs match that text."
                        : "No inferred or unrecognized paragraphs remain."}
                    </p>
                  )}
                </div>
                <div className="import-desk__pagination">
                  <Button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
                    Previous
                  </Button>
                  <span>
                    {filtered.length
                      ? `${currentPage * PAGE_SIZE + 1}–${Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)} of ${filtered.length}`
                      : "0 paragraphs"}
                  </span>
                  <Button
                    disabled={currentPage >= lastPage}
                    onClick={() => setPage(currentPage + 1)}
                  >
                    Next
                  </Button>
                </div>
              </section>
              <aside className="import-desk__adjust" aria-label="Adjust paragraph">
                {active && asDocument && (
                  <>
                    <h3>Paragraph {selected + 1}</h3>
                    <p className="import-desk__reason">{documentLabel(active)}</p>
                    <p className="import-desk__excerpt">
                      <Text content={active.content} />
                    </p>
                    <p className="import-desk__hint">Source style: {active.style}</p>
                    <p className="import-desk__hint">
                      A document keeps its words as written. Change a heading or anything else once
                      it is in the binder.
                    </p>
                  </>
                )}
                {active && !asDocument && (
                  <>
                    <h3>Paragraph {selected + 1}</h3>
                    <p className="import-desk__reason">{active.reason}</p>
                    <p className="import-desk__excerpt">
                      <Text content={active.content} />
                    </p>
                    <PopupButton
                      label="Element"
                      value={active.kind}
                      options={ELEMENTS}
                      onChange={correct}
                      disabled={saving}
                    />
                    <p className="import-desk__hint">Source style: {active.style}</p>
                    <Button
                      disabled={saving}
                      onClick={() => {
                        setCorrections((c) => ({
                          ...c,
                          styles: { ...c.styles, [active.style]: active.kind },
                        }));
                        announce(
                          `The ${active.style} style now imports as ${active.kind}. Individual corrections take priority.`,
                        );
                      }}
                    >
                      Use for This Source Style
                    </Button>
                    <p className="import-desk__hint">
                      Applies to {sourceStyleCount}{" "}
                      {sourceStyleCount === 1 ? "paragraph" : "paragraphs"}. Individual corrections
                      take priority.
                    </p>
                    <Button
                      disabled={
                        saving ||
                        (!Object.keys(corrections.lines).length &&
                          !Object.keys(corrections.styles).length)
                      }
                      treatment="borderless"
                      onClick={() => {
                        setCorrections(EMPTY_CORRECTIONS);
                        announce("Import corrections reset.");
                      }}
                    >
                      Reset All Corrections
                    </Button>
                  </>
                )}
              </aside>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}
