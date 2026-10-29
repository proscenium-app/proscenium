// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What changed between two texts, in one of two looks
 * (docs/app/keeping-work/storage-and-file-format.md#STOR-177).
 *
 * **On the Page** is the redline: the text as it stands, cut words struck
 * through and added ones underlined where they are. A script is drawn by the
 * script's own page, and a document (a note, a sheet, an outline) by its own,
 * headings and lists as it is written; the shell hands both in (`scriptPage`,
 * `documentPage`): the editors stand above this module, so Changes cannot
 * reach for them. Any other text, and either when no page was handed in, is
 * drawn here as plain lines.
 *
 * **Line by Line** is the list of added and removed lines Changes always had:
 * the file as it is stored, opening pages and markup included.
 */
import { useMemo, type ReactNode } from "react";
import { compactDiff, diffLines } from "./diff";
import {
  compactRedline,
  lineUnits,
  redlineRows,
  type RedlineRow,
  type RedlineUnit,
} from "./redline";

export type ChangesLook = "page" | "lines";

/** Draws a script's redline on the script's own page. */
export type ScriptPage = (props: { before: string; after: string; label: string }) => ReactNode;

/** Draws a document's redline on the document's own page. */
export type DocumentPage = ScriptPage;

const LOOK_KEY = "proscenium.changes.look";

/** The look last chosen on this Mac: the page, until Line by Line is. */
export function readLook(): ChangesLook {
  try {
    return localStorage.getItem(LOOK_KEY) === "lines" ? "lines" : "page";
  } catch {
    return "page";
  }
}

export function writeLook(look: ChangesLook): void {
  try {
    localStorage.setItem(LOOK_KEY, look);
  } catch {
    /* a look that is not remembered is still shown */
  }
}

/** True for a path the script's page can draw. */
export function isScriptPath(path: string): boolean {
  return /\.fountain$/i.test(path);
}

/** True for a path a document's page can draw: a note, a sheet, an outline. */
export function isDocumentPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

export function Comparison({
  before,
  after,
  look,
  script,
  scriptPage,
  document = false,
  documentPage,
  label,
}: {
  before: string;
  after: string;
  look: ChangesLook;
  /** The texts are a script's. */
  script: boolean;
  scriptPage?: ScriptPage;
  /** The texts are a document's: Markdown, drawn as it is written. */
  document?: boolean;
  documentPage?: DocumentPage;
  /** What is compared, as the region around it is named. */
  label: string;
}) {
  if (look === "lines") return <DiffLines before={before} after={after} />;
  if (script && scriptPage) return <>{scriptPage({ before, after, label })}</>;
  if (document && documentPage) return <>{documentPage({ before, after, label })}</>;
  return <RedlineText before={before} after={after} label={label} />;
}

function DiffLines({ before, after }: { before: string; after: string }) {
  const rows = useMemo(() => compactDiff(diffLines(before, after)), [before, after]);
  return (
    <>
      {rows.map((r, i) =>
        r.kind === "skip" ? (
          <div key={i} className="diffline diffline--skip">
            ⋯ {r.count} unchanged lines
          </div>
        ) : (
          <div key={i} className={`diffline diffline--${r.kind}`}>
            {/* A mark as well as a colour, and a word for whoever hears it. */}
            <span aria-hidden="true">{r.kind === "add" ? "+" : r.kind === "del" ? "−" : " "} </span>
            {r.kind === "add" && <span className="sr-only">Added: </span>}
            {r.kind === "del" && <span className="sr-only">Removed: </span>}
            {r.text}
          </div>
        ),
      )}
    </>
  );
}

function words(unit: RedlineUnit, at: readonly number[]): string {
  return at.map((i) => unit.tokens[i].key).join("");
}

function lineContent(row: RedlineRow, a: RedlineUnit[], b: RedlineUnit[]): ReactNode {
  const all = (unit: RedlineUnit) => unit.tokens.map((t) => t.key).join("");
  switch (row.state) {
    case "same":
      return all(b[row.b]);
    case "add":
      return <ins className="redline-add">{all(b[row.b])}</ins>;
    case "del":
      return <del className="redline-del">{all(a[row.a])}</del>;
    case "mod":
      return row.parts.map((part, i) =>
        part.state === "del" ? (
          <del key={i} className="redline-del">
            {words(a[row.a], part.a)}
          </del>
        ) : part.state === "add" ? (
          <ins key={i} className="redline-add">
            {words(b[row.b], part.b)}
          </ins>
        ) : (
          <span key={i}>{words(b[row.b], part.b)}</span>
        ),
      );
  }
}

/** A changed line with words on it: an empty line added or cut carries no rule in the margin. */
function marked(row: RedlineRow, a: RedlineUnit[], b: RedlineUnit[]): boolean {
  if (row.state === "same") return false;
  const unit = row.state === "del" ? a[row.a] : b[row.b];
  return row.state === "mod" || unit.tokens.some((t) => t.word);
}

/** A redline of any text: its lines as they stand, the changed words marked. */
function RedlineText({ before, after, label }: { before: string; after: string; label: string }) {
  const { a, b, items } = useMemo(() => {
    const a = lineUnits(before);
    const b = lineUnits(after);
    return { a, b, items: compactRedline(redlineRows(a, b), 2) };
  }, [before, after]);
  return (
    <div className="redline redline--text" role="group" aria-label={label}>
      {items.map((item, i) =>
        item.kind === "skip" ? (
          <div
            key={i}
            className="redline-skip"
            role="separator"
            aria-label={`${item.count} unchanged lines not shown`}
          >
            <span className="redline-skip__dots" aria-hidden="true">
              ⋯
            </span>
          </div>
        ) : (
          <p
            key={i}
            className="redline-line"
            data-redline={marked(item.row, a, b) ? item.row.state : undefined}
          >
            {lineContent(item.row, a, b)}
            {/* An empty line still takes its line. */}
            {"\n"}
          </p>
        ),
      )}
    </div>
  );
}
