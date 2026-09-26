// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import type { BlockNode, Doc } from "../fountain/model";
import type { SceneCard } from "./card-reconcile";
import { computeAppearances } from "./appearances";

function b(type: BlockNode["type"], text = ""): BlockNode {
  return { type, content: text ? [{ type: "text", text }] : [] };
}
function scene(ordinal: number, heading: string, act?: string): SceneCard {
  return {
    id: `s${ordinal}`,
    anchor: { ordinal, headingHash: "", embeddedId: null },
    heading,
    ...(act ? { act } : {}),
    card: { color: "cream", status: "draft", label: "", boardNote: "" },
  };
}

describe("computeAppearances", () => {
  it("maps each speaker to the scenes they speak in", () => {
    const doc: Doc = {
      type: "doc",
      content: [
        b("scene", "SCENE 1"),
        b("character", "MARA"),
        b("dialogue", "Hello."),
        b("character", "JONAH"),
        b("dialogue", "Hi."),
        b("scene", "SCENE 2"),
        b("character", "MARA"),
        b("dialogue", "Again."),
      ],
    };
    const cards = [scene(0, "SCENE 1"), scene(1, "SCENE 2")];
    const app = computeAppearances(doc, cards);
    expect(app.get("MARA")?.map((a) => a.ordinal)).toEqual([0, 1]);
    expect(app.get("JONAH")?.map((a) => a.ordinal)).toEqual([0]);
    expect(app.get("MARA")?.map((a) => a.label)).toEqual(["SCENE 1", "SCENE 2"]);
  });

  it("strips cue extensions and dedupes within a scene", () => {
    const doc: Doc = {
      type: "doc",
      content: [
        b("scene", "SCENE 1"),
        b("character", "MARA (O.S.)"),
        b("dialogue", "One."),
        b("character", "MARA"),
        b("dialogue", "Two."),
      ],
    };
    const app = computeAppearances(doc, [scene(0, "SCENE 1")]);
    expect(app.get("MARA")?.length).toBe(1); // same name, same scene → one appearance
  });

  it("falls back to sceneHeading boundaries and a Sc N label", () => {
    const doc: Doc = {
      type: "doc",
      content: [
        b("sceneHeading", "A kitchen."),
        b("character", "MARA"),
        b("dialogue", "Hi."),
      ],
    };
    const app = computeAppearances(doc, []); // no cards → synthesized label
    expect(app.get("MARA")).toEqual([{ ordinal: 0, label: "Sc 1" }]);
  });

  it("is empty for a null doc", () => {
    expect(computeAppearances(null, []).size).toBe(0);
  });

  it("act-qualifies labels when headings repeat across acts", () => {
    const doc: Doc = {
      type: "doc",
      content: [
        b("act", "ACT ONE"),
        b("scene", "SCENE 1"),
        b("character", "MARA"),
        b("dialogue", "One."),
        b("act", "ACT TWO"),
        b("scene", "SCENE 1"),
        b("character", "MARA"),
        b("dialogue", "Two."),
      ],
    };
    // Ordinals count scene blocks: Act One SCENE 1 = 0, Act Two SCENE 1 = 1.
    const cards = [scene(0, "SCENE 1", "ACT ONE"), scene(1, "SCENE 1", "ACT TWO")];
    const app = computeAppearances(doc, cards);
    expect(app.get("MARA")?.map((a) => a.label)).toEqual([
      "ACT ONE · SCENE 1",
      "ACT TWO · SCENE 1",
    ]);
  });
});
