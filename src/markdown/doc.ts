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
 *
 * A page before the script is read with `{ pageFile: true }` (page-fields.ts):
 * its field tokens become `field` nodes and its foot mark a `foot` node, and
 * each is written back as exactly the token or the line it was read from.
 */
import { parseBlocks, type Align, type Block, type ListBlock, type Span } from "./parse";
import { FIELD_TOKEN, FOOT_MARK, fieldToken, isFieldName } from "./page-fields";

/** The subset of ProseMirror JSON this bridge speaks. */
export interface Node {
  type: string;
  attrs?: Record<string, unknown>;
  content?: Node[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

// ---------------------------------------------------------------- to the doc

/** How a file is read into the editor. */
export interface ToDocOptions {
  /**
   * The file is a page before the script (src/layout/page-files.ts): each field
   * token in its text is a `field` node, `{ name }`, carrying the text's marks,
   * and its first foot mark line is a `foot` node. Without it both stay the
   * text they are, as in any other document.
   */
  pageFile?: boolean;
}

export function toDoc(markdown: string, options: ToDocOptions = {}): Node {
  const fields = options.pageFile === true;
  const content = counted(
    parseBlocks(markdown, { pageFile: fields }).map((block) => blockToNode(block, fields)),
  );
  // ProseMirror will not accept an empty doc, and neither would a writer:
  // an empty note still needs somewhere to put the caret.
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

/** `fields`: the text's field tokens are fields (a page file). */
function blockToNode(block: Block, fields: boolean): Node {
  switch (block.kind) {
    case "managedMarker":
      return { type: "managedMarker", attrs: { source: block.text } };
    case "foot":
      return { type: "foot" };
    case "paragraph":
      return {
        type: "paragraph",
        ...(block.align ? { attrs: { textAlign: block.align } } : {}),
        content: spansToNodes(block.spans, fields),
      };
    case "heading":
      return {
        type: "heading",
        attrs: {
          level: Math.min(block.level, 6),
          ...(block.align ? { textAlign: block.align } : {}),
        },
        content: spansToNodes(block.spans, fields),
      };
    case "quote":
      return {
        type: "blockquote",
        content: [{ type: "paragraph", content: spansToNodes(block.spans, fields) }],
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
      return listToNode(block, fields);
    case "table":
      return {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: block.head.map((cell, i) =>
              cellNode("tableHeader", cell, block.aligns[i], fields),
            ),
          },
          ...block.rows.map((row) => ({
            type: "tableRow",
            content: row.map((cell, i) => cellNode("tableCell", cell, block.aligns[i], fields)),
          })),
        ],
      };
  }
}

function cellNode(type: string, spans: Span[], align: Align | undefined, fields: boolean): Node {
  return {
    type,
    attrs: { align: align ?? null },
    content: [{ type: "paragraph", content: spansToNodes(spans, fields) }],
  };
}

function listToNode(list: ListBlock, fields: boolean): Node {
  return {
    type: list.ordered ? "orderedList" : "bulletList",
    attrs: list.ordered ? { start: list.start } : undefined,
    content: list.items.map((item) => ({
      type: "listItem",
      content: [
        { type: "paragraph", content: spansToNodes(item.spans, fields) },
        ...counted(item.children.map((child) => listToNode(child, fields))),
      ],
    })),
  };
}

/**
 * Markdown has no way to say "this list goes on from the one above": a
 * numbered list after an interruption is a new list with a number of its own.
 * So the number is the mark. A numbered list that starts where the one before
 * it, among the same siblings, left off is that list continuing, and the
 * editor keeps it counting from there as the list above grows (lists.ts holds
 * the same rule for a document being edited).
 */
function counted(nodes: Node[]): Node[] {
  let next: number | null = null;
  for (const node of nodes) {
    if (node.type !== "orderedList") continue;
    const start = Number(node.attrs?.start ?? 1);
    if (next !== null && start === next) node.attrs = { ...node.attrs, continues: true };
    next = start + (node.content?.length ?? 0);
  }
  return nodes;
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

function spansToNodes(spans: Span[], fields: boolean, marks: MarkList = []): Node[] {
  return merge(collectSpans(spans, marks, fields));
}

function collectSpans(spans: Span[], marks: MarkList, fields: boolean): Node[] {
  const out: Node[] = [];
  for (const span of spans) {
    switch (span.kind) {
      case "text":
        if (fields) out.push(...withFields(span.text, marks));
        else if (span.text) out.push({ type: "text", text: span.text, ...markProp(marks) });
        break;
      case "break":
        out.push({ type: "hardBreak" });
        break;
      case "code":
        // Code is what was typed, character for character: a token in it stays one.
        out.push({ type: "text", text: span.text, ...markProp([...marks, { type: "code" }]) });
        break;
      case "strong":
        out.push(...collectSpans(span.spans, [...marks, { type: "bold" }], fields));
        break;
      case "em":
        out.push(...collectSpans(span.spans, [...marks, { type: "italic" }], fields));
        break;
      case "link":
        out.push(
          ...collectSpans(
            span.spans,
            [...marks, { type: "link", attrs: { href: span.href } }],
            fields,
          ),
        );
        break;
    }
  }
  return out;
}

/** A run of a page file's text, each field token in it a `field` node with the run's marks. */
function withFields(text: string, marks: MarkList): Node[] {
  const out: Node[] = [];
  let last = 0;
  for (const match of text.matchAll(FIELD_TOKEN)) {
    const at = match.index ?? 0;
    if (at > last) out.push({ type: "text", text: text.slice(last, at), ...markProp(marks) });
    out.push({ type: "field", attrs: { name: match[1] }, ...markProp(marks) });
    last = at + match[0].length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last), ...markProp(marks) });
  return out;
}

function markProp(marks: Node["marks"]): { marks?: Node["marks"] } {
  return marks && marks.length ? { marks } : {};
}

// ------------------------------------------------------------ back to source

/** How a document is written. */
export interface ToMarkdownOptions {
  /**
   * Keep a paragraph with no words that is centered or at the right, as a
   * comment of its own (`<!-- proscenium:line=center -->`, which parse.ts
   * reads back as the empty line): a page's line waiting for words keeps how
   * it is set (docs/app/formatting/formats-and-layout.md#FMT-177). A page
   * file is written so; every other document writes nothing for an empty
   * line, as it always has.
   */
  emptyLines?: boolean;
}

/** The comment an empty line set centered or at the right is written as. */
export function emptyLineMark(align: "center" | "right"): string {
  return `<!-- proscenium:line=${align} -->`;
}

export function toMarkdown(doc: Node, options: ToMarkdownOptions = {}): string {
  const out = (doc.content ?? [])
    .map((n) => {
      const align = n.attrs?.textAlign;
      if (
        options.emptyLines &&
        n.type === "paragraph" &&
        (align === "center" || align === "right") &&
        !inlineToText(n.content ?? [], true).trim()
      )
        return emptyLineMark(align);
      return blockToText(n, "", true);
    })
    .filter((s) => s !== null);
  // One trailing newline, the way every other writer leaves a text file.
  const body = out
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return body ? `${body}\n` : "";
}

/**
 * `indent` is the prefix every line after the first needs (nested lists).
 * `lineStarts` is passed down to paragraphs — see inlineToText.
 */
function blockToText(node: Node, indent: string, lineStarts: boolean): string | null {
  const align = node.attrs?.textAlign;
  const prefix =
    align === "center" || align === "right" ? `<!-- proscenium:align=${align} -->\n\n` : "";
  switch (node.type) {
    case "managedMarker":
      return String(node.attrs?.source ?? "");
    case "foot":
      return FOOT_MARK;
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

    // The item's own text: its paragraph, and any more that follow it before
    // a nested list (a pasted second paragraph). Each line the writer broke
    // stays a line: it ends in a backslash and the next one hangs under the
    // item's text, which the parser reads straight back as one item.
    let k = 0;
    const own: string[] = [];
    while (k < blocks.length && (k === 0 || blocks[k]!.type === "paragraph")) {
      own.push(...inlineToText(blocks[k]!.content ?? [], "broken").split("\n"));
      k += 1;
    }
    // A break with nothing after it has no line to hold open.
    while (own.length > 1 && !own[own.length - 1]!.trim()) own.pop();
    lines.push(`${indent}${marker}${own.join(`\\\n${indent}${pad}`)}`);

    for (const block of blocks.slice(k)) {
      if (block.type === "bulletList" || block.type === "orderedList") {
        lines.push(listToText(block, indent + pad));
        continue;
      }
      // Anything else inside an item (a quote, a paragraph under a nested
      // list) folds into the item as a continuation line: the text survives,
      // and the parser reads it straight back as part of the list.
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
 * so escaping there would only litter the file. A list item is "broken": its
 * first line is spent, and each line after a break is a line start again, where
 * `- ` would be read back as an item of its own.
 */
function inlineToText(nodes: Node[], lineStarts: boolean | "broken" = false): string {
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
    // A page file's field is its token, inside whatever marks it carries
    // (`**{title}**`), and never escaped: the braces are what make it one.
    // A code mark on one means nothing on the page, so it is not written.
    const name = node.type === "field" ? node.attrs?.name : undefined;
    const token = isFieldName(name) ? fieldToken(name) : null;
    if (node.type !== "text" && token === null) continue;

    const marks = (node.marks ?? []) as Mark[];
    const isCode = token === null && marks.some((m) => m.type === "code");
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

    out +=
      token ?? (isCode ? fenceCode(node.text ?? "") : escapeText(node.text ?? "", out, lineStarts));
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
    // Nor is a field the run carries on through. One after the run starts
    // with `{`, which a `_` closes against as it does against a space.
    if (node.type === "field" && (node.marks ?? []).some((m) => m.type === "italic")) continue;
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
function escapeText(text: string, before: string, lineStarts: boolean | "broken"): string {
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

  if (before.endsWith("\n") ? lineStarts : lineStarts === true && !before) {
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
