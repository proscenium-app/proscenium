// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState } from "react";
import { folderAccess, type FolderAccessIssue } from "../storage/ipc";
import { Button, Sheet, useToast } from "../ui";

/** A current session can keep writing while its durable grant is fixed (docs/app/keeping-work/storage-and-file-format.md#STOR-139). */
export function FolderAccessNotice({ chooseFolder }: { chooseFolder: () => void }) {
  const [issue, setIssue] = useState<FolderAccessIssue | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const told = useRef<string | null>(null);
  const toast = useToast();
  useEffect(() => {
    let dead = false;
    let stop: (() => void) | undefined;
    let revision = 0;
    void folderAccess.onState((value) => { revision++; if (!dead) setIssue(value); }).then(async (un) => {
      if (dead) { un(); return; }
      stop = un;
      const before = revision;
      const value = await folderAccess.state();
      if (!dead && revision === before) setIssue(value);
    });
    return () => { dead = true; stop?.(); };
  }, []);
  useEffect(() => {
    if (!issue) {
      if (told.current !== null) toast({ kind: "ok", title: "Folder access saved" });
      told.current = null; setOpen(false); return;
    }
    const key = `${issue.path}:${issue.message}`;
    if (told.current === key) return;
    told.current = key;
    toast({ kind: "error", title: "Folder access needs attention", detail: "Proscenium could not keep access for the next launch.", code: "E-FOLDER-ACCESS", ms: 0,
      action: { label: "Keep Folder Access…", run: () => { setFailure(null); setOpen(true); } } });
  }, [issue, toast]);
  if (!open || !issue) return null;
  return <Sheet title="Keep access to your Plays folder" width={520} labelledBy="folder-access-title" onClose={() => { if (!busy) setOpen(false); }} footer={<>
    <Button disabled={busy} onClick={() => setOpen(false)}>Close</Button>
    <span className="sheet__spacer" />
    <Button disabled={busy} onClick={() => { setOpen(false); void chooseFolder(); }}>Choose Folder…</Button>
    <Button treatment="primary" disabled={busy} onClick={() => {
      setBusy(true); setFailure(null);
      void folderAccess.retry().then(() => { setOpen(false); }, (error) => setFailure(String(error).replace(/^E-FOLDER-ACCESS:\s*/, "")))
        .finally(() => setBusy(false));
    }}>Try Again</Button>
  </>}>
    <div className="sheet-copy">
    <p>Proscenium needs permission to reopen your Plays folder next time.</p>
    <p>{issue.message.replace(/^E-FOLDER-ACCESS:\s*/, "")}</p>
    <p>Try saving access again, or choose the folder in the Mac’s folder panel.</p>
    <p role="status">{failure ?? ""}</p>
    </div>
  </Sheet>;
}
