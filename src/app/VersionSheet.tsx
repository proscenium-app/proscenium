// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Play Version… (docs/app/formatting/formats-and-layout.md#FMT-185): the
 * play's version, which prints on its title page, and where else it prints,
 * the page header or the page footer and which side, or nowhere else. A quiet
 * sheet from the document menu, never a control on the page: a version is
 * written once a draft and read on every page.
 */
import { useRef, useState } from "react";
import { Button, Checkbox, PopupButton, Sheet } from "../ui";
import { AS_TYPED } from "../ui/as-typed";
import { useAnnouncedStatus } from "../ui/use-announced-status";
import type { HeaderFooterSlot } from "../format/spec";
import type { VersionPrint } from "../layout/furniture";

type Where = VersionPrint["in"];

const WHERE: { value: Where; label: string }[] = [
  { value: "header", label: "Header" },
  { value: "footer", label: "Footer" },
  { value: "none", label: "Title Page Only" },
];

const SIDES: { value: HeaderFooterSlot; label: string }[] = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
];

export function VersionSheet({
  version,
  print,
  titleLacksLine,
  onSave,
  onClose,
}: {
  /** The version as the title page keeps it. */
  version: string;
  /** Where it prints now: as the play says, or where it goes when it says nothing. */
  print: VersionPrint;
  /** The play's title page is a file with no line for the version. */
  titleLacksLine: boolean;
  /** `print` undefined: left as it is. Whether it was kept. */
  onSave: (text: string, print: VersionPrint | undefined, titleLine: boolean) => Promise<boolean>;
  onClose: () => void;
}) {
  const [text, setText] = useState(version);
  const [where, setWhere] = useState<Where>(print.in);
  const [side, setSide] = useState<HeaderFooterSlot>(print.in === "none" ? "left" : print.side);
  const [touched, setTouched] = useState(false);
  const [titleLine, setTitleLine] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);

  const chosen: VersionPrint = where === "none" ? { in: "none" } : { in: where, side };
  const help =
    error ??
    (where === "none"
      ? "Prints on the title page. Left empty, it prints nowhere."
      : `Prints on the title page and in the ${where} of every numbered page. Left empty, it prints nowhere.`);
  useAnnouncedStatus(help);

  const save = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      if (await onSave(text, touched ? chosen : undefined, titleLacksLine && titleLine)) onClose();
      else
        setError(
          "The version could not be saved. Check that this play is still open and writable, then try again.",
        );
    } catch {
      setError("The version could not be saved. Try again.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Play Version"
      width={440}
      onClose={onClose}
      onDefault={() => void save()}
      footer={
        <>
          <span className="sheet__spacer" />
          <Button onClick={onClose}>Cancel</Button>
          <Button treatment="primary" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="versionsheet formgrid">
        <label className="formgrid__label" htmlFor="play-version-text">
          Version
        </label>
        <input
          {...AS_TYPED}
          id="play-version-text"
          className="field"
          placeholder="Draft 3"
          aria-describedby="play-version-help"
          value={text}
          disabled={busy}
          onChange={(event) => {
            setText(event.target.value);
            setError(null);
          }}
        />
        <span className="formgrid__label">Also in</span>
        <PopupButton
          label="Also in"
          options={WHERE}
          value={where}
          disabled={busy}
          onChange={(next) => {
            setWhere(next);
            setTouched(true);
          }}
        />
        {where !== "none" && (
          <>
            <span className="formgrid__label">Side</span>
            <PopupButton
              label="Side"
              options={SIDES}
              value={side}
              disabled={busy}
              onChange={(next) => {
                setSide(next);
                setTouched(true);
              }}
            />
          </>
        )}
        {titleLacksLine && (
          <label className="versionsheet__check">
            <Checkbox
              on={titleLine}
              label="Add a Version line to the title page"
              onChange={setTitleLine}
              disabled={busy}
            />
            <span>Add a Version line to the title page</span>
          </label>
        )}
        <p className="sheet__hint versionsheet__hint" id="play-version-help">
          {help}
        </p>
      </div>
    </Sheet>
  );
}
