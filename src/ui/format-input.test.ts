// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  FormatInput,
  ONE_PRESS_MS,
  formatAsked,
  formatInputKey,
  formatOnce,
  markFormat,
} from "./format-input";

describe("the system's own bold, italic and underline", () => {
  test("each format input type names its format, and nothing else does", () => {
    expect(formatAsked("formatBold")).toBe("bold");
    expect(formatAsked("formatItalic")).toBe("italic");
    expect(formatAsked("formatUnderline")).toBe("underline");
    for (const other of ["insertText", "insertParagraph", "formatStrikeThrough", "historyUndo", ""])
      expect(formatAsked(other)).toBeNull();
  });

  test("is cancelled and run by the editor's own command, or only cancelled where it has none", () => {
    const ran: string[] = [];
    const editor = new Editor({
      element: null,
      extensions: [StarterKit, FormatInput({ bold: () => ran.push("bold") })],
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    const plugin = editor.extensionManager.plugins.find((p) => p.spec.key === formatInputKey);
    editor.destroy();
    const beforeinput = plugin?.props.handleDOMEvents?.beforeinput;
    if (!beforeinput) throw new Error("no beforeinput handler");
    const input = (inputType: string, editable = true) => {
      let cancelled = false;
      const event = {
        inputType,
        preventDefault: () => (cancelled = true),
      } as unknown as InputEvent;
      const took = beforeinput.call(plugin as never, { editable } as never, event);
      return { took, cancelled };
    };
    expect(input("formatBold")).toEqual({ took: true, cancelled: true });
    expect(ran).toEqual(["bold"]);
    // No underline here: cancelled, and nothing else.
    expect(input("formatUnderline")).toEqual({ took: true, cancelled: true });
    expect(ran).toEqual(["bold"]);
    // Words shown to be read are formatted by no one.
    expect(input("formatBold", false)).toEqual({ took: true, cancelled: true });
    expect(ran).toEqual(["bold"]);
    // Typing is the editor's as ever.
    expect(input("insertText")).toEqual({ took: false, cancelled: false });
    // The menu's Bold just ran for this press: the input is that press again,
    // cancelled and not run twice.
    expect(formatOnce(editor, "bold", "menu")).toBe(true);
    expect(input("formatBold")).toEqual({ took: true, cancelled: true });
    expect(ran).toEqual(["bold"]);
    // The next press runs.
    expect(input("formatBold")).toEqual({ took: true, cancelled: true });
    expect(ran).toEqual(["bold", "bold"]);
  });

  test("each mark is its format, the script's and a document's alike", () => {
    expect(markFormat("strong")).toBe("bold");
    expect(markFormat("bold")).toBe("bold");
    expect(markFormat("em")).toBe("italic");
    expect(markFormat("italic")).toBe("italic");
    expect(markFormat("underline")).toBe("underline");
    expect(markFormat("note")).toBeNull();
  });

  test("one press by two ways runs once, and two presses one way are two", () => {
    const editor = {};
    // An iPad's ⌘B: the page's own key, then the menu's Bold 12 ms later.
    expect(formatOnce(editor, "bold", "key", 1000)).toBe(true);
    expect(formatOnce(editor, "bold", "menu", 1012)).toBe(false);
    // The next press, the same two ways.
    expect(formatOnce(editor, "bold", "key", 2500)).toBe(true);
    expect(formatOnce(editor, "bold", "menu", 2516)).toBe(false);
    // The menu's Bold and the system's bold, either way round.
    expect(formatOnce(editor, "bold", "menu", 4000)).toBe(true);
    expect(formatOnce(editor, "bold", "input", 4040)).toBe(false);
    expect(formatOnce(editor, "bold", "input", 4500)).toBe(true);
    expect(formatOnce(editor, "bold", "key", 4530)).toBe(false);
    // Two presses the same way, however quick.
    expect(formatOnce(editor, "bold", "key", 5000)).toBe(true);
    expect(formatOnce(editor, "bold", "key", 5050)).toBe(true);

    // Another way past the moment is a press of its own.
    const late = {};
    expect(formatOnce(late, "bold", "key", 0)).toBe(true);
    expect(formatOnce(late, "bold", "menu", ONE_PRESS_MS)).toBe(true);
    // So is another format, and a press in another editor.
    const two = {};
    expect(formatOnce(two, "bold", "menu", 0)).toBe(true);
    expect(formatOnce(two, "italic", "input", 10)).toBe(true);
    expect(formatOnce({}, "italic", "key", 20)).toBe(true);
  });

  test("an editor whose keys are taken runs ⌘B once a press, and leaves a format it has none of", () => {
    const ran: string[] = [];
    const editor = new Editor({
      element: null,
      extensions: [StarterKit, FormatInput({ bold: () => ran.push("bold") }, { keys: true })],
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    const make = editor.extensionManager.extensions.find((e) => e.name === "formatInput")?.config
      .addKeyboardShortcuts as unknown as
      | ((this: { editor: Editor }) => Record<string, () => boolean>)
      | undefined;
    const shortcuts = make?.call({ editor });
    editor.destroy();
    if (!shortcuts) throw new Error("no keys taken");
    expect(shortcuts["Mod-b"]()).toBe(true);
    expect(ran).toEqual(["bold"]);
    // The menu's Bold for that press does not run it again.
    expect(formatOnce(editor, "bold", "menu")).toBe(false);
    // No italic of its own here: the key is left to the marks.
    expect(shortcuts["Mod-i"]()).toBe(false);
  });
});
