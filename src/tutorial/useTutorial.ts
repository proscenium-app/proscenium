// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The lesson runner (docs/app/preferences-and-help/tutorials.md#TUT-D9): one practice play for the whole
 * course, one step at a time, each step's result read from the play itself.
 *
 * - **One play** (docs/app/preferences-and-help/tutorials.md#TUT-10, docs/app/keeping-work/storage-and-file-format.md#STOR-176). Every lesson
 *   continues the practice play the last one left; Continue reopens that play
 *   at that step. Start Over makes a new one and keeps the old.
 * - **The guide is at the work** (docs/app/preferences-and-help/tutorials.md#TUT-8). This hook decides
 *   the cue (coach.ts) and lights the script line with its suggestion
 *   (ghost.ts); CueCard.tsx draws the card beside the target.
 * - **It notices** (docs/app/preferences-and-help/tutorials.md#TUT-9). When the result is there, the
 *   guide says so and moves on by itself after a short pause, without taking
 *   focus from the writer. A wrong turn is named where it happened.
 *
 * Automatic edits (Show Me, a Skip later steps build on, a Fix, the exchange a
 * lesson opened first needs) go only to the practice play, add or convert,
 * and never remove the writer's words (perform.ts).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { Workspace } from "../app/useWorkspace";
import type { Surface } from "../app/panes";
import type { OpenMaterial } from "../app/use-material-sessions";
import { charactersPageText } from "../app/FrontPageEditor";
import { fromEditorDoc, scrollPosIntoView } from "../editor";
import type { Doc } from "../fountain";
import { useSettingsLoaded } from "../app/settings";
import { tutorials } from "../storage/ipc";
import { flatten, titleOf } from "../workspace/binder";
import { split, reconstruct, parseTags } from "../workspace/front-matter";
import { announce, anyLayerOpen } from "../ui";
import {
  COURSE_SEED,
  EXAMPLE,
  LESSONS,
  lessonById,
  nextLesson,
  type Area,
  type Lesson,
  type Step,
} from "./lessons";
import {
  coach,
  measure,
  readScript,
  spoken,
  type Baseline,
  type Cue,
  type Facts,
  type Fix,
} from "./coach";
import {
  activate,
  decodeProgress,
  emptyState,
  latest,
  rememberOutcome,
  resetProgress,
  sameAttempt,
  type Attempt,
  type Course,
  type TutorialState,
} from "./model";
import { exportFactsNow, tutorialActions, useExportFacts } from "./events";
import { ghostKey, ghostPlugin, showGhost } from "./ghost";
import * as edits from "./perform";
import { useUiFacts } from "./ui-facts";

interface Controls {
  show: (surface: Surface) => void;
  view: string | null;
  revealBinder: () => void;
  openExport: () => void;
  closeDialogs: () => void;
  /** Where the keyboard goes back to when the guide steps aside: the play's writing, Plays or Welcome; null until it is on the page. */
  writing: () => HTMLElement | null;
  welcomeReady: boolean;
  /** The document the focused pane shows, when it shows one. */
  material: OpenMaterial | null;
}
export type CataloguePage = "lessons" | "saved" | "keep" | "reset";
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
/** Wait for the workspace, by the clock rather than by frames: a busy Mac draws fewer of them. */
const until = async (ready: () => boolean, ms = 15000) => {
  const deadline = performance.now() + ms;
  while (!ready()) {
    if (performance.now() > deadline)
      throw new Error("The practice is still opening. Try again when the page is ready.");
    await Promise.race([frame(), new Promise((r) => setTimeout(r, 50))]);
  }
};
/** Steps the writer does by typing in the script: the cursor, not the card, is where they belong. */
const TYPING = new Set(["speaker", "line", "speaker-two", "reply"]);
/** Steps whose whole action is choosing a view. */
const VIEW_STEPS = new Set(["board", "outline", "cast"]);
const EMPTY_DOC: Doc = { type: "doc", content: [] };
const byOrder = <T extends { anchor: { ordinal: number } }>(cards: T[]) =>
  [...cards].sort((a, b) => a.anchor.ordinal - b.anchor.ordinal);
const sceneCount = (doc: Doc) => {
  const boundary = doc.content.some((b) => b.type === "scene") ? "scene" : "sceneHeading";
  return doc.content.filter((b) => b.type === boundary).length;
};

export function useTutorial(ws: Workspace, controls: Controls) {
  const settingsLoaded = useSettingsLoaded();
  const [sessions, setSessions] = useState<string[]>([]);
  const [invitation, setInvitation] = useState(false);
  const [keptCopy, setKeptCopy] = useState<{ dir: string; base: string } | null>(null);
  const [open, setOpenState] = useState(false);
  const [page, setPage] = useState<CataloguePage>("lessons");
  const [state, setState] = useState<TutorialState>(emptyState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressError, setProgressError] = useState<string | null>(null);
  const hash = useRef<string | null>(null);
  const queue = useRef(Promise.resolve());
  const [active, setActive] = useState<{ id: string; lesson: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  /** Stop is putting the writer's own play back; the card says so until it has. */
  const [leaving, setLeaving] = useState(false);
  const cancel = useRef(0);
  /** Bumped by every deliberate entry into a step, so returning to one reads it afresh. */
  const [entry, setEntry] = useState(0);
  /** The step whose result a Show Me just produced: it waits for Next instead of moving on. */
  const [shown, setShown] = useState<string | null>(null);
  const [, refresh] = useState(0);
  const [docVersion, setDocVersion] = useState(0);
  const current = useRef({ ws, controls });
  current.current = { ws, controls };
  const exportFacts = useExportFacts();
  const attempt = active ? (state.attempts.find((a) => sameAttempt(a, active)) ?? null) : null;
  const lesson = lessonById(attempt?.lesson);
  const index = Math.max(0, lesson?.steps.findIndex((s) => s.id === attempt?.step) ?? 0);
  const step = lesson?.steps[index] ?? null;
  const inPractice = !!attempt && ws.isPractice(attempt.id);
  const finished = attempt?.status === "finished";
  const ui = useUiFacts(inPractice && !finished);

  // --- progress, which is its own file (docs/app/keeping-work/storage-and-file-format.md#STOR-170) ---------------

  const checkpoint = useCallback((edit: (s: TutorialState) => TutorialState) => {
    const next = edit(stateRef.current);
    stateRef.current = next;
    setState(next);
    queue.current = queue.current
      .then(async () => {
        if (hash.current === null) return;
        hash.current = await tutorials.write(JSON.stringify(next), hash.current);
      })
      .catch((e) => {
        hash.current = null;
        setProgressError(`${String(e)} Your practice files are kept separately.`);
      });
  }, []);
  const refreshSessions = () => tutorials.sessions().then(setSessions);
  useEffect(() => {
    void refreshSessions().catch((e) => setError(String(e)));
  }, []);
  useEffect(() => {
    if (open) void refreshSessions().catch((e) => setError(String(e)));
  }, [open]);
  useEffect(() => {
    let live = true;
    void tutorials
      .read()
      .then((result) => {
        const decoded = decodeProgress(result.content);
        if (!live) return;
        hash.current = result.hash;
        stateRef.current = decoded;
        setState(decoded);
        setReady(true);
      })
      .catch((e) => {
        if (live) {
          setReady(true);
          setProgressError(String(e));
        }
      });
    return () => {
      live = false;
    };
  }, []);

  // --- the one-time invitation (docs/app/keeping-work/storage-and-file-format.md#STOR-174) --------------------------

  const invitationEligible =
    settingsLoaded &&
    ready &&
    ws.booted &&
    ws.mode === "picker" &&
    !!ws.vaultRoot &&
    !ws.practicing &&
    !ws.lookingBelow &&
    !ws.playsFolderHint &&
    !ws.recoveryOffer &&
    controls.welcomeReady &&
    !open &&
    !busy &&
    !progressError;
  useEffect(() => {
    if (!invitationEligible) {
      setInvitation(false);
      return;
    }
    if (state.invitation !== "new") return;
    let first = 0,
      second = 0;
    const offer = () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      if (document.visibilityState !== "visible" || !document.hasFocus() || anyLayerOpen()) return;
      first = requestAnimationFrame(() => {
        second = requestAnimationFrame(() => {
          if (document.visibilityState === "visible" && document.hasFocus() && !anyLayerOpen())
            setInvitation(true);
        });
      });
    };
    offer();
    window.addEventListener("focus", offer);
    document.addEventListener("visibilitychange", offer);
    // A sheet can close without a focus event on the window.
    const timer = window.setInterval(offer, 500);
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      clearInterval(timer);
      window.removeEventListener("focus", offer);
      document.removeEventListener("visibilitychange", offer);
    };
  }, [invitationEligible, state.invitation]);
  const invitationPainted = () => {
    if (stateRef.current.invitation === "new" && invitationEligible)
      checkpoint((p) => ({ ...p, invitation: "seen" }));
  };
  const dismissInvitation = () => {
    setInvitation(false);
    checkpoint((p) => ({ ...p, invitation: "dismissed" }));
  };

  const setOpen = (value: boolean, at: CataloguePage = "lessons") => {
    setPage(at);
    setOpenState(value);
    setError(null);
  };
  useEffect(() => {
    const reveal = () => {
      setPage("lessons");
      setOpenState(true);
    };
    window.addEventListener("proscenium:help", reveal);
    return () => window.removeEventListener("proscenium:help", reveal);
  }, []);
  // Only practice is watched: the writer's own plays pay nothing for the guide.
  useEffect(() => {
    const editor = ws.editor;
    if (!editor || !ws.practicing) return;
    const update = () => refresh((v) => v + 1);
    const changed = () => setDocVersion((v) => v + 1);
    editor.on("transaction", update);
    editor.on("update", changed);
    return () => {
      editor.off("transaction", update);
      editor.off("update", changed);
    };
  }, [ws.editor, ws.practicing]);

  // --- reading the play: facts, baseline, cue ------------------------------------------

  const editor = ws.editor && !ws.editor.isDestroyed ? ws.editor : null;
  const lessonOn = inPractice && !finished && !!step;
  let facts: Facts | null = null;
  if (lessonOn) {
    const sel = editor?.state.selection;
    const script = readScript(
      editor ? fromEditorDoc(editor.getJSON() as Doc) : EMPTY_DOC,
      sel && sel.$head.depth >= 1 ? sel.$head.index(0) : null,
      sel && !sel.empty && sel.$from.depth >= 1 ? sel.$from.parent.type.name : null,
      !!editor?.state.storedMarks?.length,
    );
    const m = controls.material?.item.type === "document" ? controls.material : null;
    const parts = m ? split(m.content) : null;
    facts = {
      script,
      view: controls.view,
      saved: ws.status === "saved" || ws.status === "idle",
      unsaved: ws.status === "unsaved" || ws.status === "conflict",
      format: ws.format.id,
      // In the Board's order, which is the order the guide points by.
      cards: [...ws.cards]
        .sort((a, b) => a.anchor.ordinal - b.anchor.ordinal)
        .map((c) => ({ id: c.id, heading: c.heading, synopsis: c.synopsis ?? "" })),
      front: {
        charactersPage: ws.frontMatter.charactersPage ?? "",
        characters: (ws.frontMatter.characters ?? []).map((c) => c.name),
        openingNotes: ws.frontMatter.openingNotes ?? "",
      },
      documents: flatten(ws.binder)
        .filter((i) => i.type === "document")
        .map((i) => i.id),
      material:
        m && parts
          ? {
              id: m.item.id,
              name: titleOf(m.item),
              text: parts.body,
              tags: parseTags(parts.fields.tags ?? ""),
            }
          : null,
      export: exportFacts,
      ui,
    };
  }
  const gated =
    !!ws.gate ||
    Object.keys(ws.materialGates).length > 0 ||
    ws.readOnly ||
    !!ws.recoveryOffer ||
    !!ws.outlineGate;
  // The Board's cards come from the script a moment after it opens; a step reads nothing until they agree.
  const settled =
    lessonOn &&
    !!editor &&
    ws.editable &&
    ws.cards.length === sceneCount(fromEditorDoc(editor.getJSON() as Doc));
  const live = lessonOn && !busy && !!editor && ws.editable;
  const stepKey =
    live && attempt && step ? `${attempt.id}|${attempt.lesson}|${step.id}|${entry}` : null;
  /** The step's starting point, and the snapshot of the play when its result first appeared. */
  const base = useRef<{
    key: string;
    value: Baseline;
    enteredDone: boolean;
    next: Baseline | null;
  } | null>(null);
  /** What the next step starts from when the guide moves on by itself: the play as this step's result left it. */
  const carry = useRef<Baseline | null>(null);
  let cue: Cue | null = null;
  if (stepKey && facts && step) {
    if (base.current?.key !== stepKey && (settled || carry.current)) {
      const value = carry.current ?? measure(facts);
      // Already done: its result is here now, or this step's result was reached before (Continue, a step chosen again).
      const before =
        !carry.current &&
        attempt &&
        (attempt.outcomes[step.id] === "tried" || attempt.outcomes[step.id] === "demonstrated");
      carry.current = null;
      base.current = {
        key: stepKey,
        value,
        enteredDone: before || coach(step.id, facts, value).tone === "done",
        next: null,
      };
    }
  }
  if (stepKey && facts && step && base.current?.key === stepKey) {
    cue = coach(step.id, facts, base.current.value);
    if (cue.tone === "done") base.current.next ??= measure(facts);
    else base.current.next = null;
    if (base.current.enteredDone && cue.tone !== "done")
      cue = {
        ...cue,
        tone: "done",
        fix: undefined,
        say: ["You've done this step. Choose Next — or do it again."],
      };
  }
  // A save warning, a newer file or a read-only practice outranks the lesson: the step waits.
  if (lessonOn && !busy && gated)
    cue = {
      tone: "fix",
      say: [
        "Your practice needs attention before this step can go on. The message in the window says what to do.",
      ],
      target: { kind: "none" },
    };
  const enteredDone = !!base.current && base.current.key === stepKey && base.current.enteredDone;
  const waitsForNext =
    !!cue && cue.tone === "done" && !!step && (step.look || enteredDone || shown === stepKey);

  // --- editing the practice ----------------------------------------------------------

  const assertPractice = () => {
    const a = attemptRef.current;
    if (!a || !current.current.ws.isPractice(a.id))
      throw new Error("The practice is no longer open. Your play has not been changed.");
  };
  const attemptRef = useRef(attempt);
  attemptRef.current = attempt;
  const dispatch = (build: (s: EditorState) => Transaction | null) => {
    assertPractice();
    const e = current.current.ws.editor;
    if (!e || e.isDestroyed) return false;
    const tr = build(e.state);
    if (!tr) return false;
    e.view.dispatch(tr.scrollIntoView());
    return true;
  };
  const docNow = () => {
    const e = current.current.ws.editor;
    return e ? fromEditorDoc(e.getJSON() as Doc) : EMPTY_DOC;
  };
  const hasSpeech = () =>
    docNow().content.some(
      (b) => b.type === "dialogue" && b.content?.some((t) => "text" in t && !!t.text.trim()),
    );
  const endsWithEmptySpeech = (s: EditorState) => {
    const n = s.doc.childCount,
      last = s.doc.child(n - 1),
      before = n > 1 ? s.doc.child(n - 2) : null;
    return (
      last.type.name === "dialogue" &&
      !last.content.size &&
      before?.type.name === "character" &&
      !!before.textContent.trim()
    );
  };
  const newestDocument = () => {
    const docs = flatten(current.current.ws.binder).filter((i) => i.type === "document");
    return docs[docs.length - 1] ?? null;
  };
  const openDocument = async () => {
    const c = current.current;
    let doc = newestDocument();
    if (!doc) {
      c.ws.createMaterial(null, "document", "Untitled");
      await until(() => !!newestDocument());
      assertPractice();
      doc = newestDocument()!;
    }
    c.controls.revealBinder();
    c.ws.selectItem(doc);
    c.controls.show({ kind: "material", id: doc.id });
    await until(() => current.current.controls.material?.item.id === doc!.id);
  };
  const showArea = (area: Area) => {
    const c = current.current;
    if (area === "export") {
      c.controls.show({ kind: "script" });
      c.controls.openExport();
    } else if (area === "document") void openDocument().catch((e) => setError(String(e)));
    else c.controls.show({ kind: area });
  };

  /** Where a step starts, prepared when the writer goes to it deliberately (docs/app/preferences-and-help/tutorials.md#TUT-D104). */
  const setup = async (l: Lesson, s: Step) => {
    const c = current.current;
    if (s.area !== "export") c.controls.closeDialogs();
    if (l.needsExchange && !hasSpeech()) dispatch(edits.exchangeTr);
    switch (s.id) {
      case "speaker":
      case "speaker-two":
        c.controls.show({ kind: "script" });
        dispatch((st) => edits.endLineTr(st));
        break;
      case "line":
        c.controls.show({ kind: "script" });
        dispatch((st) =>
          endsWithEmptySpeech(st) ? edits.speechTr(st) : edits.nameTr(st, EXAMPLE.first),
        );
        break;
      case "reply":
        c.controls.show({ kind: "script" });
        dispatch((st) =>
          endsWithEmptySpeech(st) ? edits.speechTr(st) : edits.nameTr(st, EXAMPLE.second),
        );
        break;
      case "board":
      case "outline":
      case "cast":
        break;
      case "scene":
      case "summary":
        c.controls.show({ kind: "corkboard" });
        break;
      case "move-scene": {
        c.controls.show({ kind: "corkboard" });
        const n = c.ws.cards.length;
        if (n < 2) {
          c.ws.addScene();
          await until(() => current.current.ws.cards.length > n);
        }
        break;
      }
      case "characters-page":
      case "add-character":
        c.controls.show({ kind: "cast" });
        break;
      case "document":
        c.controls.revealBinder();
        c.controls.show({ kind: "script" });
        break;
      case "note":
      case "tags":
      case "rename":
        await openDocument();
        break;
      case "export-range":
      case "export-opening":
      case "export-preview":
        c.controls.show({ kind: "script" });
        c.controls.openExport();
        await until(() => exportFactsNow().open);
        break;
      default:
        c.controls.show({ kind: "script" });
    }
  };

  /** Show Me, and the Skip of a step later steps build on: the step's result, made in place. */
  const perform = async (s: Step) => {
    const c = current.current,
      w = c.ws;
    const m = c.controls.material;
    switch (s.id) {
      case "speaker":
        dispatch((st) => edits.nameTr(st, EXAMPLE.first));
        break;
      case "line":
        dispatch((st) => edits.speakTr(st, EXAMPLE.line, true));
        break;
      case "speaker-two":
        dispatch((st) => edits.nameTr(st, EXAMPLE.second));
        break;
      case "reply":
        dispatch((st) => edits.speakTr(st, EXAMPLE.reply, false));
        break;
      case "saved":
        w.onSaveShortcut();
        break;
      case "emphasis":
        dispatch(edits.emphasisTr);
        break;
      case "line-break":
        dispatch(edits.lineBreakTr);
        break;
      case "page-break":
        dispatch(edits.pageBreakAtEndTr);
        break;
      case "format": {
        const f = w.formats.find((f) => f.id !== w.format.id);
        if (f) w.setFormat(f.id);
        break;
      }
      case "board":
        c.controls.show({ kind: "corkboard" });
        break;
      case "outline":
        c.controls.show({ kind: "outliner" });
        break;
      case "cast":
        c.controls.show({ kind: "cast" });
        break;
      case "scene": {
        const n = w.cards.length;
        w.addScene();
        await until(() => current.current.ws.cards.length > n);
        break;
      }
      case "summary": {
        const card = byOrder(w.cards).pop();
        if (card) w.editSynopsis(card.anchor.ordinal, EXAMPLE.summary);
        break;
      }
      case "move-scene": {
        const [a, b] = byOrder(w.cards).slice(-2);
        if (a && b) w.reorderScene(b.anchor.ordinal, a.anchor.ordinal);
        break;
      }
      case "characters-page": {
        const page =
          w.frontMatter.charactersPage || charactersPageText(w.frontMatter.characters ?? []);
        w.patchFrontMatter(
          { charactersPage: `${page.trimEnd()}\n\n*Two old friends, one early morning.*\n` },
          w.openScriptKey,
        );
        break;
      }
      case "add-character":
        w.saveCharacters([...(w.frontMatter.characters ?? []), { name: EXAMPLE.character }]);
        break;
      case "opening-notes":
        w.patchFrontMatter({ openingNotes: EXAMPLE.notes }, w.openScriptKey);
        break;
      case "document": {
        const n = flatten(w.binder).filter((i) => i.type === "document").length;
        w.createMaterial(null, "document", "Untitled");
        await until(
          () => flatten(current.current.ws.binder).filter((i) => i.type === "document").length > n,
        );
        break;
      }
      case "note":
      case "tags":
      case "rename": {
        if (!m || m.item.type !== "document")
          throw new Error("Open the practice document and try again.");
        const parts = split(m.content);
        if (s.id === "note")
          await w.saveMaterial(
            m.item.id,
            reconstruct(
              parts.header,
              `${parts.body.trim() ? parts.body.trimEnd() + "\n\n" : ""}${EXAMPLE.note}\n`,
            ),
            m.content,
          );
        else if (s.id === "tags")
          await w.editMaterialTags(m.item.id, (t) =>
            t.includes(EXAMPLE.tag) ? t : [...t, EXAMPLE.tag],
          );
        else w.renameTo(m.item.id, EXAMPLE.name);
        break;
      }
      case "export":
        c.controls.openExport();
        break;
      case "export-range":
      case "export-opening":
      case "export-preview":
        if (!exportFactsNow().open) {
          c.controls.openExport();
          await until(() => tutorialActions.has(s.id));
        }
        tutorialActions.get(s.id)?.();
        break;
    }
  };

  // --- moving through a lesson ------------------------------------------------------

  const run = async (work: () => Promise<void>) => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await work();
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  /** After a deliberate move, focus goes where the writer acts: the script for typing, else the card's words. */
  const focusAfter = useRef<"script" | "card" | "finished" | null>(null);
  /**
   * The card's words, to take the keyboard when the card is next shown. The card
   * itself does it (CueCard.tsx): it can appear a frame after the move, once
   * Help & Tutorials is seen closed, and a focus aimed at it before then was lost.
   */
  const [cardFocus, setCardFocus] = useState<{
    to: "card" | "finished";
    n: number;
    from: Element | null;
  } | null>(null);
  useEffect(() => {
    const want = focusAfter.current;
    if (!want || busy) return;
    focusAfter.current = null;
    if (want !== "script") {
      const from = document.activeElement;
      setCardFocus((f) => ({ to: want, n: (f?.n ?? 0) + 1, from }));
      return;
    }
    requestAnimationFrame(() => {
      const e = current.current.ws.editor;
      if (e && !e.isDestroyed) {
        e.view.focus();
        scrollPosIntoView(e.view, e.state.selection.from, { center: true });
      }
    });
  });

  /** The practice play the lessons write: `want`, else the course's, else a new one. */
  const ensurePlay = async (want?: Course | null): Promise<Course> => {
    const c = current.current;
    const target = want ?? stateRef.current.course;
    if (target && c.ws.isPractice(target.id)) return target;
    c.controls.closeDialogs();
    const opened = target
      ? await c.ws.startPractice("Practice Play", "", target.dir, target.session)
      : await c.ws.startPractice("Practice Play", COURSE_SEED);
    if (!opened) throw new Error("The current writing needs attention before practice can open.");
    // Open, not necessarily editable: a practice another version wrote opens read-only,
    // and the card says the step waits (the gated cue) rather than the lesson failing to start.
    await until(
      () =>
        current.current.ws.playId === opened.id &&
        current.current.ws.openScriptKey?.startsWith(`${opened.id}:`) === true &&
        !!current.current.ws.editor,
    );
    setKeptCopy(null);
    void refreshSessions().catch((e) => setError(String(e)));
    return {
      id: opened.id,
      dir: opened.dir,
      ...(opened.session ? { session: opened.session } : {}),
    };
  };
  /**
   * A deliberate entry: a lesson started, a step chosen, a Skip. `resuming` is
   * Continue, which puts the writer back where they left off — the view the
   * step happens in, and nothing written or moved in the play.
   */
  const enter = async (l: Lesson, at: number, resuming = false) => {
    setShown(null);
    carry.current = null;
    setEntry((e) => e + 1);
    const s = l.steps[at];
    // A step whose action IS switching the view is not done for it by Continue.
    if (resuming) {
      if (VIEW_STEPS.has(s.id)) {
        /* stay put */
      } else if (s.area === "export") await setup(l, s);
      else if (s.area === "document") await openDocument();
      else current.current.controls.show({ kind: s.area });
    } else await setup(l, l.steps[at]);
    focusAfter.current = TYPING.has(l.steps[at].id) ? "script" : "card";
  };
  const begin = (a: Attempt) => {
    checkpoint((p) => activate(p, a));
    setActive({ id: a.id, lesson: a.lesson });
  };
  /** Start (or, with `resume`, continue) a lesson in the course's play. */
  const start = (l: Lesson, at = 0, resume?: Attempt | null) =>
    run(async () => {
      setInvitation(false);
      // Help & Tutorials stays open until the play is: a failure is said where the writer chose.
      const play = await ensurePlay(
        resume ? { id: resume.id, dir: resume.dir, session: resume.session } : null,
      );
      assertPlay(play);
      setOpenState(false);
      const a: Attempt =
        resume && resume.id === play.id
          ? { ...resume, status: "active", step: l.steps[at].id }
          : {
              ...play,
              lesson: l.id,
              revision: l.revision,
              step: l.steps[at].id,
              status: "active",
              outcomes: {},
              createdAt: new Date().toISOString(),
            };
      begin(a);
      attemptRef.current = a;
      await enter(l, at, !!resume && resume.id === play.id && resume.step === l.steps[at].id);
    });
  const assertPlay = (play: Course) => {
    if (!current.current.ws.isPractice(play.id))
      throw new Error("The practice is no longer open. Your play has not been changed.");
  };
  /** Carry on the course where it was left: the newest paused lesson, or the next one not yet finished. */
  const resumePoint = () => {
    const paused = [...state.attempts]
      .reverse()
      .find((a) => a.status === "paused" && lessonById(a.lesson));
    if (paused) {
      const l = lessonById(paused.lesson)!;
      return {
        lesson: l,
        at: Math.max(
          0,
          l.steps.findIndex((s) => s.id === paused.step),
        ),
        attempt: paused,
      };
    }
    const next = LESSONS.find((l) => latest(state, l.id)?.status !== "finished");
    return next ? { lesson: next, at: 0, attempt: null } : null;
  };
  const startOver = () =>
    run(async () => {
      checkpoint((p) => ({
        ...p,
        attempts: p.attempts.map((a) => (a.status === "active" ? { ...a, status: "paused" } : a)),
      }));
      current.current.controls.closeDialogs();
      const opened = await current.current.ws.startPractice("Practice Play", COURSE_SEED);
      if (!opened)
        throw new Error("The current writing needs attention before a new practice play can open.");
      await until(
        () =>
          current.current.ws.playId === opened.id &&
          !!current.current.ws.editor &&
          current.current.ws.editable,
      );
      setOpenState(false);
      const play: Course = {
        id: opened.id,
        dir: opened.dir,
        ...(opened.session ? { session: opened.session } : {}),
      };
      const l = LESSONS[0];
      const a: Attempt = {
        ...play,
        lesson: l.id,
        revision: l.revision,
        step: l.steps[0].id,
        status: "active",
        outcomes: {},
        createdAt: new Date().toISOString(),
      };
      begin(a);
      attemptRef.current = a;
      setKeptCopy(null);
      void refreshSessions().catch((e) => setError(String(e)));
      await enter(l, 0);
    });

  const finish = (updated: Attempt) => {
    checkpoint((p) => ({
      ...p,
      attempts: p.attempts.map((a) =>
        sameAttempt(a, updated) ? { ...updated, status: "finished" } : a,
      ),
    }));
    announce(
      `Lesson finished. ${nextLesson(updated.lesson) ? "The next lesson picks up in this same play." : "Your practice play keeps everything."}`,
    );
  };
  const latestRef = useRef({ attempt, lesson, index, step, stepKey, shown });
  latestRef.current = { attempt, lesson, index, step, stepKey, shown };
  /** Next, or the guide moving on by itself: no setup, because this step's result is the next one's start. */
  const advance = (deliberate: boolean) => {
    const { attempt, lesson, index, step, stepKey, shown } = latestRef.current;
    if (!lesson || !attempt || !step || busyRef.current) return;
    const updated = rememberOutcome(attempt, step.id, shown === stepKey ? "demonstrated" : "tried");
    if (index + 1 >= lesson.steps.length) {
      // Finish at Preview closes the preview it finished at; nothing is saved or printed.
      if (step.area === "export") current.current.controls.closeDialogs();
      finish(updated);
      if (deliberate) focusAfter.current = "finished";
      refresh((v) => v + 1);
      return;
    }
    carry.current = base.current?.next ?? null;
    setShown(null);
    checkpoint((p) => ({
      ...p,
      attempts: p.attempts.map((a) =>
        sameAttempt(a, attempt) ? { ...updated, step: lesson.steps[index + 1].id } : a,
      ),
    }));
    if (deliberate) {
      focusAfter.current = TYPING.has(lesson.steps[index + 1].id) ? "script" : "card";
      refresh((v) => v + 1);
    }
  };
  const auto =
    !!cue &&
    cue.tone === "done" &&
    !waitsForNext &&
    !gated &&
    !open &&
    (ws.status === "saved" || ws.status === "idle");
  // A result is the writer's the moment it is there, before the guide moves on: Continue
  // after a stop in that pause finds the step done, not asked for again.
  useEffect(() => {
    if (
      !cue ||
      cue.tone !== "done" ||
      gated ||
      !attempt ||
      !step ||
      !stepKey ||
      base.current?.enteredDone
    )
      return;
    const outcome = shown === stepKey ? "demonstrated" : "tried";
    if (attempt.outcomes[step.id] === "tried" || attempt.outcomes[step.id] === outcome) return;
    checkpoint((p) => ({
      ...p,
      attempts: p.attempts.map((a) =>
        sameAttempt(a, attempt) ? rememberOutcome(a, step.id, outcome) : a,
      ),
    }));
  }, [cue?.tone, stepKey, shown, gated]);
  useEffect(() => {
    if (!auto || !step) return;
    const timer = window.setTimeout(() => advance(false), step.settle ?? 500);
    return () => clearTimeout(timer);
  }, [auto, stepKey, step?.idle ? docVersion : 0]);

  /** Choose a step from the card's list: prepared as a deliberate entry. */
  const jump = (at: number) =>
    run(async () => {
      if (!lesson || !attempt) return;
      checkpoint((p) => ({
        ...p,
        attempts: p.attempts.map((a) =>
          sameAttempt(a, attempt) ? { ...a, step: lesson.steps[at].id, status: "active" } : a,
        ),
      }));
      await enter(lesson, at);
    });
  const skip = () =>
    run(async () => {
      if (!lesson || !attempt || !step) return;
      const updated = rememberOutcome(attempt, step.id, "skipped");
      if (step.carries) await perform(step);
      if (index + 1 >= lesson.steps.length) {
        finish(updated);
        focusAfter.current = "finished";
        return;
      }
      checkpoint((p) => ({
        ...p,
        attempts: p.attempts.map((a) =>
          sameAttempt(a, attempt) ? { ...updated, step: lesson.steps[index + 1].id } : a,
        ),
      }));
      await enter(lesson, index + 1);
    });
  const demonstrate = () =>
    run(async () => {
      if (!step || !stepKey) return;
      const token = ++cancel.current;
      await perform(step);
      if (token !== cancel.current) return;
      setShown(stepKey);
      focusAfter.current = "card";
      announce("That's how it's done. Choose Next when you're ready.");
    });
  const fix = (f: Fix) =>
    run(async () => {
      const e = current.current.ws.editor;
      const caret = e ? e.state.selection.$head.index(0) : 0;
      if (f.id === "cue" && f.index !== undefined) dispatch((st) => edits.cueFixTr(st, f.index!));
      else if (f.id === "character") dispatch((st) => edits.retypeTr(st, caret, "character"));
      else if (f.id === "dialogue")
        dispatch(
          (st) =>
            (f.index !== undefined ? edits.retypeTr(st, f.index, "dialogue") : null) ??
            edits.speechTr(st),
        );
      else if (f.id === "undo") {
        assertPractice();
        e?.commands.undo();
      }
      focusAfter.current = "script";
    });
  const goThere = () => {
    if (step) showArea(step.area);
  };

  /** The keyboard to `to`; to the script through its editor, which puts the caret back where the play keeps it. */
  const focusOn = (to: HTMLElement) => {
    const e = current.current.ws.editor;
    if (e && !e.isDestroyed && e.view.dom === to) e.view.focus();
    else to.focus({ preventScroll: true });
  };
  /**
   * After Stop, the keyboard goes back once the place Stop returned to is on the page
   * (docs/app/preferences-and-help/tutorials.md#TUT-D105): the play in place (its script read,
   * laid out and at the writer's place), or Plays, or Welcome. A single frame after the return
   * was not enough on a busy Mac. A field the writer went into meanwhile keeps the keyboard.
   */
  const keyboardBack = async (from: Element | null) => {
    try {
      await until(() => {
        const { ws, controls } = current.current;
        return (
          !busyRef.current &&
          !ws.practicing &&
          (ws.mode !== "workspace" || ws.playSettled) &&
          !!controls.writing()
        );
      });
    } catch {
      return;
    }
    const now = document.activeElement,
      to = current.current.controls.writing();
    if (
      !to ||
      (now !== from &&
        now instanceof HTMLElement &&
        now.isConnected &&
        (now.isContentEditable || now.matches("input, textarea, select")))
    )
      return;
    focusOn(to);
  };

  const stop = async () => {
    const from = document.activeElement;
    cancel.current++;
    current.current.controls.closeDialogs();
    try {
      if (busyRef.current) await until(() => !busyRef.current);
    } catch {
      setError("Practice is still opening. Stop again when it is ready.");
      return;
    }
    setLeaving(true);
    let stopped = false;
    try {
      stopped = await run(async () => {
        checkpoint((p) => ({
          ...p,
          attempts: p.attempts.map((a) => (a.status === "active" ? { ...a, status: "paused" } : a)),
        }));
        const e = current.current.ws.editor;
        if (e && !e.isDestroyed && ghostKey.getState(e.state)) showGhost(e.view);
        // Settled only once the writer's own play is open again: until then the card stays,
        // so nothing else (All Plays, another play) races the return.
        if (!(await current.current.ws.stopPractice()))
          throw new Error(
            "Resolve the save warning before returning to your play. Practice is still open.",
          );
        setActive(null);
        setOpenState(false);
      });
    } finally {
      setLeaving(false);
    }
    if (stopped) await keyboardBack(from);
    return stopped;
  };
  // Opening another play pauses the lesson where it is (docs/app/preferences-and-help/tutorials.md#TUT-D105).
  useEffect(() => {
    if (!attempt || busy || inPractice || attempt.status !== "active") return;
    checkpoint((p) => ({
      ...p,
      attempts: p.attempts.map((a) => (sameAttempt(a, attempt) ? { ...a, status: "paused" } : a)),
    }));
    setActive(null);
  }, [attempt, busy, inPractice]);
  useEffect(() => {
    if (!ws.practicing && !busyRef.current) setActive(null);
  }, [ws.practicing]);

  // The line being written stays in view: the page reflows under it as the play grows (a
  // Characters page appears with the first cue), and the card beside it needs the room.
  // Brought back, it goes to the middle, so the lines it follows are in view too.
  useEffect(() => {
    const e = ws.editor;
    if (!e || !lessonOn) return;
    let next = 0;
    const reveal = () => {
      cancelAnimationFrame(next);
      next = requestAnimationFrame(() => {
        if (!e.isDestroyed && e.view.hasFocus())
          scrollPosIntoView(e.view, e.state.selection.from, { centerIfHidden: true });
      });
    };
    e.on("transaction", reveal);
    return () => {
      cancelAnimationFrame(next);
      e.off("transaction", reveal);
    };
  }, [ws.editor, lessonOn]);

  // --- the script line, lit, with its suggestion (docs/app/preferences-and-help/tutorials.md#TUT-8) --------------------

  useEffect(() => {
    const e = ws.editor;
    if (!e || e.isDestroyed || !ws.practicing) return;
    e.registerPlugin(ghostPlugin());
    return () => {
      if (!e.isDestroyed) e.unregisterPlugin(ghostKey);
    };
  }, [ws.editor, ws.practicing]);
  const lit =
    cue &&
    !open &&
    ui.sheet === null &&
    (cue.target.kind === "line" || cue.ghost || cue.line !== undefined)
      ? {
          line: cue.target.kind === "line" ? cue.target.index : (cue.line ?? null),
          ghost: cue.tone === "done" ? null : (cue.ghost ?? null),
        }
      : null;
  const litKey = JSON.stringify(lit);
  useEffect(() => {
    const e = ws.editor;
    if (e && !e.isDestroyed && ghostKey.getState(e.state)) showGhost(e.view, lit ?? undefined);
  }, [ws.editor, ws.practicing, litKey]);

  // --- saying it once (docs/app/preferences-and-help/tutorials.md#TUT-D8) ------------------------------------------

  const said = useRef<{ key: string | null; text: string }>({ key: null, text: "" });
  const words = cue ? spoken(cue.say) : "";
  useEffect(() => {
    if (!cue || !stepKey || !lesson || !step) return;
    if (said.current.key !== stepKey) {
      said.current = { key: stepKey, text: words };
      announce(
        `${lesson.title}, step ${index + 1} of ${lesson.steps.length}: ${step.title}. ${words}`,
      );
      return;
    }
    if (said.current.text === words) return;
    const timer = window.setTimeout(() => {
      said.current = { key: stepKey, text: words };
      announce(words);
    }, 400);
    return () => clearTimeout(timer);
  }, [stepKey, words]);

  // --- the catalogue's other actions (docs/app/keeping-work/storage-and-file-format.md#STOR-170 to docs/app/keeping-work/storage-and-file-format.md#STOR-173) ---

  const reloadProgress = () =>
    run(async () => {
      await queue.current;
      const stored = await tutorials.read();
      const next = decodeProgress(stored.content);
      hash.current = stored.hash;
      stateRef.current = next;
      setState(next);
      setProgressError(null);
      if (active && !next.attempts.some((a) => sameAttempt(a, active) && a.status !== "archived"))
        setActive(null);
      await refreshSessions();
    });
  const reset = () =>
    run(async () => {
      await queue.current;
      const stored = await tutorials.read();
      let previous = stateRef.current;
      try {
        previous = decodeProgress(stored.content);
      } catch {
        /* Explicit reset preserves the unreadable bytes first. */
      }
      const next = resetProgress(previous);
      hash.current = await tutorials.write(JSON.stringify(next), stored.hash, true);
      stateRef.current = next;
      setState(next);
      setActive(null);
      setProgressError(null);
      setInvitation(false);
      await refreshSessions();
      announce("Tutorial progress reset. All earlier practice has been kept.");
    });
  /** One row per practice play, newest first, whatever lessons it holds. */
  const savedPractice: (Course & { title: string; createdAt: string; lessons: string[] })[] = [];
  for (const a of [...state.attempts].reverse()) {
    const row = savedPractice.find((p) => p.id === a.id);
    const title = lessonById(a.lesson)?.title ?? a.lesson;
    if (row) {
      if (!row.lessons.includes(title)) row.lessons.push(title);
      if (a.createdAt < row.createdAt) row.createdAt = a.createdAt;
    } else
      savedPractice.push({
        id: a.id,
        dir: a.dir,
        ...(a.session ? { session: a.session } : {}),
        title: "Practice Play",
        createdAt: a.createdAt,
        lessons: [title],
      });
  }
  for (const session of sessions)
    if (!savedPractice.some((a) => a.session === session))
      savedPractice.push({
        id: session,
        session,
        dir: "Practice Play",
        title: "Saved Practice",
        createdAt: "",
        lessons: [],
      });
  const openSavedPractice = (a: Course) =>
    run(async () => {
      current.current.controls.closeDialogs();
      // The practice already open is not read in again: it only becomes the play the lessons continue.
      if (
        !current.current.ws.isPractice(a.id) &&
        !(await current.current.ws.startPractice("Practice Play", "", a.dir, a.session))
      )
        throw new Error("The current writing needs attention before saved practice can open.");
      setOpenState(false);
      // The lessons continue whichever practice play the writer chose to open.
      const id = current.current.ws.playId;
      if (id)
        checkpoint((p) => ({
          ...p,
          course: { id, dir: a.dir, ...(a.session ? { session: a.session } : {}) },
        }));
      setActive(null);
      setKeptCopy(null);
      current.current.controls.show({ kind: "script" });
    });
  const trashPractice = (session: string) =>
    run(async () => {
      await tutorials.trash(session);
      checkpoint((p) => ({
        ...p,
        course: p.course?.session === session ? null : p.course,
        attempts: p.attempts.filter((a) => a.session !== session),
      }));
      await refreshSessions();
      announce("Practice moved to Trash.");
    });
  const keepPractice = (title: string) =>
    run(async () => {
      setKeptCopy(null);
      const copy = await current.current.ws.keepPractice(title);
      setKeptCopy(copy);
      announce("A copy is saved in your Plays folder. The original practice is kept.");
    });
  const openCopy = () =>
    run(async () => {
      if (!keptCopy || !(await current.current.ws.openPracticeCopy(keptCopy)))
        throw new Error("The copy could not be opened. It remains in your Plays folder.");
      checkpoint((p) => ({
        ...p,
        attempts: p.attempts.map((a) => (a.status === "active" ? { ...a, status: "paused" } : a)),
      }));
      setActive(null);
      setOpenState(false);
      setKeptCopy(null);
    });
  const browsePractice = () =>
    run(async () => {
      current.current.controls.closeDialogs();
      if (!(await current.current.ws.browsePractice()))
        throw new Error("The current writing needs attention before saved practice can open.");
      setOpenState(false);
      setActive(null);
      checkpoint((p) => ({
        ...p,
        attempts: p.attempts.map((a) => (a.status === "active" ? { ...a, status: "paused" } : a)),
      }));
    });

  return {
    open,
    setOpen,
    page,
    setPage,
    state,
    ready: ready && ws.booted,
    error,
    progressError,
    busy,
    attempt,
    lesson,
    step,
    index,
    cue,
    finished,
    inPractice,
    enteredDone,
    waitsForNext,
    stepKey,
    live,
    gated,
    ui,
    leaving,
    cardFocus,
    next: lesson && attempt ? nextLesson(lesson.id) : null,
    start,
    startOver,
    resumePoint,
    advance,
    jump,
    skip,
    demonstrate,
    fix,
    goThere,
    stop,
    browsePractice,
    reloadProgress,
    savedPractice,
    openSavedPractice,
    trashPractice,
    reset,
    keepPractice,
    keptCopy,
    openCopy,
    canKeepPractice: ws.canKeepPractice,
    isOpenPractice: (session: string) => ws.practicing && ws.vaultRoot?.endsWith("/" + session),
    invitation: invitation && invitationEligible,
    invitationPainted,
    dismissInvitation,
    acceptInvitation: (all = false) => {
      dismissInvitation();
      if (all) setOpen(true);
      else void start(LESSONS[0]);
    },
    cancelDemo: () => {
      cancel.current++;
    },
    /** Leave the finished lesson's card and keep writing in the practice play. */
    dismiss: () => {
      setActive(null);
      const to = current.current.controls.writing();
      if (to) focusOn(to);
    },
    setMoreHelp: (value: boolean) => {
      if (!busyRef.current) checkpoint((p) => ({ ...p, moreHelp: value }));
    },
  };
}
export type Tutorial = ReturnType<typeof useTutorial>;
