// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * scripts/track-key.mjs makes alpha's key in the shape the app and the Worker
 * accept, and writes it into settings.json without disturbing anything else
 * there.
 */
import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, statSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { holdsKey, keyHash, mintKey, writeKey } from "../../scripts/track-key.mjs";
import { isUpdateTrackKey, readSettings } from "./settings-model";

/** The Worker's own pattern, read from its source: its types are the Worker's, not the app's. */
const worker = readFileSync(new URL("../../services/edge/src/updates.ts", import.meta.url), "utf8");
const TRACK_KEY = new RegExp(/export const TRACK_KEY = \/(.+)\/;/.exec(worker)![1]);

function settingsFile(contents: string) {
  const dir = mkdtempSync(join(tmpdir(), "track-key-"));
  const path = join(dir, "settings.json");
  writeFileSync(path, contents, { mode: 0o600 });
  return { dir, path };
}

describe("alpha's key", () => {
  it("is made in the shape the app and the Worker accept, new every time", () => {
    const keys = new Set(Array.from({ length: 64 }, mintKey));
    expect(keys.size).toBe(64);
    for (const key of keys) {
      expect(isUpdateTrackKey(key)).toBe(true);
      expect(TRACK_KEY.test(key)).toBe(true);
    }
  });

  it("is filed as its SHA-256 in hex, the Worker's comparison", () => {
    const key = mintKey();
    expect(keyHash(key)).toBe(createHash("sha256").update(key).digest("hex"));
    expect(keyHash(key)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("goes into settings.json beside everything else, as the same file mode, with nothing left behind", () => {
    const before = { lastVault: "/Users/writer/Plays", lastVaultBookmark: "Ym9va21hcms", updateTrack: "alpha", unknownToThisBuild: { a: 1 } };
    const { dir, path } = settingsFile(JSON.stringify(before));
    expect(holdsKey(path)).toBe(false);
    const key = mintKey();
    writeKey(path, key);
    const after = JSON.parse(readFileSync(path, "utf8"));
    expect(after).toEqual({ ...before, updateTrackKey: key });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir)).toEqual(["settings.json"]);
    expect(holdsKey(path)).toBe(true);
    // The app reads it as a key, and tells the page only that it has one.
    expect(readSettings(after).hasUpdateTrackKey).toBe(true);
    // A reissue replaces it.
    const next = mintKey();
    writeKey(path, next);
    expect(JSON.parse(readFileSync(path, "utf8")).updateTrackKey).toBe(next);
  });

  it("refuses a file that is not settings, without quoting it", () => {
    const secret = mintKey();
    for (const contents of [`{"updateTrackKey":"${secret}"`, "[]", "null"]) {
      const { path } = settingsFile(contents);
      let message = "";
      try { writeKey(path, mintKey()); } catch (error) { message = String(error); }
      expect(message).toContain("Nothing was written");
      expect(message).not.toContain(secret);
      expect(readFileSync(path, "utf8")).toBe(contents);
    }
    const { path } = settingsFile("{}");
    expect(() => writeKey(path, "short")).toThrow();
  });
});
