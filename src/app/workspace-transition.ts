// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SaveProblem } from "../storage";

export type ScriptSettlement =
  | { safe: true; message: string | SaveProblem | null }
  | { safe: false; title: string; why: "not-kept" | "still-changing"; recovered: boolean };
export type OutlineSettlement = "landed" | "kept" | "lost";
export interface KeptDocument {
  key: string;
  kind: "document" | "outline";
  title: string;
  path: string | null;
  inVersions: boolean;
}
export interface MaterialSettlement {
  /** Taken before preservation, for the leave notice about refused saves. */
  unsavedKeys: string[];
  lostTitles: string[];
  /** Documents still unsaved after writes and preservation finish. */
  remaining: KeptDocument[];
}
interface Participants {
  materials: () => Promise<MaterialSettlement>;
  outline: {
    hasUnsaved: () => boolean;
    settle: (quitting?: boolean) => Promise<OutlineSettlement>;
    path: () => string;
  };
}
export interface WorkspaceSettlement {
  script: ScriptSettlement;
  unsavedKeys: Set<string>;
  lostSheets: string[];
  held: string[];
}

/** Settle every owner before the adapter clears surfaces or retargets the vault.
 * A recovered script may leave; any document kept nowhere holds the play open. */
export async function settleWorkspaceDocuments(
  participants: Participants & { script: () => Promise<ScriptSettlement> },
): Promise<WorkspaceSettlement> {
  const materials = await participants.materials();
  const unsavedKeys = new Set(materials.unsavedKeys);
  if (participants.outline.hasUnsaved()) unsavedKeys.add("outline");
  const lostSheets = [...materials.lostTitles];
  if ((await participants.outline.settle()) === "lost") lostSheets.push("Outline notes");
  const script = await participants.script();
  const held = [...(!script.safe && !script.recovered ? [script.title] : []), ...lostSheets];
  return { script, unsavedKeys, lostSheets, held };
}

/** Quit leaves buffers attached: cancelling the quit resumes those same owners. */
export async function settleQuitDocuments(participants: Participants): Promise<KeptDocument[]> {
  const materials = await participants.materials();
  const documents = [...materials.remaining];
  if (participants.outline.hasUnsaved()) {
    const outcome = await participants.outline.settle(true);
    if (outcome !== "landed")
      documents.push({
        key: "outline",
        kind: "outline",
        title: "Outline notes",
        path: participants.outline.path(),
        inVersions: outcome === "kept",
      });
  }
  return documents;
}
