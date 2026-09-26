// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";

import { cueName, cueNameEnd, cueNamePart, splitCueExtension, trailingExtension } from "./cue";

describe("cueName — who speaks (docs/engineering/fountain-model.md#EDIT-125)", () => {
  it("drops every extension, with or without a space in front of it", () => {
    expect(cueName("MARA")).toBe("MARA");
    expect(cueName("MARA (V.O.)")).toBe("MARA");
    expect(cueName("MARA(V.O.)")).toBe("MARA");
    expect(cueName("Mara (o.s.)")).toBe("MARA");
    expect(cueName("MARA (V.O.) (CONT'D)")).toBe("MARA");
    expect(cueName("DR. OKAFOR  (ON THE PHONE)")).toBe("DR. OKAFOR");
  });

  it("keeps a cue that starts with a bracket whole: there is no name to cut from", () => {
    expect(cueNameEnd("(beat)")).toBe(-1);
    expect(cueName("(beat)")).toBe("(BEAT)");
  });

  it("says where the name ends, before the spaces", () => {
    expect(cueNameEnd("MARA (O")).toBe(4);
    expect(cueNameEnd("MARA(O")).toBe(4);
    expect(cueNameEnd("MARA")).toBe(-1);
    expect(cueNamePart("  Mara  (V.O.)")).toBe("Mara");
  });
});

describe("splitCueExtension — how the file holds a cue", () => {
  it("takes the last parenthetical as the extension", () => {
    expect(splitCueExtension("MARA (V.O.)")).toEqual({ name: "MARA", extension: "(V.O.)" });
    expect(splitCueExtension("MARA(V.O.)")).toEqual({ name: "MARA", extension: "(V.O.)" });
    expect(splitCueExtension("MARA (V.O.) (CONT'D)")).toEqual({ name: "MARA (V.O.)", extension: "(CONT'D)" });
    expect(splitCueExtension("HANS (on the radio)")).toEqual({ name: "HANS", extension: "(on the radio)" });
    expect(splitCueExtension("MARA")).toEqual({ name: "MARA", extension: null });
  });

  it("reports where the extension starts, the spaces before it included", () => {
    expect(trailingExtension("MARA  (V.O.)")).toEqual({ at: 4, extension: "(V.O.)" });
    expect(trailingExtension("MARA (V.O.) ")).toEqual({ at: 4, extension: "(V.O.)" });
    expect(trailingExtension("(V.O.)")).toEqual({ at: 0, extension: "(V.O.)" });
    expect(trailingExtension("MARA (V.O.) NOW")).toBeNull();
  });
});
