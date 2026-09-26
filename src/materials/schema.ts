// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Material schemas — ONE declarative source for the two things that must
 * never disagree: the template a new material is born with, and the
 * affordances the material editor offers.
 *
 * The reason this is a table and not two hand-written strings is drift. If the
 * editor offered a `## Want` section and the template stopped writing one, the
 * writer would be pointed at a heading that isn't there.
 *
 * ## Only what earns a type has one
 *
 * There used to be six kinds: character, research, logline, note, outline, and
 * a `document` fallback. Five of them were the same file — Markdown prose with
 * a `type:` line on top — differing only in which folder they were born in and
 * which icon they got. That taxonomy cost the writer a decision ("is this a
 * note or research?") at the exact moment they wanted to type a sentence, and
 * it bought nothing: no surface treated a `research` file differently from a
 * `note`.
 *
 * A type now has to DO something:
 *
 * - `character` — the Cast surface reads it, the script's cues bind to it, and
 *   the app maintains an Appearances section inside it. It has a shape because
 *   something depends on the shape.
 * - `script` — a `.fountain` with card records and a paginator behind it.
 * - `outline` — the singleton scratchpad the Outline surface owns. The app
 *   creates it; the writer never picks it from a menu.
 *
 * Everything else is a **document**: a blank `.md` file with nothing in it.
 * Folders still organize (`research/`, `loglines/` in an older play are now
 * simply folders, which is what a writer always took them for), and the earlier
 * type names still parse so no existing manifest breaks — they just resolve to
 * `document` everywhere it matters. See `normalizeType`.
 */
import type { BinderItemType } from "../workspace";

export interface FieldSpec {
  /** YAML front-matter key. */
  key: string;
  /** One-line description, published in the guide. */
  hint: string;
}

export interface SectionSpec {
  /** Markdown `##` heading text. */
  heading: string;
  /** What belongs under it — published in the guide, never written to disk. */
  hint: string;
  /**
   * App-maintained content, fenced and regenerated (docs/app/organizing/workspace-model.md#WORK-D106). The ONLY place a
   * derived value lands inside a canonical file, which is why it is declared
   * here rather than special-cased at the write site.
   */
  managed?: "appearances";
}

export interface MaterialSchema {
  type: BinderItemType;
  /** Conventional home, relative to the sub-project root. */
  dir: string;
  /** One line for the guide: what this kind of material is for. */
  purpose: string;
  frontMatter: FieldSpec[];
  sections: SectionSpec[];
  /**
   * Whether a new file of this kind is born with front-matter at all. A
   * document is a blank page: nothing above the first line the writer types.
   */
  blank?: boolean;
}

/**
 * The old type names, and what they mean now.
 *
 * Kept as a mapping rather than deleted because plenty of files on disk have
 * front matter saying `type: research`. Those FILES are not wrong; the taxonomy
 * was, and they read as documents. No play file says them — the names are gone
 * from `BinderItemType` — so this is a front-matter concern only.
 */
export const LEGACY_TYPES: Record<string, BinderItemType> = {
  note: "document",
  research: "document",
  logline: "document",
};

/** The type a stored value means today. Unknown values fall back to `document`. */
export function normalizeType(type: string | null | undefined): BinderItemType {
  if (!type) return "document";
  if (type in LEGACY_TYPES) return LEGACY_TYPES[type];
  return KNOWN_TYPES.has(type) ? (type as BinderItemType) : "document";
}

const KNOWN_TYPES = new Set<string>([
  "script",
  "folder",
  "character",
  "document",
  "outline",
  "reference",
]);

/** Front-matter every TYPED material carries. Documents carry none at all. */
export const UNIVERSAL_FIELDS: FieldSpec[] = [
  { key: "id", hint: "ULID — identity, never the filename. Never change it." },
  { key: "type", hint: "The material kind. Also how the binder re-files a stray." },
  { key: "created", hint: "ISO-8601 UTC." },
];

export const SCHEMAS: MaterialSchema[] = [
  {
    type: "character",
    dir: "Characters",
    purpose: "One person in the play — what they want, what stops them, how they sound.",
    frontMatter: [
      { key: "aka", hint: "Other names they go by, comma-separated." },
      { key: "age", hint: "Age, or a range. Leave blank rather than guessing." },
      { key: "pronouns", hint: "e.g. she/her. Blank when the play has not said." },
      { key: "tags", hint: "Free-form list, e.g. [family, act-two]." },
    ],
    sections: [
      { heading: "Want", hint: "What they are after in the play. One or two sentences." },
      { heading: "Obstacle", hint: "What stands between them and it." },
      { heading: "Voice", hint: "How they talk — rhythm, vocabulary, what they never say." },
      { heading: "Backstory", hint: "Only what bears on the play. Not a biography." },
      { heading: "Relationships", hint: "One line per other character." },
      {
        heading: "Appearances",
        hint: "Which scenes they speak in. Maintained by the app from the script.",
        managed: "appearances",
      },
      { heading: "Notes", hint: "Anything else — questions, casting thoughts, contradictions." },
    ],
  },
  {
    type: "document",
    dir: "Notes",
    purpose:
      "Anything that is not the script and not a character: a note, a scrap of research, a logline, a scene you are not sure about yet. A blank Markdown page — no template, no required shape.",
    frontMatter: [],
    sections: [],
    blank: true,
  },
  {
    type: "outline",
    dir: "Notes",
    purpose:
      "The play's freeform outlining scratchpad — thinking about shape before it is shape. One per play; the Outline surface creates and owns it.",
    frontMatter: [],
    sections: [],
  },
];

export function schemaFor(type: string | null | undefined): MaterialSchema | null {
  const t = normalizeType(type);
  return SCHEMAS.find((s) => s.type === t) ?? null;
}

/**
 * Conventional directory for a material kind, relative to the play folder.
 *
 * Capitalized, because a folder's name is what Finder shows AND what the binder
 * shows — they are the same string since 1.0 (docs/app/keeping-work/storage-and-file-format.md#STOR-D4). `play-shape.ts`
 * derives the new play's binder folders from these, so the two cannot drift.
 */
export function defaultDirFor(type: string | null | undefined): string {
  return schemaFor(type)?.dir ?? "Notes";
}

/** The fence that marks an app-maintained section body (docs/app/organizing/workspace-model.md#WORK-D106). */
export const MANAGED_MARK =
  "<!-- proscenium:managed — regenerated from the script; edits here are overwritten -->";

/**
 * A new material's file content.
 *
 * A **document** is genuinely empty — zero bytes. Not a heading, not a
 * front-matter block, not a placeholder line. The file is named for what it is
 * (the filename IS the title, workspace/filename.ts), so a `title:` key would
 * be a second copy of a name that already exists, and an `# H1` would be a
 * third. The writer's first keystroke is the first byte in the file.
 *
 * A **typed** material still gets its front-matter and its empty sections, so
 * the writer can see at a glance what is missing and where each thing goes.
 */
export function renderTemplate(args: {
  type: string;
  id: string;
  title: string;
  created: string;
  template?: "prompts";
}): string {
  const schema = schemaFor(args.type);
  if (!schema || schema.blank) return "";

  const lines = [
    "---",
    `id: ${args.id}`,
    `type: ${schema.type}`,
    `created: ${args.created}`,
    // Declared but empty: nobody filling in `age:` should have to know the
    // key exists, and a blank key is a visible invitation.
    ...schema.frontMatter.map((f) => `${f.key}:`),
    "---",
  ];
  for (const section of args.template === "prompts" ? schema.sections : []) {
    lines.push("", `## ${section.heading}`);
    if (section.managed) lines.push(MANAGED_MARK);
  }
  return `${lines.join("\n")}\n`;
}
