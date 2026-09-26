// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A line for jobs that must not overlap: each starts when the one before it
 * has finished, in the order they were asked for.
 *
 * The workspace has one vault scope. Opening a play, going back to the Plays
 * screen, choosing a Plays folder and making a play each close what is open and
 * reopen the vault somewhere else, over several awaits. Two of them at once — a
 * play opened from Finder while launch walks into the last play, an `.fdx`
 * becoming a play while the writer clicks a row — interleave those steps,
 * and the binder of one play ends up over the folder of another. In a line,
 * the last one asked for is simply the one left open.
 *
 * A job that fails does not stop the ones behind it; its caller still gets the
 * failure.
 */
export type Line = <T>(job: () => Promise<T>) => Promise<T>;

export function oneAtATime(): Line {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(job: () => Promise<T>): Promise<T> => {
    const run = tail.then(job, job);
    tail = run.catch(() => undefined);
    return run;
  };
}
