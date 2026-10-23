// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCRATCH_GIT_TEMPLATE, scratchGitEnv } from "./scratch-git.mjs";

/**
 * A repository a test makes starts no maintenance of its own, and every test
 * that makes one starts its git under `scratchGitEnv()`: scripts/scratch-git.mjs
 * says what goes wrong otherwise.
 */
const SCRIPTS = import.meta.dir;
const ME = "scratch-git.test.ts";

/** How a test starts git itself, by name: the calls the rule can see. */
const STARTS_GIT =
  /\b(?:spawnSync|execFileSync|spawn|execFile)\(\s*["'`]git["'`]|\bBun\.spawn(?:Sync)?\(\s*\[\s*["'`]git["'`]/g;
/** `git init` or `git clone`, as an argument or in a line of shell. */
const MAKES_A_REPOSITORY = /["'`](?:init|clone)["'`]|\bgit (?:init|clone)\b/;

/** The call that opens at `text[open]`, through its closing parenthesis. */
function callAt(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      // A string is skipped whole, so a parenthesis inside one is not counted.
      for (i++; i < text.length && text[i] !== c; i++) if (text[i] === "\\") i++;
    } else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return text.slice(open, i + 1);
  }
  return text.slice(open);
}

/**
 * What is wrong with a file's own git calls, as lines to print. A file that
 * makes no repository is not held to anything: reading the checkout the tests
 * run in (`git ls-files`) writes nothing and starts no maintenance.
 */
function problemsIn(text: string, file: string): string[] {
  if (!MAKES_A_REPOSITORY.test(text)) return [];
  const calls = [...text.matchAll(STARTS_GIT)];
  if (!calls.length) return [];
  const problems: string[] = [];
  for (const m of calls) {
    const call = callAt(text, m.index + m[0].indexOf("("));
    if (/\benv\b/.test(call)) continue;
    const line = text.slice(0, m.index).split("\n").length;
    problems.push(
      `${file}:${line}: git is started with no env, so it gets the environment bun started with: say env: scratchGitEnv()`,
    );
  }
  if (!text.includes("scratchGitEnv("))
    problems.push(
      `${file}: makes a repository and never calls scratchGitEnv() (scripts/scratch-git.mjs)`,
    );
  return problems;
}

describe("a repository made under scratchGitEnv()", () => {
  // As the machine is configured, and with no one's configuration, which is
  // how several tests run their git: the template does not go through either.
  const environments: [string, Record<string, string>][] = [
    ["the machine's configuration", {}],
    ["no one's configuration", { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" }],
  ];
  test.each(environments)("starts no maintenance, with %s", (_name, extra) => {
    const top = mkdtempSync(join(tmpdir(), "scratch-git-"));
    try {
      const trace = join(top, "trace");
      const env = scratchGitEnv({
        ...process.env,
        ...extra,
        GIT_TRACE: trace,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@example.com",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@example.com",
      });
      const git = (cwd: string, ...args: string[]) => {
        const r = spawnSync("git", args, { cwd, env, encoding: "utf8" });
        if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
        return r.stdout.trim();
      };
      const origin = join(top, "origin.git");
      const repo = join(top, "repo");
      git(top, "init", "-q", "--bare", "-b", "main", origin);
      git(top, "clone", "-q", origin, repo);
      writeFileSync(join(repo, "a.txt"), "a\n");
      git(repo, "add", "-A");
      git(repo, "commit", "-qm", "one");
      git(repo, "push", "-q", "origin", "HEAD:main");
      git(repo, "fetch", "-q", "origin");

      // The trace heard the origin's side of the push, so it would have heard
      // maintenance start there too: receive-pack writes that line before the
      // push returns. It heard none, from the commit, the push or the fetch.
      const said = readFileSync(trace, "utf8");
      expect(said).toMatch(/built-in: git receive-pack/);
      expect(said).toMatch(/built-in: git commit/);
      const tidying = said.split("\n").filter((l) => /\bgit[- ](maintenance|gc|repack)\b/.test(l));
      expect(tidying).toEqual([]);
      // And why: the setting is each repository's own, which is what reaches
      // the receive-pack a push starts in the origin.
      for (const dir of [origin, repo])
        expect(git(dir, "config", "--local", "--get", "maintenance.auto")).toBe("false");
    } finally {
      rmSync(top, { recursive: true, force: true });
    }
  });

  test("the template is one file, the settings", () => {
    expect(readdirSync(SCRATCH_GIT_TEMPLATE)).toEqual(["config"]);
    expect(scratchGitEnv({ A: "b" })).toEqual({ A: "b", GIT_TEMPLATE_DIR: SCRATCH_GIT_TEMPLATE });
  });
});

describe("every test that makes a repository starts its git under scratchGitEnv()", () => {
  test("the scripts' own TypeScript, tests and the scenes they share", () => {
    const files = [...new Bun.Glob("**/*.ts").scanSync({ cwd: SCRIPTS })]
      .filter((f) => f !== ME)
      .sort();
    expect(files.length).toBeGreaterThan(10);
    const problems = files.flatMap((f) =>
      problemsIn(readFileSync(join(SCRIPTS, f), "utf8"), `scripts/${f}`),
    );
    expect(problems).toEqual([]);
  });

  // The rule, broken on purpose. This file is left out of the scan above for
  // these lines' sake.
  test("a call with no env is named by its line, and a file that never takes the environment is named", () => {
    const bare = [
      'import { spawnSync } from "node:child_process";',
      'spawnSync("git", ["init", "-q", dir]);',
      "const sh = (cwd, ...args) =>",
      "  spawnSync(",
      '    "git",',
      "    args,",
      '    { cwd, encoding: "utf8" },',
      "  );",
    ].join("\n");
    expect(problemsIn(bare, "x.test.ts")).toEqual([
      expect.stringContaining("x.test.ts:2: git is started with no env"),
      expect.stringContaining("x.test.ts:4: git is started with no env"),
      expect.stringContaining("x.test.ts: makes a repository and never calls scratchGitEnv()"),
    ]);
    // An environment of the test's own, never wrapped.
    const unwrapped = 'execFileSync("git", ["clone", "-q", a, b], { env: { PATH } });';
    expect(problemsIn(unwrapped, "y.test.ts")).toEqual([
      expect.stringContaining("y.test.ts: makes a repository and never calls scratchGitEnv()"),
    ]);
    expect(problemsIn('Bun.spawnSync(["git", "init", dir]);', "z.test.ts")).toHaveLength(2);
  });

  test("a call that says it is passed, and a file that makes no repository is not held", () => {
    const good = [
      "const env = scratchGitEnv({ ...process.env, GIT_CONFIG_GLOBAL: devNull });",
      'spawnSync("git", ["init", "-q", "--bare", origin], { env: scratchGitEnv() });',
      'const git = (cwd, ...args) => spawnSync("git", args, { cwd, env, encoding: "utf8" });',
      'git(top, "clone", "-q", origin, join(top, "a (copy)"));',
    ].join("\n");
    expect(problemsIn(good, "x.test.ts")).toEqual([]);
    const reads = 'execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" });';
    expect(problemsIn(reads, "y.test.ts")).toEqual([]);
  });
});
