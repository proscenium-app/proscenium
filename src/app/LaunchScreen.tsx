// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the window holds while a launch finds its way back to where the writer
 * left off (settings/launch.ts): the desk, flat, and nothing on it.
 *
 * It covers the whole window, toolbar included, because the play is opening
 * underneath it: the script is read, laid out and scrolled to the writer's
 * place out of sight, and the toolbar, binder and page then appear together,
 * once, already where they will stay.
 *
 * One flat colour, and the same one the window shows before the page has
 * painted (src-tauri/src/window_color.rs) and the page's first frame shows
 * before React has run (index.html). A frame with the toolbar's and status
 * bar's bands was tried first: those bands appeared on the desk the window had
 * been showing, one more change on the way in.
 *
 * Not a splash. A launch that lands in time goes from the empty frame straight
 * to the play, which is what a Mac document app does, and the Dock icon
 * bouncing is already the Mac's own "opening". A card that showed on every
 * launch would be one more thing flashing past on the way in. Only a launch
 * slow enough to wonder about (a folder or a play still coming down from
 * iCloud) shows the app's mark and what it is opening, and they fade in after
 * a second (plays.css), so a quick launch never shows them.
 */
import { AppMarkIcon } from "../ui";

export function LaunchScreen({ play }: {
  /** The play the launch is walking into, once it has chosen one. */
  play: string | null;
}) {
  return (
    <div className="launch-screen">
      {/* The window can still be moved by its top edge while this is up. */}
      <div className="launch-screen__bar" data-tauri-drag-region />
      <div className="launch-screen__desk">
        <div className="launch-screen__card">
          <span className="empty-card__icon">
            <AppMarkIcon size={64} />
          </span>
          <p className="launch-screen__what">{play ? `Opening “${play}”…` : "Opening your plays…"}</p>
        </div>
      </div>
    </div>
  );
}
