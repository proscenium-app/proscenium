// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where a format came from decides whether the designer may edit it and which
 * file a save goes to; overlapping reloads must settle on the newest answer.
 */
import { describe, expect, it } from "bun:test";

import { FormatRegistry } from "./registry";

const userFile = (id: string, name = id) =>
  JSON.stringify({
    id,
    name,
    page: { size: "letter", margins: { left: 1.5, top: 1, right: 1, bottom: 1 } },
    type: { family: "Courier Prime", size: 12, lineHeight: 1 },
    elements: Object.fromEntries(
      ["act", "scene", "sceneHeading", "action", "character", "parenthetical", "dialogue", "transition", "lyric", "centered"].map(
        (k) => [k, {}],
      ),
    ),
  });

describe("format origins", () => {
  it("knows a built-in from a user file, and which file", () => {
    const registry = FormatRegistry.withBuiltins();
    registry.addUserFormat("mine.json", userFile("my-house"));
    expect(registry.isBuiltin("dg-modern")).toBe(true);
    expect(registry.origin("dg-modern")).toEqual({ kind: "builtin" });
    expect(registry.isBuiltin("my-house")).toBe(false);
    expect(registry.origin("my-house")).toEqual({ kind: "user", fileName: "mine.json" });
    expect(registry.origin("nope")).toBeUndefined();
  });

  it("keeps a built-in read-only when a user file claims its id", () => {
    const registry = FormatRegistry.withBuiltins();
    registry.addUserFormat("dg-modern.json", userFile("dg-modern", "My DG"));
    expect(registry.isBuiltin("dg-modern")).toBe(true);
    expect(registry.get("dg-modern")?.name).not.toBe("My DG");
    expect(registry.warnings[0].message).toContain("read-only");
  });

  it("records no origin for a file it could not read", () => {
    const registry = FormatRegistry.withBuiltins();
    registry.addUserFormat("broken.json", "{ nope");
    expect(registry.warnings).toHaveLength(1);
    expect(registry.list()).toHaveLength(7);
  });
});
