// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { onOwnWrite, sendingWrite, vaultOpenedAt, type OwnWrite } from "./own-writes";

describe("the app's own writes", () => {
  const heard: OwnWrite[] = [];
  const stop = onOwnWrite((write) => heard.push(write));
  afterEach(() => {
    heard.length = 0;
    vaultOpenedAt(null);
  });
  afterAll(stop);

  it("a write that lands is reported for the play it was sent to", () => {
    vaultOpenedAt("THE-WEIGHT-OF-WATER");
    sendingWrite("Characters/charlie.md", "## Appearances\n\n- SCENE 3\n")(true);
    expect(heard).toEqual([
      {
        playId: "THE-WEIGHT-OF-WATER",
        rel: "Characters/charlie.md",
        content: "## Appearances\n\n- SCENE 3\n",
      },
    ]);
  });

  it("a write that collides or is refused is not", () => {
    vaultOpenedAt("THE-WEIGHT-OF-WATER");
    sendingWrite("v2.fountain", "words that did not land")(false);
    expect(heard).toEqual([]);
  });

  it("a write still out when another play opens belongs to the play it was sent to", () => {
    vaultOpenedAt("HARBOUR-LIGHTS");
    const landed = sendingWrite("Notes/Outline.md", "sent while Harbour Lights was open");
    vaultOpenedAt(null);
    vaultOpenedAt("THE-LONG-FIELD");
    landed(true);
    expect(heard.map((write) => write.playId)).toEqual(["HARBOUR-LIGHTS"]);
  });

  it("the Plays folder, or a play still opening, belongs to no play", () => {
    sendingWrite("Second Act/Second Act.fountain", "a new play's first script")(true);
    expect(heard).toEqual([]);
  });

  it("a follower that throws neither stops the others nor fails the write", () => {
    const stopThrowing = onOwnWrite(() => {
      throw new Error("bookkeeping failed");
    });
    const after: string[] = [];
    const stopAfter = onOwnWrite((write) => after.push(write.rel));
    try {
      vaultOpenedAt("SECOND-ACT");
      expect(() => sendingWrite("Second Act.fountain", "FADE IN:")(true)).not.toThrow();
      expect(after).toEqual(["Second Act.fountain"]);
      expect(heard.map((write) => write.rel)).toEqual(["Second Act.fountain"]);
    } finally {
      stopThrowing();
      stopAfter();
    }
  });
});
