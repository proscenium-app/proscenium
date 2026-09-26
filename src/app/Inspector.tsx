// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The inspector (docs/app/organizing/workspace-model.md#WORK-D105) — the right rail, and the answer to
 * "where does everything the toolbar dropped actually live".
 *
 * Three tabs: **Scene** (or **Sheet**, when a material pane has focus),
 * **Comments**. Comments used to be a pane in the split
 * tree and can still be — the ⤢ button moves the active tab into a pane of its
 * own, so the split-anywhere model survives having a default home. That is the
 * trade the audit's Q3 asked about, taken in the direction that keeps both: a
 * rail by default, a pane on request.
 */
import type { ReactNode } from "react";
import { IconButton, PopOutIcon, Segmented } from "../ui";

export type InspectorTab = "scene" | "comments";

export function Inspector({
  tab,
  onSetTab,
  sheetMode,
  onPopOut,
  children,
}: {
  tab: InspectorTab;
  onSetTab: (t: InspectorTab) => void;
  /** The first tab becomes "Sheet" when the focused pane holds a material. */
  sheetMode: boolean;
  onPopOut: () => void;
  children: ReactNode;
}) {
  return (
    <aside className="inspector" aria-label="Inspector">
      <div className="inspector__head">
        <Segmented
          size="small"
          tight
          label="Inspector"
          value={tab}
          onChange={onSetTab}
          options={[
            { id: "scene", label: sheetMode ? "Sheet" : "Scene" },
            { id: "comments", label: "Comments" },
          ]}
        />
        <IconButton
          size="small"
          label="Open as a pane"
          title="Move this tab into a pane of its own"
          onClick={onPopOut}
        >
          <PopOutIcon size={12} />
        </IconButton>
      </div>
      {children}
    </aside>
  );
}
