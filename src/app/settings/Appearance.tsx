// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Settings › Appearance: interface text size, accent colour and light or dark. */
import { useRef, type KeyboardEvent } from "react";
import { ACCENTS, CheckIcon, Chip, PopupButton } from "../../ui";
import { Group, Note, SectionBody } from "./parts";
import { updateSettings, useSettings } from "./store";
import { useSystemAccent } from "./system-accent";

export function Appearance() {
  const { accent, interfaceTextSize, appearance } = useSettings();
  // Follow Mac's swatch is the Mac's own colour, where there is a Mac to ask.
  const macAccent = useSystemAccent();
  const swatches = useRef<(HTMLButtonElement | null)[]>([]);
  const at = Math.max(
    0,
    ACCENTS.findIndex((a) => a.id === accent),
  );
  const picked = ACCENTS[at];

  /* A radio group is ONE Tab stop with arrows inside it (docs/engineering/design-system.md#UI-D100
     docs/app/preferences-and-help/accessibility.md#UI-D108) — the swatches used to be five Tab stops that arrows did
     nothing in. As in every native radio group, an arrow moves AND chooses:
     trying an accent is the point of the control, and it is undone the same
     way. */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = ACCENTS.length;
    const step: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    let to: number;
    if (e.key in step) to = (at + step[e.key] + n) % n;
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = n - 1;
    else return;
    e.preventDefault();
    updateSettings({ accent: ACCENTS[to].id });
    swatches.current[to]?.focus();
  };

  return (
    <SectionBody title="Appearance">
      {/* The pages are left out on purpose: page zoom and print geometry are
          their own (docs/app/preferences-and-help/accessibility.md#UI-D108), so the note says where to go. */}
      <Group label="Text">
        <label className="settings__row">
          <span className="settings__rowlabel">Text size</span>
          <select className="field" aria-label="Text size" aria-describedby="interface-text-note"
            value={interfaceTextSize} onChange={(e) => updateSettings({ interfaceTextSize: Number(e.target.value) })}>
            {[100, 125, 150, 175, 200, ...([100, 125, 150, 175, 200].includes(interfaceTextSize) ? [] : [interfaceTextSize])]
              .sort((a, b) => a - b).map((size) => <option key={size} value={size}>{size}%</option>)}
          </select>
        </label>
        <Note id="interface-text-note">
          Applies to menus, panels and buttons. The pages you write on keep their size; to enlarge
          them, choose View › Zoom In.
        </Note>
      </Group>
      <Group label="Accent color">
        <div
          className="settings__swatches"
          role="radiogroup"
          aria-label="Accent color"
          aria-describedby="accent-note"
          onKeyDown={onKeyDown}
        >
          {ACCENTS.map((a, i) => {
            const on = a.id === accent;
            return (
              <button
                key={a.id}
                ref={(el) => {
                  swatches.current[i] = el;
                }}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={a.name}
                title={a.name}
                tabIndex={on ? 0 : -1}
                className={`accentswatch${on ? " is-on" : ""}`}
                style={{ background: a.id === "system" ? (macAccent ?? a.swatch) : a.swatch }}
                onClick={() => updateSettings({ accent: a.id })}
              >
                {on ? <CheckIcon size={12} /> : null}
              </button>
            );
          })}
        </div>
        <div className="settings__accentname">
          {picked.name}
          {picked.id === "gilt" && <Chip tiny>Default</Chip>}
        </div>
        <Note id="accent-note">
          Used for selections, switches, links and the text cursor.
          {picked.id === "system" &&
            " Follow Mac uses the accent color from your Mac’s Appearance settings, adjusted where needed so text stays readable."}
        </Note>
      </Group>

      <Group label="Light and dark">
        <div className="settings__row">
          <span className="settings__rowlabel">Appearance</span>
          <PopupButton label="Appearance" value={appearance} options={[
            { value: "system", label: "Follow Mac" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" },
          ]} onChange={(appearance) => updateSettings({ appearance })} />
        </div>
        <Note>The pages you write on stay light when the rest of the app is dark.</Note>
      </Group>
    </SectionBody>
  );
}
