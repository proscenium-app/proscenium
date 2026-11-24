// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Proscenium’s Trash (docs/engineering/cross-platform.md#PLAT-16): what was
 * deleted on this device, where the system keeps no trash of its own (an
 * iPad), opened from the Plays screen. Each entry says what it was, where it
 * was and when it was deleted, and Put Back returns it there
 * (src/workspace/trash.ts). It is kept in app data, never in the Plays folder,
 * so sync never carries it to another device, for as long as the record says.
 */
import { useEffect, useRef, useState } from "react";
import { reloadFormats } from "../format";
import { appTrash, type TrashEntry } from "../storage/ipc";
import { ownTrashDays } from "../storage/own-trash";
import { announce, Button, Sheet } from "../ui";
import { systemWords } from "../ui/system-words";
import type { VaultPlay } from "../workspace";
import { trashTitle, trashWhat, type PutBackOutcome } from "../workspace/trash";

/** When it was deleted, as the Plays screen says when a play was changed. */
function deletedLabel(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  if (
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  ) {
    return `today, ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  }
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function TrashSheet({
  plays,
  onPutBack,
  onClose,
}: {
  /** The plays in the Plays folder, by which a play's entry finds the play it goes back into. */
  plays: VaultPlay[];
  onPutBack: (entry: TrashEntry) => Promise<PutBackOutcome>;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<TrashEntry[] | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLUListElement | null>(null);
  const close = useRef<HTMLButtonElement | null>(null);
  const trash = systemWords().trash;
  const days = ownTrashDays();

  useEffect(() => {
    let live = true;
    appTrash.list().then(
      (found) => live && setEntries(found),
      (e) => {
        if (!live) return;
        setEntries([]);
        setSaid(`${trash} could not be read. ${String(e).replace(/^Error:\s*/, "")}`);
      },
    );
    return () => {
      live = false;
    };
  }, [trash]);

  const putBack = async (entry: TrashEntry, at: number) => {
    if (busy) return;
    setBusy(true);
    const out = await onPutBack(entry).catch(
      (e): PutBackOutcome => ({ ok: false, said: String(e).replace(/^Error:\s*/, "") }),
    );
    if (out.ok && out.changed === "formats") void reloadFormats();
    // The row goes, and focus with it: said aloud, and on the page under the list.
    setSaid(out.said);
    announce(out.said);
    setEntries(await appTrash.list().catch(() => entries ?? []));
    setBusy(false);
    // The keyboard stays where it was: on the row that took this one's place,
    // or the one before it, or Close once nothing is left.
    requestAnimationFrame(() => {
      const rows = list.current?.querySelectorAll<HTMLButtonElement>(".trash__putback") ?? [];
      (rows[Math.min(at, rows.length - 1)] ?? close.current)?.focus();
    });
  };

  return (
    <Sheet
      title={trash}
      subtitle={
        days === null
          ? undefined
          : `What you delete on this ${systemWords().machine} is kept here for ${days} days, and then removed for good.`
      }
      width={540}
      onClose={onClose}
      footer={
        <>
          <span className="sheet__spacer" />
          <Button ref={close} onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      {entries === null ? (
        <p className="trash__note">Reading {trash}…</p>
      ) : entries.length === 0 ? (
        <p className="trash__note">Nothing is in {trash}.</p>
      ) : (
        <ul className="trash__list" ref={list} aria-label={`What ${trash} keeps`}>
          {entries.map((entry, i) => {
            const title = trashTitle(entry);
            const ring = entry.ring.kind === "play" ? `play:${entry.ring.playId}` : entry.ring.kind;
            return (
              <li className="trash__row" key={`${ring}/${entry.name}`}>
                <span className="trash__what">
                  <span className="trash__title">{title}</span>
                  <span className="trash__where">
                    {trashWhat(entry, plays)} · Deleted {deletedLabel(entry.deletedMs)}
                  </span>
                </span>
                <Button
                  className="trash__putback"
                  disabled={busy}
                  aria-label={`Put Back “${title}”`}
                  onClick={() => void putBack(entry, i)}
                >
                  Put Back
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {said && <p className="trash__said">{said}</p>}
    </Sheet>
  );
}
