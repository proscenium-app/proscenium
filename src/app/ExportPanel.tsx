// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { CLOSED_EXPORT, publishExportFacts, tutorialActions } from "../tutorial/events";

/**
 * Export PDF and Print — choose what goes out, and see exactly that first.
 *
 * The preview is not a second renderer. It draws the layout engine's own
 * `LayoutPage`s and `FrontMatterPage`s — the same objects `src/pdf/render.ts`
 * puts on paper, at the same rows and columns — so a page that looks right here
 * cannot come out of the file looking different. Geometry comes from the
 * format's CSS variables (`formatCssVars`), positions from the engine (`row`,
 * `xIn`), emphasis from the shared style split (`styleSegments`). Nothing about
 * layout is decided in this file, which is why it can live outside the format
 * system without lying about it.
 *
 * **The preview shows the file and nothing else**, because a preview is only
 * worth checking if it is what goes out. It used to scroll every page
 * with the left-out ones greyed, so a range of 12–20 still meant scrolling past
 * eleven pages that were not going, while the title and cast sheets that WERE
 * going never showed at all. The pane draws `plan.chosen` — the ticked front
 * sheets, then the pages in the range, in file order. The rail stays the map
 * of everything that could go, each sheet with its tick.
 *
 * Selection has one model with two faces: the range field is the truth, and
 * ticking a page rewrites the field. Page numbers are the PRINTED ones — an
 * excerpt keeps the numbering the reader sees. The unnumbered front sheets
 * have no number to name, so each kind has a tick of its own — title page,
 * cast page, setting page — on any export, sides included.
 *
 * Export and Print are one dialog with two ways out: the same
 * pages and the same bytes, handed to a save panel or to the print panel. The
 * menu item that opened it decides only the title and the default button.
 *
 * The export can also be a .docx or an .odt for a word processor
 * (docs/app/formatting/formats-and-layout.md#FMT-145): the same choices, the
 * same preview of the words, and a word processor's own page breaks, which the
 * dialog says can differ from what it shows. Print is always the PDF.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { formatCssVars, inchesToCh, pageSizeIn, type FormatSpec } from "../format";
import type { FrontMatterLine, FrontMatterPage, LayoutPage, LayoutResult } from "../layout";
import {
  FRONT_SHEET_LABEL,
  defaultFrontSheets,
  formatPageRange,
  frontKindsOf,
  pagerText,
  parsePageRange,
  planSheets,
  resolveFocus,
  styleSegments,
  type FrontSheet,
  type PlannedSheet,
} from "../pdf/plan";
import { sheetList, sheetsNaming } from "../pdf/anonymous";
import { measurePxPerInch } from "./use-zoom";
import { Button, Checkbox, PopupButton, Sheet } from "../ui";
import { useAnnouncedStatus } from "../ui/use-announced-status";
import { canonicalLanguage, languageHelp as describeLanguage } from "../workspace/language";
import type { ExportFileType } from "../storage/ipc";

/** File ▸ Export PDF… or File ▸ Print… — the one dialog does both. */
export type ExportAction = "export" | "print";

/** How each file type is named where the writer chooses it: by extension, but PDF. */
export const EXPORT_TYPE_LABEL: Record<ExportFileType, string> = {
  pdf: "PDF",
  docx: ".docx",
  odt: ".odt",
};

/** Said beside the buttons, and announced, when the file is for a word processor. */
export const WORD_PROCESSOR_HINT =
  "A word processor sets its own page breaks, so they can differ from this preview.";

export interface ExportPanelProps {
  scriptTitle: string;
  spec: FormatSpec;
  /** The whole play (or the whole part), paginated — the export filters this, never re-flows it. */
  layout: LayoutResult;
  /** Every unnumbered sheet the play has to put before page 1, as the engine lays them out. */
  frontPages: FrontMatterPage[];
  /** The front sheets the writer chose; null until they choose, which follows the default. */
  frontChoice: FrontSheet[] | null;
  onFrontChoice: (kinds: FrontSheet[]) => void;
  /** Speakers who can have sides, heaviest part first. */
  characters: string[];
  /** Non-null when the layout is one character's sides rather than the play. */
  sidesFor: string | null;
  onSidesFor: (name: string | null) => void;
  /** An anonymous copy: no name or contact details (docs/app/formatting/formats-and-layout.md#FMT-143). */
  anonymous: boolean;
  onAnonymous: (on: boolean) => void;
  /** The writer's name and contact lines, looked for on every sheet an anonymous copy holds. */
  identity: readonly string[];
  /** The file an export writes: a PDF, or a .docx or .odt. Print is always the PDF. */
  fileType: ExportFileType;
  onFileType: (type: ExportFileType) => void;
  /** Which menu item opened the dialog: its title, and its default button. */
  action: ExportAction;
  /** The way out already under way, if one is: its button says so, and neither can be pressed. */
  busy: ExportAction | null;
  language: string;
  languageError: string | null;
  onExport: (opts: {
    pages: number[] | null;
    front: FrontSheet[];
    language: string;
    action: ExportAction;
  }) => void;
  onClose: () => void;
}

/** Thumbnail width in the page rail. Chrome, not layout — the sheet inside is
 * scaled to it, so the format still owns every proportion. */
const THUMB_PX = 116;
/** Breathing room kept around the big preview sheet inside its pane. */
const PANE_GUTTER_PX = 24;
/** How far past a scroller's bottom edge a page is built anyway, so scrolling
 * reveals finished pages rather than pages filling in. */
const RAIL_LOOKAHEAD_PX = 500;

/**
 * Where each child of a scroller starts, in the scroller's own scroll
 * coordinates. From boxes rather than `offsetTop`, whose origin is whichever
 * ancestor happens to be positioned — the preview pane is, the rail is not, and
 * subtracting the scroller's own `offsetTop` was only right for one of them.
 */
function childTops(el: HTMLElement): number[] {
  const origin = el.getBoundingClientRect().top + el.clientTop - el.scrollTop;
  return [...el.children].map((child) => child.getBoundingClientRect().top - origin);
}

export function ExportPanel(props: ExportPanelProps) {
  const { layout, spec, frontPages, onFrontChoice } = props;
  const total = layout.pages.length;
  const printing = props.action === "print";

  const [range, setRange] = useState("");
  const [language, setLanguage] = useState(props.language);
  const languageCode = canonicalLanguage(language);
  const languageHelp =
    props.languageError ??
    (!languageCode ? "Enter a language code, such as en-US or fr." : describeLanguage(language));
  useAnnouncedStatus(!languageCode || props.languageError ? languageHelp : null);

  const selection = useMemo(() => parsePageRange(range, total), [range, total]);

  /* Each kind of front sheet the play has, ticked by the writer — or, until
     they tick one, by the default, which follows the selection: an excerpt
     that starts past page 1 usually travels without the title page. */
  const available = useMemo(() => frontKindsOf(frontPages), [frontPages]);
  const startsAtPageOne = selection.all || selection.pages.includes(1);
  const frontKinds = useMemo(
    () =>
      (
        props.frontChoice ??
        defaultFrontSheets(available, { sides: !!props.sidesFor, startsAtPageOne })
      ).filter((kind) => available.includes(kind)),
    [props.frontChoice, available, props.sidesFor, startsAtPageOne],
  );

  const plan = useMemo(
    () =>
      planSheets({
        front: frontPages,
        layout,
        frontKinds,
        pages: selection.error ? null : selection.pages,
      }),
    [frontPages, layout, frontKinds, selection],
  );
  const going = useMemo(() => new Set(plan.chosen.map((sheet) => sheet.key)), [plan]);

  /* Words the writer typed into the play can still name them — a dedication,
     a note, a header a custom format prints. The copy can't know which words
     to cut, so it says where they are (docs/app/formatting/formats-and-layout.md#FMT-144). */
  const naming = useMemo(
    () => (props.anonymous ? sheetsNaming(plan.chosen, props.identity) : []),
    [props.anonymous, plan.chosen, props.identity],
  );
  const anonymousHelp = !props.anonymous
    ? "For a blind reading: no name or contact details."
    : naming.length
      ? `Your name or contact details are still on ${sheetList(naming)}.`
      : "No name or contact details on any page, or in the file.";
  useAnnouncedStatus(props.anonymous && naming.length ? anonymousHelp : null);

  useEffect(() => {
    publishExportFacts({
      open: true,
      range: !!range.trim() && !selection.error,
      rangeError: !!range.trim() && !!selection.error,
      opening: props.frontChoice !== null,
      preview: plan.chosen.length > 0,
    });
  }, [range, selection.error, props.frontChoice, plan.chosen.length]);
  useEffect(() => () => publishExportFacts(CLOSED_EXPORT), []);
  useEffect(() => {
    tutorialActions.set("export-range", () => setRange("1"));
    tutorialActions.set("export-opening", () =>
      onFrontChoice(
        frontKinds.includes("title")
          ? frontKinds.filter((k) => k !== "title")
          : [...frontKinds, "title"],
      ),
    );
    tutorialActions.set("export-preview", () => {});
    return () => {
      for (const id of ["export-range", "export-opening", "export-preview"])
        tutorialActions.delete(id);
    };
  }, [onFrontChoice, frontKinds]);

  /**
   * The sheet being read, by key, so it survives the set changing around it:
   * untick a page above it and it stays in view. `jump` counts DELIBERATE
   * moves — a thumbnail, ◀ ▶, a sheet just ticked on, a new range — and only a
   * change of it scrolls the pane to the sheet. Scrolling the pane moves the
   * key without one, so the two directions can't fight.
   */
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [jump, setJump] = useState(0);
  const focused = resolveFocus(plan, focusedKey);
  const focusedSheet = plan.chosen[focused] ?? null;
  const goTo = useCallback((key: string | null) => {
    setFocusedKey(key);
    setJump((n) => n + 1);
  }, []);
  // When the sheet being read leaves the file, the one shown in its place is
  // the one being read now.
  useEffect(() => {
    if (focusedSheet && focusedSheet.key !== focusedKey) setFocusedKey(focusedSheet.key);
  }, [focusedSheet, focusedKey]);

  /** A new range reads from its start. */
  const editRange = useCallback(
    (text: string) => {
      setRange(text);
      goTo(null);
    },
    [goTo],
  );

  const togglePage = useCallback(
    (pageNumber: number) => {
      const next = new Set(selection.error ? [] : selection.pages);
      const adding = !next.has(pageNumber);
      if (adding) next.add(pageNumber);
      else next.delete(pageNumber);
      setRange(formatPageRange([...next], total));
      // Ticked on: show it. Ticked off: stay where you were.
      if (adding) goTo(`page-${pageNumber}`);
    },
    [selection, total, goTo],
  );

  const toggleFront = useCallback(
    (kind: FrontSheet) => {
      const adding = !frontKinds.includes(kind);
      onFrontChoice(available.filter((k) => (k === kind ? adding : frontKinds.includes(k))));
      const first = plan.all.find((sheet) => sheet.kind === "front" && sheet.front.kind === kind);
      if (adding && first) goTo(first.key);
    },
    [frontKinds, available, onFrontChoice, plan, goTo],
  );

  /** A left-out sheet can't be shown — the preview only has the file — so say so. */
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => setNote(null), [plan, focused]);
  const lookAt = useCallback(
    (sheet: PlannedSheet) => {
      if (going.has(sheet.key)) {
        setNote(null);
        goTo(sheet.key);
      } else {
        setNote(`${sheet.label} is left out — tick its box to include it.`);
      }
    },
    [going, goTo],
  );

  const onScrolledTo = useCallback(
    (i: number) => setFocusedKey(plan.chosen[i]?.key ?? null),
    [plan],
  );
  const onGoTo = useCallback((i: number) => goTo(plan.chosen[i]?.key ?? null), [plan, goTo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.onClose]);

  const canExport = !!languageCode && !selection.error && selection.pages.length > 0 && !props.busy;
  const send = (action: ExportAction) =>
    props.onExport({
      pages: selection.all ? null : selection.pages,
      front: frontKinds,
      language: languageCode!,
      action,
    });

  /**
   * A ninety-page play is ninety sheets of absolutely-positioned text, and
   * building them all to show eight would make the dialog open with a stall.
   * So the rail builds up to a high-water mark and raises it as you scroll —
   * pages already passed stay built (no thrash), pages never reached are never
   * paid for.
   *
   * Driven by the scroll event rather than an IntersectionObserver on purpose:
   * observers deliver in the frame lifecycle, which is silent in a backgrounded
   * window — the same reason use-zoom.ts keeps a plain resize listener beside
   * its ResizeObserver. A scroll handler works with or without a frame loop,
   * and can actually be verified.
   */
  const rail = useRef<HTMLDivElement | null>(null);
  const [builtThrough, setBuiltThrough] = useState(7);
  const raiseMark = useCallback(() => {
    const el = rail.current;
    if (!el) return;
    const limit = el.scrollTop + el.clientHeight + RAIL_LOOKAHEAD_PX;
    const last = childTops(el).filter((top) => top <= limit).length;
    setBuiltThrough((prev) => Math.max(prev, last));
  }, []);
  // Once after mount (a tall window shows more than the initial eight), and
  // whenever the rail scrolls.
  useLayoutEffect(raiseMark, [raiseMark]);

  /* Keep the focused thumbnail in the rail's view as the preview is scrolled —
     the rail is the map, so it should follow where you are. Nudged only when
     the thumb is actually outside the band, so it never fights a writer who is
     scrolling the rail itself. */
  const railIndex = focusedSheet ? plan.all.findIndex((s) => s.key === focusedSheet.key) : -1;
  useLayoutEffect(() => {
    const el = rail.current;
    const thumb = el?.children[railIndex] as HTMLElement | undefined;
    if (!el || !thumb) return;
    const top = childTops(el)[railIndex];
    const bottom = top + thumb.offsetHeight;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (bottom > el.scrollTop + el.clientHeight) {
      el.scrollTop = bottom - el.clientHeight;
    }
  }, [railIndex]);

  // An empty script says so once, below — not twice.
  const summary =
    total === 0
      ? ""
      : selection.error
        ? selection.error
        : selection.all
          ? `${props.sidesFor ? "The whole part" : "The whole script"} — ${total} ${
              total === 1 ? "page" : "pages"
            }`
          : `${selection.pages.length} of ${total} pages`;

  useAnnouncedStatus(summary || null);
  // Changing the file type changes the hint beside the buttons, away from
  // focus. Opened on a .docx or .odt, the title already says so, and the
  // summary is what is announced.
  const forWordProcessor = props.fileType !== "pdf";
  const openedOn = useRef(props.fileType);
  useAnnouncedStatus(
    forWordProcessor && props.fileType !== openedOn.current ? WORD_PROCESSOR_HINT : null,
  );
  const typeLabel = EXPORT_TYPE_LABEL[props.fileType];

  const exportButton = (
    <Button
      key="export"
      treatment={printing ? "default" : "primary"}
      disabled={!canExport}
      onClick={() => send("export")}
    >
      {props.busy === "export" ? "Exporting…" : `Export ${typeLabel}…`}
    </Button>
  );
  const printButton = (
    <Button
      key="print"
      treatment={printing ? "primary" : "default"}
      disabled={!canExport}
      onClick={() => send("print")}
    >
      {props.busy === "print" ? "Preparing…" : "Print…"}
    </Button>
  );

  return (
    <Sheet
      title={printing ? "Print" : `Export ${typeLabel}`}
      subtitle={props.scriptTitle}
      width={960}
      height={640}
      onClose={props.onClose}
      /* Part and Pages live on the HEADING row so the body is nothing but
         pages — the thing the sheet exists to let you look at. */
      head={
        <>
          <span className="sheet__spacer" />
          <label className="exportpanel__rangefield exportpanel__typefield">
            <span>File type</span>
            <PopupButton
              label="File type — what the export writes"
              menuWidth={220}
              value={props.fileType}
              disabled={!!props.busy}
              onChange={props.onFileType}
              options={[
                { value: "pdf", label: EXPORT_TYPE_LABEL.pdf },
                { value: "docx", label: EXPORT_TYPE_LABEL.docx, section: "For a word processor" },
                { value: "odt", label: EXPORT_TYPE_LABEL.odt, section: "For a word processor" },
              ]}
            />
          </label>
          {props.characters.length > 0 && (
            <label className="exportpanel__rangefield exportpanel__partfield">
              <span>Part</span>
              <PopupButton
                label={`Part — what to ${printing ? "print" : "export"}`}
                menuWidth={240}
                value={props.sidesFor ?? ""}
                onChange={(v) => props.onSidesFor(v || null)}
                options={[
                  { value: "", label: "Whole Script" },
                  /* Heaviest part first — the order a programme prints. */
                  ...props.characters.map((name) => ({
                    value: name,
                    label: name,
                    section: "Sides — heaviest part first",
                  })),
                ]}
              />
            </label>
          )}
          <label className="exportpanel__rangefield">
            <span>Pages</span>
            <input
              data-tutorial="export-range"
              className="field mono"
              value={range}
              autoFocus
              placeholder="All pages"
              aria-label={`Pages to ${printing ? "print" : "export"}`}
              aria-invalid={!!selection.error}
              aria-describedby="export-range-status"
              onChange={(e) => editRange(e.target.value)}
            />
          </label>
          <span
            className={`exportpanel__summary${selection.error && total > 0 ? " is-error" : ""}`}
            id="export-range-status"
          >
            {summary}
          </span>
          {!selection.all && !selection.error && (
            <Button
              size="small"
              treatment="borderless"
              className="exportpanel__all"
              onClick={() => editRange("")}
            >
              All Pages
            </Button>
          )}
        </>
      }
      footer={
        <>
          <div className="exportpanel__options">
            {available.length > 0 ? (
              /* Any export can carry them — a cover and a cast list in front
                 of an excerpt, or of an actor's sides. */
              <div
                className="exportpanel__front"
                data-tutorial="export-opening"
                role="group"
                aria-labelledby="export-front-label"
              >
                <span className="exportpanel__optlabel" id="export-front-label">
                  Include
                </span>
                {available.map((kind) => {
                  const sheets = frontPages.filter((page) => page.kind === kind).length;
                  return (
                    <label className="exportpanel__check" key={kind}>
                      <Checkbox
                        on={frontKinds.includes(kind)}
                        label={FRONT_SHEET_LABEL[kind]}
                        onChange={() => toggleFront(kind)}
                      />
                      <span>
                        {FRONT_SHEET_LABEL[kind]}
                        {sheets > 1 && (
                          <span className="exportpanel__hint"> ({sheets} sheets)</span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <span className="sheet__hint">
                No title page yet — add one from the document menu.
              </span>
            )}
            <div className="exportpanel__anonymous">
              <label className="exportpanel__check">
                <Checkbox
                  on={props.anonymous}
                  label="Anonymous copy"
                  describedBy="export-anonymous-help"
                  disabled={!!props.busy}
                  onChange={props.onAnonymous}
                />
                <span>Anonymous copy</span>
              </label>
              <span
                className={`sheet__hint${naming.length ? " is-warning" : ""}`}
                id="export-anonymous-help"
              >
                {anonymousHelp}
              </span>
            </div>
            <label className="exportpanel__language">
              <span>Language</span>
              <input
                className="field mono"
                aria-label="Play language"
                value={language}
                aria-invalid={!languageCode}
                aria-describedby="export-language-help"
                disabled={!!props.busy}
                maxLength={100}
                onChange={(e) => setLanguage(e.target.value)}
              />
              <span className="sheet__hint" id="export-language-help">
                {languageHelp}
              </span>
            </label>
          </div>
          <span className="sheet__spacer" />
          {/* One hint, beside the buttons, so sides don't cost the preview a
              row: what sides hold, and whose page numbers these are. */}
          <span className="sheet__hint exportpanel__foothint">
            {forWordProcessor
              ? WORD_PROCESSOR_HINT
              : props.sidesFor
                ? `${props.sidesFor}'s speeches, each after the line that cues it (in italics), and the scene headings. Sides number their own pages.`
                : "Pages keep their own numbers — 7–10 prints as 7–10."}
          </span>
          <Button onClick={props.onClose}>Cancel</Button>
          {/* The way out the writer asked for is the default, at the end. */}
          {printing ? exportButton : printButton}
          {printing ? printButton : exportButton}
        </>
      }
    >
      {total === 0 ? (
        <p className="exportpanel__none">This script has no pages yet — write a line first.</p>
      ) : (
        <div className="exportpanel__body">
          {/* A list of sheets, each a button to look at it and a box to
              include it. It was a `listbox` of `option`s with checkboxes
              inside, which a listbox may not hold, so VoiceOver read the
              rail as options and lost the one control that changes the file. */}
          <div
            className="exportpanel__rail"
            role="list"
            aria-label="Pages"
            ref={rail}
            onScroll={raiseMark}
          >
            {plan.all.map((sheet, i) => (
              <PageThumb
                key={sheet.key}
                sheet={sheet}
                spec={spec}
                built={i <= builtThrough}
                included={going.has(sheet.key)}
                focused={sheet.key === focusedSheet?.key}
                onFocus={() => lookAt(sheet)}
                onToggle={() =>
                  sheet.kind === "front"
                    ? toggleFront(sheet.front.kind)
                    : togglePage(sheet.page.pageNumber)
                }
              />
            ))}
          </div>
          <PreviewScroller
            sheets={plan.chosen}
            spec={spec}
            focused={focused}
            jump={jump}
            note={note}
            empty={`Nothing to ${printing ? "print" : "export"} until the page range above can be read.`}
            label={printing ? "Preview of what will print" : "Preview of what will export"}
            onScrolledTo={onScrolledTo}
            onGoTo={onGoTo}
          />
        </div>
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* Preview sheets                                                       */
/* ------------------------------------------------------------------ */

/**
 * The big pane: every sheet the file will hold, stacked and scrollable —
 * a word processor's print preview, where an export is checked by scrolling
 * through its pages, showing only what is going.
 *
 * The scale still fits a WHOLE page in the pane, so a page break lands where the
 * eye expects it and scrolling moves you page by page rather than through an
 * endless column — Word's "One Page" preview, with the scroll it always had.
 *
 * Two directions, one `focused`:
 * - Scrolling here reports the sheet under the middle of the pane, which moves
 *   the counter and the rail's highlight.
 * - A deliberate move (`jump`) scrolls the pane to the focused sheet, and so
 *   does the set of sheets changing, which keeps the sheet being read in view
 *   when a page above it is left out. A scroll-driven focus change does
 *   neither, so the two can't start a fight.
 *
 * Building is lazy the same way the rail's is, and driven by the scroll event
 * for the same reason: an IntersectionObserver delivers in the frame lifecycle,
 * which is silent in a backgrounded window (use-zoom.ts docs/app/preferences-and-help/tutorials.md#TUT-D6).
 */
function PreviewScroller(props: {
  sheets: PlannedSheet[];
  spec: FormatSpec;
  focused: number;
  jump: number;
  note: string | null;
  /** Said in the pane when nothing is going — which only a range that can't be read does. */
  empty: string;
  label: string;
  onScrolledTo: (i: number) => void;
  onGoTo: (i: number) => void;
}) {
  const { sheets, spec, focused, jump, onScrolledTo, onGoTo } = props;
  const pane = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.5);
  const [builtThrough, setBuiltThrough] = useState(2);
  const { widthIn, heightIn } = pageSizeIn(spec);

  const solve = useCallback(() => {
    const el = pane.current;
    if (!el) return;
    const pxPerIn = measurePxPerInch();
    const byWidth = (el.clientWidth - PANE_GUTTER_PX * 2) / (widthIn * pxPerIn);
    const byHeight = (el.clientHeight - PANE_GUTTER_PX * 2) / (heightIn * pxPerIn);
    const next = Math.min(byWidth, byHeight);
    if (next > 0) setScale(Math.round(next * 100) / 100);
  }, [widthIn, heightIn]);

  // Belt and braces, as everywhere else the app solves for a box: the observer
  // covers cases nobody enumerated, the plain resize event works without a
  // frame loop (and is therefore testable).
  useLayoutEffect(() => {
    solve();
    const el = pane.current;
    if (!el) return;
    const ro = new ResizeObserver(solve);
    ro.observe(el);
    window.addEventListener("resize", solve);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", solve);
    };
  }, [solve]);

  /** The sheet's top at the top of the pane, instantly (no smooth scroll: see export.css). */
  const show = useCallback((i: number) => {
    const el = pane.current;
    if (!el || i < 0 || i >= el.children.length) return;
    el.scrollTop = childTops(el)[i] - PANE_GUTTER_PX / 2;
  }, []);

  // Declared before the scroll reading below, so it reads where these left it.
  const keys = sheets.map((sheet) => sheet.key).join(" ");
  useLayoutEffect(() => show(focused), [keys, scale]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (jump) show(focused);
  }, [jump]); // eslint-disable-line react-hooks/exhaustive-deps

  const onScroll = useCallback(() => {
    const el = pane.current;
    if (!el || !sheets.length) return;
    const tops = childTops(el);
    const limit = el.scrollTop + el.clientHeight + RAIL_LOOKAHEAD_PX;
    const last = tops.filter((top) => top <= limit).length;
    setBuiltThrough((prev) => Math.max(prev, last));
    // The sheet under the middle of the pane is the one you're reading.
    const mid = el.scrollTop + el.clientHeight / 2;
    let at = 0;
    tops.forEach((top, i) => {
      if (top <= mid) at = i;
    });
    // Only on a real change, which is also what stops a jump from looping: after
    // a programmatic scroll the computed sheet already IS the focused one.
    if (at !== focused) onScrolledTo(at);
  }, [focused, onScrolledTo, sheets.length]);

  useLayoutEffect(onScroll, [onScroll, scale, keys]);

  return (
    <div className="exportpanel__preview" data-tutorial="export-preview">
      {/* Focusable, so the arrows and Space scroll the preview without a
          pointer — a scroller nothing inside can take focus is a scroller a
          keyboard cannot move (WCAG 2.1.1). */}
      <div
        className="exportpanel__pane"
        ref={pane}
        onScroll={onScroll}
        tabIndex={0}
        role="region"
        aria-label={props.label}
      >
        {sheets.map((sheet, i) => (
          <div className="exportpanel__previewpage" key={sheet.key} data-sheet={sheet.key}>
            {i <= builtThrough ? (
              <SheetPreview sheet={sheet} spec={spec} scale={scale} />
            ) : (
              <BlankSheet spec={spec} scale={scale} />
            )}
          </div>
        ))}
        {!sheets.length && <p className="exportpanel__empty">{props.empty}</p>}
      </div>
      {/* Where you are, and one sheet either way — the print-preview convention. */}
      <div className="exportpanel__pagerbar">
        <button
          className="exportpanel__pagerbtn"
          onClick={() => onGoTo(Math.max(0, focused - 1))}
          disabled={focused <= 0}
          aria-label="Previous page"
        >
          ◀
        </button>
        <span className={`exportpanel__pagernow${props.note ? " is-note" : ""}`} aria-live="polite">
          {props.note ?? pagerText(sheets, focused)}
        </span>
        <button
          className="exportpanel__pagerbtn"
          onClick={() => onGoTo(Math.min(sheets.length - 1, focused + 1))}
          disabled={focused < 0 || focused >= sheets.length - 1}
          aria-label="Next page"
        >
          ▶
        </button>
      </div>
    </div>
  );
}

/** One sheet in the rail: a small page, its name, and its tick. An unbuilt
 * thumbnail still holds a full-size blank sheet, so the rail's scroll height is
 * right from the first frame and nothing jumps as pages fill in. */
function PageThumb(props: {
  sheet: PlannedSheet;
  spec: FormatSpec;
  built: boolean;
  included: boolean;
  focused: boolean;
  onFocus: () => void;
  onToggle: () => void;
}) {
  const { sheet } = props;
  const { widthIn } = pageSizeIn(props.spec);
  const scale = useMemo(() => THUMB_PX / (widthIn * measurePxPerInch()), [widthIn]);
  // "Include page 12", "Include title page".
  const includeLabel = `Include ${sheet.label.charAt(0).toLowerCase()}${sheet.label.slice(1)}`;

  return (
    <div
      role="listitem"
      data-sheet={sheet.key}
      className={`exportpanel__thumb${props.focused ? " is-focused" : ""}${
        props.included ? "" : " is-excluded"
      }`}
    >
      <button
        type="button"
        className="exportpanel__thumbsheet"
        aria-current={props.focused ? "true" : undefined}
        aria-label={sheet.label}
        onClick={props.onFocus}
      >
        {props.built ? (
          <SheetPreview sheet={sheet} spec={props.spec} scale={scale} />
        ) : (
          <BlankSheet spec={props.spec} scale={scale} />
        )}
      </button>
      <label className="exportpanel__thumbfoot">
        <input
          type="checkbox"
          checked={props.included}
          aria-label={includeLabel}
          onChange={props.onToggle}
        />
        <span>{sheet.short}</span>
      </label>
    </div>
  );
}

/** Whichever kind of sheet this is, drawn. */
function SheetPreview(props: { sheet: PlannedSheet; spec: FormatSpec; scale: number }) {
  const { sheet } = props;
  return sheet.kind === "front" ? (
    <FrontPreviewPage page={sheet.front} spec={props.spec} scale={props.scale} />
  ) : (
    <PreviewPage page={sheet.page} spec={props.spec} scale={props.scale} />
  );
}

/** Scaled paper. The wrapper reserves the scaled box so the flow is honest;
 * the sheet itself is drawn at full size and transformed, which keeps every
 * inch inside it exactly the format's inch. */
export function sheetStyle(spec: FormatSpec, scale: number): React.CSSProperties {
  return {
    ...formatCssVars(spec),
    ["--prev-scale" as string]: `${scale}`,
    // From the spec, like everything else on this page: the type is the
    // format's type, at the format's size.
    ["--prev-font" as string]: spec.type.family,
    ["--prev-size" as string]: `${spec.type.size}pt`,
  } as React.CSSProperties;
}

/** A sheet not built yet: the right size, so scrolling never jumps as pages fill in. */
export function BlankSheet(props: { spec: FormatSpec; scale: number }) {
  return (
    <div className="exportpanel__sheet" style={sheetStyle(props.spec, props.scale)}>
      <div className="exportpanel__paper" />
    </div>
  );
}

/** A header or footer: three slots across the text block, as the PDF draws them. */
function MarginSlots(props: { slots: NonNullable<LayoutPage["header"]>; className: string }) {
  const { slots } = props;
  return (
    <div className={props.className}>
      {slots.left && <span className="exportpanel__hleft">{slots.left}</span>}
      {slots.center && <span className="exportpanel__hcenter">{slots.center}</span>}
      {slots.right && <span className="exportpanel__hright">{slots.right}</span>}
    </div>
  );
}

/**
 * Front-matter lines at the shared engine's positions, on a separate sheet
 * or above a sketch's dialogue on its numbered opening page.
 */
function FrontLines({ lines, spec }: { lines: FrontMatterLine[]; spec: FormatSpec }) {
  return (
    <>
      {lines.map((line, i) =>
        line.text ? (
          <span
            key={i}
            className="exportpanel__line"
            style={{
              top: `calc(${line.row} * var(--fmt-line))`,
              left: `${inchesToCh(spec, line.xIn)}ch`,
              fontWeight:
                line.fontStyle === "bold" || line.fontStyle === "bold-italic" ? 700 : undefined,
              fontStyle:
                line.fontStyle === "italic" || line.fontStyle === "bold-italic"
                  ? "italic"
                  : undefined,
            }}
          >
            {styleSegments(line.text, line.runs ?? [], {
              bold: line.fontStyle === "bold" || line.fontStyle === "bold-italic",
              italic: line.fontStyle === "italic" || line.fontStyle === "bold-italic",
            }).map((seg, j) => (
              <span
                key={j}
                style={{
                  fontWeight: seg.bold ? 700 : 400,
                  fontStyle: seg.italic ? "italic" : "normal",
                }}
              >
                {seg.text}
              </span>
            ))}
          </span>
        ) : null,
      )}
    </>
  );
}

function FrontPreviewPage(props: { page: FrontMatterPage; spec: FormatSpec; scale: number }) {
  const { page, spec } = props;
  return (
    <div className="exportpanel__sheet" style={sheetStyle(spec, props.scale)}>
      <div className="exportpanel__paper">
        <div className="exportpanel__block">
          <FrontLines lines={page.lines} spec={spec} />
        </div>
      </div>
    </div>
  );
}

/**
 * One of the engine's pages, drawn. THE page renderer outside the PDF: the
 * Export dialog and the format designer both draw pages with this, so neither
 * can show a page the other would draw differently.
 */
export function PreviewPage(props: {
  page: LayoutPage;
  spec: FormatSpec;
  scale: number;
  className?: string;
  /**
   * Extra class for one line — the designer marks the lines a change moved.
   * Decoration only: where a line sits still comes from the engine alone.
   */
  lineClassName?: (line: LayoutPage["lines"][number]) => string | undefined;
}) {
  const { page, spec } = props;
  return (
    <div
      className={`exportpanel__sheet ${props.className ?? ""}`}
      style={sheetStyle(spec, props.scale)}
    >
      <div className="exportpanel__paper">
        {page.header && <MarginSlots slots={page.header} className="exportpanel__header" />}
        {page.footer && <MarginSlots slots={page.footer} className="exportpanel__footer" />}
        <div className="exportpanel__block">
          <FrontLines lines={page.intro ?? []} spec={spec} />
          {page.lines.map((line, i) => {
            if (!line.text) return null;
            const el = spec.elements[line.type];
            const base = {
              bold: el.fontStyle === "bold" || el.fontStyle === "bold-italic",
              italic: el.fontStyle === "italic" || el.fontStyle === "bold-italic",
            };
            const extra = props.lineClassName?.(line);
            return (
              <span
                key={i}
                className={`exportpanel__line${extra ? ` ${extra}` : ""}`}
                style={{
                  top: `calc(${line.row} * var(--fmt-line))`,
                  left: `${inchesToCh(spec, line.xIn)}ch`,
                  letterSpacing: `${el.letterSpacing}em`,
                }}
              >
                {styleSegments(line.text, line.runs, base).map((seg, j) => (
                  <span
                    key={j}
                    style={{
                      fontWeight: seg.bold ? 700 : undefined,
                      fontStyle: seg.italic ? "italic" : undefined,
                      textDecoration: seg.underline ? "underline" : undefined,
                    }}
                  >
                    {seg.text}
                  </span>
                ))}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
