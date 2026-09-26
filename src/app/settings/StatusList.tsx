// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Settings › General › Statuses: the words a play can carry on the Plays screen
 * (docs/app/preferences-and-help/settings.md#SET-7). They were a list fixed in VaultScreen.tsx. The list is a
 * sequence, idea to produced, so the editor reorders as well as adds, renames
 * and deletes.
 *
 * **Every drag has keys** (docs/app/preferences-and-help/accessibility.md#UI-D108). A row moves by dragging
 * its grip, by its Move Up and Move Down buttons, or by ⌃⌘↑ and ⌃⌘↓ in its
 * name — the binder's keys for moving a row. What changed is said through the
 * announcer, because focus stays where the writer put it.
 *
 * **Renaming or deleting changes this list only.** A play keeps the word its
 * play file holds, and the Plays screen still offers that word for that play
 * (docs/app/keeping-work/storage-and-file-format.md#STOR-D5 calls the status a free-form label). Rewriting every play file
 * that had the old word would be a guarded write per play, and a play on
 * another device would keep it anyway.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, Button, IconButton, TrashIcon, announce } from "../../ui";
import { MAX_STATUSES, MAX_STATUS_CHARS } from "../../storage/settings-model";

type Part = "name" | "up" | "down";
/** Where focus goes once a change has rendered: a row can remount under a new name. */
type Refocus = { name: string; part: Part } | { part: "add" } | null;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function StatusList({
  statuses,
  onChange,
  subject = "Plays",
}: {
  statuses: readonly string[];
  subject?: string;
  onChange: (next: string[]) => void;
}) {
  const [adding, setAdding] = useState("");
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [refocus, setRefocus] = useState<Refocus>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const addRef = useRef<HTMLInputElement | null>(null);
  /* Why an add or a rename did not happen. It used to be said to VoiceOver
     alone: a sighted writer pressed Add Status and saw nothing, or watched a
     rename snap back, with no reason on screen. */
  const [problem, setProblem] = useState("");
  const problemId = useId();

  useLayoutEffect(() => {
    if (!refocus) return;
    setRefocus(null);
    if (refocus.part === "add") {
      addRef.current?.focus();
      return;
    }
    const row = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-status]") ?? [])].find(
      (el) => el.dataset.status === refocus.name,
    );
    const button = row?.querySelector<HTMLButtonElement>(`[data-part="${refocus.part}"]`);
    // A Move button that reached the end of the list is disabled: its name then.
    (button && !button.disabled ? button : row?.querySelector<HTMLElement>('[data-part="name"]'))?.focus();
  }, [refocus, statuses]);

  /** The list with row `index` renamed to `draft`, or null (and why, shown) when it cannot be. */
  const renamed = (index: number, draft: string): string[] | null => {
    const next = draft.trim();
    if (next === statuses[index]) return [...statuses];
    if (!next) {
      setProblem(`A status can’t be blank, so “${statuses[index]}” keeps its name.`);
      return null;
    }
    if (statuses.some((s, i) => i !== index && same(s, next))) {
      setProblem(`“${next}” is already in the list, so “${statuses[index]}” keeps its name.`);
      return null;
    }
    return statuses.map((s, i) => (i === index ? next : s));
  };

  const rename = (index: number, draft: string, refocusName: boolean): boolean => {
    const was = statuses[index];
    const list = renamed(index, draft);
    if (!list) return false;
    if (list[index] === was) return true;
    onChange(list);
    setProblem("");
    if (refocusName) setRefocus({ name: list[index], part: "name" });
    announce(`Renamed “${was}” to “${list[index]}”. ${subject} that have “${was}” keep it.`);
    return true;
  };

  /** Move row `from` to `to`, taking a name still being typed with it. */
  const move = (from: number, to: number, part: Part, draft?: string) => {
    if (to < 0 || to >= statuses.length || from === to) return;
    const list = draft === undefined ? [...statuses] : renamed(from, draft);
    if (!list) return;
    const [name] = list.splice(from, 1);
    list.splice(to, 0, name);
    onChange(list);
    setProblem("");
    setRefocus({ name, part });
    announce(`Moved “${name}” to ${to + 1} of ${list.length}.`);
  };

  const remove = (index: number) => {
    const name = statuses[index];
    const list = statuses.filter((_, i) => i !== index);
    onChange(list);
    setProblem("");
    const neighbour = list[index] ?? list[index - 1];
    setRefocus(neighbour ? { name: neighbour, part: "name" } : { part: "add" });
    announce(`Deleted “${name}”. ${subject} that have it keep it.`);
  };

  const full = statuses.length >= MAX_STATUSES;
  const add = () => {
    const name = adding.trim();
    if (!name) return;
    if (statuses.some((s) => same(s, name))) {
      // The typed name stays in the field, to change rather than retype.
      setProblem(`“${name}” is already in the list.`);
      return;
    }
    if (full) return;
    onChange([...statuses, name]);
    setAdding("");
    setProblem("");
    setRefocus({ part: "add" });
    announce(`Added “${name}”, ${statuses.length + 1} of ${statuses.length + 1}.`);
  };

  const endDrag = () => {
    setDragFrom(null);
    setDropAt(null);
  };

  return (
    <>
      {statuses.length > 0 ? (
        <ul className="statuslist" ref={listRef} aria-label="Statuses, in order">
          {statuses.map((name, i) => (
            <StatusRow
              key={name.toLowerCase()}
              name={name}
              index={i}
              count={statuses.length}
              dropping={dropAt === i && dragFrom !== null && dragFrom !== i}
              onRename={(draft, refocusName) => rename(i, draft, refocusName)}
              onTyping={() => setProblem("")}
              onMove={(to, part, draft) => move(i, to, part, draft)}
              onDelete={() => remove(i)}
              onDragStart={() => setDragFrom(i)}
              onDragOver={() => setDropAt(i)}
              onDrop={() => {
                if (dragFrom !== null) move(dragFrom, i, "name");
                endDrag();
              }}
              onDragEnd={endDrag}
            />
          ))}
        </ul>
      ) : (
        <p className="settings__note">No statuses.</p>
      )}
      <div>
        <div className="statuslist__add">
          <input
            ref={addRef}
            className="field statuslist__field"
            value={adding}
            maxLength={MAX_STATUS_CHARS}
            placeholder="New status"
            aria-label="New status"
            aria-describedby={problemId}
            onChange={(e) => {
              setAdding(e.target.value);
              setProblem("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button size="small" onClick={add} disabled={!adding.trim() || full}>
            Add Status
          </Button>
        </div>
        {/* Mounted empty, so it is read when it fills: WebKit does not read a
            live region that mounts already full. */}
        <p id={problemId} className="settings__note settings__problem" aria-live="polite">
          {problem}
        </p>
      </div>
      {/* Add Status goes grey at the limit; this says why. */}
      {full && <p className="settings__note">A list can hold up to {MAX_STATUSES} statuses.</p>}
    </>
  );
}

function StatusRow({
  name,
  index,
  count,
  dropping,
  onRename,
  onTyping,
  onMove,
  onDelete,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  name: string;
  index: number;
  count: number;
  dropping: boolean;
  onRename: (draft: string, refocus: boolean) => boolean;
  /** The name is being typed: an earlier problem no longer applies. */
  onTyping: () => void;
  onMove: (to: number, part: Part, draft?: string) => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDragOver: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
}) {
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);
  const commit = (refocus: boolean) => {
    if (draft !== name && !onRename(draft, refocus)) setDraft(name);
  };
  const typed = draft !== name ? draft : undefined;

  return (
    <li
      className={`statuslist__row${dropping ? " is-drop" : ""}`}
      data-status={name}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        onDragOver();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
    >
      {/* The pointer's way to reorder. Out of the Tab order and hidden from
          VoiceOver: the Move buttons and ⌃⌘↑↓ do the same by name. */}
      <span
        className="statuslist__grip"
        draggable
        aria-hidden="true"
        title="Drag to reorder"
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", name);
          onDragStart();
        }}
        onDragEnd={onDragEnd}
      >
        <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor">
          <circle cx="2" cy="2" r="1" />
          <circle cx="6" cy="2" r="1" />
          <circle cx="2" cy="6" r="1" />
          <circle cx="6" cy="6" r="1" />
          <circle cx="2" cy="10" r="1" />
          <circle cx="6" cy="10" r="1" />
        </svg>
      </span>
      <input
        className="field statuslist__field"
        data-part="name"
        value={draft}
        maxLength={MAX_STATUS_CHARS}
        aria-label={`Status ${index + 1} of ${count}: ${name}`}
        aria-keyshortcuts="Control+Meta+ArrowUp Control+Meta+ArrowDown"
        onChange={(e) => {
          setDraft(e.target.value);
          onTyping();
        }}
        onBlur={() => commit(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(true);
          } else if (e.ctrlKey && e.metaKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
            e.preventDefault();
            onMove(index + (e.key === "ArrowUp" ? -1 : 1), "name", typed);
          }
        }}
      />
      <IconButton
        data-part="up"
        label={`Move “${name}” up`}
        disabled={index === 0}
        onClick={() => onMove(index - 1, "up", typed)}
      >
        <ArrowUpIcon size={11} />
      </IconButton>
      <IconButton
        data-part="down"
        label={`Move “${name}” down`}
        disabled={index === count - 1}
        onClick={() => onMove(index + 1, "down", typed)}
      >
        <ArrowDownIcon size={11} />
      </IconButton>
      <IconButton label={`Delete “${name}”`} onClick={onDelete}>
        <TrashIcon size={12} />
      </IconButton>
    </li>
  );
}
