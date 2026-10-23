// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The environment a test gives the git it starts, so that a repository the
 * test makes never tidies itself behind the test's back.
 *
 * THE FAULT
 * ---------
 * A commit, a fetch, a merge, a rebase and a received push each end by
 * starting `git maintenance run --auto --detach`, which carries on after the
 * command has returned. Since git 2.54 its default strategy is the geometric
 * one, and that repacks once the repository's `objects/17/` holds two loose
 * objects (git counts that one folder and multiplies by 256): it writes a
 * pack and then deletes every loose object. An object's folder is the start
 * of its hash, a commit's hash changes with the second it was made in, and a
 * scratch repository holds a few dozen objects, so now and then two land
 * there. Whatever reads the repository's object files by path in those few
 * milliseconds finds one gone. A local `git clone` straight after a push is
 * the common case: it links the origin's loose objects one by one, and dies
 * with "failed to copy file to '<clone>/.git/objects/…': No such file or
 * directory", naming the copy when the file that went was the origin's.
 *
 * THE FIX
 * -------
 * `maintenance.auto = false` in the repository's own configuration, from the
 * moment it exists: nothing starts maintenance there, whoever pushes to it
 * and whatever environment they push from. It has to be the repository's own.
 * A setting given by the environment (`GIT_CONFIG_COUNT`, `git -c`) is dropped
 * on the way to the `receive-pack` a local push starts in the origin, and the
 * machine's and the user's configuration are what several tests turn off.
 * git copies its template folder into every repository `git init` and `git
 * clone` make, a `config` file included, and `GIT_TEMPLATE_DIR` names the
 * folder: scripts/scratch-git-template holds that one file. The repositories
 * do without git's stock template (sample hooks, `info/exclude`,
 * `description`).
 *
 * `gc.auto = 0` would not do: it stops `git gc --auto`, and the geometric
 * repack does not ask it.
 *
 * THE RULE
 * --------
 * A test that starts git says `env: scratchGitEnv()`, or `scratchGitEnv(env)`
 * around an environment of its own, on every such call. Leaving `env` out is
 * not the same thing under bun: a child started without one gets the
 * environment bun itself started with, whatever the test has assigned to
 * `process.env` since. scripts/scratch-git.test.ts holds the test files to
 * it, and proves that a repository made this way starts no maintenance.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The folder git copies into each repository made under `scratchGitEnv()`. */
export const SCRATCH_GIT_TEMPLATE = join(
  dirname(fileURLToPath(import.meta.url)),
  "scratch-git-template",
);

/**
 * `env` (this process's, unless one is given) with git's template folder set
 * to the scratch one. Pure: a new object each time.
 */
export function scratchGitEnv(env = process.env) {
  return { ...env, GIT_TEMPLATE_DIR: SCRATCH_GIT_TEMPLATE };
}
