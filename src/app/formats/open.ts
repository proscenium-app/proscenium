// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Opening the format designer, from wherever a writer asks: Settings › Formats
 * (New Format, Edit, Duplicate, a problem import) and the document menu's Edit
 * Formats…. A plain function, like `openSettings`, so neither needs a callback
 * threaded down to it.
 */
import { useCallback, useEffect, useState } from "react";
import type { FormatSpec } from "../../format";

export type DesignerRequest = (
  | { kind: "edit"; formatId: string }
  | { kind: "duplicate"; formatId: string }
  | { kind: "new" }
  /** A valid format from a file whose id is taken: opened unsaved, to be named. */
  | { kind: "imported"; spec: FormatSpec }
) & {
  /** Where closing the designer goes back to. */
  returnTo?: "settings";
};

let show: ((request: DesignerRequest) => void) | null = null;
let saver: (() => boolean) | null = null;

export function openFormatDesigner(request: DesignerRequest): void {
  show?.(request);
}

/**
 * The menu bar's Save while the designer is up. macOS hands ⌘S to the menu bar
 * before the webview sees it, so without this the key would flush the script
 * behind the sheet instead of saving the format in front of it. True when the
 * designer took the save.
 */
export function saveInFormatDesigner(): boolean {
  return saver?.() ?? false;
}

/** The designer registers its Save while it is open. */
export function useDesignerSaveHandler(save: () => void, enabled: boolean): void {
  useEffect(() => {
    const handler = () => {
      if (enabled) save();
      return true;
    };
    saver = handler;
    return () => {
      if (saver === handler) saver = null;
    };
  }, [save, enabled]);
}

/** The shell's side: the request being shown, or null. */
export function useFormatDesignerRequest(): { request: DesignerRequest | null; close: () => void } {
  const [request, setRequest] = useState<DesignerRequest | null>(null);
  useEffect(() => {
    show = setRequest;
    return () => {
      if (show === setRequest) show = null;
    };
  }, []);
  const close = useCallback(() => setRequest(null), []);
  return { request, close };
}
