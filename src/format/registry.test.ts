// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";

import dgModernRaw from "../../formats/dg-modern.json";
import { DEFAULT_FORMAT_ID, FormatRegistry } from "./registry";

describe("FormatRegistry", () => {
  it("registers the published built-ins, dg-modern first (the default)", () => {
    const registry = FormatRegistry.withBuiltins();
    expect(registry.list().map((f) => f.id)).toEqual(["dg-modern", "stage-us-modern", "stage-uk", "samuel-french", "dg-traditional", "dg-musical", "sketch-comedy"]);
    expect(DEFAULT_FORMAT_ID).toBe("dg-modern");
    expect(registry.warnings).toEqual([]);
  });

  it("resolves a missing reference to the default, silently", () => {
    const registry = FormatRegistry.withBuiltins();
    const { spec, warning } = registry.resolve(undefined);
    expect(spec.id).toBe(DEFAULT_FORMAT_ID);
    expect(warning).toBeUndefined();
  });

  it("resolves a known id exactly", () => {
    const registry = FormatRegistry.withBuiltins();
    const { spec, warning } = registry.resolve("stage-us-modern");
    expect(spec.id).toBe("stage-us-modern");
    expect(warning).toBeUndefined();
  });

  it("falls back to the default on an unknown id, loudly", () => {
    const registry = FormatRegistry.withBuiltins();
    const { spec, warning } = registry.resolve("missing-house");
    expect(spec.id).toBe(DEFAULT_FORMAT_ID);
    expect(warning).toContain("missing-house");
  });

  it("adds a valid user format after the built-ins", () => {
    const registry = FormatRegistry.withBuiltins();
    const custom = structuredClone(dgModernRaw) as Record<string, unknown>;
    custom.id = "my-format";
    custom.name = "Mine";
    registry.addUserFormat("my-format.json", JSON.stringify(custom));
    expect(registry.warnings).toEqual([]);
    expect(registry.get("my-format")?.name).toBe("Mine");
    expect(registry.list().map((f) => f.id)).toEqual([
      "dg-modern",
      "stage-us-modern",
      "stage-uk", "samuel-french", "dg-traditional", "dg-musical", "sketch-comedy",
      "my-format",
    ]);
  });

  it("refuses a user file that replaces a built-in id, with a warning", () => {
    const registry = FormatRegistry.withBuiltins();
    const custom = structuredClone(dgModernRaw) as Record<string, unknown>;
    custom.name = "My retuned DG";
    registry.addUserFormat("dg-modern.json", JSON.stringify(custom));
    expect(registry.get("dg-modern")?.name).toBe(dgModernRaw.name);
    expect(registry.warnings.map((w) => w.message).join("\n")).toContain("read-only");
  });

  it("skips an unparseable user file with a warning, keeping the registry intact", () => {
    const registry = FormatRegistry.withBuiltins();
    registry.addUserFormat("broken.json", "{ nope");
    expect(registry.list()).toHaveLength(7);
    expect(registry.warnings[0]?.source).toBe("broken.json");
  });

  it("skips an invalid spec with a warning that names the problem", () => {
    const registry = FormatRegistry.withBuiltins();
    const custom = structuredClone(dgModernRaw) as Record<string, unknown>;
    custom.id = "half-baked";
    delete (custom.elements as Record<string, unknown>).dialogue;
    registry.addUserFormat("half-baked.json", JSON.stringify(custom));
    expect(registry.get("half-baked")).toBeUndefined();
    expect(registry.warnings[0]?.message).toContain("elements.dialogue");
  });
});
