// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState } from "react";
import { vault } from "../storage";
import type { SavedCopy } from "../storage/ipc";
import { Button, Sheet } from "../ui";
import { announce } from "../ui/announce";

/** Native collision copies are immutable and retained outside the play. */
export function useSavedCopies(root: string | null) {
  const [state, setState] = useState<{ root: string | null; copies: SavedCopy[]; error: string | null }>({ root: null, copies: [], error: null });
  useEffect(() => {
    if (!root) return;
    let live = true;
    let unlisten: (() => void) | undefined;
    let sequence = 0;
    let known = new Set<string>();
    const refresh = async () => {
      const turn = ++sequence;
      try {
        const copies = await vault.savedCopies();
        if (!live || turn !== sequence) return;
        if (copies.some((copy) => !known.has(copy.id))) announce("Copies kept during a save are available in Changes.");
        known = new Set(copies.map((copy) => copy.id));
        setState({ root, copies, error: null });
      } catch {
        if (live && turn === sequence) setState((prior) => ({ root, copies: prior.root === root ? prior.copies : [],
          error: "Saved copies could not be read. Return to the app to try again." }));
      }
    };
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    void vault.onSavedCopies((changed) => { if (changed === root) void refresh(); }).then((off) => { if (live) unlisten = off; else off(); })
      .catch(() => { /* opening and foreground queries still find retained copies */ });
    void refresh();
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => { live = false; unlisten?.(); window.removeEventListener("focus", visible); document.removeEventListener("visibilitychange", visible); };
  }, [root]);
  return state.root === root ? state : { copies: [], error: null };
}

const SAVE_NOTICE = "This copy was kept when a file changed during a save or a save was interrupted. You can select and copy its words. Reading it does not change your play.";

export function SavedCopies({ copies, error, read = vault.readSavedCopy, heading = "Copies kept during a save", notice = SAVE_NOTICE }: {
  copies: SavedCopy[]; error: string | null; read?: (id: string) => Promise<string>; heading?: string; notice?: string;
}) {
  const [selected, setSelected] = useState<SavedCopy | null>(null);
  return <>
    {(copies.length > 0 || error) && <h3 className="changes__group">{heading}</h3>}
    {error && <p className="changes__hint">{error}</p>}
    {copies.map((copy) => <section className="change" key={copy.id}>
      <header className="change__head"><button type="button" className="change__summary" onClick={() => setSelected(copy)} aria-haspopup="dialog">
        <span className="change__path">Saved copy of {copy.rel}</span>
        <span className="change__when">{copy.createdMs > 0 ? new Date(copy.createdMs).toLocaleString() : "Date unavailable"}</span>
      </button></header>
    </section>)}
    {selected && <SavedCopySheet key={selected.id} copy={selected} read={read} notice={notice} onClose={() => setSelected(null)} />}
  </>;
}

function SavedCopySheet({ copy, read, notice, onClose }: { copy: SavedCopy; read(id: string): Promise<string>; notice: string; onClose(): void }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    let live = true;
    void read(copy.id).then((words) => { if (live) setText(words); }, () => { if (live) setError(true); });
    return () => { live = false; };
  }, [copy.id, read]);
  useEffect(() => { if (text !== null) field.current?.focus(); }, [text]);
  return <Sheet title={`Saved copy of ${copy.rel}`} labelledBy="saved-copy-title" width={640} onClose={onClose}
    footer={<Button onClick={onClose}>Close</Button>}>
    <div className="diagnostics-body">
      <p className="diagnostics-notice" id="saved-copy-notice">{notice}</p>
      {error ? <p className="diagnostics-notice">This copy could not be read. Close it and try again.</p>
        : text === null ? <p className="diagnostics-notice">Reading…</p>
          : <textarea ref={field} className="diagnostics-review" readOnly aria-label={`Saved words from ${copy.rel}`}
            aria-describedby="saved-copy-notice" value={text} />}
    </div>
  </Sheet>;
}
