// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Settings › Writing — the page map, the name comments are signed with, spell
 * check, and the words the writer has taught the checker.
 *
 * Spell check here and Check Spelling as You Type in the document menu are one
 * setting in one store (ui/settings-store.ts), so neither can show a state the
 * other does not.
 *
 * **Two checkers, and the notes say which is which.** This switch and this
 * word list are the script's own checker (editor/spellcheck.ts). Documents and
 * character sheets are checked by the system through WebKit whatever the
 * switch says, and Learn Spelling there goes to the system's dictionary. Where
 * the system's spelling may not run (an iPad, ui/system-traits.ts), nothing
 * checks a document, and the notes say so rather than name a checker that is
 * not there.
 */
import { openSpellingMenu, systemWords } from "../../ui/system-words";
import { systemSpelling } from "../../ui/system-traits";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, CloseIcon, IconButton, announce } from "../../ui";
import { Group, Note, SectionBody, SwitchRow } from "./parts";
import { forgetWord, learnWord, updateSettings, useSettings } from "../../ui/settings-store";
import { cleanCommentName, commentNameInput } from "../../comments/model";
import { AS_TYPED } from "../../ui/as-typed";

/**
 * The name the writer's comments are signed with (docs/app/writing/comments.md#COMM-52).
 * The same name the comment field asks for the first time a comment is made:
 * this is where it is changed, or cleared to sign nothing. Stored when the
 * field is left or ⏎ is pressed, not on every letter.
 */
function CommentName() {
  const { commentName } = useSettings();
  const [value, setValue] = useState(commentName);
  // A name given in a comment's own field shows here too.
  useEffect(() => setValue(commentName), [commentName]);
  const commit = () => {
    const name = cleanCommentName(value);
    setValue(name);
    if (name === commentName) return;
    updateSettings({ commentName: name });
    announce(name ? `Comments will be signed ${name}.` : "Comments will not be signed.");
  };
  // Esc closes the sheet without the field ever losing focus: a name typed and
  // not yet stored is stored as the field goes, like every other setting here.
  const leaving = useRef(commit);
  leaving.current = commit;
  useEffect(() => () => leaving.current(), []);
  return (
    <Group label="Comments">
      <label className="settings__row">
        <span className="settings__rowlabel">Your name</span>
        <input
          className="field"
          aria-label="Your name"
          aria-describedby="comment-name-note"
          value={value}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setValue(commentNameInput(e.target.value))}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
          }}
        />
      </label>
      <Note id="comment-name-note">
        Signs the comments and replies you add, so a reader can tell them from someone else’s. The
        name is written into the script with each one.
      </Note>
    </Group>
  );
}

export function Writing() {
  const { runningTimeStrip, scenePlaceMarker, spellcheck, learnedWords, autoCaps } = useSettings();
  const { machine, system } = systemWords();
  const documentsChecked = systemSpelling();
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
        {/* docs/app/preferences-and-help/settings.md#SET-45: the marker lives on
            the strip, so with the strip off it has nothing to sit on. */}
        <SwitchRow
          label="Show your place in the scene"
          on={scenePlaceMarker}
          disabled={!runningTimeStrip}
          onChange={(on) => updateSettings({ scenePlaceMarker: on })}
          note={
            runningTimeStrip
              ? "A line on the strip shows how far through the scene on screen you are."
              : "A line on the strip shows how far through the scene on screen you are. Turn on the scene navigation strip to use it."
          }
        />
        {/* docs/app/writing/editor-ux.md#EDIT-54: auto-caps, and with it the
            names in the directions (docs/app/writing/editor-ux.md#EDIT-202). */}
        <SwitchRow
          label="Capitalize as you type"
          on={autoCaps}
          onChange={(on) => updateSettings({ autoCaps: on })}
          note="Character cues, act and scene headings and transitions go into capitals as you type them. So do character names in stage directions, in formats that print them that way."
        />
      </Group>

      <CommentName />

      <Group label="Spelling">
        <SwitchRow
          label="Check spelling as you type"
          on={spellcheck}
          onChange={(on) => updateSettings({ spellcheck: on })}
          note={
            documentsChecked
              ? `Underlines misspelled words in scripts. Documents and character sheets are checked by ${system}, which this switch doesn’t affect.`
              : `Underlines misspelled words in scripts. Documents and character sheets aren’t checked on this ${machine}.`
          }
        />
      </Group>

      <Group label="Proscenium dictionary">
        <Note>
          Words added here are accepted in every script on this {machine}.
          {documentsChecked &&
            ` Documents and character sheets use the ${system} dictionary, which is shared with other apps.`}
        </Note>
        <div>
          <form
            className="settings__actions"
            onSubmit={(e) => {
              e.preventDefault();
              addWord();
            }}
          >
            <input
              // The word as the writer spells it: no capital or correction of iPadOS's.
              {...AS_TYPED}
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
            <Button type="submit" disabled={!newWord.trim()}>
              Add Word
            </Button>
          </form>
          {/* Mounted empty, so it is read when it fills (StatusList does the same). */}
          <p
            id="dictionary-problem"
            className="settings__note settings__problem"
            aria-live="polite"
          >
            {wordProblem}
          </p>
        </div>
        <p className="settings__note" ref={noteRef} tabIndex={-1}>
          {learnedWords.length === 0
            ? `No words added. In a script, ${openSpellingMenu()} and choose Learn Spelling to add it.`
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
    </SectionBody>
  );
}
