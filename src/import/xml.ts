// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { DOMParser, type Element, type Node } from "@xmldom/xmldom";
import { unzipSync } from "fflate";
import { assertDocumentSize, assertDocumentText, MAX_DOCUMENT_BYTES } from "../storage/read-limit";
export type { Element, Node };

export function xml(text: string): Element {
  assertDocumentText(text);
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error(
      "This document uses XML declarations that cannot be imported. Export a fresh copy from its writing app.",
    );
  const root = new DOMParser({
    onError: () => {
      throw new Error("The document contains damaged XML. Export a fresh copy and try again.");
    },
  }).parseFromString(text, "application/xml").documentElement;
  if (!root) throw new Error("This document has no readable content.");
  // Bound recursive traversal independently of byte size.
  const pending: { node: Node; depth: number }[] = [{ node: root, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    if (++count > 250_000 || depth > 100)
      throw new Error(
        "This document is too complex to import. Try exporting it as RTF or Fountain.",
      );
    for (let c = node.firstChild; c; c = c.nextSibling) pending.push({ node: c, depth: depth + 1 });
  }
  return root;
}
export function children(node: Node): Element[] {
  const result: Element[] = [];
  for (let c = node.firstChild; c; c = c.nextSibling)
    if (c.nodeType === 1) result.push(c as Element);
  return result;
}
export function descendants(node: Node, name: string): Element[] {
  const result: Element[] = [];
  const walk = (n: Node) => {
    for (const c of children(n)) {
      if (c.localName === name) result.push(c);
      walk(c);
    }
  };
  walk(node);
  return result;
}
export const child = (node: Node, name: string) => children(node).find((c) => c.localName === name);
export function attr(node: Element | undefined, name: string): string {
  if (!node) return "";
  for (let i = 0; i < node.attributes.length; i++) {
    const a = node.attributes.item(i)!;
    if (a.localName === name) return a.value;
  }
  return "";
}
/** The parts of a ZIP that `names` wants: a list of paths, or a test when the
 * paths are only known by pattern (a `.pages` document's `Index/*.iwa`). */
export function zipParts(
  bytes: Uint8Array,
  names: Set<string> | ((name: string) => boolean),
): Record<string, Uint8Array> {
  assertDocumentSize(bytes.byteLength);
  const wanted = typeof names === "function" ? names : (n: string) => names.has(n);
  let total = 0,
    count = 0;
  // fflate allocates each output using originalSize. Check BEFORE allocation,
  // including parts we do not read, so a compressed bomb never reaches XML.
  return unzipSync(bytes, {
    filter: (entry) => {
      if (++count > 4096 || entry.originalSize > MAX_DOCUMENT_BYTES)
        throw new Error("This archive is too large or complex. Export a smaller document.");
      total += entry.originalSize;
      if (total > MAX_DOCUMENT_BYTES * 4)
        throw new Error("This archive expands beyond the import limit. Export a smaller document.");
      return wanted(entry.name);
    },
  });
}
export function decode(bytes: Uint8Array): string {
  assertDocumentSize(bytes.byteLength);
  const encoding =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? "utf-16le"
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? "utf-16be"
        : "utf-8";
  try {
    const value = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    assertDocumentText(value);
    return value;
  } catch {
    throw new Error(
      "The text encoding could not be read. Save a UTF-8 text file, or export as Word (.docx).",
    );
  }
}
