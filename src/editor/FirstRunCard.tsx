// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Three sentences, once (docs/app/preferences-and-help/tutorials.md#TUT-D9).
 *
 * The editor's whole premise — Enter guesses the next element, Tab corrects it
 * in one keystroke — is invisible until it happens, and someone who has just
 * downloaded this has about forty seconds. So the first empty script says the
 * three things, on the page, in the writer's eyeline.
 *
 * Dismissed by typing, not by a button: the gesture that makes the card
 * unnecessary is the gesture that removes it. Shown once ever, per install.
 */
import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/core";

const KEY = "proscenium:sawFirstRun";

function alreadySeen(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return true; // no storage: never nag
  }
}

/** An empty script is one with nothing but the starter's own scaffolding. */
function looksEmpty(editor: Editor): boolean {
  return editor.state.doc.textContent.trim().length < 40;
}

export function FirstRunCard({ editor }: { editor: Editor | null }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!editor || alreadySeen()) return;
    if (!looksEmpty(editor)) return;
    setShow(true);
    const dismiss = () => {
      setShow(false);
      try {
        localStorage.setItem(KEY, "1");
      } catch {
        /* chrome preference only */
      }
      editor.off("update", dismiss);
    };
    editor.on("update", dismiss);
    return () => {
      editor.off("update", dismiss);
    };
  }, [editor]);

  if (!show) return null;
  return (
    <aside className="firstrun" aria-label="How the editor works">
      <p className="firstrun__row">
        <kbd className="keybadge">⏎</kbd> the next thought — the app guesses what kind
      </p>
      <p className="firstrun__row">
        <kbd className="keybadge">⇧⏎</kbd> the next line, same thought
      </p>
      <p className="firstrun__row">
        <kbd className="keybadge">⇥</kbd> change what this line is
      </p>
      <p className="firstrun__foot">Shown once. Type to dismiss.</p>
    </aside>
  );
}
