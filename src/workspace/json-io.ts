// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Canonical JSON serialization for the structured files (docs/app/keeping-work/storage-and-file-format.md#STOR-D2).
 *
 * Two requirements that plain `JSON.stringify(x, null, 2)` cannot meet:
 *
 *  1. **Stable key order + preserve-unknown-keys.** Keys are emitted in the
 *     documented schema order; any key the app doesn't model (incl. `_`-prefixed
 *     caches and AI-added annotations) is preserved verbatim, after the known
 *     keys, in original order (docs/app/keeping-work/storage-and-file-format.md#STOR-D2, docs/app/keeping-work/storage-and-file-format.md#STOR-D11).
 *
 *  2. **Compact leaf objects.** The committed sample files (and the schema
 *     examples) keep small all-primitive objects — `anchor`, `card`, `generator`,
 *     `autosave`, leaf binder items — on a SINGLE line. `JSON.stringify(_,2)`
 *     expands every nested object, which would reflow-churn every manifest on
 *     first open → spurious diffs and multi-device conflict-sibling storms. So we
 *     emit an object/array inline iff all its values/elements are primitive.
 *
 * The result is byte-idempotent: `stringifyCanonical(parse(stringifyCanonical(x)))
 * === stringifyCanonical(x)`.
 */

/**
 * A key-order template. `true` = leaf; a nested object = that subtree's order;
 * for an array-valued key it is the element template applied to each element.
 *
 * The key `"*"` is a WILDCARD: it supplies the template for every key the
 * template does not name. `scripts{}` in the play file is keyed by binder id,
 * so its keys are data and cannot be listed — but the value under each one has
 * a fixed shape, and without the wildcard those scene objects would serialize
 * in whatever order they were built in. Deterministic bytes are the point
 * (docs/app/keeping-work/storage-and-file-format.md#STOR-D5), so the shape has to reach them.
 */
export type KeyTemplate = { [key: string]: KeyTemplate | true };

/** The wildcard key. Never emitted as a key of its own. */
const WILDCARD = "*";

function isPrimitive(v: unknown): boolean {
  return v === null || typeof v !== "object";
}

function childTemplate(
  tmpl: KeyTemplate | true | undefined,
  key: string,
): KeyTemplate | true | undefined {
  if (!tmpl || tmpl === true) return undefined;
  const child = tmpl[key];
  if (child !== undefined) return child;
  return tmpl[WILDCARD];
}

/**
 * Reorder own keys: template keys first (in template order, when present), then
 * any remaining keys in their original order. Recurses into nested objects and
 * array elements. Array element ORDER is data and is never touched.
 */
function orderKeys(value: unknown, tmpl: KeyTemplate | true | undefined): unknown {
  if (Array.isArray(value)) {
    // For an array, `tmpl` is the element template.
    return value.map((el) => orderKeys(el, tmpl));
  }
  if (isPrimitive(value)) return value;

  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const known =
    tmpl && tmpl !== true ? Object.keys(tmpl).filter((k) => k !== WILDCARD) : [];
  for (const k of known) {
    if (k in obj) out[k] = orderKeys(obj[k], childTemplate(tmpl, k));
  }
  for (const k of Object.keys(obj)) {
    // preserve-unknown, under the wildcard's shape when the template has one
    if (!(k in out)) out[k] = orderKeys(obj[k], childTemplate(tmpl, k));
  }
  return out;
}

function emit(value: unknown, indent: number): string {
  if (isPrimitive(value)) return JSON.stringify(value);

  const pad = "  ".repeat(indent);
  const pad1 = "  ".repeat(indent + 1);

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (value.every(isPrimitive)) {
      return "[" + value.map((v) => JSON.stringify(v)).join(", ") + "]";
    }
    const items = value.map((v) => pad1 + emit(v, indent + 1));
    return "[\n" + items.join(",\n") + "\n" + pad + "]";
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return "{}";
  if (entries.every(([, v]) => isPrimitive(v))) {
    return (
      "{ " +
      entries.map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(", ") +
      " }"
    );
  }
  const lines = entries.map(
    ([k, v]) => pad1 + `${JSON.stringify(k)}: ${emit(v, indent + 1)}`,
  );
  return "{\n" + lines.join(",\n") + "\n" + pad + "}";
}

/** Serialize to canonical text: ordered keys, compact leaves, LF, trailing NL. */
export function stringifyCanonical(value: unknown, tmpl: KeyTemplate): string {
  return emit(orderKeys(value, tmpl), 0) + "\n";
}

/** Tolerant read (any valid JSON); throws on malformed input (caller handles). */
export function parseJson(text: string): unknown {
  return JSON.parse(text);
}

// --- the canonical key-order template (docs/app/keeping-work/storage-and-file-format.md#STOR-D5) ---

const BINDER_ITEM_TMPL: KeyTemplate = {
  id: true,
  type: true,
  path: true,
};
// `children` recurses with the same binder-item template.
BINDER_ITEM_TMPL.children = BINDER_ITEM_TMPL;

/** One script's entry in `scripts{}` — also used on its own to compare shapes. */
export const SCRIPT_DATA_TMPL: KeyTemplate = {};

const SCENE_TMPL: KeyTemplate = {
  id: true,
  anchor: { ordinal: true, headingHash: true, embeddedId: true },
  card: { color: true, status: true, label: true, boardNote: true },
};

SCRIPT_DATA_TMPL.scenes = SCENE_TMPL;
SCRIPT_DATA_TMPL.orphans = SCENE_TMPL;
SCRIPT_DATA_TMPL.castHidden = true;

/**
 * `scripts` is keyed by binder id, so its keys are DATA and cannot be listed.
 * The wildcard gives every one of them the same shape, so a scene's keys
 * serialize in schema order however the object was built.
 */
const SCRIPTS_TMPL: KeyTemplate = { [WILDCARD]: SCRIPT_DATA_TMPL };

export const PLAY_TMPL: KeyTemplate = {
  kind: true,
  schemaVersion: true,
  id: true,
  status: true,
  logline: true,
  created: true,
  modified: true,
  generator: { app: true, version: true },
  settings: { format: true, language: true, sceneAnchors: true, autosave: true },
  binder: BINDER_ITEM_TMPL,
  scripts: SCRIPTS_TMPL,
};
