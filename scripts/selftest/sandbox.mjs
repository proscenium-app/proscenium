// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The driver's half of the sandboxed self-test (scripts/selftest.mjs,
 * src-tauri/src/selftest_sandbox.rs, docs/engineering/release-engineering.md#REL-56).
 *
 * A sandboxed app reaches its container and what the system grants it: the
 * folder panel the folder picked, the Save panel the one file it names,
 * Finder the file it opens. The self-test drives none of those panels, so
 * this driver, which is not sandboxed, stands in for them: the app asks for
 * the grant a panel would give (a sandbox extension, the system's own kind,
 * for that path and nothing wider), and this issues it with
 * scripts/selftest/grant.c. It also does what the checks stage as the world
 * around the app, which the app may not: it lays each launch's Plays folder
 * out where a writer's would be, outside the container, makes a file another
 * program would make, and takes a picture of the window (`screencapture` run
 * by the app would inherit its sandbox).
 *
 * After the run it judges the sandbox itself:
 *   - it was on: the container the app names is its own, and a write nothing
 *     granted was refused;
 *   - the app's data resolved inside the container
 *     (docs/app/keeping-work/storage-and-file-format.md#STOR-142), and with
 *     no iCloud there is no iCloud container to offer
 *     (docs/app/keeping-work/storage-and-file-format.md#STOR-131);
 *   - an export wrote only the file the Save panel named: nothing else is in
 *     the exports folder (docs/app/keeping-work/storage-and-file-format.md#STOR-187).
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

/** Whether the app at `app` is signed into the App Sandbox. */
export function isSandboxed(app) {
  try {
    return execFileSync("codesign", ["-d", "--entitlements", "-", "--xml", app], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).includes("com.apple.security.app-sandbox");
  } catch {
    return false;
  }
}

const inside = (dir, path) => {
  const rel = relative(dir, resolve(path));
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"));
};

/**
 * Ready the driver for one sandboxed app: its grant tool built, a world
 * folder outside its container, and the grants it launches with.
 *
 * `out` is the run's evidence folder; `root` the checkout, whose expected
 * accessibility trees the app reads. Returns the environment to launch with,
 * `answer(line)` for each of the app's asks, and `judge(report)`.
 */
export function sandboxDriver({ bundleId, out, root, say = console.log }) {
  const evidence = realpathSync(out);
  // The driver's own temporary folder, named as the unsandboxed self-test
  // names its world, so every path a check or a tree reads is spelled the
  // same in both (scripts/aria-snapshots.mjs). Outside the container: the
  // sandbox gives the app a temporary folder of its own there, and the run
  // fails unless a write here was refused.
  const work = join(realpathSync(tmpdir()), `proscenium-selftest-${process.pid}`);
  rmSync(work, { recursive: true, force: true });
  const world = work;
  mkdirSync(join(world, "exports"), { recursive: true });
  // The grant tool, apart from the world.
  const tools = realpathSync(mkdtempSync(join(tmpdir(), "proscenium-grant-")));
  const tool = join(tools, "grant");
  execFileSync("cc", ["-o", tool, join(root, "scripts/selftest/grant.c")], { stdio: "inherit" });
  const container = join(homedir(), "Library/Containers", bundleId, "Data");
  const grants = [];

  const issue = (mode, path) =>
    execFileSync(tool, [mode, path], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

  const verbs = {
    grant({ path, write, why }) {
      if (!inside(world, path))
        throw new Error(`${why} grants only inside the run's world, not ${path}`);
      grants.push({ path, write, why });
      say(`grant (${why}, ${write ? "read-write" : "read"}): ${relative(world, path)}`);
      return issue(write ? "read-write" : "read", path);
    },
    copy({ from, to }) {
      if (!inside(container, from) || !inside(world, to))
        throw new Error(`copies from the container into the world only, not ${from} → ${to}`);
      cpSync(from, to, { recursive: true });
      return null;
    },
    write({ path, base64 }) {
      if (!inside(world, path)) throw new Error(`writes inside the world only, not ${path}`);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, Buffer.from(base64, "base64"));
      return null;
    },
    capture({ window, path }) {
      if (!inside(evidence, path)) throw new Error(`captures into the evidence only, not ${path}`);
      try {
        execFileSync("/usr/sbin/screencapture", ["-x", "-o", "-l", String(window), path], {
          stdio: "ignore",
        });
      } catch {
        // As the app's own capture: without Screen Recording it draws only the desktop.
      }
      return null;
    },
  };

  return {
    world,
    env: {
      PROSCENIUM_SELFTEST_WORLD: world,
      PROSCENIUM_SELFTEST_GRANTS: JSON.stringify([
        issue("read-write", evidence),
        issue("read", join(root, "scripts/aria/native")),
      ]),
    },
    /** One of the app's asks, answered on its stdin. */
    answer(line, stdin) {
      let id = null;
      let reply;
      try {
        const ask = JSON.parse(line);
        id = ask.id;
        const verb = verbs[ask.verb];
        if (!verb) throw new Error(`no such ask: ${ask.verb}`);
        reply = { id, value: verb(ask) };
      } catch (e) {
        say(`ask refused: ${e.message}`);
        reply = { id, error: e.message };
      }
      stdin.write(`${JSON.stringify(reply)}\n`);
    },
    /** What the run's report says of the sandbox, as problems, for the acts it ran. */
    judge(report, acts) {
      return judgeSandbox({
        report,
        bundleId,
        container,
        grants,
        acts,
        exports: join(world, "exports"),
        names: readdirSync(join(world, "exports")),
      });
    },
    /** The grants given, by kind, for the summary. */
    grants,
    /** Keep the exports with the evidence, and remove the rest. */
    finish() {
      const exports = join(world, "exports");
      if (existsSync(exports) && readdirSync(exports).length)
        cpSync(exports, join(evidence, "exports"), { recursive: true });
      rmSync(work, { recursive: true, force: true });
      rmSync(tools, { recursive: true, force: true });
    },
  };
}

/**
 * The sandbox's verdict on one run, from its report and what the driver saw:
 * `grants` asked for, the acts run, and `names` in the `exports` folder.
 */
export function judgeSandbox({ report, bundleId, container, grants, acts, exports, names }) {
  const problems = [];
  const s = report?.sandbox;
  if (!s?.sandboxed) return ["the app did not run in the App Sandbox"];
  if (s.container !== bundleId)
    problems.push(`the sandbox's container is ${s.container}, not ${bundleId}`);
  if (s.containerHome !== container)
    problems.push(`the sandbox's home is ${s.containerHome}, not ${container}`);
  if (!/not permitted/i.test(s.refusedOutside ?? ""))
    problems.push(
      `a write nothing granted was not refused (${s.refusedOutside}): the sandbox is not holding the app`,
    );
  if (!s.appData || !inside(container, s.appData))
    problems.push(`the app's data resolved at ${s.appData}, outside its container`);
  if (s.cloudRoot !== null)
    problems.push(`an iCloud container (${s.cloudRoot}) without the iCloud entitlement`);
  // What each act stands on was asked for: a run that never went through a
  // panel's grant proves nothing about it.
  const asked = (why) => grants.some((g) => g.why === why);
  if (!asked("the folder panel")) problems.push("no folder was granted by the folder panel");
  if (acts.includes("export") && !asked("the Save panel"))
    problems.push("the export act ran, and no file was granted by the Save panel");
  if (acts.includes("from Finder") && !asked("Finder"))
    problems.push("the Finder act ran, and Finder granted no file");
  // Only the files the Save panel named: anything else is a temporary copy,
  // or a sibling, that a store build could not have made.
  const named = new Set(
    grants.filter((g) => g.why === "the Save panel").map((g) => resolve(g.path)),
  );
  for (const name of names)
    if (!named.has(resolve(exports, name)))
      problems.push(`exports: ${name} is beside the exports, and no Save panel named it`);
  return problems;
}
