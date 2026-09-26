// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/*
 * Light or dark, before the first frame (index.html loads this, blocking, in
 * <head>).
 *
 * The dark tokens are switched on by `data-theme="dark"` on the document
 * element, which main.tsx sets (ui/use-accent.ts, applyAppearance). But
 * main.tsx is a module, and modules run after the page's first paint, so on a
 * Mac in Dark mode every launch painted a frame in the LIGHT colours first.
 * This runs before anything is drawn. It is applyAppearance's decision, read
 * from the same settings mirror, and boot-theme.test.ts holds the two in step.
 * A plain script, not a module, because only a plain script blocks the parser;
 * and a file, not inline, because the app's policy refuses inline scripts.
 */
(function () {
  var appearance = "system";
  try {
    var stored = JSON.parse(localStorage.getItem("proscenium:settings") || "null");
    if (stored && (stored.appearance === "light" || stored.appearance === "dark")) appearance = stored.appearance;
  } catch (e) {
    /* no mirror yet, or a torn one: follow the Mac, as settings do */
  }
  var dark = appearance === "dark" || (appearance === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  var root = document.documentElement;
  root.setAttribute("data-appearance", appearance);
  root.setAttribute("data-theme", dark ? "dark" : "light");
  root.style.colorScheme = dark ? "dark" : "light";
})();
