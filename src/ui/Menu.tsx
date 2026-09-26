// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ONE menu anatomy, for every menu, popup and popover in the app.
 *
 * The audit counted eight floating chromes — `binder__menu` at 6px/0 6px 20px,
 * `binder__ctx` at 7px/0 10px 30px, `formatmenu__pop` at 8px, `pane__addmenu`
 * at 4px, `fmpanel` at 10px, `toast` at 6px — with four different radii, four
 * shadows and three item heights, because every menu invented its own. This
 * replaces all of them, plus every native `<select>` (twelve sites), the leader
 * menu, the cue autocomplete, the spell menu and the composer popup.
 *
 * The shape is macOS's: a 24px row on a 16px check column, the label, and a
 * trailing cell for a shortcut or a submenu chevron. Labels never wrap — a menu
 * gets wider instead. Nothing animates open or closed: a menu you wait for is a
 * menu that is in the way, and the writer opens these mid-sentence.
 *
 * **The highlight is DOM focus.** It used to be a class on a row while focus sat
 * on the menu box, so arrows moved a colour VoiceOver could not see: it read
 * "menu" and then nothing, whichever row was lit. Now the lit row is the focused
 * row, so every screen reader, Voice Control and Switch Control follows it for
 * free. A menu that carries a text field (Go to Scene) is the exception — the
 * field keeps focus so typing goes into it, and names the lit row with
 * `aria-activedescendant` instead.
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { CheckIcon, ChevronRightIcon } from "./Icons";
import { registerLayer, useFocusReturn, useLayer } from "./layers";
import { portalHost } from "./portal-host";

let caretPopupId = 0;

/** Shared activation and owner contract for the non-React editor popups.
 * Suggestions retain the editor's caret; command menus move real focus to rows.
 * Both activate on click (including assistive-technology synthetic clicks).
 */
export function bindCaretPopup(popup: HTMLElement, owner: HTMLElement, select: (row: HTMLElement) => void) {
  popup.id = `caret-popup-${++caretPopupId}`;
  const down = (event: MouseEvent) => event.preventDefault();
  const click = (event: MouseEvent) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>("[role='option'], [role='menuitem']");
    if (row && popup.contains(row)) select(row);
  };
  popup.addEventListener("mousedown", down);
  popup.addEventListener("click", click);
  return {
    link(activeId?: string) {
      owner.setAttribute("aria-controls", popup.id);
      owner.setAttribute("aria-haspopup", popup.getAttribute("role") ?? "listbox");
      if (activeId) {
        owner.setAttribute("aria-autocomplete", "list");
        owner.setAttribute("aria-activedescendant", activeId);
      }
    },
    unlink() {
      if (owner.getAttribute("aria-controls") !== popup.id) return;
      for (const name of ["aria-controls", "aria-haspopup", "aria-autocomplete", "aria-activedescendant"]) owner.removeAttribute(name);
    },
    destroy() {
      this.unlink();
      popup.removeEventListener("mousedown", down);
      popup.removeEventListener("click", click);
    },
  };
}

/**
 * A caret command menu uses the regular menu's layer and real-focus model.
 * `initial` is the row it opens on. Enter with a modifier is not a choice: the
 * script behind it keeps Shift+Enter and ⌘Enter, so those go to `fallback`.
 */
export function openCaretMenu(popup: HTMLElement, owner: HTMLElement, close: () => void,
  fallback: (event: KeyboardEvent) => void, initial = 0) {
  const layer = registerLayer();
  const rows = () => [...popup.querySelectorAll<HTMLElement>("[role='menuitem']")];
  const focus = (index: number) => {
    const items = rows();
    items.forEach((row, i) => { row.tabIndex = i === index ? 0 : -1; });
    items[index]?.focus({ preventScroll: true });
    items[index]?.scrollIntoView({ block: "nearest" });
  };
  const onKey = (event: KeyboardEvent) => {
    if (!layer.isTop() || event.isComposing) return;
    const items = rows();
    const index = Math.max(0, items.indexOf(document.activeElement as HTMLElement));
    const key = event.key;
    const modified = event.shiftKey || event.metaKey || event.ctrlKey || event.altKey;
    if (key === "Enter" && modified) {
      // Never a click on the focused row, whether or not the script takes it.
      event.preventDefault();
      event.stopPropagation();
      fallback(event);
    } else if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", " ", "Escape", "Tab"].includes(key)) {
      event.preventDefault();
      event.stopPropagation();
      if (key === "Escape" || key === "Tab") { owner.focus({ preventScroll: true }); close(); }
      else if (key === "Enter" || key === " ") items[index]?.click();
      else focus(key === "Home" ? 0 : key === "End" ? items.length - 1 : (index + (key === "ArrowDown" ? 1 : -1) + items.length) % items.length);
    } else if (key === "ArrowLeft" || key === "ArrowRight") {
      event.preventDefault(); // no submenu; keep the pending leader intact
    } else fallback(event);
  };
  const outside = (event: MouseEvent) => {
    if (layer.isTop() && !popup.contains(event.target as Node)) close();
  };
  window.addEventListener("keydown", onKey, true);
  document.addEventListener("mousedown", outside, true);
  focus(initial);
  return () => {
    layer.close();
    window.removeEventListener("keydown", onKey, true);
    document.removeEventListener("mousedown", outside, true);
  };
}

const GAP = 4;

export interface MenuAction {
  kind?: "item";
  /** Stable id, so a caller can drive the highlight from outside. */
  id?: string;
  label: ReactNode;
  /** Shown in the 16px check column. */
  checked?: boolean;
  /** Trailing cell: a keyboard shortcut, or a plain hint in --ash. */
  shortcut?: string;
  hint?: string;
  disabled?: boolean;
  destructive?: boolean;
  submenu?: MenuEntry[];
  onSelect?: () => void;
  /** Type-select and keyboard matching use this when `label` is not a string. */
  text?: string;
  /** One choice among its siblings (a popup button's values), not a toggle of its own. */
  radio?: boolean;
}

export type MenuEntry =
  | MenuAction
  | { kind: "section"; label: string }
  | { kind: "sep" }
  | { kind: "hint"; label: ReactNode }
  | { kind: "custom"; render: () => ReactNode };

export type MenuAnchor =
  | { kind: "point"; x: number; y: number }
  | { kind: "rect"; rect: DOMRect; align?: "start" | "end"; side?: "bottom" | "top" };

export interface MenuProps {
  anchor: MenuAnchor;
  entries: MenuEntry[];
  onClose: () => void;
  /** Min width in px — docs/engineering/design-system.md#UI-D107 lists one per menu (document 248, context 210…). */
  width?: number;
  /** Only a popover that belongs to a CONTROL gets an arrow (the zoom popover). */
  arrow?: boolean;
  label?: string;
  className?: string;
  /** A search field owns a sibling listbox, rather than a menu of commands. */
  search?: { value: string; onChange(value: string): void; label: string; className?: string };
  /**
   * Where the highlight starts. A pull-down starts on its first row; a popup
   * button starts on the value it shows, as macOS's does — so the first thing
   * a screen reader says is what is already chosen.
   */
  start?: "first" | "checked";
  /** A submenu: ← hands the keyboard back to the row that opened it. */
  onBack?: () => void;
  /**
   * A submenu the POINTER opened. It shows, but the parent keeps the keyboard
   * until → asks for it — hovering past a row must not pull focus sideways.
   */
  passive?: boolean;
  /** A submenu hands focus back to where the WHOLE menu came from, not to its row. */
  returnFocus?: () => void;
}

function isAction(e: MenuEntry | undefined): e is MenuAction {
  // `entries[cursor]` with no row to light is undefined: a filter that matches nothing, then Enter.
  return e !== undefined && (!("kind" in e) || e.kind === "item");
}

function entryText(e: MenuAction): string {
  return e.text ?? (typeof e.label === "string" ? e.label : "");
}

function firstRow(entries: MenuEntry[], start: "first" | "checked"): number {
  if (start === "checked") {
    const i = entries.findIndex((e) => isAction(e) && !e.disabled && e.checked);
    if (i >= 0) return i;
  }
  return entries.findIndex((e) => isAction(e) && !e.disabled);
}

export function Menu({
  anchor,
  entries,
  onClose,
  width,
  arrow,
  label,
  className,
  search,
  start = "first",
  onBack,
  passive,
  returnFocus,
}: MenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    /** Where the arrow points, from the menu's own left edge. */
    arrowX?: number;
    above?: boolean;
  } | null>(null);
  const [cursor, setCursor] = useState<number>(() => firstRow(entries, start));
  const [submenu, setSubmenu] = useState<
    { index: number; rect: DOMRect; keyboard: boolean } | null
  >(null);
  const typed = useRef({ buf: "", at: 0 });
  const menuId = useId();
  const rowId = (i: number) => {
    const entry = entries[i];
    return `${menuId}-row-${isAction(entry) ? entry.id ?? i : i}`;
  };
  const isTop = useLayer(!passive);
  const restoreOwn = useFocusReturn();
  const restoreFocus = returnFocus ?? restoreOwn;

  /* A menu whose rows change under the highlight (Go to Scene narrowing as you
     type) must not leave it on a row that is now a heading or gone. Only an
     INVALID highlight moves: most callers build `entries` inline, so a new
     array arrives on every render and a reset there would throw the writer's
     place back to the top each time the status bar ticked. */
  useEffect(() => {
    setCursor((cur) => {
      const e = entries[cur];
      return e && isAction(e) && !e.disabled ? cur : firstRow(entries, start);
    });
  }, [entries, start]);

  /* Placed after layout, from the element's real size: a menu that is measured
     from an estimate flickers, and one that is not clamped can open off-screen
     next to a row near the window edge. */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let top: number;
    let left: number;
    if (anchor.kind === "point") {
      top = anchor.y;
      left = anchor.x;
      if (top + h > window.innerHeight - GAP) top = Math.max(GAP, anchor.y - h);
      if (left + w > window.innerWidth - GAP) left = Math.max(GAP, anchor.x - w);
    } else {
      const r = anchor.rect;
      // An arrow needs its own height of clearance, or it lands on the control.
      const gap = arrow ? GAP + 6 : GAP;
      const below = r.bottom + gap;
      top = anchor.side === "top" || below + h > window.innerHeight - GAP
        ? Math.max(GAP, r.top - h - gap)
        : below;
      left = anchor.align === "end" ? r.right - w : r.left;
      left = Math.max(GAP, Math.min(left, window.innerWidth - w - GAP));
      if (arrow) {
        const x = Math.min(Math.max(r.left + r.width / 2 - left, 14), w - 14);
        setPos({ top: Math.round(top), left: Math.round(left), arrowX: Math.round(x), above: top < r.top });
        return;
      }
    }
    setPos({ top: Math.round(top), left: Math.round(left) });
  }, [anchor, arrow]);

  /*
   * Focus the lit row so arrows and type-select have somewhere to land — but do
   * NOT depend on it. The click that opened the menu focuses the trigger, and
   * on the first commit this element is still `visibility: hidden` while it
   * measures itself, which a browser refuses to focus. The keys are bound at
   * the WINDOW below for exactly that reason: a menu that will not close on
   * Escape because focus went somewhere unexpected is a menu that traps you.
   *
   * That same hidden first commit is why a text field in the menu never had
   * focus: its `autoFocus` ran while it was invisible, and then this effect put
   * focus on the box. Go to Scene opened, and the letters you typed went to
   * type-select instead of the filter. The field is focused HERE, once the
   * menu can take it.
   */
  useEffect(() => {
    if (!pos || passive || submenu?.keyboard) return;
    const el = ref.current;
    if (!el) return;
    const field = el.querySelector<HTMLElement>("input, textarea");
    if (field) {
      if (document.activeElement !== field) field.focus({ preventScroll: true });
      field.setAttribute("aria-controls", menuId);
      if (cursor >= 0) field.setAttribute("aria-activedescendant", rowId(cursor));
      else field.removeAttribute("aria-activedescendant");
      el.querySelector<HTMLElement>(`[data-i="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
      return;
    }
    const row = cursor >= 0 ? el.querySelector<HTMLElement>(`[data-i="${cursor}"]`) : null;
    (row ?? el).focus({ preventScroll: true });
    row?.scrollIntoView({ block: "nearest" });
  }, [pos, cursor, passive, submenu?.keyboard, menuId]);

  const move = useCallback(
    (delta: number) => {
      setCursor((cur) => {
        const n = entries.length;
        for (let step = 1; step <= n; step++) {
          const i = (cur + delta * step + n * 2) % n;
          const e = entries[i];
          if (isAction(e) && !e.disabled) return i;
        }
        return cur;
      });
    },
    [entries],
  );

  const choose = useCallback(
    (i: number) => {
      const e = entries[i];
      if (!e || !isAction(e) || e.disabled) return;
      if (e.submenu) return;
      /* Focus goes home BEFORE the action runs: an action that opens a sheet
         remembers the control the writer started from rather than this row,
         which is about to stop existing; an action that focuses the editor
         simply takes focus again afterwards. */
      restoreFocus();
      onClose();
      e.onSelect?.();
    },
    [entries, onClose, restoreFocus],
  );

  const openSubmenu = (i: number) => {
    const row = ref.current?.querySelector<HTMLElement>(`[data-i="${i}"]`);
    if (row) setSubmenu({ index: i, rect: row.getBoundingClientRect(), keyboard: true });
  };

  const onKey = (ev: KeyboardEvent) => {
    // A passive submenu never owns keys, and neither does a menu with a
    // submenu (or a sheet, or an alert) open above it.
    if (passive || !isTop()) return;
    const target = ev.target as HTMLElement | null;
    const inField = !!target?.closest?.("input, textarea") && !!ref.current?.contains(target);
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      onClose();
      return;
    }
    // A menu is not a place Tab can go: leave it, the way every native one does.
    if (ev.key === "Tab") {
      ev.preventDefault();
      onClose();
      return;
    }
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      move(1);
      return;
    }
    if (ev.key === "ArrowUp") {
      ev.preventDefault();
      move(-1);
      return;
    }
    if ((ev.key === "Home" || ev.key === "End") && !inField) {
      ev.preventDefault();
      const rows = entries.flatMap((e, i) => (isAction(e) && !e.disabled ? [i] : []));
      if (rows.length) setCursor(ev.key === "Home" ? rows[0] : rows[rows.length - 1]);
      return;
    }
    if (ev.key === "ArrowRight") {
      const e = entries[cursor];
      if (isAction(e) && e.submenu) {
        ev.preventDefault();
        openSubmenu(cursor);
      }
      return;
    }
    if (ev.key === "ArrowLeft") {
      if (onBack) {
        ev.preventDefault();
        onBack();
      } else if (submenu) {
        ev.preventDefault();
        setSubmenu(null);
      }
      return;
    }
    // Space belongs to a text field in the menu; it used to pick the lit row,
    // so "THE LEDGER" could not be typed into Go to Scene.
    if (ev.key === "Enter" || (ev.key === " " && !inField)) {
      if (ev.isComposing) return;
      ev.preventDefault();
      const e = entries[cursor];
      if (isAction(e) && e.submenu) openSubmenu(cursor);
      else choose(cursor);
      return;
    }
    if (inField) return;
    // Type-select, macOS's own: keystrokes inside a second compose a prefix.
    if (ev.key.length === 1 && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
      const now = Date.now();
      typed.current.buf = now - typed.current.at > 1000 ? ev.key : typed.current.buf + ev.key;
      typed.current.at = now;
      const q = typed.current.buf.toLowerCase();
      const i = entries.findIndex(
        (e) => isAction(e) && !e.disabled && entryText(e).toLowerCase().startsWith(q),
      );
      if (i >= 0) setCursor(i);
    }
  };

  /* Bound at the window, in the capture phase, so the menu owns the keyboard
     while it is up wherever focus happens to be — and so Escape reaches it
     before the surface underneath (a sheet, the editor) can act on it. */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  });

  const style: React.CSSProperties = {
    top: pos?.top ?? -9999,
    left: pos?.left ?? -9999,
    minWidth: width,
    visibility: pos ? "visible" : "hidden",
    ...(pos?.arrowX !== undefined ? { ["--arrow-x" as string]: `${pos.arrowX}px` } : null),
  };
  const arrowClass = arrow && pos?.arrowX !== undefined
    ? ` menu--arrow ${pos.above ? "menu--above" : "menu--below"}`
    : "";

  const renderedEntries = entries.map((e, i) => {
    if ("kind" in e && e.kind === "sep")
      return <div key={i} className="menu__sep" role="separator" />;
    if ("kind" in e && e.kind === "section")
      return (
        <div key={i} className="menu__section" role="presentation">
          {e.label}
        </div>
      );
    if ("kind" in e && e.kind === "hint")
      return (
        <div key={i} className="menu__hint" role="presentation">
          {e.label}
        </div>
      );
    if ("kind" in e && e.kind === "custom")
      return (
        <div key={i} role="presentation">
          {e.render()}
        </div>
      );
    const a = e as MenuAction;
    const role = search ? "option" : a.radio
      ? "menuitemradio"
      : a.checked === undefined
        ? "menuitem"
        : "menuitemcheckbox";
    // The shortcut stays in the row's name: VoiceOver reads a native
    // menu row as "All Plays, command shift O", and so does this one.
    const trail = a.submenu ? undefined : (a.shortcut ?? a.hint);
    return (
      <button
        key={a.id ?? i}
        id={rowId(i)}
        type="button"
        data-i={i}
        data-menu-id={a.id}
        role={role}
        tabIndex={!search && i === cursor && !a.disabled ? 0 : -1}
        aria-checked={role === "menuitemradio" || role === "menuitemcheckbox" ? !!a.checked : undefined}
        aria-selected={search ? i === cursor : undefined}
        aria-haspopup={a.submenu ? "menu" : undefined}
        aria-expanded={a.submenu ? submenu?.index === i : undefined}
        disabled={a.disabled}
        className={`menu__item${i === cursor ? " is-cursor" : ""}${
          a.destructive ? " menu__item--destructive" : ""
        }`}
        onMouseEnter={(ev) => {
          setCursor(i);
          setSubmenu(
            a.submenu
              ? { index: i, rect: ev.currentTarget.getBoundingClientRect(), keyboard: false }
              : null,
          );
        }}
        onClick={() => (a.submenu ? openSubmenu(i) : choose(i))}
      >
        <span className="menu__check" aria-hidden="true">
          {a.checked ? <CheckIcon /> : null}
        </span>
        <span className="menu__label">{a.label}</span>
        <span className="menu__trail">
          {a.submenu ? <ChevronRightIcon size={7} /> : (trail ?? "")}
        </span>
      </button>
    );
  });

  return createPortal(
    <>
      <button
        type="button"
        className="menu-scrim"
        aria-hidden="true"
        tabIndex={-1}
        onMouseDown={(e) => {
          e.preventDefault();
          onClose();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        ref={ref}
        id={search ? undefined : menuId}
        className={`menu${arrowClass}${className ? ` ${className}` : ""}`}
        role={search ? undefined : "menu"}
        aria-label={search ? undefined : label}
        tabIndex={-1}
        style={style}
      >
        {search && <input className={`field${search.className ? ` ${search.className}` : ""}`}
          role="combobox" aria-expanded="true" aria-autocomplete="list" aria-haspopup="listbox"
          aria-label={search.label} placeholder={search.label} value={search.value}
          aria-controls={menuId} aria-activedescendant={cursor >= 0 ? rowId(cursor) : undefined}
          onChange={(e) => search.onChange(e.target.value)} />}
        {search ? <div className="menu__results" role="listbox" id={menuId} aria-label={label}>{renderedEntries}</div> : renderedEntries}
        {arrow && <div className="menu__arrow" aria-hidden="true" />}
      </div>
      {submenu &&
        (() => {
          const parent = entries[submenu.index];
          if (!isAction(parent) || !parent.submenu) return null;
          /* Opens to the right, top-aligned with its row and overlapping the
             parent's edge — macOS's own geometry, so the pointer can cross
             into it without falling off the row that opened it. */
          const r = submenu.rect;
          return (
            <Menu
              anchor={{
                kind: "point",
                x: r.right - 15,
                y: r.top - 5,
              }}
              entries={parent.submenu}
              onClose={onClose}
              width={190}
              label={entryText(parent) || undefined}
              passive={!submenu.keyboard}
              onBack={() => setSubmenu(null)}
              returnFocus={restoreFocus}
            />
          );
        })()}
    </>,
    portalHost(),
  );
}

/**
 * The open/closed state and the anchor, for the common case: a control that
 * opens its own menu. Returns the props a trigger needs and the menu to render.
 */
export function useMenu() {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const openFrom = useCallback(
    (el: HTMLElement | null, align?: "start" | "end", side?: "bottom" | "top") => {
      if (!el) return;
      setAnchor({ kind: "rect", rect: el.getBoundingClientRect(), align, side });
    },
    [],
  );
  const openAt = useCallback((x: number, y: number) => {
    setAnchor({ kind: "point", x, y });
  }, []);
  const close = useCallback(() => setAnchor(null), []);
  return { anchor, open: !!anchor, openFrom, openAt, close };
}
