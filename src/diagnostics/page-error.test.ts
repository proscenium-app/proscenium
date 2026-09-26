// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from "bun:test";
import { pageErrorSignal, stackFrames } from "./page-error";
test("WebKit stacks keep bounded numeric bundle locations, no names or paths", () => {
  expect(
    stackFrames(
      "save@tauri://localhost/assets/index-abc.js:12:34\nclick@tauri://localhost/assets/index-abc.js:56:78",
    ),
  ).toEqual([
    { lineno: 12, colno: 34 },
    { lineno: 56, colno: 78 },
  ]);
  expect(stackFrames("f@tauri://localhost/assets/index-a.js:1:2\n".repeat(100))).toHaveLength(64);
});
test("Chromium stacks skip the message and accept only this page's bundle", () => {
  const origin = "http://127.0.0.1:5000";
  expect(
    stackFrames(
      `Secret /Users/writer/Plays\n    at save (${origin}/assets/index-a.js:1:234)\n    at bad (https://other.invalid/assets/index-a.js:1:2)`,
      origin,
    ),
  ).toEqual([{ lineno: 1, colno: 234 }]);
});
test("message text, source filenames and arbitrary stack locations never cross IPC", () => {
  for (const place of [
    "file:///Users/writer/Plays/Secret.js:1:2",
    "tauri://localhost/src/App.tsx:1:2",
    "tauri://localhost/assets/Secret.fountain:1:2",
    "tauri://localhost/assets/a.js:0:2",
    "tauri://localhost/assets/a.js?title=Secret:1:2",
  ])
    expect(stackFrames(`f@${place}`)).toEqual([]);
  const e = new TypeError("Could not save Secret");
  e.stack = "save@tauri://localhost/assets/index-a.js:1:2";
  expect(pageErrorSignal(e)).toEqual({ name: "TypeError", frames: [{ lineno: 1, colno: 2 }] });
});
test("a closed failure name and validated fallback are all an incomplete error can supply", () => {
  const e = new Error("Secret");
  e.name = "Ophelia";
  e.stack = "";
  expect(pageErrorSignal(e, "tauri://localhost/assets/index-a.js:9:9")).toEqual({
    name: "Error",
    frames: [{ lineno: 9, colno: 9 }],
  });
  expect(pageErrorSignal("Secret", "", "UnhandledRejection")).toEqual({
    name: "UnhandledRejection",
    frames: [],
  });
});
