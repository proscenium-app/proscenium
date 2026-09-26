// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Render the Markdown AST (parse.ts) as React elements — the READ-ONLY path.
 * A material is not rendered here; it is edited on the page by
 * src/markdown/ProseEditor.tsx.
 *
 * No `dangerouslySetInnerHTML` anywhere: the text may come from a file
 * something else wrote, and React elements built from a parsed tree simply
 * cannot carry markup through. Links are already filtered to http(s) and
 * mailto by the parser; they open in the OS browser rather than navigating the
 * app out from under the writer.
 */
import type { Block, ListBlock, Span } from "./parse";
import { parseBlocks } from "./parse";

function renderSpans(spans: Span[], keyPrefix = ""): React.ReactNode[] {
  return spans.map((span, i) => {
    const key = `${keyPrefix}${i}`;
    switch (span.kind) {
      case "text":
        return <span key={key}>{span.text}</span>;
      case "break":
        return <br key={key} />;
      case "code":
        return (
          <code className="md__code" key={key}>
            {span.text}
          </code>
        );
      case "strong":
        return <strong key={key}>{renderSpans(span.spans, `${key}.`)}</strong>;
      case "em":
        return <em key={key}>{renderSpans(span.spans, `${key}.`)}</em>;
      case "link":
        return (
          <a
            className="md__link"
            key={key}
            href={span.href}
            target="_blank"
            rel="noreferrer noopener"
          >
            {renderSpans(span.spans, `${key}.`)}
          </a>
        );
    }
  });
}

function CodeFence({ block }: { block: Extract<Block, { kind: "code" }> }) {
  const copy = () => void navigator.clipboard?.writeText(block.text);
  return (
    <div className="md__fence">
      <div className="md__fencebar">
        <span className="md__lang">{block.lang ?? "code"}</span>
        <button className="md__copy" onClick={copy} title="Copy this block">
          Copy
        </button>
      </div>
      <pre className="md__pre">
        <code>{block.text}</code>
      </pre>
    </div>
  );
}

function renderList(block: ListBlock, key: string): React.ReactNode {
  const Tag = block.ordered ? "ol" : "ul";
  return (
    <Tag className="md__list" key={key} start={block.ordered ? block.start : undefined}>
      {block.items.map((item, i) => (
        <li key={i}>
          {renderSpans(item.spans, `${key}.${i}.`)}
          {item.children.map((child, c) => renderList(child, `${key}.${i}.${c}`))}
        </li>
      ))}
    </Tag>
  );
}

function renderBlock(block: Block, key: string): React.ReactNode {
  switch (block.kind) {
    case "managedMarker":
      return null;
    case "code":
      return <CodeFence block={block} key={key} />;
    case "rule":
      return <hr className="md__rule" key={key} />;
    case "heading": {
      // These headings are chrome, not documents — cap the visual weight so a
      // model's "# Title" doesn't shout across the rail.
      const level = Math.min(block.level, 4);
      const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4";
      return (
        <Tag className={`md__h md__h--${level}`} key={key} style={{ textAlign: block.align }}>
          {renderSpans(block.spans, `${key}.`)}
        </Tag>
      );
    }
    case "quote":
      return (
        <blockquote className="md__quote" key={key}>
          {renderSpans(block.spans, `${key}.`)}
        </blockquote>
      );
    case "list":
      return renderList(block, key);
    case "table":
      return (
        // Wide tables scroll in their own box rather than widening the column.
        <div className="md__tablewrap" key={key}>
          <table className="md__table">
            <thead>
              <tr>
                {block.head.map((cell, c) => (
                  <th key={c} style={{ textAlign: block.aligns[c] ?? undefined }}>
                    {renderSpans(cell, `${key}.h${c}.`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} style={{ textAlign: block.aligns[c] ?? undefined }}>
                      {renderSpans(cell, `${key}.${r}.${c}.`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "paragraph":
      return (
        <p className="md__p" key={key} style={{ textAlign: block.align }}>
          {renderSpans(block.spans, `${key}.`)}
        </p>
      );
  }
}

/** Rendered Markdown. Empty text renders nothing at all. */
export function Markdown({ text }: { text: string }) {
  if (!text.trim()) return null;
  const blocks = parseBlocks(text);
  return <div className="md">{blocks.map((b, i) => renderBlock(b, String(i)))}</div>;
}
