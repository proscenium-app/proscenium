// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The native self-test's driver: smoke's checks, run INSIDE the real app
 * (docs/engineering/release-engineering.md#REL-D4).
 *
 * `bun run smoke` drives the shipped bundle in headless Chromium on the
 * in-memory dev vault. The app is WKWebView on the Rust vault, and until this
 * existed nothing had ever run below macOS 26.6 or on an Intel Mac — every
 * claim about an older Mac was inference from feature tables. This file is
 * compiled into a `selftest` build only (src-tauri/src/selftest.rs injects it
 * into the page); a release build carries none of it, and
 * scripts/check-bundle.mjs --release fails a binary that does.
 *
 * It implements the slice of Playwright's Page API the checks use
 * (scripts/smoke-checks.mjs lists it) against the real DOM, with one rule:
 * **input is native.** A synthetic `KeyboardEvent` is untrusted — it moves no
 * focus, types no text and opens no menu — so a Tab-trap check would pass
 * without Tab ever doing anything. Every key and click here is an NSEvent the
 * app sends to its own window (selftest_key, selftest_click), so it arrives the
 * way a writer's does: through the menu bar's key equivalents first, then
 * WebKit, as trusted DOM events. Reads and waits are DOM, as they are in
 * Playwright.
 */
import axe from "axe-core";
import { AUDIT_TAGS, recordAudit, runAxe, selected, smokeChecks } from "../smoke-checks.mjs";
import { SurfaceNames, firstDifference, forSurface, normalize as normalizeTree, renderWebKitTree } from "../aria-snapshots.mjs";

// WKWebView can retain local preferences between process launches even though
// the Rust test vault and home are fresh. Reset once per session, before React
// reads them; mid-pass reloads still retain the preferences the checks set.
try {
  if (!sessionStorage.getItem("selftest:fresh")) {
    localStorage.clear();
    sessionStorage.setItem("selftest:fresh", "1");
  }
} catch { /* storage may be unavailable; the checks will report the state */ }

const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * One rendered frame, or 100ms if none comes. WebKit draws no frames for a page
 * nobody can see — a locked screen, a hidden window — and a bare
 * requestAnimationFrame then waits forever: the run hung, silently, until the
 * watchdog. visibleOrFail() below turns that case into a sentence instead.
 */
const frames = { drawn: 0, missed: 0 };
const frame = () =>
  new Promise((resolve) => {
    const timer = setTimeout(() => {
      frames.missed++;
      resolve();
    }, 100);
    requestAnimationFrame(() => {
      clearTimeout(timer);
      frames.drawn++;
      resolve();
    });
  });

/** How often WebKit draws this page right now: animation frames in one second. */
function frameRate() {
  return new Promise((resolve) => {
    let n = 0;
    const start = performance.now();
    const tick = () => (performance.now() - start < 1000 ? (n++, requestAnimationFrame(tick)) : resolve(n));
    requestAnimationFrame(tick);
    setTimeout(() => resolve(n), 1500);
  });
}
const ACTION_TIMEOUT = 10_000;

// --- what went wrong before the checks even started -------------------------

const consoleErrors = [];
{
  const original = console.error.bind(console);
  console.error = (...args) => {
    consoleErrors.push(args.map((a) => (a instanceof Error ? a.stack ?? a.message : String(a))).join(" "));
    original(...args);
  };
  window.addEventListener("error", (e) => consoleErrors.push(`${e.message} (${e.filename}:${e.lineno})`));
  window.addEventListener("unhandledrejection", (e) =>
    consoleErrors.push(`Unhandled rejection: ${e.reason?.stack ?? e.reason}`),
  );
}

function log(line) {
  console.log(`[selftest] ${line}`);
  invoke("selftest_log", { line }).catch(() => {});
}

// --- the Page adapter --------------------------------------------------------

const normalize = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

function textMatches(el, want) {
  const text = normalize(el.innerText ?? el.textContent);
  return want instanceof RegExp ? want.test(text) : text.toLowerCase().includes(normalize(want).toLowerCase());
}

/** Playwright's definition: a non-empty box, and not visibility: hidden. */
function isVisible(el) {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== "hidden";
}

/**
 * Playwright's definition: a form control disabled itself or by its fieldset,
 * or anything inside `aria-disabled="true"`.
 */
function isDisabled(el) {
  return el.matches(":disabled") || !!el.closest('[aria-disabled="true"]');
}

class TimeoutError extends Error {}
/** The page is not being drawn; no later check can mean anything either. */
class NotVisibleError extends Error {}
/** Someone else has the keyboard, and the run cannot go on without it. */
class NoKeyboardError extends Error {}

async function until(what, test, timeout = ACTION_TIMEOUT) {
  const deadline = performance.now() + timeout;
  for (;;) {
    const value = test();
    if (value) return value;
    if (performance.now() > deadline) throw new TimeoutError(`timed out after ${timeout}ms ${what}`);
    await sleep(25);
  }
}

/** The implicit roles the checks ask for, plus any explicit role attribute. */
function hasRole(el, role) {
  const explicit = el.getAttribute("role");
  if (explicit) return explicit.split(/\s+/)[0] === role;
  if (role === "button") {
    return el.tagName === "BUTTON" || (el.tagName === "INPUT" && /^(button|submit|reset)$/.test(el.type));
  }
  if (role === "textbox") {
    return el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && /^(text|email|tel|url|password)$/.test(el.type)) || el.isContentEditable;
  }
  if (role === "checkbox") return el.tagName === "INPUT" && el.type === "checkbox";
  if (role === "radio") return el.tagName === "INPUT" && el.type === "radio";
  if (role === "combobox") return el.tagName === "SELECT" && !el.multiple;
  if (role === "heading") return /^H[1-6]$/.test(el.tagName);
  if (role === "link") return el.tagName === "A" && el.hasAttribute("href");
  return false;
}

function accessibleName(el) {
  const label = el.getAttribute("aria-label");
  if (label) return normalize(label);
  const by = el.getAttribute("aria-labelledby");
  if (by) return normalize(by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" "));
  if (el.labels?.length) return normalize([...el.labels].map(label => label.textContent).join(" "));
  return normalize(el.innerText ?? el.textContent);
}

/** Playwright's name match: substring and case-insensitive, or with `exact`, the whole string. */
function nameMatches(name, want, exact = false) {
  if (want == null) return true;
  if (want instanceof RegExp) return want.test(name);
  return exact ? name === normalize(want) : name.toLowerCase().includes(normalize(want).toLowerCase());
}

/** Outside the accessibility tree, as getByRole treats it unless includeHidden. */
function ariaHidden(el) {
  if (el.closest('[aria-hidden="true"]')) return true;
  for (let n = el; n; n = n.parentElement) {
    const style = getComputedStyle(n);
    if (style.display === "none") return true;
    if (n === el && style.visibility === "hidden") return true;
  }
  return false;
}

/** Descendants of every element `scope` resolves to, in document order, once each. */
function within(scope, selector) {
  return () => {
    const found = new Set();
    for (const root of scope()) for (const el of root.querySelectorAll(selector)) found.add(el);
    return [...found];
  };
}

function byRole(scope, role, { name, exact = false, includeHidden = false } = {}) {
  return () =>
    within(scope, "*")().filter(
      // Cheapest first: the style walk runs only for elements that already match.
      (el) => hasRole(el, role) && nameMatches(accessibleName(el), name, exact) && (includeHidden || !ariaHidden(el)),
    );
}

/** Controls labelled by `text`: a <label>, aria-label or aria-labelledby. */
function byLabel(scope, text, { exact = false } = {}) {
  return () => {
    const found = new Set();
    for (const el of within(scope, "label")()) {
      if (nameMatches(normalize(el.textContent), text, exact) && el.control) found.add(el.control);
    }
    for (const el of within(scope, "[aria-label], [aria-labelledby]")()) {
      if (nameMatches(accessibleName(el), text, exact)) found.add(el);
    }
    return [...found];
  };
}

const EVENT_TYPES = [
  [/^(click|dblclick|mouse(down|up|over|out|move|enter|leave)|contextmenu)$/, MouseEvent],
  [/^key(down|up|press)$/, KeyboardEvent],
  [/^(focus|blur|focusin|focusout)$/, FocusEvent],
  [/^(input|beforeinput)$/, InputEvent],
  [/^pointer/, PointerEvent],
  [/^drag|^drop$/, DragEvent],
];

/**
 * How click() brings its target into view, attempt by attempt: Playwright's
 * own cycle (`_retryPointerAction`). Its first attempt is Chromium's
 * scroll-into-view-if-needed, which is WebKit's too: nothing when the element
 * is in view, the nearest edge when it is partly, the centre when it is not.
 */
const SCROLLS = [
  (el) => el.scrollIntoViewIfNeeded(true),
  (el) => el.scrollIntoView({ block: "end", inline: "end" }),
  (el) => el.scrollIntoView({ block: "center", inline: "center" }),
  (el) => el.scrollIntoView({ block: "start", inline: "start" }),
];
/** And its pause before each retry, in ms; the last repeats. */
const SCROLL_BACKOFF = [0, 20, 100, 100, 500];

class Locator {
  /** @param {() => Element[]} query @param {string} describe */
  constructor(query, describe, pickFirst = false) {
    this.query = query;
    this.describe = describe;
    this.pickFirst = pickFirst;
  }

  first() {
    return new Locator(this.query, this.describe, true);
  }

  last() {
    return new Locator(() => this.query().slice(-1), `${this.describe} >> last`, true);
  }

  nth(index) {
    return new Locator(() => {
      const all = this.query();
      const el = index < 0 ? all[all.length + index] : all[index];
      return el ? [el] : [];
    }, `${this.describe} >> nth=${index}`, true);
  }

  locator(selector, { hasText } = {}) {
    const inner = within(this.query, selector);
    return new Locator(() => (hasText == null ? inner() : inner().filter((el) => textMatches(el, hasText))), `${this.describe} >> "${selector}"`);
  }

  getByRole(role, options = {}) {
    return new Locator(byRole(this.query, role, options), `${this.describe} >> role=${role}${options.name ? ` name=${options.name}` : ""}`);
  }

  getByLabel(text, options = {}) {
    return new Locator(byLabel(this.query, text, options), `${this.describe} >> label=${text}`);
  }

  /** Playwright's filter: `has` is a locator whose match must lie inside the element. */
  filter({ hasText, hasNotText, has, hasNot } = {}) {
    const inside = (loc, el) => loc.query().some((inner) => inner !== el && el.contains(inner));
    return new Locator(
      () =>
        this.query().filter(
          (el) =>
            (hasText == null || textMatches(el, hasText)) &&
            (hasNotText == null || !textMatches(el, hasNotText)) &&
            (has == null || inside(has, el)) &&
            (hasNot == null || !inside(hasNot, el)),
        ),
      `${this.describe} >> filter`,
      this.pickFirst,
    );
  }

  async all() {
    return this.query().map((_, i) => this.nth(i));
  }

  /**
   * Playwright's ARIA snapshot of this element, answered here from WebKit's
   * own accessibility tree (scripts/aria-snapshots.mjs, `renderWebKitTree`):
   * the same question, put to the engine VoiceOver asks.
   */
  async ariaSnapshot() {
    // A path, not a marking attribute: ProseMirror watches its own element's
    // attributes, and a snapshot must not change what it reads.
    const path = [];
    for (let el = await this.element(); el && el !== document.body; el = el.parentElement) {
      path.unshift(`${el.localName}:nth-child(${[...el.parentElement.children].indexOf(el) + 1})`);
    }
    return webkitTree(["body", ...path].join(" > "));
  }

  async evaluate(fn, arg) {
    return fn(await this.element(), arg);
  }

  async evaluateAll(fn, arg) {
    return fn(this.query(), arg);
  }

  async waitFor({ state = "visible", timeout = 30_000 } = {}) {
    const test = {
      visible: () => this.query().some(isVisible),
      attached: () => this.query().length > 0,
      detached: () => this.query().length === 0,
      hidden: () => !this.query().some(isVisible),
    }[state];
    await until(`waiting for ${this.describe} to be ${state}`, test, timeout);
  }

  async dispatchEvent(type, init = {}) {
    const el = await this.element();
    const Kind = EVENT_TYPES.find(([pattern]) => pattern.test(type))?.[1] ?? Event;
    el.dispatchEvent(new Kind(type, { bubbles: true, cancelable: true, composed: true, ...init }));
    await frame();
  }

  async press(combo) {
    const el = await this.element();
    if (document.activeElement !== el) el.focus();
    await page.keyboard.press(combo);
  }

  async type(text) {
    const el = await this.element();
    if (document.activeElement !== el) el.focus();
    await page.keyboard.type(text);
  }

  async pressSequentially(text) {
    await this.type(text);
  }

  async isVisible() {
    return this.query().some(isVisible);
  }

  async isHidden() {
    return !this.query().some(isVisible);
  }

  async isDisabled() {
    return isDisabled(await this.element());
  }

  async isEnabled() {
    return !(await this.isDisabled());
  }

  async isChecked() {
    const el = await this.element();
    return el.checked === true || el.getAttribute("aria-checked") === "true";
  }

  async textContent() {
    return (await this.element()).textContent;
  }

  async count() {
    return this.query().length;
  }

  /** The one element this locator means right now, or null; strict like Playwright unless first(). */
  pick({ visible = false } = {}) {
    const all = this.query();
    if (!this.pickFirst && all.length > 1) {
      throw new Error(`strict mode violation: ${this.describe} resolved to ${all.length} elements`);
    }
    const el = all[0];
    return el && (!visible || isVisible(el)) ? el : null;
  }

  /** Resolve to one element, waiting for it. */
  async element({ visible = false } = {}) {
    return until(`waiting for ${this.describe}${visible ? " to be visible" : ""}`, () => this.pick({ visible }));
  }

  async click() {
    // Stable for two frames, enabled, and the element itself is what a click
    // at its centre would hit — the checks Playwright makes before it clicks.
    // A click on a disabled button reaches the page as pointerdown and
    // pointerup only, while WebKit still takes focus off the editor: that is
    // how the tutorial's Next came to be clicked before its step allowed it.
    //
    // And like Playwright, a miss scrolls again, the next way round
    // (SCROLLS). Scrolling once was not the same check: a new note's editor
    // moved after that one scroll, when its format bar and Fit Page zoom
    // arrived a task later, and sat under the sticky `.fmt` for all ten
    // seconds while Playwright's next retry would have scrolled it clear
    // (CI run 35936208466).
    let el = await this.element({ visible: true });
    const deadline = performance.now() + ACTION_TIMEOUT;
    let attempt = 0;
    let last = null;
    let hit = null;
    SCROLLS[0](el);
    for (;;) {
      await frame();
      if (!el.isConnected || !isVisible(el)) {
        // A render replaced it or took its box away. Ask the locator again, as
        // Playwright does for a detached handle: the old element's rect is
        // 0×0, and its centre is the window's top-left corner.
        const found = this.pick({ visible: true });
        if (found) {
          el = found;
          SCROLLS[attempt % SCROLLS.length](el);
        }
        last = null;
      } else {
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        hit = document.elementFromPoint(x, y);
        const steady = last && last.x === x && last.y === y;
        last = { x, y };
        if (steady && !isDisabled(el)) {
          if (hit && (hit === el || el.contains(hit))) {
            await nativeClick(x, y);
            return;
          }
          // Still, enabled, and something else is on top of it — a sticky bar
          // it moved under after the scroll — or nothing is, because it is out
          // of the window: scroll again, the next way round.
          attempt++;
          await sleep(SCROLL_BACKOFF[Math.min(attempt, SCROLL_BACKOFF.length) - 1]);
          SCROLLS[attempt % SCROLLS.length](el);
          last = null;
        }
      }
      if (performance.now() > deadline) {
        if (!el.isConnected || !isVisible(el)) {
          throw new TimeoutError(`timed out after ${ACTION_TIMEOUT}ms waiting for ${this.describe} to be visible`);
        }
        if (isDisabled(el)) throw new TimeoutError(`${this.describe}: still disabled`);
        const what = hit ? `<${hit.tagName.toLowerCase()} class="${hit.className}">` : "nothing";
        throw new TimeoutError(`${this.describe}: a click at its centre would hit ${what}`);
      }
    }
  }

  async focus() {
    const el = await this.element();
    el.focus();
    await frame();
  }

  /** Playwright's fill inserts the value, it does not type it: the same here. */
  async fill(value) {
    const el = await this.element({ visible: true });
    // Editable, as Playwright waits for: enabled and not read-only.
    await until(`waiting for ${this.describe} to be editable`, () => !isDisabled(el) && !el.readOnly);
    el.focus();
    if (el.isContentEditable) {
      el.textContent = value;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      await frame();
      return;
    }
    // The element's own class's setter, which is what React listens behind.
    const proto = [HTMLTextAreaElement, HTMLSelectElement, HTMLInputElement].find((Kind) => el instanceof Kind)?.prototype;
    if (!proto) throw new Error(`${this.describe}: fill() needs an input, a textarea, a select or an editable element`);
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    await frame();
  }

  async innerText() {
    return (await this.element()).innerText;
  }

  async allInnerTexts() {
    return this.query().map((el) => el.innerText);
  }

  async getAttribute(name) {
    return (await this.element()).getAttribute(name);
  }

  async inputValue() {
    return (await this.element()).value;
  }

  async boundingBox() {
    const el = await this.element();
    if (!el.getClientRects().length) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }
}

// --- native input --------------------------------------------------------------

// macOS virtual key codes (Carbon's kVK_*) and the characters AppKit puts on
// the NSEvent. WebKit derives `key` and `code` from these, so they have to be
// the real ones.
const LETTERS = { a: 0, s: 1, d: 2, f: 3, h: 4, g: 5, z: 6, x: 7, c: 8, v: 9, b: 11, q: 12, w: 13, e: 14, r: 15, y: 16, t: 17, o: 31, u: 32, i: 34, p: 35, l: 37, j: 38, k: 40, n: 45, m: 46 };
const DIGITS = { 1: 18, 2: 19, 3: 20, 4: 21, 6: 22, 5: 23, 9: 25, 7: 26, 8: 28, 0: 29 };
const PUNCT = { " ": 49, ",": 43, ".": 47, "/": 44, ";": 41, "'": 39, "[": 33, "]": 30, "\\": 42, "-": 27, "=": 24, "`": 50 };
const FN = 0x800000;
const NUMPAD = 0x200000;
const NAMED = {
  Escape: { code: 53, chars: "\u001b" },
  Enter: { code: 36, chars: "\r" },
  Tab: { code: 48, chars: "\t" },
  Backspace: { code: 51, chars: "\u007f" },
  Delete: { code: 117, chars: "\uf728", flags: FN },
  ArrowUp: { code: 126, chars: "\uf700", flags: FN | NUMPAD },
  ArrowDown: { code: 125, chars: "\uf701", flags: FN | NUMPAD },
  ArrowLeft: { code: 123, chars: "\uf702", flags: FN | NUMPAD },
  ArrowRight: { code: 124, chars: "\uf703", flags: FN | NUMPAD },
  Home: { code: 115, chars: "\uf729", flags: FN },
  End: { code: 119, chars: "\uf72b", flags: FN },
  PageUp: { code: 116, chars: "\uf72c", flags: FN },
  PageDown: { code: 121, chars: "\uf72d", flags: FN },
  F2: { code: 120, chars: "\uf705", flags: FN },
  F6: { code: 97, chars: "\uf709", flags: FN },
  F10: { code: 109, chars: "\uf70d", flags: FN },
  Space: { code: 49, chars: " " },
  Comma: { code: 43, chars: "," },
  Period: { code: 47, chars: "." },
  Slash: { code: 44, chars: "/" },
  Semicolon: { code: 41, chars: ";" },
  Quote: { code: 39, chars: "'" },
  Minus: { code: 27, chars: "-" },
  Equal: { code: 24, chars: "=" },
};
const MODIFIER = { Shift: 0x20000, Control: 0x40000, Alt: 0x80000, Meta: 0x100000 };
const SHIFTED = { ",": "<", ".": ">", "/": "?", ";": ":", "'": '"', "[": "{", "]": "}", "\\": "|", "-": "_", "=": "+", "`": "~" };

/** "Meta+Shift+KeyJ" → the NSEvent fields for that chord. */
function chord(combo) {
  const parts = combo.split("+");
  const name = parts.pop();
  let flags = 0;
  for (const m of parts) {
    if (!(m in MODIFIER)) throw new Error(`selftest: unknown modifier "${m}" in "${combo}"`);
    flags |= MODIFIER[m];
  }
  let key;
  const letter = name.match(/^Key([A-Z])$/)?.[1]?.toLowerCase() ?? (/^[a-z]$/i.test(name) ? name.toLowerCase() : null);
  const digit = name.match(/^Digit(\d)$/)?.[1] ?? (/^\d$/.test(name) ? name : null);
  if (letter) key = { code: LETTERS[letter], chars: letter };
  else if (digit) key = { code: DIGITS[digit], chars: digit };
  else if (NAMED[name]) key = NAMED[name];
  else if (name.length === 1 && name in PUNCT) key = { code: PUNCT[name], chars: name };
  else throw new Error(`selftest: no key code for "${name}" in "${combo}"`);

  const shift = !!(flags & MODIFIER.Shift);
  let ignoring = key.chars;
  if (shift && letter) ignoring = letter.toUpperCase();
  else if (shift && SHIFTED[key.chars]) ignoring = SHIFTED[key.chars];
  let characters = ignoring;
  // AppKit's own values: ⌃ turns a letter into its control character, and ⇧⇥
  // is the back-tab character.
  if (flags & MODIFIER.Control && letter) characters = String.fromCharCode(letter.charCodeAt(0) & 0x1f);
  if (shift && name === "Tab") characters = ignoring = "\u0019";
  return { keyCode: key.code, characters, charactersIgnoringModifiers: ignoring, modifierFlags: flags | (key.flags ?? 0) };
}

/** Resolves when the page has seen the key come back up, or after a grace period. */
function keyupSeen(timeout = 1500) {
  return new Promise((resolve) => {
    const done = (seen) => {
      window.removeEventListener("keyup", onUp, true);
      clearTimeout(timer);
      resolve(seen);
    };
    const onUp = () => done(true);
    const timer = setTimeout(() => done(false), timeout);
    window.addEventListener("keyup", onUp, true);
  });
}

async function nativeKey(fields) {
  // Keys go only to the key window. If another app took the keyboard — someone
  // clicked elsewhere during a run on their own Mac — the app asks for it back
  // and this waits for it, then says so plainly rather than timing out later.
  for (let tries = 0; ; tries++) {
    try {
      const seen = keyupSeen();
      await invoke("selftest_key", { event: fields });
      if (!(await seen)) {
        // Not fatal, as before: a check notices a lost key by what it failed to do.
        // Said here, so that failure has a cause beside it.
        const facts = await invoke("selftest_input_facts").catch(() => ({}));
        log(`key ${JSON.stringify(fields.characters)} never came back up — focus on ${document.activeElement?.tagName.toLowerCase() ?? "nothing"}, first responder ${facts.firstResponder ?? "?"}`);
      }
      break;
    } catch (e) {
      if (!String(e).includes("not-key-window")) throw e;
      if (tries === 0) log("the window lost the keyboard to another app — taking it back");
      if (tries > 40) {
        throw new NoKeyboardError(
          "another app took the keyboard and kept it — someone was using the Mac. The self-test needs it untouched for about a minute.",
        );
      }
      await sleep(100);
    }
  }
  // Let React commit what the key did, as Playwright's press does by waiting
  // for the renderer to acknowledge the event.
  await frame();
  await frame();
}

function clickSeen(timeout = 1500) {
  return new Promise((resolve) => {
    const done = (seen) => {
      window.removeEventListener("mouseup", onUp, true);
      clearTimeout(timer);
      resolve(seen);
    };
    const onUp = () => done(true);
    const timer = setTimeout(() => done(false), timeout);
    window.addEventListener("mouseup", onUp, true);
  });
}

async function nativeClick(x, y) {
  const seen = clickSeen();
  await invoke("selftest_click", { x, y });
  if (!(await seen)) {
    const hit = document.elementFromPoint(x, y);
    const facts = await invoke("selftest_input_facts").catch(() => ({}));
    throw new Error(
      `a native click at ${Math.round(x)},${Math.round(y)} never reached the page — under it ${hit ? `<${hit.tagName.toLowerCase()} class="${hit.className}">` : "nothing"}, ` +
        `focus on ${document.activeElement?.tagName.toLowerCase() ?? "nothing"}, first responder ${facts.firstResponder ?? "?"}, marked text ${facts.markedText ?? "?"}`,
    );
  }
  await frame();
  await frame();
}

const page = {
  async waitForSelector(selector, { timeout = 30_000, state = "visible" } = {}) {
    const test = {
      visible: () => [...document.querySelectorAll(selector)].some(isVisible),
      attached: () => !!document.querySelector(selector),
      detached: () => !document.querySelector(selector),
      hidden: () => ![...document.querySelectorAll(selector)].some(isVisible),
    }[state];
    await until(`waiting for "${selector}" to be ${state}`, test, timeout);
  },
  locator(selector, { hasText } = {}) {
    const query = () => {
      const all = [...document.querySelectorAll(selector)];
      return hasText == null ? all : all.filter((el) => textMatches(el, hasText));
    };
    return new Locator(query, hasText == null ? `"${selector}"` : `"${selector}" with text ${hasText}`);
  },
  getByRole(role, options = {}) {
    return new Locator(byRole(() => [document.documentElement], role, options), `role=${role}${options.name ? ` name=${options.name}` : ""}`);
  },
  getByLabel(text, options = {}) {
    return new Locator(byLabel(() => [document.documentElement], text, options), `label=${text}`);
  },
  /** The window's content becomes this size, below the app's minimum if asked. */
  async setViewportSize({ width, height }) {
    await invoke("selftest_resize", { width, height });
    await until(`the page to be ${width}×${height}`, () => Math.abs(innerWidth - width) <= 1 && Math.abs(innerHeight - height) <= 1);
    await frame();
  },
  keyboard: {
    press: (combo) => nativeKey(chord(combo)),
    async type(text) {
      for (const ch of text) {
        const lower = ch.toLowerCase();
        const code = LETTERS[lower] ?? DIGITS[ch] ?? PUNCT[ch] ?? 0;
        const upper = ch !== lower;
        await nativeKey({
          keyCode: code,
          characters: ch,
          charactersIgnoringModifiers: ch,
          modifierFlags: upper ? MODIFIER.Shift : 0,
        });
      }
    },
  },
  mouse: { click: nativeClick },
  evaluate: async (fn, arg) => fn(arg),
  waitForTimeout: sleep,
  /**
   * A reload replaces the page this harness runs in, so it ends the check that
   * asks for it (smoke-checks.mjs allows it only as a last statement): report
   * that check, leave the run's state with the app, and let the next page's
   * harness resume at the check after it.
   */
  async reload() {
    const failed = audits.findings.length ? `accessibility:\n        ${audits.findings.join("\n        ")}` : null;
    await report(running.check, failed);
    await invoke("selftest_reload", {
      resumeAt: running.index + 1,
      console: [...consoleErrors],
      advisories: advisoryObject(),
    });
    location.reload();
    await new Promise(() => {});
  },
};

// --- the run --------------------------------------------------------------------

const audits = { findings: [], advisories: new Map() };
window.axe = axe;

/** The check in progress, for a reload that has to report it. */
const running = { index: 0, check: null, started: 0, scheme: "" };

const advisoryObject = () =>
  Object.fromEntries([...audits.advisories].map(([id, a]) => [id, { help: a.help, surfaces: [...a.surfaces] }]));

async function report(check, error, skipped = null) {
  const ms = Math.round(performance.now() - running.started);
  const shot = `${running.scheme}-${check.name.replace(/[^a-z0-9]+/gi, "-")}`;
  if (!skipped) {
    await invoke("selftest_capture", { name: shot }).catch((e) => log(`capture failed: ${e}`));
  }
  const result = skipped
    ? { scheme: running.scheme, name: check.name, ok: true, ms, error: null, skipped }
    : { scheme: running.scheme, name: check.name, ok: !error, ms, error, screenshot: shot };
  await invoke("selftest_check", { result }).catch(() => {});
  const status = skipped ? "skip" : error ? "FAIL" : "ok  ";
  log(`${status}  ${running.scheme} · ${check.name} (${skipped ?? `${ms}ms`})${error ? `\n        ${error.split("\n")[0]}` : ""}`);
  return result;
}

/**
 * Where the pointer rests: the toolbar's empty reserve beside the traffic
 * lights, where nothing has a hover style. Left alone, hover follows the last
 * click. It is parked before every check and every audit. That is not the
 * whole answer: macOS still tells the window where the Mac's own pointer is
 * when it activates, and hovers under it anyway (2026-09-14), so runAxe also
 * holds transitions at their end while axe reads.
 */
async function parkPointer() {
  await invoke("selftest_click", { x: 35, y: 14, press: false });
  await frame();
  await frame();
}

async function audit(_page, surface) {
  await parkPointer();
  recordAudit(await runAxe(AUDIT_TAGS), surface, audits);
  await holdTree(surface);
}

/** WebKit's accessibility tree under `selector`, written as a snapshot (normalized). */
async function webkitTree(selector) {
  // A render that replaces nodes mid-walk leaves the inspector holding ids it
  // no longer has: read it again, as a locator asks again for a detached element.
  // A walk that never answered is not read again: it is still running in the
  // inspector, and a second walk queues behind it (selftest_ax waits for it).
  for (let attempt = 1; ; attempt++) {
    const started = performance.now();
    try {
      const answer = JSON.parse(await invoke("selftest_ax", { selector }));
      if (answer.error) throw new Error(`WebKit's accessibility tree: ${answer.error}`);
      return normalizeTree(renderWebKitTree(answer.tree));
    } catch (e) {
      if (attempt >= 3 || !/Missing node|nothing matches/.test(String(e?.message ?? e))) throw e;
      await sleep(250);
    } finally {
      const ms = Math.round(performance.now() - started);
      if (ms > 5000) log(`WebKit's accessibility tree of ${selector} took ${ms}ms`);
    }
  }
}

/**
 * The surface's accessibility tree, as WebKit hands it to VoiceOver, held
 * against scripts/aria/native/<surface>.yml, or <surface>.dark.yml in the dark pass where
 * one exists (docs/app/preferences-and-help/accessibility.md#A11Y-16).
 * The tree is kept with the run's evidence either way, so a changed surface
 * is accepted by copying it (scripts/aria-accept.mjs). The names count within a
 * pass, across a check's reload, so a surface audited twice has two files.
 */
const surfaceNames = new SurfaceNames(() => sessionStorage, "selftest:aria-names");
async function holdTree(surface) {
  const take = async () => forSurface(await webkitTree("body"));
  let tree;
  try {
    tree = await take();
  } catch (e) {
    surfaceNames.next(surface);
    audits.findings.push(`accessibility tree of ${surface}: could not be read — ${e?.message ?? e}`);
    return;
  }
  await holdText(surface, tree, take);
}

/** How long a tree that differs is read again before it fails, as smoke waits. */
const SETTLE_MS = 3000;

/** What a check read off WebKit's tree (the driver's `hold`), held the same way. */
async function hold(_page, name, text) {
  await holdText(name, normalizeTree(text));
}

async function holdText(surface, tree, retake) {
  const name = surfaceNames.next(surface);
  let expected = await invoke("selftest_aria", { name, text: tree, scheme: running.scheme });
  // Still settling: read again until it matches or the settle time is up, and
  // keep the last reading as the evidence.
  if (expected != null && retake) {
    for (const until = performance.now() + SETTLE_MS; normalizeTree(expected) !== tree && performance.now() < until; ) {
      await sleep(250);
      tree = await retake().catch(() => tree);
    }
    expected = await invoke("selftest_aria", { name, text: tree, scheme: running.scheme });
  }
  if (expected == null) {
    audits.findings.push(`accessibility tree of ${surface}: no expectation in scripts/aria/native/${name}.yml (WebKit's tree is in the run's evidence, aria/${name}.yml)`);
  } else if (normalizeTree(expected) !== tree) {
    audits.findings.push(`accessibility tree of ${surface} (scripts/aria/native/${name}.yml), ${firstDifference(normalizeTree(expected), tree)}`);
  }
}

/**
 * The checks measure what is drawn, so a page that is not being drawn cannot
 * pass or fail them honestly. Wait a few seconds for the window to come back
 * (someone glanced at another app), then stop with the reason.
 */
async function visibleOrFail() {
  const deadline = performance.now() + 5000;
  while (document.visibilityState !== "visible") {
    if (performance.now() > deadline) {
      throw new NotVisibleError(
        "the self-test window is not visible — the screen is locked, or the window is hidden or minimised — " +
          "and WebKit draws nothing nobody can see. Run it on an unlocked Mac and leave the window in front.",
      );
    }
    await sleep(100);
  }
}

async function main() {
  const ctx = await invoke("selftest_context");
  const scheme = ctx.pass;
  /** The features a narrowed pass keeps (smoke-checks.mjs `selected`). */
  const features = (ctx.features ?? "").split(/[,\s]+/).filter(Boolean);
  log(`pass ${ctx.index + 1}/${ctx.total} (${scheme}) — ${navigator.userAgent}`);
  if (features.length) log(`narrowed to ${features.join(", ")}: the other detachable features' checks are left out`);
  const drawing = { framesPerSecond: await frameRate(), visibility: document.visibilityState, hasFocus: document.hasFocus() };
  log(`drawing: ${JSON.stringify(drawing)}`);

  if (ctx.break === "flex") {
    // The 2026-09-02 blank window, on purpose: `.editor-frame { flex: 1 }`
    // swallowed by a stylesheet edit. A self-test that passes with this is
    // not testing anything (CI runs it and expects the failure).
    const style = document.createElement("style");
    style.textContent = ".editor-frame { flex: initial !important; }";
    document.head.appendChild(style);
    log("deliberate break: .editor-frame { flex: initial }");
  }

  const checks = smokeChecks({ audit, hold });
  // Set when the Mac stops being the self-test's — the screen locked or the
  // window hidden ("hidden"), or the keyboard taken ("keyboard"). No later check
  // could mean anything then, and the run proves nothing either way.
  let interrupted = null;
  if (ctx.resumeAt) log(`resuming at "${checks[ctx.resumeAt]?.name}" after a reload`);
  for (let index = ctx.resumeAt ?? 0; index < checks.length; index++) {
    const check = checks[index];
    Object.assign(running, { index, check, started: performance.now(), scheme });
    if (ctx.only && !check.name.includes(ctx.only)) {
      await report(check, null, "not selected (--only)");
      continue;
    }
    if (!selected(check, features)) {
      await report(check, null, "not in this run's features");
      continue;
    }
    // A check that drives the dev-mock's hooks has nothing to drive here.
    if (check.devMock) {
      await report(check, null, "dev-mock only");
      continue;
    }
    audits.findings.length = 0;
    running.started = performance.now();
    let error = null;
    try {
      await parkPointer();
      // A check that failed with a menu or sheet up must not take the next one
      // down with it: close what is open, and only what is open (as smoke
      // does). Inside the try, because these are keys too: a keyboard taken
      // here fails this check with the reason, rather than the whole harness.
      for (let i = 0; i < 4 && document.querySelector(".menu, .sheet, .alert"); i++) {
        await page.keyboard.press("Escape");
        await sleep(120);
      }
      await visibleOrFail();
      await check.run(page);
      if (audits.findings.length) throw new Error(`accessibility:\n        ${audits.findings.join("\n        ")}`);
    } catch (e) {
      error = String(e?.stack && !(e instanceof TimeoutError) ? e.message : e);
      if (e instanceof NotVisibleError) interrupted = "hidden";
      if (e instanceof NoKeyboardError) interrupted = "keyboard";
    }
    await report(check, error);
    // A deliberate break has made its point at the first failure; every check
    // after it would only wait out its timeout on a layout that is not there.
    if (error && (ctx.break || interrupted)) break;
  }

  await invoke("selftest_done", {
    result: {
      stop: !!ctx.break || !!interrupted,
      interrupted,
      scheme,
      // Whether WebKit was drawing: at the pass's start, and every wait for a frame since.
      drawing: { ...drawing, framesWaited: { ...frames } },
      userAgent: navigator.userAgent,
      console: [...consoleErrors],
      advisories: advisoryObject(),
    },
  });
}

if (window.top === window && !window.__prosceniumSelftestStarted) {
  window.__prosceniumSelftestStarted = true;
  const start = () =>
    main().catch((e) => {
      // The message first: the bundle is minified, so a stack alone names nothing.
      const said = `${e?.message ?? e}${e?.stack ? `\n${e.stack}` : ""}`;
      log(`harness crashed: ${said}`);
      invoke("selftest_done", {
        result: { stop: true, scheme: running.scheme || "unknown", checks: [], console: [...consoleErrors], crash: said },
      }).catch(() => {});
    });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}
