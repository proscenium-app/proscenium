// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Settings › Appearance: interface text size, accent colour and light or dark. */
import { accentName, accentSettings, followSystem } from "../../ui/system-words";
import { useRef, type KeyboardEvent } from "react";
import { ACCENTS, CheckIcon, Chip, PopupButton } from "../../ui";
import { Group, Note, SectionBody } from "./parts";
import { updateSettings, useSettings } from "../../ui/settings-store";
import { useSystemAccent } from "./system-accent";

export function Appearance() {
  const { accent, interfaceTextSize, appearance } = useSettings();
  // Follow Mac's swatch is the Mac's own colour, where there is a Mac to ask.
  const macAccent = useSystemAccent();
  const swatches = useRef<(HTMLButtonElement | null)[]>([]);
  /* A system with no accent of its own (an iPad) is not offered one to
     follow, unless it is the accent chosen already, so the writer can leave
     it. Light and dark still follow it. */
  const followable = accentSettings();
  const accents = ACCENTS.filter((a) => a.id !== "system" || followable || a.id === accent);
  const at = Math.max(
    0,
    accents.findIndex((a) => a.id === accent),
  );
  const picked = accents[at];

  /* A radio group is ONE Tab stop with arrows inside it (docs/engineering/design-system.md#UI-D100
     docs/app/preferences-and-help/accessibility.md#UI-D108) — the swatches used to be five Tab stops that arrows did
     nothing in. As in every native radio group, an arrow moves AND chooses:
     trying an accent is the point of the control, and it is undone the same
     way. */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = accents.length;
    const step: Record<string, number> = {
      ArrowRight: 1,
      ArrowDown: 1,
      ArrowLeft: -1,
      ArrowUp: -1,
    };
    let to: number;
    if (e.key in step) to = (at + step[e.key] + n) % n;
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = n - 1;
    else return;
    e.preventDefault();
    updateSettings({ accent: accents[to].id });
    swatches.current[to]?.focus();
  };

  return (
    <SectionBody title="Appearance">
      {/* The pages are left out on purpose: page zoom and print geometry are
          their own (docs/app/preferences-and-help/accessibility.md#UI-D108), so the note says where to go. */}
      <Group label="Text">
        <label className="settings__row">
          <span className="settings__rowlabel">Text size</span>
          <select
            className="field"
            aria-label="Text size"
            aria-describedby="interface-text-note"
            value={interfaceTextSize}
            onChange={(e) => updateSettings({ interfaceTextSize: Number(e.target.value) })}
          >
            {[
              100,
              125,
              150,
              175,
              200,
              ...([100, 125, 150, 175, 200].includes(interfaceTextSize) ? [] : [interfaceTextSize]),
            ]
              .sort((a, b) => a - b)
              .map((size) => (
                <option key={size} value={size}>
                  {size}%
                </option>
              ))}
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
          {accents.map((a, i) => {
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
                aria-label={accentName(a)}
                title={accentName(a)}
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
          {accentName(picked)}
          {picked.id === "gilt" && <Chip tiny>Default</Chip>}
        </div>
        <Note id="accent-note">
          Used for selections, switches, links and the text cursor.
          {picked.id === "system" &&
            followable &&
            ` ${followSystem()} uses the accent color from ${followable}, adjusted where needed so text stays readable.`}
        </Note>
      </Group>

      <Group label="Light and dark">
        <div className="settings__row">
          <span className="settings__rowlabel">Appearance</span>
          <PopupButton
            label="Appearance"
            value={appearance}
            options={[
              { value: "system", label: followSystem() },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
            onChange={(appearance) => updateSettings({ appearance })}
          />
        </div>
        <Note>The pages you write on stay light when the rest of the app is dark.</Note>
      </Group>
    </SectionBody>
  );
}
