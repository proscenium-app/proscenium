// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Settings › Formats (docs/app/formatting/formats-and-layout.md#SET-D104): every format,
 * and what can be done around one — make one (New Format, Duplicate), change
 * one (Edit, in the format designer), bring one in (Import…), send one out
 * (Export…), throw one away (Move to Trash), and choose the one new plays start
 * in. The document menu's Edit Formats… opens the designer directly.
 */
import { useRef, useState } from "react";
import {
  DEFAULT_FORMAT_ID,
  formatFileText,
  parseFormatFile,
  reloadFormats,
  type FormatSpec,
} from "../../format";
import { settings as ipc, formats } from "../../storage";
import type { VaultPlay } from "../../workspace";
import {
  Button,
  ArrowUpIcon,
  ArrowDownIcon,
  announce,
  Chip,
  EllipsisIcon,
  IconButton,
  Menu,
  PopupButton,
  useMenu,
  useToast,
} from "../../ui";
import { listInWords } from "../formats/draft";
import type { DesignerRequest } from "../formats/open";
import { useFormatRegistry } from "../formats/use-formats";
import { Group, Note, SectionBody } from "./parts";
import { updateSettings, useSettings } from "./store";

export function FormatsSlot({
  canReveal,
  plays,
  onOpenDesigner,
}: {
  canReveal: boolean;
  /** The plays in the Plays folder, so a deleted format can name who used it. */
  plays: readonly VaultPlay[];
  /** Settings closes, and the designer opens on this. */
  onOpenDesigner: (request: DesignerRequest) => void;
}) {
  const registry = useFormatRegistry();
  const { defaultFormat, formatOrder } = useSettings();
  const toast = useToast();
  const rank = (id: string) => {
    const at = formatOrder.indexOf(id);
    return at < 0 ? formatOrder.length : at;
  };
  const list = [...registry.list()].sort((a, b) => rank(a.id) - rank(b.id));
  const [dragged, setDragged] = useState<string | null>(null);
  const move = (from: number, to: number) => {
    if (from < 0 || to < 0 || to >= list.length || from === to) return;
    const ids = list.map((s) => s.id);
    const [id] = ids.splice(from, 1);
    ids.splice(to, 0, id);
    updateSettings({ formatOrder: ids });
    announce(`Moved “${list[from].name}” to ${to + 1}.`);
  };
  const fallback = registry.get(DEFAULT_FORMAT_ID);
  const newPlays = defaultFormat && registry.has(defaultFormat) ? defaultFormat : DEFAULT_FORMAT_ID;

  const importFormat = async () => {
    let picked;
    try {
      picked = await formats.importFile();
    } catch (e) {
      toast({
        kind: "error",
        title: "The file could not be read.",
        detail: String(e),
        code: "E-FORMAT-READ",
      });
      return;
    }
    if (!picked) return;
    const result = parseFormatFile(picked.fileName, picked.content);
    if (!result.ok) {
      toast({
        kind: "error",
        title: `“${picked.fileName}” is not a format Proscenium can use.`,
        detail: result.errors[0],
        code: "E-FORMAT-IMPORT",
      });
      return;
    }
    const { spec } = result;
    // Its id is taken: bring it in unsaved, and let Save ask for another name.
    if (registry.has(spec.id)) {
      onOpenDesigner({ kind: "imported", spec, returnTo: "settings" });
      return;
    }
    try {
      await formats.save(`${spec.id}.json`, picked.content);
      await reloadFormats();
      toast({ kind: "ok", title: `Imported “${spec.name}”` });
    } catch (e) {
      toast({
        kind: "error",
        title: `“${spec.name}” could not be imported.`,
        detail: String(e),
        code: "E-FORMAT-IMPORT",
      });
    }
  };

  return (
    <SectionBody title="Formats">
      <Note>
        A format sets how a script is laid out on the page: margins, indents, spacing and page
        breaks. Built-in formats can’t be changed.
      </Note>

      <Group label="All formats">
        <Note>The first three appear in the script-name menu.</Note>
        <ul className="formatlist" aria-label="Formats">
          {list.map((spec, i) => (
            <FormatRow
              key={spec.id}
              spec={spec}
              position={i}
              count={list.length}
              onMove={(to) => move(i, to)}
              onDragStart={() => setDragged(spec.id)}
              onDrop={() => {
                move(
                  list.findIndex((s) => s.id === dragged),
                  i,
                );
                setDragged(null);
              }}
              onDragEnd={() => setDragged(null)}
              builtin={registry.isBuiltin(spec.id)}
              fileName={(() => {
                const origin = registry.origin(spec.id);
                return origin?.kind === "user" ? origin.fileName : null;
              })()}
              isDefault={spec.id === newPlays}
              usedBy={plays.filter((p) => (p.format ?? DEFAULT_FORMAT_ID) === spec.id)}
              fallbackName={fallback?.name ?? DEFAULT_FORMAT_ID}
              onOpenDesigner={onOpenDesigner}
              onDeleted={() => {
                if (defaultFormat === spec.id) updateSettings({ defaultFormat: null });
              }}
            />
          ))}
        </ul>
        <div className="settings__actions">
          <Button onClick={() => onOpenDesigner({ kind: "new", returnTo: "settings" })}>
            New Format…
          </Button>
          <Button onClick={() => void importFormat()}>Import Format…</Button>
          {canReveal && (
            <Button
              onClick={() =>
                void ipc.openFormatsFolder().catch(() =>
                  toast({
                    kind: "error",
                    title: "The Formats folder could not be opened.",
                    code: "E-FORMATS-FOLDER",
                  }),
                )
              }
            >
              Open Formats Folder
            </Button>
          )}
        </div>
      </Group>

      <Group label="New plays">
        <div className="settings__row">
          <span className="settings__rowlabel">Start new plays in</span>
          <PopupButton
            label="Start new plays in"
            size="small"
            menuWidth={260}
            value={newPlays}
            options={list.map((spec) => ({ value: spec.id, label: spec.name }))}
            onChange={(id) =>
              updateSettings({ defaultFormat: id === DEFAULT_FORMAT_ID ? null : id })
            }
          />
        </div>
        <Note>Existing plays keep their format.</Note>
      </Group>

      {registry.warnings.length > 0 && (
        <Group label="Problems in the Formats folder">
          <ul className="formatlist__problems">
            {registry.warnings.map((w) => (
              <li key={`${w.source}:${w.message}`}>
                <span className="mono">{w.source}</span>: {w.message}
              </li>
            ))}
          </ul>
        </Group>
      )}
    </SectionBody>
  );
}

function FormatRow(props: {
  position: number;
  count: number;
  onMove: (to: number) => void;
  onDragStart: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
  spec: FormatSpec;
  builtin: boolean;
  fileName: string | null;
  isDefault: boolean;
  usedBy: VaultPlay[];
  fallbackName: string;
  onOpenDesigner: (request: DesignerRequest) => void;
  onDeleted: () => void;
}) {
  const { spec, builtin, fileName } = props;
  const toast = useToast();
  const more = useRef<HTMLButtonElement | null>(null);
  const menu = useMenu();
  const [busy, setBusy] = useState(false);

  const exportFormat = async () => {
    try {
      const where = await formats.exportFile(`${spec.id}.json`, formatFileText(spec));
      if (where) toast({ kind: "ok", title: `Exported “${spec.name}”`, detail: where });
    } catch (e) {
      toast({
        kind: "error",
        title: `“${spec.name}” could not be exported.`,
        detail: String(e),
        code: "E-FORMAT-EXPORT",
      });
    }
  };

  /* To the Trash, not confirmed — Finder's rule for a recoverable action — and
     the toast says what it costs: which plays lose it, and to which format. The
     undo is real: the file's contents are in hand before it goes. */
  const trash = async () => {
    if (!fileName || busy) return;
    setBusy(true);
    const content = formatFileText(spec);
    try {
      await formats.trash(fileName);
      await reloadFormats();
      props.onDeleted();
      const names = props.usedBy.map((p) => `“${p.title}”`);
      toast({
        kind: "trash",
        title: `“${spec.name}” moved to the Trash`,
        detail: names.length
          ? `${listInWords(names)} ${names.length === 1 ? "uses" : "use"} ${props.fallbackName} until you choose another format.`
          : "No play in this folder was using it.",
        action: {
          label: "Undo",
          run: () =>
            void formats
              .save(fileName, content)
              .then(() => reloadFormats())
              .catch((e) =>
                toast({
                  kind: "error",
                  title: `“${spec.name}” could not be restored.`,
                  detail: String(e),
                  code: "E-FORMAT-TRASH",
                }),
              ),
        },
      });
    } catch (e) {
      toast({
        kind: "error",
        title: `“${spec.name}” could not be moved to the Trash.`,
        detail: String(e),
        code: "E-FORMAT-TRASH",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <li
      className="formatlist__row"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        props.onDrop();
      }}
    >
      <span
        draggable
        aria-hidden="true"
        title="Drag to reorder"
        className="statuslist__grip"
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", spec.id);
          props.onDragStart();
        }}
        onDragEnd={props.onDragEnd}
      >
        ⠿
      </span>
      <span className="formatlist__name">{spec.name}</span>
      {props.position < 3 && <Chip tiny>In menu</Chip>}
      {builtin ? (
        <Chip tiny>Built-in</Chip>
      ) : (
        <span className="formatlist__file mono">{fileName}</span>
      )}
      {props.isDefault && <Chip tiny>New plays</Chip>}
      <span className="sheet__spacer" />
      <IconButton
        size="small"
        label={`Move “${spec.name}” up`}
        disabled={props.position === 0}
        onClick={() => props.onMove(props.position - 1)}
      >
        <ArrowUpIcon size={12} />
      </IconButton>
      <IconButton
        size="small"
        label={`Move “${spec.name}” down`}
        disabled={props.position === props.count - 1}
        onClick={() => props.onMove(props.position + 1)}
      >
        <ArrowDownIcon size={12} />
      </IconButton>
      <Button
        size="small"
        onClick={() =>
          props.onOpenDesigner(
            builtin
              ? { kind: "duplicate", formatId: spec.id, returnTo: "settings" }
              : { kind: "edit", formatId: spec.id, returnTo: "settings" },
          )
        }
        aria-label={`${builtin ? "Duplicate" : "Edit"} “${spec.name}”`}
      >
        {builtin ? "Duplicate…" : "Edit…"}
      </Button>
      <IconButton
        ref={more}
        size="small"
        label={`More actions for “${spec.name}”`}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        onClick={() => menu.openFrom(more.current, "end")}
      >
        <EllipsisIcon size={13} />
      </IconButton>
      {menu.anchor && (
        <Menu
          anchor={menu.anchor}
          onClose={menu.close}
          label={spec.name}
          width={200}
          entries={
            builtin
              ? [
                  {
                    label: "Preview…",
                    onSelect: () =>
                      props.onOpenDesigner({
                        kind: "edit",
                        formatId: spec.id,
                        returnTo: "settings",
                      }),
                  },
                  { label: "Export…", onSelect: () => void exportFormat() },
                ]
              : [
                  {
                    label: "Duplicate…",
                    onSelect: () =>
                      props.onOpenDesigner({
                        kind: "duplicate",
                        formatId: spec.id,
                        returnTo: "settings",
                      }),
                  },
                  { label: "Export…", onSelect: () => void exportFormat() },
                  { kind: "sep" },
                  { label: "Move to Trash", destructive: true, onSelect: () => void trash() },
                ]
          }
        />
      )}
    </li>
  );
}
