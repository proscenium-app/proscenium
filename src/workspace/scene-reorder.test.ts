// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { moveSceneInDoc, parse } from "../fountain";
import { reconcileCards, reorderSceneCards } from "./card-reconcile";

function mint() {
  let n = 0;
  return () => "01J" + String(n++).padStart(23, "0");
}

const THREE = [
  "# ACT ONE", "", "## SCENE 1", "", "Aaa.", "",
  "## SCENE 2", "", "Bbb.", "",
  "# ACT TWO", "", "## SCENE 3", "", "Ccc.",
].join("\n");

describe("app-driven scene reorder (doc move + card reorder)", () => {
  it("carries the card with the scene and refreshes its anchor/act", () => {
    const doc = parse(THREE).doc;
    const { cards } = reconcileCards({ doc, prior: null }, mint());
    cards[1].card.color = "ink";
    cards[1].card.status = "revised";

    // move SCENE 2 (ord 1) across the act divider to the end
    const newDoc = moveSceneInDoc(doc, 1, 2);
    const moved = reorderSceneCards(cards, 1, 2, newDoc)[2];

    expect(moved.heading).toBe("SCENE 2");
    expect(moved.card.color).toBe("ink");
    expect(moved.card.status).toBe("revised");
    expect(moved.act).toBe("ACT TWO"); // act refreshed by the cross-act move
    expect(moved.anchor.ordinal).toBe(2); // ordinal refreshed
  });

  it("after the app-driven move, the next reconcile is a NO-OP (consistent)", () => {
    const doc = parse(THREE).doc;
    const { cards, data } = reconcileCards({ doc, prior: null }, mint());
    const newDoc = moveSceneInDoc(doc, 1, 2);
    const moved = reorderSceneCards(cards, 1, 2, newDoc);

    // The orchestrator writes newDoc and the reordered records together; a
    // subsequent load-reconcile must report no change (no card swap, no churn)
    // — the move maintained the mapping itself.
    const r = reconcileCards({
      doc: newDoc,
      prior: { ...data, scenes: moved.map((c) => ({ id: c.id, anchor: c.anchor, card: c.card })) },
    });
    expect(r.changed).toBe(false);
    expect(r.orphaned).toBe(0);
    expect(r.newCards).toBe(0);
  });
});
