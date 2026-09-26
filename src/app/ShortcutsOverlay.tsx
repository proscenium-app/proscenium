// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ⌘/ — the keyboard, on screen (docs/app/preferences-and-help/settings.md#SET-11).
 *
 * Hold-⌘ on the element bar already teaches eleven keys; the other thirty had
 * no surface at all. Generated from `keymap.ts`, which is also what App binds
 * from, so this cannot advertise a key that does not work.
 */
import { GROUPS, LEADER_ROWS, SHORTCUTS } from "./keymap";
import { Button, Sheet } from "../ui";

export function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  return (
    <Sheet
      title="Keyboard Shortcuts"
      width={760}
      floating
      onClose={onClose}
      footer={
        <>
          <span className="sheet__spacer" />
          <Button treatment="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <ShortcutList />
    </Sheet>
  );
}

export function ShortcutList() {
  return (
      <div className="keysheet">
        {GROUPS.map((g) => (
          <section key={g} className="keysheet__group">
            <h3 className="seclabel">{g}</h3>
            <dl className="keysheet__list">
              {SHORTCUTS.filter((s) => s.group === g).map((s) => (
                <div key={s.keys} className="keysheet__row">
                  <dt className="keysheet__keys">{s.keys}</dt>
                  <dd className="keysheet__what">{s.what}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <section className="keysheet__group">
          <h3 className="seclabel">Element menu: ; then a key</h3>
          <div className="keysheet__leader">
            {LEADER_ROWS.map((r) => (
              <span key={r.key} className="keysheet__leaderrow">
                <kbd className="keybadge">{r.key}</kbd>
                {r.label}
              </span>
            ))}
          </div>
        </section>
      </div>
  );
}
