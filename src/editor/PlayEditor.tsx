// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The live editing surface (docs/app/writing/editor-ux.md#EDIT-D106). One surface:
 * the writer edits the structured document directly and the stage format is
 * applied by the schema's classes + the stylesheet GENERATED from the active
 * format spec (src/format/css.ts) — no layout constants live here. There is no
 * preview pane and no parse-on-keystroke — Fountain is only the on-disk
 * serialization. With the page view on, the Pagination extension draws the
 * layout engine's page breaks live.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Doc, FrontMatter } from "../fountain";
import { formatToCss, type FormatSpec } from "../format";
import type { LayoutMeta } from "../layout";
import { ElementEntry } from "./element-entry";
import { AutoDetect, EllipsisFloor } from "./input-rules";
import { AutoCaps, autoCapsKey } from "./auto-caps";
import { CastNames, namesInDirectionsOn } from "./names-in-directions";
import { useOrdinaryWords } from "./use-ordinary-words";
import { SpeechCues } from "./speech-cues";
import { CharacterAutocomplete } from "./character-autocomplete";
import { LeaderKey } from "./leader-key";
import { ElementBar, elementLabel } from "./ElementBar";
import { announce } from "../ui/announce";
import { pressed } from "../ui/keys";
import { useZoomAnchor } from "../ui/zoom-anchor";
import { Find } from "./find";
import { FindBar } from "./FindBar";
import { RunningTimeStrip } from "./RunningTimeStrip";
import { FirstRunCard } from "./FirstRunCard";
import { useVisibleScene } from "./caret-scene";
import type { ScenePageMap } from "../layout";
import type { SceneCard } from "../workspace";
import { PageBreakHandle } from "./page-break";
import { HorizontalRulePress } from "./horizontal-rule";
import { PendingSelection } from "../ui/pending-selection";
import { backPageList, frontPageList, namesOnPages } from "../layout";
import { EDIT_SIDE, Pagination, frontEditHost } from "./pagination";
import { measureLineShortfall } from "./line-shortfall";
import { Spellcheck } from "./spellcheck";
import { SpellMenu } from "./SpellMenu";
import { useSpeller } from "./use-speller";
import { DEFAULT_PLAY_LANGUAGE } from "../workspace/language";
import { editorExtensions } from "./schema";
import { Comments, CommentsMargin, type MarginState } from "../comments";
import { LiveRedline, setLiveRedline } from "./live-redline";
import { marginRuleCss } from "./redline-margin";
import { ensureNonEmpty, fromEditorDoc, toEditorDoc } from "./bridge";
import { CaretOnFocus } from "../ui/caret-on-focus";
import { FormatInput } from "../ui/format-input";
import { toggleEmphasis } from "./breaks";
import "./stage-format.css";

/** The lines whose sentences begin with a capital on a screen's keyboard. */
const SENTENCE_CAPS = new Set(["action", "dialogue"]);

export interface PlayEditorProps {
  tutorialActive?: boolean;
  /** Initial body document (from `parse().doc`). */
  initialDoc?: Doc | null;
  editable?: boolean;
  /** Fires on every document mutation with the current body doc. */
  onChange?: (doc: Doc) => void;
  /** Receives the editor instance once, for imperative ops (load/reload/flush). */
  onReady?: (editor: Editor) => void;
  /** ⌘S / Ctrl-S — a reassurance flush affordance (docs/app/keeping-work/storage-and-file-format.md#STOR-D10). */
  onSaveShortcut?: () => void;
  /** Cast names offered by character autocomplete (binder + open-doc cues). */
  cast?: string[];
  /** The active script format (per-play, from project.json settings). */
  format: FormatSpec;
  /** Page view on (engine-driven page breaks) vs continuous galley. */
  paginated: boolean;
  /** Title/author for header tokens ({title}, {author}). */
  layoutMeta: LayoutMeta;
  /** Current front matter — drives the unnumbered title sheet in page view. */
  frontMatter?: FrontMatter | null;
  /**
   * The editor for a page before the script, edited where it stands
   * (docs/app/formatting/formats-and-layout.md#FMT-165,
   * docs/app/formatting/formats-and-layout.md#FMT-169): given, one click on
   * any page before the script, the title page among them, edits it on the
   * page. `source` is the page's (`FrontMatterPage.source`), `at` the engine's
   * id of the paragraph clicked; `done` ends the editing. `bar` is the strip
   * at the top of the script, where the element bar stands, for the page's
   * formatting bar: on the desk with the app's other tools, not on the paper.
   * `retarget` names the page anew when its words move (a page the title page
   * printed, written as a file by its first edit), keeping the editor.
   */
  renderFrontPage?: (
    source: string,
    at: string | null,
    done: () => void,
    bar: HTMLElement | null,
    retarget: (source: string) => void,
  ) => ReactNode;
  /** The script on the page: another one ends the editing of a page before the script. */
  scriptKey?: string | null;
  /**
   * Edit this page before the script where it stands, as a click on it would
   * (a page just added from the gallery); a new object asks again.
   */
  openFrontPage?: { source: string; back?: boolean } | null;
  /**
   * Add Page, from the controls the page view draws beside the pages
   * (docs/app/formatting/formats-and-layout.md#FMT-175): before the script,
   * or after it.
   */
  onAddPage?: (side: "front" | "back") => void;
  /** Which page is being edited where it stands, by its source, or null: the binder lights its row. */
  onFrontEdit?: (source: string | null) => void;
  /**
   * A change drawn on the script (live-redline.ts): the text before it and
   * the text it left. A DECORATION layer, never the document: take it away
   * and nothing about the play has changed. Absent ⇒ none.
   */
  redline?: { before: string; after: string } | null;
  /**
   * Page zoom: a pure view transform on the rendered sheet — the
   * engine's geometry (and page breaks) are identical at every level.
   */
  zoom?: number;
  /** The Comments feed pane is open — the bar's chip reflects and toggles it. */
  commentsOpen?: boolean;
  onToggleComments?: () => void;
  /**
   * Show the comment feed: a comment is being made or answered and the margin
   * has no room for the card it would be typed in (docs/app/writing/comments.md#COMM-56).
   */
  onShowComments?: () => void;
  /** Underline misspellings (docs/app/writing/editor-ux.md#EDIT-D116). */
  spellcheck?: boolean;
  /**
   * Capitals as they are typed (Settings › Writing, docs/app/writing/editor-ux.md#EDIT-54):
   * cues and headings, and names in the directions where the format asks.
   */
  autoCaps?: boolean;
  language?: string;
  /** Words the writer has taught the checker, from app settings. */
  learnedWords?: string[];
  /** "Add to Dictionary" — the caller persists it. */
  onLearnWord?: (word: string) => void;
  /** The page map: scene cards and their page ranges. */
  cards?: SceneCard[];
  scenePages?: ScenePageMap;
  onJumpToScene?: (ordinal: number) => void;
  /** Settings ▸ Writing: whether the page map shows (docs/app/preferences-and-help/settings.md#SET-42). */
  showRunningTime?: boolean;
  /** Settings ▸ Writing: whether the strip marks the place in the scene (docs/app/preferences-and-help/settings.md#SET-45). */
  showScenePlace?: boolean;
}

/** Stable empty default, as below: a fresh [] each render would lay the page out again. */

/** Stable empty default: a fresh [] each render would re-check the script. */
const NO_WORDS: string[] = [];

/**
 * Says what the line at the caret IS, whenever that changes while the writer is
 * in the script — the element bar's word, out loud.
 *
 * The format is the page's whole meaning: a name centred in capitals is a cue,
 * and the same name flush left is an action. A sighted writer reads that off
 * the geometry; VoiceOver reads the words and nothing else, so "MARGARET" was
 * the same announcement whether Enter had made it a cue or Tab had just turned
 * it into dialogue. Now the kind follows the caret: moving onto a new line,
 * Tab through the ring, Enter's guess, ⌘⌥ and the `;` menu all say the new
 * kind once, after the line itself has been read. Typing inside a line never
 * speaks — the kind only changes when the line does.
 */
function useElementAnnouncer(editor: Editor | null) {
  useEffect(() => {
    if (!editor) return;
    let last = "";
    let timer = 0;
    const update = () => {
      const node = editor.state.selection.$from.parent;
      if (!node.isTextblock) return;
      const kind = node.type.name;
      if (kind === last) return;
      last = kind;
      if (!editor.isFocused) return;
      const label = elementLabel(kind);
      if (!label) return;
      // After the screen reader has read the line the caret landed on, and
      // coalesced, so arrowing through ten lines says one kind, not ten.
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        // A comment composer may have taken focus during this delay. Its
        // Save/Cancel result must not be replaced by stale caret speech.
        if (editor.view.hasFocus() && editor.state.selection.$from.parent.type.name === kind)
          announce(label);
      }, 250);
    };
    const onFocus = () => {
      last = "";
      update();
    };
    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    editor.on("focus", onFocus);
    return () => {
      window.clearTimeout(timer);
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
      editor.off("focus", onFocus);
    };
  }, [editor]);
}

export function PlayEditor({
  tutorialActive = false,
  initialDoc,
  editable = true,
  onChange,
  onReady,
  onSaveShortcut,
  cast,
  format,
  paginated,
  layoutMeta,
  frontMatter,
  renderFrontPage,
  openFrontPage,
  onAddPage,
  onFrontEdit,
  scriptKey,
  redline,
  zoom = 1,
  commentsOpen = false,
  onToggleComments,
  onShowComments,
  spellcheck = true,
  autoCaps = true,
  language = DEFAULT_PLAY_LANGUAGE,
  learnedWords = NO_WORDS,
  onLearnWord,
  cards,
  scenePages,
  onJumpToScene,
  showRunningTime = true,
  showScenePlace = true,
}: PlayEditorProps) {
  const editor = useEditor({
    extensions: [
      ...editorExtensions(),
      ElementEntry,
      AutoDetect,
      EllipsisFloor,
      AutoCaps,
      CastNames,
      SpeechCues,
      CharacterAutocomplete,
      LeaderKey,
      Pagination,
      PageBreakHandle,
      // A press on a horizontal line selects it (docs/app/writing/editor-ux.md#EDIT-213).
      HorizontalRulePress,
      // A click is never undone by an update arriving with it (docs/app/writing/editor-ux.md#EDIT-211).
      PendingSelection,
      Find,
      Comments,
      LiveRedline,
      Spellcheck,
      CaretOnFocus,
      // An iPad's ⌘B, ⌘I and ⌘U, and its screen keyboard's B, I and U, as the
      // script's own (docs/engineering/cross-platform.md#PLAT-76).
      FormatInput({
        bold: (ed) => toggleEmphasis(ed, "strong"),
        italic: (ed) => toggleEmphasis(ed, "em"),
        underline: (ed) => toggleEmphasis(ed, "underline"),
      }),
    ],
    // Line breaks cross the editor boundary as nodes (bridge.ts); the model
    // on either side keeps its literal newlines.
    content: toEditorDoc(ensureNonEmpty(initialDoc)),
    editable,
    // Only a change of the document is an edit. TipTap also says "update" when
    // the editor is made editable or read-only, with a transaction that
    // changes nothing: taken for an edit, every play marked its script
    // "Editing…" as it opened and saved the same bytes back, keeping a
    // version nobody made.
    onUpdate: ({ editor, transaction, appendedTransactions }) => {
      if (!transaction.docChanged && !appendedTransactions.some((tr) => tr.docChanged)) return;
      onChange?.(fromEditorDoc(editor.getJSON() as Doc));
    },
    editorProps: {
      // The OS check is OFF, and the app's own one (spellcheck.ts) replaces it.
      // Native squiggles were the first answer and could not be made to work:
      // WKWebView draws none at all unless the embedder flips a WebKit user
      // default, and even with them on, every character name and invented place
      // in the play is a typo — the OS has no way to know the cast. A checker
      // that reads the cast, respects the element types, and can be taught is
      // the feature a writer actually wanted. Autocorrect stays off, and so do
      // the system's capitals wherever the app's own auto-caps uppercases a
      // line, so nothing fights the auto-caps input rules. In action and
      // dialogue, which auto-caps leaves alone, a screen's keyboard begins
      // each sentence with a capital (`sentences`), as it does in every other
      // app: with the system's capitals off throughout, a writer on the glass
      // started every sentence in lower case. The attribute follows the caret.
      attributes: (state) => ({
        spellcheck: "false",
        autocorrect: "off",
        autocapitalize: SENTENCE_CAPS.has(state.selection.$head.parent.type.name)
          ? "sentences"
          : "off",
        // macOS's writing suggestions deleted typed letters on a ProseMirror
        // page in WebKit (ProseEditor.tsx has the evidence). Off here as well:
        // the script is where most of the words are typed.
        writingsuggestions: "false",
        /* A name for the writing surface. It had none, so VoiceOver announced
           the page as "edit text" — the one place in the app a writer spends
           their evening, with no word for what it is. */
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": "Script",
      }),
      // Paste is the other door the "…" glyph comes through (other editors,
      // the web). Input rules don't fire on paste, so undo it here too — a
      // script's ellipsis is three dots on the grid.
      transformPastedText: (text) => text.replace(/…/g, "..."),
      transformPastedHTML: (html) => html.replace(/…/g, "..."),
      handleKeyDown: (_view, event) => {
        // ⌘S exactly, as this system has it: any ⌘ or Ctrl with an S once
        // took the element chords that hold one, a PC's Scene Heading
        // (Ctrl+Shift+S) among them, which saved instead.
        if (pressed(event, "⌘S")) {
          event.preventDefault();
          onSaveShortcut?.();
          return true;
        }
        return false;
      },
    },
  });

  useEffect(() => {
    if (editor) onReady?.(editor);
    // Dev affordance: drive the editor from the console / preview harness.
    if (editor && import.meta.env.DEV) {
      (window as unknown as { __editor?: Editor }).__editor = editor;
    }
    // Only when the editor instance is (re)created.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  useEffect(() => {
    // Editable or not changes no word: no update for it.
    editor?.setEditable(editable, false);
  }, [editor, editable]);

  useElementAnnouncer(editor);

  // The editor outlives a script switch, so push cast updates as a command
  // rather than recreating the instance.
  useEffect(() => {
    editor?.commands.setCharacterCast(cast ?? []);
  }, [editor, cast]);

  // Auto-caps on or off. A command dispatches even when it changes nothing,
  // so it is sent only when the switch moves.
  useEffect(() => {
    if (editor && autoCapsKey.getState(editor.state)?.on !== autoCaps)
      editor.commands.setAutoCaps(autoCaps);
  }, [editor, autoCaps]);

  /* Names in the directions (names-in-directions.ts): on where the format asks
     and auto-caps is on, from the binder's cast and the title page's
     Characters list (the script's own cues are read as a name is finished),
     with the play's dictionary for the names that are ordinary words. */
  const castNamesOn = namesInDirectionsOn(autoCaps, format);
  const ordinary = useOrdinaryWords(language, castNamesOn);
  // The speakers, and the names the pages before the script list
  // (docs/app/formatting/formats-and-layout.md#FMT-170).
  const listed = useMemo(() => namesOnPages(frontPageList(frontMatter)), [frontMatter]);
  const castNames = useMemo(() => [...(cast ?? []), ...listed], [cast, listed]);
  useEffect(() => {
    editor?.commands.setCastNames({ on: castNamesOn, names: castNames, ordinary });
  }, [editor, castNamesOn, castNames, ordinary]);

  /* A page before the script edited where it stands (docs/app/formatting/formats-and-layout.md#FMT-165): the sheet the
     editor is mounted in is made once and drawn in the page's place. */
  /** The page edited, and which opening of it: another page, or the same one opened again, is a new editor. */
  const [frontEdit, setFrontEdit] = useState<{
    source: string;
    at: string | null;
    session: number;
    /** Said to be a page after the script by what opened it (one just added there). */
    back?: boolean;
  } | null>(null);
  const frontSessions = useRef(0);
  const [frontHost] = useState(() => (typeof document === "undefined" ? null : frontEditHost()));
  const inPlace = !!renderFrontPage;
  const editFrontHere = useCallback(
    (source: string, at: string | null) =>
      setFrontEdit({ source, at, session: ++frontSessions.current }),
    [],
  );
  // A page asked for from outside the page (one just added): edited where it
  // stands, once the page view draws it.
  useEffect(() => {
    if (openFrontPage && inPlace)
      setFrontEdit({
        source: openFrontPage.source,
        at: null,
        session: ++frontSessions.current,
        back: openFrontPage.back,
      });
  }, [openFrontPage, inPlace]);
  const retargetFront = useCallback(
    (source: string) => setFrontEdit((current) => (current ? { ...current, source } : current)),
    [],
  );
  const doneFront = useCallback(() => {
    setFrontEdit(null);
    // Back to the script where its caret was, unless a click there ended it.
    window.requestAnimationFrame(() => {
      if (editor && !editor.isDestroyed && !editor.view.hasFocus()) editor.view.focus();
    });
  }, [editor]);
  // The sheets are drawn in page view alone: without them there is nothing to
  // edit. And a page being edited is the open script's: another script ends it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the script changing is the cause
  useEffect(() => {
    setFrontEdit(null);
  }, [scriptKey]);
  useEffect(() => {
    if (!paginated) setFrontEdit(null);
  }, [paginated]);
  // A click into the script ends the editing, as leaving any field does. Heard
  // as the script's own element taking the keyboard: the script's focus
  // handler (caret-on-focus.ts) answers the event itself, so the editor's
  // "focus" never came, and the page stayed open under a caret in the script.
  // The page's editor stands inside the script's element, and its focus is
  // its own element's, never this one's.
  useEffect(() => {
    if (!editor || !frontEdit) return;
    const dom = editor.view.dom;
    const onFocus = (event: FocusEvent) => {
      if (event.target === dom) doneFront();
    };
    dom.addEventListener("focus", onFocus);
    return () => dom.removeEventListener("focus", onFocus);
  }, [editor, frontEdit, doneFront]);
  /* The page's editor is made once its sheet is in the page: made in a sheet
     the layout has not drawn yet, it took the keyboard in an element the
     document did not hold, and the keyboard stayed in the script. The sheet is
     drawn by a layout's transaction, so each transaction asks, until it is. */
  // A page after the script is edited under the gap that follows the script's
  // last sheet; one before it, over the gap that leads to the next. Read from
  // the pages the script holds, and, for a page just added and not yet read,
  // from what opened it.
  const editingBack =
    !!frontEdit &&
    (backPageList(frontMatter).some((page) => page.id === frontEdit.source) ||
      (!!frontEdit.back &&
        !frontPageList(frontMatter).some((page) => page.id === frontEdit.source)));
  /** The side of the script the editing sheet stands on in the page, or null while it is in none. */
  const [frontSide, setFrontSide] = useState<"front" | "back" | null>(null);
  /** The strip at the top of the script that holds the page's formatting bar while it is edited. */
  const [frontBar, setFrontBar] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!editor || !frontEdit || !frontHost) {
      setFrontSide(null);
      return;
    }
    const check = () =>
      setFrontSide(
        frontHost.root.isConnected
          ? frontHost.root.dataset[EDIT_SIDE] === "back"
            ? "back"
            : "front"
          : null,
      );
    check();
    editor.on("transaction", check);
    return () => {
      editor.off("transaction", check);
    };
  }, [editor, frontEdit, frontHost]);
  // In the page, and on the side of the script its page is on: a sheet still
  // standing where the last page was edited (before the script, when this one
  // is after it) is about to be moved by the next layout, and an editor made
  // in it would lose the keyboard as it went. Read as the page is drawn, not a
  // render later: the render that opens a page on the far side made its
  // editor in the old sheet, ended it and made it again.
  const frontAttached = frontSide === (editingBack ? "back" : "front");
  const editingFront =
    frontEdit && frontHost
      ? { source: frontEdit.source, root: frontHost.root, back: editingBack }
      : null;
  const editingSource = editingFront?.source ?? null;
  useLayoutEffect(() => {
    frontHost?.place(editingBack);
  }, [frontHost, editingBack]);
  useEffect(() => {
    onFrontEdit?.(editingSource);
  }, [onFrontEdit, editingSource]);
  const addPageHere = inPlace && editable ? onAddPage : undefined;

  // Keep live pagination in sync with the active format / view / header meta.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the sheet changes with its page alone
  useEffect(() => {
    editor?.commands.setPagination({
      enabled: paginated,
      spec: format,
      meta: layoutMeta,
      frontMatter,
      onFrontPageOpen: inPlace ? editFrontHere : null,
      onAddPage: addPageHere ?? null,
      editingFront,
    });
  }, [
    editor,
    paginated,
    format,
    layoutMeta,
    frontMatter,
    inPlace,
    editFrontHere,
    editingSource,
    addPageHere,
  ]);

  /**
   * Draw a change on the page, or take it off. The editor outlives a script
   * switch, so this is a command-style update rather than a re-created
   * instance — same reason as the cast above.
   */
  useEffect(() => {
    if (editor) setLiveRedline(editor, redline ?? null);
  }, [editor, redline]);

  /**
   * The speller (use-speller.ts), made again whenever anything behind it
   * moves — the dictionary arriving, a name entering the cast, a word learned
   * or ignored — and pushed through the plugin, which re-checks the script.
   * Command-style, like the cast and the redline above: the editor outlives a
   * script switch.
   */
  const { speller, ignore: ignoreWord } = useSpeller({
    on: spellcheck,
    language,
    cast,
    learnedWords,
  });
  useEffect(() => {
    editor?.commands.setSpeller(speller);
  }, [editor, speller]);

  // The whole stage format, generated from the spec (never hardcoded).
  // The format's own sheet, and where a redline's margin rule stands on it.
  const formatCss = useMemo(() => `${formatToCss(format)}\n${marginRuleCss(format)}`, [format]);

  /* What a line of the page is drawn short of its pitch, for the page's
     remainders (line-shortfall.ts, docs/app/writing/editor-ux.md#EDIT-197):
     measured again whenever the pitch can change, before the page is seen. */
  const page = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (page.current) measureLineShortfall(page.current);
  }, [zoom, formatCss, paginated]);
  // A zoom keeps the writer's place (docs/app/writing/editor-ux.md#EDIT-198):
  // after the shortfall above, which can move a line by a fraction of a pixel.
  useZoomAnchor(page, zoom);

  /** What the comment margin measured: desk to hold clear, and whether it's up. */
  const [margin, setMargin] = useState<MarginState>({ show: false, reserve: 0 });

  /** Which scene is on screen, for the strip's marker — NOT which one the
      caret is in. The caret does not move while you read. */
  const visibleScene = useVisibleScene(editor, showRunningTime);

  return (
    /* The margin asks for desk on the right; the sheet is centred, so the
       reserve is what shifts it left far enough to make room (docs/app/writing/comments.md#COMM-D4).
       Zero when the margin isn't showing — the page doesn't move for nothing.
       `has-comment-margin` is what makes the cards the ONE presentation: with
       them up, the galley's inline chips would be the same words twice. */
    <div
      className={`editor-surface${margin.show ? " has-comment-margin" : ""}`}
      lang={language}
      style={margin.reserve ? { marginRight: margin.reserve } : undefined}
    >
      <style>{formatCss}</style>
      {/* While a page before the script is edited, its formatting bar stands
          where the element bar does: the script's elements are no use on that
          page, and a bar drawn on the paper read as part of the page. */}
      {editor && frontEdit && frontAttached && <div ref={setFrontBar} className="frontedit-bar" />}
      {editor && editable && !(frontEdit && frontAttached) && (
        <ElementBar
          editor={editor}
          commentsOpen={commentsOpen}
          onToggleComments={onToggleComments}
        />
      )}
      {editable && !tutorialActive && <FirstRunCard editor={editor} />}
      {/* Comments live beside the page they annotate; the whole list lives in
          the feed pane, which App owns (docs/app/writing/comments.md#COMM-D4, docs/app/writing/comments.md#COMM-D5). */}
      {editor && <CommentsMargin editor={editor} onMargin={setMargin} onNoRoom={onShowComments} />}
      {/* The zoom scales the page's own lengths and type (`--page-scale`,
          formatToCss), never CSS `zoom`, which iPadOS kept from the editor's
          words (docs/app/writing/editor-ux.md#EDIT-196): the page is laid out
          at its zoomed size, so scroll extents track what is drawn. */}
      <div
        ref={page}
        className={`play-page${paginated ? " is-paginated" : ""}`}
        style={{ "--page-scale": zoom } as CSSProperties}
      >
        <EditorContent editor={editor} />
      </div>
      {/* Last child, and docked to the BOTTOM of the frame: the element bar is
          already sticky at the top, and two bars sharing one offset stack on
          top of each other. A find bar along the bottom edge is the familiar
          place for one anyway, and it stays in view while you walk matches. */}
      {/* The strip is the LAST chrome in focus mode, so it is the last thing
          drawn here too — pinned to the foot of the scroller, under the page it
          is a map of. */}
      {showRunningTime && editor && scenePages && cards && onJumpToScene && (
        <RunningTimeStrip
          cards={cards}
          scenePages={scenePages}
          caretOrdinal={visibleScene}
          onJump={onJumpToScene}
          editor={editor}
          showPlace={showScenePlace}
        />
      )}
      {editor && <FindBar editor={editor} />}
      {frontHost &&
        frontEdit &&
        frontAttached &&
        renderFrontPage &&
        createPortal(
          renderFrontPage(frontEdit.source, frontEdit.at, doneFront, frontBar, retargetFront),
          frontHost.mount,
          // A page's words moving to a file keep the editor; another opening makes a new one.
          `front-${frontEdit.session}`,
        )}
      {/* The correction menu is a right-click away from an underlined word; it
          renders nothing until one is open. */}
      {editor && editable && (
        <SpellMenu editor={editor} onLearn={onLearnWord ?? (() => {})} onIgnore={ignoreWord} />
      )}
    </div>
  );
}
