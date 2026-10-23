// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The checks' hooks, held to what the real apps answer
 * (docs/engineering/release-engineering.md#REL-129).
 *
 * A check that runs in the Mac and Windows apps may call only the hooks the
 * test build's fixture defines (fixture.mjs): one it lacks would be undefined
 * there, and the check would fail on the app's account. And every hook is
 * awaited where its answer is used: the in-memory vault answers at once, the
 * real one through IPC, so a hook read without `await` compares a promise in
 * the app (`__prosceniumHeld("write") > 0` is false forever there), and a gate
 * set without it may not be up before the key that should meet it.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { installFixture } from "./fixture.mjs";

const SOURCE = readFileSync(join(import.meta.dir, "../smoke-checks.mjs"), "utf8");

const { smokeChecks } = await import("../smoke-checks.mjs");

/** The hooks the fixture defines on a page with the app's IPC. */
function fixtureHooks(): Set<string> {
  const page: Record<string, unknown> = {
    __TAURI_INTERNALS__: { invoke: () => Promise.resolve() },
  };
  const was = globalThis.window;
  (globalThis as { window?: unknown }).window = page;
  try {
    installFixture();
  } finally {
    (globalThis as { window?: unknown }).window = was;
  }
  return new Set(Object.keys(page).filter((k) => k.startsWith("__proscenium")));
}

const HOOK_CALL = /window\.(__proscenium[A-Za-z]+)\s*\(/g;

/** Each hook call in `text`: its name, what comes before it and what follows its closing paren. */
function hookCalls(text: string) {
  const calls: { hook: string; before: string; after: string; at: number }[] = [];
  for (const m of text.matchAll(HOOK_CALL)) {
    let depth = 0;
    let end = m.index + m[0].length - 1;
    for (; end < text.length; end++) {
      if (text[end] === "(") depth++;
      else if (text[end] === ")" && --depth === 0) break;
    }
    calls.push({
      hook: m[1],
      before: text.slice(0, m.index).trimEnd(),
      after: text.slice(end + 1).trimStart(),
      at: m.index,
    });
  }
  return calls;
}

/**
 * Whether the call's answer is awaited or handed straight back: after `await`,
 * after `return`, a concise arrow or a branch of `?:`, and then not read on the
 * spot (`?? ""`, `.length`, `> 0`). `void` says it is let go on purpose.
 */
function awaited({ before, after }: { before: string; after: string }) {
  if (/\b(await|void)$/.test(before)) return true;
  const handedBack = /(\breturn|=>|[?:])$/.test(before);
  return handedBack && !/^(\?\?|\?\.|\.|\[|[<>=!+\-*/%&|])/.test(after);
}

/** The checks the apps run, every one, with its source as written. */
const inTheApps = () =>
  smokeChecks({ audit: async () => {}, hold: async () => {} }).map((check) => {
    const at = SOURCE.indexOf(`name: ${JSON.stringify(check.name)}`);
    const end = SOURCE.indexOf("\n      name: ", at + 1);
    return { check, source: SOURCE.slice(at, end < 0 ? undefined : end) };
  });

test("no check is the browser's alone", () => {
  // `devMock` once marked a check both real-app drivers skipped; none may be.
  expect(
    smokeChecks({ audit: async () => {}, hold: async () => {} })
      .filter((c) => "devMock" in c)
      .map((c) => c.name),
  ).toEqual([]);
});

test("a check that runs in the apps calls only hooks the test build answers", () => {
  const answered = fixtureHooks();
  const missing: string[] = [];
  for (const { check, source } of inTheApps()) {
    for (const { hook } of hookCalls(source))
      if (!answered.has(hook)) missing.push(`${check.name}: ${hook}`);
  }
  expect([...new Set(missing)]).toEqual([]);
});

test("a check that runs in the apps awaits every hook's answer", () => {
  const unawaited = inTheApps().flatMap(({ check, source }) =>
    hookCalls(source)
      .filter((call) => !awaited(call))
      .map((call) => `${check.name}: ${call.hook}`),
  );
  expect(unawaited).toEqual([]);
});

test("the rule tells an awaited hook from one read on the spot", () => {
  const judge = (text: string) => hookCalls(text).map(awaited);
  expect(judge(`await window.__prosceniumGate("write", rel);`)).toEqual([true]);
  expect(judge(`() => window.__prosceniumOpenGates("write")`)).toEqual([true]);
  expect(judge(`async (n) => (await window.__prosceniumHeld("write")) > n`)).toEqual([true]);
  expect(judge(`() => window.__prosceniumHeld("write") > 0`)).toEqual([false]);
  expect(judge(`(rel) => window.__prosceniumPeek(rel) ?? ""`)).toEqual([false]);
  expect(judge(`{ window.__prosceniumGate("write", rel); }`)).toEqual([false]);
  expect(judge(`{ void window.__prosceniumQuit(); }`)).toEqual([true]);
  expect(judge(`app ? await read(rel) : window.__prosceniumPeek(rel))`)).toEqual([true]);
  expect(judge(`window.__prosceniumVersionsWith("").some((v) => v.pinned)`)).toEqual([false]);
});
