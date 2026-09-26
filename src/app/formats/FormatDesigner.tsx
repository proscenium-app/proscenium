// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The format designer (docs/app/preferences-and-help/settings.md#SET-D100, Part B): the values a
 * format file holds, in fields, beside the layout engine's real pages at those
 * values.
 *
 * **A full-window sheet, not a pane.** The preview is what the designer is for,
 * and a sheet gives it the whole window: a pane shares its width with the binder
 * and the inspector, and exists only while a play is open — while Settings ›
 * Formats, where formats are made, opens from the Plays screen too.
 *
 * - Built-ins are read-only. Trying to change one asks to Duplicate it.
 * - Values are checked by src/format/validate.ts as they are typed (draft.ts);
 *   a problem is said at its field, and Save waits until there is none. The
 *   preview keeps the last values that worked, and says so.
 * - Save writes `<app config>/formats/<id>.json` atomically, the id a slug of
 *   the name; a name whose id is taken asks for another.
 * - Closing with unsaved changes names them.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BlockType, Doc } from "../../fountain/model";
import {
  DEFAULT_FORMAT_ID,
  REQUIRED_FORMAT_ELEMENTS,
  formatFileText,
  formatIdFromName,
  reloadFormats,
  type ElementAlign,
  type ElementFontStyle,
  type FormatRegistry,
  type FormatSpec,
  type PageSizeName,
} from "../../format";
import { formatSaved } from "../../diagnostics";
import { paginateDoc, type LayoutMeta } from "../../layout";
import { formats } from "../../storage";
import {
  Alert,
  Button,
  ChevronRightIcon,
  PopupButton,
  Segmented,
  Sheet,
  Switch,
  announce,
  useToast,
} from "../../ui";
import { DesignerPreview } from "./DesignerPreview";
import {
  ELEMENT_LABELS,
  changedParts,
  checkDraft,
  draftFromSpec,
  listInWords,
  type ElementDraft,
  type FormatDraft,
  type SlotsDraft,
} from "./draft";
import { NumberField, SlotField, TextField, type Locked } from "./fields";
import { useDesignerSaveHandler, type DesignerRequest } from "./open";
import { describeMoves, movedLines, type Moves } from "./preview";
import { formatSampler } from "./sampler";
import { useFormatRegistry } from "./use-formats";

/** The open play, when there is one. */
export interface DesignerPlay {
  title: string;
  /** Its script as it stands — read once, when the designer opens. */
  getDoc: () => Doc | null;
  meta: LayoutMeta;
  /** The format the play uses now. */
  formatId: string;
  onUseFormat: (id: string) => void;
}

/** A name no registered format's id is made from: "New Format", "New Format 2"… */
function unusedName(base: string, registry: FormatRegistry): string {
  const free = (name: string) => !registry.has(formatIdFromName(name));
  if (free(base)) return base;
  for (let n = 2; n < 1000; n++) if (free(`${base} ${n}`)) return `${base} ${n}`;
  return base;
}

function unsaved(spec: FormatSpec, name: string): FormatDraft {
  const draft = draftFromSpec(spec);
  draft.id = "";
  draft.name = name;
  return draft;
}

function startingPoint(
  request: DesignerRequest,
  registry: FormatRegistry,
): { draft: FormatDraft; fileName: string | null; locked: boolean } {
  const fallback = registry.get(DEFAULT_FORMAT_ID) ?? registry.resolve(null).spec;
  switch (request.kind) {
    case "edit": {
      const spec = registry.get(request.formatId) ?? fallback;
      const origin = registry.origin(spec.id);
      return {
        draft: draftFromSpec(spec),
        fileName: origin?.kind === "user" ? origin.fileName : null,
        locked: origin?.kind !== "user",
      };
    }
    case "duplicate": {
      const spec = registry.get(request.formatId) ?? fallback;
      return { draft: unsaved(spec, ""), fileName: null, locked: false };
    }
    case "new":
      return { draft: unsaved(fallback, unusedName("New Format", registry)), fileName: null, locked: false };
    case "imported":
      return { draft: unsaved(request.spec, request.spec.name), fileName: null, locked: false };
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function useWindowSize(): { width: number; height: number } {
  const read = () => ({ width: window.innerWidth, height: window.innerHeight });
  const [size, setSize] = useState(read);
  useEffect(() => {
    const onResize = () => setSize(read());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return size;
}

const FONT_STYLES: { value: ElementFontStyle; label: string }[] = [
  { value: "regular", label: "Regular" },
  { value: "italic", label: "Italic" },
  { value: "bold", label: "Bold" },
  { value: "bold-italic", label: "Bold Italic" },
];

/** One line of what an element does, for its collapsed row. */
function summarize(el: ElementDraft): string {
  const bits = [`${el.indentFromMargin || "0"} in`];
  if (el.align !== "left") bits.push(el.align === "center" ? "centered" : "right");
  if (el.textTransform === "uppercase") bits.push("caps");
  const style = FONT_STYLES.find((s) => s.value === el.fontStyle);
  if (style && el.fontStyle !== "regular") bits.push(style.label.toLowerCase());
  if (Number(el.spacingBefore) > 0) bits.push(`${el.spacingBefore} ${Number(el.spacingBefore) === 1 ? "line" : "lines"} before`);
  return bits.join(" · ");
}

export function FormatDesigner(props: {
  request: DesignerRequest;
  play: DesignerPlay | null;
  onClose: () => void;
}) {
  const registry = useFormatRegistry();
  const toast = useToast();
  const [start] = useState(() => startingPoint(props.request, registry));
  const [draft, setDraft] = useState(start.draft);
  const [saved, setSaved] = useState<{ draft: FormatDraft; fileName: string | null }>({
    draft: start.draft,
    fileName: start.fileName,
  });
  const [locked, setLocked] = useState(start.locked);
  const [prompt, setPrompt] = useState<null | "duplicate" | "close">(null);
  const [nameError, setNameError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [openElement, setOpenElement] = useState<BlockType | null>(null);
  const [previewPlay, setPreviewPlay] = useState(false);
  const [playDoc] = useState(() => props.play?.getDoc() ?? null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const size = useWindowSize();

  const check = useMemo(() => checkDraft(draft), [draft]);
  const [lastGood, setLastGood] = useState<FormatSpec>(() => check.spec ?? checkDraft({ ...draft, name: "Untitled Format" }).spec ?? registry.resolve(null).spec);
  useEffect(() => {
    if (check.spec) setLastGood(check.spec);
  }, [check.spec]);
  const previewSpec = check.spec ?? lastGood;
  const dirty = useMemo(() => !same(draft, saved.draft), [draft, saved.draft]);

  /* ── The preview ── */
  const sampler = useMemo(() => formatSampler(), []);
  const source =
    previewPlay && playDoc && props.play
      ? { key: "play", label: props.play.title, doc: playDoc, meta: props.play.meta }
      : { key: "sampler", label: "the format sampler", doc: sampler.doc, meta: sampler.meta };
  const layout = useMemo(
    () => paginateDoc(source.doc, previewSpec, source.meta),
    [source.doc, source.meta, previewSpec],
  );

  const [moves, setMoves] = useState<Moves>({ lines: new Set(), elements: [] });
  const shown = useRef<{ layout: typeof layout; spec: FormatSpec; key: string } | null>(null);
  const announceTimer = useRef(0);
  useEffect(() => {
    const before = shown.current;
    shown.current = { layout, spec: previewSpec, key: source.key };
    if (!before || before.key !== source.key) {
      setMoves({ lines: new Set(), elements: [] });
      return;
    }
    if (before.spec === previewSpec) return;
    const next = movedLines(before, { layout, spec: previewSpec });
    setMoves(next);
    // Once the typing stops: every keystroke is not news.
    window.clearTimeout(announceTimer.current);
    const pagesBefore = before.layout.pages.length;
    announceTimer.current = window.setTimeout(
      () => announce(describeMoves(next, layout.pages.length, pagesBefore)),
      600,
    );
  }, [layout, previewSpec, source.key]);
  useEffect(() => () => window.clearTimeout(announceTimer.current), []);

  /* ── Editing ── */
  const edit = useCallback(
    (change: (d: FormatDraft) => void) => {
      if (locked) {
        setPrompt("duplicate");
        return;
      }
      setDraft((prev) => {
        const next = structuredClone(prev);
        change(next);
        return next;
      });
    },
    [locked],
  );
  const lock: Locked = { locked, onLockedEdit: () => setPrompt("duplicate") };
  const err = (path: string) => check.errors.get(path);

  const duplicate = useCallback(() => {
    const copy = unsaved(check.spec ?? previewSpec, "");
    setDraft(copy);
    setSaved({ draft: copy, fileName: null });
    setLocked(false);
    setPrompt(null);
    announce("Name your copy before saving it.");
    setTimeout(() => nameRef.current?.select(), 0);
  }, [check.spec, previewSpec, draft.name, registry]);

  /* ── Saving ── */
  const canSave = !locked && !!check.spec && (dirty || saved.fileName === null) && !saving;
  const save = useCallback(async () => {
    if (!canSave || !check.spec) return;
    const name = draft.name.trim();
    let id = draft.id;
    let fileName = saved.fileName;
    if (fileName === null) {
      id = formatIdFromName(name);
      const ask = (message: string) => {
        setNameError(message);
        nameRef.current?.focus();
      };
      if (!id) return ask("Use at least one letter or number in the name.");
      const clash = registry.get(id);
      if (clash) return ask(`A format called “${clash.name}” already exists. Choose another name.`);
      fileName = `${id}.json`;
      // A file the registry skipped (it could not be read) is still a file.
      const existing = await formats.listUser().catch(() => []);
      if (existing.some((f) => f.fileName === fileName)) {
        return ask(`A file called ${fileName} is already in the Formats folder. Choose another name.`);
      }
    }
    setSaving(true);
    try {
      await formats.save(fileName, formatFileText({ ...check.spec, id, name }));
      await reloadFormats();
      const next = { ...draft, id, name };
      setDraft(next);
      setSaved({ draft: next, fileName });
      setNameError(undefined);
      toast({ kind: "ok", title: `Saved “${name}”` });
      formatSaved();
    } catch (e) {
      toast({ kind: "error", title: `“${name}” could not be saved.`, detail: String(e), code: "E-FORMAT-SAVE" });
    } finally {
      setSaving(false);
    }
  }, [canSave, check.spec, draft, saved.fileName, registry, toast]);

  const saveRef = useRef(save);
  saveRef.current = save;
  const promptRef = useRef(prompt);
  promptRef.current = prompt;
  useDesignerSaveHandler(() => void saveRef.current(), canSave);
  // ⌘S where the webview sees it (browser dev; the menu bar takes it natively).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      e.stopPropagation();
      if (promptRef.current === null) void saveRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  /* ── Around the format ── */
  const play = props.play;
  const inUse = !!play && play.formatId === draft.id && (locked || saved.fileName !== null);
  const canUse = !!play && !dirty && (locked || saved.fileName !== null) && !inUse;
  const useForPlay = () => {
    if (!play || !canUse) return;
    play.onUseFormat(draft.id);
    toast({ kind: "ok", title: `“${play.title}” now uses “${draft.name}”` });
  };

  const requestClose = () => (dirty ? setPrompt("close") : props.onClose());

  const status = check.errors.size
    ? `${check.errors.size === 1 ? "One value needs" : `${check.errors.size} values need`} fixing before you can save. The preview shows the last valid values.`
    : locked
      ? "Can’t be changed."
      : saved.fileName === null
        ? "Not saved yet."
        : dirty
          ? "Changes not saved."
          : `Saved as ${saved.fileName}.`;

  const slotGroup = (which: "header" | "footer", title: string, edge: string) => {
    const slots: SlotsDraft = draft[which];
    const set = (key: keyof SlotsDraft, value: string | boolean) =>
      edit((d) => {
        (d[which] as unknown as Record<string, string | boolean>)[key] = value;
      });
    return (
      <section className="designer__group" aria-labelledby={`dz-${which}`}>
        <h3 id={`dz-${which}`} className="seclabel">
          {title}
        </h3>
        {(["left", "center", "right"] as const).map((slot) => (
          <SlotField
            key={slot}
            id={`dz-${which}-${slot}`}
            label={`${title} ${slot}`}
            value={slots[slot]}
            error={err(`${which}.content.${slot}`)}
            onChange={(v) => set(slot, v)}
            {...lock}
          />
        ))}
        <NumberField
          id={`dz-${which}-position`}
          label={`From the ${edge} edge`}
          unit="in"
          value={slots.position}
          error={err(`${which}.position`)}
          onChange={(v) => set("position", v)}
          {...lock}
        />
        <label className="designer__switchrow">
          <span>Hide on first page</span>
          <Switch
            on={slots.suppressOnFirstPage}
            label={`Hide on first page (${which})`}
            onChange={(on) => set("suppressOnFirstPage", on)}
          />
        </label>
      </section>
    );
  };

  return (
    <>
      <Sheet
        title={draft.name.trim() || "Untitled Format"}
        subtitle={locked ? "Built-in format" : saved.fileName ?? "New format"}
        width={Math.min(1400, size.width - 32)}
        height={size.height - 56}
        onClose={requestClose}
        footer={
          <>
            <span className="sheet__hint designer__status" aria-live="polite">
              {status}
            </span>
            <span className="sheet__spacer" />
            {play && (
              <Button
                onClick={useForPlay}
                disabled={!canUse}
                title={
                  inUse
                    ? `“${play.title}” uses this format`
                    : canUse
                      ? undefined
                      : "Save the format first"
                }
              >
                {inUse ? "Used for This Play" : "Use for This Play"}
              </Button>
            )}
            <Button onClick={requestClose}>Close</Button>
            {locked ? (
              <Button treatment="primary" onClick={duplicate}>
                Duplicate
              </Button>
            ) : (
              <Button treatment="primary" disabled={!canSave} onClick={() => void save()}>
                {saving ? "Saving…" : "Save"}
              </Button>
            )}
          </>
        }
      >
        <div className="designer">
          <div className="designer__form" role="group" aria-label="Format settings">
            {locked && (
              <div className="designer__locked">
                <p>Built-in formats can’t be changed, so plays that use them keep their layout.</p>
                <Button size="small" onClick={duplicate}>
                  Duplicate
                </Button>
              </div>
            )}

            <section className="designer__group" aria-labelledby="dz-format">
              <h3 id="dz-format" className="seclabel">
                Format
              </h3>
              <TextField
                id="dz-name"
                label="Name"
                wide
                value={draft.name}
                inputRef={nameRef}
                autoFocus={!locked}
                error={nameError ?? err("name")}
                hint={
                  saved.fileName
                    ? `Saved as ${saved.fileName}.`
                    : "Also used for the file name in the Formats folder."
                }
                onChange={(v) => {
                  setNameError(undefined);
                  edit((d) => {
                    d.name = v;
                  });
                }}
                {...lock}
              />
            </section>

            <section className="designer__group" aria-labelledby="dz-page">
              <h3 id="dz-page" className="seclabel">
                Page
              </h3>
              <div className="dfield">
                <span className="dfield__label" id="dz-size-label">
                  Paper
                </span>
                <Segmented<PageSizeName>
                  size="small"
                  label="Paper"
                  value={draft.page.size}
                  options={[
                    { id: "letter", label: "US Letter" },
                    { id: "a4", label: "A4" },
                  ]}
                  onChange={(v) =>
                    edit((d) => {
                      d.page.size = v;
                    })
                  }
                />
              </div>
              <div className="designer__grid">
                {(["left", "right", "top", "bottom"] as const).map((side) => (
                  <NumberField
                    key={side}
                    id={`dz-margin-${side}`}
                    label={`${side[0].toUpperCase()}${side.slice(1)} margin`}
                    unit="in"
                    value={draft.page.margins[side]}
                    error={err(`page.margins.${side}`)}
                    onChange={(v) =>
                      edit((d) => {
                        d.page.margins[side] = v;
                      })
                    }
                    {...lock}
                  />
                ))}
              </div>
              {err("page.margins") && (
                <p className="dfield__error designer__grouperror">{err("page.margins")}</p>
              )}
            </section>

            <section className="designer__group" aria-labelledby="dz-type">
              <h3 id="dz-type" className="seclabel">
                Type
              </h3>
              <p className="designer__note">
                Every format uses Courier Prime, which keeps the page on screen and the printed page
                the same.
              </p>
              <div className="designer__grid">
                <NumberField
                  id="dz-type-size"
                  label="Size"
                  unit="pt"
                  value={draft.type.size}
                  error={err("type.size")}
                  onChange={(v) =>
                    edit((d) => {
                      d.type.size = v;
                    })
                  }
                  {...lock}
                />
                <NumberField
                  id="dz-type-line"
                  label="Line height"
                  unit="×"
                  value={draft.type.lineHeight}
                  error={err("type.lineHeight")}
                  onChange={(v) =>
                    edit((d) => {
                      d.type.lineHeight = v;
                    })
                  }
                  {...lock}
                />
              </div>
            </section>

            {slotGroup("header", "Header", "top")}
            {slotGroup("footer", "Footer", "bottom")}

            <section className="designer__group" aria-labelledby="dz-elements">
              <h3 id="dz-elements" className="seclabel">
                Elements
              </h3>
              <ul className="designer__elements">
                {REQUIRED_FORMAT_ELEMENTS.map((key) => {
                  const el = draft.elements[key];
                  const open = openElement === key;
                  const label = ELEMENT_LABELS[key];
                  const hasError = [...check.errors.keys()].some((p) => p.startsWith(`elements.${key}.`));
                  const set = (change: (e: ElementDraft) => void) =>
                    edit((d) => change(d.elements[key]));
                  return (
                    <li key={key} className="designer__element">
                      <button
                        type="button"
                        className={`designer__elementrow${open ? " is-open" : ""}`}
                        aria-expanded={open}
                        aria-controls={`dz-el-${key}`}
                        onClick={() => setOpenElement(open ? null : key)}
                      >
                        <span className="designer__twisty" aria-hidden="true">
                          <ChevronRightIcon size={8} />
                        </span>
                        <span className="designer__elementname">{label}</span>
                        <span className={`designer__elementsum${hasError ? " is-error" : ""}`}>
                          {hasError ? "Needs fixing" : summarize(el)}
                        </span>
                      </button>
                      {open && (
                        <div id={`dz-el-${key}`} className="designer__elementfields" role="group" aria-label={label}>
                          <div className="designer__grid">
                            <NumberField
                              id={`dz-${key}-indent`}
                              label="Indent"
                              unit="in"
                              value={el.indentFromMargin}
                              error={err(`elements.${key}.indentFromMargin`)}
                              onChange={(v) => set((e) => void (e.indentFromMargin = v))}
                              {...lock}
                            />
                            <NumberField
                              id={`dz-${key}-width`}
                              label="Width"
                              unit="in"
                              value={el.fullWidth ? "" : el.maxWidth}
                              placeholder={el.fullWidth ? "Full" : undefined}
                              disabled={el.fullWidth}
                              error={el.fullWidth ? undefined : err(`elements.${key}.maxWidth`)}
                              onChange={(v) => set((e) => void (e.maxWidth = v))}
                              {...lock}
                            />
                          </div>
                          <label className="designer__switchrow">
                            <span>Full width</span>
                            <Switch
                              on={el.fullWidth}
                              label={`${label}: full width`}
                              onChange={(on) =>
                                set((e) => {
                                  e.fullWidth = on;
                                  if (!on && !e.maxWidth) e.maxWidth = "3";
                                })
                              }
                            />
                          </label>
                          <div className="dfield">
                            <span className="dfield__label">Alignment</span>
                            <Segmented<ElementAlign>
                              size="small"
                              label={`${label} alignment`}
                              value={el.align}
                              options={[
                                { id: "left", label: "Left" },
                                { id: "center", label: "Center" },
                                { id: "right", label: "Right" },
                              ]}
                              onChange={(v) => set((e) => void (e.align = v))}
                            />
                          </div>
                          <label className="designer__switchrow">
                            <span>Capitals</span>
                            <Switch
                              on={el.textTransform === "uppercase"}
                              label={`${label}: capitals`}
                              onChange={(on) => set((e) => void (e.textTransform = on ? "uppercase" : "none"))}
                            />
                          </label>
                          <div className="designer__switchrow">
                            <span>Style</span>
                            <PopupButton<ElementFontStyle>
                              label={`${label} style`}
                              value={el.fontStyle}
                              options={FONT_STYLES}
                              onChange={(v) => set((e) => void (e.fontStyle = v))}
                            />
                          </div>
                          <div className="designer__grid">
                            <NumberField
                              id={`dz-${key}-before`}
                              label="Space before"
                              unit="lines"
                              value={el.spacingBefore}
                              error={err(`elements.${key}.spacingBefore`)}
                              onChange={(v) => set((e) => void (e.spacingBefore = v))}
                              {...lock}
                            />
                            <NumberField
                              id={`dz-${key}-after`}
                              label="Space after"
                              unit="lines"
                              value={el.spacingAfter}
                              error={err(`elements.${key}.spacingAfter`)}
                              onChange={(v) => set((e) => void (e.spacingAfter = v))}
                              {...lock}
                            />
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="designer__group" aria-labelledby="dz-breaks">
              <h3 id="dz-breaks" className="seclabel">
                Page breaks
              </h3>
              <TextField
                id="dz-contd"
                label="Continued marker"
                value={draft.pagination.continuedMarker}
                error={err("pagination.continuedMarker")}
                hint="Added after the character name when a speech continues on the next page."
                onChange={(v) =>
                  edit((d) => {
                    d.pagination.continuedMarker = v;
                  })
                }
                {...lock}
              />
              <label className="designer__switchrow">
                <span>Repeat the character name on the next page</span>
                <Switch
                  on={draft.pagination.repeatCharacterOnSplit}
                  label="Repeat the character name on the next page"
                  onChange={(on) =>
                    edit((d) => {
                      d.pagination.repeatCharacterOnSplit = on;
                    })
                  }
                />
              </label>
              <p className="designer__note">
                The fewest lines of a speech or of action that a page break can leave on either side.
              </p>
              <div className="designer__grid">
                <NumberField
                  id="dz-min-before"
                  label="Dialogue before a break"
                  unit="lines"
                  value={draft.pagination.minDialogueLinesBeforeBreak}
                  error={err("pagination.minDialogueLinesBeforeBreak")}
                  onChange={(v) =>
                    edit((d) => {
                      d.pagination.minDialogueLinesBeforeBreak = v;
                    })
                  }
                  {...lock}
                />
                <NumberField
                  id="dz-min-after"
                  label="Dialogue after a break"
                  unit="lines"
                  value={draft.pagination.minDialogueLinesAfterBreak}
                  error={err("pagination.minDialogueLinesAfterBreak")}
                  onChange={(v) =>
                    edit((d) => {
                      d.pagination.minDialogueLinesAfterBreak = v;
                    })
                  }
                  {...lock}
                />
                <NumberField
                  id="dz-min-action"
                  label="Action on each side"
                  unit="lines"
                  value={draft.pagination.minActionLinesEitherSide}
                  error={err("pagination.minActionLinesEitherSide")}
                  onChange={(v) =>
                    edit((d) => {
                      d.pagination.minActionLinesEitherSide = v;
                    })
                  }
                  {...lock}
                />
              </div>
            </section>

            <section className="designer__group" aria-labelledby="dz-dual">
              <h3 id="dz-dual" className="seclabel">
                Dual dialogue
              </h3>
              <NumberField
                id="dz-gutter"
                label="Gap between the two speeches"
                unit="in"
                value={draft.dualDialogue.gutterIn}
                error={err("dualDialogue.gutterIn")}
                onChange={(v) =>
                  edit((d) => {
                    d.dualDialogue.gutterIn = v;
                  })
                }
                {...lock}
              />
            </section>
          </div>

          <div className="designer__right">
            <div className="designer__previewbar">
              <span className="designer__previewtitle">
                {source.key === "play" ? props.play?.title : "Format sampler"} ·{" "}
                {layout.pages.length} {layout.pages.length === 1 ? "page" : "pages"}
              </span>
              {!check.spec && <span className="chip chip--warn">Showing last valid values</span>}
              <span className="sheet__spacer" />
              {props.play && playDoc && (
                <label className="designer__switchrow designer__switchrow--inline">
                  <span>Preview with This Play</span>
                  <Switch on={previewPlay} label="Preview with This Play" onChange={setPreviewPlay} />
                </label>
              )}
            </div>
            <DesignerPreview layout={layout} spec={previewSpec} moved={moves.lines} source={source.label} />
          </div>
        </div>
      </Sheet>

      {prompt === "duplicate" && (
        <Alert
          title={`“${draft.name}” is built in`}
          body="Built-in formats can’t be changed. Duplicate it to make a copy you can edit."
          confirmLabel="Duplicate"
          onConfirm={duplicate}
          onCancel={() => setPrompt(null)}
        />
      )}
      {prompt === "close" && (
        <Alert
          title={`Discard your changes to “${draft.name.trim() || "Untitled Format"}”?`}
          body={`You changed ${listInWords(changedParts(saved.draft, draft))}. ${
            saved.fileName ? "The saved format stays as it was." : "The format has never been saved, so none of it will be kept."
          }`}
          confirmLabel="Discard Changes"
          cancelLabel="Keep Editing"
          destructive
          onConfirm={props.onClose}
          onCancel={() => setPrompt(null)}
        />
      )}
    </>
  );
}
