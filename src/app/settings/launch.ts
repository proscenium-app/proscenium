// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Settings › General › "When Proscenium opens": where the writer left off (the
 * default since 2026-09-16), or the Plays screen.
 *
 * It sits on top of the workspace rather than inside its bootstrap. Launch
 * reopens the last Plays folder and lists its plays, exactly as it always has;
 * this waits for that and, when the writer asked for it, walks into the last
 * play from there. Two rules keep it from ever surprising anyone:
 *
 * - **Once per launch, and only for the launch.** The decision is taken once,
 *   when the folder the app reopened has listed its plays. Choosing a folder
 *   by hand, or coming back to All Plays later, is never followed by a jump
 *   into a play.
 * - **Anything that opens a play first wins.** If a play is already open when
 *   the decision would be taken — opened from Finder, say — nothing happens.
 *
 * It also keeps `lastPlay` current: whichever play is open is the one launch
 * goes back to, and a writer who leaves it for the Plays screen has left off
 * there, so `lastPlay` is cleared and launch opens the Plays screen: launch
 * reopens the page that was open when the app closed. A quit tears nothing
 * down, so quitting inside a play keeps it.
 *
 * And it says when the launch has ARRIVED, which is what the window shows
 * until then (App.tsx's launch screen). Getting back into a play passes
 * through screens on the way: the Welcome screen while the folder reopens, the
 * Plays screen while the play opens, and then the play itself before it is
 * ready: an empty page while the script is read, the first page before the
 * page layout lands, and a jump to where the writer left off. Each showed for
 * an instant on every launch, so Proscenium opened on a flicker and then
 * jumped, when it should just open into the play. So a
 * launch into a play arrives when the play is IN PLACE — read, laid out and at
 * the writer's place — not when it is open.
 */
import { useEffect, useRef, useState } from "react";
import { settings as ipc } from "../../storage";
import type { VaultPlay } from "../../workspace";
import type { OpenAtLaunch } from "../../storage/settings-model";
import { updateSettings, useSettings, useSettingsLoaded } from "./store";

function trimSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/**
 * The play whose folder is open, if one is. The workspace opens a play by
 * reopening the vault at `<Plays folder>/<dir>`; at the Plays folder itself —
 * including the in-between render of a launch, when the folder is open and the
 * Plays screen not yet shown — no play matches.
 */
export function openPlay(
  root: string | null,
  vaultRoot: string | null,
  plays: readonly VaultPlay[],
): VaultPlay | null {
  if (!root || !vaultRoot) return null;
  const at = trimSlash(root);
  const base = trimSlash(vaultRoot);
  if (at === base) return null;
  return plays.find((p) => `${base}/${p.dir}` === at) ?? null;
}

/**
 * What `lastPlay` becomes after a render. `open` is the play open now, `left`
 * the one the writer was last in. Leaving a play takes renders — the Plays
 * folder reopens before the Plays screen shows — so the play is remembered
 * until the Plays screen arrives, and only then is `lastPlay` cleared.
 */
export function leftOff(state: {
  open: string | null;
  left: string | null;
  mode: string;
  lastPlay: string | null;
}): { left: string | null; lastPlay?: string | null } {
  if (state.open) {
    return state.open === state.lastPlay ? { left: state.open } : { left: state.open, lastPlay: state.open };
  }
  if (state.left && state.mode === "picker") {
    return state.lastPlay === null ? { left: null } : { left: null, lastPlay: null };
  }
  return { left: state.left };
}

/** The play launch should walk into, or null to stay on the Plays screen. */
export function launchPlay(input: {
  openAtLaunch: OpenAtLaunch;
  lastPlay: string | null;
  /** The Plays folder now showing. */
  vaultRoot: string | null;
  /** The folder the app reopened at launch, as settings.json named it. */
  launchVault: string | null;
  plays: readonly VaultPlay[];
}): VaultPlay | null {
  if (input.openAtLaunch !== "lastPlay" || !input.lastPlay) return null;
  if (!input.vaultRoot || !input.launchVault) return null;
  if (trimSlash(input.vaultRoot) !== trimSlash(input.launchVault)) return null;
  return input.plays.find((p) => p.id === input.lastPlay) ?? null;
}

/**
 * Where a launch stands, render by render.
 *
 * - `waiting`: the folder is still reopening or listing its plays, or
 *   settings.json has not answered. Nothing on screen yet can be the one the
 *   launch ends on.
 * - `decide`: the reopened Plays folder has listed its plays and everything
 *   the choice needs is in; stay on the Plays screen or walk into the last play.
 * - `arrived`: there is nothing to decide. A play is open already (from
 *   Finder, say), or no folder came back and the Welcome screen is the screen.
 *
 * `booted` is what says the plays are listed: the folder is open (`root`) a few
 * awaits before its plays are, and a choice made in between finds none.
 */
export function launchStep(state: {
  booted: boolean;
  practicing: boolean;
  /** Some play is open, or opening. */
  playOpen: boolean;
  root: string | null;
  mode: string;
  vaultRoot: string | null;
  settingsLoaded: boolean;
  /** Undefined until asked. */
  launchVault: string | null | undefined;
}): "waiting" | "decide" | "arrived" {
  if (state.practicing || state.playOpen) return "arrived";
  if (!state.booted) return "waiting";
  if (!state.root) return "arrived";
  if (state.mode === "picker" && state.vaultRoot && state.settingsLoaded && state.launchVault !== undefined) {
    return "decide";
  }
  return "waiting";
}

/**
 * The longest the launch screen covers a play that is open but not yet in
 * place. The script's read can be slow (a play still coming down from iCloud),
 * and the launch screen says what it is opening for as long as it is; but a
 * play that has not settled after this has met something nothing here
 * expected, and is shown as it is.
 */
export const IN_PLACE_PATIENCE_MS = 10000;

/**
 * A safety net, not a timeout. A launch still reopening its folder, or still
 * opening its play, is waiting on the disk (a folder or a play coming down
 * from iCloud), and the launch screen says which for as long as that takes;
 * the screens under it would be wrong, an empty Plays list most of all. But a
 * launch whose plays are listed and that has still not chosen after this long
 * has met a state nothing here expected, and the Plays screen under it is
 * real: it shows, rather than leave the writer on the launch screen for good.
 */
export const LAUNCH_PATIENCE_MS = 8000;

export interface Launch {
  /** Still on the way to the first screen: the launch screen stands in the window. */
  launching: boolean;
  /** The play the launch is walking into, once it has chosen one. */
  opening: string | null;
}

export function useOpenAtLaunch(
  ws: {
    practicing?: boolean;
    booted: boolean;
    mode: string;
    root: string | null;
    vaultRoot: string | null;
    plays: readonly VaultPlay[];
    enterPlay: (play: VaultPlay) => Promise<void>;
  },
  /** The open play is in place: what is on its panes is read, laid out and where the writer left it. */
  inPlace: boolean,
): Launch {
  const { openAtLaunch, lastPlay } = useSettings();
  const loaded = useSettingsLoaded();
  const decided = useRef(false);
  const [arrived, setArrived] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  /** The walk into the last play has finished: the play is open, or it could not be. */
  const [entered, setEntered] = useState(false);
  /** Undefined until asked; null when there was no folder to reopen. */
  const [launchVault, setLaunchVault] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void ipc.getLastVault().then(
      (v) => live && setLaunchVault(v),
      () => live && setLaunchVault(null),
    );
    return () => {
      live = false;
    };
  }, []);

  const current = openPlay(ws.root, ws.vaultRoot, ws.plays);
  const { booted, root, mode, vaultRoot, plays, enterPlay } = ws;
  const practicing = !!ws.practicing;

  useEffect(() => {
    if (decided.current) return;
    const step = launchStep({
      booted, practicing, playOpen: !!current, root, mode, vaultRoot, settingsLoaded: loaded, launchVault,
    });
    if (step === "waiting") return;
    decided.current = true;
    const play = step === "decide" ? launchPlay({ openAtLaunch, lastPlay, vaultRoot, launchVault: launchVault ?? null, plays }) : null;
    if (!play) {
      setArrived(true);
      return;
    }
    setOpening(play.title);
    void enterPlay(play).finally(() => setEntered(true));
  }, [booted, practicing, current, root, mode, vaultRoot, plays, loaded, launchVault, openAtLaunch, lastPlay, enterPlay]);

  // Arrived when the play is in place — or, when it could not be opened, back
  // on the Plays screen with the reason (enterPlay reopens the folder then).
  useEffect(() => {
    if (!entered || arrived) return;
    if (mode !== "workspace" || inPlace) {
      setArrived(true);
      return;
    }
    const late = window.setTimeout(() => setArrived(true), IN_PLACE_PATIENCE_MS);
    return () => window.clearTimeout(late);
  }, [entered, arrived, mode, inPlace]);

  useEffect(() => {
    if (arrived || !booted) return;
    const late = window.setTimeout(() => {
      if (!decided.current) setArrived(true);
    }, LAUNCH_PATIENCE_MS);
    return () => window.clearTimeout(late);
  }, [arrived, booted]);

  const left = useRef<string | null>(null);
  useEffect(() => {
    if (ws.practicing) return;
    const next = leftOff({ open: current?.id ?? null, left: left.current, mode, lastPlay });
    left.current = next.left;
    if (next.lastPlay !== undefined) updateSettings({ lastPlay: next.lastPlay });
  }, [ws.practicing, current, lastPlay, mode]);

  return { launching: !arrived, opening };
}
