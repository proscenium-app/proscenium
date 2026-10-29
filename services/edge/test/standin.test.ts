// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from "bun:test";
import { parseEnvelope } from "../src/crashes";
import { window } from "../src/evidence";
import { received } from "./sentry-standin";
import { CRASH_HEADERS, crashEnvelope } from "./standin-crash";
import { crashesIn, standInEvidence } from "./standin-evidence";
import { listening, standInConfig } from "./standin";

const now = new Date("2026-10-02T15:30:00Z");
const V = "1.0.2-beta.1";

test("the planted crash is one the Worker's own parser takes, dated its day, from the version named (docs/engineering/services-and-feedback.md#SERV-279)", () => {
  const body = crashEnvelope(V, now, "f17cbfa4-3761-44e4-b4cf-ff6c2537960f");
  expect(CRASH_HEADERS).toEqual({ "Content-Type": "application/x-sentry-envelope" });
  const parsed = parseEnvelope(new TextEncoder().encode(body), now);
  expect(parsed.release).toBe(V);
  // The Worker rebuilds it byte for byte: it is exactly what a copy's reporter sends.
  expect(new TextDecoder().decode(parsed.bytes)).toBe(body);
  const event = JSON.parse(body.split("\n")[2]);
  expect(event.timestamp).toBe(Date.parse("2026-10-02T00:00:00Z") / 1000);
  // A fresh id each time.
  expect(crashEnvelope(V, now)).not.toBe(crashEnvelope(V, now));
});
test("the Sentry stand-in keeps each report's release, day and exception's first line", () => {
  const at = new Date("2026-10-02T15:31:00Z");
  const body = crashEnvelope(V, now, "f17cbfa4-3761-44e4-b4cf-ff6c2537960f");
  expect(received(body, at)).toEqual({
    v: 1,
    received: "2026-10-02T15:31:00.000Z",
    release: V,
    timestamp: Date.parse("2026-10-02T00:00:00Z") / 1000,
    exception: "TypeError at webview 1:234",
  });
  // A native one stops in its innermost frame, the last.
  const native = body
    .split("\n")
    .map((line, i) => {
      if (i !== 2) return line;
      const event = JSON.parse(line);
      event.exception.values[0] = {
        type: "RustPanic",
        stacktrace: {
          frames: [
            { module: "native", function: "std::rt::lang_start" },
            { module: "native", function: "proscenium_lib::vault::save", lineno: 12 },
          ],
        },
      };
      return JSON.stringify(event);
    })
    .join("\n");
  expect(received(native, at).exception).toBe("RustPanic at proscenium_lib::vault::save");
  expect(() => received("{}\n{}\n{}\n", at)).toThrow();
});
test("the stand-in's reader counts what the Sentry stand-in kept, and asks D1 the live reader's queries (docs/engineering/services-and-feedback.md#SERV-280)", () => {
  const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 1000;
  const line = (release: string, d: string, exception: string) =>
    JSON.stringify({ v: 1, received: `${d}T12:00:00.000Z`, release, timestamp: day(d), exception });
  const log = [
    line(V, "2026-10-01", "TypeError at webview 1:234"),
    line(V, "2026-10-02", "TypeError at webview 1:234"),
    line(V, "2026-10-02", "RustPanic at proscenium_lib::vault::save"),
    line(V, "2026-09-29", "TypeError at webview 1:234"),
    line("1.0.1", "2026-10-02", "TypeError at webview 1:234"),
    "",
  ].join("\n");
  const w = window(V, "2026-10-01T14:00:00Z", "2026-10-02T14:00:00Z", [
    "0b6f35d4-5d0f-4c8e-9a41-6a3d2b1c0e11",
  ]);
  expect(crashesIn(log, w)).toEqual({
    total: 3,
    kinds: [
      { said: "TypeError at webview 1:234", count: 2 },
      { said: "RustPanic at proscenium_lib::vault::save", count: 1 },
    ],
  });
  const asked: string[] = [];
  const d1 = (sql: string) => {
    asked.push(sql);
    return sql.includes("FROM feedback_messages")
      ? [
          { id: "0b6f35d4-5d0f-4c8e-9a41-6a3d2b1c0e11" },
          { id: "1c7a46e5-6e1a-4d9f-8b52-7b4e3c2d1f22" },
        ]
      : [{ copies: 2 }];
  };
  expect(standInEvidence(w, d1, log)).toEqual({
    copies: 2,
    crashes: 3,
    crashSaid:
      "3 crash reports from 1.0.2-beta.1: TypeError at webview 1:234 (2); RustPanic at proscenium_lib::vault::save (1).",
    feedback: { total: 2, unmarked: 1 },
  });
  // The queries with their bindings written in: the version and the window's days.
  expect(asked).toHaveLength(2);
  for (const sql of asked) {
    expect(sql).toContain("'1.0.2-beta.1'");
    expect(sql).toContain("'2026-10-01'");
    expect(sql).toContain("'2026-10-03'");
    expect(sql).not.toMatch(/\?\d|^\s*--/m);
  }
});
test("every address the stand-in uses is one of its vars, on loopback, each with its port", () => {
  const vars = standInConfig().vars;
  const ports = ["UPDATES", "GITHUB", "SENTRY"].map((name) => listening(vars[name]).port);
  expect(new Set(ports).size).toBe(3);
  // The config names no port of its own: `bun run dev:standin` takes the Worker's from UPDATES.
  expect(standInConfig().dev).toBeUndefined();
  expect(() => listening("https://updates.proscenium.ink")).toThrow();
  expect(() => listening("http://127.0.0.1")).toThrow();
});
