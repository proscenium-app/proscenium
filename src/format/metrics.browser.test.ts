// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { builtinFormats } from "./registry";
import { formatToCss } from "./css";
import { charsPerLine } from "./metrics";
import { elementColumnIn } from "./spec";
import { paginateDoc } from "../layout";

test("docs/app/formatting/formats-and-layout.md#FMT-123: actual editor CSS and embedded fonts wrap at the engine's boundaries in every built-in", async () => {
  const css = readFileSync(new URL("../app/styles.css", import.meta.url), "utf8").replace(
    /url\("\.\.\/ui\/fonts\/([^"/]+)"\)/g,
    (_, file: string) => `url("data:font/woff2;base64,${readFileSync(new URL(`../ui/fonts/${file}`, import.meta.url)).toString("base64")}")`,
  ) + readFileSync(new URL("../editor/stage-format.css", import.meta.url), "utf8");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const spec of builtinFormats()) {
      for (const type of ["act", "scene", "character", "dialogue", "action"] as const) {
        const cpl = charsPerLine(spec, elementColumnIn(spec, type).widthIn, spec.elements[type].letterSpacing);
        const cases = ["W".repeat(cpl - 1), "W".repeat(cpl), "W".repeat(cpl + 1), "WORD ".repeat(12).trim()];
        for (const text of cases) {
          const layout = paginateDoc({ type: "doc", content: [{ type, content: [{ type: "text", text }] }] }, spec);
          const engineLines = layout.pages.flatMap((p) => p.lines).length;
          await page.setContent(`<style>${css}\n${formatToCss(spec)}</style><main class="editor-surface"><section class="play-page"><div class="tiptap"><p class="pl pl-${type}">${text}</p></div></section></main>`);
          await page.evaluate(() => document.fonts.ready);
          const measured = await page.locator(".pl").evaluate((p) => {
            const style = getComputedStyle(p);
            return { rows: Math.round(p.getBoundingClientRect().height / parseFloat(style.lineHeight)), width: p.clientWidth, spacing: style.letterSpacing };
          });
          expect({ format: spec.id, type, text, rows: measured.rows }).toEqual({ format: spec.id, type, text, rows: engineLines });
        }
      }
    }
  } finally { await browser.close(); }
}, 30000);
