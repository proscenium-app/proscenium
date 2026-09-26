// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * check:network — every address the app uses lives in one file
 * (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D2).
 *
 * Proscenium contacts two services, the update check and anonymous reports, and
 * `src-tauri/src/telemetry/allowlist.rs` names both, with a test that holds the
 * list. This gate is what makes that file the only place: it fails on an
 * `http://` or `https://` address anywhere else in `src/` or `src-tauri/src/`,
 * so a new destination cannot arrive in a file a reviewer would not think to
 * read.
 *
 * Not counted, because none of them can make a request:
 *   - comments, doc comments included — `//`, `///`, `//!`, `/* … *\/`;
 *   - test code: `*.test.ts(x)`, a Rust `tests.rs`, and a `#[cfg(test)]` module;
 *   - a bare scheme with no host, like the `https://` a link field starts with;
 *   - XML namespace names, which are names, not places: those under
 *     `http://www.w3.org/`, and the ones a .docx and an .odt must declare —
 *     Office Open XML's `http://schemas.openxmlformats.org/…`, its
 *     compatibility setting's `http://schemas.microsoft.com/office/word`, and
 *     Dublin Core's `http://purl.org/dc/…`
 *     (docs/app/formatting/formats-and-layout.md#FMT-D109).
 *
 *   bun run check:network
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const ALLOWLIST = "src-tauri/src/telemetry/allowlist.rs";
/** A scheme and the start of a host — or of one built in place, `https://${host}` or `https://{host}`. */
const ADDRESS = /https?:\/\/[A-Za-z0-9[{$]/g;
const NAMESPACE =
  /^https?:\/\/(?:www\.w3\.org\/|schemas\.openxmlformats\.org\/|schemas\.microsoft\.com\/office\/word$|purl\.org\/dc\/)/;

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else yield path;
  }
}

/**
 * `text` with every comment blanked to spaces, newlines kept, strings intact.
 * A small scanner rather than a parser: it knows quotes, template literals,
 * Rust raw strings and char literals well enough that `"https://…"` is a string
 * and `// https://…` is a comment. Where it could misread a regex literal as a
 * comment, the result is a missed address, never a false one.
 */
export function withoutComments(text, { rust = false } = {}) {
  let out = "";
  let i = 0;
  const blank = (s) => s.replace(/[^\n]/g, " ");
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === "/" && next === "/") {
      const end = text.indexOf("\n", i);
      const stop = end === -1 ? text.length : end;
      out += blank(text.slice(i, stop));
      i = stop;
    } else if (c === "/" && next === "*") {
      // Rust block comments nest; JavaScript's do not.
      let depth = 1;
      let j = i + 2;
      while (j < text.length && depth > 0) {
        if (rust && text[j] === "/" && text[j + 1] === "*") {
          depth++;
          j += 2;
        } else if (text[j] === "*" && text[j + 1] === "/") {
          depth--;
          j += 2;
        } else j++;
      }
      out += blank(text.slice(i, j));
      i = j;
    } else if (
      rust &&
      c === "r" &&
      /^r#*"/.test(text.slice(i, i + 20)) &&
      !/[A-Za-z0-9_]/.test(text[i - 1] ?? "")
    ) {
      const hashes = text.slice(i + 1).match(/^#*/)[0];
      const close = `"${hashes}`;
      const end = text.indexOf(close, i + 2 + hashes.length);
      const stop = end === -1 ? text.length : end + close.length;
      out += text.slice(i, stop);
      i = stop;
    } else if (c === '"' || c === "`" || (!rust && c === "'")) {
      let j = i + 1;
      while (j < text.length && text[j] !== c) j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (rust && c === "'" && /^'(\\.|[^\\'])'/.test(text.slice(i, i + 4))) {
      // A char literal; a lifetime (`'a`) has no closing quote and is plain code.
      const length = text[i + 1] === "\\" ? 4 : 3;
      out += text.slice(i, i + length);
      i += length;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** A Rust file with each `#[cfg(test)]` item blanked: a `mod … { … }` block, or the line after. */
export function withoutRustTests(code) {
  let out = code;
  let at = out.indexOf("#[cfg(test)]");
  while (at !== -1) {
    const open = out.indexOf("{", at);
    const semicolon = out.indexOf(";", at);
    let end;
    if (open !== -1 && (semicolon === -1 || open < semicolon)) {
      let depth = 0;
      end = open;
      // Strings are still in `code`; braces inside them are rare in tests and
      // only ever widen what is skipped, never narrow it past the module.
      for (; end < out.length; end++) {
        if (out[end] === "{") depth++;
        if (out[end] === "}" && --depth === 0) break;
      }
      end++;
    } else {
      end = semicolon === -1 ? out.length : semicolon + 1;
    }
    out = out.slice(0, at) + out.slice(at, end).replace(/[^\n]/g, " ") + out.slice(end);
    at = out.indexOf("#[cfg(test)]", at + 1);
  }
  return out;
}

/** The addresses in one file that the gate refuses, as `{ line, address }`. */
export function addressesIn(path, text) {
  const rel = path.replace(/\\/g, "/");
  if (rel.endsWith(ALLOWLIST)) return [];
  if (/\.test\.[jt]sx?$/.test(rel) || /\/tests\.rs$/.test(rel) || /\/tests\//.test(rel)) return [];
  const rust = rel.endsWith(".rs");
  let code = withoutComments(text, { rust });
  if (rust) code = withoutRustTests(code);
  const found = [];
  for (const match of code.matchAll(ADDRESS)) {
    const address = code.slice(match.index).match(/^[^\s"'`)<>]+/)[0];
    if (NAMESPACE.test(address)) continue;
    const line = code.slice(0, match.index).split("\n").length;
    found.push({ line, address });
  }
  return found;
}

function main() {
  const failures = [];
  const scanned = [
    ...[...files(join(ROOT, "src"))].filter((p) => /\.(ts|tsx|js|jsx|mjs|css|html)$/.test(p)),
    ...[...files(join(ROOT, "src-tauri/src"))].filter((p) => p.endsWith(".rs")),
  ];
  for (const path of scanned) {
    for (const { line, address } of addressesIn(relative(ROOT, path), readFileSync(path, "utf8"))) {
      failures.push(`  ${relative(ROOT, path)}:${line}  ${address}`);
    }
  }
  if (failures.length) {
    console.error(
      [
        `check:network: ${failures.length} address${failures.length === 1 ? "" : "es"} outside ${ALLOWLIST}:`,
        ...failures,
        "Every address the app uses belongs in the allowlist, with its reason (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D2).",
      ].join("\n"),
    );
    process.exit(1);
  }
  console.log(`check:network: ${scanned.length} files, no address outside the allowlist`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
