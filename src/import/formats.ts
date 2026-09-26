// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

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
export const IMPORT_ACCEPT = [...DIRECT_EXTENSIONS, ...GUIDED_EXTENSIONS]
  .map((x) => `.${x}`)
  .join(",");
export const extension = (name: string) => name.slice(name.lastIndexOf(".") + 1).toLowerCase();
/** A `.pages` document, or a package-form one zipped whole: the web view hands
 * a package over as `Name.pages.zip`, and Finder's Compress names it the same. */
export const isPagesName = (name: string) => /\.pages(?:\.zip)?$/i.test(name);
export const isImportFile = (name: string) =>
  [...DIRECT_EXTENSIONS, ...GUIDED_EXTENSIONS].includes(extension(name));
export const SOURCE_GUIDES = [
  {
    name: "Word",
    file: ".docx",
    text: "Save a copy as Word Document (.docx). Older .doc files need Save As first.",
  },
  {
    name: "Pages",
    file: ".pages",
    text: "Choose your .pages document. Its paragraph styles, emphasis, tables and text boxes carry across, and it stays as it is. If it has a password or tracked changes, choose File › Export To › Word in Pages and bring the .docx here.",
  },
  {
    name: "Google Docs",
    file: "Download as Word",
    text: "Choose File › Download › Microsoft Word (.docx). A .gdoc file is only a link to the online document.",
  },
  {
    name: "Final Draft",
    file: ".fdx",
    text: "Choose your .fdx script. Its named elements carry across without guessing.",
  },
  {
    name: "WriterDuet / WriterSolo",
    file: "Export as Final Draft",
    text: "Choose File › Export › Final Draft (.fdx), or Fountain. Include the documents you want, in script order. A .wdz project needs this export first.",
  },
  {
    name: "Scrivener",
    file: "Compile or export",
    text: "Use File › Compile for the whole draft, in Binder order. Choose Final Draft or Fountain for a script, or Word (.docx) or RTF for other drafts. To bring one document, use File › Export › Files. A .scriv project needs this export first.",
  },
];
export function guidance(name: string): string | null {
  if (isPagesName(name)) return null;
  switch (extension(name)) {
    case "gdoc":
      return SOURCE_GUIDES[2].text;
    case "doc":
      return SOURCE_GUIDES[0].text;
    case "scriv":
    case "scrivx":
      return SOURCE_GUIDES[5].text;
    case "wdz":
    case "wdx":
      return SOURCE_GUIDES[4].text;
    case "pdf":
      return "This is a reading copy. For editable script elements, export Word (.docx), Final Draft (.fdx), RTF or Fountain from the app that made it. PDF extraction and scanned pages are not supported yet.";
    case "zip":
      return "Unzip this archive first. For a Scrivener project, use File › Compile in Scrivener and choose Word, RTF, Final Draft or Fountain.";
    default:
      return null;
  }
}
