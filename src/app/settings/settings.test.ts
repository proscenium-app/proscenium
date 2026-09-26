// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The section list's keys, and the launch decision: which play, if any, the
 * app walks into when it opens.
 */
import { describe, expect, it } from "bun:test";
import type { VaultPlay } from "../../workspace";
import { launchPlay, launchStep, leftOff, openPlay } from "./launch";
import { SETTINGS_SECTIONS, stepSection } from "./sections";

describe("the section list", () => {
  it("is the spec's sections, in its order", () => {
    expect(SETTINGS_SECTIONS.map((s) => s.label)).toEqual([
      "General",
      "Appearance",
      "Writing",
      "Formats",
      "Keyboard Shortcuts",
      "Help & Feedback",
      "Privacy",
      "Updates",
      "About",
    ]);
  });

  it("steps with ↑ and ↓, wraps at the ends, and jumps with Home and End", () => {
    expect(stepSection("general", "ArrowDown")).toBe("appearance");
    expect(stepSection("appearance", "ArrowUp")).toBe("general");
    expect(stepSection("general", "ArrowUp")).toBe("about");
    expect(stepSection("about", "ArrowDown")).toBe("general");
    expect(stepSection("writing", "Home")).toBe("general");
    expect(stepSection("writing", "End")).toBe("about");
  });

  it("leaves every other key alone", () => {
    for (const key of ["ArrowLeft", "ArrowRight", "Tab", "Enter", " ", "a"]) {
      expect(stepSection("writing", key)).toBeNull();
    }
  });
});

const PLAYS: VaultPlay[] = [
  {
    dir: "The Lighthouse",
    title: "The Lighthouse",
    id: "01HLIGHTHOUSE",
    file: "The Lighthouse.proscenium",
  },
  {
    dir: "The Weight of Water",
    title: "The Weight of Water",
    id: "01HWEIGHT",
    file: "The Weight of Water.proscenium",
  },
];
const BASE = "/Users/writer/Plays";

describe("which play is open", () => {
  it("is the play whose folder the vault is open at", () => {
    expect(openPlay(`${BASE}/The Weight of Water`, BASE, PLAYS)?.id).toBe("01HWEIGHT");
    expect(openPlay(`${BASE}/The Weight of Water/`, `${BASE}/`, PLAYS)?.id).toBe("01HWEIGHT");
  });

  it("is none at the Plays folder itself — including a launch's in-between render", () => {
    expect(openPlay(BASE, BASE, PLAYS)).toBeNull();
    expect(openPlay(null, BASE, PLAYS)).toBeNull();
    expect(openPlay(`${BASE}/Somewhere Else`, BASE, PLAYS)).toBeNull();
  });
});

describe("what launch opens", () => {
  const launch = {
    openAtLaunch: "lastPlay" as const,
    lastPlay: "01HWEIGHT",
    vaultRoot: BASE,
    launchVault: BASE,
    plays: PLAYS,
  };

  it("walks into the last play when asked to", () => {
    expect(launchPlay(launch)?.dir).toBe("The Weight of Water");
  });

  it("stays on the Plays screen when asked to", () => {
    expect(launchPlay({ ...launch, openAtLaunch: "plays" })).toBeNull();
  });

  it("stays when there is no last play, or it has gone from the folder", () => {
    expect(launchPlay({ ...launch, lastPlay: null })).toBeNull();
    expect(launchPlay({ ...launch, lastPlay: "01HGONE" })).toBeNull();
  });

  it("never follows a folder chosen by hand", () => {
    // Not the folder the app reopened, or no folder was reopened at all.
    expect(launchPlay({ ...launch, vaultRoot: "/Users/writer/Other Plays" })).toBeNull();
    expect(launchPlay({ ...launch, launchVault: null })).toBeNull();
  });
});

describe("where a launch stands", () => {
  // The first render of a launch that will reopen The Weight of Water.
  const start = {
    booted: false,
    practicing: false,
    playOpen: false,
    root: null,
    mode: "picker",
    vaultRoot: null,
    settingsLoaded: false,
    launchVault: undefined,
  };
  const reopened = {
    ...start,
    root: BASE,
    vaultRoot: BASE,
    settingsLoaded: true,
    launchVault: BASE,
  };

  it("waits while the folder reopens — the Welcome screen is not where it ends", () => {
    expect(launchStep(start)).toBe("waiting");
    expect(launchStep({ ...start, settingsLoaded: true, launchVault: BASE })).toBe("waiting");
  });

  it("waits for the reopened folder's plays: open is not listed", () => {
    // The shell is on the Plays screen's mode from the start, so the mode says
    // nothing; a choice made here would find no plays and stay.
    expect(launchStep({ ...reopened, booted: false })).toBe("waiting");
  });

  it("waits for settings.json and the last folder before choosing", () => {
    expect(launchStep({ ...reopened, booted: true, settingsLoaded: false })).toBe("waiting");
    expect(launchStep({ ...reopened, booted: true, launchVault: undefined })).toBe("waiting");
  });

  it("chooses once the Plays folder has listed its plays and both have answered", () => {
    expect(launchStep({ ...reopened, booted: true })).toBe("decide");
  });

  it("has arrived at the Welcome screen when no folder came back", () => {
    expect(launchStep({ ...start, booted: true, settingsLoaded: true, launchVault: null })).toBe(
      "arrived",
    );
    expect(launchStep({ ...start, booted: true })).toBe("arrived");
  });

  it("has arrived when a play is open already", () => {
    expect(launchStep({ ...reopened, root: `${BASE}/The Weight of Water`, playOpen: true })).toBe(
      "arrived",
    );
    expect(launchStep({ ...start, practicing: true })).toBe("arrived");
  });
});

describe("where the writer left off", () => {
  it("is the play open, written down once", () => {
    expect(leftOff({ open: "01HWEIGHT", left: null, mode: "workspace", lastPlay: null })).toEqual({
      left: "01HWEIGHT",
      lastPlay: "01HWEIGHT",
    });
    expect(
      leftOff({ open: "01HWEIGHT", left: "01HWEIGHT", mode: "workspace", lastPlay: "01HWEIGHT" }),
    ).toEqual({
      left: "01HWEIGHT",
    });
  });

  it("is the Plays screen once the writer goes back to it — not a moment before", () => {
    // The Plays folder reopens a render before the Plays screen shows.
    const between = leftOff({
      open: null,
      left: "01HWEIGHT",
      mode: "workspace",
      lastPlay: "01HWEIGHT",
    });
    expect(between).toEqual({ left: "01HWEIGHT" });
    expect(
      leftOff({ open: null, left: between.left, mode: "picker", lastPlay: "01HWEIGHT" }),
    ).toEqual({
      left: null,
      lastPlay: null,
    });
  });

  it("is left alone at launch, before any play has been open", () => {
    // A launch reopens the Plays folder first, holding the play to go back to.
    expect(leftOff({ open: null, left: null, mode: "picker", lastPlay: "01HWEIGHT" })).toEqual({
      left: null,
    });
  });
});
