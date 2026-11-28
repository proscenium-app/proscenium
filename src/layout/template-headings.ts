// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The heading each template gives the page it starts
 * (src/layout/scaffolds.ts writes them; scaffolds.test.ts holds this list to
 * what the templates write). They are kept apart from the templates because
 * the layout reads them too: a page that holds a template's headings and
 * nothing else is a page not yet written, and prints nothing
 * (docs/app/formatting/formats-and-layout.md#FMT-183). A heading a writer
 * gave a page is words of theirs, and prints.
 */
export const TEMPLATE_HEADINGS: readonly string[] = [
  "CONTENTS",
  "CHARACTERS",
  "SETTING",
  "A NOTE ON THE TEXT",
  "MUSICAL NUMBERS",
  "PRODUCTION NOTES",
  "PRODUCTION HISTORY",
  "AUTHOR'S NOTE",
  "ABOUT THE AUTHOR",
  "ACKNOWLEDGMENTS",
  "GLOSSARY",
];

const known = new Set(TEMPLATE_HEADINGS);

/** Whether a heading's words are ones a template wrote, in any case. */
export function isTemplateHeading(text: string): boolean {
  return known.has(text.trim().toUpperCase());
}
