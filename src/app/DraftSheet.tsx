// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A saved draft, read (docs/app/organizing/workspace-model.md#WORK-96): the
 * script as it was kept, on its own page in the play's format, and never a
 * page anything writes in. It says what it is a draft of and when it was
 * kept, shows what has changed since in the script it came from, and offers
 * the two ways on from it: that script takes the draft's words back (asked
 * first, what it holds kept in Versions), or a new script holds them to work
 * in (docs/app/keeping-work/storage-and-file-format.md#STOR-205).
 */

import { useEffect, useState } from "react";
import { RedlineScript } from "../editor";
import type { FormatSpec } from "../format";
import { Alert, Button, Segmented, Sheet } from "../ui";
import type { DraftView, PlayOpResult } from "./useWorkspace";

type Look = "draft" | "since";

/** When a draft was kept, as the writer's clock says it. */
export function keptAt(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return `${at.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}, ${at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

export function DraftSheet({
  id,
  load,
  format,
  onRestore,
  onWorkingCopy,
  onClose,
}: {
  id: string;
  load: (id: string) => Promise<DraftView>;
  format: FormatSpec;
  onRestore: (id: string) => Promise<boolean>;
  onWorkingCopy: (id: string, name: string) => Promise<PlayOpResult>;
  onClose: () => void;
}) {
  const [view, setView] = useState<DraftView | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [look, setLook] = useState<Look>("draft");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setView(null);
    load(id)
      .then((v) => live && setView(v))
      .catch((e) => live && setFailed(String(e).replace(/^Error:\s*/, "")));
    return () => {
      live = false;
    };
  }, [id, load]);

  const from = view?.from ?? null;
  const subtitle = !view
    ? ""
    : view.record
      ? `A saved draft${from ? ` of “${from.name}”` : ""} · ${keptAt(view.record.savedAt)}`
      : "A script kept as a file. Proscenium does not write in it.";

  return (
    <>
      <Sheet
        title={view?.name ?? "Saved Draft"}
        subtitle={subtitle}
        width={820}
        height={680}
        onClose={onClose}
        onDefault={onClose}
        footer={
          <>
            <Button
              disabled={!view || busy}
              onClick={() => {
                if (!view) return;
                setBusy(true);
                void onWorkingCopy(id, view.name).then((res) => {
                  setBusy(false);
                  if (res.ok) onClose();
                  else setFailed(res.said);
                });
              }}
            >
              Make a Working Copy
            </Button>
            <span className="sheet__spacer" />
            {from && view?.record ? (
              <Button disabled={busy} onClick={() => setAsking(true)}>
                Restore to “{from.name}”…
              </Button>
            ) : null}
            <Button treatment="primary" onClick={onClose}>
              Done
            </Button>
          </>
        }
      >
        <div className="draftsheet">
          {failed ? <p className="draftsheet__note is-error">{failed}</p> : null}
          {view?.changed ? (
            <p className="draftsheet__note is-error">
              This draft’s file has changed outside Proscenium since it was saved.
            </p>
          ) : null}
          {view && from ? (
            <div className="draftsheet__bar">
              <Segmented<Look>
                label="Show"
                size="small"
                value={look}
                onChange={setLook}
                options={[
                  { id: "draft", label: "The Draft" },
                  { id: "since", label: `What “${from.name}” Has Changed Since` },
                ]}
              />
            </div>
          ) : null}
          {view ? (
            <div className="draftsheet__page">
              <RedlineScript
                whole={look === "draft" || !from}
                before={view.text}
                after={look === "since" && from ? from.text : view.text}
                format={format}
                label={
                  look === "since" && from
                    ? `What “${from.name}” has changed since “${view.name}”`
                    : `“${view.name}”, a saved draft`
                }
              />
            </div>
          ) : !failed ? (
            <p className="draftsheet__note" role="status">
              Reading the draft…
            </p>
          ) : null}
        </div>
      </Sheet>
      {asking && view && from ? (
        <Alert
          title={`Restore “${from.name}” to this draft?`}
          body={`“${from.name}” takes the words of “${view.name}”. What it holds now is kept in Versions first, so this can be undone there.`}
          confirmLabel="Restore"
          cancelIsDefault
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            setBusy(true);
            void onRestore(id).then((ok) => {
              setBusy(false);
              if (ok) onClose();
              else
                setFailed(`“${from.name}” could not take the draft’s words. Nothing was changed.`);
            });
          }}
        />
      ) : null}
    </>
  );
}
