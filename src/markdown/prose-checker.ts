// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A spell checker handed to the documents' editor (ProseEditor.tsx) by
 * whatever draws it, for a system whose own spelling may not run in a
 * document. On an iPad every field has spell checking off, because WebKit
 * turns smart quotes and dashes off only there, and iPadOS's Smart
 * Punctuation would otherwise rewrite what the writer typed in the file's
 * bytes (ui/system-traits.ts). The system then marks no word at all.
 *
 * The checker that marks them is the script's own (docs/app/writing/editor-ux.md#EDIT-D116):
 * its underlines, its correction menu, and a speller made of the play's
 * dictionary, its cast and the writer's own words. It lives with the script,
 * which this feature may not import, so it is handed over here instead: what
 * the editor adds to its own extensions as it is made, and what it draws
 * beside its page once it exists. Where nothing is handed over, a Mac's and a
 * PC's page, the documents' editor is what it always was, and the system
 * checks its spelling.
 */
import { createContext, type ReactNode } from "react";
import type { AnyExtension, Editor } from "@tiptap/core";

export interface ProseChecker {
  /**
   * Added to the editor's own extensions as it is made. An editor keeps the
   * extensions it was made with, so these are the same for the page's life.
   */
  extensions: readonly AnyExtension[];
  /**
   * Drawn beside the editor once it exists: what gives it its speller, and
   * the correction menu over it.
   */
  beside: (editor: Editor) => ReactNode;
}

export const ProseCheckerContext = createContext<ProseChecker | null>(null);
