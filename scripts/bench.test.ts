// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The bench lives under the home directory, read when the process starts: each
// case runs in its own process with a throwaway home, never the host's, whose
// lock on the build host is CI's.
const home = mkdtempSync(join(tmpdir(), "bench-test-"));
afterAll(() => rmSync(home, { recursive: true, force: true }));
const BENCH = JSON.stringify(join(import.meta.dir, "selftest/bench.mjs"));

/** Run `body` with `b` (bench.mjs) and `lock` in scope; its last console.log line, parsed. */
function inHome(body: string, env: Record<string, string> = {}) {
  const script = `
    const { existsSync, readFileSync } = await import("node:fs");
    const b = await import(${BENCH});
    b.benchSays(() => {});
    if (!b.LOCK.startsWith(${JSON.stringify(home)})) throw new Error("the bench resolved to " + b.LOCK);
    const lock = (f) => existsSync(b.LOCK + "/" + f) ? readFileSync(b.LOCK + "/" + f, "utf8").trim() : null;
    ${body}
  `;
  const { PROSCENIUM_BENCH: _, ...rest } = process.env;
  const r = spawnSync(process.execPath, ["-e", script], { env: { ...rest, HOME: home, ...env }, encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr || `exit ${r.status}`);
  return JSON.parse(r.stdout.trim().split("\n").at(-1)!);
}

describe("the bench", () => {
  test("a heavy run holds it, says what it is, hands it to what it starts, and leaves it at exit", () => {
    const seen = inHome(`
      await b.holdBench("smoke");
      const held = { pid: lock("pid"), what: lock("what"), env: process.env.PROSCENIUM_BENCH, me: String(process.pid) };
      // A child of the holder, as an app build under selftest-mini, holds nothing more and waits for nothing.
      const { spawnSync } = await import("node:child_process");
      const child = spawnSync(process.execPath, ["-e", \`
        const b = await import(${BENCH.replace(/"/g, '\\"')});
        const t = Date.now(); await b.holdBench("an app build"); console.log(Date.now() - t);
      \`], { env: process.env, encoding: "utf8" });
      console.log(JSON.stringify({ ...held, child: Number(child.stdout.trim()), childStatus: child.status, whatAfter: lock("what") }));
    `);
    expect(seen.pid).toBe(seen.me);
    expect(seen.what).toBe("smoke");
    expect(seen.env).toBe(seen.me);
    expect(seen.childStatus).toBe(0);
    expect(seen.child).toBeLessThan(5000);
    expect(seen.whatAfter).toBe("smoke");
    // The holder has exited: its exit left the bench.
    expect(inHome(`console.log(JSON.stringify(lock("pid")))`)).toBeNull();
  });

  test("a bench left by a process that is gone is taken", () => {
    const gone = spawnSync(process.execPath, ["-e", "console.log(process.pid)"], { encoding: "utf8" }).stdout.trim();
    const seen = inHome(`
      const { mkdirSync, writeFileSync } = await import("node:fs");
      mkdirSync(b.LOCK, { recursive: true });
      writeFileSync(b.LOCK + "/pid", "${gone}\\n");
      writeFileSync(b.LOCK + "/what", "smoke\\n");
      await b.takeBench();
      console.log(JSON.stringify({ pid: lock("pid"), what: lock("what"), me: String(process.pid) }));
      b.leaveBench();
    `);
    expect(seen.pid).toBe(seen.me);
    expect(seen.what).toBe("a self-test");
  });

  test("smoke and app builds hold it only where the host names it", () => {
    const hook = JSON.stringify(join(import.meta.dir, "host-bench.mjs"));
    const named = inHome(`
      const { holdHostBench } = await import(${hook});
      await holdHostBench("smoke");
      console.log(JSON.stringify({ pid: lock("pid"), what: lock("what"), me: String(process.pid) }));
    `, { PROSCENIUM_BENCH_MODULE: "scripts/selftest/bench.mjs" });
    expect(named.pid).toBe(named.me);
    expect(named.what).toBe("smoke");
    const unnamed = inHome(`
      const { holdHostBench } = await import(${hook});
      await holdHostBench("smoke");
      console.log(JSON.stringify(lock("pid")));
    `, { PROSCENIUM_BENCH_MODULE: "" });
    expect(unnamed).toBeNull();
  });

  test("an inherited claim from a holder that is gone is not trusted", () => {
    const gone = spawnSync(process.execPath, ["-e", "console.log(process.pid)"], { encoding: "utf8" }).stdout.trim();
    const seen = inHome(`
      await b.holdBench("smoke");
      console.log(JSON.stringify({ pid: lock("pid"), me: String(process.pid) }));
    `, { PROSCENIUM_BENCH: gone });
    expect(seen.pid).toBe(seen.me);
  });
});
