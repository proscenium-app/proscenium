// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import { CHECKING, FRESH, START_GRACE_MS, UP_TO_DATE, hear, type Heard } from "./watcher-words";

/** Each report in turn, at its time since the folder opened: what was said, and whether it waited. */
function play(reports: [Parameters<typeof hear>[1], number][]) {
  let heard: Heard = FRESH;
  return reports.map(([status, at]) => {
    const { now, say, wait } = hear(heard, status, at);
    heard = now;
    return wait === null ? say : `wait ${wait}`;
  });
}

describe("the watcher's status line (docs/app/keeping-work/storage-and-file-format.md#STOR-86)", () => {
  test("a folder that starts within its grace says nothing at all", () => {
    expect(
      play([
        ["restarting", 0],
        ["watching", 300],
      ]),
    ).toEqual([`wait ${START_GRACE_MS}`, null]);
  });

  test("a start asked again at the end of its grace is shown and said, then its recovery", () => {
    expect(
      play([
        ["restarting", 0],
        ["restarting", START_GRACE_MS],
        ["restarting", START_GRACE_MS + 50],
        ["watching", 4000],
      ]),
    ).toEqual([`wait ${START_GRACE_MS}`, CHECKING, null, UP_TO_DATE]);
  });

  test("a folder that has been watched and loses its watch is said at once, however soon", () => {
    expect(
      play([
        ["watching", 100],
        ["restarting", 200],
        ["watching", 400],
      ]),
    ).toEqual([null, CHECKING, UP_TO_DATE]);
  });

  test("a watch that cannot be had at all is no start: said at once", () => {
    expect(play([["unavailable", 0]])).toEqual([CHECKING]);
  });

  test("no watcher reported is no problem, and owes the recovery only once said", () => {
    expect(
      play([
        ["restarting", 0],
        [null, 100],
      ]),
    ).toEqual([`wait ${START_GRACE_MS}`, null]);
    expect(
      play([
        ["unavailable", 0],
        [null, 100],
      ]),
    ).toEqual([CHECKING, UP_TO_DATE]);
  });
});
