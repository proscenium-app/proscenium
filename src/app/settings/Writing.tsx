// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Settings › Writing — the page map, spell check, and the words the writer has
 * taught the checker.
 *
 * Spell check here and Check Spelling as You Type in the document menu are one
 * setting in one store (store.ts), so neither can show a state the other does
 * not.
 *
 * **Two checkers, and the notes say which is which.** This switch and this
 * word list are the script's own checker (editor/spellcheck.ts). Documents and
 * character sheets are checked by macOS through WebKit whatever the switch
 * says, and Learn Spelling there goes to the macOS dictionary.
 */
import { useLayoutEffect, useRef, useState } from "react";
import { Button, CloseIcon, IconButton, announce } from "../../ui";
import { Group, Note, SectionBody, SwitchRow } from "./parts";
import { forgetWord, learnWord, updateSettings, useSettings } from "./store";

import { StatusList } from "./StatusList";

export function Writing() {
  const { runningTimeStrip, spellcheck, learnedWords, sceneStatuses } = useSettings();
  const [newWord, setNewWord] = useState("");
  /* A word already in the dictionary used to be "Added" to VoiceOver and
     cleared from the field, with nothing changed and nothing on screen. */
  const [wordProblem, setWordProblem] = useState("");
  const addWord = () => {
    const word = newWord.trim();
    if (!word) return;
    if (learnedWords.some((w) => w.toLowerCase() === word.toLowerCase())) {
      setWordProblem(`“${word}” is already in the dictionary.`);
      return;
    }
    learnWord(word);
    announce(`Added “${word}”.`);
    setNewWord("");
    setWordProblem("");
  };
  const forgets = useRef<(HTMLButtonElement | null)[]>([]);
  const noteRef = useRef<HTMLParagraphElement | null>(null);
  /** Where focus goes once a removed word's button has gone. */
  const [refocus, setRefocus] = useState<number | null>(null);

  /* A Remove button removes itself, and focus on a removed node falls to
     <body> — the next Tab would start again from the top of the sheet. Focus
     moves to the word that took its place, or back up the list, or to the
     sentence counting what is left. */
  useLayoutEffect(() => {
    if (refocus === null) return;
    const next = forgets.current[Math.min(refocus, learnedWords.length - 1)];
    (next ?? noteRef.current)?.focus();
    setRefocus(null);
  }, [refocus, learnedWords]);

  const forget = (word: string, index: number) => {
    forgetWord(word);
    announce(`Removed “${word}”.`);
    setRefocus(index);
  };

  return (
    <SectionBody title="Writing">
      <Group label="Script">
        {/* The running-time strip until its minutes went (a page is not a minute): what is
            left maps pages, so it says so. The key keeps its old name, and the
            strip's own name is "Scene navigation". */}
        <SwitchRow
          label="Show scene navigation strip"
          on={runningTimeStrip}
          onChange={(on) => updateSettings({ runningTimeStrip: on })}
          note="Each scene appears at the bottom of the script, sized by its length in pages. Click one to go to that scene."
        />
      </Group>

      <Group label="Spelling">
        <SwitchRow
          label="Check spelling as you type"
          on={spellcheck}
          onChange={(on) => updateSettings({ spellcheck: on })}
          note="Underlines misspelled words in scripts. Documents and character sheets are checked by macOS, which this switch doesn’t affect."
        />
      </Group>

      <Group label="Proscenium dictionary">
        <Note>
          Words added here are accepted in every script on this Mac. Documents and character sheets
          use the macOS dictionary, which is shared with other apps.
        </Note>
        <div>
          <form className="settings__actions" onSubmit={(e) => { e.preventDefault(); addWord(); }}>
            <input
              className="field"
              aria-label="Word or name to add"
              aria-describedby="dictionary-problem"
              placeholder="Word or name"
              value={newWord}
              maxLength={100}
              onChange={(e) => {
                setNewWord(e.target.value);
                setWordProblem("");
              }}
            />
            <Button type="submit" disabled={!newWord.trim()}>Add Word</Button>
          </form>
          {/* Mounted empty, so it is read when it fills (StatusList does the same). */}
          <p id="dictionary-problem" className="settings__note settings__problem" aria-live="polite">
            {wordProblem}
          </p>
        </div>
        <p className="settings__note" ref={noteRef} tabIndex={-1}>
          {learnedWords.length === 0
            ? "No words added. In a script, Control-click an underlined word and choose Learn Spelling to add it."
            : `${learnedWords.length} word${learnedWords.length === 1 ? "" : "s"} added.`}
        </p>
        {learnedWords.length > 0 && (
          <ul className="settings__words" aria-label="Added words">
            {learnedWords.map((w, i) => (
              <li key={w} className="capsule">
                {w}
                <IconButton
                  ref={(el) => {
                    forgets.current[i] = el;
                  }}
                  size="mini"
                  label={`Remove “${w}”`}
                  onClick={() => forget(w, i)}
                >
                  <CloseIcon size={10} />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </Group>
      <Group label="Scene statuses">
        <Note>
          Offered for scenes in Board, Outline and the Inspector, in this order. Renaming or
          deleting a status doesn’t change scenes that already have it.
        </Note>
        <StatusList statuses={sceneStatuses} onChange={(sceneStatuses) => updateSettings({ sceneStatuses })} subject="Scenes" />
      </Group>
    </SectionBody>
  );
}
