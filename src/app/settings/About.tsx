// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Settings › About — which Proscenium this is, the license it is under, the
 * work it is built on, the keyboard sheet, and the diagnostics a writer hands
 * to someone when something goes wrong (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D5).
 */
import { copyDiagnostics, formatsInUse } from "../../diagnostics";
import { openFeedback } from "../../feedback";
import { AppMarkIcon, Button, useToast } from "../../ui";
import { settings as ipc } from "../../storage/ipc";
import { DARK_HOUSE, ROLL, billed, inTheWings, isDark } from "./patrons";
import type { VaultPlay } from "../../workspace";
import { Group, Note, SectionBody, archLabel, useAppInfo } from "./parts";

/** What Proscenium is built on, each named with what it does here and its license. */
const CREDITS: { name: string; what: string; license: string }[] = [
  {
    name: "Courier Prime",
    what: "the typeface for scripts, by the Courier Prime Project Authors",
    license: "SIL Open Font License 1.1",
  },
  {
    name: "SCOWL",
    what: "the word list for checking spelling in scripts, by Kevin Atkinson and contributors",
    license: "The SCOWL license",
  },
  { name: "Tauri", what: "the app framework", license: "MIT or Apache 2.0" },
  { name: "React", what: "the interface", license: "MIT" },
  { name: "ProseMirror and TipTap", what: "the text editors", license: "MIT" },
  { name: "pdf-lib", what: "PDF export", license: "MIT" },
];

/**
 * The Program: sponsors by level, as a theatre program prints its donors
 * (docs/app/preferences-and-help/settings.md#SET-32). The words are the one
 * place Settings speaks in the theatre's voice
 * (docs/app/preferences-and-help/settings.md#SET-33). The roll is this
 * build's own; the link opens the support page in the writer's browser.
 */
function Program() {
  const wings = inTheWings(ROLL);
  // The address is Rust's (telemetry/allowlist.rs): the page holds none.
  const join = (label: string) => (
    <button
      type="button"
      role="link"
      className="settings__link"
      onClick={() => void ipc.openSupport()}
    >
      {label}
    </button>
  );
  return (
    <Group label="The Program">
      {isDark(ROLL) ? (
        <Note>
          {DARK_HOUSE} {join("It could be yours")}.
        </Note>
      ) : (
        <div className="about__program">
          {billed(ROLL).map((level) => (
            <div key={level.label}>
              <h5 className="about__level">{level.label}</h5>
              <ul className="about__names">
                {level.names.map((name, i) => (
                  <li key={i}>{name}</li>
                ))}
              </ul>
            </div>
          ))}
          {wings && <p className="about__wings">{wings}</p>}
        </div>
      )}
      <Note>
        Proscenium's sponsors on GitHub, by level, as of this version. Only names they chose to make
        public appear.{isDark(ROLL) ? null : <> {join("Join them")}.</>}
      </Note>
    </Group>
  );
}

/**
 * The Help menu's Copy Diagnostics and Send Feedback…, where a writer
 * looking for the version will find them too.
 */
function Diagnostics({ plays }: { plays: readonly VaultPlay[] }) {
  const toast = useToast();
  const formats = () => formatsInUse(plays.map((p) => p.format));
  return (
    <Group label="Diagnostics">
      {/* What the text holds is diagnostics.rs's list, and what it never holds
          is that file's test: no path, play name, format name or learned word. */}
      <div className="settings__row">
        <span className="settings__rowlabel">Technical details</span>
        <Button size="small" onClick={() => void copyDiagnostics(formats(), toast)}>
          Copy Diagnostics
        </Button>
      </div>
      <Note>
        Copies the Proscenium and macOS versions, your settings and recent errors as text for you to
        paste. Nothing is sent. It never includes play, file or folder names, or dictionary words.
      </Note>
      <div className="settings__row">
        <span className="settings__rowlabel">Feedback</span>
        <Button size="small" onClick={() => openFeedback(formats())}>
          Send Feedback…
        </Button>
      </div>
      <Note>Your message goes privately to the Proscenium team.</Note>
    </Group>
  );
}

export function About({
  plays,
}: {
  /** The plays in the Plays folder, for the formats diagnostics name. */
  plays: readonly VaultPlay[];
}) {
  const info = useAppInfo();
  return (
    <SectionBody title="About">
      <div className="about">
        <span className="about__mark" aria-hidden="true">
          <AppMarkIcon size={40} />
        </span>
        <div>
          <p className="about__name">Proscenium</p>
          <p className="about__version">
            {info ? `Version ${info.version} · ${archLabel(info.arch)}` : "Version"}
          </p>
        </div>
      </div>
      <Note>
        {/* Opens in the writer's own browser, never the window. The address is
            Rust's (telemetry/allowlist.rs): the page holds none. */}
        <button
          type="button"
          role="link"
          className="settings__link"
          onClick={() => void ipc.openLicense()}
        >
          Free software under the GNU AGPL
        </button>
        , version 3 or later. You may use, study, share and change it. © 2026 Alexander Habiby.
      </Note>

      <Group label="Acknowledgments">
        <ul className="about__credits">
          {CREDITS.map((c) => (
            <li key={c.name}>
              <span className="about__credit">{c.name}</span>: {c.what}. {c.license}.
            </li>
          ))}
        </ul>
      </Group>

      <Program />

      <Diagnostics plays={plays} />
    </SectionBody>
  );
}
