// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Updates on the page's side (docs/engineering/release-engineering.md#REL-D6). updates.rs checks,
 * downloads and installs; this keeps its state in one place, words it, and
 * owns the one decision the page makes — when to restart.
 *
 * **One subscription for the whole app.** Every component that shows update
 * state reads this store rather than listening itself: a listener registered
 * in an effect with an async unlisten is the leak this codebase has fixed
 * twice (verification-harness notes), and an update event needs no more than
 * one listener.
 *
 * **Never restarts on its own.** The notice offers "Restart to Update", and a
 * restart flushes the open play's pending edits first. updates.rs then refuses
 * while the unsaved-work beacon still says dirty, so this retries for a few
 * seconds while the save lands, and says plainly if it never does.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import { updates, type UpdateState } from "../storage/ipc";
import { UPDATE_TRACKS, type UpdateTrack } from "../storage/settings-model";
import { announce, useToast } from "../ui";
import { UpdateRestart, type RestartResult } from "./update-restart";
import { lockForUpdate } from "./update-lock";
export type { RestartResult } from "./update-restart";

let current: UpdateState = { kind: "idle" };
const listeners = new Set<() => void>();
let started = false;

function publish(next: UpdateState) {
  current = next;
  for (const l of listeners) l();
}

function start() {
  if (started) return;
  started = true;
  void updates.state().then((s) => {
    // An event may have landed first; a fresher state wins over the first read.
    if (current.kind === "idle") publish(s);
  });
  void updates.onState(publish);
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The updater's state, kept current by one app-wide subscription. */
export function useUpdateState(): UpdateState {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => current,
  );
}

/** Check Now, and the menu's "Check for Updates…". */
export async function checkForUpdatesNow(): Promise<void> {
  start();
  if (
    current.kind === "checking" ||
    current.kind === "downloading" ||
    current.kind === "ready" ||
    current.kind === "installing"
  )
    return;
  publish({ kind: "checking" });
  publish(await updates.check());
}

/**
 * How the open workspace settles before a restart; set by App. The same
 * settle a quit waits on: what can land lands, and words that
 * could be kept nowhere hold the restart, as they hold a quit.
 */
let settleEdits: () => Promise<{ lost: string[]; leave: () => Promise<void> } | void> =
  async () => {};
let confirmSaved: () => Promise<void> = async () => {
  throw new Error("The workspace has not confirmed its save state.");
};
const restart = new UpdateRestart();

/**
 * Flush, then install and relaunch. Resolves only when the restart did NOT
 * happen, with why: a successful restart never returns to the page.
 */
export function restartToUpdate(): Promise<RestartResult> {
  return restart.run({
    lock: lockForUpdate,
    settle: settleEdits,
    confirmSaved,
    restart: updates.restart,
  });
}

/** A sentence for a restart that did not happen. */
export function restartProblem(result: RestartResult): string {
  if (result === "unsaved") {
    return "Your latest changes haven’t finished saving, so Proscenium didn’t restart. Try again in a moment.";
  }
  if (result === "notReady") return "There’s no downloaded update to install yet.";
  if (result === "installing") return "Proscenium is already installing the update.";
  return `The update couldn’t be installed: ${result.failed}`;
}

/**
 * The quiet notice, once per downloaded version, and the restart it offers.
 * Called once, by App, with the workspace's flush.
 */
export function useUpdateNotices(settle: typeof settleEdits, confirm: typeof confirmSaved): void {
  const toast = useToast();
  const state = useUpdateState();
  const told = useRef<string | null>(null);

  useEffect(() => {
    settleEdits = settle;
    confirmSaved = confirm;
  }, [settle, confirm]);

  useEffect(() => {
    if (state.kind !== "ready" || told.current === state.version) return;
    told.current = state.version;
    toast({
      kind: "plain",
      title: `Proscenium ${state.version} is ready to install`,
      ms: 12000,
      action: {
        label: "Restart to Update",
        run: () =>
          void restartToUpdate().then((result) => {
            toast({
              kind: "error",
              title: "Proscenium didn’t restart",
              detail: restartProblem(result),
              code: "E-UPDATE-RESTART",
            });
          }),
      },
    });
  }, [state, toast]);
}

/** What the state means, in a sentence for Settings › Updates. */
export function describeUpdates(state: UpdateState, version: string | null): string {
  const self = version ? `Proscenium ${version}` : "This version";
  const when = (ms: number) =>
    new Date(ms).toLocaleString(undefined, { weekday: "long", hour: "numeric", minute: "2-digit" });
  switch (state.kind) {
    case "idle":
      return `${self}.`;
    case "unconfigured":
      return `${self}. This copy can’t check for updates.`;
    case "unavailable":
      return `${self}. Updates for this copy come from the App Store.`;
    case "checking":
      return "Checking for updates…";
    case "upToDate":
      return `${self} is up to date. Checked ${when(state.checkedAt)}.`;
    case "downloading": {
      const pct = state.total ? ` ${Math.round((state.received / state.total) * 100)}%` : "";
      return `Downloading Proscenium ${state.version}…${pct}`;
    }
    case "ready":
      return `Proscenium ${state.version} is ready to install.`;
    case "installing":
      return `Installing Proscenium ${state.version}…`;
    case "failed":
      if (state.reason === "offline")
        return `Couldn’t connect to check for updates. Tried ${when(state.checkedAt)}.`;
      if (state.reason === "noKey")
        return `${self}. Alpha needs a key, so this copy didn’t check for updates.`;
      if (state.reason === "signature") {
        return "An update failed Proscenium’s security check and was discarded. Nothing was installed.";
      }
      return `Couldn’t check for updates: ${state.message}`;
  }
}

/** Each track's name, as Settings › Updates shows it. */
export const TRACK_LABELS: Record<UpdateTrack, string> = {
  stable: "Stable",
  beta: "Beta",
  alpha: "Alpha",
};

/**
 * The tracks Settings › Updates offers. Alpha only to a copy that holds its key
 * or is on it already (docs/app/preferences-and-help/settings.md#SET-37), so
 * nobody's choice vanishes from under them. An Intel Mac is offered Stable
 * alone (docs/app/preferences-and-help/settings.md#SET-40): alpha and beta are
 * built for Apple silicon only, and the app follows stable there whatever was
 * stored.
 */
export function offeredTracks(
  arch: string | null | undefined,
  current: UpdateTrack,
  hasKey: boolean,
): UpdateTrack[] {
  if (arch === "x86_64") return ["stable"];
  return UPDATE_TRACKS.filter((t) => t !== "alpha" || hasKey || current === "alpha");
}

/** What an Intel Mac is told in place of a track's sentence. */
export const INTEL_TRACK_NOTE =
  "Each new release. Test versions are made for Macs with Apple silicon only.";

/** Slowest first: a track's versions sort below the faster tracks' of the same release. */
const SPEED: Record<UpdateTrack, number> = { stable: 0, beta: 1, alpha: 2 };

/** The track a version came from: its pre-release names it (`X.Y.Z-alpha.N`, `X.Y.Z-beta.N`). */
export function trackOfVersion(version: string): UpdateTrack {
  if (/^\d+\.\d+\.\d+-alpha\.\d+$/.test(version)) return "alpha";
  if (/^\d+\.\d+\.\d+-beta\.\d+$/.test(version)) return "beta";
  return "stable";
}

/**
 * Said only while it is true (docs/app/preferences-and-help/settings.md#SET-37): this copy came from a
 * faster track than the one chosen, so nothing from the chosen one installs
 * until it passes the version already here.
 */
export function slowerTrackNote(track: UpdateTrack, version: string | null): string | null {
  if (!version || SPEED[trackOfVersion(version)] <= SPEED[track]) return null;
  return `Proscenium never installs an older version, so ${TRACK_LABELS[track]} updates install once one is newer than ${version}.`;
}

/** Speak a check's outcome: it changes a line the writer is not focused on. */
export function announceUpdates(state: UpdateState, version: string | null): void {
  if (state.kind === "checking" || state.kind === "idle" || state.kind === "downloading") return;
  announce(describeUpdates(state, version));
}
