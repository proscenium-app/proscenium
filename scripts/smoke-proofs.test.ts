// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scratchGitEnv } from "./scratch-git.mjs";
import { ACTS, ENGINES, actRunsIn, proofEngines } from "./smoke-checks.mjs";
import {
  PROOF_RUNS,
  checkHash,
  proveCommand,
  textHash,
  unproven,
  unprovenInBatch,
} from "./smoke-proofs.mjs";

const check = (name: string, body: string) => ({
  name,
  // biome-ignore lint/security/noGlobalEval: a check's source is what is hashed
  run: eval(`(async function run(page) { ${body} })`),
});
const proof = (c: { name: string; run: () => unknown }, snapshots = {}, runs = PROOF_RUNS) => ({
  hash: checkHash(c),
  snapshots,
  runs: { chromium: runs, webkit: runs },
});

describe("a check is proven in the engines its act runs in", () => {
  const pc = check("pc", "await page.host.hold('x');");
  const onPC = (name: string) => (name === "pc" ? ["webview2"] : undefined);

  test("a check whose act runs only in the real Windows app is proven there, and smoke's two engines are not asked", () => {
    const there = { hash: checkHash(pc), snapshots: {}, runs: { webview2: PROOF_RUNS } };
    expect(
      unproven({
        base: [],
        head: [pc],
        snapshots: {},
        proofs: { checks: { pc: there } },
        enginesOf: onPC,
      }),
    ).toEqual([]);
    // Without its engines named, the same entry is no proof: smoke's two never ran it.
    expect(
      unproven({ base: [], head: [pc], snapshots: {}, proofs: { checks: { pc: there } } }),
    ).toEqual([{ kind: "check", name: "pc" }]);
    // A proof in smoke's engines is none for a check that runs only on a PC.
    expect(
      unproven({
        base: [],
        head: [pc],
        snapshots: {},
        proofs: { checks: { pc: proof(pc) } },
        enginesOf: onPC,
      }),
    ).toEqual([{ kind: "check", name: "pc" }]);
  });

  test("every act that names its engines names real ones, and says why the others cannot run it", () => {
    for (const act of ACTS) {
      expect(proofEngines(act).length).toBeGreaterThan(0);
      if (!act.engines) continue;
      expect(act.engines.length).toBeGreaterThan(0);
      for (const e of act.engines) expect(ENGINES).toContain(e);
      expect(act.elsewhere).toBeTruthy();
      for (const e of ENGINES) expect(actRunsIn(act, e)).toBe(act.engines.includes(e));
    }
    // The acts that stage a PC's files run in the real Windows app alone.
    const held = ACTS.find((a) => a.name === "files another program holds");
    expect(held?.engines).toEqual(["webview2"]);
    expect(proofEngines(held)).toEqual(["webview2"]);
    expect(proofEngines(ACTS[0])).toEqual(["chromium", "webkit"]);
  });
});

describe("a new or changed check is proven before it lands", () => {
  const a = check("a", "await page.click('x');");
  const a2 = check("a", "await page.click('y');");
  const b = check("b", "await page.click('z');");

  test("an unchanged check needs nothing; a changed or new one needs a whole proof of its text", () => {
    expect(unproven({ base: [a, b], head: [a, b], snapshots: {}, proofs: null })).toEqual([]);
    expect(unproven({ base: [a, b], head: [a2, b], snapshots: {}, proofs: null })).toEqual([
      { kind: "check", name: "a" },
    ]);
    const c = check("c", "await page.click('w');");
    expect(unproven({ base: [a], head: [a, c], snapshots: {}, proofs: null })).toEqual([
      { kind: "check", name: "c" },
    ]);
    // Proven at its current text: nothing asked.
    const proofs = { v: 1, checks: { a: proof(a2) } };
    expect(unproven({ base: [a, b], head: [a2, b], snapshots: {}, proofs })).toEqual([]);
    // A proof of the old text, or a short one, is no proof.
    expect(
      unproven({ base: [a, b], head: [a2, b], snapshots: {}, proofs: { checks: { a: proof(a) } } }),
    ).toHaveLength(1);
    expect(
      unproven({
        base: [a, b],
        head: [a2, b],
        snapshots: {},
        proofs: { checks: { a: proof(a2, {}, PROOF_RUNS - 1) } },
      }),
    ).toHaveLength(1);
  });

  test("a changed snapshot needs a proof that held its new text, and names the check that last held it", () => {
    const proofs = { v: 1, checks: { b: proof(b, { "undo-toast": textHash("old") }) } };
    expect(
      unproven({ base: [a, b], head: [a, b], snapshots: { "undo-toast": "new" }, proofs }),
    ).toEqual([{ kind: "snapshot", name: "undo-toast", check: "b" }]);
    const now = { v: 1, checks: { b: proof(b, { "undo-toast": textHash("new") }) } };
    expect(
      unproven({ base: [a, b], head: [a, b], snapshots: { "undo-toast": "new" }, proofs: now }),
    ).toEqual([]);
    expect(
      proveCommand([
        { kind: "check", name: "a" },
        { kind: "snapshot", name: "undo-toast", check: "b" },
        { kind: "snapshot", name: "loose", check: null },
      ]),
    ).toBe('node scripts/smoke.mjs --prove "a" "b", and --prove the checks that audit loose');
  });

  test("in a repository: nothing is asked until main holds the proofs file, then a changed check is", async () => {
    const top = mkdtempSync(join(tmpdir(), "proofs-"));
    try {
      const git = (args: string[]) => {
        const r = spawnSync("git", args, { cwd: top, env: scratchGitEnv(), encoding: "utf8" });
        return {
          ok: r.status === 0,
          out: (r.stdout ?? "").replace(/\n$/, ""),
          err: r.stderr ?? "",
        };
      };
      mkdirSync(join(top, "scripts", "aria"), { recursive: true });
      // The checks import a package through pages-sample.mjs, as the real ones
      // do (fflate): main's copy of them must resolve it from the checkout.
      mkdirSync(join(top, "node_modules", "zip-stand-in"), { recursive: true });
      writeFileSync(
        join(top, "node_modules", "zip-stand-in", "package.json"),
        '{ "name": "zip-stand-in", "type": "module", "exports": "./index.mjs" }\n',
      );
      writeFileSync(
        join(top, "node_modules", "zip-stand-in", "index.mjs"),
        "export const zip = () => 1;\n",
      );
      writeFileSync(join(top, ".gitignore"), "node_modules/\n");
      writeFileSync(
        join(top, "scripts", "pages-sample.mjs"),
        'import { zip } from "zip-stand-in";\nexport const sample = zip;\n',
      );
      const checks = (body: string) =>
        `import { sample } from "./pages-sample.mjs";\nexport function smokeChecks() { return [{ name: "one", async run(page) { sample(); ${body} } }]; }\n`;
      writeFileSync(join(top, "scripts", "smoke-checks.mjs"), checks("await page.a();"));
      writeFileSync(join(top, "scripts", "aria", "one.yml"), "- button\n");
      git(["init", "-q", "-b", "main"]);
      git(["-c", "user.email=t@example.com", "-c", "user.name=t", "add", "-A"]);
      git(["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "base"]);
      const base = git(["rev-parse", "HEAD"]).out;
      writeFileSync(join(top, "scripts", "smoke-checks.mjs"), checks("await page.b();"));
      git(["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qam", "change"]);
      // main has no proofs file yet: the rule starts with the commit that brings it.
      expect(await unprovenInBatch({ git, top, upstream: base })).toEqual([]);
      git(["checkout", "-q", base]);
      writeFileSync(join(top, "scripts", "smoke-proofs.json"), '{ "v": 1, "checks": {} }\n');
      git(["-c", "user.email=t@example.com", "-c", "user.name=t", "add", "-A"]);
      git(["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "the rule"]);
      const ruled = git(["rev-parse", "HEAD"]).out;
      writeFileSync(join(top, "scripts", "smoke-checks.mjs"), checks("await page.c();"));
      writeFileSync(join(top, "scripts", "aria", "one.yml"), '- button "Save"\n');
      git(["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qam", "change"]);
      expect(await unprovenInBatch({ git, top, upstream: ruled })).toEqual([
        { kind: "check", name: "one" },
        { kind: "snapshot", name: "one", check: null },
      ]);
    } finally {
      rmSync(top, { recursive: true, force: true });
    }
  });
});
