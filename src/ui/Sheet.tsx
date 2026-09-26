// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Sheets and alerts (docs/app/preferences-and-help/accessibility.md#A11Y-5 — one anatomy, and docs/app/preferences-and-help/accessibility.md#A11Y-5; the
 * rationale below is the design's, kept here where it is read).
 *
 * A **sheet** attaches under the toolbar, centred, and drops in 200ms — macOS's
 * document-sheet position and the one animation kept, because that drop is what
 * a Mac user reads as "this is modal". Esc cancels; ⏎ triggers the default.
 *
 * An **alert** is centred, 270px, and is used ONLY where the action rewrites the
 * script — Restore and Revert — or loses words nothing can bring back: Quit
 * Anyway, whose alert makes Don't Quit the default. Move to Trash gets a toast
 * instead — Finder's rule is that a recoverable action is not confirmed, and
 * the app already trashes to the OS, so a `confirm()` there was friction with
 * no safety.
 */
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AppMarkIcon } from "./Icons";
import { Button } from "./controls";
import { keyOwnedByTarget, tabbables, useFocusReturn, useLayer } from "./layers";
import { ensureAnnouncer } from "./announce";

/**
 * Esc closes, ⏎ runs the default, and focus stays inside the panel while it is
 * up. The comment used to promise that last part and nothing did it: Tab walked
 * straight out of the sheet into the binder behind the scrim.
 *
 * ⏎ runs the default only when the key was not pressed ON a control. It used to
 * run it everywhere but a textarea, so ⏎ with focus on Cancel saved the Title
 * Page, and ⏎ on Cancel in the Restore alert restored — the one place in the
 * app where a keyboard press could rewrite the script against its own label.
 */
function useModalKeys(onClose: () => void, onDefault?: () => void, onCommandEnter?: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  const isTop = useLayer();
  useFocusReturn();
  // Callers pass fresh closures every render; the listeners read the latest
  // through a ref instead of being torn down and re-bound on each keystroke.
  const handlers = useRef({ onClose, onDefault, onCommandEnter });
  handlers.current = { onClose, onDefault, onCommandEnter };

  useLayoutEffect(() => {
    const host = ref.current?.querySelector<HTMLElement>("[data-modal-portal]");
    if (host) ensureAnnouncer(host);
  }, []);

  /* A field that asked for focus keeps it. The panel used to take focus in an
     effect that re-ran on every render, after the child's `autoFocus` — so the
     Title Page opened with its Title field skipped. Once, on mount, and only
     if nothing inside already has it. */
  useEffect(() => {
    const el = ref.current;
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
  }, []);

  /* A sheet that scrolls and holds nothing to operate — the shortcut list — is
     a scroller the keyboard could not move: arrows and Space scroll what has
     focus, and nothing inside could have it. Such a body takes a Tab stop. */
  useEffect(() => {
    const body = ref.current?.querySelector<HTMLElement>(".sheet__body");
    if (!body || tabbables(body).length > 0) return;
    if (body.scrollHeight > body.clientHeight + 1) {
      body.tabIndex = 0;
      body.setAttribute("role", "region");
      const title = ref.current?.querySelector(".sheet__title, .alert__title")?.textContent;
      if (title) body.setAttribute("aria-label", title);
    }
  }, []);

  useEffect(() => {
    const el = ref.current;
    /* Which way a Tab the browser was left to move is going, until it lands. */
    let tabbing: "forward" | "back" | null = null;
    /* Where a Tab that left the panel comes back in: the far end it wrapped past. */
    const wrapTarget = (way: "forward" | "back" | null): HTMLElement | null => {
      if (!el) return null;
      const items = tabbables(el);
      return (way === "back" ? items[items.length - 1] : items[0]) ?? el;
    };
    const onKey = (e: KeyboardEvent) => {
      if (!isTop()) return;
      const { onClose, onDefault, onCommandEnter } = handlers.current;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === "Enter" && e.metaKey && !e.isComposing && onCommandEnter) {
        e.preventDefault();
        e.stopPropagation();
        onCommandEnter();
      } else if (e.key === "Enter" && onDefault && !keyOwnedByTarget(e, "Enter")) {
        e.preventDefault();
        onDefault();
      } else if (e.key === "Tab" && el) {
        const items = tabbables(el);
        const first = items[0];
        const last = items[items.length - 1];
        const at = document.activeElement;
        if (!first) {
          e.preventDefault();
          el.focus({ preventScroll: true });
        } else if (!el.contains(at)) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && (at === first || at === el)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && at === last) {
          e.preventDefault();
          first.focus();
        } else {
          /* Left to the browser, which may leave the panel: see onFocusIn. When
             it leaves for <body>, as WebKit does past the last text field, no
             focusin fires at all, so look again once the key has landed. The
             native self-test found that one on 2026-09-13. */
          const way = e.shiftKey ? "back" : "forward";
          tabbing = way;
          requestAnimationFrame(() => {
            if (tabbing === way) tabbing = null;
            if (!el.isConnected || !isTop() || el.contains(document.activeElement)) return;
            wrapTarget(way)?.focus({ preventScroll: true });
          });
        }
      }
    };
    /* The Tab wrap above only sees controls a key can reach, and with macOS's
       Keyboard Navigation off, Tab skips buttons — so the last TEXT field is
       where it would leave. Anything that lands focus outside the panel while
       this is the top layer gets pulled back in, at the end a Tab was heading
       for. */
    const onFocusIn = (e: FocusEvent) => {
      if (!el || !isTop()) return;
      const t = e.target as Node | null;
      if (t && !el.contains(t)) wrapTarget(tabbing)?.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocusIn, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onFocusIn, true);
    };
  }, [isTop]);
  return ref;
}

export function Sheet({
  title,
  subtitle,
  head,
  children,
  footer,
  width,
  height,
  floating,
  onClose,
  onDefault,
  onCommandEnter,
  labelledBy = "sheet-title",
}: {
  title: string;
  subtitle?: ReactNode;
  /** Controls that belong on the heading row (Export's Part and Pages). */
  head?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  height?: number;
  floating?: boolean;
  onClose: () => void;
  onDefault?: () => void;
  /** An explicit send shortcut, handled only while this sheet owns the layer. */
  onCommandEnter?: () => void;
  labelledBy?: string;
}) {
  const ref = useModalKeys(onClose, onDefault, onCommandEnter);
  return createPortal(
    <div
      ref={ref}
      className={`modal-scrim${floating ? " modal-scrim--centred" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      aria-describedby={subtitle ? `${labelledBy}-sub` : undefined}
      tabIndex={-1}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-scrim__windowbar" data-tauri-drag-region="deep" aria-hidden="true" />
      <div
        className={`sheet${floating ? " sheet--floating" : ""}`}
        style={{ width, height }}
      >
        {/* Tauri listens at document. Let the event reach it; the scrim's
            target check already prevents clicks inside from dismissing us. */}
        <div className="sheet__head" data-tauri-drag-region="deep">
          <h2 className="sheet__title" id={labelledBy}>
            {title}
          </h2>
          {subtitle && (
            <span className="sheet__sub" id={`${labelledBy}-sub`}>
              {subtitle}
            </span>
          )}
          {head}
        </div>
        <div className="sheet__body">{children}</div>
        {footer && <div className="sheet__foot">{footer}</div>}
      </div>
      <div data-modal-portal="" />
    </div>,
    document.body,
  );
}

export function Alert({
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive,
  cancelIsDefault,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  /**
   * ⏎ cancels, and Cancel comes first. For a confirm that loses something
   * nothing can bring back — Quit Anyway, with words kept nowhere
   * (src/app/quit.ts). Revert and Discard keep a version first, so they stay
   * the default.
   */
  cancelIsDefault?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useModalKeys(onCancel, cancelIsDefault ? onCancel : onConfirm);
  const confirm = (
    <Button
      treatment={destructive ? "destructive" : cancelIsDefault ? "default" : "primary"}
      className={destructive && !cancelIsDefault ? "btn--primary" : undefined}
      onClick={onConfirm}
    >
      {confirmLabel}
    </Button>
  );
  const cancel = (
    <Button treatment={cancelIsDefault ? "primary" : "default"} onClick={onCancel}>
      {cancelLabel}
    </Button>
  );
  return createPortal(
    <div
      ref={ref}
      className="modal-scrim modal-scrim--centred"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="alert-title"
      aria-describedby="alert-body"
      tabIndex={-1}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="modal-scrim__windowbar" data-tauri-drag-region="deep" aria-hidden="true" />
      <div
        className="alert"
      >
        <span className="alert__icon" aria-hidden="true">
          <AppMarkIcon size={52} />
        </span>
        <h2 className="alert__title" id="alert-title">
          {title}
        </h2>
        <p className="alert__body" id="alert-body">
          {body}
        </p>
        <div className="alert__actions">
          {/* Default action first — Apple's order, and the one ⏎ triggers. */}
          {cancelIsDefault ? cancel : confirm}
          {cancelIsDefault ? confirm : cancel}
        </div>
      </div>
      <div data-modal-portal="" />
    </div>,
    document.body,
  );
}
