// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { describeUpdates, offeredTracks, restartProblem, slowerTrackNote, trackOfVersion } from "./updates";

const rust = readFileSync(new URL("../../src-tauri/src/updates.rs", import.meta.url), "utf8");
const ipc = readFileSync(new URL("../storage/ipc.ts", import.meta.url), "utf8");

describe("describeUpdates", () => {
  it("says which version this is before anything is known", () => {
    expect(describeUpdates({ kind: "idle" }, "0.9.0")).toBe("Proscenium 0.9.0.");
    expect(describeUpdates({ kind: "idle" }, null)).toBe("This version.");
  });

  it("tells a development build that it cannot check, rather than that it is current", () => {
    expect(describeUpdates({ kind: "unconfigured" }, "0.1.0")).toMatch(/can’t check for updates/);
    expect(describeUpdates({ kind: "unavailable" }, "1.0.0")).toMatch(/come from the App Store/);
  });

  it("gives download progress only when the size is known", () => {
    expect(describeUpdates({ kind: "downloading", version: "0.9.1", received: 50, total: 200 }, "0.9.0")).toBe(
      "Downloading Proscenium 0.9.1… 25%",
    );
    expect(describeUpdates({ kind: "downloading", version: "0.9.1", received: 50, total: null }, "0.9.0")).toBe(
      "Downloading Proscenium 0.9.1…",
    );
  });

  it("says a downloaded update is ready to install, and leaves the restart to its button", () => {
    expect(
      describeUpdates({ kind: "ready", version: "0.9.1", notes: null, publishedAt: null }, "0.9.0"),
    ).toBe("Proscenium 0.9.1 is ready to install.");
  });

  it("words each failure for the writer, never as the plugin's error", () => {
    const at = Date.UTC(2026, 8, 12, 15, 0);
    expect(describeUpdates({ kind: "failed", reason: "offline", message: "error sending request", checkedAt: at }, "0.9.0"))
      .toMatch(/^Couldn’t connect to check for updates\. Tried /);
    expect(describeUpdates({ kind: "failed", reason: "signature", message: "x", checkedAt: at }, "0.9.0"))
      .toMatch(/failed Proscenium’s security check.*Nothing was installed/);
  });
});

describe("restartProblem", () => {
  it("never leaves a writer wondering why nothing happened", () => {
    expect(restartProblem("unsaved")).toMatch(/haven’t finished saving/);
    expect(restartProblem("notReady")).toMatch(/no downloaded update/);
    expect(restartProblem({ failed: "Failed to move the new app into place" })).toMatch(/move the new app/);
  });
});

describe("the page and updates.rs agree", () => {
  it("on the event name", () => {
    const event = rust.match(/EVENT_STATE: &str = "([^"]+)"/)?.[1];
    expect(event).toBeTruthy();
    expect(ipc).toContain(`EVENT_UPDATE_STATE = "${event}"`);
  });

  it("on every state the Rust side can send", () => {
    const body = rust.slice(rust.indexOf("pub enum UpdateState"), rust.indexOf("pub enum FailReason"));
    const variants = [...body.matchAll(/^\s{4}([A-Z][A-Za-z]+)\b/gm)].map((m) => m[1][0].toLowerCase() + m[1].slice(1));
    expect(variants.length).toBeGreaterThan(5);
    for (const kind of variants) expect(ipc).toContain(`kind: "${kind}"`);
  });

  it("on the releases address, which only Rust holds", () => {
    // docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D2: every address is in telemetry/allowlist.rs.
    expect(rust).toContain("const RELEASES: &str = crate::telemetry::allowlist::RELEASES;");
    expect(ipc).not.toMatch(/https?:\/\/[a-z0-9]/i);
  });
});

describe("tracks", () => {
  it("reads the track from the version's pre-release", () => {
    expect(trackOfVersion("1.0.1-alpha.57")).toBe("alpha");
    expect(trackOfVersion("1.0.1-beta.2")).toBe("beta");
    expect(trackOfVersion("1.0.0")).toBe("stable");
    expect(trackOfVersion("1.0.1-rc.1")).toBe("stable");
  });

  it("says a slower track waits only while that is true", () => {
    expect(slowerTrackNote("stable", "1.0.1-alpha.57")).toBe(
      "Proscenium never installs an older version, so Stable updates install once one is newer than 1.0.1-alpha.57.",
    );
    expect(slowerTrackNote("beta", "1.0.1-alpha.57")).toMatch(/^Proscenium never installs an older version, so Beta updates/);
    expect(slowerTrackNote("stable", "1.0.1-beta.2")).toMatch(/Stable updates install once one is newer than 1\.0\.1-beta\.2\.$/);
    for (const [track, version] of [
      ["alpha", "1.0.1-alpha.57"],
      ["alpha", "1.0.0"],
      ["beta", "1.0.1-beta.2"],
      ["alpha", "1.0.1-beta.2"],
      ["stable", "1.0.0"],
      ["stable", null],
    ] as const) {
      expect(slowerTrackNote(track, version)).toBeNull();
    }
  });
});

describe("offeredTracks", () => {
  it("offers Stable and Beta, and Alpha only with its key or to a copy already on it (docs/app/preferences-and-help/settings.md#SET-37)", () => {
    expect(offeredTracks("aarch64", "stable", false)).toEqual(["stable", "beta"]);
    expect(offeredTracks("aarch64", "stable", true)).toEqual(["stable", "beta", "alpha"]);
    expect(offeredTracks("aarch64", "alpha", false)).toEqual(["stable", "beta", "alpha"]);
    expect(offeredTracks(null, "beta", false)).toEqual(["stable", "beta"]);
  });

  it("offers an Intel Mac Stable alone, whatever it holds (docs/app/preferences-and-help/settings.md#SET-40)", () => {
    for (const track of ["stable", "beta", "alpha"] as const) {
      expect(offeredTracks("x86_64", track, true)).toEqual(["stable"]);
      expect(offeredTracks("x86_64", track, false)).toEqual(["stable"]);
    }
  });
});
