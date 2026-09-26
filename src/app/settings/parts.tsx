// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The pieces every Settings section is built from, so seven files (and the
 * three threads filling slots) share one anatomy: a heading, groups under
 * section labels, rows of label and control, and a note under a control whose
 * label does not already say what it does.
 *
 * The words follow docs/app/preferences-and-help/settings.md#SET-D108: a
 * note says what a setting does when it is on, and names off only when off
 * costs something the label does not show. Every switch used to explain its
 * off half too ("Off, nothing is underlined"), which doubled each note to say
 * what the label already had.
 */
import { useEffect, useId, useState, type ReactNode } from "react";
import { Switch } from "../../ui";
import { settings as ipc, type AppInfo } from "../../storage/ipc";

/** One section's panel content: its heading, then its groups. */
export function SectionBody({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="settings">
      <h3 className="settings__title">{title}</h3>
      {children}
    </div>
  );
}

/** A group of related settings under a section label. */
export function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="settings__group">
      <h4 className="seclabel">{label}</h4>
      {children}
    </section>
  );
}

/** A sentence under a control. */
export function Note({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p className="settings__note" id={id}>
      {children}
    </p>
  );
}

/**
 * A switch with its label on the left and its note beneath. The note is the
 * switch's description as well as its caption, so VoiceOver reads it right
 * after the switch's state.
 */
export function SwitchRow({
  label,
  on,
  onChange,
  note,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
  note: ReactNode;
}) {
  const noteId = useId();
  return (
    <>
      <label className="settings__row">
        <span className="settings__rowlabel">{label}</span>
        <Switch on={on} onChange={onChange} label={label} describedBy={noteId} />
      </label>
      <Note id={noteId}>{note}</Note>
    </>
  );
}

let appInfo: Promise<AppInfo> | null = null;

/** Version and architecture, asked once per launch: neither changes while the app runs. */
export function useAppInfo(): AppInfo | null {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    let live = true;
    void (appInfo ??= ipc.appInfo()).then(
      (i) => live && setInfo(i),
      () => {
        appInfo = null;
      },
    );
    return () => {
      live = false;
    };
  }, []);
  return info;
}

/** The architecture in the words About uses. */
export function archLabel(arch: string): string {
  if (arch === "aarch64") return "Apple silicon";
  if (arch === "x86_64") return "Intel";
  if (arch === "browser") return "browser preview";
  return arch;
}
