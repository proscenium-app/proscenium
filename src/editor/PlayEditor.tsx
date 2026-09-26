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
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Doc, FrontMatter } from "../fountain";
import { formatToCss, type FormatSpec } from "../format";
import type { LayoutMeta } from "../layout";
import { ElementEntry } from "./element-entry";
import { AutoDetect, EllipsisFloor } from "./input-rules";
import { AutoCaps } from "./auto-caps";
import { CharacterAutocomplete } from "./character-autocomplete";
import { LeaderKey } from "./leader-key";
import { ElementBar, elementLabel } from "./ElementBar";
import { announce } from "../ui/announce";
import { Find } from "./find";
import { FindBar } from "./FindBar";
import { RunningTimeStrip } from "./RunningTimeStrip";
import { FirstRunCard } from "./FirstRunCard";
import { useVisibleScene } from "./caret-scene";
import type { ScenePageMap } from "../layout";
import type { SceneCard } from "../workspace";
import { PageBreakHandle } from "./page-break";
import { Pagination } from "./pagination";
import { Spellcheck } from "./spellcheck";
import { SpellMenu } from "./SpellMenu";
import { createSpeller, STAGE_WORDS, type Lexicon } from "../spell";
import { loadDictionary } from "../spell/dictionary";
import { DEFAULT_PLAY_LANGUAGE } from "../workspace/language";
import { editorExtensions } from "./schema";
import { Comments, CommentsMargin, type MarginState } from "../comments";
import { TrackedChanges, setTrackedMarks } from "./tracked-changes";
import { emptyMarks, type TrackedMarks } from "../review/tracked";
import { ensureNonEmpty, fromEditorDoc, toEditorDoc } from "./bridge";
import "./stage-format.css";

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
  /** Open the Title Page editor (clicking the title sheet invokes this). */
  onEditTitlePage?: () => void;
  /**
   * Inline tracked changes — a DECORATION layer over the
   * open script showing what arrived from outside. Never a document mutation:
   * switch it off and nothing about the play has changed.
   */
  trackedMarks?: TrackedMarks;
  /**
   * Page zoom: a pure view transform on the rendered sheet — the
   * engine's geometry (and page breaks) are identical at every level.
   */
  zoom?: number;
  /** The Comments feed pane is open — the bar's chip reflects and toggles it. */
  commentsOpen?: boolean;
  onToggleComments?: () => void;
  /** Underline misspellings (docs/app/writing/editor-ux.md#EDIT-D116). */
  spellcheck?: boolean;
  language?: string;
  /** Words the writer has taught the checker, from app settings. */
  learnedWords?: string[];
  /** "Add to Dictionary" — the caller persists it. */
  onLearnWord?: (word: string) => void;
  /** The page map: scene cards and their page ranges. */
  cards?: SceneCard[];
  scenePages?: ScenePageMap;
  onJumpToScene?: (ordinal: number) => void;
  /** Settings ▸ Writing: whether the page map shows (docs/app/preferences-and-help/settings.md#SET-9). */
  showRunningTime?: boolean;
}

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
  onEditTitlePage,
  trackedMarks,
  zoom = 1,
  commentsOpen = false,
  onToggleComments,
  spellcheck = true,
  language = DEFAULT_PLAY_LANGUAGE,
  learnedWords = NO_WORDS,
  onLearnWord,
  cards,
  scenePages,
  onJumpToScene,
  showRunningTime = true,
}: PlayEditorProps) {
  const editor = useEditor({
    extensions: [
      ...editorExtensions(),
      ElementEntry,
      AutoDetect,
      EllipsisFloor,
      AutoCaps,
      CharacterAutocomplete,
      LeaderKey,
      Pagination,
      PageBreakHandle,
      Find,
      Comments,
      TrackedChanges,
      Spellcheck,
    ],
    // Line breaks cross the editor boundary as nodes (bridge.ts); the model
    // on either side keeps its literal newlines.
    content: toEditorDoc(ensureNonEmpty(initialDoc)),
    editable,
    onUpdate: ({ editor }) => onChange?.(fromEditorDoc(editor.getJSON() as Doc)),
    editorProps: {
      // The OS check is OFF, and the app's own one (spellcheck.ts) replaces it.
      // Native squiggles were the first answer and could not be made to work:
      // WKWebView draws none at all unless the embedder flips a WebKit user
      // default, and even with them on, every character name and invented place
      // in the play is a typo — the OS has no way to know the cast. A checker
      // that reads the cast, respects the element types, and can be taught is
      // the feature a writer actually wanted. autocorrect/auto-capitalize stay off
      // so nothing fights the auto-caps input rules.
      attributes: {
        spellcheck: "false",
        autocorrect: "off",
        autocapitalize: "off",
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
      },
      // Paste is the other door the "…" glyph comes through (other editors,
      // the web). Input rules don't fire on paste, so undo it here too — a
      // script's ellipsis is three dots on the grid.
      transformPastedText: (text) => text.replace(/…/g, "..."),
      transformPastedHTML: (html) => html.replace(/…/g, "..."),
      handleKeyDown: (_view, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
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
    editor?.setEditable(editable);
  }, [editor, editable]);

  useElementAnnouncer(editor);

  // The editor outlives a script switch, so push cast updates as a command
  // rather than recreating the instance.
  useEffect(() => {
    editor?.commands.setCharacterCast(cast ?? []);
  }, [editor, cast]);

  // Keep live pagination in sync with the active format / view / header meta.
  useEffect(() => {
    editor?.commands.setPagination({
      enabled: paginated,
      spec: format,
      meta: layoutMeta,
      frontMatter,
      onTitlePageClick: onEditTitlePage ?? null,
    });
  }, [editor, paginated, format, layoutMeta, frontMatter, onEditTitlePage]);

  /**
   * Push tracked-change marks into the plugin's options and force one redraw.
   *
   * The editor outlives a script switch, so this is a command-style update
   * rather than a re-created instance — same reason as the cast above. The
   * empty transaction is how a DECORATION-only plugin refreshes: there is no
   * document change to trigger a redraw, and there must not be one.
   */
  useEffect(() => {
    if (!editor) return;
    setTrackedMarks(editor, trackedMarks ?? emptyMarks());
  }, [editor, trackedMarks]);

  /**
   * The dictionary, fetched the first time the check is wanted and then held
   * for the session (the module caches it across editors too). A failure is
   * silence: no dictionary means no underlines, never a dialog over the page.
   */
  const [loadedDictionary, setLoadedDictionary] = useState<{
    language: string;
    lexicon: Lexicon | null;
  } | null>(null);
  const lexicon = loadedDictionary?.language === language ? loadedDictionary.lexicon : null;
  useEffect(() => {
    if (!spellcheck) return;
    let live = true;
    void loadDictionary(language).then(
      (loaded) => {
        if (live) setLoadedDictionary({ language, lexicon: loaded });
      },
      () => {
        /* no dictionary this session */
      },
    );
    return () => {
      live = false;
    };
  }, [spellcheck, language]);

  /** Words waved through until the app restarts — the menu's "Ignore". */
  const [ignored, setIgnored] = useState<string[]>([]);
  const ignoreWord = useCallback((word: string) => {
    setIgnored((prev) =>
      prev.some((w) => w.toLowerCase() === word.toLowerCase()) ? prev : [...prev, word],
    );
  }, []);

  /**
   * Rebuild the speller whenever anything behind it moves — the dictionary
   * arriving, a name entering the cast, a word learned or ignored — and push it
   * through the plugin, which re-checks the script. Command-style, like the
   * cast and the tracked marks above: the editor outlives a script switch.
   */
  useEffect(() => {
    if (!editor) return;
    if (!spellcheck || !lexicon) {
      editor.commands.setSpeller(null);
      return;
    }
    editor.commands.setSpeller(
      createSpeller(lexicon, [...STAGE_WORDS, ...(cast ?? []), ...learnedWords, ...ignored]),
    );
  }, [editor, lexicon, spellcheck, cast, learnedWords, ignored]);

  // The whole stage format, generated from the spec (never hardcoded).
  const formatCss = useMemo(() => formatToCss(format), [format]);

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
      {editor && editable && (
        <ElementBar
          editor={editor}
          commentsOpen={commentsOpen}
          onToggleComments={onToggleComments}
        />
      )}
      {editable && !tutorialActive && <FirstRunCard editor={editor} />}
      {/* Comments live beside the page they annotate; the whole list lives in
          the feed pane, which App owns (docs/app/writing/comments.md#COMM-D4, docs/app/writing/comments.md#COMM-D5). */}
      {editor && <CommentsMargin editor={editor} onMargin={setMargin} />}
      {/* `zoom` (not transform) so scroll extents track the visual size. */}
      <div
        className={`play-page${paginated ? " is-paginated" : ""}`}
        style={{ zoom, "--page-chrome-zoom": 1 / zoom } as CSSProperties}
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
        />
      )}
      {editor && <FindBar editor={editor} />}
      {/* The correction menu is a right-click away from an underlined word; it
          renders nothing until one is open. */}
      {editor && editable && (
        <SpellMenu editor={editor} onLearn={onLearnWord ?? (() => {})} onIgnore={ignoreWord} />
      )}
    </div>
  );
}
