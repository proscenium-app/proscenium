// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A banner's answers — Review… or Discard, Use the other or Keep this one.
 *
 * One stop for ⌃⇥ and Tab, arrows between the answers: the segmented control's
 * pattern (docs/app/preferences-and-help/accessibility.md#UI-D108). The stop is the action the banner leads
 * with. The banners used to be no stop at all: they sat outside every area
 * ⌃⇥ visits, and with the Mac's keyboard navigation off Tab passes buttons
 * by, so a writer without a pointer could not answer "Proscenium closed
 * before these changes were saved" (found running the kill -9 check).
 */
import { useRef, useState } from "react";
import { Button } from "../ui";

export interface BannerAction {
  text: string;
  onClick: () => void;
  /** The action the banner leads with: drawn as primary, and where focus lands. */
  primary?: boolean;
}

export function BannerActions({ label, actions }: { label: string; actions: BannerAction[] }) {
  const [stop, setStop] = useState(() =>
    Math.max(
      0,
      actions.findIndex((a) => a.primary),
    ),
  );
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLSpanElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    const at = buttons.current.findIndex((b) => b === document.activeElement);
    if (at < 0) return;
    e.preventDefault();
    const n = actions.length;
    const to =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? n - 1
          : (at + (e.key === "ArrowLeft" ? -1 : 1) + n) % n;
    setStop(to);
    buttons.current[to]?.focus();
  };

  return (
    <span className="banner__actions" role="toolbar" aria-label={label} onKeyDown={onKeyDown}>
      {actions.map((a, i) => (
        <Button
          key={a.text}
          ref={(el) => {
            buttons.current[i] = el;
          }}
          size="small"
          treatment={a.primary ? "primary" : "default"}
          tabIndex={i === stop ? 0 : -1}
          onFocus={() => setStop(i)}
          onClick={a.onClick}
        >
          {a.text}
        </Button>
      ))}
    </span>
  );
}
