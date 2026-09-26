// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { getSchema } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { dualCueInput } from "./input-rules";
import { playExtensions } from "./schema";

const schema = getSchema(playExtensions);
function state(cue = "IVO", dual = false) {
  return EditorState.create({ schema, doc: schema.nodeFromJSON({ type: "doc", content: [
    { type: "action", content: [{ type: "text", text: "A knock." }] },
    { type: "character", attrs: { dual }, content: [{ type: "text", text: cue }] },
  ] }) });
}

describe("typing a dual-dialogue cue", () => {
  it("uses the incoming caret position even before the clicked selection arrives", () => {
    const before = state();
    expect(before.selection.$from.parent.type.name).toBe("action");
    const end = before.doc.content.size - 1;
    const tr = before.tr;
    expect(dualCueInput(tr, { from: end, to: end })).toBe(true);
    expect(tr.doc.lastChild?.attrs.dual).toBe(true);
    expect(tr.doc.lastChild?.textContent).toBe("IVO");
    expect(tr.doc.firstChild?.textContent).toBe("A knock.");
  });

  it("removes an optional space and can turn the pairing off", () => {
    const before = state("IVO ", true);
    const end = before.doc.content.size - 1;
    const tr = before.tr;
    expect(dualCueInput(tr, { from: end - 1, to: end })).toBe(true);
    expect(tr.doc.lastChild?.attrs.dual).toBe(false);
    expect(tr.doc.lastChild?.textContent).toBe("IVO");
  });

  it("leaves mid-cue typing and other elements literal", () => {
    const before = state();
    const tr = before.tr;
    const mid = before.doc.content.size - 2;
    expect(dualCueInput(tr, { from: mid, to: mid })).toBe(false);
    expect(dualCueInput(tr, { from: 8, to: 8 })).toBe(false);
    expect(tr.steps).toHaveLength(0);
  });
});
