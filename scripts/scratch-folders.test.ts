// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A test removes the scratch folders it makes.
 *
 * THE FAULT
 * ---------
 * `mkdtempSync(join(tmpdir(), "x-"))` makes a folder in the machine's temp
 * folder, and nothing but the test will ever remove it: the system empties old
 * files out of the temp folder after a few days and leaves the folders where
 * they are. A test that makes one and walks away adds an entry on every run of
 * the gates and every run of the pipeline, for as long as the machine is up.
 *
 * THE RULE
 * --------
 * A test file, or a scene that tests share, makes a folder in the temp folder
 * under a name, and removes it by that name, in `afterAll` or in a `finally`:
 *
 *   const top = mkdtempSync(join(tmpdir(), "x-"));
 *   afterAll(() => rmSync(top, { recursive: true, force: true }));
 *
 * Every other scratch folder it makes is inside one of those, and goes with
 * it: `mkdtempSync(join(top, "y-"))`.
 *
 * This reads the files, so it holds a test to saying its removal, not to
 * reaching it. What a run in fact leaves is counted by giving the run an empty
 * folder as its temp folder, which is empty again when the run is over:
 *
 *   TMPDIR=<the folder> bun test ./scripts
 */
const ROOT = join(import.meta.dir, "..");
const ME = "scripts/scratch-folders.test.ts";

/** `mkdtemp` or `mkdtempSync`, the name it is bound to, and the folder it is given to make it in. */
const MAKES =
  /(?:\bconst\s+(\w+)\s*=\s*(?:await\s+)?)?\bmkdtemp(?:Sync)?\(\s*(?:join\(\s*(tmpdir\(\)|[\w.]+)\s*,)?/g;

/** How often a file removes `name`, whole: `rmSync(name, { recursive: true … })`, or `x.name`. */
function removals(text: string, name: string): number {
  const removes = new RegExp(
    `\\brm(?:Sync)?\\(\\s*(?:\\w+\\.)*${name}\\s*,\\s*\\{[^}]*\\brecursive: true`,
    "g",
  );
  return [...text.matchAll(removes)].length;
}

/** What is wrong with the scratch folders a file makes, as lines to print. */
function problemsIn(text: string, file: string): string[] {
  const problems: string[] = [];
  const calls = [...text.matchAll(MAKES)].map((m) => ({
    name: m[1] ?? null,
    where: m[2] ?? null,
    line: text.slice(0, m.index + m[0].indexOf("mkdtemp")).split("\n").length,
  }));
  /** The folders made in the temp folder, by name: how many of each. */
  const tops = new Map<string, number>();
  for (const c of calls)
    if (c.where === "tmpdir()" && c.name) tops.set(c.name, (tops.get(c.name) ?? 0) + 1);
  for (const c of calls) {
    if (c.where === null)
      problems.push(
        `${file}:${c.line}: where this scratch folder goes cannot be told: say mkdtempSync(join(tmpdir(), "…")) or mkdtempSync(join(top, "…"))`,
      );
    else if (c.where === "tmpdir()" && !c.name)
      problems.push(
        `${file}:${c.line}: a folder made in the temp folder has no name to remove it by: const top = mkdtempSync(join(tmpdir(), "…")), and rmSync(top, { recursive: true, force: true }) in afterAll or a finally`,
      );
    else if (c.where !== "tmpdir()" && !tops.has(c.where))
      problems.push(
        `${file}:${c.line}: a scratch folder is made in ${c.where}, which is not a folder this file makes in the temp folder and removes`,
      );
  }
  for (const [name, made] of tops) {
    const removed = removals(text, name);
    if (removed < made)
      problems.push(
        `${file}: makes ${made} folder(s) in the temp folder as ${name} and removes ${removed}: rmSync(${name}, { recursive: true, force: true }) in afterAll or a finally`,
      );
  }
  return problems;
}

describe("every test removes the scratch folders it makes", () => {
  // All of the scripts' TypeScript, since a scene several tests share is not a
  // test file and makes their folders for them.
  test("the scripts' own TypeScript, tests and the scenes they share, and the app's tests", () => {
    const files = [
      ["scripts", "**/*.ts"],
      ["src", "**/*.test.{ts,tsx}"],
    ]
      .flatMap(([top, glob]) =>
        [...new Bun.Glob(glob).scanSync({ cwd: join(ROOT, top) })].map((f) => `${top}/${f}`),
      )
      .filter((f) => f !== ME)
      .sort();
    expect(files.length).toBeGreaterThan(100);
    const made = files.filter((f) => /\bmkdtemp/.test(readFileSync(join(ROOT, f), "utf8")));
    // The rule has something to hold: a scan that found no file making a folder read nothing.
    expect(made.length).toBeGreaterThan(2);
    const problems = made.flatMap((f) => problemsIn(readFileSync(join(ROOT, f), "utf8"), f));
    expect(problems).toEqual([]);
  });

  // The rule, broken on purpose. This file is left out of the scan above for
  // these lines' sake.
  test("a folder never removed, one with no name, and one made somewhere else are each named", () => {
    const left = [
      "function scratch() {",
      '  const dir = mkdtempSync(join(tmpdir(), "land-"));',
      "  return dir;",
      "}",
    ].join("\n");
    expect(problemsIn(left, "x.test.ts")).toEqual([
      expect.stringContaining(
        "x.test.ts: makes 1 folder(s) in the temp folder as dir and removes 0",
      ),
    ]);
    // Two made under one name and one removal: the other is left.
    const twice = [
      'const a = () => { const top = mkdtempSync(join(tmpdir(), "a-")); };',
      "const b = () => {",
      '  const top = mkdtempSync(join(tmpdir(), "b-"));',
      "  try {} finally { rmSync(top, { recursive: true, force: true }); }",
      "};",
    ].join("\n");
    expect(problemsIn(twice, "x.test.ts")).toEqual([
      expect.stringContaining("makes 2 folder(s) in the temp folder as top and removes 1"),
    ]);
    const unnamed = [
      "const ENV = {",
      '  PROSCENIUM_SPOOL_DIR: mkdtempSync(join(tmpdir(), "spool-")),',
      "};",
      'const file = join(mkdtempSync(join(tmpdir(), "roll-")), "roll.json");',
    ].join("\n");
    expect(problemsIn(unnamed, "y.test.ts")).toEqual([
      expect.stringContaining("y.test.ts:2: a folder made in the temp folder has no name"),
      expect.stringContaining("y.test.ts:4: a folder made in the temp folder has no name"),
    ]);
    // A removal that is not the whole folder is not one.
    const emptied = [
      'const top = mkdtempSync(join(tmpdir(), "x-"));',
      "afterAll(() => rmSync(top, { force: true }));",
    ].join("\n");
    expect(problemsIn(emptied, "z.test.ts")).toHaveLength(1);
    // The temp folder by another name, a folder of the scene's, and no folder said at all.
    const elsewhere = [
      "const base = tmpdir();",
      'const one = mkdtempSync(join(base, "one-"));',
      'const two = mkdtempSync(join(scene.dir, "two-"));',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a line of a test file, as text
      "const three = await mkdtemp(`${tmpdir()}/three-`);",
    ].join("\n");
    expect(problemsIn(elsewhere, "w.test.ts")).toEqual([
      expect.stringContaining("w.test.ts:2: a scratch folder is made in base, which is not"),
      expect.stringContaining("w.test.ts:3: a scratch folder is made in scene.dir, which is not"),
      expect.stringContaining("w.test.ts:4: where this scratch folder goes cannot be told"),
    ]);
  });

  test("a folder removed by its name is passed, in each way the tests say it", () => {
    const whole = [
      'const TOP = mkdtempSync(join(tmpdir(), "x-"));',
      "afterAll(() => rmSync(TOP, { recursive: true, force: true }));",
      'const repo = () => mkdtempSync(join(TOP, "repo-"));',
      'const where = dirs({ root: mkdtempSync(join(TOP, "root-")) });',
    ].join("\n");
    expect(problemsIn(whole, "x.test.ts")).toEqual([]);
    const each = [
      "function scene() {",
      '  const top = mkdtempSync(join(tmpdir(), "scene-"));',
      "  return { top, done: () => rmSync(top, { recursive: true, force: true }) };",
      "}",
      'test("one", () => {',
      '  const real = mkdtempSync(join(tmpdir(), "export-"));',
      '  const standIn = mkdtempSync(join(tmpdir(), "export-"));',
      "  try {",
      "  } finally {",
      "    rmSync(real, { recursive: true, force: true });",
      "    rmSync(standIn, { recursive: true, force: true });",
      "  }",
      "});",
    ].join("\n");
    expect(problemsIn(each, "y.test.ts")).toEqual([]);
    // A scene hands its folder back, and the test removes it from there.
    const kept = [
      "function fixture() {",
      '  const top = mkdtempSync(join(tmpdir(), "draft-"));',
      "  return { top };",
      "}",
      "const f = fixture();",
      "try {} finally { rmSync(f.top, { recursive: true, force: true }); }",
    ].join("\n");
    expect(problemsIn(kept, "z.test.ts")).toEqual([]);
    // A file that makes no folder is not held to anything.
    expect(problemsIn('const p = join(tmpdir(), "never-made");', "v.test.ts")).toEqual([]);
  });
});
