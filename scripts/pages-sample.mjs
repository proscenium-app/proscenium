// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Harbor.pages, a synthetic Pages document for the unit tests and smoke
 * (docs/app/importing/document-import.md#IMPT-87): the Harbor scene of
 * src/import/fixtures/Harbor.rtf, in a playwright's own paragraph styles.
 *
 * Synthetic on purpose (2026-09-24): fixtures ship with the code, so no
 * one's play is one. Real documents were checked where they live and are
 * never committed. This writes the
 * layout those documents have: `Index/*.iwa` files, each one chunk of raw
 * Snappy (literals only, which is valid Snappy) holding objects, and a body
 * whose paragraph-style table has an entry at every paragraph, naming a style
 * only where it changes, as Pages writes it.
 *
 * It runs in Node for browser smoke and inside the page for the native
 * self-test, so it uses nothing but fflate and the platform.
 */
import { strToU8, zipSync } from "fflate";

const varint = (n) => {
  const out = [];
  do {
    const b = n % 128;
    n = Math.floor(n / 128);
    out.push(n ? b | 128 : b);
  } while (n);
  return out;
};
/** A protocol-buffer message from [field, value] pairs: a number, a string,
 * bytes, or the pairs of a nested message. */
function message(fields) {
  const out = [];
  for (const [no, v] of fields) {
    if (typeof v === "number") out.push(...varint(no * 8), ...varint(v));
    else {
      const b = typeof v === "string" ? strToU8(v) : v instanceof Uint8Array ? v : message(v);
      out.push(...varint(no * 8 + 2), ...varint(b.length), ...b);
    }
  }
  return new Uint8Array(out);
}
const ref = (id) => [[1, id]];
/** Objects [id, type, fields] as one `.iwa` chunk. */
function iwa(objects) {
  const stream = [];
  for (const [id, type, fields] of objects) {
    const data = message(fields);
    const info = message([[1, id], [2, [[1, type], [3, data.length]]]]);
    stream.push(...varint(info.length), ...info, ...data);
  }
  const block = [...varint(stream.length)];
  for (let i = 0; i < stream.length; i += 60) {
    const piece = stream.slice(i, i + 60);
    block.push((piece.length - 1) << 2, ...piece);
  }
  return new Uint8Array([0, block.length & 255, (block.length >> 8) & 255, block.length >> 16, ...block]);
}
const style = (id, type, name, parent, marks) => [
  id,
  type,
  [[1, [...(name ? [[1, name]] : []), ...(parent ? [[3, ref(parent)]] : []), [5, ref(100)]]], ...(marks ? [[11, marks]] : [])],
];

/** The scene, a line per paragraph, with the style each is set in. */
export const HARBOR = [
  ["ACT ONE", "Act"],
  ["Scene 1. The waiting room.", "Scene"],
  ["A harbor office after the last ferry.", "Stage Direction"],
  ["Rain at the windows.", "Stage Direction"],
  ["MARA", "Character"],
  ["You said it would wait.", "Dialogue"],
  ["ELI", "Character"],
  ["(folding the timetable)", "Parenthetical"],
  ["I said we had time.", "Dialogue"],
  // Made italic in the document: Pages keeps that as an unnamed variation.
  ["She sets down a small blue suitcase.", "Stage Direction*"],
  ["MARA", "Character"],
  ["There is a difference.", "Dialogue"],
  ["LIGHTS OUT.", "Stage Direction"],
];

const STYLE_IDS = { Act: 101, Scene: 102, "Stage Direction": 103, Character: 104, Dialogue: 105, Parenthetical: 106, "Stage Direction*": 108 };

/** The `Index/*.iwa` files of Harbor.pages. */
export function harborIndex() {
  const text = HARBOR.map(([line]) => line).join("\n");
  const paragraphs = [];
  const chars = [];
  let at = 0;
  let previous = null;
  for (const [line, name] of HARBOR) {
    const id = STYLE_IDS[name];
    paragraphs.push([1, [[1, at], ...(id === previous ? [] : [[2, ref(id)]])]]);
    previous = id;
    // "would", in the named character style Emphasis.
    const would = line.indexOf("would");
    if (would >= 0) chars.push([1, [[1, at + would], [2, ref(107)]]], [1, [[1, at + would + 5]]]);
    at += line.length + 1;
  }
  return {
    "Index/Document.iwa": iwa([
      [1, 10000, [[4, ref(2)]]],
      [2, 2001, [[1, 0], [2, ref(100)], [3, text], [5, paragraphs], [8, chars]]],
    ]),
    "Index/DocumentStylesheet.iwa": iwa([
      [100, 401, [101, 102, 103, 104, 105, 106, 107, 108].map((id) => [1, ref(id)])],
      style(101, 2022, "Act", null, null),
      style(102, 2022, "Scene", null, null),
      style(103, 2022, "Stage Direction", null, null),
      style(104, 2022, "Character", null, null),
      style(105, 2022, "Dialogue", null, null),
      style(106, 2022, "Parenthetical", null, null),
      style(107, 2021, "Emphasis", null, [[2, 1]]),
      style(108, 2022, null, 103, [[2, 1]]),
    ]),
  };
}

/** Harbor.pages as a single file: the ZIP Pages saves by default. */
export function harborPages() {
  return zipSync({ ...harborIndex(), "Metadata/DocumentIdentifier": strToU8("HARBOR-SAMPLE") }, { level: 0 });
}

/** The same document in package form: a Harbor.pages folder holding Index.zip. */
export function harborPackage() {
  return [
    { path: "Index.zip", bytes: zipSync(harborIndex(), { level: 0 }) },
    { path: "Metadata/DocumentIdentifier", bytes: strToU8("HARBOR-SAMPLE") },
  ];
}

/** The package as the web view hands a chosen or dropped one over, and as
 * Finder's Compress makes it: Harbor.pages.zip, its folder at the root. */
export function harborPackageZip() {
  return zipSync(Object.fromEntries(harborPackage().map((f) => [`Harbor.pages/${f.path}`, f.bytes])), { level: 0 });
}

/** Bytes as base64, in Node and in the page alike. */
export function toBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
