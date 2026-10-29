// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The accessibility tree of every surface smoke visits, held against a
 * checked-in expectation (docs/app/preferences-and-help/accessibility.md#A11Y-19,
 * docs/app/preferences-and-help/accessibility.md#A11Y-16).
 *
 * What VoiceOver reads is the accessibility tree, not the DOM and not the
 * screen, so the tree is what is checked. Two trees, two sets of files:
 *
 *   scripts/aria/<surface>.yml         Playwright's ARIA snapshot
 *                                      (`locator.ariaSnapshot()`), written by
 *                                      `bun run smoke` and held in Chromium and
 *                                      in Playwright's WebKit alike
 *   scripts/aria/native/<surface>.yml  WebKit's own tree in the real app's
 *                                      WKWebView, read through its Web
 *                                      Inspector (src-tauri/src/selftest.rs,
 *                                      `selftest_ax`) by the native self-test
 *
 * They are different trees on purpose. Playwright computes roles and names
 * itself, from the ARIA and HTML-AAM specifications, inside whichever engine
 * it drives: so it holds the page's semantics steady in two engines, but it is
 * Playwright's reading, not the engine's. The native file is WebKit's reading,
 * the one its NSAccessibility wrapper hands VoiceOver: its roles, the names it
 * computed, its states and its live regions.
 *
 * This module is pure (no fs, no Playwright), because the self-test bundles it
 * into the page.
 */

/** A surface's file name: its words, without the review path some carry. */
export function slug(surface) {
  return surface
    .replace(/docs\/[^#\s]*\.md#/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

/**
 * Names in one pass, in the order the surfaces are audited: a surface audited
 * twice in a pass is `<slug>--2` the second time, so each audit has one file.
 */
export class SurfaceNames {
  #seen = new Map();
  #store;
  #key;
  /**
   * @param {() => Storage} [store] where the counts live when a page reload
   *   must not reset them (the self-test's sessionStorage); memory otherwise
   * @param {string} [key]
   */
  constructor(store, key = "aria-surface-names") {
    this.#store = store;
    this.#key = key;
    try {
      const saved = store?.().getItem(key);
      if (saved) this.#seen = new Map(JSON.parse(saved));
    } catch {
      /* no storage: counts start again, and a clash shows as a difference */
    }
  }
  next(surface) {
    const base = slug(surface);
    const n = (this.#seen.get(base) ?? 0) + 1;
    this.#seen.set(base, n);
    try {
      this.#store?.().setItem(this.#key, JSON.stringify([...this.#seen]));
    } catch {
      /* as above */
    }
    return n === 1 ? base : `${base}--${n}`;
  }
  reset() {
    this.#seen.clear();
    try {
      this.#store?.().removeItem(this.#key);
    } catch {
      /* as above */
    }
  }
}

const MONTH = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?";

/**
 * What changes between runs rather than between builds: when a file was
 * written, which temporary folder the self-test's vault sits in, the version
 * this build calls itself, the ids a run mints, where a pane was scrolled, and
 * the order of a table's rows. Each engine writes a date its own way
 * ("Jun 18, 2026, 5:10 PM" in Chromium, "… at 5:10 PM" in WebKit), and so
 * does each PC's language: a variant pass in German or Japanese
 * (smoke-variants.mjs) reads "18. Juni 2026, 17:10" and "2026年6月18日 17:10",
 * and those are the same surface.
 */
export function normalize(text) {
  return savedCopies(
    openSurfaces(sortRows(text))
      .replace(
        new RegExp(
          `\\b${MONTH} \\d{1,2}, \\d{4}(?:,| at) \\d{1,2}:\\d{2}(?::\\d{2})?\\s?[AP]M\\b`,
          "g",
        ),
        "<date and time>",
      )
      .replace(/\b\d{1,2}\. \p{L}{3,5}\.? \d{4}, \d{1,2}:\d{2}(?::\d{2})?\b/gu, "<date and time>")
      .replace(/\b\d{4}年\d{1,2}月\d{1,2}日 \d{1,2}:\d{2}(?::\d{2})?/gu, "<date and time>")
      .replace(new RegExp(`\\b${MONTH} \\d{1,2}, \\d{4}\\b`, "g"), "<date>")
      // A saved copy's short date (9/25/2026) is the day the checks ran, and
      // so are 25.9.2026 and 2026/9/25, before a version number takes them.
      .replace(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g, "<date>")
      .replace(/\b\d{1,2}\.\d{1,2}\.\d{4}\b/g, "<date>")
      .replace(/\b\d{4}\/\d{1,2}\/\d{1,2}\b/g, "<date>")
      .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s?[AP]M\b/g, "<time>")
      // A 24-hour clock, as most PCs keep it; Japan writes a date and its
      // time with no comma between.
      .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, "<time>")
      .replace(/<date> <time>/g, "<date>, <time>")
      // The vault's copy for this launch: one a pass once, one an act now
      // (plays-<n>, numbered by launch), so the number is where the act ran.
      // Since the faults moved into the app it sits in `<n>/dev/`, beside the
      // files a check opens from outside it, as the in-memory vault's sits in
      // "/dev"; that folder reads as the in-memory vault's.
      .replace(
        /(?:\/private)?\/var\/folders\/[^\s"':]*?\/proscenium-selftest-\d+\/(?:\d+\/dev\/)?plays-(?:light|dark|\d+)/g,
        "<plays folder>",
      )
      .replace(/plays-(?:light|dark|\d+)\b/g, "<plays folder name>")
      .replace(
        /(?:\/private)?\/var\/folders\/[^\s"':]*?\/proscenium-selftest-\d+\/\d+\/dev(?=[/\s"':]|$)/gm,
        "/dev",
      )
      // The sandboxed self-test's temporary home is in its container, under
      // its own bundle id (docs/engineering/release-engineering.md#REL-56): it
      // reads as the unsandboxed one's.
      .replace(
        /\/Users\/[^/\s"']+\/Library\/Containers\/[^/\s"']+\/Data\/tmp\/(proscenium-selftest-\d+\/)/g,
        "/private/var/folders/x/$1",
      )
      .replace(/org\.habiby\.proscenium\.sandbox\.selftest/g, "org.habiby.proscenium.selftest")
      // Anything else under the self-test's temporary home: the build host's
      // temp folder and the run's pid are not the app's.
      .replace(
        /(?:\/private)?\/var\/folders\/[^\s"']*?\/proscenium-selftest-\d+\//g,
        "<self-test home>/",
      )
      .replace(/\b\d+\.\d+\.\d+(?:-(?:alpha|beta)\.\d+)?\b/g, "<version>")
      // About's version line names the chip the copy runs on, which is the
      // test machine's: one tree serves both of a system's chips.
      .replace(/(Version <version>) · (?:Apple silicon|Intel|x64|Arm64)$/gm, "$1 · <chip>")
      .replace(/\b[0-9A-HJKMNP-TV-Z]{26}\b/g, "<id>")
      .replace(
        /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})\b/g,
        "<timestamp>",
      )
      // The page map names the scene the pane is scrolled to, which is where the
      // last check left it, not what the surface is.
      .replace(/On screen: [^"'\n]*/g, "On screen: <scene>")
      // How many changes wait in Changes, which is what the checks before left.
      .replace(/\b\d+ pending\b/g, "<n> pending")
      // A burst of changes from outside: how many saves it gathered, and the
      // words they come to, are how the system told the writes apart. A Mac
      // may tell two quick writes as one event, so one run's "3 saves 2 words
      // cut" is another's "4 saves 1 word cut", and a later check's tree shows
      // whichever the burst check before it left. The row, its place and what
      // was changed stay; the check that makes the burst holds its words.
      .replace(/(Changed somewhere else [^"\n]*?· )\d+ saves?\b[^"\n]*/g, "$1<a burst of saves>")
      // Where the autosave is, which is how long ago the last check typed.
      .replace(/^(\s*- text: )(?:Saved(?: · <time>)?|Saving…|Editing…)$/gm, "$1<save status>")
      .replace(/[ \t]+$/gm, ""),
  ).trimEnd();
}

/**
 * A pane's tabs, "Open in this pane", as the list itself and the tab it shows.
 * Which other surfaces are open is what the checks before happened to leave:
 * a slower machine leaves another tab open, and the surface under audit is
 * not its tabs. WebKit marks the shown tab `[current=true]`, and that one is
 * kept; Playwright's form marks none, so it keeps the list alone.
 */
function openSurfaces(text) {
  const lines = text.split("\n");
  const out = [];
  const depth = (line) => line.length - line.trimStart().length;
  for (let i = 0; i < lines.length; ) {
    const line = lines[i++];
    out.push(line);
    if (!/^\s*- '?(?:list|group) "Open in this pane"'?:?$/.test(line)) continue;
    const indent = depth(line);
    let item = null;
    const keep = (block) => {
      if (block && block.some((l) => l.includes("[current"))) out.push(...block);
    };
    while (i < lines.length && lines[i].trim() && depth(lines[i]) > indent) {
      if (depth(lines[i]) === indent + 2) {
        keep(item);
        item = [];
      }
      item?.push(lines[i++]);
    }
    keep(item);
  }
  return out.join("\n");
}

/**
 * A list of saved copies as the files that have one. How many copies the
 * checks before made of each depends on how their saves fell, so once dates
 * and times are gone, a run of sibling "Saved copy of" buttons is its distinct
 * entries, sorted.
 */
function savedCopies(text) {
  const lines = text.split("\n");
  const out = [];
  const isCopy = (line) => /^\s*- '?button "Saved copy of /.test(line);
  for (let i = 0; i < lines.length; ) {
    if (!isCopy(lines[i])) {
      out.push(lines[i++]);
      continue;
    }
    const run = new Set();
    while (i < lines.length && isCopy(lines[i])) run.add(lines[i++]);
    out.push(...[...run].sort());
  }
  return out.join("\n");
}

/**
 * A surface's snapshot as it is held: normalized, and with the live regions'
 * words left out. The regions themselves stay — that they exist, empty, before
 * anything is said is what WebKit needs to speak at all (src/ui/announce.ts) —
 * but what one holds when a surface is audited is whichever of several
 * asynchronous announcements landed last, which is timing, not the surface.
 * The words are held where they are the point: the check that announces and
 * then reads the region in the tree ("accessibility tree · … says the kind").
 */
export function forSurface(text) {
  const lines = normalize(text)
    .replace(/^(\s*- (?:status|alert|log|marquee|timer)\b[^:\n]*):[^\n]*$/gm, "$1")
    // Bold, Italic and Underline say what the caret stands in, which is where
    // the last check left it.
    .replace(/^(\s*- button "(?:Bold|Italic|Underline)") \[pressed\]/gm, "$1")
    .split("\n");
  // A text box keeps its role and name; its words are the play, not the
  // surface (the check that types holds those), so they and whatever the
  // editor draws inside go.
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)- ('?)(textbox|searchbox)\b/.exec(lines[i]);
    if (!m) {
      out.push(lines[i]);
      continue;
    }
    out.push(`${m[1]}- ${entryKey(lines[i].slice(m[1].length + 2))}`);
    while (i + 1 < lines.length && indent(lines[i + 1]) > m[1].length) i++;
  }
  return out.join("\n");
}

const indent = (line) => line.length - line.trimStart().length;

/** An entry's role and name, without its value: `textbox "Script": words` → `textbox "Script"`. */
function entryKey(entry) {
  if (entry.startsWith("'")) {
    for (let i = 1; i < entry.length; i++) {
      if (entry[i] === "'" && entry[i + 1] === "'") i++;
      else if (entry[i] === "'") return entry.slice(0, i + 1);
    }
    return entry;
  }
  let quoted = false;
  for (let i = 0; i < entry.length; i++) {
    if (entry[i] === '"' && entry[i - 1] !== "\\") quoted = !quoted;
    else if (entry[i] === ":" && !quoted) return entry.slice(0, i);
  }
  return entry;
}

/**
 * A table's rows in a fixed order. The Plays list sorts by what was touched
 * last, which is whatever the checks before did, so a surface is its rows,
 * not their order: sibling `row` entries (each with the lines indented under
 * it) are sorted by their text. Both snapshot forms write a row as `- row`.
 */
function sortRows(text) {
  const lines = text.split("\n");
  const out = [];
  const depth = (line) => line.length - line.trimStart().length;
  const isRow = (line) => /^\s*- '?row\b/.test(line);
  for (let i = 0; i < lines.length; ) {
    if (!isRow(lines[i])) {
      out.push(lines[i++]);
      continue;
    }
    const indent = depth(lines[i]);
    const rows = [];
    while (i < lines.length && isRow(lines[i]) && depth(lines[i]) === indent) {
      const block = [lines[i++]];
      while (i < lines.length && lines[i].trim() && depth(lines[i]) > indent)
        block.push(lines[i++]);
      rows.push(block.join("\n"));
    }
    out.push(...rows.sort());
  }
  return out.join("\n");
}

/** The first line where two snapshots part, as one sentence for the report. */
export function firstDifference(expected, actual) {
  const a = expected.split("\n");
  const b = actual.split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      return `line ${i + 1}: expected ${a[i] === undefined ? "nothing" : JSON.stringify(a[i].trim())}, found ${b[i] === undefined ? "nothing" : JSON.stringify(b[i].trim())}`;
    }
  }
  return null;
}

/**
 * A run's reading of a surface, kept as `--update-aria` would have written
 * its folder (`smoke.mjs --aria-out`, for a run that may not write the
 * checkout's own: the real Windows app's, on a test machine). `kept` maps a
 * file's name to its text; `names` are the files the reading may be held
 * against, the most particular first (`<surface>.dark.yml`, then
 * `<surface>.yml`). The reading goes into the most particular one, unless a
 * wider one the run already kept says the same. Returns the file that says it.
 */
export function keepTree(kept, names, text) {
  const [own, ...wider] = names;
  const inherited = wider.find((f) => kept.has(f));
  if (inherited !== undefined && kept.get(inherited) === text) return inherited;
  kept.set(own, text);
  return own;
}

/**
 * What a variant pass of the real Windows app keeps of a tree it read
 * (scripts/smoke-variants.mjs): `names` are the files it is held against,
 * most particular first, the variant's own before the PC copy's. It keeps the
 * variant's own file only where the variant reads the surface otherwise than
 * the file it would inherit: a variant file kept this pass (`kept`), or the
 * PC copy's (`readPlain`, the plain pass's reading this run or the folder's).
 * Returns the file the reading stands for.
 */
export function keepVariantTree(kept, names, text, { isVariant, readPlain }) {
  const [own, ...wider] = names;
  for (const f of wider) {
    const t = isVariant(f) ? kept.get(f) : readPlain(f);
    if (t === undefined || t === null) continue;
    if (t === text) return f;
    break;
  }
  kept.set(own, text);
  return own;
}

/**
 * What taking a run's kept trees into a folder changes: the files new or
 * changed, and, only when the run read every surface, the files it read none
 * of, which go. `present` and `wanted` map a file's name to its text.
 * `wholeFor` says, of a file, whether the run read every surface it could be
 * held against: the real Windows app's variant passes each read their own
 * (scripts/smoke-variants.mjs), and a run may make some and not others.
 */
export function acceptPlan(present, wanted, { whole, wholeFor = () => whole }) {
  const changed = [...wanted.keys()].filter((f) => present.get(f) !== wanted.get(f)).sort();
  const gone = [...present.keys()].filter((f) => !wanted.has(f) && wholeFor(f)).sort();
  return { changed, gone };
}

/**
 * WebKit's tree, as `selftest_ax` returns it (scripts/selftest/ax-walk.js),
 * written the way an ARIA snapshot reads:
 *
 *   - heading "Where should your plays live?" [level=1]
 *   - button "New Play" [haspopup]
 *   - status [live=polite]: Pages counted for 2 plays.
 *
 * An ignored node leaves no line, and its children take its place. A text leaf
 * is written only where its words are the point: inside a live region (what is
 * announced) and inside a text box (its value). A table's children that are
 * not rows are WebKit's column view of the same cells, and are left out.
 */
export function renderWebKitTree(tree) {
  const lines = [];
  const text = (node) => (node.text ?? "") + (node.children ?? []).map(text).join("");
  const walk = (node, depth, parent) => {
    if (!node) return;
    if (parent === "table" && !["row", "rowgroup"].includes(node.role)) return;
    if (node.ignored || node.role === "text") {
      for (const child of node.children ?? []) walk(child, depth, parent);
      return;
    }
    const role = node.role || "none";
    let line = `${"  ".repeat(depth)}- ${role}`;
    if (node.label) line += ` ${JSON.stringify(node.label)}`;
    const states = [];
    const s = node.states ?? {};
    if (s.headingLevel) states.push(`level=${s.headingLevel}`);
    if (s.hierarchyLevel && role === "treeitem") states.push(`level=${s.hierarchyLevel}`);
    // WebKit's inspector says a control's checked state as a word, "true",
    // "false" or "mixed", never a boolean: read as "anything but false", every
    // radio in a group was written checked, the one that is and the ones that
    // are not.
    if (s.checked === true || s.checked === "true") states.push("checked");
    else if (s.checked === "mixed") states.push("checked=mixed");
    if (s.pressed !== undefined && s.pressed !== false)
      states.push(s.pressed === "mixed" ? "pressed=mixed" : "pressed");
    if (s.expanded === true) states.push("expanded");
    if (s.selected) states.push("selected");
    if (s.disabled) states.push("disabled");
    if (s.required) states.push("required");
    if (s.readonly) states.push("readonly");
    if (s.invalid && s.invalid !== "false") states.push("invalid");
    if (s.current && s.current !== "false") states.push(`current=${s.current}`);
    if (s.isPopUpButton) states.push("haspopup");
    if (s.liveRegionStatus && s.liveRegionStatus !== "off")
      states.push(`live=${s.liveRegionStatus}`);
    if (states.length) line += ` [${states.join("] [")}]`;
    const spoken = s.liveRegionStatus && s.liveRegionStatus !== "off";
    if (spoken || role === "textbox" || role === "searchfield") {
      const words = text(node).replace(/\s+/g, " ").trim();
      if (words) line += `: ${words}`;
      lines.push(line);
      if (spoken) return;
    } else {
      lines.push(line);
    }
    for (const child of node.children ?? []) walk(child, depth + 1, role);
  };
  walk(tree, 0, null);
  return lines.join("\n");
}
