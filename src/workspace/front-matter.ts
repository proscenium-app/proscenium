// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * YAML front-matter on a Markdown material (docs/app/keeping-work/storage-and-file-format.md#STOR-D2): a small structured
 * header the app writes and reads, above a body the writer owns.
 *
 * Shared by every surface that edits a material's prose — the material editor
 * and the outline scratchpad — so the round trip is identical wherever you
 * type. The invariant that matters: **editing the body never disturbs the
 * header.** `split` hands back the header verbatim and `reconstruct` puts that
 * same text back, so a field the app doesn't understand (another tool's annotation,
 * a forward-compat key) survives a body edit untouched.
 */

export interface FrontMatter {
  /** The raw header text between the `---` fences, or null when there is none. */
  header: string | null;
  /** Everything after it, leading blank lines trimmed. */
  body: string;
  /** Lowercased `key: value` pairs, for display only — never the write path. */
  fields: Record<string, string>;
}

export function split(content: string): FrontMatter {
  const m = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { header: null, body: content, fields: {} };
  const fields: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (kv) fields[kv[1].toLowerCase()] = kv[2].trim();
  }
  return { header: m[1], body: m[2].replace(/^\n+/, ""), fields };
}

/** Put an edited body back under its original header, newline-terminated. */
export function reconstruct(header: string | null, body: string): string {
  const trimmed = body.replace(/\s+$/, "") + "\n";
  return header ? `---\n${header}\n---\n\n${trimmed}` : trimmed;
}

/** `tags: [a, b]` → `["a","b"]`. Display only. */
export function parseTags(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Set (or add, or clear) one front-matter key, leaving every other line of the
 * header exactly as it was.
 *
 * Line-wise on purpose. The header is not parsed and re-serialised, because a
 * round trip through a parser is how a key the app does not understand — an
 * another tool's annotation, a forward-compat field — quietly disappears. The
 * Inspector's Sheet tab edits four keys; the other twenty in someone's file are
 * none of its business.
 */
export function setField(header: string | null, key: string, value: string): string {
  const line = `${key}: ${value}`;
  const lines = (header ?? "").split("\n").filter((l, i, a) => l !== "" || i < a.length - 1);
  const at = lines.findIndex((l) => new RegExp(`^${key}\\s*:`, "i").test(l));
  if (value.trim() === "") {
    return at >= 0 ? lines.filter((_, i) => i !== at).join("\n") : (header ?? "");
  }
  if (at >= 0) {
    lines[at] = line;
    return lines.join("\n");
  }
  return [...lines.filter(Boolean), line].join("\n");
}
