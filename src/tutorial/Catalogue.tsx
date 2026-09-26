// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Help & Tutorials (docs/app/preferences-and-help/tutorials.md#TUT-D102): the course, in order, as a
 * sheet you open, choose from and leave. Nothing here teaches; the lessons
 * happen at the work, with the card (CueCard.tsx). Opening it changes no play.
 */
import { useEffect, useRef, useState } from "react";
import { Button, Sheet, anyLayerOpen } from "../ui";
import { openFeedback } from "../feedback";
import { openSettings } from "../app/settings";
import { LESSONS } from "./lessons";
import { latest } from "./model";
import type { Tutorial } from "./useTutorial";

export function Catalogue({guide: g, practicing}: {guide: Tutorial; practicing: boolean}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [title, setTitle] = useState("My Practice");
  if (!g.open) return null;
  const close = () => {g.setOpen(false); requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-tutorial="help"]')?.focus());};
  const back = () => g.setPage("lessons");
  const resume = g.resumePoint();
  const disabled = g.busy || !g.ready;

  if (g.page === "keep" || g.page === "reset") {
    const keep = g.page === "keep";
    return <Sheet title={keep ? "Keep as a Play" : "Reset Tutorial Progress"} width={440} onClose={() => {if (!g.busy) back();}}
      footer={<><span className="sheet__spacer" /><Button disabled={g.busy} onClick={back}>Cancel</Button>
        <Button treatment="primary" disabled={g.busy || (keep && !title.trim())} onClick={() => {
          void (keep ? g.keepPractice(title) : g.reset()).then(done => {if (done && !keep) back();});
        }}>{g.busy ? "Saving…" : keep ? "Keep Copy" : "Reset Progress"}</Button></>}>
      <div className="tutorials__dialog">
        {keep ? <><p>Keep a complete copy of the practice play in your Plays folder. The practice stays here, and no play is ever replaced.</p>
          <label className="tutorials__field">Play title<input className="field" autoFocus value={title} onChange={e => setTitle(e.target.value)} disabled={g.busy}/></label>
          {g.keptCopy && <><p role="status">“{g.keptCopy.dir}” is saved in your Plays folder. The original practice is kept.</p>
            <Button disabled={g.busy} onClick={() => void g.openCopy()}>Open Copy</Button></>}</>
          : <p>Clear lesson checkmarks and saved steps. Every practice play and a copy of the previous progress are kept. The welcome invitation stays dismissed.</p>}
        {g.error && <p role="alert">{g.error}</p>}
      </div>
    </Sheet>;
  }

  if (g.page === "saved") return <Sheet title="Saved Practice" subtitle="Every practice play is kept on this Mac, apart from your Plays folder." width={520}
    onClose={close} footer={<><Button onClick={back}>All Tutorials</Button><span className="sheet__spacer" /><Button onClick={close}>Close</Button></>}>
    <ul className="tutorials__saved">{g.savedPractice.map(a => <li key={a.id}>
      <strong>{a.title}</strong>
      <p>{a.lessons.length ? a.lessons.join(" · ") : "Earlier practice"}{a.createdAt ? ` · ${new Date(a.createdAt).toLocaleDateString()}` : ""}</p>
      <div className="tutorials__actions"><Button size="small" disabled={g.busy} onClick={() => void g.openSavedPractice(a)}>Open Practice</Button>
        {a.session && <Button size="small" disabled={g.busy || !!g.isOpenPractice(a.session)} onClick={() => void g.trashPractice(a.session!)}>Move to Trash</Button>}</div>
    </li>)}</ul>
    <Button size="small" disabled={g.busy} onClick={() => void g.browsePractice()}>Browse Earlier Practice</Button>
    {g.error && <p role="alert">{g.error}</p>}
  </Sheet>;

  return <Sheet title="Help & Tutorials" subtitle="Six short lessons, building one practice play as you go." width={560} onClose={close}
    footer={<><Button size="small" onClick={() => openSettings("shortcuts")}>Keyboard Shortcuts</Button>
      <Button size="small" onClick={() => openFeedback()}>Send Feedback…</Button><span className="sheet__spacer" /><Button onClick={close}>Close</Button></>}>
    <div className="tutorials">
      {g.progressError && <div className="tutorials__notice"><p role="alert">{g.progressError}</p>
        <Button size="small" disabled={g.busy} onClick={() => void g.reloadProgress()}>Reload Saved Tutorial Progress</Button></div>}
      {!g.ready && <p role="status">Loading your tutorial place…</p>}
      {resume && <div className="tutorials__resume">
        <Button treatment="primary" disabled={disabled} onClick={() => void g.start(resume.lesson, resume.at, resume.attempt)}>
          {resume.attempt ? "Continue" : "Start"}: {resume.lesson.title}{resume.attempt ? ` · Step ${resume.at + 1} of ${resume.lesson.steps.length}` : ""}
        </Button>
        <p>{resume.attempt ? "In your practice play, at the step where you stopped." : "In your practice play, right where the last lesson left it."}</p>
      </div>}
      <ol className="tutorials__lessons">{LESSONS.map((l, n) => {
        const prior = latest(g.state, l.id);
        const at = prior ? Math.max(0, l.steps.findIndex(s => s.id === prior.step)) : 0;
        // A step chosen here goes to the course's play (docs/app/preferences-and-help/tutorials.md#TUT-10). A lesson
        // left in an earlier practice play, before Start Over, starts afresh in this one.
        const here = prior && prior.status !== "finished" && (!g.state.course || prior.id === g.state.course.id) ? prior : null;
        const skipped = prior ? Object.values(prior.outcomes).filter(o => o === "skipped").length : 0;
        const status = !prior ? `About ${l.minutes} minutes` : prior.status === "finished"
          ? skipped ? `Finished · ${skipped} Step${skipped === 1 ? "" : "s"} Skipped` : "Done" : `Step ${at + 1} of ${l.steps.length}`;
        return <li key={l.id} className="tutorials__lesson">
          <button className="tutorials__topic" aria-label={l.title} aria-expanded={selected === l.id} onClick={() => setSelected(selected === l.id ? null : l.id)}>
            <span className="tutorials__number" aria-hidden="true">{n + 1}</span>
            <span className="tutorials__title">{l.title}</span>
            <span className="tutorials__status">{status}</span>
          </button>
          {selected === l.id && <div className="tutorials__detail">
            <p>{l.outcome}</p>
            <div className="tutorials__actions">
              {prior && prior.status !== "finished" && <Button disabled={disabled} onClick={() => void g.start(l, at, prior)}>Continue</Button>}
              <Button treatment="primary" disabled={disabled} onClick={() => void g.start(l)}>{prior ? "Start Again" : "Start Tutorial"}</Button>
            </div>
            <ol className="tutorials__steps">{l.steps.map((s, i) => <li key={s.id}>
              <button className="btn btn--borderless btn--small" disabled={disabled} onClick={() => void g.start(l, i, here)}>{s.title}</button>
              {prior?.outcomes[s.id] && <span>{prior.outcomes[s.id] === "tried" ? "done" : prior.outcomes[s.id] === "demonstrated" ? "shown" : "skipped"}</span>}
            </li>)}</ol>
          </div>}
        </li>;
      })}</ol>
      {g.error && <p role="alert">{g.error}</p>}
      <div className="tutorials__actions tutorials__more">
        <Button size="small" onClick={() => g.setPage("saved")}>Saved Practice ({g.savedPractice.length})</Button>
        <Button size="small" disabled={disabled} onClick={() => void g.startOver()}>Start Over in a New Play</Button>
        {practicing && <Button size="small" disabled={g.busy || !g.canKeepPractice} onClick={() => g.setPage("keep")}>Keep as a Play…</Button>}
        <Button size="small" disabled={disabled} onClick={() => g.setPage("reset")}>Reset Progress…</Button>
        {practicing && <Button size="small" disabled={g.busy} onClick={() => void g.stop()}>Return to My Play</Button>}
      </div>
      {practicing && !g.canKeepPractice && <p className="tutorials__note">Choose a Plays folder before keeping a copy. Your practice is kept here.</p>}
    </div>
  </Sheet>;
}

/** Seen only after the invitation paints in a visible foreground window (docs/app/keeping-work/storage-and-file-format.md#STOR-174). */
export function TutorialInvitation({guide: g}: {guide: Tutorial}) {
  const ref = useRef<HTMLElement>(null);
  const latestGuide = useRef(g); latestGuide.current = g;
  useEffect(() => {
    if (!g.invitation) return;
    let first = 0, second = 0;
    const seen = () => {
      cancelAnimationFrame(first); cancelAnimationFrame(second);
      first = requestAnimationFrame(() => {second = requestAnimationFrame(() => {
        const box = ref.current?.getBoundingClientRect();
        if (box && box.width > 0 && box.height > 0 && document.visibilityState === "visible" && document.hasFocus() && !anyLayerOpen()) latestGuide.current.invitationPainted();
      });});
    };
    seen(); window.addEventListener("focus", seen); document.addEventListener("visibilitychange", seen);
    return () => {cancelAnimationFrame(first); cancelAnimationFrame(second); window.removeEventListener("focus", seen); document.removeEventListener("visibilitychange", seen);};
  }, [g.invitation]);
  if (!g.invitation) return null;
  return <section ref={ref} className="tutorial-invitation" aria-labelledby="tutorial-invitation-title">
    <h2 id="tutorial-invitation-title">Try a short guided start</h2>
    <p>Write a few lines in a practice play. The guide shows you where, one step at a time.</p>
    <div className="tutorials__actions"><Button onClick={() => g.acceptInvitation()}>Try the Tutorial</Button>
      <Button onClick={() => g.acceptInvitation(true)}>See All Tutorials</Button><Button onClick={g.dismissInvitation}>Skip for Now</Button></div>
    <p>You can return anytime from Help & Tutorials.</p>
  </section>;
}
