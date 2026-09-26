// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Settings (⌘,) — one sheet, sections down the left (settings-and-format-
 * designer.md, Part A).
 *
 * It was one scrolling column of four groups. Privacy, updates and formats are
 * each on their way in from their own thread, and seven groups in a column is
 * a column nobody finds anything in, so the sheet is sectioned the way a Mac
 * Settings window is: a list of sections, and the one that is chosen.
 *
 * **The section list is a vertical tablist: one Tab stop, arrows inside it**
 * (docs/app/preferences-and-help/accessibility.md#UI-D108). ↑ and ↓ move between sections and show each as
 * they go — a section is a page of switches, cheap to show, and flicking
 * through them is how a writer looks for one. Tab leaves the list for the
 * section, and Tab from the last control wraps back to the chosen section,
 * not to General.
 */
import { useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { Button, Sheet } from "../../ui";
import { tabbables } from "../../ui/layers";
import type { VaultPlay } from "../../workspace";
import type { DesignerRequest } from "../formats/open";
import { ShortcutList } from "../ShortcutsOverlay";
import { HelpContent } from "../Help";
import { SectionBody } from "./parts";
import { About } from "./About";
import { Appearance } from "./Appearance";
import { FormatsSlot } from "./Formats";
import { General } from "./General";
import { PrivacySlot } from "./Privacy";
import { SETTINGS_SECTIONS, stepSection, type SettingsSection } from "./sections";
import { UpdatesSlot } from "./Updates";
import { Writing } from "./Writing";

export interface SettingsSheetProps {
  section: SettingsSection;
  onSection: (section: SettingsSection) => void;
  onClose: () => void;
  /** The Plays folder's path, or null before one has been chosen. */
  playsFolder: string | null;
  /** The one sentence about where the plays live (docs/app/keeping-work/storage-and-file-format.md#STOR-D11). */
  wherePlaysLive: string;
  onChangePlaysFolder: () => void;
  /** This build has a Finder to show a folder in (capabilities, never platform). */
  canReveal: boolean;
  onShowShortcuts: () => void;
  /** The plays in the Plays folder — Formats names the ones a deleted format leaves. */
  plays: readonly VaultPlay[];
  /** Close Settings and open the format designer (Formats). */
  onOpenDesigner: (request: DesignerRequest) => void;
}

const PANEL_ID = "settings-panel";
const tabId = (section: SettingsSection) => `settings-tab-${section}`;

export function SettingsSheet(props: SettingsSheetProps) {
  const { section, onSection, onClose } = props;
  const tabs = useRef(new Map<SettingsSection, HTMLButtonElement>());
  const panel = useRef<HTMLDivElement | null>(null);

  /* Focus starts on the chosen section, so the arrows work at once and a
     screen reader hears where it is — "Privacy, tab, 5 of 7" — when a notice
     deep-linked there. A layout effect, so it lands before the sheet's own
     mount focus looks and finds focus already inside. */
  useLayoutEffect(() => {
    // Once, on open: later changes of section move focus where they happen.
    tabs.current.get(section)?.focus({ preventScroll: true });
  }, []);

  // A new section starts at its top, not wherever the last one was scrolled to.
  useLayoutEffect(() => {
    if (panel.current) panel.current.scrollTop = 0;
  }, [section]);

  /* A panel with nothing to operate — a slot still waiting for its thread —
     takes a Tab stop, so its words can be reached and scrolled by keyboard.
     Asked after every render, because a slot fills in without this sheet
     knowing. */
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el) return;
    if (tabbables(el).length === 0) el.tabIndex = 0;
    else el.removeAttribute("tabindex");
  });

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const to = stepSection(section, e.key);
    if (!to) return;
    e.preventDefault();
    onSection(to);
    tabs.current.get(to)?.focus();
  };

  return (
    <Sheet
      title="Settings"
      width={700}
      height={520}
      onClose={onClose}
      footer={
        <>
          {/* settings.json and the formats live in the app's own folders, so
              nothing here travels with a play or changes one. */}
          <span className="sheet__hint">Settings are saved on this Mac, not in your plays.</span>
          <span className="sheet__spacer" />
          <Button treatment="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="prefs">
        <div
          className="prefs__nav"
          role="tablist"
          aria-orientation="vertical"
          aria-label="Settings sections"
          onKeyDown={onListKey}
        >
          {SETTINGS_SECTIONS.map((s) => {
            const on = s.id === section;
            return (
              <button
                key={s.id}
                ref={(el) => {
                  if (el) tabs.current.set(s.id, el);
                  else tabs.current.delete(s.id);
                }}
                type="button"
                role="tab"
                id={tabId(s.id)}
                aria-selected={on}
                // One panel, whose content changes: every tab controls it, so
                // none of them points at an id that is not in the document.
                aria-controls={PANEL_ID}
                tabIndex={on ? 0 : -1}
                className={`prefs__tab${on ? " is-selected" : ""}`}
                onClick={() => onSection(s.id)}
              >
                {s.label}
              </button>
            );
          })}
        </div>
        <div
          ref={panel}
          className="prefs__panel"
          role="tabpanel"
          id={PANEL_ID}
          aria-labelledby={tabId(section)}
        >
          {section === "general" && (
            <General
              playsFolder={props.playsFolder}
              wherePlaysLive={props.wherePlaysLive}
              canReveal={props.canReveal}
              onChangePlaysFolder={props.onChangePlaysFolder}
            />
          )}
          {section === "appearance" && <Appearance />}
          {section === "writing" && <Writing />}
          {section === "formats" && (
            <FormatsSlot
              canReveal={props.canReveal}
              plays={props.plays}
              onOpenDesigner={props.onOpenDesigner}
            />
          )}
          {section === "privacy" && <PrivacySlot />}
          {section === "updates" && <UpdatesSlot />}
          {section === "shortcuts" && <SectionBody title="Keyboard Shortcuts"><ShortcutList /></SectionBody>}
          {section === "help" && <HelpContent onOpen={() => {onClose();requestAnimationFrame(() => window.dispatchEvent(new Event("proscenium:help")));}} />}
          {section === "about" && <About plays={props.plays} />}
        </div>
      </div>
    </Sheet>
  );
}
