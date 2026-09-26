// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The archive layer under a `.pages` document
 * (docs/app/importing/document-import.md#IMPT-88). Each `Index/*.iwa` file is
 * a run of chunks: a zero byte, a three-byte little-endian length, then one
 * raw Snappy block (no stream identifier, no checksum). The chunks decompress
 * to a stream of objects, each a varint length, a header naming the object's
 * identifier and the type and length of its messages, then those messages as
 * protocol-buffer bytes.
 *
 * Only the wire format is known here; what a field means belongs to the
 * reader in pages.ts. Everything is checked before it allocates, so a damaged
 * or hostile file ends in a sentence, never a runaway allocation
 * (docs/app/importing/document-import.md#IMPT-80).
 */
import { MAX_DOCUMENT_BYTES } from "../storage/read-limit";

export const DAMAGED =
  "This Pages document is damaged or incomplete. Open it in Pages and save it again, or choose File › Export To › Word and import the Word copy.";
const TOO_LARGE =
  "This Pages document expands beyond the import limit. Export a smaller section to Word and import that.";

/** One field as it sits on the wire: a number, or the bytes of a string or message. */
export type Value = number | Uint8Array;
/** A message's fields by number, in the order they appear. */
export type Message = Map<number, Value[]>;

export interface IwaObject {
  type: number;
  data: Uint8Array;
}

/** Decompressed bytes allowed across one document, the same ceiling as a ZIP's expansion. */
export const MAX_EXPANDED_BYTES = MAX_DOCUMENT_BYTES * 4;
/** Objects allowed in one document, matching the XML node bound. */
const MAX_OBJECTS = 250_000;

/** A shared allowance, spent as blocks decompress. */
export interface Budget {
  left: number;
}

function varint(bytes: Uint8Array, at: { i: number }): number {
  let value = 0;
  for (let shift = 0; shift < 70; shift += 7) {
    if (at.i >= bytes.length) throw new Error(DAMAGED);
    const b = bytes[at.i++];
    // Multiplication, not a shift: identifiers can pass 32 bits.
    value += (b & 0x7f) * 2 ** shift;
    if (b < 0x80) return value;
  }
  throw new Error(DAMAGED);
}

/** Raw Snappy: a varint length, then literals and back-references. */
export function unsnappy(src: Uint8Array, budget: Budget): Uint8Array {
  const at = { i: 0 };
  const length = varint(src, at);
  if (length > budget.left) throw new Error(TOO_LARGE);
  budget.left -= length;
  const out = new Uint8Array(length);
  let o = 0;
  let i = at.i;
  while (i < src.length) {
    const tag = src[i++];
    let n: number;
    let offset: number;
    if ((tag & 3) === 0) {
      n = tag >> 2;
      if (n >= 60) {
        const width = n - 59;
        if (i + width > src.length) throw new Error(DAMAGED);
        n = 0;
        for (let k = 0; k < width; k++) n += src[i++] * 2 ** (8 * k);
      }
      n += 1;
      if (i + n > src.length || o + n > length) throw new Error(DAMAGED);
      out.set(src.subarray(i, i + n), o);
      i += n;
      o += n;
      continue;
    }
    if ((tag & 3) === 1) {
      if (i >= src.length) throw new Error(DAMAGED);
      n = 4 + ((tag >> 2) & 7);
      offset = ((tag >> 5) << 8) | src[i++];
    } else if ((tag & 3) === 2) {
      if (i + 2 > src.length) throw new Error(DAMAGED);
      n = 1 + (tag >> 2);
      offset = src[i] | (src[i + 1] << 8);
      i += 2;
    } else {
      if (i + 4 > src.length) throw new Error(DAMAGED);
      n = 1 + (tag >> 2);
      offset = (src[i] | (src[i + 1] << 8) | (src[i + 2] << 16) | (src[i + 3] << 24)) >>> 0;
      i += 4;
    }
    if (offset === 0 || offset > o || o + n > length) throw new Error(DAMAGED);
    // A copy may overlap what it is writing: that is how Snappy repeats a run.
    if (offset >= n) out.copyWithin(o, o - offset, o - offset + n);
    else for (let k = 0; k < n; k++) out[o + k] = out[o + k - offset];
    o += n;
  }
  if (o !== length) throw new Error(DAMAGED);
  return out;
}

/** One `.iwa` file's chunks, decompressed and joined. */
export function iwaStream(file: Uint8Array, budget: Budget): Uint8Array {
  const blocks: Uint8Array[] = [];
  let total = 0;
  for (let i = 0; i < file.length; ) {
    if (file[i] !== 0 || i + 4 > file.length) throw new Error(DAMAGED);
    const n = file[i + 1] | (file[i + 2] << 8) | (file[i + 3] << 16);
    i += 4;
    if (i + n > file.length) throw new Error(DAMAGED);
    const block = unsnappy(file.subarray(i, i + n), budget);
    blocks.push(block);
    total += block.length;
    i += n;
  }
  if (blocks.length === 1) return blocks[0];
  const out = new Uint8Array(total);
  let o = 0;
  for (const b of blocks) {
    out.set(b, o);
    o += b.length;
  }
  return out;
}

/** A message's fields. Groups, a wire type no current file uses, are refused. */
export function message(bytes: Uint8Array): Message {
  const fields: Message = new Map();
  const at = { i: 0 };
  while (at.i < bytes.length) {
    const key = varint(bytes, at);
    const no = Math.floor(key / 8);
    const wire = key % 8;
    let value: Value;
    if (wire === 0) value = varint(bytes, at);
    else if (wire === 2) {
      const n = varint(bytes, at);
      if (at.i + n > bytes.length) throw new Error(DAMAGED);
      value = bytes.subarray(at.i, at.i + n);
      at.i += n;
    } else if (wire === 1 || wire === 5) {
      const n = wire === 1 ? 8 : 4;
      if (at.i + n > bytes.length) throw new Error(DAMAGED);
      value = bytes.subarray(at.i, at.i + n);
      at.i += n;
    } else throw new Error(DAMAGED);
    const list = fields.get(no);
    if (list) list.push(value);
    else fields.set(no, [value]);
  }
  return fields;
}

/** Every object in the document's archives, by identifier. The first message
 * an object carries is its own; any after it are ignored. */
export function iwaObjects(files: Uint8Array[]): Map<number, IwaObject> {
  const objects = new Map<number, IwaObject>();
  const budget: Budget = { left: MAX_EXPANDED_BYTES };
  for (const file of files) {
    const stream = iwaStream(file, budget);
    const at = { i: 0 };
    while (at.i < stream.length) {
      const n = varint(stream, at);
      if (at.i + n > stream.length) throw new Error(DAMAGED);
      const header = message(stream.subarray(at.i, at.i + n));
      at.i += n;
      const id = header.get(1)?.[0];
      if (typeof id !== "number") throw new Error(DAMAGED);
      let first = true;
      for (const info of header.get(2) ?? []) {
        if (!(info instanceof Uint8Array)) throw new Error(DAMAGED);
        const fields = message(info);
        const type = fields.get(1)?.[0];
        const length = fields.get(3)?.[0];
        if (typeof type !== "number" || typeof length !== "number") throw new Error(DAMAGED);
        if (at.i + length > stream.length) throw new Error(DAMAGED);
        if (first && !objects.has(id)) {
          if (objects.size >= MAX_OBJECTS)
            throw new Error(
              "This Pages document is too complex to import. Export it to Word and import that.",
            );
          objects.set(id, { type, data: stream.subarray(at.i, at.i + length) });
        }
        first = false;
        at.i += length;
      }
    }
  }
  return objects;
}
