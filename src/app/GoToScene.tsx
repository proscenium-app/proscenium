// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ⌘⇧J — Go to Scene (docs/engineering/design-system.md#UI-D107).
 *
 * A quick jump from the writing surface. The shared popup anatomy supplies
 * keyboard handling and placement; the filter owns a sibling listbox with
 * stable scene options.
 */
import { useEffect, useMemo, useState } from "react";
import type { SceneCard } from "../workspace";
import { pageCountLabel, type ScenePageMap } from "../layout";
import { Menu, announce, type MenuEntry } from "../ui";

export function GoToScene({
  cards,
  scenePages,
  onPick,
  onClose,
}: {
  cards: SceneCard[];
  scenePages?: ScenePageMap;
  onPick: (ordinal: number) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const pagesFor = useMemo(
    () => new Map((scenePages?.scenes ?? []).map((s) => [s.ordinal, s])),
    [scenePages],
  );

  const entries = useMemo<MenuEntry[]>(() => {
    const q = query.trim().toLowerCase();
    const rows: MenuEntry[] = [];
    let act: string | undefined;
    const matches = [...cards]
      .sort((a, b) => a.anchor.ordinal - b.anchor.ordinal)
      .filter(
        (c) =>
          !q ||
          (c.heading ?? "").toLowerCase().includes(q) ||
          (c.synopsis ?? "").toLowerCase().includes(q) ||
          (c.act ?? "").toLowerCase().includes(q),
      );
    if (matches.length === 0) {
      rows.push({ kind: "hint", label: "No scene matches that." });
      return rows;
    }
    for (const c of matches) {
      if (c.act && c.act !== act) {
        act = c.act;
        rows.push({ kind: "section", label: act });
      }
      const pages = pagesFor.get(c.anchor.ordinal);
      rows.push({
        id: c.id,
        label: c.heading || "Untitled scene",
        hint: pages ? `Page ${pages.firstPage} · ${pageCountLabel(pages.pages)}` : undefined,
        onSelect: () => onPick(c.anchor.ordinal),
      });
    }
    return rows;
  }, [cards, query, pagesFor, onPick]);

  const count = entries.filter((entry) => !("kind" in entry) || entry.kind === "item").length;
  useEffect(() => {
    const timer = window.setTimeout(() => announce(count ? `${count} scene${count === 1 ? "" : "s"} found.` : "No scene matches that."), 200);
    return () => window.clearTimeout(timer);
  }, [query, count]);

  return (
    <Menu
      anchor={{ kind: "point", x: Math.round(window.innerWidth / 2) - 150, y: 96 }}
      entries={entries}
      onClose={onClose}
      width={320}
      label="Scenes"
      search={{ value: query, onChange: setQuery, label: "Filter scenes", className: "gotoscene__field" }}
      className="menu--gotoscene"
    />
  );
}
