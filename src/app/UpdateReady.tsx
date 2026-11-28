// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The status bar's word of a waiting update
 * (docs/engineering/release-engineering.md#REL-132). The notice that an update
 * is ready comes once each launch and goes after a few seconds; this stays in
 * the status bar for as long as the update waits, on every launch, and
 * restarts into it when pressed. Its title says what happens without a press:
 * with Install updates automatically on, the update goes in as the app quits.
 */
import { Button, useToast } from "../ui";
import { readyDetail, restartWithToast, useUpdateState } from "./updates";

export function UpdateReady({ atQuit }: { atQuit: boolean }) {
  const state = useUpdateState();
  const toast = useToast();
  if (state.kind !== "ready" && state.kind !== "installing") return null;
  const installing = state.kind === "installing";
  return (
    <Button
      size="small"
      treatment="borderless"
      className="updateready"
      disabled={installing}
      title={`Proscenium ${state.version} is ready. ${readyDetail(atQuit)}`}
      onClick={() => restartWithToast(toast)}
    >
      {installing ? `Installing ${state.version}…` : `Restart to Update to ${state.version}`}
    </Button>
  );
}
