// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import {
  classifyOpened,
  inPlaysFolder,
  isInside,
  samePath,
  type OpenedFacts,
} from "./open-route";

const PLAYS = "/Users/w/Library/Mobile Documents/com~apple~CloudDocs/Plays";
const TIDE = `${PLAYS}/The Tide`;

function facts(path: string, patch: Partial<OpenedFacts> = {}): OpenedFacts {
  return { path, exists: true, isDir: false, playDirs: [], ...patch };
}
const tidePlay = [{ dir: TIDE, playFiles: ["The Tide.proscenium"] }];

describe("what a file opened from Finder is", () => {
  it("a play file is its play, in the Plays folder around it", () => {
    expect(classifyOpened(facts(`${TIDE}/The Tide.proscenium`, { playDirs: tidePlay }))).toEqual({
      kind: "play",
      playDir: TIDE,
      playsFolder: PLAYS,
      dirName: "The Tide",
    });
  });

  it("a play's own folder is the play too", () => {
    expect(classifyOpened(facts(TIDE, { isDir: true, playDirs: tidePlay })).kind).toBe("play");
  });

  it("a script inside a play opens that play with the script in front", () => {
    const route = classifyOpened(
      facts(`${TIDE}/Scenes/Draft two.fountain`, { playDirs: tidePlay }),
    );
    expect(route).toEqual({
      kind: "script-in-play",
      script: "Scenes/Draft two.fountain",
      playDir: TIDE,
      playsFolder: PLAYS,
      dirName: "The Tide",
    });
  });

  it("the nearest play wins when plays are nested", () => {
    const inner = `${TIDE}/Old/Lear`;
    const route = classifyOpened(
      facts(`${inner}/Lear.fountain`, {
        playDirs: [{ dir: inner, playFiles: ["Lear.proscenium"] }, ...tidePlay],
      }),
    );
    expect(route.kind === "script-in-play" && route.playDir).toBe(inner);
  });

  it("a script no play holds is a loose script", () => {
    expect(classifyOpened(facts("/Users/w/Downloads/Draft.fountain"))).toEqual({
      kind: "loose-script",
      path: "/Users/w/Downloads/Draft.fountain",
      name: "Draft.fountain",
    });
  });

  it("an .fdx becomes a new play, and knows when a play keeps it", () => {
    expect(classifyOpened(facts("/Users/w/Downloads/Hamlet.fdx"))).toEqual({
      kind: "final-draft",
      path: "/Users/w/Downloads/Hamlet.fdx",
      name: "Hamlet.fdx",
      inPlay: null,
    });
    const kept = classifyOpened(facts(`${TIDE}/The Tide.fdx`, { playDirs: tidePlay }));
    expect(kept.kind === "final-draft" && kept.inPlay?.playDir).toBe(TIDE);
  });

  it("extensions are read the way Finder reads them, whatever the case", () => {
    expect(classifyOpened(facts("/Users/w/Downloads/HAMLET.FDX")).kind).toBe("final-draft");
    expect(classifyOpened(facts("/Users/w/Downloads/Draft.Fountain")).kind).toBe("loose-script");
  });

  it("anything else is unknown — including a file that has gone, and a plain folder", () => {
    expect(classifyOpened(facts("/Users/w/Downloads/photo.jpg")).kind).toBe("unknown");
    expect(classifyOpened(facts("/Users/w/Downloads/README")).kind).toBe("unknown");
    expect(classifyOpened(facts(`${TIDE}/The Tide.proscenium`, { exists: false })).kind).toBe(
      "unknown",
    );
    expect(classifyOpened(facts(`${PLAYS}`, { isDir: true })).kind).toBe("unknown");
    // A folder INSIDE a play is not the play.
    expect(classifyOpened(facts(`${TIDE}/Scenes`, { isDir: true, playDirs: tidePlay })).kind).toBe(
      "unknown",
    );
  });

  it("a hidden play-file lookalike is not a play", () => {
    const route = classifyOpened(facts(`${TIDE}/.The Tide.proscenium.1a2b.tmp`, { playDirs: tidePlay }));
    expect(route.kind).toBe("unknown");
  });

  it("documents use import review; a kept source opens its existing play", () => {
    for (const ext of ["docx", "odt", "rtf", "txt", "md", "pages", "wdz", "scrivx", "pdf"]) {
      const loose = classifyOpened(facts(`/Users/w/Downloads/Draft.${ext}`));
      expect(loose.kind).toBe("document-import");
      const kept = classifyOpened(facts(`${TIDE}/Originals/Draft.${ext}`, { playDirs: tidePlay }));
      expect(kept.kind === "document-import" && kept.inPlay?.playDir).toBe(TIDE);
    }
    expect(classifyOpened(facts("/Users/w/Downloads/Draft.scriv", { isDir: true })).kind).toBe("document-import");
  });
});

describe("whether it is in the Plays folder that is open", () => {
  const route = classifyOpened(facts(`${TIDE}/The Tide.proscenium`, { playDirs: tidePlay }));
  const play = route.kind === "play" ? route : null;

  it("is when its folder sits directly in the open Plays folder", () => {
    expect(play && inPlaysFolder(play, PLAYS)).toBe(true);
    expect(play && inPlaysFolder(play, `${PLAYS}/`)).toBe(true);
  });

  it("is not in another folder, deeper down, or with no Plays folder open", () => {
    expect(play && inPlaysFolder(play, "/Users/w/Dropbox/Plays")).toBe(false);
    expect(play && inPlaysFolder(play, "/Users/w/Library/Mobile Documents")).toBe(false);
    expect(play && inPlaysFolder(play, null)).toBe(false);
  });
});

describe("paths compared the way the Mac compares them", () => {
  it("ignores a trailing slash, case, and composed versus decomposed letters", () => {
    expect(samePath("/Users/w/Plays/", "/users/W/plays")).toBe(true);
    const composed = "/Users/w/Pièces";
    const decomposed = "/Users/w/Pièces";
    expect(composed).not.toBe(decomposed);
    expect(samePath(composed, decomposed)).toBe(true);
    expect(samePath("/Users/w/Plays", "/Users/w/Plays 2")).toBe(false);
  });

  it("knows inside from beside", () => {
    expect(isInside("/Users/w/Plays/Old", "/Users/w/Plays")).toBe(true);
    expect(isInside("/Users/w/Plays", "/Users/w/Plays")).toBe(false);
    expect(isInside("/Users/w/Plays 2", "/Users/w/Plays")).toBe(false);
  });
});
