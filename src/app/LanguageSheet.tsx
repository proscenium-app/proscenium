// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useRef, useState } from "react";
import { Button, PopupButton, Sheet } from "../ui";
import { useAnnouncedStatus } from "../ui/use-announced-status";
import { canonicalLanguage, languageHelp } from "../workspace/language";

export function LanguageSheet({ language, onSave, onClose }: {
  language: string;
  onSave: (value: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(language);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const code = canonicalLanguage(value);
  const help = error ?? (code ? languageHelp(code) : "Enter a language code, such as en-GB or fr.");
  useAnnouncedStatus(help);
  const save = async () => {
    if (!code || pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      if (await onSave(code)) onClose();
      else setError("The language could not be saved. Check that this play is still open and writable, then try again.");
    } catch { setError("The language could not be saved. Try again."); }
    finally { pending.current = false; setBusy(false); }
  };
  const preset = value === "en-US" || value === "en-GB" ? value : "other";
  return <Sheet title="Play Language" onClose={onClose} onDefault={() => void save()}
    footer={<><Button onClick={onClose}>Cancel</Button><Button treatment="primary" disabled={!code || busy} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</Button></>}>
    <label className="sheet__field">Language
      <PopupButton label="Language" value={preset} disabled={busy}
        options={[{ value: "en-US", label: "English (US)" }, { value: "en-GB", label: "English (UK)" }, { value: "other", label: "Another Language" }]}
        onChange={(next) => { setValue(next === "other" ? "" : next); setError(null); }} />
    </label>
    {preset === "other" && <label className="sheet__field">Language code
      <input className="field" aria-label="Language code" aria-describedby="play-language-help" aria-invalid={!code}
        value={value} disabled={busy} onChange={(event) => { setValue(event.target.value); setError(null); }} />
    </label>}
    <p className="sheet__hint" id="play-language-help">{help}</p>
  </Sheet>;
}
