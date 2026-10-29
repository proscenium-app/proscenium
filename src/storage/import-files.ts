// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The files the import tool takes, by extension (docs/app/importing/document-import.md#IMPT-16):
 * those it reads directly, and those it takes to say how to export them first.
 * They live below the workspace, whose Finder router sends a file that passes
 * `isImportFile` to the import review (docs/app/importing/document-import.md#IMPT-35).
 */
export const DIRECT_EXTENSIONS = [
  "docx",
  "pages",
  "odt",
  "rtf",
  "txt",
  "md",
  "fountain",
  "spmd",
  "fdx",
];
export const GUIDED_EXTENSIONS = ["doc", "gdoc", "scriv", "scrivx", "wdz", "wdx", "pdf", "zip"];
export const extension = (name: string) => name.slice(name.lastIndexOf(".") + 1).toLowerCase();
export const isImportFile = (name: string) =>
  [...DIRECT_EXTENSIONS, ...GUIDED_EXTENSIONS].includes(extension(name));
