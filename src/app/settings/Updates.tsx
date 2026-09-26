// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Settings › Updates (docs/engineering/release-engineering.md#REL-D6): whether Proscenium looks for a
 * newer version by itself, where things stand, Check Now, and the release
 * notes. The switch is a setting like any other (settings.rs,
 * settings-model.ts); the state comes from updates.rs through src/app/updates.ts.
 *
 * **A store copy has no updater** (`unavailable`: the App Store's and the
 * iPad's builds compile none in). The store updates it, so the switch, its
 * schedule, the track, Check Now and the note about where checks go are all
 * about a machine that is not there. It shows its version and the release notes.
 * **Nor does a local copy** (`bun run app:install`), which nothing updates
 * (it is built without the updater), and it says so.
 *
 * **The track** (docs/app/preferences-and-help/settings.md#SET-37): what arrives on each, in a sentence,
 * and while it is true, that a slower track waits to pass the version already
 * here, because Proscenium never installs an older one.
 *
 * **Alpha is behind a key** (docs/app/preferences-and-help/settings.md#SET-37): the menu offers Stable and
 * Beta, and Alpha only to a copy that holds a key or is on alpha already. "Have a
 * key?" opens a field for one. A copy on alpha without a key says it is not
 * checking, and offers Stable (docs/app/preferences-and-help/settings.md#SET-38).
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { Button, PopupButton, announce } from "../../ui";
import { updates as ipc } from "../../storage/ipc";
import { UPDATE_TRACKS, isUpdateTrackKey, type UpdateTrack } from "../../storage/settings-model";
import {
  announceUpdates,
  checkForUpdatesNow,
  describeUpdates,
  restartProblem,
  restartToUpdate,
  slowerTrackNote,
  TRACK_LABELS,
  useUpdateState,
} from "../updates";
import { Group, Note, SectionBody, SwitchRow, useAppInfo } from "./parts";
import { updateSettings, useSettings } from "./store";

const TRACK_OPTIONS = UPDATE_TRACKS.map((value) => ({ value, label: TRACK_LABELS[value] }));

/** What arrives on each track, in one sentence. */
const TRACK_NOTES: Record<UpdateTrack, string> = {
  stable: "Each new release.",
  beta: "Each new release, and test versions of it before it comes out.",
  alpha: "Every change to Proscenium as soon as it passes its tests. Checks every hour.",
};

/** Focus the Track menu's button: where focus goes when the control that had it goes. */
function focusTrack(row: HTMLElement | null) {
  requestAnimationFrame(() => row?.querySelector<HTMLButtonElement>("button")?.focus());
}

/**
 * "Have a key?", and the field it opens. Once a key is added this goes, Alpha
 * joins the menu, and focus moves to the menu.
 */
function AlphaKey({ trackRow }: { trackRow: RefObject<HTMLDivElement | null> }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [problem, setProblem] = useState("");
  const opener = useRef<HTMLButtonElement | null>(null);
  const field = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);
  const close = () => {
    setOpen(false);
    setKey("");
    setProblem("");
    requestAnimationFrame(() => opener.current?.focus());
  };
  const add = () => {
    const entered = key.trim();
    if (!isUpdateTrackKey(entered)) {
      setProblem("That isn’t a key. Check that all of it was copied.");
      return;
    }
    updateSettings({ updateTrackKey: entered });
    announce("Key added. Alpha is now a track you can choose.");
    focusTrack(trackRow.current);
  };
  if (!open) {
    return (
      <Note>
        <button ref={opener} type="button" className="settings__link" onClick={() => setOpen(true)}>
          Have a key?
        </button>
      </Note>
    );
  }
  return (
    <div>
      <form className="settings__actions" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input
          ref={field}
          className="field"
          aria-label="Key"
          aria-describedby="alpha-key-problem"
          placeholder="Key"
          value={key}
          maxLength={200}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => {
            setKey(e.target.value);
            setProblem("");
          }}
        />
        <Button type="submit" disabled={!key.trim()}>Add Key</Button>
        <Button type="button" onClick={close}>Cancel</Button>
      </form>
      {/* Mounted empty, so it is read when it fills (Writing's dictionary does the same). */}
      <p id="alpha-key-problem" className="settings__note settings__problem" aria-live="polite">
        {problem}
      </p>
    </div>
  );
}

export function UpdatesSlot() {
  const info = useAppInfo();
  const { checkForUpdates, updateTrack, hasUpdateTrackKey } = useSettings();
  const trackRow = useRef<HTMLDivElement | null>(null);
  // Alpha is offered to a copy that holds its key, or is on it already
  // (docs/app/preferences-and-help/settings.md#SET-37): nobody's choice vanishes from under them.
  const trackOptions = TRACK_OPTIONS.filter((o) => o.value !== "alpha" || hasUpdateTrackKey || updateTrack === "alpha");
  const alphaWithoutKey = updateTrack === "alpha" && !hasUpdateTrackKey;
  const state = useUpdateState();
  const version = info?.version ?? null;
  const asked = useRef(false);
  const problem = useRef<HTMLParagraphElement | null>(null);

  // A check the writer asked for from here ends in a sentence they hear.
  useEffect(() => {
    if (!asked.current) return;
    if (state.kind === "checking" || state.kind === "downloading") return;
    asked.current = false;
    announceUpdates(state, version);
  }, [state, version]);

  const canCheck = !["unconfigured", "unavailable", "checking", "downloading", "ready", "installing"].includes(state.kind);
  const fromStore = state.kind === "unavailable";
  const local = fromStore && info?.channel === "local";

  return (
    <SectionBody title="Updates">
      {/* One note, whichever way the switch is set: it says what on does, and
          off is its opposite. */}
      {!fromStore && (
        <Group label="Automatic updates">
          <SwitchRow
            label="Check for updates automatically"
            on={checkForUpdates}
            onChange={(on) => updateSettings({ checkForUpdates: on })}
            note={`Checks when Proscenium opens and ${updateTrack === "alpha" ? "every hour" : "once a day"}, then downloads any new version in the background. Proscenium restarts to install it only when you choose.`}
          />
        </Group>
      )}

      {!fromStore && (
        <Group label="Update track">
          <div className="settings__row" ref={trackRow}>
            <span className="settings__rowlabel">Track</span>
            <PopupButton
              label="Track"
              size="small"
              options={trackOptions}
              value={updateTrack}
              onChange={(value) => updateSettings({ updateTrack: value })}
            />
          </div>
          {alphaWithoutKey ? (
            <div className="settings__row">
              <span className="settings__note">
                Alpha needs a key, and this copy doesn’t have one, so Proscenium isn’t checking for updates.
              </span>
              <Button
                size="small"
                onClick={() => {
                  updateSettings({ updateTrack: "stable" });
                  announce("Track set to Stable.");
                  focusTrack(trackRow.current);
                }}
              >
                Use Stable
              </Button>
            </div>
          ) : (
            <Note>{TRACK_NOTES[updateTrack]}</Note>
          )}
          {slowerTrackNote(updateTrack, version) && <Note>{slowerTrackNote(updateTrack, version)}</Note>}
          {!hasUpdateTrackKey && <AlphaKey trackRow={trackRow} />}
        </Group>
      )}

      <Group label="This version">
        <div className="settings__row">
          <span className="settings__rowlabel">
            {local ? `Proscenium ${version}, built on this Mac. It doesn’t update itself.` : describeUpdates(state, version)}
          </span>
          {fromStore ? null : state.kind === "ready" ? (
            <Button
              size="small"
              treatment="primary"
              onClick={() =>
                void restartToUpdate().then((result) => {
                  if (problem.current) problem.current.textContent = restartProblem(result);
                })
              }
            >
              Restart to Update
            </Button>
          ) : (
            <Button
              size="small"
              disabled={!canCheck}
              onClick={() => {
                asked.current = true;
                void checkForUpdatesNow();
              }}
            >
              Check Now
            </Button>
          )}
        </div>
        <p className="settings__note" ref={problem} role="status" />
        <Note>
          {/* A link that opens the writer's own browser, never the window: the
              address is Rust's (telemetry/allowlist.rs), so the page holds none. */}
          <button
            type="button"
            role="link"
            className="settings__link"
            onClick={() => void ipc.openReleaseNotes(state.kind === "ready" ? state.version : undefined)}
          >
            {state.kind === "ready" ? `What’s new in ${state.version}` : "Release notes"}
          </button>
        </Note>
        {/* updates.rs tries tauri.conf.json's endpoints in order: our own host,
            then GitHub's latest.json. Both requests carry the macOS version
            (Proscenium-OS); the first also names the version and architecture.
            Alpha's asks only our host, with its key (Proscenium-Track-Key). */}
        {!fromStore && (
          <Note>
            {updateTrack === "stable"
              ? "Updates come from proscenium.ink, or from Proscenium’s releases on GitHub if proscenium.ink doesn’t respond."
              : "Updates come from proscenium.ink."}{" "}
            {updateTrack === "alpha"
              ? "A check sends the Proscenium and macOS versions, whether this Mac has Apple silicon or Intel, and this copy’s key for Alpha."
              : "A check sends the Proscenium and macOS versions, and whether this Mac has Apple silicon or Intel."}{" "}
            Each update is verified as coming from Proscenium before it installs.
          </Note>
        )}
      </Group>
    </SectionBody>
  );
}
