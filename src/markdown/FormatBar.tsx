// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The formatting bar over a Markdown page.
 *
 * The prose editor could always render bold, headings, lists and tables, and
 * offered no way to apply any of them: the only route in was to know the
 * Markdown shortcut and type it. That is a source editor wearing a page's
 * clothes. A page you type on has a bar.
 *
 * **Every control here round-trips to Markdown and back.** That is the rule
 * this file exists to enforce, and it is why there is no underline and no
 * strikethrough: Markdown has no underline at all, and `~~strike~~` is not part
 * of the dialect src/markdown/doc.ts writes — either would look applied, then
 * vanish on the next save, which is the worst kind of formatting bug because
 * the writer sees it work. The two extensions are switched off in ProseEditor
 * for the same reason, so their keyboard shortcuts cannot smuggle them back in.
 */
import { FormattingIcon } from "../ui/FormattingIcon";
import type { Editor } from "@tiptap/core";
import { useEffect, useState } from "react";
import { PopupButton } from "../ui";

export interface FormatBarProps {
  editor: Editor | null;
  openingPage?: boolean;
}

const I = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/**
 * A block kind the paragraph menu can switch between. Everything here maps to a
 * line prefix in Markdown, which is why the menu is a menu rather than six
 * buttons — they are mutually exclusive states of one line.
 */
const BLOCKS: {
  label: string;
  /** Class suffix, so the menu row can be drawn AT the size it applies. */
  key: string;
  is: (e: Editor) => boolean;
  set: (e: Editor) => void;
}[] = [
  {
    label: "Body Text",
    key: "body",
    is: (e) => e.isActive("paragraph") && !e.isActive("blockquote"),
    set: (e) => e.chain().focus().setParagraph().run(),
  },
  {
    label: "Heading 1",
    key: "h1",
    is: (e) => e.isActive("heading", { level: 1 }),
    set: (e) => e.chain().focus().setNode("heading", { level: 1 }).run(),
  },
  {
    label: "Heading 2",
    key: "h2",
    is: (e) => e.isActive("heading", { level: 2 }),
    set: (e) => e.chain().focus().setNode("heading", { level: 2 }).run(),
  },
  {
    label: "Heading 3",
    key: "h3",
    is: (e) => e.isActive("heading", { level: 3 }),
    set: (e) => e.chain().focus().setNode("heading", { level: 3 }).run(),
  },
  {
    label: "Quote",
    key: "quote",
    is: (e) => e.isActive("blockquote"),
    set: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    label: "Code Block",
    key: "code",
    is: (e) => e.isActive("codeBlock"),
    set: (e) => e.chain().focus().toggleCodeBlock().run(),
  },
];

export function FormatBar({ editor, openingPage = false }: FormatBarProps) {
  // ProseMirror state changes do not re-render React on their own, so the
  // active states would freeze at whatever they were when the bar mounted —
  // a bar that lies about what the cursor is inside is worse than none.
  const [, bump] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const rerender = () => bump((n) => n + 1);
    editor.on("transaction", rerender);
    editor.on("selectionUpdate", rerender);
    return () => {
      editor.off("transaction", rerender);
      editor.off("selectionUpdate", rerender);
    };
  }, [editor]);

  if (!editor) return null;

  const blocks = openingPage ? BLOCKS.slice(0, 4) : BLOCKS;
  const block = blocks.find((b) => b.is(editor)) ?? BLOCKS[0];

  const Btn = ({
    on,
    title,
    label,
    run,
    children,
  }: {
    on?: boolean;
    title: string;
    label: string;
    run: () => void;
    children: React.ReactNode;
  }) => (
    <button
      type="button"
      className={`fmt__btn${on ? " is-on" : ""}`}
      title={title}
      aria-label={label}
      aria-pressed={on}
      // The bar must not steal the selection: a button that focuses itself
      // collapses the range you were about to embolden.
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {children}
    </button>
  );

  return (
    <div className="fmt" role="toolbar" aria-label="Formatting">
      {/* Each style is rendered AT its own size in the menu, so the control
          shows what it does rather than naming it (docs/engineering/design-system.md#UI-D107). */}
      <PopupButton
        className="fmt__block"
        label="Paragraph style"
        menuWidth={190}
        value={block.label}
        onChange={(label) => BLOCKS.find((b) => b.label === label)?.set(editor)}
        options={blocks.map((b) => ({
          value: b.label,
          label: <span className={`fmt__blockrow fmt__blockrow--${b.key}`}>{b.label}</span>,
          text: b.label,
        }))}
      />

      <span className="fmt__rule" />

      <Btn
        on={editor.isActive("bold")}
        title="Bold · ⌘B"
        label="Bold"
        run={() => editor.chain().focus().toggleBold().run()}
      >
        <FormattingIcon name="bold" />
      </Btn>
      <Btn
        on={editor.isActive("italic")}
        title="Italic · ⌘I"
        label="Italic"
        run={() => editor.chain().focus().toggleItalic().run()}
      >
        <FormattingIcon name="italic" />
      </Btn>
      {!openingPage && (
        <>
          <Btn
            on={editor.isActive("code")}
            title="Inline code"
            label="Inline code"
            run={() => editor.chain().focus().toggleCode().run()}
          >
            <svg viewBox="0 0 16 16" {...I}>
              <path d="M5.8 4.6 2.6 8l3.2 3.4M10.2 4.6 13.4 8l-3.2 3.4" />
            </svg>
          </Btn>
          <Btn
            on={editor.isActive("link")}
            title="Link"
            label="Link"
            run={() => {
              if (editor.isActive("link")) {
                editor.chain().focus().unsetLink().run();
                return;
              }
              const href = prompt("Link to:", "https://")?.trim();
              if (!href) return;
              editor.chain().focus().setLink({ href }).run();
            }}
          >
            <svg viewBox="0 0 16 16" {...I}>
              <path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2-2a2.6 2.6 0 0 0-3.7-3.7l-.9.9" />
              <path d="M9.4 6.6a2.6 2.6 0 0 0-3.7 0l-2 2a2.6 2.6 0 0 0 3.7 3.7l.9-.9" />
            </svg>
          </Btn>
        </>
      )}
      {openingPage && (
        <PopupButton
          disabled={editor.isActive("bulletList") || editor.isActive("orderedList")}
          label="Text alignment"
          value={
            editor.getAttributes(editor.isActive("heading") ? "heading" : "paragraph").textAlign ??
            "left"
          }
          options={[
            { value: "left", label: "Align Left" },
            { value: "center", label: "Center" },
            { value: "right", label: "Align Right" },
          ]}
          onChange={(value) =>
            editor
              .chain()
              .focus()
              .updateAttributes("paragraph", { textAlign: value === "left" ? null : value })
              .updateAttributes("heading", { textAlign: value === "left" ? null : value })
              .run()
          }
        />
      )}
      <span className="fmt__rule" />

      <Btn
        on={editor.isActive("bulletList")}
        title="Bulleted list"
        label="Bulleted list"
        run={() => editor.chain().focus().toggleBulletList().run()}
      >
        {/* The same three lines as the numbered list beside it, so the pair
            sits level. */}
        <svg viewBox="0 0 16 16" {...I}>
          <circle cx="3" cy="3.2" r="0.95" fill="currentColor" stroke="none" />
          <circle cx="3" cy="8" r="0.95" fill="currentColor" stroke="none" />
          <circle cx="3" cy="12.8" r="0.95" fill="currentColor" stroke="none" />
          <path d="M6.6 3.2h7M6.6 8h7M6.6 12.8h7" />
        </svg>
      </Btn>
      <Btn
        on={editor.isActive("orderedList")}
        title="Numbered list"
        label="Numbered list"
        run={() => editor.chain().focus().toggleOrderedList().run()}
      >
        {/* Drawn for 15px. The numerals were 1.5 units wide
            under a 1.4 stroke, sat low against their lines, and the 2's base
            ran into the 3's top: at 1x the three were one warped mark. Now
            the lines are 4.8 apart, each numeral is centred on its line, and
            the numerals take a lighter stroke than the lines, so a 1, a 2 and
            a 3 read at 2x and stay three marks at 1x. */}
        <svg viewBox="0 0 16 16" {...I}>
          <path d="M6.6 3.2h7M6.6 8h7M6.6 12.8h7" />
          <path
            strokeWidth={1.05}
            d="M1.79 2.56 2.99 1.6V4.8M1.5 7.3C1.62 6.34 3.9 6.24 3.9 7.46 3.9 8.26 1.86 9.02 1.5 9.6H3.9M1.5 11.2H3.9L2.51 12.61C4.19 12.48 4.19 14.4 2.58 14.4 1.98 14.4 1.55 14.14 1.45 13.7"
          />
        </svg>
      </Btn>

      <span className="fmt__rule" />

      {!openingPage && (
        <>
          <Btn
            title="Table"
            label="Insert table"
            run={() =>
              editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
            }
          >
            <svg viewBox="0 0 16 16" {...I}>
              <rect x="2.6" y="3.4" width="10.8" height="9.2" rx="1" />
              <path d="M2.6 6.4h10.8M6.6 6.4v6.2M10 6.4v6.2" />
            </svg>
          </Btn>
          <Btn
            title="Divider"
            label="Insert divider"
            run={() => editor.chain().focus().setHorizontalRule().run()}
          >
            <svg viewBox="0 0 16 16" {...I}>
              <path d="M2.6 8h10.8" />
            </svg>
          </Btn>
        </>
      )}
    </div>
  );
}
