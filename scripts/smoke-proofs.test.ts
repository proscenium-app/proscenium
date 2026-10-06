// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
        const r = spawnSync("git", args, { cwd: top, encoding: "utf8" });
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
