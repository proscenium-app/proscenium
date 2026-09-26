// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where each scene sits in the paginated script, and how long it runs.
 *
 * This is what turns the board and the outline from an index into a pacing
 * instrument: "Act One is running long", "scene 3 is four pages of two people
 * agreeing". Length is read in pages, the unit the element bar counts in. The
 * act totals carried a minute estimate, one page to a minute, until that was
 * dropped: a page is not a minute.
 *
 * Derived, never stored (storage rule 3): it comes from the same `paginate()`
 * every other surface uses, so a scene's pages here and the page breaks in the
 * editor and the PDF can never disagree.
 */
import type { Doc } from "../fountain/model";
import type { FormatSpec } from "../format";
import { blocksFromDoc, paginate, type LayoutMeta } from "./engine";

export interface ScenePages {
  /** 0-based scene ordinal — matches `extractScenes` and the card records. */
  ordinal: number;
  /** Act this scene belongs to, if the script has acts. */
  act: string | null;
  /** 1-based printed page the scene starts on. */
  firstPage: number;
  /** 1-based printed page it ends on. */
  lastPage: number;
  /** Pages it touches (a scene inside one page is 1). */
  pages: number;
}

export interface ActPages {
  act: string;
  firstPage: number;
  lastPage: number;
  pages: number;
  /** Scene ordinals in this act, in order. */
  scenes: number[];
}

export interface ScenePageMap {
  scenes: ScenePages[];
  acts: ActPages[];
  /** Printed pages in the whole script. */
  totalPages: number;
}

const EMPTY: ScenePageMap = { scenes: [], acts: [], totalPages: 0 };

/**
 * Page ranges for every scene in the document.
 *
 * Scene boundaries follow `extractScenes`' priority — structural `scene` (`##`)
 * blocks when the script has any, otherwise `sceneHeading` slug lines — so the
 * ordinals line up with the cards the board and outline already hold.
 */
export function scenePageMap(
  doc: Doc | null,
  spec: FormatSpec,
  meta: LayoutMeta = {},
): ScenePageMap {
  if (!doc || doc.content.length === 0) return EMPTY;
  const blocks = doc.content;
  const boundary = blocks.some((b) => b.type === "scene") ? "scene" : "sceneHeading";

  // Where each scene starts, in source-index terms, plus the act it sits under.
  const starts: { ordinal: number; index: number; act: string | null }[] = [];
  let act: string | null = null;
  blocks.forEach((block, index) => {
    if (block.type === "act") {
      act = (block.content ?? []).map((n) => (n.type === "text" ? n.text : "")).join("");
    }
    if (block.type === boundary) starts.push({ ordinal: starts.length, index, act });
  });
  if (starts.length === 0) return { ...EMPTY, totalPages: countPages(doc, spec, meta) };

  const { pages } = paginate(blocksFromDoc(doc, spec), spec, meta);
  // First and last printed page each source block appears on. Non-printing
  // blocks (a synopsis) never appear, which is correct — they take no space.
  const firstOn = new Map<number, number>();
  const lastOn = new Map<number, number>();
  pages.forEach((page) => {
    for (const line of page.lines) {
      if (line.sourceIndex < 0) continue; // the synthetic (CONT'D) cue
      if (!firstOn.has(line.sourceIndex)) firstOn.set(line.sourceIndex, page.pageNumber);
      lastOn.set(line.sourceIndex, page.pageNumber);
    }
  });

  const scenes: ScenePages[] = starts.map((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].index - 1 : blocks.length - 1;
    let first = Infinity;
    let last = 0;
    for (let idx = start.index; idx <= end; idx++) {
      const f = firstOn.get(idx);
      const l = lastOn.get(idx);
      if (f !== undefined && f < first) first = f;
      if (l !== undefined && l > last) last = l;
    }
    // A scene of nothing but non-printing blocks lands wherever it begins.
    if (first === Infinity) {
      first = firstOn.get(start.index) ?? 1;
      last = first;
    }
    return {
      ordinal: start.ordinal,
      act: start.act,
      firstPage: first,
      lastPage: last,
      pages: last - first + 1,
    };
  });

  return { scenes, acts: rollUpActs(scenes), totalPages: pages.length };
}

function rollUpActs(scenes: readonly ScenePages[]): ActPages[] {
  const out: ActPages[] = [];
  for (const scene of scenes) {
    if (!scene.act) continue;
    const current = out[out.length - 1];
    if (current && current.act === scene.act) {
      current.lastPage = Math.max(current.lastPage, scene.lastPage);
      current.firstPage = Math.min(current.firstPage, scene.firstPage);
      current.pages = current.lastPage - current.firstPage + 1;
      current.scenes.push(scene.ordinal);
    } else {
      out.push({
        act: scene.act,
        firstPage: scene.firstPage,
        lastPage: scene.lastPage,
        pages: scene.lastPage - scene.firstPage + 1,
        scenes: [scene.ordinal],
      });
    }
  }
  return out;
}

function countPages(doc: Doc, spec: FormatSpec, meta: LayoutMeta): number {
  return paginate(blocksFromDoc(doc, spec), spec, meta).pages.length;
}

/** "pp. 4–9" for a span, "p. 4" for a scene that fits inside one page. */
export function pageRangeLabel(scene: ScenePages): string {
  return scene.firstPage === scene.lastPage
    ? `Page ${scene.firstPage}`
    : `Pages ${scene.firstPage}–${scene.lastPage}`;
}

/** "6 pp", "1 p." — the length, in the unit a playwright thinks in. */
export function pageCountLabel(pages: number): string {
  return pages === 1 ? "1 page" : `${pages} pages`;
}
