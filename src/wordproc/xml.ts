// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Text and attribute values for the XML inside a .docx or .odt. */

/**
 * Characters XML 1.0 cannot carry at all — control characters other than tab,
 * line feed and carriage return, a lone surrogate half, and U+FFFE/U+FFFF.
 * A script can hold one pasted from elsewhere; a reader would refuse the
 * whole file over it, so it is dropped here rather than escaped.
 */
const PAIR_OR_UNWRITABLE =
  /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

/** Escaped for element text and for a double-quoted attribute alike. */
export function esc(value: string): string {
  return value
    // A matched surrogate pair is two characters and stays; anything else it matched goes.
    .replace(PAIR_OR_UNWRITABLE, (found) => (found.length === 2 ? found : ""))
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/**
 * A number for an attribute: at most `places` decimals, no trailing zeros, and
 * never exponent notation, which neither schema accepts.
 */
export function num(value: number, places = 4): string {
  const fixed = value.toFixed(places);
  return fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
}
