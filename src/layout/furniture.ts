// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Page furniture: what one header or footer slot prints on one page.
 *
 * The act and scene numbers come from the headings the writer typed, not from
 * counting them, so "ACT TWO, SCENE 8" prints 2 and 8 whether scenes restart
 * in each act or run on through the play
 * (docs/app/formatting/formats-and-layout.md#FMT-141). A number token that has
 * nothing to print takes its separator with it, which is how act-scene-page
 * numbering shortens for a one-act or a single-scene play
 * (docs/app/formatting/formats-and-layout.md#FMT-142).
 */
import type { HeaderToken } from "../format/spec";

/** Where a page begins: the act and scene in force, as written and as numbers. */
export interface PagePosition {
  act: string;
  scene: string;
  actNumber: number | null;
  sceneNumber: number | null;
}

export const START_POSITION: Readonly<PagePosition> = { act: "", scene: "", actNumber: null, sceneNumber: null };

const UNITS = [
  "", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** "three" → 3, "twenty-one" → 21; anything else → null. */
function fromWords(words: string): number | null {
  const [tens, unit, ...rest] = words.toLowerCase().split(/[-\s]+/);
  if (rest.length) return null;
  const small = UNITS.indexOf(tens);
  if (small > 0 && unit === undefined) return small;
  const t = TENS.indexOf(tens);
  if (t < 2) return null;
  if (unit === undefined) return t * 10;
  const u = UNITS.indexOf(unit);
  return u > 0 && u < 10 ? t * 10 + u : null;
}

/** I to XXXIX. Deliberately short: a longer reading turns words like MIX into numbers. */
const ROMAN = /^(x{0,3})(ix|iv|v?i{0,3})$/i;
const ROMAN_VALUE: Record<string, number> = { i: 1, v: 5, x: 10 };

function fromRoman(word: string): number | null {
  if (!word || !ROMAN.test(word)) return null;
  const digits = [...word.toLowerCase()].map((c) => ROMAN_VALUE[c]);
  return digits.reduce((sum, d, i) => sum + (d < (digits[i + 1] ?? 0) ? -d : d), 0);
}

export function toRoman(n: number): string {
  let out = "";
  let left = n;
  for (const [value, glyph] of [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
    [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ] as const) {
    for (; left >= value; left -= value) out += glyph;
  }
  return out;
}

/**
 * What a heading says about its number. `says` is whether the heading names
 * the act or scene at all ("SCENE TBD — THE DORM" does; "PROLOGUE" does not);
 * `number` is the number it gives, in digits, words or Roman numerals.
 */
export function headingNumber(text: string, keyword: "act" | "scene"): { says: boolean; number: number | null } {
  const match = new RegExp(`\\b${keyword}\\b[\\s:#.–—-]*(?:no\\.?\\s*)?([a-z0-9]+)(?:[-\\s]+([a-z]+))?`, "i").exec(text);
  if (!match) return { says: new RegExp(`\\b${keyword}\\b`, "i").test(text), number: null };
  const [, first, second] = match;
  const digits = /^\d+/.exec(first);
  const number = digits
    ? Number(digits[0])
    : (second ? fromWords(`${first} ${second}`) : null) ?? fromWords(first) ?? fromRoman(first);
  return { says: true, number: number && number > 0 ? number : null };
}

/**
 * Every act and scene heading's number, by source index, in the order the
 * headings come (docs/app/formatting/formats-and-layout.md#FMT-141): the number a
 * heading gives, or — when it names an act or scene without one, like SCENE
 * TBD — the next in its act; scenes count again after each act heading. A
 * heading that names neither, like PROLOGUE, has none. The paginator and the
 * .docx and .odt export both read positions from this, so they agree on them.
 */
export function numberHeadings(
  blocks: readonly { type: string; text: string; sourceIndex: number }[],
): Map<number, number | null> {
  const numbers = new Map<number, number | null>();
  let actCount = 0;
  let sceneCount = 0;
  for (const block of blocks) {
    if (block.type !== "act" && block.type !== "scene") continue;
    const keyword = block.type;
    const said = headingNumber(block.text, keyword);
    const number = said.number ?? (said.says ? (keyword === "act" ? actCount : sceneCount) + 1 : null);
    numbers.set(block.sourceIndex, number);
    if (keyword === "act") {
      if (number !== null) actCount = number;
      sceneCount = 0;
    } else if (number !== null) sceneCount = number;
  }
  return numbers;
}

/** Where a heading leaves the play: the act and scene in force after it. */
export function enterHeading(
  at: PagePosition,
  heading: { type: string; text: string },
  number: number | null,
): PagePosition {
  return heading.type === "act"
    ? { act: heading.text, actNumber: number, scene: "", sceneNumber: null }
    : { ...at, scene: heading.text, sceneNumber: number };
}

/** The tokens that may print nothing and then take their separator with them. */
const NUMBERS: ReadonlySet<string> = new Set<HeaderToken>(["actNumber", "actRoman", "sceneNumber"]);
/** A separator between two tokens: a short run of dashes, dots, colons, slashes and spaces. */
const SEPARATOR = /^[\s.:/·–—-]{1,3}$/;

/** One slot's template with its tokens filled in (docs/app/formatting/formats-and-layout.md#FMT-101). */
export function fillSlot(template: string, values: Readonly<Record<HeaderToken, string>>): string {
  // Even indices are literal text, odd ones tokens: "{a}-{b}" → ["", "{a}", "-", "{b}", ""].
  const parts = template.split(/(\{[^}]*\})/);
  const out = parts.map((part, i) => (i % 2 ? (values[part.slice(1, -1) as HeaderToken] ?? part) : part));
  for (let i = 1; i < parts.length; i += 2) {
    if (out[i] !== "" || !NUMBERS.has(parts[i].slice(1, -1))) continue;
    if (i + 2 < parts.length && SEPARATOR.test(out[i + 1])) out[i + 1] = "";
    else if (i >= 3 && SEPARATOR.test(out[i - 1])) out[i - 1] = "";
  }
  return out.join("");
}

/** Every token's value on one page. */
export function slotValues(args: {
  pageNumber: number;
  at: PagePosition;
  title?: string;
  author?: string;
  draftDate?: string;
}): Record<HeaderToken, string> {
  const { at } = args;
  return {
    page: String(args.pageNumber),
    title: args.title ?? "",
    author: args.author ?? "",
    act: at.act,
    scene: at.scene,
    actNumber: at.actNumber === null ? "" : String(at.actNumber),
    actRoman: at.actNumber === null ? "" : toRoman(at.actNumber),
    sceneNumber: at.sceneNumber === null ? "" : String(at.sceneNumber),
    // A draft date may be written over several title-page lines; a slot has one.
    draftDate: (args.draftDate ?? "").split(/\s*\n\s*/).filter(Boolean).join(" "),
  };
}
