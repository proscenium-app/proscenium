// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from "react";
import { Button, PopupButton, Sheet, type PopupOption } from "../ui";
import { dropPlan, findItem, isAncestor, titleOf } from "./binder";
import type { BinderItem } from "./play-file";

/** Stable ids carry the choices; the current tree resolves the move at apply. */
export function BinderMoveSheet({ binder, itemId, playTitle, onClose, onMove }: {
  binder: BinderItem[];
  itemId: string;
  playTitle: string;
  onClose: () => void;
  onMove: (parentId: string | null, index: number) => void;
}) {
  const source = findItem(binder, itemId);
  const [parent, setParent] = useState(source?.parentId ?? "");
  const [position, setPosition] = useState("end");
  const destinations: PopupOption<string>[] = [{ value: "", label: `${playTitle} — top level` }];
  const walk = (items: BinderItem[], prefix = "") => {
    for (const item of items) {
      if (item.type !== "folder" || item.id === itemId || isAncestor(binder, itemId, item.id)) continue;
      const label = prefix + titleOf(item);
      destinations.push({ value: item.id, label });
      walk(item.children ?? [], `${label} / `);
    }
  };
  walk(binder);
  const validParent = destinations.some((destination) => destination.value === parent);
  const siblings = (parent ? findItem(binder, parent)?.item.children ?? [] : binder)
    .filter((item) => item.id !== itemId);
  const positions: PopupOption<string>[] = [
    ...siblings.map((item) => ({ value: `before:${item.id}`, label: `Before ${titleOf(item)}` })),
    { value: "end", label: "At the end" },
  ];
  const plan = source && validParent && positions.some((option) => option.value === position)
    ? dropPlan(binder, itemId, position === "end" ? parent || null : position.slice("before:".length), position === "end" ? "inside" : "before")
    : null;
  const apply = () => { if (plan) onMove(plan.parentId, plan.atIndex); };
  return (
    <Sheet title={`Move “${source ? titleOf(source.item) : "Item"}”`} width={440} onClose={onClose}
      onDefault={plan ? apply : undefined} labelledBy="binder-move-title"
      footer={<><span className="sheet__spacer" /><Button onClick={onClose}>Cancel</Button>
        <Button treatment="primary" disabled={!plan} onClick={apply}>Move</Button></>}>
      <div className="binder-move formgrid">
        <span className="formgrid__label">Folder</span>
        <PopupButton label="Folder" options={destinations} value={parent}
          onChange={(value) => { setParent(value); setPosition("end"); }} />
        <span className="formgrid__label">Position</span>
        <PopupButton label="Position" options={positions} value={position} onChange={setPosition} />
      </div>
    </Sheet>
  );
}
