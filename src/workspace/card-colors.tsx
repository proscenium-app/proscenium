// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A scene's color, by the name the writer picks it by
 * (docs/app/organizing/workspace-model.md#WORK-85). One list for every place
 * that offers it — the board's card, the outline's row, the rail's scene row
 * and the inspector — so a colour is called the same thing wherever it is
 * chosen. The names are suggestions of what a colour might mean; the colour is
 * the writer's to use however they like.
 */
import type { CardColor } from "./play-file";

export const CARD_COLORS: { id: CardColor; name: string }[] = [
  { id: "cream", name: "No Color" },
  { id: "oxide", name: "Setup" },
  { id: "ink", name: "Turns" },
  { id: "sea", name: "Interior" },
  { id: "moss", name: "Subplot" },
  { id: "amber", name: "Revise" },
  { id: "ash", name: "Parked" },
];

/** The name a colour goes by; an unknown one reads as no colour, as it draws. */
export function colorName(id: string): string {
  return (CARD_COLORS.find((c) => c.id === id) ?? CARD_COLORS[0]).name;
}

/** A color as a menu row or a button shows it: the swatch, then its name. */
export function ColorChoice({ id }: { id: CardColor }) {
  return (
    <span className="colorchoice">
      <span className={`colorchoice__swatch swatch--${id}`} aria-hidden="true" />
      {colorName(id)}
    </span>
  );
}

/** The color menu's choices, for a `PopupButton`. */
export function colorOptions(): { value: CardColor; label: React.ReactNode; text: string }[] {
  return CARD_COLORS.map((c) => ({ value: c.id, text: c.name, label: <ColorChoice id={c.id} /> }));
}
