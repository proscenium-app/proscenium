// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { EXAMPLE, LESSON_IDS, LESSONS } from "./lessons";

describe("the course's ids are the ones usage counts may name (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-95)", () => {
  test("every lesson, in course order", () => {
    expect(LESSONS.map((l) => l.id)).toEqual([...LESSON_IDS]);
  });

  test("the service takes exactly these lessons and steps, and nothing else", async () => {
    const events = await Bun.file(
      new URL("../../services/edge/events.json", import.meta.url),
    ).json();
    const steps = LESSONS.flatMap((l) => l.steps.map((s) => s.id));
    expect(new Set(steps).size).toBe(steps.length);
    expect(events.lesson_progress.props.lesson).toEqual([...LESSON_IDS]);
    expect(events.lesson_stopped.props.lesson).toEqual([...LESSON_IDS]);
    expect(events.lesson_stopped.props.step).toEqual(steps);
  });
});

describe("the bundled lines (docs/app/preferences-and-help/tutorials.md#TUT-11)", () => {
  test("are Hay Fever's opening, cue and speech in its order, ready to type", () => {
    expect([EXAMPLE.first, EXAMPLE.line, EXAMPLE.second, EXAMPLE.reply]).toEqual([
      "SOREL",
      "I wish she hadn't sent me the beastly book.",
      "SIMON",
      "The binding's very dashing.",
    ]);
    // Typed by hand, so plain keyboard apostrophes, never typographic ones.
    for (const text of Object.values(EXAMPLE)) expect(text).not.toMatch(/[‘’“”]/);
  });
});
