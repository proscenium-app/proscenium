// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A hover's enter and leave, for a pointer that hovers alone
 * (docs/engineering/cross-platform.md#PLAT-70): a mouse, an iPad's trackpad.
 *
 * A finger's tap is a hover first, and WebKit on an iPad holds a tap back
 * from its click when what the hover did changed the page. A comment card
 * marked its anchor in the script as a finger came onto it, and every tap on
 * the card's own Save and actions lost its click. So a hover runs for a
 * pointer that hovers, on its pointer events, and a finger meets the same
 * thing by its tap, or not at all. `hover-reveals.test.ts` holds every
 * component to it.
 */
import type { PointerEvent } from "react";

export function onHover<T extends Element = Element>(
  enter: (event: PointerEvent<T>) => void,
  leave?: (event: PointerEvent<T>) => void,
): {
  onPointerEnter: (event: PointerEvent<T>) => void;
  onPointerLeave: (event: PointerEvent<T>) => void;
} {
  return {
    onPointerEnter: (event) => {
      if (event.pointerType === "mouse") enter(event);
    },
    onPointerLeave: (event) => {
      if (event.pointerType === "mouse") leave?.(event);
    },
  };
}
