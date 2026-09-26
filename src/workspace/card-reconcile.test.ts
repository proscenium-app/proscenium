// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "../fountain";
import { reconcileCards } from "./card-reconcile";
import { parseJson } from "./json-io";
import { scriptDataFor, type PlayFile, type ScriptData } from "./play-file";

function mintFactory() {
  let n = 0;
  return () => "01J" + String(n++).padStart(23, "0");
}

function reconcile(src: string, prior: ScriptData | null, mint = mintFactory()) {
  return reconcileCards({ doc: parse(src).doc, prior }, mint);
}

const TWO_SCENES = [
  "# ACT ONE",
  "",
  "## SCENE 1",
  "",
  "= setup.",
  "",
  "Mara waits.",
  "",
  "## SCENE 2",
  "",
  "= turn.",
  "",
  "Jonah leaves.",
].join("\n");

describe("card↔scene reconciliation (docs/app/keeping-work/storage-and-file-format.md#STOR-D6)", () => {
  it("mints a card per scene in document order on first reconcile", () => {
    const r = reconcile(TWO_SCENES, null);
    expect(r.changed).toBe(true);
    expect(r.newCards).toBe(2);
    expect(r.cards.map((s) => s.anchor.ordinal)).toEqual([0, 1]);
    expect(r.cards[0].act).toBe("ACT ONE");
    expect(r.cards[0].heading).toBe("SCENE 1");
    expect(r.cards[0].synopsis).toBe("setup.");
    expect(r.cards[0].card.status).toBe("");
    expect(r.cards[0].anchor.headingHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("keeps act, heading and synopsis OUT of what gets stored (docs/app/keeping-work/storage-and-file-format.md#STOR-D5)", () => {
    // They are derivable from the script, and the pre-1.0 sidecar cached them
    // as `_act`/`_heading`/`_synopsis` — which meant retyping a scene heading
    // rewrote a synced JSON file. A play file that changes on every keystroke
    // is a play file that conflicts.
    const r = reconcile(TWO_SCENES, null);
    const stored = JSON.stringify(r.data);
    expect(stored).not.toContain("SCENE 1");
    expect(stored).not.toContain("ACT ONE");
    expect(stored).not.toContain("setup.");
    expect(Object.keys(r.data.scenes[0]).sort()).toEqual(["anchor", "card", "id"]);
  });

  it("is idempotent: re-reconciling the same doc is a no-op (no churn)", () => {
    const r1 = reconcile(TWO_SCENES, null);
    const r2 = reconcile(TWO_SCENES, r1.data);
    expect(r2.changed).toBe(false);
    expect(r2.cards.map((s) => s.id)).toEqual(r1.cards.map((s) => s.id));
  });

  it("a synopsis edit alone still changes what is stored", () => {
    // The synopsis is not stored, but it lives in the `.fountain` — so editing
    // one must not be mistaken for a no-op by anything ELSE. Here the records
    // are untouched, which is exactly right: the script already holds the change.
    const r1 = reconcile(TWO_SCENES, null);
    const edited = TWO_SCENES.replace("= setup.", "= a different setup.");
    const r2 = reconcile(edited, r1.data);
    expect(r2.changed).toBe(false);
    expect(r2.cards[0].synopsis).toBe("a different setup.");
  });

  it("preserves card metadata across a reorder (binds by act-qualified hash)", () => {
    const r1 = reconcile(TWO_SCENES, null);
    r1.data.scenes[1].card.color = "ink";
    r1.data.scenes[1].card.status = "revised";
    const reordered = [
      "# ACT ONE",
      "",
      "## SCENE 2",
      "",
      "= turn.",
      "",
      "Jonah leaves.",
      "",
      "## SCENE 1",
      "",
      "= setup.",
      "",
      "Mara waits.",
    ].join("\n");
    const r2 = reconcile(reordered, r1.data);
    // SCENE 2 is now first; it keeps its id + card
    const sceneTwo = r2.cards[0];
    expect(sceneTwo.heading).toBe("SCENE 2");
    expect(sceneTwo.id).toBe(r1.data.scenes[1].id);
    expect(sceneTwo.card.color).toBe("ink");
    expect(sceneTwo.card.status).toBe("revised");
    expect(sceneTwo.anchor.ordinal).toBe(0); // ordinal refreshed to new position
  });

  it("mints a card for a new scene, preserving the others", () => {
    const r1 = reconcile(TWO_SCENES, null);
    const withNew = TWO_SCENES + "\n\n## SCENE 3\n\n= coda.\n\nQuiet.";
    const r2 = reconcile(withNew, r1.data);
    expect(r2.newCards).toBe(1);
    expect(r2.cards.length).toBe(3);
    expect(r2.cards[0].id).toBe(r1.cards[0].id);
  });

  it("orphans a deleted scene's record, retained never dropped (docs/app/keeping-work/storage-and-file-format.md#STOR-110)", () => {
    const r1 = reconcile(TWO_SCENES, null);
    const justOne = ["# ACT ONE", "", "## SCENE 1", "", "= setup.", "", "Mara waits."].join("\n");
    const r2 = reconcile(justOne, r1.data);
    expect(r2.cards.length).toBe(1);
    expect(r2.orphaned).toBe(1);
    expect(r2.data.orphans.map((o) => o.id)).toContain(r1.data.scenes[1].id);
  });

  it("opening the committed sample play is a no-op reconcile (no churn)", () => {
    const dir = join(import.meta.dir, "../../sample-vault/The Weight of Water");
    const fountain = readFileSync(join(dir, "The Weight of Water.fountain"), "utf8");
    const play = parseJson(
      readFileSync(join(dir, "The Weight of Water.proscenium"), "utf8"),
    ) as PlayFile;
    const scriptId = play.binder.find((b) => b.type === "script")!.id;
    const r = reconcileCards({
      doc: parse(fountain).doc,
      prior: scriptDataFor(play, scriptId),
    });
    expect(r.changed).toBe(false);
    expect(r.newCards).toBe(0);
    expect(r.orphaned).toBe(0);
  });

  it("distinguishes same-named scenes in different acts (act-qualified)", () => {
    const dupes = [
      "# ACT ONE",
      "",
      "## SCENE 1",
      "",
      "Opening.",
      "",
      "# ACT TWO",
      "",
      "## SCENE 1",
      "",
      "Reprise.",
    ].join("\n");
    const r1 = reconcile(dupes, null);
    expect(r1.cards[0].anchor.headingHash).not.toBe(r1.cards[1].anchor.headingHash);
    r1.data.scenes[0].card.label = "act1";
    r1.data.scenes[1].card.label = "act2";
    const r2 = reconcile(dupes, r1.data);
    expect(r2.cards[0].card.label).toBe("act1");
    expect(r2.cards[1].card.label).toBe("act2");
  });
});
