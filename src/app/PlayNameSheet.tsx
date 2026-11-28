// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The one question a play's rename, copy or new play asks: its name
 * (docs/app/organizing/workspace-model.md#WORK-94). The field opens holding a
 * name to start from, all of it chosen, so typing replaces it. A name the
 * Plays folder already has is said under the field, and the field keeps what
 * was typed. A rename whose title page shows the play's name asks, with the
 * box ticked, whether the title page takes the new one.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button, Checkbox, Sheet } from "../ui";
import { AS_TYPED } from "../ui/as-typed";
import { useAnnouncedStatus } from "../ui/use-announced-status";
import { playFolderName } from "../workspace/play-ops";
import type { PlayOpResult } from "./useWorkspace";

export function PlayNameSheet({
  title,
  intro,
  initial,
  confirm,
  busyLabel,
  unchanged,
  titleAsk,
  onSubmit,
  onClose,
}: {
  title: string;
  /** One sentence on what the button will do. */
  intro: ReactNode;
  initial: string;
  /** The button's word: Rename, Duplicate, Create Play. */
  confirm: string;
  busyLabel: string;
  /** A name that changes nothing, which the button refuses (a rename's own). */
  unchanged?: string;
  /** Ask whether the title page takes the new name: its title now, when it is the play's name. */
  titleAsk?: string | null;
  onSubmit: (name: string, title: boolean) => Promise<PlayOpResult>;
  onClose: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(initial);
  const [retitle, setRetitle] = useState(true);
  const [said, setSaid] = useState<{ text: string; taken: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const field = useRef<HTMLInputElement>(null);
  const folder = playFolderName(name);
  const same = unchanged !== undefined && folder === unchanged;
  const ready = !!folder && !same && !busy;
  const shown =
    folder && folder !== name.trim()
      ? `It will be named “${folder}”: a file name cannot hold some of what was typed.`
      : "";
  useAnnouncedStatus(said?.text ?? "");

  useEffect(() => {
    field.current?.select();
  }, []);

  const submit = async () => {
    if (!ready || pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const res = await onSubmit(name, !!titleAsk && retitle);
      if (res.ok) onClose();
      else {
        setSaid({ text: res.said, taken: !!res.taken });
        field.current?.focus();
      }
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={title}
      onClose={onClose}
      onDefault={() => void submit()}
      footer={
        <>
          <span className="sheet__spacer" />
          <Button onClick={onClose}>Cancel</Button>
          <Button treatment="primary" disabled={!ready} onClick={() => void submit()}>
            {busy ? busyLabel : confirm}
          </Button>
        </>
      }
    >
      <div className="playname">
        <p className="playname__intro">{intro}</p>
        <label className="playname__label" htmlFor={`${id}-name`}>
          Name
        </label>
        <input
          {...AS_TYPED}
          ref={field}
          id={`${id}-name`}
          className="field playname__field"
          value={name}
          disabled={busy}
          aria-invalid={said?.taken ? true : undefined}
          aria-describedby={`${id}-said`}
          onChange={(event) => {
            setName(event.target.value);
            setSaid(null);
          }}
        />
        <p className={`playname__said${said ? " is-error" : ""}`} id={`${id}-said`}>
          {said?.text ?? shown}
        </p>
        {titleAsk ? (
          <span className="playname__check">
            <Checkbox
              on={retitle}
              onChange={setRetitle}
              disabled={busy}
              label="Put the new name on the title page"
              describedBy={`${id}-title`}
            />
            <span aria-hidden="true">Put the new name on the title page</span>
          </span>
        ) : null}
        {titleAsk ? (
          <p className="playname__note" id={`${id}-title`}>
            It says “{titleAsk}” now.
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
