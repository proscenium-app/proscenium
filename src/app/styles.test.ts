// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const css = createRequire(import.meta.url)("css-tree") as {
  parse(source: string, options: { onParseError: (error: Error) => never }): unknown;
};

test("the fixed stylesheet entry point loads every module once, with valid boundaries", async () => {
  const entryUrl = new URL("./styles.css", import.meta.url);
  const entry = await Bun.file(entryUrl).text();
  const imports = [...entry.matchAll(/@import\s+"([^"]+)"\s*;/g)]
    .map((match) => fileURLToPath(new URL(match[1], entryUrl)));
  expect(new Set(imports).size).toBe(imports.length);
  const files: string[] = [];
  for await (const path of new Bun.Glob("styles/**/*.css").scan({ cwd: fileURLToPath(new URL(".", entryUrl)), absolute: true })) files.push(path);
  expect([...imports].sort()).toEqual(files.sort());
  expect(entry.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@import\s+"[^"]+"\s*;/g, "").trim()).toBe("");
  for (const path of imports) {
    const source = await Bun.file(path).text();
    expect(source.includes("@import")).toBe(false);
    expect(() => css.parse(source, { onParseError: (error) => { throw error; } })).not.toThrow();
  }
});
