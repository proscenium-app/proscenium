// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * First run: one question, answered with one click (docs/app/keeping-work/storage-and-file-format.md#STOR-D12).
 *
 * > **Where should your plays live?**
 * > ○ iCloud Drive *(recommended: your plays appear on your iPad too)*
 * > ○ A folder I choose…
 *
 * The iCloud option is the app's own container, shown in Finder as
 * iCloud Drive › Proscenium. It needs no folder panel and no bookmark, which
 * is why it is the default and
 * `~/Documents/Plays` is not — nothing can create a folder under Documents
 * without the writer going through the panel anyway.
 *
 * "A folder I choose…" is the door for Dropbox, OneDrive, Google Drive,
 * Syncthing, and "just this Mac". On a sandboxed build that click is also what
 * creates the security-scoped bookmark every later launch depends on.
 *
 * When iCloud is unavailable — not signed in, or turned off for this app —
 * the option is not offered rather than being offered and failing.
 *
 * Under the question, once, one sentence says that anonymous usage and crash
 * reports are sent and where to switch them off (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D3).
 * It is remembered as seen as it appears and stays for the rest of that visit,
 * so a later Welcome screen — a Plays folder gone missing — does not say it
 * again. It appears only once the launch has finished reopening the last Plays
 * folder: this screen is also what stands in the window for that moment, and
 * a notice there would be marked seen by a writer who never saw it.
 */
import { useEffect, useState } from "react";
import { AppMarkIcon, Button } from "../ui";
import { PRIVACY_NOTICE } from "./privacy-notice";

export interface WelcomeScreenProps {
  /** The iCloud container's path, or null when iCloud is unavailable. */
  cloudRoot: string | null;
  /** Where plays lived last time, when there was a last time. */
  lastVault: string | null;
  onChooseCloud: () => void;
  onChooseFolder: () => void;
  /** Try the remembered folder again — shown only when there is one. */
  onReopenLast: () => void;
  /** The reports notice is due: not seen yet, and the launch is past reopening a folder. */
  privacyNotice: boolean;
  /** The notice has appeared: remember it. */
  onPrivacyNoticeSeen: () => void;
  /** Open Settings › Privacy. */
  onPrivacySettings: () => void;
}

export function WelcomeScreen({
  cloudRoot,
  lastVault,
  onChooseCloud,
  onChooseFolder,
  onReopenLast,
  privacyNotice,
  onPrivacyNoticeSeen,
  onPrivacySettings,
}: WelcomeScreenProps) {
  // Once shown, it stays for the visit, though being seen is what turns it off.
  const [showNotice, setShowNotice] = useState(privacyNotice);
  useEffect(() => {
    if (privacyNotice) setShowNotice(true);
  }, [privacyNotice]);
  useEffect(() => {
    if (!showNotice) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(onPrivacyNoticeSeen);
    });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
    // Once, when it appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showNotice]);
  return (
    <div className="empty-overlay">
      <div className="welcome">
        <span className="empty-card__icon">
          <AppMarkIcon size={64} />
        </span>
        <h1 className="empty-card__title">Where should your plays live?</h1>
        <p className="empty-card__sub">
          One folder holds them all. Nothing is imported and nothing moves — the
          folder stays a folder you can open in Finder.
        </p>

        <div className="welcome__choices">
          {cloudRoot && (
            <button type="button" className="welcome__choice" onClick={onChooseCloud}>
              <span className="welcome__choiceName">iCloud Drive</span>
              <span className="welcome__choiceNote">
                Recommended — your plays appear on your iPad too.
              </span>
            </button>
          )}
          <button type="button" className="welcome__choice" onClick={onChooseFolder}>
            <span className="welcome__choiceName">A folder I choose…</span>
            <span className="welcome__choiceNote">
              Dropbox, an external drive, or just this Mac.
            </span>
          </button>
        </div>

        {lastVault && (
          <div className="welcome__last">
            <Button onClick={onReopenLast}>Reopen the last folder</Button>
            <span className="empty-card__last" title={lastVault}>
              {lastVault}
            </span>
          </div>
        )}

        {showNotice && (
          <p className="welcome__privacy">
            {PRIVACY_NOTICE.slice(0, -"Privacy settings.".length)}
            <button type="button" role="link" className="settings__link" onClick={onPrivacySettings}>
              Privacy settings
            </button>
            .
          </p>
        )}
      </div>
    </div>
  );
}
