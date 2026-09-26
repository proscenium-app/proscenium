// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A `.pages` document, read directly (docs/app/importing/document-import.md#IMPT-87,
 * docs/app/importing/document-import.md#IMPT-88).
 *
 * The file is a ZIP holding `Index/*.iwa`; a package-form document is a folder
 * holding `Index.zip`, which reaches this reader zipped whole, its folder at
 * the root (how the web view hands over a package, and how Finder compresses
 * one). Under that, the document is an object graph (iwa.ts). The reader walks
 * only what it can account for:
 *
 *  - the body text storage the document names, split at paragraph breaks;
 *  - each paragraph's named style. A style entry without a style keeps the
 *    one before it in force, and an unnamed style (a one-off change made in
 *    the document) takes its name from the named style it varies;
 *  - bold, italic and underline, from the character style over the paragraph
 *    style, each followed through its parents;
 *  - tables and text boxes anchored in the text, where they are anchored, and
 *    those placed on the page, after the body; footnotes after that.
 *
 * Everything else is named in a notice and stays in the original.
 */
import type { InlineNode, MarkType } from "../fountain/model";
import { plain, type ImportDocument, type Paragraph } from "./model";
import { DAMAGED, iwaObjects, message, type IwaObject, type Message, type Value } from "./iwa";
import { zipParts } from "./xml";
import { assertDocumentText } from "../storage/read-limit";

const PASSWORD =
  "This Pages document is password-protected. Open it in Pages, remove the password, then import it again. Your document stays as it is.";
const TOO_OLD =
  "This document was saved by Pages ’09 or earlier. Open it in Pages, choose File › Export To › Word, then import the Word copy.";
const NOT_PAGES =
  "This is not a Pages word-processing document. If it came from Pages, open it there, choose File › Export To › Word, then import the Word copy.";
const TRACKED =
  "This Pages document has tracked changes. Accept or reject them in Pages first, or choose File › Export To › Word and import the Word copy, which keeps the current text.";

/** Message types, as Pages numbers them. */
const T = {
  document: 10000,
  storage: 2001,
  storageToo: 2005,
  drawableAttachment: 2003,
  shape: 2011,
  group: 3008,
  image: 3005,
  movie: 3007,
  chart: 5021,
  characterStyle: 2021,
  paragraphStyle: 2022,
  tableInfo: 6000,
  tableModel: 6001,
  tile: 6002,
  dataList: 6005,
  richText: 6218,
  comment: 3056,
  caption: 633,
  textFlow: 2410,
} as const;
/** A text storage's kind (its field 1) when it holds a footnote. */
const FOOTNOTE = 2;
const MAX_DEPTH = 16;

const ENTRY =
  /^(?:([^/]+)\/)?(Index\/.+\.iwa|Index\.zip|\.iwpv2?|index\.xml(?:\.gz)?|[^/]+\.pages)$/;

/** zipParts, with fflate's own failures turned into sentences. An encrypted
 * member shows up as a compression method no ZIP defines. */
function unzip(bytes: Uint8Array, wanted: (name: string) => boolean) {
  try {
    return zipParts(bytes, wanted);
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    if (typeof code !== "number") throw e;
    throw new Error(code === 14 ? PASSWORD : NOT_PAGES);
  }
}

/** The `Index/*.iwa` files, in name order, whichever form the document came in. */
export function pagesArchives(bytes: Uint8Array, nested = false): Uint8Array[] {
  const parts = unzip(bytes, (name) => !name.startsWith("__MACOSX/") && ENTRY.test(name));
  // One root holds the document: the ZIP's own, or the one folder a package was zipped in.
  const roots = new Map<string, string[]>();
  for (const name of Object.keys(parts)) {
    const [, root = "", rest] = ENTRY.exec(name)!;
    roots.set(root, [...(roots.get(root) ?? []), rest]);
  }
  const indexed = [...roots.keys()].filter((r) =>
    roots.get(r)!.some((rest) => rest.startsWith("Index")),
  );
  if (indexed.length > 1 && !indexed.includes(""))
    throw new Error(
      "This archive holds more than one document. Choose one Pages document at a time.",
    );
  const root = indexed.includes("") || !indexed.length ? "" : indexed[0];
  const rest = roots.get(root) ?? [];
  const at = (r: string) => parts[root ? `${root}/${r}` : r];
  if (rest.some((r) => r.startsWith(".iwpv"))) throw new Error(PASSWORD);
  let index = parts;
  let prefix = root ? `${root}/` : "";
  if (rest.includes("Index.zip")) {
    index = unzip(at("Index.zip"), (name) => /^Index\/.+\.iwa$/.test(name));
    prefix = "";
  }
  const files = Object.keys(index)
    .filter((n) => n.startsWith(`${prefix}Index/`) && n.endsWith(".iwa"))
    .sort()
    .map((n) => index[n]);
  if (files.length) return files;
  if (rest.some((r) => r.startsWith("index.xml"))) throw new Error(TOO_OLD);
  // A single-file document compressed on its own: one level down, once.
  const inner = rest.find((r) => r.endsWith(".pages"));
  if (inner && !nested) return pagesArchives(at(inner), true);
  throw new Error(NOT_PAGES);
}

const utf8 = new TextDecoder("utf-8", { fatal: true });
function text(value: Value | undefined): string {
  if (!(value instanceof Uint8Array)) return "";
  try {
    return utf8.decode(value);
  } catch {
    throw new Error(DAMAGED);
  }
}

interface Run {
  at: number;
  id?: number;
}

export function readPages(name: string, bytes: Uint8Array): ImportDocument {
  const objects = iwaObjects(pagesArchives(bytes));
  const parsed = new Map<number, Message>();
  const obj = (id: number | undefined, ...types: number[]): Message | undefined => {
    if (id === undefined) return undefined;
    const o: IwaObject | undefined = objects.get(id);
    if (!o || (types.length && !types.includes(o.type))) return undefined;
    let m = parsed.get(id);
    if (!m) parsed.set(id, (m = message(o.data)));
    return m;
  };
  const sub = (m: Message | undefined, no: number): Message | undefined => {
    const v = m?.get(no)?.[0];
    return v instanceof Uint8Array ? message(v) : undefined;
  };
  const num = (m: Message | undefined, no: number): number | undefined => {
    const v = m?.get(no)?.[0];
    return typeof v === "number" ? v : undefined;
  };
  /** The object a reference field points at. */
  const ref = (m: Message | undefined, no: number) => num(sub(m, no), 1);
  const refs = (m: Message | undefined, no: number) =>
    (m?.get(no) ?? [])
      .flatMap((v) => (v instanceof Uint8Array ? [num(message(v), 1)] : []))
      .filter((id): id is number => id !== undefined);
  /** An attribute table: where each run starts, and the object it applies. */
  const runs = (storage: Message, no: number): Run[] =>
    (sub(storage, no)?.get(1) ?? [])
      .flatMap((v) => (v instanceof Uint8Array ? [message(v)] : []))
      .map((e) => ({ at: num(e, 1) ?? 0, id: ref(e, 2) }))
      .sort((a, b) => a.at - b.at);

  const docId = [...objects].find(([, o]) => o.type === T.document)?.[0];
  const doc = obj(docId);
  const bodyId = ref(doc, 4);
  const body = obj(bodyId, T.storage, T.storageToo);
  if (!doc || !body) throw new Error(NOT_PAGES);
  for (const table of [21, 22])
    if (runs(body, table).some((r) => r.id !== undefined)) throw new Error(TRACKED);

  // Styles: a name from the style or the named style it varies; marks from the
  // nearest style in the chain that sets each one.
  const styleName = (id: number | undefined, depth = 0): string | undefined => {
    const style = obj(id, T.paragraphStyle, T.characterStyle);
    if (!style || depth > MAX_DEPTH) return undefined;
    const base = sub(style, 1);
    return text(base?.get(1)?.[0]) || styleName(ref(base, 3), depth + 1);
  };
  const MARKS: [MarkType, number][] = [
    ["strong", 1],
    ["em", 2],
    ["underline", 11],
  ];
  const styleMarks = (id: number | undefined, mark: number, depth = 0): boolean | undefined => {
    const style = obj(id, T.paragraphStyle, T.characterStyle);
    if (!style || depth > MAX_DEPTH) return undefined;
    const own = num(sub(style, 11), mark);
    return own !== undefined ? own !== 0 : styleMarks(ref(sub(style, 1), 3), mark, depth + 1);
  };
  const markCache = new Map<string, MarkType[]>();
  const marksOf = (para: number | undefined, char: number | undefined): MarkType[] => {
    const key = `${para}:${char}`;
    let marks = markCache.get(key);
    if (!marks) {
      marks = MARKS.filter(([, no]) => styleMarks(char, no) ?? styleMarks(para, no) ?? false).map(
        ([m]) => m,
      );
      markCache.set(key, marks);
    }
    return marks;
  };

  const notices = new Set<string>([
    "Page layout, fonts, headers and footers are replaced by your Proscenium script format.",
  ]);
  const read = new Set<number>();
  let unreadCells = 0;

  /** A storage's paragraphs, with what is anchored in each placed after it. */
  const storageParagraphs = (id: number | undefined, depth: number): Paragraph[] => {
    const storage = obj(id, T.storage, T.storageToo);
    if (!storage || id === undefined || read.has(id) || depth > MAX_DEPTH) return [];
    read.add(id);
    const source = (storage.get(3) ?? []).map(text).join("");
    assertDocumentText(source);
    const styles = runs(storage, 5);
    // An entry without a style keeps the previous one in force.
    for (let i = 1; i < styles.length; i++) styles[i].id ??= styles[i - 1].id;
    const chars = runs(storage, 8);
    const anchors = new Map(
      runs(storage, 9).flatMap((r) => (r.id === undefined ? [] : [[r.at, r.id] as const])),
    );
    const result: Paragraph[] = [];
    let s = -1;
    let c = -1;
    let content: InlineNode[] = [];
    let pending = "";
    let pendingMarks: MarkType[] = [];
    let anchored: number[] = [];
    let paraStyle: number | undefined;
    const flush = () => {
      if (pending)
        content.push({
          type: "text",
          text: pending,
          ...(pendingMarks.length ? { marks: pendingMarks.map((type) => ({ type })) } : {}),
        });
      pending = "";
    };
    const append = (value: string, marks: MarkType[]) => {
      if (marks.join() !== pendingMarks.join()) {
        flush();
        pendingMarks = marks;
      }
      pending += value;
    };
    let start = true;
    for (let i = 0; i <= source.length; i++) {
      if (start) {
        while (s + 1 < styles.length && styles[s + 1].at <= i) s++;
        paraStyle = s >= 0 ? styles[s].id : undefined;
        start = false;
      }
      const code = i < source.length ? source.charCodeAt(i) : -1;
      // Paragraph, section, page and column breaks all end a paragraph.
      if (
        code === -1 ||
        code === 0x0a ||
        code === 0x2029 ||
        code === 0x04 ||
        code === 0x05 ||
        code === 0x0c
      ) {
        flush();
        result.push({ content, style: styleName(paraStyle) ?? "Unstyled" });
        for (const a of anchored) result.push(...drawable(a, depth + 1));
        content = [];
        anchored = [];
        start = true;
        continue;
      }
      while (c + 1 < chars.length && chars[c + 1].at <= i) c++;
      const marks = marksOf(paraStyle, c >= 0 ? chars[c].id : undefined);
      if (code === 0x09) append("\t", marks);
      else if (code === 0x2028 || code === 0x0d || code === 0x0b) append("\n", marks);
      else if (code === 0xfffc) {
        const a = anchors.get(i);
        if (a !== undefined) anchored.push(a);
      } else if (code >= 0x20) append(source[i], marks);
      // Other control characters, a footnote's mark among them, carry no text.
    }
    return result;
  };

  /** A text box's storage: the flow it shares with the boxes linked to it,
   * then its own (field 4 in current files, field 2 before them). */
  const shapeStorage = (shape: Message | undefined) =>
    ref(obj(ref(shape, 3), T.textFlow), 1) ?? ref(shape, 4) ?? ref(shape, 2);
  /** A drawable's visible title and caption around its own text. A drawable
   * without one points at a stand-in that holds no text. */
  const labelled = (base: Message | undefined, own: Paragraph[], depth: number): Paragraph[] => {
    const label = (no: number, hidden: number) =>
      num(base, hidden)
        ? []
        : storageParagraphs(shapeStorage(sub(obj(ref(base, no), T.caption), 1)), depth + 1);
    return [...label(10, 12), ...own, ...label(11, 13)];
  };

  /** A drawable's text: a text box, a table, or the members of a group. */
  const drawable = (id: number, depth: number): Paragraph[] => {
    const o = obj(id);
    if (!o || depth > MAX_DEPTH) return [];
    switch (objects.get(id)!.type) {
      case T.drawableAttachment:
        return drawable(ref(o, 1) ?? -1, depth + 1);
      case T.shape:
        return labelled(sub(sub(o, 1), 1), storageParagraphs(shapeStorage(o), depth + 1), depth);
      case T.group:
        return labelled(
          sub(o, 1),
          refs(o, 2).flatMap((child) => drawable(child, depth + 1)),
          depth,
        );
      case T.tableInfo:
        notices.add("Tables are read cell by cell, in row order. Check any side-by-side dialogue.");
        return labelled(sub(o, 1), table(ref(o, 2), depth + 1), depth);
      case T.image:
      case T.movie:
      case T.chart:
        notices.add("Images, charts and drawings stay in the original file.");
        return labelled(sub(o, 1), [], depth);
      default:
        return [];
    }
  };

  /** A table's cells, row by row. Text cells carry across; a number, date or
   * formula is counted and left in the original rather than guessed at. */
  const table = (id: number | undefined, depth: number): Paragraph[] => {
    const model = obj(id, T.tableModel);
    const store = sub(model, 4);
    const columns = num(model, 7) ?? 0;
    if (!store || !columns) return [];
    const entries = (listId: number | undefined) => {
      const list = obj(listId, T.dataList);
      return [list, ...refs(list, 4).map((s) => obj(s))].flatMap((part) =>
        (part?.get(3) ?? []).flatMap((v) => (v instanceof Uint8Array ? [message(v)] : [])),
      );
    };
    const strings = new Map(entries(ref(store, 4)).map((e) => [num(e, 1), text(e.get(3)?.[0])]));
    const rich = new Map(
      entries(ref(store, 17)).map((e) => [num(e, 1), ref(obj(ref(e, 9), T.richText), 1)]),
    );
    const cells: Paragraph[] = [];
    const tiles = (sub(store, 3)?.get(1) ?? [])
      .flatMap((v) => (v instanceof Uint8Array ? [message(v)] : []))
      .map((t) => ({ order: num(t, 1) ?? 0, tile: obj(ref(t, 2), T.tile) }))
      .sort((a, b) => a.order - b.order);
    for (const { tile } of tiles) {
      const rows = (tile?.get(5) ?? [])
        .flatMap((v) => (v instanceof Uint8Array ? [message(v)] : []))
        .sort((a, b) => (num(a, 1) ?? 0) - (num(b, 1) ?? 0));
      for (const row of rows) {
        // Current files keep a second copy of each row in fields 6 and 7, with
        // offsets in fours when field 8 says so; older ones have only 3 and 4.
        const current =
          row.get(6)?.[0] instanceof Uint8Array && row.get(7)?.[0] instanceof Uint8Array;
        const buffer = row.get(current ? 6 : 3)?.[0];
        const offsets = row.get(current ? 7 : 4)?.[0];
        if (!(buffer instanceof Uint8Array) || !(offsets instanceof Uint8Array)) continue;
        const scale = current && num(row, 8) ? 4 : 1;
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        const offsetView = new DataView(offsets.buffer, offsets.byteOffset, offsets.byteLength);
        for (let column = 0; column < Math.min(columns, offsets.byteLength >> 1); column++) {
          const offset = offsetView.getInt16(column * 2, true);
          if (offset < 0) continue;
          const cell = cellValue(view, offset * scale);
          if (!cell) continue;
          if (cell.kind === "unread") unreadCells++;
          else if (cell.kind === "text")
            for (const line of (strings.get(cell.key) ?? "").split(/\r\n?|\n|\u2028|\u2029/))
              cells.push({ content: plain(line), style: "Table" });
          else cells.push(...storageParagraphs(rich.get(cell.key), depth + 1));
        }
      }
    }
    return cells;
  };

  const paragraphs = storageParagraphs(bodyId, 0);
  // What sits on the page rather than in the text, in the order the document lists it.
  const placed = refs(obj(ref(doc, 20)), 1).flatMap((id) => (id === bodyId ? [] : drawable(id, 1)));
  if (placed.some((p) => p.content.length)) {
    if (paragraphs.some((p) => p.content.length)) {
      paragraphs.push({
        content: plain("Text boxes from the original document"),
        style: "Text Boxes",
        kind: "action",
      });
      notices.add(
        "Text boxes and tables placed on the page are included at the end of the script. Move them where they belong.",
      );
    }
    paragraphs.push(...placed);
  }
  // Footnotes, in the order their marks appear, then any the marks did not reach.
  const noteStorages = (id: number | undefined) =>
    [...(obj(id)?.values() ?? [])].flat().flatMap((v) => {
      if (!(v instanceof Uint8Array)) return [];
      try {
        const target = num(message(v), 1);
        const storage = obj(target, T.storage, T.storageToo);
        return storage && num(storage, 1) === FOOTNOTE ? [target!] : [];
      } catch {
        return [];
      }
    });
  const notes = [
    ...runs(body, 16).flatMap((r) => noteStorages(r.id)),
    ...[...objects]
      .filter(([, o]) => o.type === T.storage || o.type === T.storageToo)
      .map(([id]) => id)
      .filter((id) => num(obj(id), 1) === FOOTNOTE),
  ].flatMap((id) => storageParagraphs(id, 1).map((p) => ({ ...p, kind: "action" as const })));
  if (notes.some((p) => p.content.length)) {
    paragraphs.push(
      {
        content: plain("Footnotes from the original document"),
        style: "Footnotes",
        kind: "action",
      },
      ...notes,
    );
    notices.add(
      "Footnotes are included at the end of the script. Their original marks stay in the Pages file.",
    );
  }
  if (unreadCells)
    notices.add(
      `${unreadCells === 1 ? "One table cell holds" : `${unreadCells} table cells hold`} a number, date or formula. Those values stay in the original file.`,
    );
  if ([...objects.values()].some((o) => o.type === T.comment))
    notices.add("Comments stay in the Pages file.");
  return { name, format: "Pages", paragraphs, frontMatter: {}, notices: [...notices] };
}

/** Where a cell's text lives: a key into the table's strings or its rich text.
 * Two layouts, told apart by the first byte; the flags say which values follow. */
function cellValue(
  view: DataView,
  at: number,
): { kind: "text" | "rich"; key: number } | { kind: "unread" } | null {
  if (at < 0 || at + 12 > view.byteLength) return null;
  const version = view.getUint8(at);
  const type = view.getUint8(at + 1);
  // 0 is an empty cell and 1 one covered by a merge.
  if (type === 0 || type === 1) return null;
  let key: number | undefined;
  let richKey: number | undefined;
  if (version === 5) {
    const flags = view.getUint32(at + 8, true);
    let o = at + 12;
    // A decimal, a double, a date, then the keys of the text and styled text.
    for (const [flag, width] of [
      [0x1, 16],
      [0x2, 8],
      [0x4, 8],
      [0x8, 4],
      [0x10, 4],
    ] as const) {
      if (!(flags & flag)) continue;
      if (o + width > view.byteLength) return null;
      if (flag === 0x8) key = view.getUint32(o, true);
      if (flag === 0x10) richKey = view.getUint32(o, true);
      o += width;
    }
  } else if (version === 4) {
    const flags = view.getUint16(at + 4, true);
    let o = at + 12;
    // Cell style, paragraph style, two conditions, format, formula, comment,
    // text, number, date, styled text: each value present, in this order.
    for (const [flag, width] of [
      [0x2, 4],
      [0x80, 4],
      [0x800, 4],
      [0x400, 4],
      [0x4, 4],
      [0x8, 4],
      [0x1000, 4],
      [0x10, 4],
      [0x20, 8],
      [0x40, 8],
      [0x200, 4],
    ] as const) {
      if (!(flags & flag)) continue;
      if (o + width > view.byteLength) return null;
      if (flag === 0x10) key = view.getUint32(o, true);
      if (flag === 0x200) richKey = view.getUint32(o, true);
      o += width;
    }
  } else return { kind: "unread" };
  if (type === 3 && key !== undefined) return { kind: "text", key };
  if (type === 9 && richKey !== undefined) return { kind: "rich", key: richKey };
  return { kind: "unread" };
}
