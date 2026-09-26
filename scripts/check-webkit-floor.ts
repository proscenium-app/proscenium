// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * check:webkit-floor — the built app, read against the oldest engine it runs in.
 *
 * The webview is the system's WebKit, so a Mac at the macOS floor renders
 * Proscenium with that release's Safari, and nothing in the toolchain says no
 * to a feature that engine lacks. The binding constraint when the floor was
 * chosen was `color-mix()` (Safari 16.2), threaded through the token system:
 * below it every colour built from it evaluates to nothing — the 2026-09-02
 * blank window in a different hat, arriving as a report nobody can reproduce
 * on a current Mac (docs/engineering/release-engineering.md#REL-8).
 *
 * What it reads is `dist/`, the bundle that ships, after esbuild has lowered
 * syntax and added prefixes for the same floor (vite.config.ts). What it reads
 * it against is MDN's browser-compat-data, the table caniuse is built from:
 *
 *   CSS  every property (prefix-aware), keyword value, function, unit, selector,
 *        at-rule and media feature. A declaration with a supported sibling for
 *        the same property in the same block is a fallback pair and passes —
 *        `-webkit-backdrop-filter` beside `backdrop-filter` is how a prefix
 *        is supposed to work.
 *   JS   global constructors and functions, static members (`Object.groupBy`),
 *        Web API members on `navigator`/`document`/`window`, and instance
 *        methods whose names belong only to a newer built-in. A use locally protected by a
 *        feature test (`typeof X`, `"X" in`, `X?.()`, `X && …`) passes. Guards
 *        do not cross a function boundary or bless other uses in the file. Syntax is esbuild's: the build fails on syntax it
 *        cannot lower for the target.
 *
 * A finding fails the run. A deliberate exception goes in ALLOWED below with
 * the reason it is safe on the floor — the gate exists to make that a decision,
 * because nothing said no is how thirty type sizes happened.
 *
 * Before checking anything it proves it can still fail: a canary of features
 * newer than the floor must be caught, or the check reports itself broken. A
 * check that cannot fail is not a check.
 *
 *   bun run check:webkit-floor              # builds dist/, then checks it
 *   bun scripts/check-webkit-floor.ts -v    # also lists guarded and allowed uses
 */
import bcd from "@mdn/browser-compat-data" with { type: "json" };
import * as csstree from "css-tree";
import * as acorn from "acorn";
import * as walk from "acorn-walk";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { webkitFloor } from "./webkit-floor.ts";

const ROOT = resolve(import.meta.dir, "..");
const DIST = join(ROOT, "dist/assets");
const VERBOSE = process.argv.includes("-v") || process.argv.includes("--verbose");

/**
 * Deliberate exceptions, each with why it is safe on the floor. Keyed by the
 * compat path the finding reports. Keep the reason honest: "degrades" is only
 * a reason if the degraded look was checked.
 */
const ALLOWED: Record<string, string> = {
  "css.properties.scrollbar-width":
    "Hides the tab strip's scrollbar (styles.css .pane__tabs). Below Safari 18.2 the " +
    "rule beside it, ::-webkit-scrollbar { display: none }, does the same job.",
  "css.at-rules.media.prefers-reduced-transparency":
    "WebKit has never shipped this media feature (webkit.org/b/175497), so the opaque-menu " +
    "rule is a no-op in the app on every macOS, not only the floor. The honest fix is " +
    "native (NSWorkspace.accessibilityDisplayShouldReduceTransparency → an attribute on " +
    "the document), and until then this is a known gap.",
};

// ---------------------------------------------------------------------------
// Versions and support statements

type Statement = {
  version_added: string | boolean | null;
  version_removed?: string | boolean | null;
  prefix?: string;
  alternative_name?: string;
  flags?: unknown[];
  partial_implementation?: boolean;
};
type Compat = { support: { safari?: Statement | Statement[] }; spec_url?: string | string[] };
type Node = { __compat?: Compat; [key: string]: unknown };

const floor = webkitFloor();
const FLOOR = [floor.safari, 0];

function parseVersion(v: string): number[] {
  return v.replace(/^≤/, "").split(".").map(Number);
}
function cmp(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

type Verdict = { ok: true; partial: boolean } | { ok: false; since: string };

/**
 * Is `compat` usable at the floor, written the way the code writes it? `form`
 * is the prefix in use ("" for none) or, for a renamed feature, its old name.
 */
function supportedAtFloor(compat: Compat | undefined, form = ""): Verdict | null {
  const raw = compat?.support?.safari;
  if (!raw) return null; // no data: nothing to judge, so no finding
  let since: string | null = null;
  for (const s of Array.isArray(raw) ? raw : [raw]) {
    if (s.flags) continue;
    const written = s.prefix ?? s.alternative_name ?? "";
    if (written !== form) continue;
    const added = s.version_added;
    if (added === false || added === null || added === "preview") {
      since ??= "not supported";
      continue;
    }
    if (added !== true && cmp(parseVersion(added), FLOOR) > 0) {
      if (since === null || since === "not supported" || cmp(parseVersion(added), parseVersion(since)) < 0) {
        since = added;
      }
      continue;
    }
    const removed = s.version_removed;
    if (typeof removed === "string" && cmp(parseVersion(removed), FLOOR) <= 0) continue;
    return { ok: true, partial: !!s.partial_implementation };
  }
  // A form the data never mentions (an unprefixed name with only a prefixed
  // statement, say) is unsupported in that spelling.
  return { ok: false, since: since ?? "not in this spelling" };
}

function at(path: string): Node | undefined {
  let node: unknown = bcd;
  for (const key of path.split(".")) node = (node as Record<string, unknown> | undefined)?.[key];
  return node as Node | undefined;
}

// ---------------------------------------------------------------------------
// Findings

type Finding = { path: string; since: string; where: string; what: string };
const findings: Finding[] = [];
const allowedHits = new Map<string, number>();
const notes: string[] = [];

function report(path: string, verdict: Verdict | null, where: string, what: string) {
  if (!verdict) return;
  if (verdict.ok) {
    if (verdict.partial && VERBOSE) notes.push(`partial  ${path} — ${what} (${where})`);
    return;
  }
  // An allowed feature covers its own values: allowing scrollbar-width allows
  // `scrollbar-width: none`.
  const allowed = Object.keys(ALLOWED).find((a) => path === a || path.startsWith(`${a}.`));
  if (allowed) {
    allowedHits.set(allowed, (allowedHits.get(allowed) ?? 0) + 1);
    return;
  }
  findings.push({ path, since: verdict.since, where, what });
}

// ---------------------------------------------------------------------------
// CSS

const PREFIX = /^-(webkit|moz|ms|o|khtml)-/;

/** css.types.* indexed by key: every function a value can call. */
const TYPE_INDEX = new Map<string, string[]>();
(function index(node: Node, path: string) {
  for (const [key, value] of Object.entries(node)) {
    if (key === "__compat" || typeof value !== "object" || value === null) continue;
    const child = `${path}.${key}`;
    if ((value as Node).__compat) TYPE_INDEX.set(key, [...(TYPE_INDEX.get(key) ?? []), child]);
    index(value as Node, child);
  }
})(at("css.types")!, "css.types");

/** Old spellings BCD records as an alternative_name, e.g. -webkit-font-smoothing. */
const ALT_PROPERTY = new Map<string, string>();
for (const [name, node] of Object.entries(at("css.properties")!)) {
  const raw = (node as Node).__compat?.support?.safari;
  for (const s of Array.isArray(raw) ? raw : raw ? [raw] : []) {
    if (s.alternative_name) ALT_PROPERTY.set(s.alternative_name, name);
  }
}

/** Grouped length units BCD files under one key. */
const UNIT_GROUP: Record<string, string> = {
  ...Object.fromEntries(["cqw", "cqh", "cqi", "cqb", "cqmin", "cqmax"].map((u) => [u, "container_query_length_units"])),
  ...Object.fromEntries(["dvh", "dvw", "dvi", "dvb", "dvmin", "dvmax"].map((u) => [u, "viewport_percentage_units_dynamic"])),
  ...Object.fromEntries(["lvh", "lvw", "lvi", "lvb", "lvmin", "lvmax"].map((u) => [u, "viewport_percentage_units_large"])),
  ...Object.fromEntries(["svh", "svw", "svi", "svb", "svmin", "svmax"].map((u) => [u, "viewport_percentage_units_small"])),
};

type Located = { loc?: { start: { line: number; column: number } } | null };
const pos = (file: string, node: Located) =>
  node.loc ? `${file}:${node.loc.start.line}:${node.loc.start.column}` : file;

/** The property's compat entry and the spelling in use. */
function propertyCompat(property: string): { path: string; form: string } | null {
  if (at(`css.properties.${property}`)?.__compat) return { path: `css.properties.${property}`, form: "" };
  const prefix = property.match(PREFIX)?.[0];
  if (prefix) {
    const base = property.slice(prefix.length);
    if (at(`css.properties.${base}`)?.__compat) return { path: `css.properties.${base}`, form: prefix };
  }
  const renamed = ALT_PROPERTY.get(property);
  return renamed ? { path: `css.properties.${renamed}`, form: property } : null;
}

function declarationVerdicts(decl: csstree.Declaration, file: string) {
  const out: Array<{ path: string; verdict: Verdict | null; where: string; what: string }> = [];
  const property = decl.property.toLowerCase();
  const prop = propertyCompat(property);
  const where = pos(file, decl);
  const propVerdict = prop ? supportedAtFloor(at(prop.path)?.__compat, prop.form) : null;
  if (prop) out.push({ path: prop.path, verdict: propVerdict, where, what: property });
  csstree.walk(decl.value, (node) => {
    // A keyword under a property the floor lacks is the same finding twice.
    if (node.type === "Identifier" && prop && propVerdict?.ok !== false) {
      const name = node.name.toLowerCase();
      const sub = at(`${prop.path}.${name}`);
      if (/^[a-z-]+$/.test(name) && sub?.__compat) {
        out.push({ path: `${prop.path}.${name}`, verdict: supportedAtFloor(sub.__compat), where, what: `${property}: ${name}` });
      }
    } else if (node.type === "Function") {
      const name = node.name.toLowerCase();
      const prefix = name.match(PREFIX)?.[0] ?? "";
      const paths = TYPE_INDEX.get(name.slice(prefix.length)) ?? [];
      // A name filed under several types (round() is a function and a keyword)
      // passes if any reading of it is supported: the check must not invent a
      // finding the data cannot pin down.
      const verdicts = paths.map((p) => ({ p, v: supportedAtFloor(at(p)?.__compat, prefix) }));
      if (verdicts.length && !verdicts.some(({ v }) => !v || v.ok)) {
        const first = verdicts[0];
        out.push({ path: first.p, verdict: first.v, where, what: `${name}()` });
      }
    } else if (node.type === "Dimension") {
      const unit = node.unit.toLowerCase();
      const key = UNIT_GROUP[unit] ?? unit;
      const path = `css.types.length.${key}`;
      if (at(path)?.__compat) out.push({ path, verdict: supportedAtFloor(at(path)?.__compat), where, what: `${node.value}${unit}` });
    }
  });
  return out;
}

function checkCss(css: string, file: string) {
  const ast = csstree.parse(css, { positions: true, filename: file, parseCustomProperty: true });
  const supports: csstree.Atrule[] = [];

  csstree.walk(ast, {
    enter(node: csstree.CssNode) {
      if (node.type === "Atrule") {
        const name = node.name.toLowerCase();
        const prefix = name.match(PREFIX)?.[0] ?? "";
        const path = `css.at-rules.${name.slice(prefix.length)}`;
        report(path, supportedAtFloor(at(path)?.__compat, prefix), pos(file, node), `@${name}`);
        if (name === "supports") supports.push(node);
        if ((name === "media" || name === "container") && node.prelude) {
          csstree.walk(node.prelude, (feature) => {
            if (feature.type === "Feature") {
              const base = feature.name.toLowerCase().replace(/^(min|max)-/, "");
              const fpath = `css.at-rules.media.${base}`;
              if (name === "media" && at(fpath)?.__compat) {
                report(fpath, supportedAtFloor(at(fpath)?.__compat), pos(file, feature), `(${feature.name})`);
              }
            } else if (feature.type === "FeatureRange" && name === "media") {
              report("css.at-rules.media.range_syntax", supportedAtFloor(at("css.at-rules.media.range_syntax")?.__compat), pos(file, feature), "media range syntax");
            }
          });
        }
      } else if (node.type === "PseudoClassSelector" || node.type === "PseudoElementSelector") {
        const name = node.name.toLowerCase();
        const path = `css.selectors.${name}`;
        report(path, supportedAtFloor(at(path)?.__compat), pos(file, node), `${node.type === "PseudoElementSelector" ? "::" : ":"}${name}`);
      } else if (node.type === "NestingSelector") {
        report("css.selectors.nesting", supportedAtFloor(at("css.selectors.nesting")?.__compat), pos(file, node), "&");
      } else if (node.type === "Block") {
        // Inside @supports the author already asked the engine; trust the answer.
        if (supports.length) return;
        const decls = node.children.toArray().filter((c): c is csstree.Declaration => c.type === "Declaration");
        const byProperty = new Map<string, boolean>();
        const verdicts = decls.map((d) => ({ d, vs: declarationVerdicts(d, file) }));
        for (const { d, vs } of verdicts) {
          const base = d.property.toLowerCase().replace(PREFIX, "");
          const clean = vs.every(({ verdict }) => !verdict || verdict.ok);
          byProperty.set(base, (byProperty.get(base) ?? false) || clean);
        }
        for (const { d, vs } of verdicts) {
          const base = d.property.toLowerCase().replace(PREFIX, "");
          // A supported sibling for the same property means this one is the
          // enhancement in a fallback pair; the engine drops it and keeps the other.
          // Custom properties accept unknown tokens: a later assignment still
          // wins, then becomes invalid when var() is substituted.
          if (!d.property.startsWith("--") && byProperty.get(base) && vs.some(({ verdict }) => verdict && !verdict.ok)) {
            if (VERBOSE) notes.push(`fallback ${d.property} (${pos(file, d)})`);
            continue;
          }
          for (const v of vs) report(v.path, v.verdict, v.where, v.what);
        }
      }
    },
    leave(node: csstree.CssNode) {
      if (node.type === "Atrule" && supports.at(-1) === node) supports.pop();
    },
  });
}

// ---------------------------------------------------------------------------
// JS

const BUILTINS = at("javascript.builtins")! as Record<string, Node>;
const API = at("api")! as Record<string, Node>;

/** Receivers that name one Web API interface. */
const API_RECEIVER: Record<string, string> = {
  navigator: "Navigator",
  document: "Document",
  window: "Window",
  self: "Window",
  performance: "Performance",
  crypto: "Crypto",
  location: "Location",
  history: "History",
  screen: "Screen",
  CSS: "CSS",
};

const specUrls = (c?: Compat) => [c?.spec_url ?? []].flat().join(" ");
const isInstanceMember = (c?: Compat) => /\.prototype\./i.test(specUrls(c));

/**
 * Instance methods whose NAME alone means a built-in newer than the floor: a
 * call `x.name()` can only be that method, because no built-in the floor
 * supports has a member of the same name. `toSorted` would not be here even if
 * it were new — too many objects answer to `.at()` for a name to prove anything.
 */
const NEWER_INSTANCE_NAMES = new Map<string, string>();
{
  const supportedNames = new Set<string>();
  const newer = new Map<string, string>();
  for (const [ctor, node] of Object.entries(BUILTINS)) {
    for (const [member, child] of Object.entries(node)) {
      const compat = (child as Node).__compat;
      if (member === "__compat" || !compat || !isInstanceMember(compat)) continue;
      const verdict = supportedAtFloor(compat);
      if (!verdict || verdict.ok) supportedNames.add(member);
      else if (!newer.has(member)) newer.set(member, `javascript.builtins.${ctor}.${member}`);
    }
  }
  for (const [name, path] of newer) if (!supportedNames.has(name)) NEWER_INSTANCE_NAMES.set(name, path);
}

function checkJs(code: string, file: string) {
  let ast: acorn.Program;
  try {
    ast = acorn.parse(code, { ecmaVersion: "latest", sourceType: "module", locations: true, allowHashBang: true });
  } catch (e) {
    findings.push({ path: "syntax", since: "unparseable", where: file, what: String(e) });
    return;
  }

  const defined = new Set<string>();
  const nameOf = (n: acorn.Node | null | undefined): string | null => {
    if (!n) return null;
    if (n.type === "Identifier") return (n as acorn.Identifier).name;
    if (n.type === "Literal" && typeof (n as acorn.Literal).value === "string") return (n as acorn.Literal).value as string;
    if (n.type === "MemberExpression") return nameOf((n as acorn.MemberExpression).property);
    if (n.type === "ChainExpression") return nameOf((n as acorn.ChainExpression).expression);
    return null;
  };

  const parents = new Map<acorn.Node, acorn.Node>();
  walk.fullAncestor(ast, (node, _state, ancestors) => {
    const parent = ancestors.at(-2);
    if (parent) parents.set(node, parent);
    if (["MethodDefinition", "PropertyDefinition", "Property"].includes(node.type)) {
      defined.add(nameOf((node as acorn.MethodDefinition).key) ?? "");
    } else if (node.type === "AssignmentExpression") {
      const a = node as acorn.AssignmentExpression;
      if (a.left.type === "MemberExpression") defined.add(nameOf(a.left.property) ?? "");
    }
  });

  // A qualified receiver, not the final member name: testing other.groupBy
  // never proves Object.groupBy exists. Dynamic receiver expressions are not
  // stable enough to prove a guard and need an explicit local implementation.
  const keyOf = (node: acorn.Node | null | undefined): string | null => {
    if (!node) return null;
    if (node.type === "Identifier") return (node as acorn.Identifier).name;
    if (node.type === "ChainExpression") return keyOf((node as acorn.ChainExpression).expression);
    if (node.type !== "MemberExpression") return null;
    const m = node as acorn.MemberExpression;
    const object = keyOf(m.object);
    const member = m.computed ? (m.property.type === "Literal" ? nameOf(m.property) : null) : nameOf(m.property);
    return object && member ? object + "." + member : null;
  };
  const absent = (n: acorn.Node) =>
    (n.type === "Identifier" && (n as acorn.Identifier).name === "undefined") ||
    (n.type === "Literal" && (n as acorn.Literal).value === null) ||
    (n.type === "UnaryExpression" && (n as acorn.UnaryExpression).operator === "void");
  const proves = (test: acorn.Node, key: string, truth: boolean): boolean => {
    if (keyOf(test) === key) return truth;
    if (test.type === "UnaryExpression" && (test as acorn.UnaryExpression).operator === "!") {
      return proves((test as acorn.UnaryExpression).argument, key, !truth);
    }
    if (test.type === "LogicalExpression") {
      const t = test as acorn.LogicalExpression;
      if (t.operator === "&&") return truth
        ? proves(t.left, key, true) || proves(t.right, key, true)
        : proves(t.left, key, false) && proves(t.right, key, false);
      if (t.operator === "||") return truth
        ? proves(t.left, key, true) && proves(t.right, key, true)
        : proves(t.left, key, false) || proves(t.right, key, false);
    }
    if (test.type !== "BinaryExpression") return false;
    const t = test as acorn.BinaryExpression;
    if (t.operator === "in") return truth && t.left.type === "Literal" &&
      keyOf(t.right) + "." + nameOf(t.left) === key;
    if (!/^[!=]==?$/.test(t.operator)) return false;
    const equal = t.operator.startsWith("=") === truth;
    for (const [a, b] of [[t.left, t.right], [t.right, t.left]]) {
      // `!== null` still admits undefined, so cannot protect a missing API.
      const onlyNull = b.type === "Literal" && (b as acorn.Literal).value === null;
      if (keyOf(a) === key && absent(b) && (!onlyNull || t.operator.length === 2)) return !equal;
      if (a.type === "UnaryExpression" && (a as acorn.UnaryExpression).operator === "typeof" &&
          keyOf((a as acorn.UnaryExpression).argument) === key && b.type === "Literal") {
        const kind = (b as acorn.Literal).value;
        return kind === "undefined" ? !equal : equal && ["function", "object", "string", "number", "boolean", "symbol", "bigint"].includes(String(kind));
      }
    }
    return false;
  };
  const guardedUse = (node: acorn.Node): boolean => {
    const subject = node.type === "CallExpression" || node.type === "NewExpression"
      ? (node as acorn.CallExpression).callee : node;
    const key = keyOf(subject);
    if (!key) return false;
    if (node.type === "CallExpression" && (node as acorn.CallExpression).optional) return true;
    const parent = parents.get(node);
    if (node.type === "MemberExpression" && parent) {
      // Reading a possibly absent property to test it is safe in itself. That
      // read says nothing about a later, unprotected call in the same file.
      if (parent.type === "UnaryExpression" && (parent as acorn.UnaryExpression).operator === "typeof") return true;
      if (parent.type === "BinaryExpression" && /^[!=]==?$/.test((parent as acorn.BinaryExpression).operator)) {
        const p = parent as acorn.BinaryExpression;
        if (absent(p.left) || absent(p.right)) return true;
      }
      if (parent.type === "CallExpression" && (parent as acorn.CallExpression).callee === node && (parent as acorn.CallExpression).optional) return true;
      if (parent.type === "MemberExpression" && (parent as acorn.MemberExpression).object === node && (parent as acorn.MemberExpression).optional) return true;
      if (parent.type === "IfStatement" && (parent as acorn.IfStatement).test === node) return true;
      if (parent.type === "ConditionalExpression" && (parent as acorn.ConditionalExpression).test === node) return true;
      if (parent.type === "LogicalExpression" && (parent as acorn.LogicalExpression).left === node) return true;
    }
    let child = node;
    for (let p = parent; p; child = p, p = parents.get(p)) {
      if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(p.type)) break;
      if (p.type === "IfStatement" || p.type === "ConditionalExpression") {
        const t = p as acorn.IfStatement | acorn.ConditionalExpression;
        if (child === t.consequent && proves(t.test, key, true)) return true;
        if (child === t.alternate && proves(t.test, key, false)) return true;
      } else if (p.type === "LogicalExpression") {
        const t = p as acorn.LogicalExpression;
        if (child === t.right && ((t.operator === "&&" && proves(t.left, key, true)) ||
            (t.operator === "||" && proves(t.left, key, false)))) return true;
      }
    }
    return false;
  };

  const check = (path: string, compat: Compat | undefined, name: string, node: acorn.Node, what: string) => {
    const verdict = supportedAtFloor(compat);
    if (!verdict || verdict.ok) return;
    if (guardedUse(node)) {
      if (VERBOSE) notes.push(`guarded  ${what} (${file}:${node.loc?.start.line})`);
      return;
    }
    report(path, verdict, `${file}:${node.loc?.start.line}:${node.loc?.start.column}`, what);
  };

  walk.simple(ast, {
    MemberExpression(node) {
      const m = node as acorn.MemberExpression;
      const member = m.computed ? (m.property.type === "Literal" ? String((m.property as acorn.Literal).value) : null) : nameOf(m.property);
      if (!member) return;
      if (m.object.type === "Identifier") {
        const receiver = (m.object as acorn.Identifier).name;
        const builtin = BUILTINS[receiver];
        const staticCompat = (builtin?.[member] as Node | undefined)?.__compat;
        if (staticCompat && !isInstanceMember(staticCompat)) {
          check(`javascript.builtins.${receiver}.${member}`, staticCompat, member, m, `${receiver}.${member}`);
        }
        const iface = API_RECEIVER[receiver];
        if (iface) {
          const direct = API[iface]?.[member] as Node | undefined;
          const statik = API[iface]?.[`${member}_static`] as Node | undefined;
          const entry = statik?.__compat ? statik : direct;
          if (entry?.__compat) {
            check(`api.${iface}.${statik?.__compat ? `${member}_static` : member}`, entry.__compat, member, m, `${receiver}.${member}`);
          }
        }
      }
    },
    NewExpression(node) {
      const callee = (node as acorn.NewExpression).callee;
      if (callee.type !== "Identifier") return;
      const name = (callee as acorn.Identifier).name;
      const entry = BUILTINS[name] ?? API[name];
      if (entry?.__compat) check(BUILTINS[name] ? `javascript.builtins.${name}` : `api.${name}`, entry.__compat, name, node, `new ${name}`);
    },
    CallExpression(node) {
      const c = node as acorn.CallExpression;
      if (c.callee.type === "Identifier") {
        const name = (c.callee as acorn.Identifier).name;
        const entry = (API[name] ?? API.Window?.[name]) as Node | undefined;
        if (/^[a-z]/.test(name) && entry?.__compat) {
          check(API[name] ? `api.${name}` : `api.Window.${name}`, entry.__compat, name, c, `${name}()`);
        }
      } else if (c.callee.type === "MemberExpression") {
        const name = nameOf((c.callee as acorn.MemberExpression).property);
        const path = name ? NEWER_INSTANCE_NAMES.get(name) : undefined;
        if (name && path && !defined.has(name)) check(path, at(path)?.__compat, name, c, `.${name}()`);
      }
    },
  });
}

// ---------------------------------------------------------------------------
// The canary: the checker must still be able to say no.

function canary() {
  const before = findings.length;
  const saved = { ...ALLOWED };
  for (const k of Object.keys(ALLOWED)) delete ALLOWED[k];
  checkCss(
    `.a{field-sizing:content}@starting-style{.b{opacity:0}}.c{text-wrap:balance}`,
    "canary.css",
  );
  checkJs(`const {promise} = Promise.withResolvers(); Object.groupBy([], (x) => x);`, "canary.js");
  const caught = new Set(findings.slice(before).map((f) => f.path));
  findings.length = before;
  Object.assign(ALLOWED, saved);
  const expected = [
    "css.properties.field-sizing",
    "css.at-rules.starting-style",
    "css.properties.text-wrap",
    "javascript.builtins.Promise.withResolvers",
    "javascript.builtins.Object.groupBy",
  ];
  const missed = expected.filter((p) => !caught.has(p));
  // Each fixture reproduces a false pass this gate once had: keep each reproduction separate. One caught Promise call must not
  // hide a false pass of the same API in another fixture.
  const fixtures = [
    ["unguarded method", "js", "Promise.withResolvers();", true],
    ["unrelated function guard", "js", "function unusedGuard(){return typeof Promise.withResolvers;} Promise.withResolvers();", true],
    ["different receiver guard", "js", "if (other.withResolvers) Promise.withResolvers();", true],
    ["guard's absent branch", "js", "if (typeof Promise.withResolvers === 'undefined') Promise.withResolvers();", true],
    ["strict null is not presence", "js", "if (Promise.withResolvers !== null) Promise.withResolvers();", true],
    ["optional use elsewhere", "js", "Promise.withResolvers?.(); Promise.withResolvers();", true],
    ["guard cannot cross function", "js", "if (Promise.withResolvers) { callback = () => Promise.withResolvers(); }", true],
    ["call used as condition", "js", "if (Promise.withResolvers()) {}", true],
    ["direct colour function", "css", ".audit{color:light-dark(black,white)}", true],
    ["custom property function", "css", ".audit{--ink:light-dark(black,white);color:var(--ink)}", true],
    ["custom assignment is no fallback", "css", ".audit{--ink:black;--ink:light-dark(black,white);color:var(--ink)}", true],
    ["local presence guard", "js", "if (typeof Promise.withResolvers === 'function') Promise.withResolvers();", false],
    ["local else guard", "js", "if (typeof Promise.withResolvers === 'undefined') {} else Promise.withResolvers();", false],
    ["local logical guard", "js", "Promise.withResolvers && Promise.withResolvers();", false],
    ["local optional call", "js", "Promise.withResolvers?.();", false],
    ["local nullish guard", "js", "if (Promise.withResolvers != null) Promise.withResolvers();", false],
    ["probe alone", "js", "function probe(){return typeof Promise.withResolvers;}", false],
    ["ordinary colour fallback", "css", ".audit{color:black;color:light-dark(black,white)}", false],
  ] as const;
  for (const [label, kind, source, shouldFail] of fixtures) {
    if (kind === "css") checkCss(source, `canary-${label}.css`);
    else checkJs(source, `canary-${label}.js`);
    const failed = findings.length > before;
    findings.length = before;
    if (failed !== shouldFail) missed.push(`canary ${label}: expected ${shouldFail ? "rejection" : "acceptance"}`);
  }
  if (missed.length) {
    console.error(
      `check:webkit-floor: BROKEN — the canary features newer than Safari ${floor.safari} were not caught:\n  ` +
        missed.join("\n  "),
    );
    process.exit(2);
  }
}

// ---------------------------------------------------------------------------

async function main() {
  // Vite must build for the same floor this checks, or esbuild lowers syntax
  // and adds prefixes for some other engine.
  const vite = (await import("../vite.config.ts")).default as { build?: { target?: unknown } };
  if (vite.build?.target !== floor.esbuildTarget) {
    console.error(
      `check:webkit-floor: vite.config.ts builds for ${JSON.stringify(vite.build?.target)}, ` +
        `but the floor is macOS ${floor.macos} = ${floor.esbuildTarget}`,
    );
    process.exit(1);
  }

  canary();

  if (!existsSync(DIST)) {
    console.error("check:webkit-floor: no dist/ — run `bun run check:webkit-floor`, which builds it first");
    process.exit(1);
  }
  const files = readdirSync(DIST).filter((f) => f.endsWith(".css") || f.endsWith(".js"));
  for (const f of files) {
    const text = readFileSync(join(DIST, f), "utf8");
    if (f.endsWith(".css")) checkCss(text, `dist/assets/${f}`);
    else checkJs(text, `dist/assets/${f}`);
  }

  if (VERBOSE) {
    for (const n of notes) console.log(`  ${n}`);
    for (const [path, count] of allowedHits) console.log(`  allowed  ${path} ×${count} — ${ALLOWED[path]}`);
  }
  for (const path of Object.keys(ALLOWED)) {
    if (!allowedHits.has(path)) {
      console.log(`  note: ALLOWED entry ${path} no longer matches anything — delete it`);
    }
  }

  if (findings.length) {
    const grouped = new Map<string, Finding[]>();
    for (const f of findings) grouped.set(f.path, [...(grouped.get(f.path) ?? []), f]);
    console.error(
      `check:webkit-floor: ${grouped.size} feature${grouped.size === 1 ? "" : "s"} newer than ` +
        `Safari ${floor.safari}.0 (macOS ${floor.macos}):`,
    );
    for (const [path, list] of grouped) {
      console.error(`  ${path} — Safari ${list[0].since}`);
      for (const f of list.slice(0, 4)) console.error(`      ${f.what}  ${f.where}`);
      if (list.length > 4) console.error(`      … and ${list.length - 4} more`);
    }
    console.error(
      "  Use something the floor supports, pair it with a fallback in the same rule, " +
        "or add it to ALLOWED in scripts/check-webkit-floor.ts with the reason it is safe.",
    );
    process.exit(1);
  }
  console.log(
    `webkit-floor check: clean (${files.length} files against Safari ${floor.safari}.0 = macOS ${floor.macos}, ` +
      `compat data ${(bcd as { __meta: { version: string } }).__meta.version})`,
  );
}

await main();
