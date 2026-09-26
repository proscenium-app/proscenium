// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The find bar — a strip over the script, not a dialog, so the
 * writer can see the page while they search.
 *
 * The scope select is the point of the whole feature. "Every 'water' in the
 * file" is rarely the question; "every 'water' MARA says" is. Because the
 * document is typed blocks and the cue above a speech is known, that scope is a
 * dropdown rather than a project.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import type { FindScope, FindStorage } from "./find";
import { leftAloneNote } from "./find-core";
import { useAnnouncedStatus } from "../ui/use-announced-status";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, PopupButton, WarnIcon } from "../ui";

/** Fixed scopes, then one per speaker in the script. */
const ELEMENT_SCOPES: { id: string; label: string; scope: FindScope }[] = [
  { id: "all", label: "Whole script", scope: { kind: "all" } },
  { id: "dialogue", label: "Dialogue", scope: { kind: "element", types: ["dialogue", "lyric"] } },
  {
    id: "action",
    label: "Stage directions",
    scope: { kind: "element", types: ["action"] },
  },
  { id: "character", label: "Character cues", scope: { kind: "element", types: ["character"] } },
  {
    id: "headings",
    label: "Acts, scenes & headings",
    scope: { kind: "element", types: ["act", "scene", "sceneHeading", "transition"] },
  },
  {
    id: "notes",
    label: "Wrylies & synopses",
    scope: { kind: "element", types: ["parenthetical", "synopsis"] },
  },
];

const SPEAKER_PREFIX = "speaker:";

function scopeId(scope: FindScope): string {
  if (scope.kind === "speaker") return SPEAKER_PREFIX + scope.name;
  const hit = ELEMENT_SCOPES.find(
    (s) =>
      s.scope.kind === scope.kind &&
      (s.scope.kind !== "element" ||
        (scope.kind === "element" && s.scope.types.join() === scope.types.join())),
  );
  return hit?.id ?? "all";
}

function scopeFromId(id: string): FindScope {
  if (id.startsWith(SPEAKER_PREFIX)) {
    return { kind: "speaker", name: id.slice(SPEAKER_PREFIX.length) };
  }
  return ELEMENT_SCOPES.find((s) => s.id === id)?.scope ?? { kind: "all" };
}

export function FindBar({ editor }: { editor: Editor }) {
  const [find, setFind] = useState<FindStorage>(() => ({ ...editor.storage.find }));
  const [replacement, setReplacement] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const wasOpen = useRef(false);

  // Mirror the plugin's state (same subscription shape as ElementBar).
  useEffect(() => {
    const update = () => setFind({ ...editor.storage.find });
    editor.on("transaction", update);
    update();
    return () => {
      editor.off("transaction", update);
    };
  }, [editor]);

  // Opening focuses the field and selects what's in it, so a second ⌘F replaces
  // the query instead of appending to it.
  useEffect(() => {
    if (find.open && !wasOpen.current) inputRef.current?.select();
    wasOpen.current = find.open;
  }, [find.open]);

  // The element bar sticks just under this one, however many rows it has
  // wrapped to: its note and hint wrap in a narrow pane, and a fixed offset
  // left the element bar's buttons under this bar
  // (docs/app/writing/editor-ux.md#EDIT-171).
  useLayoutEffect(() => {
    const bar = barRef.current;
    const surface = bar?.parentElement;
    if (!bar || !surface) return;
    const publish = () =>
      surface.style.setProperty("--findbar-height", `${bar.getBoundingClientRect().height}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(bar);
    return () => {
      observer.disconnect();
      surface.style.removeProperty("--findbar-height");
    };
  }, [find.open]);

  useAnnouncedStatus(find.open && find.query
    ? find.total === 0 ? "No matches in the script." : `Match ${find.current} of ${find.total}.`
    : null);

  if (!find.open) return null;

  const close = () => {
    editor.commands.closeFind();
    editor.commands.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      editor.commands.stepFind(e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  const count =
    find.total === 0
      ? find.query
        ? "No matches"
        : ""
      : `${find.current} / ${find.total}`;
  const leftAlone = leftAloneNote(find.cueMatches, find.noteMatches);
  const replaceTitle =
    find.currentHeldBack === "cue"
      ? "This match is a character cue — renaming a character is its own job"
      : find.currentHeldBack === "note"
        ? "This match is in a comment — Replace leaves comments alone"
        : "Replace this match";

  return (
    <div
      ref={barRef}
      className={`findbar${find.replaceOpen ? " findbar--replace" : ""}`}
      role="search"
    >
      <div className="findbar__row">
        <input
          ref={inputRef}
          className="findbar__field"
          value={find.query}
          placeholder="Find in the script…"
          autoFocus
          aria-label="Find"
          onChange={(e) => editor.commands.setFindQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <span
          className={`findbar__count${find.query && find.total === 0 ? " is-empty" : ""}`}
        >
          {count}
        </span>
        {/* A joined pair: two keys of one control, radius at the ends only. */}
        <span className="findbar__steps">
          <button
            className="findbar__step"
            onClick={() => editor.commands.stepFind(-1)}
            disabled={find.total === 0}
            title="Previous match (⇧⏎)"
            aria-label="Previous match"
          >
            <ChevronLeftIcon size={10} />
          </button>
          <button
            className="findbar__step"
            onClick={() => editor.commands.stepFind(1)}
            disabled={find.total === 0}
            title="Next match (⏎)"
            aria-label="Next match"
          >
            <ChevronRightIcon size={10} />
          </button>
        </span>
        <PopupButton
          className="findbar__scope"
          label="Where to search"
          menuWidth={224}
          value={scopeId(find.opts.scope)}
          onChange={(id) => editor.commands.setFindOptions({ scope: scopeFromId(id) })}
          options={[
            ...ELEMENT_SCOPES.map((sc) => ({ value: sc.id, label: sc.label })),
            /* Cue names are the one place the app shows the script's own type
               in a control: they ARE Courier Prime on the page. */
            ...find.speakers.map((name) => ({
              value: SPEAKER_PREFIX + name,
              label: <span className="mono">{name}</span>,
              text: name,
              section: "One character's speeches",
            })),
          ]}
        />
        <button
          className={`findbar__toggle${find.opts.caseSensitive ? " is-on" : ""}`}
          onClick={() =>
            editor.commands.setFindOptions({ caseSensitive: !find.opts.caseSensitive })
          }
          title="Match case — cues are ALL CAPS, so this matters"
          aria-pressed={find.opts.caseSensitive}
        >
          Aa
        </button>
        <button
          className={`findbar__toggle${find.opts.wholeWord ? " is-on" : ""}`}
          onClick={() => editor.commands.setFindOptions({ wholeWord: !find.opts.wholeWord })}
          title="Whole word"
          aria-pressed={find.opts.wholeWord}
        >
          ab|
        </button>
        <button
          className={`findbar__toggle${find.replaceOpen ? " is-on" : ""}`}
          onClick={() => editor.commands.openFind(!find.replaceOpen ? true : false)}
          title="Replace (⌘⌥F)"
          aria-pressed={find.replaceOpen}
        >
          Replace…
        </button>
        <span className="findbar__spacer" />
        {/* Never silent: a search that will skip cues or comments says so
            before you act. */}
        {leftAlone && (
          <span className="findbar__note">
            <WarnIcon size={10} />
            {leftAlone}
          </span>
        )}
        <button className="findbar__close" onClick={close} title="Close (esc)" aria-label="Close">
          <CloseIcon size={11} />
        </button>
      </div>

      {find.replaceOpen && (
        <div className="findbar__row findbar__row--replace">
          <input
            className="findbar__field"
            value={replacement}
            placeholder="Replace with…"
            aria-label="Replace with"
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button
            className="findbar__btn"
            // No step afterwards: the replace itself resumes past what it wrote,
            // so this already lands on the next match.
            onClick={() => editor.commands.replaceCurrent(replacement)}
            disabled={find.total === 0 || find.currentHeldBack !== null}
            title={replaceTitle}
          >
            Replace
          </button>
          <button
            className="findbar__btn"
            onClick={() => editor.commands.replaceAll(replacement)}
            disabled={find.total - find.cueMatches - find.noteMatches === 0}
            title="Replace every match outside cues and comments, as one undo step"
          >
            Replace All
          </button>
          <span className="findbar__spacer" />
          <span className="sheet__hint">
            Cues and comments are left alone — renaming a character is its own command.
          </span>
        </div>
      )}
    </div>
  );
}
