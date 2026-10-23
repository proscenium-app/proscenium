// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where the rule in a redline's margin stands
 * (docs/app/keeping-work/storage-and-file-format.md#STOR-177): one place down
 * the page, whatever the column of the element it marks, on the Changes page
 * and on the script being written alike.
 */
import { FORMAT_ELEMENT_KEYS, elementColumnIn, inchesToCh, type FormatSpec } from "../format";

/**
 * How far each element's column starts from the text block's left edge, for
 * the rule in the margin: it stands at one place down the page, whatever the
 * column of the element it marks. The numbers are the format's own.
 */
export function marginRuleCss(spec: FormatSpec): string {
  const ch = (inches: number) => `${Math.round(inchesToCh(spec, inches) * 1e4) / 1e4}ch`;
  const out: string[] = [];
  for (const key of FORMAT_ELEMENT_KEYS) {
    const sel = `.play-page .pl-${key}`;
    out.push(`${sel} { --redline-in: ${ch(elementColumnIn(spec, key).leftIn)}; }`);
    if (spec.elements[key].standaloneIndentFromMargin !== null) {
      out.push(
        `${sel}:not(.pm-beside-body) { --redline-in: ${ch(elementColumnIn(spec, key, true).leftIn)}; }`,
      );
    }
  }
  return out.join("\n");
}
