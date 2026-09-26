// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The controls (docs/engineering/design-system.md#UI-D106). Regular 28 · small 22 · mini 20.
 *
 * Fourteen bespoke button classes — `binder__iconbtn`, `fmt__btn`,
 * `viewswitch__btn`, `findbar__btn`, `exportpanel__pagerbtn`,
 * `zoomctl__step`, `playrow__newbtn` and the rest — over 61 `cursor: pointer`
 * sites, become one `.btn` with four treatments and one `.iconbtn`. The CSS is
 * in styles.css under "Controls"; these are the components that name them.
 */
import { forwardRef, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { ChevronDownIcon, CheckIcon, UpDownIcon } from "./Icons";
import { Menu, useMenu, type MenuEntry } from "./Menu";

type Size = "regular" | "small" | "mini";
type Treatment = "default" | "primary" | "borderless" | "destructive";

const SIZE_CLASS: Record<Size, string> = {
  regular: "",
  small: " btn--small",
  mini: " btn--mini",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  treatment?: Treatment;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { treatment = "default", size = "regular", className, type = "button", ...rest },
  ref,
) {
  const t = treatment === "default" ? "" : ` btn--${treatment}`;
  return (
    <button
      ref={ref}
      type={type}
      className={`btn${t}${SIZE_CLASS[size]}${className ? ` ${className}` : ""}`}
      {...rest}
    />
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: an icon is never the only carrier of what a control does. */
  label: string;
  size?: Size;
  on?: boolean;
  /** A toggle that says "this panel is showing" rather than "this value is set". */
  neutral?: boolean;
}

/* Forwards its ref for the same reason `Button` does: a control that opens a
   menu has to hand the menu something to anchor to. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = "regular", on, neutral, className, type = "button", children, ...rest },
  ref,
) {
  const sz = size === "regular" ? "" : ` iconbtn--${size}`;
  const state = on ? (neutral ? " is-on is-on--neutral" : " is-on") : "";
  return (
    <button
      ref={ref}
      type={type}
      className={`iconbtn${sz}${state}${className ? ` ${className}` : ""}`}
      aria-label={label}
      title={rest.title ?? label}
      aria-pressed={on === undefined ? undefined : on}
      {...rest}
    >
      {children}
    </button>
  );
});

/* ── Segmented control ─────────────────────────────────────────────────── */

export interface SegmentedOption<T extends string> {
  id: T;
  label: ReactNode;
  /** A count badge, as Changes carries when something is pending. */
  badge?: number;
  title?: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "regular",
  tight,
  label,
}: {
  options: SegmentedOption<T>[];
  /** `null` when nothing in the set is showing — every segment reads as off. */
  value: T | null;
  onChange: (id: T) => void;
  size?: "regular" | "small";
  tight?: boolean;
  label?: string;
}) {
  /* One Tab stop for the set, arrows within it — the tab-list pattern every
     screen reader expects of a `tablist`. Five separate Tab stops made the
     toolbar a corridor, and ← → did nothing. Arrows MOVE focus; Space or ⏎
     switches, because switching the script to the board is a whole surface,
     not a preview to flick through. */
  const rovingIndex = Math.max(
    0,
    options.findIndex((o) => o.id === value),
  );
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(e.key)) return;
    const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>(".seg__btn")];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    const n = buttons.length;
    const to =
      e.key === "Home" ? 0 : e.key === "End" ? n - 1 : (at + (e.key === "ArrowLeft" ? -1 : 1) + n) % n;
    buttons[to]?.focus();
  };
  return (
    <div
      className={`seg${size === "small" ? " seg--small" : ""}${tight ? " seg--tight" : ""}`}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {options.map((o, i) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={o.id === value}
          tabIndex={i === rovingIndex ? 0 : -1}
          title={o.title}
          aria-label={
            o.badge && typeof o.label === "string" ? `${o.label}, ${o.badge} pending` : undefined
          }
          className={`seg__btn${o.id === value ? " is-on" : ""}`}
          data-seg={o.id}
          onClick={() => onChange(o.id)}
        >
          {o.label}
          {o.badge ? (
            <span className="badge" aria-hidden="true">
              {o.badge}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/* ── Switch, checkbox, radio ───────────────────────────────────────────── */

export function Switch({
  on,
  onChange,
  label,
  mini,
  disabled,
  describedBy,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  label: string;
  mini?: boolean;
  disabled?: boolean;
  /** The id of the sentence saying what the switch does — and what off means. */
  describedBy?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      className={`switch${mini ? " switch--mini" : ""}${on ? " is-on" : ""}`}
      onClick={() => onChange(!on)}
    >
      <span className="switch__knob" />
    </button>
  );
}

export function Checkbox({
  on,
  onChange,
  label,
  disabled,
  describedBy,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  label: string;
  disabled?: boolean;
  describedBy?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      className={`checkbox${on ? " is-on" : ""}`}
      onClick={() => onChange(!on)}
    >
      {on ? <CheckIcon size={9} /> : null}
    </button>
  );
}

export function Radio({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      aria-label={label}
      className={`radio${on ? " is-on" : ""}`}
      onClick={onChange}
    />
  );
}

/* ── Popup button — the replacement for every native <select> ───────────── */

export interface PopupOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Trailing hint, e.g. the access menu's "no edits / script gated". */
  hint?: string;
  disabled?: boolean;
  /** Groups render as a section header above the first option carrying it. */
  section?: string;
  text?: string;
}

export function PopupButton<T extends string>({
  options,
  value,
  onChange,
  label,
  size = "small",
  flat,
  width,
  menuWidth,
  disabled,
  className,
  title,
  menuId,
}: {
  options: PopupOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  /** Names each row `<menuId>:<value>`, for the guide to point at (docs/app/preferences-and-help/tutorials.md#TUT-D9). */
  menuId?: string;
  size?: "small" | "mini";
  /** Borderless: text plus a chevron, for harness rows and inspector headers. */
  flat?: boolean;
  width?: number;
  menuWidth?: number;
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const menu = useMenu();
  const current = options.find((o) => o.value === value);

  const entries: MenuEntry[] = [];
  let section: string | undefined;
  for (const o of options) {
    if (o.section && o.section !== section) {
      section = o.section;
      entries.push({ kind: "section", label: o.section });
    }
    entries.push({
      id: menuId ? `${menuId}:${o.value}` : undefined,
      label: o.label,
      text: o.text ?? (typeof o.label === "string" ? o.label : undefined),
      checked: o.value === value,
      radio: true,
      hint: o.hint,
      disabled: o.disabled,
      onSelect: () => onChange(o.value),
    });
  }
  const currentText =
    current?.text ?? (typeof current?.label === "string" ? current.label : undefined);

  return (
    <>
      {/* The name says what the control is AND what it is set to: `aria-label`
          alone replaced the visible value, so VoiceOver said "What to export,
          pop-up button" and never which part was chosen. */}
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        aria-label={currentText ? `${label}: ${currentText}` : label}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        title={title}
        style={width ? { width } : undefined}
        className={`popupbtn${size === "mini" ? " popupbtn--mini" : ""}${
          flat ? " popupbtn--flat" : ""
        }${className ? ` ${className}` : ""}`}
        onClick={() => menu.openFrom(ref.current)}
        onKeyDown={(e) => {
          // ↓ and ↑ open a popup, as they do a native one.
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            menu.openFrom(ref.current);
          }
        }}
      >
        <span className="popupbtn__label">{current?.label ?? ""}</span>
        <span className="popupbtn__badge" aria-hidden="true">
          {flat ? <ChevronDownIcon size={8} /> : <UpDownIcon size={9} />}
        </span>
      </button>
      {menu.anchor && (
        <Menu
          anchor={menu.anchor}
          entries={entries}
          onClose={menu.close}
          width={menuWidth ?? 186}
          label={label}
          start="checked"
        />
      )}
    </>
  );
}

/* ── Pull-down button: an action plus a menu of related ones ────────────── */

export function PullDownButton({
  label,
  entries,
  treatment = "default",
  size = "regular",
  menuWidth,
  onPrimary,
  disabled,
  align,
}: {
  label: ReactNode;
  entries: MenuEntry[];
  treatment?: Treatment;
  size?: Size;
  menuWidth?: number;
  /** When given, the label half acts and only the chevron opens the menu. */
  onPrimary?: () => void;
  disabled?: boolean;
  align?: "start" | "end";
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const menu = useMenu();
  return (
    <>
      <Button
        ref={ref}
        treatment={treatment}
        size={size}
        disabled={disabled}
        className="btn--pulldown"
        aria-haspopup="menu"
        aria-expanded={menu.open}
        onClick={() => (onPrimary ? onPrimary() : menu.openFrom(ref.current, align))}
        onKeyDown={(e) => {
          /* With a primary action, the chevron half was a mouse-only target:
             Space and ⏎ run the action, so the menu had no key at all. ↓
             opens it, as it does on a native pull-down. */
          if (e.key === "ArrowDown") {
            e.preventDefault();
            menu.openFrom(ref.current, align);
          }
        }}
      >
        {label}
        <span
          className="btn__divider"
          onClick={(e) => {
            e.stopPropagation();
            menu.openFrom(ref.current, align);
          }}
        />
        <ChevronDownIcon size={9} />
      </Button>
      {menu.anchor && (
        <Menu anchor={menu.anchor} entries={entries} onClose={menu.close} width={menuWidth} />
      )}
    </>
  );
}

/* ── Chips, capsules, badges, meters ───────────────────────────────────── */

export function Chip({
  kind,
  dot,
  tiny,
  children,
  title,
}: {
  kind?: "warn" | "ok" | "bad";
  dot?: boolean;
  tiny?: boolean;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      className={`chip${kind ? ` chip--${kind}` : ""}${tiny ? " chip--tiny" : ""}`}
      title={title}
    >
      {dot ? <span className="chip__dot" /> : null}
      {children}
    </span>
  );
}

export function Capsule({
  kind,
  children,
  title,
}: {
  kind?: "author" | "todo" | "cast" | "dashed";
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className={`capsule${kind ? ` capsule--${kind}` : ""}`} title={title}>
      {children}
    </span>
  );
}

export function Meter({ value, width = 44 }: { value: number; width?: number }) {
  return (
    <span className="meter" style={{ width }}>
      <span
        className="meter__fill"
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
      />
    </span>
  );
}
