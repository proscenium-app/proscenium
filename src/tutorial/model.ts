// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

export type Outcome = "tried" | "demonstrated" | "skipped";
/** One lesson's place in one practice play. Every lesson of a course shares the play, so its `id`. */
export interface Attempt {
  id: string; dir: string; session?: string; lesson: string; revision: number; step: string;
  status: "active" | "paused" | "finished" | "archived";
  outcomes: Record<string, Outcome>; createdAt: string;
}
/** The practice play the lessons are writing (docs/app/keeping-work/storage-and-file-format.md#STOR-176). */
export interface Course { id: string; dir: string; session?: string }
export interface TutorialState { version: 1; invitation: "new" | "seen" | "dismissed"; moreHelp: boolean; attempts: Attempt[]; course: Course | null }
export const emptyState = (): TutorialState => ({version: 1, invitation: "new", moreHelp: false, attempts: [], course: null});
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const word = (v: unknown): v is string => typeof v === "string" && v !== "." && v !== ".." && v.length > 0 && v.length <= 240 && !/[\x00-\x1f/\\]/.test(v);
const sessionOk = (a: Record<string, unknown>) => a.session === undefined || (a.dir === "Practice Play" && typeof a.session === "string" && /^[A-Z0-9]{26}$/.test(a.session));
const unreadable = "Your saved tutorial place could not be read. Practice files have been kept.";

/** Unknown/corrupt progress is never quietly replaced. Practice lives independently. */
export function decodeProgress(text: string | null): TutorialState {
  if (text === null) return emptyState();
  const v: unknown = JSON.parse(text);
  if (!record(v) || v.version !== 1 || !Array.isArray(v.attempts) || typeof v.moreHelp !== "boolean") throw new Error(unreadable);
  if (v.invitation !== undefined && (typeof v.invitation !== "string" || !["new", "seen", "dismissed"].includes(v.invitation))) throw new Error("Your tutorial invitation could not be read. Practice files have been kept.");
  const attempts = v.attempts.map((a): Attempt => {
    if (!record(a) || !word(a.id) || !word(a.dir) || !word(a.lesson) || !word(a.step) || !Number.isInteger(a.revision) || !sessionOk(a)
      || typeof a.status !== "string" || !["active", "paused", "finished", "archived"].includes(String(a.status)) || !record(a.outcomes) || typeof a.createdAt !== "string") throw new Error(unreadable);
    for (const [key, value] of Object.entries(a.outcomes)) if (!word(key) || typeof value !== "string" || !["tried", "demonstrated", "skipped"].includes(String(value))) throw new Error("A saved tutorial step could not be read. Practice files have been kept.");
    return {...a, status: a.status === "active" ? "paused" : a.status} as unknown as Attempt;
  });
  let course: Course | null = null;
  if (v.course !== undefined && v.course !== null) {
    if (!record(v.course) || !word(v.course.id) || !word(v.course.dir) || !sessionOk(v.course)) throw new Error(unreadable);
    course = {id: v.course.id, dir: v.course.dir, ...(v.course.session ? {session: v.course.session as string} : {})};
  } else {
    // Progress from before the course: the lessons continue the play last practised in.
    const last = [...attempts].reverse().find(a => a.status !== "archived");
    if (last) course = {id: last.id, dir: last.dir, ...(last.session ? {session: last.session} : {})};
  }
  return {version: 1, invitation: (v.invitation ?? "new") as TutorialState["invitation"], moreHelp: v.moreHelp, attempts, course};
}

export function rememberOutcome(attempt: Attempt, step: string, outcome: Outcome): Attempt {
  const existing = attempt.outcomes[step];
  // Replaying a skipped or demonstrated step independently records the stronger result.
  const next = existing === "tried" ? existing : outcome;
  return {...attempt, outcomes: {...attempt.outcomes, [step]: next}};
}

/** Clearing lesson marks never removes an attempt, forgets the practice play, or asks to show the welcome again. */
export function resetProgress(state: TutorialState): TutorialState {
  return {...emptyState(), invitation: "dismissed", course: state.course, attempts: state.attempts.map(a => ({...a, status: "archived", outcomes: {}}))};
}

/** Same lesson, same play. */
export const sameAttempt = (a: Pick<Attempt, "id" | "lesson">, b: Pick<Attempt, "id" | "lesson">) => a.id === b.id && a.lesson === b.lesson;
/** The newest record of a lesson that still counts: not archived by Reset. */
export const latest = (state: TutorialState, lesson: string) => [...state.attempts].reverse().find(a => a.lesson === lesson && a.status !== "archived") ?? null;
/** Put `attempt` last (the newest), pausing whatever else was active. */
export function activate(state: TutorialState, attempt: Attempt): TutorialState {
  return {...state, course: {id: attempt.id, dir: attempt.dir, ...(attempt.session ? {session: attempt.session} : {})},
    attempts: [...state.attempts.filter(x => !sameAttempt(x, attempt)).map(x => x.status === "active" ? {...x, status: "paused" as const} : x), attempt]};
}
