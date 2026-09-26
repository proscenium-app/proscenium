// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useMemo, useRef, useState } from "react";
import { paginateFrontMatter } from "../layout";
import { anonymousFrontMatter, identityOf } from "../pdf/anonymous";
import type { FrontSheet } from "../pdf/plan";
import type { ExportFileType } from "../storage/ipc";
import { compareByWeight } from "../workspace";
import type { Workspace } from "./useWorkspace";
import { ExportPanel, type ExportAction } from "./ExportPanel";

export type { ExportAction } from "./ExportPanel";

/** What the writer asked for: File ▸ Export PDF…, Export .docx…, Export
 * .odt… or Print…. The one dialog does them all; the request only decides
 * which is the default. */
export interface ExportRequest {
  /** Open on one character's sides rather than the whole script. */
  sidesFor: string | null;
  /** Omitted: export. */
  action?: ExportAction;
  /** The file type the dialog opens on; omitted, a PDF. */
  type?: ExportFileType;
}

/**
 * The export dialog's data: the play paginated once, on open. Kept out of
 * ExportPanel so the panel stays a pure function of pages — and out of the
 * app's render path, since nothing pays for pagination until the writer asks
 * to export or print.
 *
 * The Part select (whole script vs one character's sides, backlog P5) lives at
 * this level because changing it changes the PAGINATION, not a filter over it:
 * the panel is remounted (`key`) so its page selection starts fresh — a range
 * chosen against the script means nothing against the sides.
 *
 * The front-sheet choice lives here too, for the opposite reason: a title page
 * and a cast list mean the same thing in front of the sides as in front of the
 * script, so a choice the writer made survives changing the part. Until they
 * make one (`null`), the panel follows its default.
 *
 * So does the file type (docs/app/formatting/formats-and-layout.md#FMT-145):
 * a PDF, a .docx or an .odt of the same pages is still the same choice after
 * the part changes.
 *
 * So does the anonymous copy (docs/app/formatting/formats-and-layout.md#FMT-143):
 * it changes what the title page and the headers print, so the pages are laid
 * out again, and the choice survives changing the part. It is never saved —
 * each export starts with the writer's name on it.
 */
export function ExportDialog(props: {
  ws: Pick<
    Workspace,
    | "castWeights"
    | "frontMatter"
    | "format"
    | "scriptTitle"
    | "playLanguage"
    | "exporting"
    | "savePlayLanguage"
    | "openScriptKey"
    | "exportScript"
    | "layoutForExport"
    | "layoutMeta"
  >;
  initialSidesFor: string | null;
  action: ExportAction;
  /** The menu item's request, as asked: each new one sets the file type it names. */
  request: ExportRequest;
  onClose: () => void;
}) {
  const { ws } = props;
  const { layoutForExport } = ws;
  const [sidesFor, setSidesFor] = useState<string | null>(props.initialSidesFor);
  const [frontChoice, setFrontChoice] = useState<FrontSheet[] | null>(null);
  const [anonymous, setAnonymous] = useState(false);
  const [fileType, setFileType] = useState<ExportFileType>(props.request.type ?? "pdf");
  // Export .docx… with the dialog already open asks for a .docx, whatever the
  // writer switched it to since (docs/app/formatting/formats-and-layout.md#FMT-145).
  useEffect(() => setFileType(props.request.type ?? "pdf"), [props.request]);
  const [savingLanguage, setSavingLanguage] = useState<ExportAction | null>(null);
  const [languageError, setLanguageError] = useState<string | null>(null);
  const languageSavePending = useRef(false);
  const layout = useMemo(() => layoutForExport(sidesFor, anonymous), [layoutForExport, sidesFor, anonymous]);
  // Anyone with lines can have sides, heaviest part first.
  const characters = useMemo(
    () =>
      [...ws.castWeights.keys()]
        .filter((name) => (ws.castWeights.get(name)?.lines ?? 0) > 0)
        .sort((a, b) => compareByWeight(a, b, ws.castWeights)),
    [ws.castWeights],
  );
  // The same pages the renderer draws, for the script and the sides alike.
  const fallbackTitle = ws.layoutMeta.title || ws.scriptTitle;
  const frontPages = useMemo(
    () =>
      paginateFrontMatter(anonymous ? anonymousFrontMatter(ws.frontMatter, fallbackTitle) : ws.frontMatter, ws.format),
    [ws.frontMatter, ws.format, anonymous, fallbackTitle],
  );
  const identity = useMemo(() => identityOf(ws.frontMatter), [ws.frontMatter]);
  if (!layout) return null;
  return (
    <ExportPanel
      key={sidesFor ?? ""}
      scriptTitle={sidesFor ? `${ws.scriptTitle} — ${sidesFor} sides` : ws.scriptTitle}
      spec={ws.format}
      layout={layout}
      frontPages={frontPages}
      frontChoice={frontChoice}
      onFrontChoice={setFrontChoice}
      characters={characters}
      sidesFor={sidesFor}
      onSidesFor={setSidesFor}
      anonymous={anonymous}
      onAnonymous={setAnonymous}
      fileType={fileType}
      onFileType={setFileType}
      identity={identity}
      action={props.action}
      language={ws.playLanguage}
      languageError={languageError}
      busy={savingLanguage ?? (ws.exporting ? props.action : null)}
      onExport={async ({ language, action, ...opts }) => {
        if (languageSavePending.current) return;
        languageSavePending.current = true;
        setSavingLanguage(action);
        setLanguageError(null);
        try {
          if (!(await ws.savePlayLanguage(language, ws.openScriptKey))) {
            setLanguageError(
              "The language could not be saved. Check that this play is still open and writable, then try again.",
            );
            return;
          }
          ws.exportScript({ ...opts, sidesFor, anonymous, type: fileType, to: action === "print" ? "print" : "file" });
          props.onClose();
        } finally {
          languageSavePending.current = false;
          setSavingLanguage(null);
        }
      }}
      onClose={props.onClose}
    />
  );
}
