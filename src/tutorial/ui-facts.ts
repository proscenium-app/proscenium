// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the window shows that no store holds: which menu is open and what its
 * rows are, whether a sheet is up, which control has focus and what a field
 * holds before it is committed. The guide reads these to take the writer
 * through a menu or a sheet one choice at a time (docs/app/preferences-and-help/tutorials.md#TUT-D104).
 *
 * Menus and sheets open and close without a React update that reaches the
 * app shell, so this looks each frame while a lesson runs, and on a timer as
 * well, because a hidden window runs no frames. Reading is all it does.
 */
import { useEffect, useState } from "react";
import type { UiFacts } from "./coach";

export const NO_UI: UiFacts = {
  menu: [],
  elementMenu: false,
  sheet: null,
  focus: null,
  focusText: "",
  fields: {},
};
/** Fields the coach reads before they are committed, by their `data-tutorial` id. */
const FIELDS = ["tag-field", "opening-notes"];

const shown = (el: Element | null): el is HTMLElement => {
  if (!(el instanceof HTMLElement) || !el.isConnected) return false;
  const box = el.getBoundingClientRect();
  return box.width > 0 && box.height > 0 && !el.closest("[inert], [aria-hidden='true']");
};
/** A field's text: an input's value, else the editable text inside it. */
function valueOf(el: HTMLElement): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value;
  const inner = el.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
  if (inner) return inner.value;
  return (el.querySelector<HTMLElement>("[contenteditable='true']") ?? el).innerText ?? "";
}

export function readUi(): UiFacts {
  const menu = [...document.querySelectorAll<HTMLElement>(".menu [data-menu-id]")]
    .filter(shown)
    .map((el) => el.dataset.menuId!);
  const element = document.querySelector<HTMLElement>(".pl-elementmenu");
  const elementMenu =
    !!element && element.style.display !== "none" && element.childElementCount > 0;
  const scrims = document.querySelectorAll(".modal-scrim");
  const top = scrims[scrims.length - 1];
  const sheet = !top
    ? null
    : top.querySelector('[data-tutorial="export-range"]')
      ? "export"
      : top.querySelector('[data-tutorial="opening-notes"]')
        ? "opening-pages"
        : "other";
  const active =
    document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null;
  const holder = active?.closest<HTMLElement>("[data-tutorial]") ?? null;
  const fields: Record<string, string> = {};
  for (const id of FIELDS) {
    const el = [...document.querySelectorAll(`[data-tutorial="${id}"]`)].find(shown);
    if (el) fields[id] = valueOf(el);
  }
  return {
    menu,
    elementMenu,
    sheet,
    focus: holder?.dataset.tutorial ?? null,
    focusText: holder ? valueOf(active!) : "",
    fields,
  };
}

const key = (u: UiFacts) => JSON.stringify(u);
export function useUiFacts(watching: boolean): UiFacts {
  const [ui, setUi] = useState<UiFacts>(NO_UI);
  useEffect(() => {
    if (!watching) {
      setUi(NO_UI);
      return;
    }
    let last = "",
      frame = 0;
    const look = () => {
      const now = readUi(),
        k = key(now);
      if (k !== last) {
        last = k;
        setUi(now);
      }
    };
    const loop = () => {
      look();
      frame = requestAnimationFrame(loop);
    };
    loop();
    const timer = window.setInterval(look, 250);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(timer);
    };
  }, [watching]);
  return ui;
}
