// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from "react";
import { announce, ensureAnnouncer } from "./announce";

/** Report the settled result through a region that existed before the result.
 * Cancelling the debounce also keeps intermediate keystrokes and fast loads quiet. */
export function useAnnouncedStatus(message: string | null, delayMs = 250) {
  useEffect(() => {
    if (!message) return;
    ensureAnnouncer();
    const timer = window.setTimeout(() => announce(message), delayMs);
    return () => window.clearTimeout(timer);
  }, [message, delayMs]);
}
