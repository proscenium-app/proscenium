// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A change to a script, read on the script's own page
 * (docs/app/keeping-work/storage-and-file-format.md#STOR-177): the elements
 * in the play's format, cut words struck through and added ones underlined.
 *
 * It is the editor, read-only, on a document made for the purpose
 * (redline-doc.ts), so a cue sits where the format puts it and two speeches
 * spoken together stand side by side, by the same rules as the page being
 * written. The sheet's margins are left off, and it is drawn smaller when the
 * pane is narrower than a line of the script, never squeezed into a narrower
 * column: an element keeps the measure the format gives it.
 */
import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  FORMAT_ELEMENT_KEYS,
  elementColumnIn,
  formatCssVars,
  formatToCss,
  inchesToCh,
  type FormatSpec,
} from "../format";
import { Pagination } from "./pagination";
import { Redline, RedlineAdd, RedlineDel } from "./redline";
import { scriptRedline } from "./redline-doc";
import { playExtensions } from "./schema";

const NO_META = {};

/**
 * How far each element's column starts from the text block's left edge, for
 * the rule in the margin: it stands at one place down the page, whatever the
 * column of the element it marks. The numbers are the format's own.
 */
function marginRuleCss(spec: FormatSpec): string {
  const ch = (inches: number) => `${Math.round(inchesToCh(spec, inches) * 1e4) / 1e4}ch`;
  const out: string[] = [];
  for (const key of FORMAT_ELEMENT_KEYS) {
    const sel = `.redline__page .pl-${key}`;
    out.push(`${sel} { --redline-in: ${ch(elementColumnIn(spec, key).leftIn)}; }`);
    if (spec.elements[key].standaloneIndentFromMargin !== null) {
      out.push(
        `${sel}:not(.pm-beside-body) { --redline-in: ${ch(elementColumnIn(spec, key, true).leftIn)}; }`,
      );
    }
  }
  return out.join("\n");
}

export function RedlineScript({
  before,
  after,
  format,
  label,
}: {
  before: string;
  after: string;
  format: FormatSpec;
  /** What this is a comparison of, for the page's name. */
  label: string;
}) {
  const redline = useMemo(() => scriptRedline(before, after), [before, after]);
  const editor = useEditor({
    extensions: [...playExtensions, Pagination, RedlineAdd, RedlineDel, Redline],
    editable: false,
    content: redline.doc ?? { type: "doc", content: [{ type: "action" }] },
    editorProps: { attributes: { spellcheck: "false" } },
  });

  useEffect(() => {
    if (!editor) return;
    editor.commands.setContent(redline.doc ?? { type: "doc", content: [{ type: "action" }] }, {
      emitUpdate: false,
    });
  }, [editor, redline]);

  // Dual speeches and cues set beside their lines are the format's, as in the script.
  useEffect(() => {
    editor?.commands.setPagination({ enabled: false, spec: format, meta: NO_META });
  }, [editor, format, redline]);

  const css = useMemo(() => `${formatToCss(format)}\n${marginRuleCss(format)}`, [format]);
  const vars = useMemo(() => formatCssVars(format) as CSSProperties, [format]);

  // As wide as a line of the script, or as much smaller as the pane makes it.
  const frame = useRef<HTMLDivElement | null>(null);
  const measure = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState(1);
  useLayoutEffect(() => {
    const el = frame.current;
    if (!el) return;
    const solve = () => {
      const natural = measure.current?.getBoundingClientRect().width ?? 0;
      // The page's hairline border is outside what the measure spans.
      const room = el.clientWidth - 1;
      if (natural > 0 && room > 0) setZoom(Math.min(1, Math.floor((room / natural) * 100) / 100));
    };
    solve();
    const observer = new ResizeObserver(solve);
    observer.observe(el);
    // Observers are silent in a window that is not being painted.
    window.addEventListener("resize", solve);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", solve);
    };
  }, [format]);

  return (
    <div className="redline" style={vars} ref={frame}>
      <style>{css}</style>
      <div className="redline__measure" ref={measure} aria-hidden="true" />
      {redline.openingPages && (
        <p className="changes__hint redline__note">
          The opening pages changed as well. Line by Line shows them.
        </p>
      )}
      {redline.doc ? (
        <div
          className="play-page redline__page"
          role="group"
          aria-label={label}
          style={{ zoom } as CSSProperties}
        >
          <EditorContent editor={editor} />
        </div>
      ) : (
        !redline.openingPages && (
          <p className="changes__hint redline__note">
            No line of the script reads differently. Line by Line shows what changed in the file.
          </p>
        )
      )}
    </div>
  );
}
