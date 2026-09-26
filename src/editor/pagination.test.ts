// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";

/**
 * The re-printed "(CONT'D)" cue is a chrome widget carrying `pl-character`, so
 * it inherits the format's character column from the generated CSS. The chrome
 * only needs to drop the cue's VERTICAL spacing so it welds to the text that
 * follows — a blanket `margin: 0` also wiped `margin-left`, which in dg-modern
 * is the indent that makes a cue read as centred, sending every continued cue
 * to the left margin. There is no DOM in these tests, so guard the rule.
 */
describe("continued-cue chrome keeps the character column", () => {
  const css = Bun.file(new URL("./stage-format.css", import.meta.url)).text();

  it("zeroes only the vertical margins", async () => {
    const rule = (await css).match(/\.pgchrome__contd\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    const body = rule![1];
    expect(body).toMatch(/margin-top:\s*0\s*!important/);
    expect(body).toMatch(/margin-bottom:\s*0\s*!important/);
    // The shorthand would take margin-left with it.
    expect(body).not.toMatch(/(^|[;{\s])margin\s*:/);
    expect(body).not.toMatch(/margin-left\s*:/);
  });
});

/**
 * The engine lays both halves of a dual pair from the SAME base row
 * (`placeDual`), so the editor has to as well or the surface and the PDF
 * disagree about a pair. Floating both halves cannot do it: CSS 2.1 section 9.5.1
 * rule 5 forbids a float's outer top from rising above the outer top of any box
 * generated earlier in the source, and the right cue comes after the whole left
 * chain — so the right column landed below the left one and the pair read as two
 * sequential indented columns. The left half floats and the right half stays in
 * normal flow, held clear by a left margin. No DOM here, so guard the rule.
 */
describe("dual-dialogue halves are laid out to top-align", () => {
  const css = Bun.file(new URL("./stage-format.css", import.meta.url)).text();
  const rule = async (sel: string) => {
    const m = (await css).match(new RegExp(`\\.play-page \\.${sel}\\s*\\{([^}]*)\\}`));
    expect(m).not.toBeNull();
    return m![1];
  };

  it("floats the left half and stacks it down the left", async () => {
    const body = await rule("pm-dual--left");
    expect(body).toMatch(/float:\s*left/);
    expect(body).toMatch(/clear:\s*left/);
  });

  it("keeps the right half in normal flow, clear of the float", async () => {
    const body = await rule("pm-dual--right");
    // The bug: any float here is pushed below the left chain's last block.
    expect(body).not.toMatch(/float\s*:\s*(left|right)/);
    expect(body).toMatch(/margin-left:\s*52%/);
  });

  it("does not blanket-reset margin-left on both halves", async () => {
    // A shared `margin-left: 0 !important` would beat the right half's 52%.
    const body = await rule("pm-dual");
    expect(body).not.toMatch(/margin-left\s*:/);
    expect(body).toMatch(/width:\s*48%/);
  });

  it("clears both columns after the pair, on a widget that owns no gap", async () => {
    // The clear rides a zero-height widget BETWEEN the pair and the next block
    // (pagination.ts dualClearWidget). Clearance swallows the cleared element's
    // own margin-top, so putting `clear` on the next block cost it the format's
    // spacingBefore whenever the LEFT column was the taller one.
    const body = await rule("pm-dual-clear");
    expect(body).toMatch(/clear:\s*both/);
    expect(body).toMatch(/height:\s*0/);
    // If the widget carried a margin it would double the gap the next block brings.
    expect(body).not.toMatch(/margin/);
  });
});
