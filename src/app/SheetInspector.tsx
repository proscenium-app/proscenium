// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Sheet tab (docs/app/organizing/workspace-model.md#WORK-D105) — a material's front matter, out of the
 * page and into the inspector.
 *
 * The fields come from `materials/schema.ts`, which is the same table that
 * writes a new material's template, so this pane
 * cannot offer a field the file does not have. The body stays where it belongs:
 * on the page, in the writer's hands.
 *
 * Edits are line-wise (`front-matter.setField`) precisely so a key this pane
 * does not know about survives being edited next to.
 */
import { useEffect, useRef, useState } from "react";
import { schemaFor, UNIVERSAL_FIELDS } from "../materials/schema";
import { parseTags, split } from "../workspace/front-matter";
import { titleOf } from "../workspace";
import type { BinderItem } from "../workspace";
import { Capsule, CloseIcon, IconButton, PlusIcon } from "../ui";

/** Fields the app owns; the writer never types into them. */
const OWNED = new Set(UNIVERSAL_FIELDS.map((f) => f.key));

export function SheetInspector({
  item,
  content,
  locked = false,
  onSetField,
  onEditTags,
  derived,
  onOpenCast,
  onExportSides,
}: {
  item: BinderItem | null;
  content: string;
  /**
   * The sheet's choice is up ("changed somewhere else"): nothing here can be
   * saved until it is answered, so nothing here takes an edit.
   */
  locked?: boolean;
  /** Set one front-matter field; the store applies it to the sheet as it is when written. */
  onSetField: (key: string, value: string) => void;
  /**
   * Change the tags. The store applies `edit` to the tags as they are when it
   * writes — a remove made while an add was still saving used to write the
   * list it was drawn from, and the new tag with it was gone.
   */
  onEditTags: (edit: (tags: string[]) => string[]) => void;
  /** What the script says about this character; empty for other materials. */
  derived: { lines: number; scenes: number; appearances: string } | null;
  onOpenCast?: () => void;
  onExportSides?: () => void;
}) {
  const [adding, setAdding] = useState(false);

  if (!item) {
    return (
      <div className="emptysurface">
        <p className="emptysurface__title">No sheet in this pane</p>
        <p className="emptysurface__body">
          Open a character or a note from the binder and its front matter appears here.
        </p>
      </div>
    );
  }

  const fm = split(content);
  const schema = schemaFor(item.type);
  const fields = (schema?.frontMatter ?? [{ key: "tags", hint: "Labels you choose for this document." }]).filter((f) => !OWNED.has(f.key));
  const tags = parseTags(fm.fields.tags);

  const write = (key: string, value: string) => onSetField(key, value);

  return (
    <div className="inspector__scroll insp">
      <div className="insp__head">
        <div className="seclabel">
          {item.type === "character" ? "Character sheet" : "Sheet"}
        </div>
        <h2 className="insp__title">{titleOf(item)}</h2>
        <div className="insp__path mono">{item.path}</div>
      </div>

      {locked && (
        <p className="insp__foot" role="status">
          Choose between the two versions of this sheet first — until then, nothing here can be
          saved.
        </p>
      )}
      {fields.length === 0 ? (
        <p className="insp__foot">
          A document is a blank page — it carries no front matter to edit. The whole
          file is yours.
        </p>
      ) : (
        <div className="insp__fields">
          {fields.map((f) =>
            f.key === "tags" ? (
              <FieldRow key={f.key} label="tags" hint={f.hint}>
                <div className="insp__capsules">
                  {tags.map((t) => (
                    <Capsule key={t}>
                      {t}
                      <IconButton
                        size="mini"
                        label={`Remove “${t}”`}
                        disabled={locked}
                        onClick={() => onEditTags((now) => now.filter((x) => x !== t))}
                      >
                        <CloseIcon size={10} />
                      </IconButton>
                    </Capsule>
                  ))}
                  {adding && !locked ? (
                    <NewTagField
                      onCommit={(t) => {
                        if (t) onEditTags((now) => (now.includes(t) ? now : [...now, t]));
                      }}
                      onDone={() => setAdding(false)}
                    />
                  ) : (
                    <button
                      type="button"
                      className="capsule capsule--dashed insp__addtag"
                      aria-label="Add a tag"
                      disabled={locked}
                      onClick={() => setAdding(true)}
                    >
                      <PlusIcon size={10} />
                    </button>
                  )}
                </div>
              </FieldRow>
            ) : (
              <FieldRow key={f.key} label={f.key} hint={f.hint}>
                <SheetField
                  label={f.key}
                  value={fm.fields[f.key] ?? ""}
                  readOnly={locked}
                  onCommit={(v) => write(f.key, v)}
                />
              </FieldRow>
            ),
          )}
        </div>
      )}

      {derived && (
        <section className="insp__group">
          <div className="seclabel">In the script</div>
          <p className="insp__derived">
            {derived.lines} lines · {derived.scenes} scene
            {derived.scenes === 1 ? "" : "s"}
            <br />
            {derived.appearances}
          </p>
          <div className="insp__links">
            {onExportSides && (
              <button type="button" className="insp__link" onClick={onExportSides}>
                Sides (PDF) ↗
              </button>
            )}
            {onOpenCast && (
              <button type="button" className="insp__link" onClick={onOpenCast}>
                Show in Cast ↗
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="insp__fieldlabel" title={hint}>
        {label}
      </div>
      <div>{children}</div>
    </>
  );
}

/**
 * A typed value that commits when the field is left — or when the field goes
 * away first. The inspector is keyed by sheet, so clicking into another sheet
 * replaces this field before its blur arrives; the commit then goes to the sheet
 * it was typed for, through the callback that field was drawn with. Reused
 * across sheets, it used to write one character's age into another's file.
 */
function useCommitOnLeave(value: string, onCommit: (v: string) => void) {
  const [draft, setDraft] = useState(value);
  const edited = useRef(false);
  const latest = useRef({ draft, value, onCommit });
  latest.current = { draft, value, onCommit };
  useEffect(() => {
    if (!edited.current) setDraft(value);
  }, [value]);
  const commit = () => {
    const { draft: d, value: v, onCommit: c } = latest.current;
    const was = edited.current;
    edited.current = false;
    if (was && d !== v) c(d);
  };
  useEffect(() => () => commit(), []); // eslint-disable-line react-hooks/exhaustive-deps
  return {
    draft,
    change: (next: string) => {
      edited.current = true;
      setDraft(next);
    },
    commit,
    /** Nothing typed here is to be written, whether the field is left or goes away. */
    cancel: () => {
      edited.current = false;
      setDraft(latest.current.value);
    },
  };
}

function SheetField({
  value,
  onCommit,
  label,
  readOnly,
}: {
  value: string;
  onCommit: (v: string) => void;
  label: string;
  readOnly: boolean;
}) {
  const field = useCommitOnLeave(value, onCommit);
  return (
    <input
      className="field"
      value={field.draft}
      readOnly={readOnly}
      aria-label={label}
      onChange={(e) => field.change(e.target.value)}
      onBlur={field.commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function NewTagField({ onCommit, onDone }: { onCommit: (tag: string) => void; onDone: () => void }) {
  const field = useCommitOnLeave("", (t) => onCommit(t.trim()));
  return (
    <input
      className="field insp__tagfield"
      autoFocus
      value={field.draft}
      aria-label="New tag"
      onChange={(e) => field.change(e.target.value)}
      onBlur={() => {
        field.commit();
        onDone();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          field.cancel();
          onDone();
        }
      }}
    />
  );
}
