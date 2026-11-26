// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Bold, italic and underline asked for by the system's own text editing, run
 * by the editor's own commands (docs/engineering/cross-platform.md#PLAT-76).
 *
 * Where iPadOS keeps ⌘B, ⌘I and ⌘U for the text it is editing, the page hears
 * no key: WebKit runs its own bold and tells the page only by a `beforeinput`
 * of `formatBold` (`formatItalic`, `formatUnderline`), and the screen
 * keyboard's B, I and U do the same. Left to WebKit, the format went into the
 * page behind the editor's back, or nowhere at all at a caret. So the editor
 * takes those input types itself: it cancels WebKit's and runs its own, the
 * one its keys and its bar run. A format a surface cannot hold (a document has
 * no underline) is cancelled and nothing else happens.
 *
 * One press of ⌘B can reach an editor by more than one way: the page's own
 * key, the menu's item and the system's input. It runs once (`formatOnce`).
 * And the menu's Bold, Italic and Underline format the editor with the focus,
 * a document's as a document does (`formatterWithFocus`), never the script
 * behind it.
 */
import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

export type Format = "bold" | "italic" | "underline";
export type Formats = Partial<Record<Format, (editor: Editor) => void>>;

/** The format a mark is: the script's `strong`, `em` and `underline`, a document's `bold` and `italic`. */
export function markFormat(mark: string): Format | null {
  switch (mark) {
    case "strong":
    case "bold":
      return "bold";
    case "em":
    case "italic":
      return "italic";
    case "underline":
      return "underline";
    default:
      return null;
  }
}

/**
 * How far apart one press's ways into an editor come. In an iPad simulator
 * with a hardware keyboard, each ⌘B reached the page as its own key, which
 * the script's binding took, and 5 to 16 ms later as the menu's Bold: Bold ran
 * twice, and the line was left as it was. iPadOS's `formatBold` has come in
 * other runs.
 */
export const ONE_PRESS_MS = 300;

/** The way a format reached an editor: the page's own key, the menu's item, or the system's input. */
export type FormatWay = "key" | "menu" | "input";

const lastFormat = new WeakMap<object, { format: Format; way: FormatWay; at: number }>();

/**
 * Whether a format asked of `editor` is a press of its own, to run: not when
 * another way ran the same format there a moment ago, one press that reached
 * the editor twice. Two presses the same way are two, however quick.
 */
export function formatOnce(
  editor: object,
  format: Format,
  way: FormatWay,
  now: number = performance.now(),
): boolean {
  const last = lastFormat.get(editor);
  if (last && last.format === format && last.way !== way && now - last.at < ONE_PRESS_MS) {
    lastFormat.delete(editor);
    return false;
  }
  lastFormat.set(editor, { format, way, at: now });
  return true;
}

/** Each editor that takes the system's formats, by its element. */
const formatters = new WeakMap<Element, { editor: Editor; formats: Formats }>();

/** The editor with the focus, if it takes the system's formats, and its own formats. */
export function formatterWithFocus(): { editor: Editor; formats: Formats } | null {
  const dom =
    typeof document === "undefined" ? null : document.activeElement?.closest(".ProseMirror");
  return (dom && formatters.get(dom)) ?? null;
}

/** The format a `beforeinput`'s type asks for, or null for any other input. */
export function formatAsked(inputType: string): Format | null {
  switch (inputType) {
    case "formatBold":
      return "bold";
    case "formatItalic":
      return "italic";
    case "formatUnderline":
      return "underline";
    default:
      return null;
  }
}

export const formatInputKey = new PluginKey("formatInput");

/**
 * An editor's own bold, italic and underline, for the system's `format*`
 * inputs. With `keys`, for ⌘B, ⌘I and ⌘U too, ahead of the marks' own: an
 * editor whose keys are its marks' (a document's) runs a press once that way.
 */
export function FormatInput(formats: Formats, options: { keys?: boolean } = {}) {
  return Extension.create({
    name: "formatInput",
    priority: 1000,
    addKeyboardShortcuts() {
      const keys: Record<string, () => boolean> = {};
      if (!options.keys) return keys;
      const editor = this.editor;
      const key = (format: Format) => () => {
        const run = formats[format];
        if (!run) return false;
        if (formatOnce(editor, format, "key")) run(editor);
        return true;
      };
      keys["Mod-b"] = key("bold");
      keys["Mod-i"] = key("italic");
      keys["Mod-u"] = key("underline");
      return keys;
    },
    addProseMirrorPlugins() {
      const editor = this.editor;
      return [
        new Plugin({
          key: formatInputKey,
          view(view) {
            formatters.set(view.dom, { editor, formats });
            return { destroy: () => formatters.delete(view.dom) };
          },
          props: {
            handleDOMEvents: {
              beforeinput: (view, event) => {
                const asked = formatAsked((event as InputEvent).inputType ?? "");
                if (!asked) return false;
                event.preventDefault();
                // Words shown to be read, a redline's, are formatted by no one;
                // and a press its own key or the menu's item just ran has run.
                if (view.editable && formatOnce(editor, asked, "input")) formats[asked]?.(editor);
                return true;
              },
            },
          },
        }),
      ];
    },
  });
}
