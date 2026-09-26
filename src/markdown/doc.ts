// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Markdown ⇄ ProseMirror document, so a material can be EDITED as the page you
 * read rather than as its source. Markdown stays the thing on disk (storage
 * docs/app/keeping-work/storage-and-file-format.md#STOR-2); this is only the bridge into the editor and back out.
 *
 * The parse direction reuses parse.ts — one Markdown grammar in this app, not
 * two. The serialize direction is new, and it carries the load-bearing rule:
 *
 *   **Meaning round-trips; formatting normalizes.**
 *
 * A file that comes back from the editor may differ byte-for-byte from the one
 * that went in (`_em_` becomes `*em*`, `+ item` becomes `- item`, a hard-wrapped
 * paragraph becomes one long line). What must never differ is what it MEANS —
 * `toDoc(toMarkdown(toDoc(src)))` equals `toDoc(src)`, and doc.test.ts asserts
 * exactly that over the sample vault. Serializing is therefore only ever done
 * on a real edit, never on open: every write is a file event in a watched tree,
 * and reformatting a file nobody touched would be a change with no author.
 */
import { parseBlocks, type Align, type Block, type ListBlock, type Span } from "./parse";

/** The subset of ProseMirror JSON this bridge speaks. */
export interface Node {
  type: string;
  attrs?: Record<string, unknown>;
  content?: Node[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

// ---------------------------------------------------------------- to the doc

export function toDoc(markdown: string): Node {
  const content = parseBlocks(markdown).map(blockToNode);
  // ProseMirror will not accept an empty doc, and neither would a writer:
  // an empty note still needs somewhere to put the caret.
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

function blockToNode(block: Block): Node {
  switch (block.kind) {
    case "managedMarker":
      return { type: "managedMarker", attrs: { source: block.text } };
    case "paragraph":
      return { type: "paragraph", ...(block.align ? { attrs: { textAlign: block.align } } : {}), content: spansToNodes(block.spans) };
    case "heading":
      return {
        type: "heading",
        attrs: { level: Math.min(block.level, 6), ...(block.align ? { textAlign: block.align } : {}) },
        content: spansToNodes(block.spans),
      };
    case "quote":
      return {
        type: "blockquote",
        content: [{ type: "paragraph", content: spansToNodes(block.spans) }],
      };
    case "rule":
      return { type: "horizontalRule" };
    case "code":
      return {
        type: "codeBlock",
        attrs: { language: block.lang },
        content: block.text ? [{ type: "text", text: block.text }] : undefined,
      };
    case "list":
      return listToNode(block);
    case "table":
      return {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: block.head.map((cell, i) => cellNode("tableHeader", cell, block.aligns[i])),
          },
          ...block.rows.map((row) => ({
            type: "tableRow",
            content: row.map((cell, i) => cellNode("tableCell", cell, block.aligns[i])),
          })),
        ],
      };
  }
}

function cellNode(type: string, spans: Span[], align: Align | undefined): Node {
  return {
    type,
    attrs: { align: align ?? null },
    content: [{ type: "paragraph", content: spansToNodes(spans) }],
  };
}

function listToNode(list: ListBlock): Node {
  return {
    type: list.ordered ? "orderedList" : "bulletList",
    attrs: list.ordered ? { start: list.start } : undefined,
    content: list.items.map((item) => ({
      type: "listItem",
      content: [
        { type: "paragraph", content: spansToNodes(item.spans) },
        ...item.children.map(listToNode),
      ],
    })),
  };
}

/**
 * ProseMirror keeps no two adjacent text nodes with the same marks, so neither
 * do we — otherwise a document that came from the parser and one that came from
 * the editor could describe the same page and still compare unequal.
 */
function merge(nodes: Node[]): Node[] {
  const out: Node[] = [];
  for (const node of nodes) {
    const last = out[out.length - 1];
    if (
      last &&
      last.type === "text" &&
      node.type === "text" &&
      JSON.stringify(last.marks ?? []) === JSON.stringify(node.marks ?? [])
    ) {
      last.text = `${last.text ?? ""}${node.text ?? ""}`;
      continue;
    }
    out.push(node);
  }
  return out;
}

type MarkList = NonNullable<Node["marks"]>;

function spansToNodes(spans: Span[], marks: MarkList = []): Node[] {
  return merge(collectSpans(spans, marks));
}

function collectSpans(spans: Span[], marks: MarkList): Node[] {
  const out: Node[] = [];
  for (const span of spans) {
    switch (span.kind) {
      case "text":
        if (span.text) out.push({ type: "text", text: span.text, ...markProp(marks) });
        break;
      case "break":
        out.push({ type: "hardBreak" });
        break;
      case "code":
        out.push({ type: "text", text: span.text, ...markProp([...marks, { type: "code" }]) });
        break;
      case "strong":
        out.push(...collectSpans(span.spans, [...marks, { type: "bold" }]));
        break;
      case "em":
        out.push(...collectSpans(span.spans, [...marks, { type: "italic" }]));
        break;
      case "link":
        out.push(
          ...collectSpans(span.spans, [
            ...marks,
            { type: "link", attrs: { href: span.href } },
          ]),
        );
        break;
    }
  }
  return out;
}

function markProp(marks: Node["marks"]): { marks?: Node["marks"] } {
  return marks && marks.length ? { marks } : {};
}

// ------------------------------------------------------------ back to source

export function toMarkdown(doc: Node): string {
  const out = (doc.content ?? []).map((n) => blockToText(n, "", true)).filter((s) => s !== null);
  // One trailing newline, the way every other writer leaves a text file.
  const body = out.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  return body ? `${body}\n` : "";
}

/**
 * `indent` is the prefix every line after the first needs (nested lists).
 * `lineStarts` is passed down to paragraphs — see inlineToText.
 */
function blockToText(node: Node, indent: string, lineStarts: boolean): string | null {
  const align = node.attrs?.textAlign;
  const prefix = align === "center" || align === "right" ? `<!-- proscenium:align=${align} -->\n\n` : "";
  switch (node.type) {
    case "managedMarker":
      return String(node.attrs?.source ?? "");
    case "paragraph": {
      const text = inlineToText(node.content ?? [], lineStarts);
      return text.trim() ? prefix + text : text;
    }
    case "heading": {
      const level = Math.min(Number(node.attrs?.level ?? 1), 6);
      return `${prefix}${"#".repeat(level)} ${inlineToText(node.content ?? [])}`;
    }
    case "blockquote":
      return prefixLines(
        (node.content ?? [])
          .map((c) => blockToText(c, "", false))
          .filter((s): s is string => s !== null)
          .join("\n\n"),
        "> ",
      );
    case "horizontalRule":
      return "---";
    case "codeBlock": {
      const lang = node.attrs?.language ? String(node.attrs.language) : "";
      const text = (node.content ?? []).map((c) => c.text ?? "").join("");
      return `\`\`\`${lang}\n${text}\n\`\`\``;
    }
    case "bulletList":
    case "orderedList":
      return listToText(node, indent);
    case "table":
      return tableToText(node);
    default:
      // An unknown node still contributes its text rather than vanishing.
      return node.content ? inlineToText(node.content) : (node.text ?? null);
  }
}

function listToText(list: Node, indent: string): string {
  const ordered = list.type === "orderedList";
  const start = ordered ? Number(list.attrs?.start ?? 1) : 1;
  const lines: string[] = [];

  (list.content ?? []).forEach((item, i) => {
    const marker = ordered ? `${start + i}. ` : "- ";
    const pad = " ".repeat(marker.length);
    const blocks = item.content ?? [];
    const [first, ...rest] = blocks;
    const head = first ? (blockToText(first, indent + pad, false) ?? "") : "";
    lines.push(`${indent}${marker}${head}`);

    for (const block of rest) {
      if (block.type === "bulletList" || block.type === "orderedList") {
        lines.push(listToText(block, indent + pad));
        continue;
      }
      // Anything else inside an item (a pasted second paragraph, a quote) folds
      // into the item as a continuation line: the text survives, and the
      // parser reads it straight back as part of the same item.
      const text = blockToText(block, indent + pad, false);
      if (text) lines.push(prefixLines(text, indent + pad));
    }
  });

  return lines.join("\n");
}

function tableToText(table: Node): string {
  const rows = (table.content ?? []).map((row) =>
    (row.content ?? []).map((cell) => ({
      text: (cell.content ?? [])
        .map((c) => inlineToText(c.content ?? []))
        .join(" ")
        // A pipe inside a cell has to be escaped or it becomes a column.
        .replace(/\|/g, "\\|"),
      align: (cell.attrs?.align ?? null) as Align,
    })),
  );
  if (!rows.length) return "";

  const [head, ...body] = rows;
  const width = Math.max(...rows.map((r) => r.length));
  const cells = (row: typeof head) =>
    `| ${Array.from({ length: width }, (_, i) => row![i]?.text ?? "").join(" | ")} |`;

  const delim = Array.from({ length: width }, (_, i) => {
    switch (head![i]?.align ?? null) {
      case "center":
        return ":---:";
      case "right":
        return "---:";
      case "left":
        return ":---";
      default:
        return "---";
    }
  });

  return [cells(head!), `| ${delim.join(" | ")} |`, ...body.map(cells)].join("\n");
}

function prefixLines(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((l) => `${prefix}${l}`)
    .join("\n");
}

/**
 * Inline nodes back to Markdown.
 *
 * Marks are tracked as a STACK rather than wrapped per run, because adjacent
 * runs share their outer marks: `**bold *and italic***` is one bold that stays
 * open across two text nodes. Wrapping each node on its own would close and
 * reopen it — `**bold *****and italic***` — which is both unreadable and a
 * different document when read back.
 *
 * Nesting order is fixed (link, bold, italic) so the same document always
 * serializes the same way. Code is not on the stack: it is always innermost and
 * always exactly one run, and its content is never escaped — the backticks have
 * already made it literal.
 */
type Mark = { type: string; attrs?: Record<string, unknown> };
const NESTING = ["link", "bold", "italic"];
const WORD = /[\p{L}\p{N}]/u;

/**
 * `lineStarts` is true only for a top-level paragraph — the one place where a
 * line beginning `- ` or `## ` would be read back as a different block. Inside
 * a heading, a list item, a quote or a table cell the marker is already spent,
 * so escaping there would only litter the file.
 */
function inlineToText(nodes: Node[], lineStarts = false): string {
  let out = "";
  let open: { mark: Mark; close: string }[] = [];

  const close = (down: number) => {
    if (down >= open.length) return;
    // A closing delimiter has to sit against the text it closes: `**not **`
    // is not bold. Trailing space moves outside the markers.
    const trail = /\s+$/.exec(out)?.[0] ?? "";
    if (trail) out = out.slice(0, -trail.length);
    for (let k = open.length - 1; k >= down; k -= 1) out += open[k]!.close;
    out += trail;
    open = open.slice(0, down);
  };

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]!;
    if (node.type === "hardBreak") {
      // Everything shuts before the line ends. Leaving a mark open would put
      // its closing delimiter on the NEXT line — which is how `**not**\nevidence`
      // used to come back as `**not\n**evidence`, moving the bold onto the wrong
      // word. A run that really does span the break simply reopens below.
      close(0);
      out += "\n";
      continue;
    }
    if (node.type !== "text") continue;

    const marks = (node.marks ?? []) as Mark[];
    const isCode = marks.some((m) => m.type === "code");
    const target = reorder(
      NESTING.map((t) => marks.find((m) => m.type === t)).filter((m): m is Mark => !!m),
      open.map((o) => o.mark),
    );

    let common = 0;
    while (
      common < open.length &&
      common < target.length &&
      sameMark(open[common]!.mark, target[common]!)
    ) {
      common += 1;
    }
    close(common);
    for (const mark of target.slice(common)) {
      if (mark.type === "link") {
        out += "[";
        open.push({ mark, close: `](${mark.attrs?.href ?? ""})` });
      } else if (mark.type === "bold") {
        out += "**";
        open.push({ mark, close: "**" });
      } else {
        const m = italicMarker(nodes, i, out);
        out += m;
        open.push({ mark, close: m });
      }
    }

    out += isCode
      ? fenceCode(node.text ?? "")
      : escapeText(node.text ?? "", out, lineStarts);
  }

  close(0);
  return out;
}

function sameMark(a: Mark, b: Mark): boolean {
  return a.type === b.type && a.attrs?.href === b.attrs?.href;
}

/**
 * Put marks that are ALREADY open back in the position they are already in.
 *
 * Emphasis nests in either order in Markdown, so a run that merely adds bold
 * inside a running italic should keep the italic open. Ordering by a fixed
 * table instead turns `_a **b** c_` into `_a _**_b_**_ c_` — the file a writer's
 * migrated notes came out as, which then re-read as something else
 * entirely. The first active mark that this run drops ends the matching: from
 * there down, everything has to close anyway.
 */
function reorder(target: Mark[], open: Mark[]): Mark[] {
  const rest = [...target];
  const kept: Mark[] = [];
  for (const active of open) {
    const at = rest.findIndex((m) => sameMark(m, active));
    if (at === -1) break;
    kept.push(rest.splice(at, 1)[0]!);
  }
  return [...kept, ...rest];
}

/**
 * `_` for italics, because that is what this vault is written in — but `_`
 * cannot open or close inside a word, so an intraword run falls back to `*`.
 * Needs the character after the run, hence the look-ahead through the nodes.
 */
function italicMarker(nodes: Node[], from: number, out: string): string {
  const before = out.slice(-1);
  if (before && WORD.test(before)) return "*";
  for (let k = from + 1; k < nodes.length; k += 1) {
    const node = nodes[k]!;
    // A break inside the run is not the end of it — keep looking. (A break
    // that IS the end resolves to `*` here, which is safe, just not minimal.)
    if (node.type === "hardBreak") continue;
    if (node.type !== "text") break;
    if ((node.marks ?? []).some((m) => m.type === "italic")) continue;
    return WORD.test((node.text ?? "").slice(0, 1)) ? "*" : "_";
  }
  return "_";
}

/** A run containing backticks needs a fence longer than the longest run in it. */
function fenceCode(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

/**
 * Escape only what would come back as something else. Over-escaping is its own
 * bug here: these files are read and hand-edited by people and by other tools, and a
 * note full of `\-` and `\#` is worse than the risk it avoids.
 *
 * `before` is the text already emitted on this block, so line-start rules apply
 * to a real line start rather than to every text run.
 */
function escapeText(text: string, before: string, lineStarts: boolean): string {
  let out = text
    .replace(/\\/g, "\\\\")
    // Emphasis and code markers. The `_` rule has to be the exact mirror of
    // the parser's: it ignores `_` only strictly INSIDE a word, so everything
    // else has to be escaped. Anything looser leaves a bare `_` that reads
    // back as emphasis — which is how an imported `_**_bold_**_` used to
    // come apart on the second save.
    .replace(/\*/g, "\\*")
    .replace(/(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])/gu, "\\_")
    .replace(/`/g, "\\`")
    // A bracket run that looks like a link, so it doesn't become one.
    .replace(/\[([^\]]*)\]\(/g, "\\[$1\\](");

  if (lineStarts && (!before || before.endsWith("\n"))) {
    // The backslash goes before the PUNCTUATION, never before a digit: `1\.`
    // is an escaped period, `\1.` is a literal backslash followed by "1.".
    out = out
      .replace(/^(\s{0,3})(#{1,6}|>|[-+])(?=\s|$)/, "$1\\$2")
      .replace(/^(\s{0,3}\d{1,9})([.)])(?=\s|$)/, "$1\\$2");
    // A line that is only dashes or underscores would read as a rule.
    if (/^\s{0,3}([-_])(\s*\1){2,}\s*$/.test(out)) out = out.replace(/^(\s*)(.)/, "$1\\$2");
  }
  return out;
}
