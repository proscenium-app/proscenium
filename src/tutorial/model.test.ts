// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import {
  activate,
  decodeProgress,
  emptyState,
  latest,
  rememberOutcome,
  resetProgress,
  sameAttempt,
  type Attempt,
} from "./model";
import { LESSONS, lessonById, nextLesson } from "./lessons";
import { parse } from "../fountain";
import { COURSE_SEED } from "./lessons";

const attempt: Attempt = {
  id: "one",
  dir: "Practice",
  lesson: "first-exchange",
  revision: 1,
  step: "speaker",
  status: "active",
  outcomes: {},
  createdAt: "2026-09-18",
};
const session = "01J00000000000000000000001";
describe("retained tutorial progress", () => {
  test("relaunch pauses navigation without dropping words' folder or step outcomes", () => {
    const state = { ...emptyState(), attempts: [rememberOutcome(attempt, "speaker", "skipped")] };
    const loaded = decodeProgress(JSON.stringify(state));
    expect(loaded.attempts[0]).toEqual({ ...state.attempts[0], status: "paused" });
    expect(rememberOutcome(loaded.attempts[0], "speaker", "tried").outcomes.speaker).toBe("tried");
    expect(
      rememberOutcome({ ...attempt, outcomes: { speaker: "tried" } }, "speaker", "demonstrated")
        .outcomes.speaker,
    ).toBe("tried");
  });
  test("unknown progress and path escapes are refused, not reset", () => {
    for (const text of [
      '{"version":2}',
      "broken",
      JSON.stringify({ ...emptyState(), attempts: [{ ...attempt, dir: "../Plays" }] }),
      JSON.stringify({ ...emptyState(), course: { id: "x", dir: "../Plays" } }),
      JSON.stringify({
        ...emptyState(),
        course: { id: "x", dir: "Practice Play", session: "../x" },
      }),
    ])
      expect(() => decodeProgress(text)).toThrow();
  });
});

describe("one practice play for the course (docs/app/preferences-and-help/tutorials.md#TUT-10)", () => {
  test("the course's play survives a relaunch", () => {
    const course = { id: "play", dir: "Practice Play", session };
    expect(decodeProgress(JSON.stringify({ ...emptyState(), course })).course).toEqual(course);
    expect(decodeProgress(null).course).toBeNull();
  });
  test("progress from before the course continues the play last practised in", () => {
    const old = {
      version: 1,
      invitation: "seen",
      moreHelp: false,
      attempts: [
        { ...attempt, id: "a", dir: "Earlier" },
        { ...attempt, id: "b", dir: "Practice Play", session, lesson: "format", step: "emphasis" },
        { ...attempt, id: "c", dir: "Reset", status: "archived" },
      ],
    };
    expect(decodeProgress(JSON.stringify(old)).course).toEqual({
      id: "b",
      dir: "Practice Play",
      session,
    });
  });
  test("every lesson of a course shares its play, one record per lesson", () => {
    let state = emptyState();
    const first = { ...attempt, id: "play", dir: "Practice Play", session };
    state = activate(state, first);
    const second = { ...first, lesson: "format", step: "emphasis" };
    state = activate(state, second);
    expect(state.course).toEqual({ id: "play", dir: "Practice Play", session });
    expect(state.attempts.map((a) => [a.lesson, a.status])).toEqual([
      ["first-exchange", "paused"],
      ["format", "active"],
    ]);
    // Starting a lesson again in the same play replaces its record, keeping the other lesson's.
    state = activate(state, { ...first, step: "reply", status: "active" });
    expect(state.attempts.filter((a) => a.lesson === "first-exchange").length).toBe(1);
    expect(state.attempts[state.attempts.length - 1].step).toBe("reply");
    const moved: Attempt = { ...first, step: "line" };
    expect(sameAttempt(first, moved)).toBe(true);
    expect(sameAttempt(first, second)).toBe(false);
  });
  test("reset clears marks but keeps every attempt, the course's play and the dismissed welcome", () => {
    const state = {
      ...activate(emptyState(), { ...attempt, outcomes: { speaker: "tried" } }),
      invitation: "seen" as const,
    };
    const reset = resetProgress(state);
    expect(reset.course).toEqual(state.course);
    expect(reset.invitation).toBe("dismissed");
    expect(
      reset.attempts.every((a) => a.status === "archived" && Object.keys(a.outcomes).length === 0),
    ).toBe(true);
    expect(latest(reset, "first-exchange")).toBeNull();
    expect(latest(state, "first-exchange")?.outcomes.speaker).toBe("tried");
  });
});

describe("the course, in order", () => {
  test("six lessons, each followed by the next, the last by none", () => {
    expect(LESSONS.map((l) => l.id)).toEqual([
      "first-exchange",
      "format",
      "scene-cards",
      "characters",
      "files",
      "export",
    ]);
    for (let i = 0; i < LESSONS.length - 1; i++)
      expect(nextLesson(LESSONS[i].id)).toBe(LESSONS[i + 1]);
    expect(nextLesson("export")).toBeNull();
    expect(lessonById("nope")).toBeNull();
  });
  test("the play every lesson starts from is a scene with room to write", () => {
    const { doc, frontMatter } = parse(COURSE_SEED);
    expect(frontMatter.title).toBe("Practice Play");
    expect(doc.content.map((b) => b.type)).toEqual(["scene"]);
  });
  test("a lesson that works on a speech says so, so it is whole when opened first", () => {
    expect(LESSONS.filter((l) => l.needsExchange).map((l) => l.id)).toEqual([
      "format",
      "characters",
      "export",
    ]);
  });
  test("the first two steps make a cue and its dialogue; typing steps carry forward on a skip", () => {
    const [first] = LESSONS;
    expect(first.steps.slice(0, 2).map((s) => s.id)).toEqual(["speaker", "line"]);
    expect(first.steps.filter((s) => s.carries).map((s) => s.id)).toEqual([
      "speaker",
      "line",
      "speaker-two",
    ]);
    expect(
      LESSONS.flatMap((l) => l.steps)
        .filter((s) => s.look)
        .map((s) => s.id),
    ).toEqual(["saved", "export-preview"]);
  });
  test("the export lesson names the dialog's own buttons", () => {
    // The last hint said "Save PDF"; the dialog's buttons are Export PDF… and Print… (src/app/ExportPanel.tsx).
    const steps = lessonById("export")!.steps;
    const last = steps[steps.length - 1];
    expect(last.id).toBe("export-preview");
    expect(last.help).toContain("Export PDF…");
    expect(last.help).toContain("Print…");
    for (const step of LESSONS.flatMap((l) => l.steps))
      expect(`${step.title} ${step.help}`).not.toContain("Save PDF");
  });
});
