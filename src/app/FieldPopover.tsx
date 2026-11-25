// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * One detail of the play, edited beside the field that shows it on a page
 * (docs/app/formatting/formats-and-layout.md#FMT-176): the writer clicks
 * their name where it prints, types, and the play has an author. Return
 * saves (⌘Return where Return is a new line, in the contact block), Esc
 * leaves the detail as it was, and a press anywhere else saves, as leaving
 * a field does.
 *
 * A layer of its own (src/ui/layers.ts): while it is up its keys are its
 * own, never the page's under it, and the keyboard goes back where it was
 * when it closes.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../ui";
import { useFocusReturn, useLayer } from "../ui/layers";
import { portalHost } from "../ui/portal-host";
import { keys } from "../ui/keys";
import { DETAIL_HELP, type Detail } from "./play-details";

const WIDTH = 300;
const GAP = 8;

export function FieldPopover({
  detail,
  value,
  seed,
  anchor,
  onCommit,
  onClose,
}: {
  detail: Detail;
  /** The detail as the play holds it now. */
  value: string;
  /** What the writer typed on the field to start: the new value begins with it. */
  seed?: string;
  /** The field on the page, which this stands under. */
  anchor: HTMLElement;
  onCommit: (text: string) => void;
  onClose: () => void;
}) {
  const { label, placeholder, help } = DETAIL_HELP[detail];
  const lines = detail === "contact";
  const [text, setText] = useState(seed ?? value);
  const latest = useRef(text);
  latest.current = text;
  const box = useRef<HTMLDivElement | null>(null);
  const input = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const isTop = useLayer();
  useFocusReturn();

  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      if (!anchor.isConnected) return;
      const field = anchor.getBoundingClientRect();
      const height = box.current?.offsetHeight ?? 0;
      const under = field.bottom + GAP;
      const top =
        under + height > window.innerHeight - GAP && field.top - GAP - height > GAP
          ? field.top - GAP - height
          : under;
      const left = Math.max(
        GAP,
        Math.min(window.innerWidth - WIDTH - GAP, field.left + field.width / 2 - WIDTH / 2),
      );
      setAt((was) => (was && was.top === top && was.left === left ? was : { top, left }));
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [anchor]);

  // The keyboard starts in the field, once it stands where it is drawn (a
  // field not yet shown takes no focus): all of it selected, to type over,
  // or the caret after what was typed on the page to open it.
  const placed = at !== null;
  useEffect(() => {
    const el = input.current;
    if (!el || !placed) return;
    el.focus({ preventScroll: true });
    if (seed === undefined) el.select();
    else el.setSelectionRange(el.value.length, el.value.length);
  }, [seed, placed]);

  const done = useRef(false);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save) onCommit(latest.current);
    onClose();
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isTop()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finishRef.current(false);
        return;
      }
      // A Return that ends an input method's composition is the method's own.
      if (event.key !== "Enter" || event.isComposing || event.keyCode === 229) return;
      // In the contact block Return is a new line, and ⌘Return saves.
      if (lines && !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      event.stopPropagation();
      finishRef.current(true);
    };
    const onPress = (event: PointerEvent) => {
      if (!isTop()) return;
      if (event.target instanceof Node && box.current?.contains(event.target)) return;
      finishRef.current(true);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPress, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPress, true);
    };
  }, [isTop, lines]);

  const id = `fieldpop-${detail}`;
  return createPortal(
    <div
      ref={box}
      className="fieldpop"
      role="dialog"
      aria-label={`${label}, a detail of the play`}
      style={{
        width: WIDTH,
        top: at?.top ?? 0,
        left: at?.left ?? 0,
        visibility: at ? "visible" : "hidden",
      }}
    >
      <label className="fieldpop__label seclabel" htmlFor={id}>
        {label}
      </label>
      {lines ? (
        <textarea
          id={id}
          ref={(el) => {
            input.current = el;
          }}
          className="field field--area"
          rows={3}
          value={text}
          placeholder={placeholder}
          aria-describedby={`${id}-help`}
          onChange={(event) => setText(event.target.value)}
        />
      ) : (
        <input
          id={id}
          ref={(el) => {
            input.current = el;
          }}
          className="field"
          value={text}
          placeholder={placeholder}
          aria-describedby={`${id}-help`}
          onChange={(event) => setText(event.target.value)}
        />
      )}
      <p className="fieldpop__help" id={`${id}-help`}>
        {help}
      </p>
      <div className="fieldpop__foot">
        <span className="fieldpop__keys">{keys(lines ? "⌘⏎" : "⏎")} saves · Esc cancels</span>
        <Button treatment="primary" onClick={() => finish(true)}>
          Save
        </Button>
      </div>
    </div>,
    portalHost(),
  );
}
