// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The documents' spelling where the system's own may not run in them
 * (docs/app/writing/editor-ux.md#EDIT-194): on an iPad every field has spell
 * checking off, so that iPadOS's Smart Punctuation rewrites none of the
 * writer's quotes and dashes (ui/system-traits.ts), and the system marks no
 * word. The app hands every documents' editor under it the script's own
 * checker (markdown/prose-checker.ts), built from the editor's pieces, which
 * the documents may not import: the underlines (spellcheck.ts), the
 * correction menu (SpellMenu.tsx), and a speller made the script's way
 * (use-speller.ts), from the same switch, dictionary, cast and learned words,
 * so a word learned in a document is learned in the script.
 *
 * Where the system's spelling may run, a Mac's and a PC's page, nothing is
 * handed over: the documents' editor is the one it always was.
 */
import { useEffect, useMemo } from "react";
import type { Editor } from "@tiptap/core";
import { Spellcheck, spellState } from "../editor/spellcheck";
import { SpellMenu } from "../editor/SpellMenu";
import { useSpeller } from "../editor/use-speller";
import type { ProseChecker } from "../markdown/prose-checker";
import type { Speller } from "../spell";
import { systemSpelling } from "../ui/system-traits";

/** The same list for the page's life: an editor keeps the extensions it was made with. */
const CHECKER = [Spellcheck];

interface BesideProps {
  editor: Editor;
  speller: Speller | null;
  onLearn: (word: string) => void;
  onIgnore: (word: string) => void;
}

/**
 * Beside a document's page: the speller pushed into its editor whenever it
 * changes, which re-checks the document, and the correction menu, which draws
 * nothing until a word's corrections are opened.
 */
function DocumentSpelling({ editor, speller, onLearn, onIgnore }: BesideProps) {
  useEffect(() => {
    // Only a change is sent: a document opened before the dictionary arrived,
    // or with the check off, has no speller to be told it has none.
    const held = editor.isDestroyed ? undefined : spellState(editor);
    if (!held || held.speller === speller) return;
    editor.commands.setSpeller(speller);
  }, [editor, speller]);
  return <SpellMenu editor={editor} onLearn={onLearn} onIgnore={onIgnore} scriptFace={false} />;
}

export interface DocumentSpellingSource {
  /** Check Spelling as You Type: the script's switch, and the documents'. */
  spellcheck: boolean;
  /** The play's language, whose dictionary the script is checked against too. */
  language: string;
  cast?: readonly string[];
  learnedWords: readonly string[];
  /** Learn Spelling, into the list the script learns into. */
  onLearnWord: (word: string) => void;
}

/**
 * What the app hands the documents' editors, or null where the system's own
 * spelling may run in them. The record is the page's for its life, given
 * before the first render (main.tsx), so the answer never changes under an
 * editor already made.
 */
export function useDocumentSpelling({
  spellcheck,
  language,
  cast,
  learnedWords,
  onLearnWord,
}: DocumentSpellingSource): ProseChecker | null {
  const own = !systemSpelling();
  const { speller, ignore } = useSpeller({
    on: own && spellcheck,
    language,
    cast,
    learnedWords,
  });
  return useMemo(
    () =>
      own
        ? {
            extensions: CHECKER,
            beside: (editor: Editor) => (
              <DocumentSpelling
                editor={editor}
                speller={speller}
                onLearn={onLearnWord}
                onIgnore={ignore}
              />
            ),
          }
        : null,
    [own, speller, onLearnWord, ignore],
  );
}
