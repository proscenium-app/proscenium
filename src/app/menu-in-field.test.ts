// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A menu item for the script, its chord pressed in a comment's field
 * (docs/app/writing/comments.md#COMM-78): the field keeps the keyboard.
 */
import { describe, expect, test } from "bun:test";
import { actsOnScript, fieldKeepingKeyboard, fieldKeyFor } from "./menu-in-field";

/** An element that is, or is not, inside a field that keeps the keyboard. */
const placed = (kept: boolean) => ({
  closest: (selector: string) =>
    kept && selector === "[data-keeps-keyboard]" ? { field: true } : null,
});

describe("the menu's items for the script", () => {
  test("the Script menu's elements and marks, the breaks, spelling and Comment", () => {
    for (const id of [
      "el-dialogue",
      "el-sceneHeading",
      "mark-strong",
      "mark-em",
      "mark-underline",
      "line-break",
      "page-break",
      "spelling-next",
      "comment",
    ])
      expect(actsOnScript(id)).toBe(true);
  });

  test("not the window's: saving, views, panels, find", () => {
    for (const id of [
      "save",
      "view-script",
      "toggle-inspector",
      "toggle-comments",
      "find",
      "focus",
    ])
      expect(actsOnScript(id)).toBe(false);
  });
});

describe("a field that keeps the keyboard", () => {
  test("is the comment's field, and nowhere else", () => {
    const inComment = placed(true);
    expect(fieldKeepingKeyboard(inComment)).toBe(inComment);
    expect(fieldKeepingKeyboard(placed(false))).toBeNull();
    expect(fieldKeepingKeyboard(null)).toBeNull();
  });

  test("is given its ⌘⏎ back for Page Break, as its own key saves it", () => {
    expect(fieldKeyFor("page-break", false)).toEqual({
      key: "Enter",
      code: "Enter",
      metaKey: true,
      ctrlKey: false,
    });
    expect(fieldKeyFor("page-break", true)).toEqual({
      key: "Enter",
      code: "Enter",
      metaKey: false,
      ctrlKey: true,
    });
  });

  test("is given nothing of any other item: Bold bolds no script behind it", () => {
    for (const id of ["mark-strong", "mark-em", "el-dialogue", "line-break", "comment"])
      expect(fieldKeyFor(id, false)).toBeNull();
  });
});
