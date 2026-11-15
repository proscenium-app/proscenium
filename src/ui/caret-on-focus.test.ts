// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  AFTER_FOCUS_MS,
  CaretOnFocus,
  caretInEditor,
  caretOnFocusKey,
  PRESS_FOCUS_MS,
  returnCaret,
  takeFocusFromPress,
  type FocusedView,
  type PressFocusView,
} from "./caret-on-focus";

/** A page's node: an element, or a text node in one. */
interface Fake {
  nodeType: number;
  parentNode: unknown;
}
const element = (): Fake => ({ nodeType: 1, parentNode: null });
const textIn = (parent: Fake): Fake => ({ nodeType: 3, parentNode: parent });

/** An editor's view as the caret's return reads it, and how often it focused. */
function view(over: {
  inside?: Fake[];
  anchor?: Fake | null;
  focused?: boolean;
  editable?: boolean;
  destroyed?: boolean;
  noSelection?: boolean;
}) {
  const inside = new Set(over.inside ?? []);
  const seen = { focus: 0 };
  const v: FocusedView = {
    isDestroyed: over.destroyed ?? false,
    editable: over.editable ?? true,
    dom: {
      contains: (node) => inside.has(node as Fake),
      ownerDocument: {
        getSelection: () =>
          over.noSelection ? null : { anchorNode: (over.anchor ?? null) as never },
      },
    },
    hasFocus: () => over.focused ?? true,
    focus: () => {
      seen.focus++;
    },
  };
  return { v, seen };
}

describe("a caret in the editor", () => {
  test("a text node's place is its element's", () => {
    const line = element();
    expect(caretInEditor(view({ inside: [line], anchor: textIn(line) }).v)).toBe(true);
    expect(caretInEditor(view({ inside: [line], anchor: line }).v)).toBe(true);
  });

  test("no selection, or one outside the editor, is no caret in it", () => {
    const line = element();
    expect(caretInEditor(view({ inside: [line], anchor: null }).v)).toBe(false);
    expect(caretInEditor(view({ inside: [line], anchor: textIn(element()) }).v)).toBe(false);
    // A page with no selection object at all (a document with no window).
    expect(caretInEditor(view({ inside: [line], noSelection: true }).v)).toBe(false);
  });
});

describe("the caret's return", () => {
  test("an editor with the keyboard and no caret in the page gets its own back", () => {
    const { v, seen } = view({ anchor: null });
    expect(returnCaret(v)).toBe(true);
    expect(seen.focus).toBe(1);
  });

  test("a caret already in the editor is left where it stands", () => {
    const line = element();
    const { v, seen } = view({ inside: [line], anchor: textIn(line) });
    expect(returnCaret(v)).toBe(false);
    expect(seen.focus).toBe(0);
  });

  test("nothing moves for an editor without the keyboard, a read-only one, or one gone", () => {
    for (const over of [{ focused: false }, { editable: false }, { destroyed: true }]) {
      const { v, seen } = view({ anchor: null, ...over });
      expect(returnCaret(v)).toBe(false);
      expect(seen.focus).toBe(0);
    }
  });

  test("the editor's plugin answers a focus and a key, and leaves each to ProseMirror", async () => {
    const editor = new Editor({
      element: null,
      extensions: [StarterKit, CaretOnFocus],
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    const plugin = editor.extensionManager.plugins.find((p) => p.spec.key === caretOnFocusKey);
    editor.destroy();
    const events = plugin?.props.handleDOMEvents ?? {};
    expect(Object.keys(events).sort()).toEqual(["focus", "keydown", "mousedown", "pointerdown"]);

    // A key, with no caret in the page: the caret is back before the key is read.
    const keyed = view({ anchor: null });
    expect(events.keydown?.call(plugin as never, keyed.v as never, {} as KeyboardEvent)).toBe(
      false,
    );
    expect(keyed.seen.focus).toBe(1);

    // A focus: nothing at once, the caret a moment later, as ProseMirror's own look.
    const focused = view({ anchor: null });
    expect(events.focus?.call(plugin as never, focused.v as never, {} as FocusEvent)).toBe(false);
    expect(focused.seen.focus).toBe(0);
    await new Promise((done) => setTimeout(done, AFTER_FOCUS_MS + 10));
    expect(focused.seen.focus).toBe(1);
  });
});

/** A view as ProseMirror's focus handler writes it, and what was written. */
function pmView(over: { focused?: boolean; bare?: boolean } = {}) {
  const log: string[] = [];
  const input = { lastFocus: 0 };
  const v: PressFocusView = {
    dom: { classList: { add: (name: string) => log.push(`class ${name}`) } },
    focused: over.focused ?? false,
    input: over.bare ? undefined : input,
    domObserver: over.bare
      ? undefined
      : { stop: () => log.push("stop"), start: () => log.push("start") },
  };
  return { v, log, input };
}

describe("a press that gives the editor focus (docs/app/writing/editor-ux.md#EDIT-211)", () => {
  test("is taken as ProseMirror takes a focus, without its look at the page", () => {
    const { v, log, input } = pmView();
    expect(takeFocusFromPress(v, 1000, 1004)).toBe(true);
    expect(v.focused).toBe(true);
    expect(input.lastFocus).toBe(1004);
    // The class is written with ProseMirror's watcher stopped, as its own handler does.
    expect(log).toEqual(["stop", "class ProseMirror-focused", "start"]);
  });

  test("a finger's, whose focus comes at the lift, is a press's too", () => {
    const { v } = pmView();
    expect(takeFocusFromPress(v, 1000, 1000 + PRESS_FOCUS_MS)).toBe(true);
  });

  test("a focus with no press just before it is left to ProseMirror", () => {
    for (const [pressedAt, now] of [
      [Number.NEGATIVE_INFINITY, 5000],
      [1000, 1001 + PRESS_FOCUS_MS],
      [2000, 1000],
    ]) {
      const { v, log } = pmView();
      expect(takeFocusFromPress(v, pressedAt, now)).toBe(false);
      expect(v.focused).toBe(false);
      expect(log).toEqual([]);
    }
  });

  test("an editor already focused, or a view without ProseMirror's parts, is left alone", () => {
    for (const over of [{ focused: true }, { bare: true }]) {
      const { v, log } = pmView(over);
      expect(takeFocusFromPress(v, 1000, 1001)).toBe(false);
      expect(log).toEqual([]);
    }
  });

  test("the plugin takes the focus after a press on the editor, and only then", () => {
    const editor = new Editor({
      element: null,
      extensions: [StarterKit, CaretOnFocus],
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    const plugin = editor.extensionManager.plugins.find((p) => p.spec.key === caretOnFocusKey);
    editor.destroy();
    const events = plugin?.props.handleDOMEvents ?? {};
    const call = (name: string, target: object) =>
      (events as Record<string, (view: never, event: never) => boolean>)[name]?.call(
        plugin as never,
        target as never,
        {} as never,
      );
    // A view of both shapes: the caret's return and ProseMirror's own parts.
    const make = () => {
      const caret = view({ anchor: element() }).v;
      const pm = pmView().v;
      return { ...caret, ...pm, dom: { ...caret.dom, ...pm.dom } } as FocusedView & PressFocusView;
    };

    const unpressed = make();
    expect(call("focus", unpressed)).toBe(false);
    expect(unpressed.focused).toBe(false);

    const pressed = make();
    expect(call("pointerdown", pressed)).toBe(false);
    expect(call("focus", pressed)).toBe(true);
    expect(pressed.focused).toBe(true);
  });
});
