// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The designer's fields. Every one has a visible label and, where it measures
 * something, a visible unit that is also part of its name — "Left, inches" —
 * so VoiceOver says what a number means and Voice Control can find it by the
 * words on screen (docs/app/preferences-and-help/accessibility.md#UI-D108).
 *
 * A field's problem is spoken from a region that exists before there is a
 * problem: a live region that mounts already full is not read by WebKit.
 *
 * On a built-in format every field is read-only, and trying to change one asks
 * to duplicate the format instead (`onLockedEdit`).
 */
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { HEADER_TOKENS, type HeaderToken } from "../../format";
import { Menu, useMenu } from "../../ui";

/** A key that would change a text field's value. */
function isEditKey(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  return e.key.length === 1 || e.key === "Backspace" || e.key === "Delete" || e.key === "Enter";
}

export interface Locked {
  /** Read-only: a built-in format. */
  locked: boolean;
  /** Called instead of an edit while locked. */
  onLockedEdit: () => void;
}

function Problem({ id, error }: { id: string; error: string | undefined }) {
  return (
    <p id={id} className="dfield__error" aria-live="polite">
      {error ?? ""}
    </p>
  );
}

export function TextField(
  props: {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    error?: string;
    hint?: ReactNode;
    wide?: boolean;
    autoFocus?: boolean;
    inputRef?: React.Ref<HTMLInputElement>;
  } & Locked,
) {
  const errId = `${props.id}-error`;
  return (
    <div className={`dfield${props.wide ? " dfield--wide" : ""}`}>
      <label className="dfield__label" htmlFor={props.id}>
        {props.label}
      </label>
      <input
        id={props.id}
        ref={props.inputRef}
        className={`field dfield__input${props.error ? " is-invalid" : ""}`}
        value={props.value}
        readOnly={props.locked}
        autoFocus={props.autoFocus}
        spellCheck={false}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={errId}
        onKeyDown={(e) => {
          if (props.locked && isEditKey(e)) {
            e.preventDefault();
            props.onLockedEdit();
          }
        }}
        onChange={(e) => props.onChange(e.target.value)}
      />
      {props.hint && <p className="dfield__hint">{props.hint}</p>}
      <Problem id={errId} error={props.error} />
    </div>
  );
}

const UNIT_WORDS: Record<string, string> = {
  in: "inches",
  pt: "points",
  lines: "lines",
  "×": "times the type size",
};

export function NumberField(
  props: {
    id: string;
    label: string;
    unit: "in" | "pt" | "lines" | "×";
    value: string;
    onChange: (value: string) => void;
    error?: string;
    disabled?: boolean;
    /** Said in the field while it is empty — "Full" for a width that has no cap. */
    placeholder?: string;
  } & Locked,
) {
  const errId = `${props.id}-error`;
  return (
    <div className="dfield">
      <label className="dfield__label" htmlFor={props.id}>
        {props.label}
        <span className="sr-only">, {UNIT_WORDS[props.unit]}</span>
      </label>
      <span className="dfield__number">
        <input
          id={props.id}
          className={`field dfield__input dfield__input--number${props.error ? " is-invalid" : ""}`}
          value={props.value}
          placeholder={props.placeholder}
          inputMode="decimal"
          readOnly={props.locked}
          disabled={props.disabled}
          spellCheck={false}
          aria-invalid={props.error ? true : undefined}
          aria-describedby={errId}
          onKeyDown={(e) => {
            if (props.locked && isEditKey(e)) {
              e.preventDefault();
              props.onLockedEdit();
            }
          }}
          onChange={(e) => props.onChange(e.target.value)}
        />
        <span className="dfield__unit" aria-hidden="true">
          {props.unit}
        </span>
      </span>
      <Problem id={errId} error={props.error} />
    </div>
  );
}

const TOKEN_LABELS: Record<HeaderToken, string> = {
  page: "Page Number",
  actNumber: "Act Number",
  actRoman: "Act Number in Roman",
  sceneNumber: "Scene Number",
  title: "Title",
  author: "Author",
  draftDate: "Draft Date",
  act: "Act as Written",
  scene: "Scene as Written",
};

/**
 * Act-scene-page numbering whole, the way a writer asks for it
 * (docs/app/formatting/formats-and-layout.md#FMT-139). Each part is still an
 * ordinary token in the slot, so it can be edited like any other text.
 */
const ACT_SCENE_PAGE = [
  { example: "II-3-67", act: "Roman act", template: "{actRoman}-{sceneNumber}-{page}" },
  { example: "2-3-67", act: "Numbered act", template: "{actNumber}-{sceneNumber}-{page}" },
] as const;

/**
 * One header or footer slot: text, and the tokens offered from a menu rather
 * than typed from memory. A token goes in at the caret, and the caret lands
 * after it.
 */
export function SlotField(
  props: {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    error?: string;
  } & Locked,
) {
  const input = useRef<HTMLInputElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const menu = useMenu();
  const errId = `${props.id}-error`;

  const insert = (text: string) => {
    if (props.locked) return props.onLockedEdit();
    const el = input.current;
    const at = el?.selectionStart ?? props.value.length;
    const end = el?.selectionEnd ?? at;
    props.onChange(props.value.slice(0, at) + text + props.value.slice(end));
    // After the menu has handed focus back to Insert: a task, not a frame —
    // a frame never comes in a window that is not being painted.
    setTimeout(() => {
      el?.focus();
      el?.setSelectionRange(at + text.length, at + text.length);
    }, 0);
  };

  return (
    <div className="dfield">
      <label className="dfield__label" htmlFor={props.id}>
        {props.label}
      </label>
      <span className="dfield__slot">
        <input
          id={props.id}
          ref={input}
          className={`field dfield__input${props.error ? " is-invalid" : ""}`}
          value={props.value}
          readOnly={props.locked}
          spellCheck={false}
          aria-invalid={props.error ? true : undefined}
          aria-describedby={errId}
          onKeyDown={(e) => {
            if (props.locked && isEditKey(e)) {
              e.preventDefault();
              props.onLockedEdit();
            }
          }}
          onChange={(e) => props.onChange(e.target.value)}
        />
        <button
          ref={trigger}
          type="button"
          className="btn btn--small"
          aria-haspopup="menu"
          aria-expanded={menu.open}
          aria-label={`Insert into ${props.label}`}
          onClick={() => (props.locked ? props.onLockedEdit() : menu.openFrom(trigger.current, "end"))}
        >
          Insert
        </button>
      </span>
      {menu.anchor && (
        <Menu
          anchor={menu.anchor}
          onClose={menu.close}
          label={`Insert into ${props.label}`}
          width={280}
          entries={[
            ...HEADER_TOKENS.map((token) => ({
              label: TOKEN_LABELS[token],
              hint: `{${token}}`,
              onSelect: () => insert(`{${token}}`),
            })),
            { kind: "section" as const, label: "Act, scene and page" },
            ...ACT_SCENE_PAGE.map(({ example, act, template }) => ({
              label: example,
              hint: act,
              onSelect: () => insert(template),
            })),
          ]}
        />
      )}
      <Problem id={errId} error={props.error} />
    </div>
  );
}
