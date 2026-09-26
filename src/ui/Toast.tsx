// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Toasts (docs/app/preferences-and-help/accessibility.md#A11Y-10).
 *
 * One glyph carrying the kind, a title, a detail, one action, six seconds. The
 * important one is the **undo** toast: Move to Trash no longer asks. Finder's
 * rule is that a recoverable action is not confirmed, and this app already
 * trashes to the OS — so the `confirm()` it used to raise was friction with no
 * safety behind it. The alert survives for Restore and Revert, which rewrite
 * the script and cannot be walked back from the Finder.
 *
 * A toast with an action does NOT dismiss on its own click: the writer has to
 * be able to read it, then reach for Undo.
 *
 * Nor does it leave while the writer is reading it. Six seconds is a glance for
 * someone looking and not enough for someone listening to VoiceOver finish the
 * sentence and then Tab to Undo, so the clock stops while the pointer or focus
 * is on the toast and starts again, in full, when both have left.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ErrorCode } from "../diagnostics/error-codes";
import { announce, ensureAnnouncer } from "./announce";
import { CheckIcon, CloseIcon, TrashIcon, WarnIcon } from "./Icons";

export type ToastKind = "ok" | "error" | "trash" | "plain";

export interface ToastSpec {
  kind?: ToastKind;
  title: string;
  detail?: string;
  action?: { label: string; run: () => void };
  /** Milliseconds on screen; 0 keeps it until dismissed. */
  ms?: number;
  /**
   * An error's stable code (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D5), which is all the
   * local error log and the reports ever keep of it. An error toast without
   * one is logged as `E-OTHER`.
   */
  code?: ErrorCode;
  /** Called after the toast has painted; privacy consent waits for this. */
  onShown?: () => void;
}

interface Live extends ToastSpec {
  id: number;
}

const Ctx = createContext<(t: ToastSpec) => void>(() => {});

/** Where focus was when a key brought it to a toast's action, to hand it back. */
let returnFocusTo: HTMLElement | null = null;

/**
 * A key for the last toast's action (docs/app/preferences-and-help/accessibility.md#A11Y-18): while a toast offers one —
 * Undo, after Move to Trash — ⌃⇥ (regions.ts) lands on it first, from
 * wherever the writer is. It used to be reachable only by Tab to the far end
 * of the window, by which time the toast had gone. Focus goes back to where it
 * came from when the toast is done. False when there is no action to reach, or
 * focus is already on it, so the area ring carries on as usual.
 */
export function focusToastAction(): boolean {
  const button = document.querySelector<HTMLElement>(".toast [data-toast-action]");
  if (!button || button.getClientRects().length === 0) return false;
  if (button.closest(".toast")?.contains(document.activeElement)) return false;
  const active = document.activeElement;
  returnFocusTo = active instanceof HTMLElement && active !== document.body ? active : null;
  button.focus();
  return true;
}

function restoreFocus() {
  const to = returnFocusTo;
  returnFocusTo = null;
  if (to?.isConnected) to.focus({ preventScroll: true });
}

/** Raise a toast from anywhere under the shell. */
export function useToast() {
  return useContext(Ctx);
}

const GLYPH: Record<ToastKind, ReactNode> = {
  ok: <CheckIcon size={16} />,
  error: <WarnIcon size={16} />,
  trash: <TrashIcon size={16} />,
  plain: null,
};

export function ToastHost({
  children,
  onError,
}: {
  children: ReactNode;
  /** Every error toast shown, by code — the shell keeps the log (src/diagnostics). */
  onError?: (code: ErrorCode) => void;
}) {
  const [toasts, setToasts] = useState<Live[]>([]);
  const [held, setHeld] = useState({ hover: false, focus: false });
  const next = useRef(1);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => ensureAnnouncer(), []);

  const push = useCallback((t: ToastSpec) => {
    const id = next.current++;
    // One at a time: a stack of toasts over the page is a notification centre,
    // and this app does not have news — it has one thing that just happened.
    setToasts([{ ...t, id }]);
    setHeld({ hover: false, focus: false });
    const words = [
      t.title,
      t.detail,
      t.action ? `${t.action.label} is available — Control-Tab reaches it.` : "",
    ]
      .filter(Boolean)
      .join(". ");
    announce(words, { assertive: t.kind === "error" });
    if (t.kind === "error") onErrorRef.current?.(t.code ?? "E-OTHER");
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const top = toasts[0];
  useEffect(() => {
    if (!top?.onShown) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => top.onShown?.());
    });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [top]);
  const holding = held.hover || held.focus;
  // A toast that left on its own takes the way back with it: the next toast's
  // click must not send focus somewhere the writer was minutes ago.
  useEffect(() => {
    if (!top) returnFocusTo = null;
  }, [top]);
  useEffect(() => {
    if (!top || holding) return;
    const ms = top.ms ?? 6000;
    if (ms <= 0) return;
    const timer = window.setTimeout(() => dismiss(top.id), ms);
    return () => window.clearTimeout(timer);
  }, [top, dismiss, holding]);

  const value = useMemo(() => push, [push]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {top && (
        /* Not a live region itself — the announcer above has already spoken
           it, and a second region would say every toast twice. */
        <div
          className={`toast toast--${top.kind ?? "plain"}`}
          onMouseEnter={() => setHeld((h) => ({ ...h, hover: true }))}
          onMouseLeave={() => setHeld((h) => ({ ...h, hover: false }))}
          onFocus={() => setHeld((h) => ({ ...h, focus: true }))}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setHeld((h) => ({ ...h, focus: false }));
            }
          }}
        >
          {top.kind && top.kind !== "plain" && (
            <span className="toast__glyph" aria-hidden="true">
              {GLYPH[top.kind]}
            </span>
          )}
          <span className="toast__text">
            <span className="toast__title">{top.title}</span>
            {top.detail && <span className="toast__detail">{top.detail}</span>}
          </span>
          {top.action ? (
            <button
              type="button"
              className="toast__action"
              data-toast-action=""
              onClick={() => {
                dismiss(top.id);
                top.action?.run();
                restoreFocus();
              }}
            >
              {top.action.label}
            </button>
          ) : (
            <button
              type="button"
              className="toast__action"
              aria-label="Dismiss"
              onClick={() => {
                dismiss(top.id);
                restoreFocus();
              }}
            >
              <CloseIcon size={11} />
            </button>
          )}
        </div>
      )}
    </Ctx.Provider>
  );
}
