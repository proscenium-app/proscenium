// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Save As (docs/app/organizing/workspace-model.md#WORK-95). The play is
 * already saved, so the sheet says so first, and then asks what the copy is
 * for: a draft to keep, another script in this play, a new play of its own,
 * or another kind of file. Each choice does what its own place in the app does (the binder's
 * Duplicate, the Plays screen's Duplicate, the exports), so the sheet is one
 * more door to each, never the only one. Earlier versions of the script are in
 * Versions, which the sheet names, for a writer who came here to keep one.
 */

import { useEffect, useId, useRef, useState } from "react";
import { Button, PopupButton, Sheet } from "../ui";
import { AS_TYPED } from "../ui/as-typed";
import { useAnnouncedStatus } from "../ui/use-announced-status";
import { playFolderName } from "../workspace/play-ops";
import type { PlayOpResult } from "./useWorkspace";

/** What another kind of file can be. */
export type SaveAsFile = "pdf" | "docx" | "odt" | "fountain" | "zip";

type Choice = "draft" | "script" | "play" | "file";

/** A draft's name to start from: the script's, and the day (docs/app/keeping-work/storage-and-file-format.md#STOR-203). */
export function draftName(script: string, now = new Date()): string {
  return `${script}, ${now.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}`;
}

const FILES: { value: SaveAsFile; label: string }[] = [
  { value: "pdf", label: "PDF" },
  { value: "docx", label: "Word (.docx)" },
  { value: "odt", label: "OpenDocument (.odt)" },
  { value: "fountain", label: "Fountain" },
  { value: "zip", label: "The Whole Play (.zip)" },
];

export function SaveAsSheet({
  playName,
  scriptName,
  onDraft,
  onScript,
  onPlay,
  onFile,
  onVersions,
  onClose,
}: {
  playName: string;
  /** The script in front, or null when none is. */
  scriptName: string | null;
  /** Keep the script as it stands as a saved draft (docs/app/keeping-work/storage-and-file-format.md#STOR-203). */
  onDraft: (name: string) => Promise<PlayOpResult>;
  onScript: (name: string) => Promise<PlayOpResult>;
  onPlay: (name: string) => Promise<PlayOpResult>;
  /** The sheet has closed; the export goes on from here. */
  onFile: (kind: SaveAsFile) => void;
  onVersions: () => void;
  onClose: () => void;
}) {
  const id = useId();
  const [choice, setChoice] = useState<Choice>(scriptName ? "draft" : "play");
  const [draftCopy, setDraftCopy] = useState(scriptName ? draftName(scriptName) : "");
  const [scriptCopy, setScriptCopy] = useState(scriptName ? `${scriptName} copy` : "");
  const [playCopy, setPlayCopy] = useState(`${playName} copy`);
  const [file, setFile] = useState<SaveAsFile>("pdf");
  const [said, setSaid] = useState<{ text: string; taken: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const field = useRef<HTMLInputElement>(null);
  useAnnouncedStatus(said?.text ?? "");

  const name = choice === "draft" ? draftCopy : choice === "script" ? scriptCopy : playCopy;
  const ready = !busy && (choice === "file" || !!playFolderName(name));
  const confirm =
    choice === "draft"
      ? "Save Draft"
      : choice === "script"
        ? "Duplicate Script"
        : choice === "play"
          ? "Duplicate Play"
          : "Continue…";

  // The chosen copy's name is the next thing to type.
  useEffect(() => {
    if (choice !== "file") field.current?.select();
  }, [choice]);

  const submit = async () => {
    if (!ready || pending.current) return;
    if (choice === "file") {
      onClose();
      onFile(file);
      return;
    }
    pending.current = true;
    setBusy(true);
    try {
      const res = await (choice === "draft"
        ? onDraft(draftCopy)
        : choice === "script"
          ? onScript(scriptCopy)
          : onPlay(playCopy));
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

  const row = (value: Choice, title: string, about: string, disabled = false) => (
    <div className={`saveas__choice${disabled ? " is-disabled" : ""}`}>
      {/* The radio lies under the row, the whole row's size, as Add a Page's do. */}
      <input
        type="radio"
        className="saveas__radio"
        name={id}
        value={value}
        checked={choice === value}
        disabled={disabled || busy}
        aria-labelledby={`${id}-${value}-name`}
        aria-describedby={`${id}-${value}-about`}
        onChange={() => {
          setChoice(value);
          setSaid(null);
        }}
      />
      {/* Read as the radio's name and description, so not read again as text. */}
      <span className="saveas__name" id={`${id}-${value}-name`} aria-hidden="true">
        {title}
      </span>
      <span className="saveas__about" id={`${id}-${value}-about`} aria-hidden="true">
        {about}
      </span>
    </div>
  );

  return (
    <Sheet
      title="Save As"
      onClose={onClose}
      onDefault={() => void submit()}
      footer={
        <>
          <Button
            onClick={() => {
              onClose();
              onVersions();
            }}
          >
            Versions…
          </Button>
          <span className="sheet__spacer" />
          <Button onClick={onClose}>Cancel</Button>
          <Button treatment="primary" disabled={!ready} onClick={() => void submit()}>
            {busy ? "Making the Copy…" : confirm}
          </Button>
        </>
      }
    >
      <div className="saveas">
        <p className="saveas__saved">
          “{playName}” is saved. Proscenium saves as you write, and keeps earlier versions of the
          script in Versions.
        </p>
        <fieldset className="saveas__list">
          <legend className="saveas__legend seclabel">Make a Copy</legend>
          {row(
            "draft",
            "A Draft to Keep",
            scriptName
              ? `“${scriptName}” as it is now, kept in the Drafts folder, while you go on writing. It does not change.`
              : "Open a script first: a draft keeps it as it is.",
            !scriptName,
          )}
          {row(
            "play",
            "A New Play",
            "The whole play under a new name, as a play of its own. It opens when it is made.",
          )}
          {row(
            "script",
            "Another Script",
            scriptName
              ? `A copy of “${scriptName}” in this play, to take another way. It opens when it is made.`
              : "Open a script first: its copy goes beside it in this play.",
            !scriptName,
          )}
          {row(
            "file",
            "Another Kind of File",
            "The script as a PDF, a .docx, an .odt or a Fountain file, or the whole play as one .zip.",
          )}
        </fieldset>
        {choice === "file" ? (
          <div className="saveas__detail">
            <span className="saveas__label" aria-hidden="true">
              Kind
            </span>
            <PopupButton
              label="Kind of File"
              value={file}
              options={FILES}
              onChange={setFile}
              disabled={busy}
            />
          </div>
        ) : (
          <div className="saveas__detail">
            <label className="saveas__label" htmlFor={`${id}-copy`}>
              Name
            </label>
            <input
              {...AS_TYPED}
              ref={field}
              id={`${id}-copy`}
              className="field saveas__field"
              value={name}
              disabled={busy}
              aria-invalid={said?.taken ? true : undefined}
              aria-describedby={`${id}-said`}
              onChange={(event) => {
                (choice === "draft"
                  ? setDraftCopy
                  : choice === "script"
                    ? setScriptCopy
                    : setPlayCopy)(event.target.value);
                setSaid(null);
              }}
            />
          </div>
        )}
        <p className={`saveas__said${said ? " is-error" : ""}`} id={`${id}-said`}>
          {said?.text ?? ""}
        </p>
      </div>
    </Sheet>
  );
}
