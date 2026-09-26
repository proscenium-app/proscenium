// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The guide, at the work (docs/app/preferences-and-help/tutorials.md#TUT-8, docs/app/preferences-and-help/tutorials.md#TUT-D103).
 *
 * One small card beside the thing to click or the line to type on, with an
 * arrow to it and a ring around it. There is no panel of instructions to read
 * across the window: the card says one thing, where it applies, and changes
 * as the writer works — a check when the result is there, a plain correction
 * when something went another way (docs/app/preferences-and-help/tutorials.md#TUT-9).
 *
 * The card never takes focus by itself and never covers its target
 * (place.ts). It is a named region (app/regions.ts): ⌃⇥ reaches it, and
 * Escape inside it stops the tutorial. While a sheet is the lesson's target
 * it lives inside that sheet's accessible scope; any other sheet hides it
 * until it closes.
 */
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import { Button, CheckIcon, ChevronDownIcon, CloseIcon, IconButton, Menu, WarnIcon, anyLayerOpen, useMenu, type MenuEntry } from "../ui";
import { portalHost } from "../ui/portal-host";
import type { Part, Target } from "./coach";
import { blockPos } from "./ghost";
import { placeCard, scrollFor, type Band, type Box, type Side } from "./place";
import type { Tutorial } from "./useTutorial";

const KEYS: Record<string, string> = {Return: "⏎ Return", Tab: "⇥ Tab", Escape: "esc", "⇧Return": "⇧⏎", "⌘Return": "⌘⏎", Shift: "⇧ Shift"};
export function Say({parts}: {parts: Part[]}) {
  const piece = (p: Exclude<Part, string>, i: number) => "key" in p ? <kbd key={i} className="keycap" aria-label={p.key}>{KEYS[p.key] ?? p.key}</kbd>
    : "type" in p ? <span key={i} className="tutorial-cue__type">{p.type}</span> : <strong key={i}>{p.ui}</strong>;
  const out: JSX.Element[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i], next = parts[i + 1];
    if (typeof p === "string") {out.push(<Fragment key={i}>{p}</Fragment>); continue;}
    // A key cap keeps the punctuation after it on its line: "press ⏎ Return." never orphans the full stop.
    const stuck = typeof next === "string" ? next.match(/^[.,;:!?)]+/)?.[0] : undefined;
    if (!stuck) {out.push(piece(p, i)); continue;}
    out.push(<span key={i} className="tutorial-cue__keep">{piece(p, i)}{stuck}</span>);
    const rest = (next as string).slice(stuck.length);
    if (rest) out.push(<Fragment key={`${i}+`}>{rest}</Fragment>);
    i++;
  }
  return <>{out}</>;
}

const shown = (el: Element | null): el is HTMLElement => {
  if (!(el instanceof HTMLElement) || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && !el.closest("[inert], [aria-hidden='true']");
};
const boxOf = (r: DOMRect): Box => ({left: r.left, top: r.top, width: r.width, height: r.height});
const first = (selector: string) => [...document.querySelectorAll(selector)].find(shown) ?? null;
/**
 * The band of the window a target shows in: the pane that scrolls it, less the
 * scroll padding its sticky chrome claims there (MaterialEditor's header and
 * format bar), within the window. A target in that chrome stays put as the
 * pane scrolls, so it shows wherever the pane does.
 */
function viewOf(el: HTMLElement): Band {
  const h = window.innerHeight;
  let pinned = getComputedStyle(el).position === "sticky";
  for (let p = el.parentElement; p; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (s.position === "sticky") pinned = true;
    if (!/auto|scroll|overlay/.test(s.overflowY)) continue;
    const top = p.getBoundingClientRect().top + p.clientTop;
    const pad = (v: string) => pinned ? 0 : parseFloat(v) || 0;
    return {top: Math.max(0, top + pad(s.scrollPaddingTop)), bottom: Math.min(h, top + p.clientHeight - pad(s.scrollPaddingBottom))};
  }
  return {top: 0, bottom: h};
}

interface Found { el: HTMLElement; box: Box; avoid: Box[]; ring: boolean; prefer: Side[] }
/** The target on screen now, and what the card must keep clear of. */
export function resolveTarget(t: Target, editor: Editor | null): Found | null {
  const around = (el: HTMLElement | null, container: string | null, prefer: Side[]): Found | null => {
    if (!el) return null;
    const box = boxOf(el.getBoundingClientRect());
    const holder = container ? el.closest(container) : null;
    return {el, box, avoid: holder ? [boxOf(holder.getBoundingClientRect())] : [], ring: true, prefer};
  };
  switch (t.kind) {
    case "line": {
      if (!editor || editor.isDestroyed) return null;
      const pos = blockPos(editor.state, t.index);
      const dom = pos === null ? null : editor.view.nodeDOM(pos);
      if (!(dom instanceof HTMLElement) || !shown(dom)) return null;
      const line = boxOf(dom.getBoundingClientRect());
      // The arrow points where the words go: at the suggestion, else the end of the line.
      const ghost = dom.querySelector(".tutorial-ghost")?.getBoundingClientRect();
      let box: Box;
      if (ghost && ghost.width) box = {left: ghost.left, top: line.top, width: ghost.width, height: Math.min(line.height, ghost.height || line.height)};
      else {
        const at = editor.view.coordsAtPos(pos! + 1 + editor.state.doc.child(t.index).content.size);
        box = {left: at.left - 1, top: at.top, width: 2, height: Math.max(1, at.bottom - at.top)};
      }
      return {el: dom, box, avoid: [line], ring: false, prefer: ["below", "above", "right", "left"]};
    }
    // A control a narrow pane folded into the element bar's More is found there (docs/app/writing/editor-ux.md#EDIT-171).
    case "ui": return around(first(t.card === undefined ? `[data-tutorial="${t.id}"]` : `[data-tutorial-card="${t.card}"] [data-tutorial="${t.id}"]`)
      ?? (t.card === undefined ? first(`[data-tutorial-folded~="${t.id}"]`) : null), null, ["below", "above", "right", "left"]);
    case "view": return around(first(`.viewswitch [data-seg="${t.view}"]`), null, ["below", "above", "right", "left"]);
    case "menu": return around(first(t.id === "format:other" ? '.menu [data-menu-id^="format:"]:not([aria-checked="true"])' : `.menu [data-menu-id="${t.id}"]`), ".menu", ["right", "left", "below", "above"]);
    case "element": return around(first(`.pl-elementmenu [data-key="${CSS.escape(t.key)}"]`), ".pl-elementmenu", ["right", "left", "below", "above"]);
    case "focus": {
      const el = document.activeElement;
      return el instanceof HTMLElement && el !== document.body && shown(el) ? around(el, null, ["below", "above", "right", "left"]) : null;
    }
    case "none": return null;
  }
}

export function CueCard({guide: g, editor}: {guide: Tutorial; editor: Editor | null}) {
  const card = useRef<HTMLElement | null>(null);
  const ring = useRef<HTMLDivElement | null>(null);
  const [missing, setMissing] = useState(false);
  const stepMenu = useMenu();
  const stepButton = useRef<HTMLButtonElement | null>(null);
  const latest = useRef({g, editor}); latest.current = {g, editor};
  const cue = g.cue;
  const sheet = g.ui.sheet;
  const inSheet = !!g.step && ((sheet === "export" && g.step.area === "export") || (sheet === "opening-pages" && g.step.id === "opening-notes"));
  const visible = !!g.attempt && (g.inPractice || g.leaving) && !g.open && (!sheet || inSheet);
  /** Where the card last stood, and the target last scrolled into view. */
  const placed = useRef<{left: number; top: number; side: Side | null; arrow: number | null} | null>(null);
  const scrolledFor = useRef<string | null>(null);

  // Follow the target every frame: it scrolls, reflows and moves as the writer works.
  useLayoutEffect(() => {
    if (!visible) return;
    let frame = 0;
    const place = () => {
      frame = requestAnimationFrame(place);
      const el = card.current;
      if (!el) return;
      const {g, editor} = latest.current;
      const target = g.cue?.target ?? {kind: "none" as const};
      const found = g.finished ? null : resolveTarget(target, editor);
      const lost = !g.finished && !found && target.kind !== "none";
      setMissing(m => m === lost ? m : lost);
      const targetKey = JSON.stringify(target);
      if (found && scrolledFor.current !== targetKey) {
        scrolledFor.current = targetKey;
        // Once per new target: bring it into view with room for the card beside it.
        // A line near the bottom edge would push the card up over the lines before it,
        // and one just under the toolbar hides what comes before it (the speaker's name).
        // Anything else is judged by the part of its pane clear of sticky chrome.
        const r = found.box, h = window.innerHeight, room = el.offsetHeight + 48;
        const block = target.kind === "line" ? (r.top < h * 0.25 || r.top + r.height > h - room ? "center" : null) : scrollFor(r, viewOf(found.el));
        if (block) found.el.scrollIntoView({block, inline: "nearest"});
      }
      const bounds = {left: 0, top: 0, width: window.innerWidth, height: window.innerHeight};
      // A finished step keeps the card where it was, so the check appears where the work happened.
      const at = found ? placeCard(found.box, {width: el.offsetWidth, height: el.offsetHeight}, bounds, found.prefer, found.avoid)
        : (g.cue?.tone === "done" && placed.current && !g.finished) ? placed.current : placeCard(null, {width: el.offsetWidth, height: el.offsetHeight}, bounds);
      placed.current = at;
      el.style.left = `${Math.round(at.left)}px`;
      el.style.top = `${Math.round(at.top)}px`;
      el.dataset.side = at.side ?? "none";
      if (at.arrow !== null) el.style.setProperty("--arrow", `${Math.round(at.arrow)}px`);
      const r = ring.current;
      if (r) {
        if (found?.ring) {
          r.style.display = "block";
          r.style.left = `${found.box.left - 3}px`; r.style.top = `${found.box.top - 3}px`;
          r.style.width = `${found.box.width + 6}px`; r.style.height = `${found.box.height + 6}px`;
        } else r.style.display = "none";
      }
    };
    place();
    return () => cancelAnimationFrame(frame);
  }, [visible]);
  useEffect(() => {if (!visible) stepMenu.close();}, [visible]);
  // A deliberate move gives the card's words the keyboard, once the card is up to take it
  // (useTutorial's cardFocus). A field someone went into since the move keeps it: a document
  // that opened ready to write in, or a writer who clicked the page first.
  const tookFocus = useRef(0);
  useLayoutEffect(() => {
    const want = g.cardFocus, el = card.current;
    if (!visible || !want || !el || want.n === tookFocus.current) return;
    const words = el.querySelector<HTMLElement>(want.to === "finished" ? "[data-tutorial-finished]" : "[data-tutorial-heading]");
    if (!words) return;
    tookFocus.current = want.n;
    const now = document.activeElement;
    if (now !== want.from && now instanceof HTMLElement && !el.contains(now) && (now.isContentEditable || now.matches("input, textarea, select"))) return;
    words.focus({preventScroll: true});
  });

  if (!visible || !g.lesson || !g.attempt) return null;
  const lesson = g.lesson, n = lesson.steps.length;
  const last = g.index + 1 >= n;
  const stop = () => {stepMenu.close(); void g.stop();};
  const tone = g.finished ? "done" : cue?.tone ?? "do";
  const entries: MenuEntry[] = [
    {kind: "section", label: lesson.title},
    ...lesson.steps.map((s, i) => ({label: `${i + 1}. ${s.title}`, radio: true, checked: i === g.index, hint: outcomeLabel(g.attempt!.outcomes[s.id]),
      disabled: g.busy, onSelect: () => void g.jump(i)})),
    {kind: "sep"},
    {label: "All Tutorials…", onSelect: () => g.setOpen(true)},
    {label: "Keep as a Play…", disabled: !g.canKeepPractice, onSelect: () => g.setOpen(true, "keep")},
    {kind: "sep"},
    {label: "Stop Tutorial", onSelect: stop},
  ];

  const body = g.finished ? <>
    <p className="tutorial-cue__say" tabIndex={-1} data-tutorial-finished="">
      <span className="tutorial-cue__tone" aria-hidden="true"><CheckIcon size={11} /></span>
      Lesson finished. {g.next ? <>Next, <strong>{g.next.title}</strong> picks up right here, in the same play.</> : "That's the whole course. Your practice play keeps all of it."}
    </p>
    {Object.values(g.attempt.outcomes).includes("skipped") && <p className="tutorial-cue__help">Some steps were skipped. They're in Help & Tutorials whenever you want them.</p>}
    <div className="tutorial-cue__actions">
      {g.next && <Button size="small" treatment="primary" disabled={g.busy} onClick={() => void g.start(g.next!)}>Next Lesson</Button>}
      <Button size="small" disabled={g.busy} onClick={g.dismiss}>Keep Writing Here</Button>
      <Button size="small" disabled={g.busy} onClick={stop}>Return to My Play</Button>
    </div>
  </> : <>
    <p className="tutorial-cue__say" tabIndex={-1} data-tutorial-heading="">
      {tone !== "do" && <span className="tutorial-cue__tone" aria-hidden="true">{tone === "done" ? <CheckIcon size={11} /> : <WarnIcon size={11} />}</span>}
      {g.leaving ? "Returning to your play…" : g.busy || !cue ? "Getting the practice ready…" : <Say parts={cue.say} />}
    </p>
    {g.state.moreHelp && g.step && <p className="tutorial-cue__help">{g.step.help}</p>}
    {g.error && <p className="tutorial-cue__error" role="alert">{g.error}</p>}
    {g.progressError && <p className="tutorial-cue__error" role="alert">{g.progressError} Help & Tutorials can reload it.</p>}
    <div className="tutorial-cue__actions">
      {cue?.fix && !g.busy && <Button size="small" treatment="primary" onClick={() => void g.fix(cue.fix!)}>{cue.fix.label}</Button>}
      {g.waitsForNext && !g.busy && <Button size="small" treatment="primary" onClick={() => g.advance(true)}>
        {last ? g.step?.id === "export-preview" ? "Finish at Preview" : "Finish Lesson" : "Next"}</Button>}
      {missing && cue?.tone !== "done" && !g.busy && <Button size="small" onClick={g.goThere}>Take Me There</Button>}
      <span className="tutorial-cue__spacer" />
      {cue?.tone !== "done" && !cue?.fix && <Button size="small" treatment="borderless" disabled={g.busy || !cue} onClick={() => void g.demonstrate()}>Show Me</Button>}
      {cue?.tone !== "done" && <Button size="small" treatment="borderless" disabled={g.busy} onClick={() => void g.skip()}>Skip Step</Button>}
      <Button size="small" treatment="borderless" aria-expanded={g.state.moreHelp} onClick={() => g.setMoreHelp(!g.state.moreHelp)}>More Help</Button>
    </div>
  </>;

  return createPortal(<>
    <div ref={ring} className="tutorial-ring" aria-hidden="true" />
    <aside ref={card} className={`tutorial-cue tutorial-cue--${tone}${g.finished ? " tutorial-cue--finished" : ""}`} aria-label="Tutorial"
      onKeyDown={e => {if (e.key === "Escape" && !anyLayerOpen()) {e.preventDefault(); e.stopPropagation(); stop();}}}>
      <div className="tutorial-cue__head">
        <span className="tutorial-cue__practice">Practice</span>
        <button ref={stepButton} type="button" className="tutorial-cue__steps" aria-haspopup="menu" aria-expanded={stepMenu.open}
          aria-label={`${lesson.title}, ${g.finished ? "finished" : `step ${g.index + 1} of ${n}`}. Choose a step`}
          onClick={() => stepMenu.openFrom(stepButton.current)}>
          <span className="tutorial-cue__lesson">{lesson.title}</span>
          {!g.finished && <span className="tutorial-cue__count">{g.index + 1} of {n}</span>}
          <ChevronDownIcon size={8} />
        </button>
        <IconButton size="mini" label="Stop Tutorial" onClick={stop}><CloseIcon size={10} /></IconButton>
      </div>
      {body}
      <span className="tutorial-cue__arrow" aria-hidden="true" />
    </aside>
    {stepMenu.anchor && <Menu anchor={stepMenu.anchor} entries={entries} onClose={stepMenu.close} width={240} label="Tutorial steps" />}
  </>, inSheet ? portalHost() : document.body);
}
const outcomeLabel = (o: string | undefined) => o === "tried" ? "done" : o === "demonstrated" ? "shown" : o === "skipped" ? "skipped" : undefined;
