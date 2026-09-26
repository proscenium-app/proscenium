// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";

import { hasManagedSection, renderAppearances, writeManagedSection } from "./managed";
import { inferType } from "./infer";
import {
  MANAGED_MARK,
  defaultDirFor,
  normalizeType,
  renderTemplate,
  schemaFor,
  SCHEMAS,
} from "./schema";

describe("material templates", () => {
  it("gives a character sheet its sections, blank, as the prompt to fill", () => {
    const out = renderTemplate({
      type: "character", template: "prompts",
      id: "01ABC",
      title: "CHARLIE",
      created: "2026-08-06T00:00:00.000Z",
    });
    expect(out).toContain("id: 01ABC");
    expect(out).toContain("type: character");
    // No `title:` and no `# CHARLIE`: the filename is the title, and a copy of
    // it inside the file is a second name waiting to disagree.
    expect(out).not.toContain("title:");
    expect(out).not.toContain("# CHARLIE");
    for (const h of ["Want", "Obstacle", "Voice", "Backstory", "Relationships", "Notes"]) {
      expect(out).toContain(`## ${h}`);
    }
    expect(out).toContain("age:"); // declared but empty — a visible invitation
  });

  it("marks the managed section in the file itself", () => {
    const out = renderTemplate({ type: "character", template: "prompts", id: "1", title: "X", created: "t" });
    expect(out).toContain("## Appearances");
    expect(out).toContain(MANAGED_MARK);
  });

  it("makes a document a genuinely empty file — no front matter, no heading", () => {
    // "Everything else is a blank .md blob." A template that wrote a heading or
    // a `title:` would put the filename in the file a second time, and the
    // writer's first keystroke would not be the first byte.
    expect(renderTemplate({ type: "document", id: "1", title: "X", created: "t" })).toBe("");
  });

  it("keeps the outline's identity marker, and nothing else", () => {
    // The scratchpad is app-owned, not something a writer picks from a menu,
    // and `type: outline` is how the app re-finds it when a binder entry is
    // lost to a resync. Without the marker it would create a SECOND one.
    const out = renderTemplate({ type: "outline", id: "1", title: "X", created: "t" });
    expect(out).toContain("type: outline");
    expect(out).not.toContain("##");
    expect(out).not.toContain("# X");
    expect(out).not.toContain("title:");
  });

  it("reads the retired type names as documents", () => {
    // Plenty of files on disk say `type: research`. They are not wrong; the
    // taxonomy was. Nothing writes these any more and everything reads them.
    for (const legacy of ["note", "research", "logline"] as const) {
      expect(normalizeType(legacy)).toBe("document");
      expect(renderTemplate({ type: legacy, id: "1", title: "X", created: "t" })).toBe("");
    }
    expect(normalizeType("outline")).toBe("outline");
    expect(normalizeType("character")).toBe("character");
    expect(normalizeType(undefined)).toBe("document");
  });

  it("routes each kind to its conventional folder", () => {
    // Capitalized: a folder's name is what Finder shows and what the binder
    // shows, and since 1.0 those are the same string (docs/app/keeping-work/storage-and-file-format.md#STOR-D4).
    expect(defaultDirFor("character")).toBe("Characters");
    expect(defaultDirFor("document")).toBe("Notes");
    expect(defaultDirFor("outline")).toBe("Notes");
    // A retired name still has to land somewhere sensible.
    expect(defaultDirFor("research")).toBe("Notes");
  });

  it("every schema is documentable — purpose and hints are non-empty", () => {
    // The guide publishes these verbatim; a blank hint would ship as a blank
    // line telling the writer nothing.
    for (const s of SCHEMAS) {
      expect(s.purpose.length).toBeGreaterThan(10);
      for (const f of s.frontMatter) expect(f.hint.length).toBeGreaterThan(5);
      for (const sec of s.sections) expect(sec.hint.length).toBeGreaterThan(5);
    }
  });

  it("only the character sheet declares a managed section", () => {
    const managed = SCHEMAS.flatMap((s) => s.sections.filter((x) => x.managed).map(() => s.type));
    expect(managed).toEqual(["character"]);
    expect(schemaFor("character")?.sections.some((s) => s.managed === "appearances")).toBe(true);
  });
});

describe("managed sections", () => {
  const sheet = [
    "---",
    "id: 1",
    "---",
    "",
    "# CHARLIE",
    "",
    "## Want",
    "To be believed.",
    "",
    "## Appearances",
    MANAGED_MARK,
    "- ACT ONE · Scene 1",
    "",
    "## Notes",
    "Hand-written, must survive.",
    "",
  ].join("\n");

  it("replaces only the managed body, leaving every other byte", () => {
    const out = writeManagedSection(
      sheet,
      "Appearances",
      renderAppearances([
        { ordinal: 0, label: "ACT ONE · Scene 1" },
        { ordinal: 2, label: "ACT TWO · Scene 3" },
      ]),
    );
    expect(out).toContain("- ACT TWO · Scene 3");
    expect(out).toContain("To be believed.");
    expect(out).toContain("Hand-written, must survive.");
    expect(out).toContain("# CHARLIE");
    expect(out).toContain("id: 1");
  });

  it("is idempotent — writing the same list twice is byte-stable", () => {
    const body = renderAppearances([{ ordinal: 0, label: "ACT ONE · Scene 1" }]);
    const once = writeManagedSection(sheet, "Appearances", body);
    expect(writeManagedSection(once, "Appearances", body)).toBe(once);
  });

  it("says so rather than going blank when nobody speaks yet", () => {
    const out = writeManagedSection(sheet, "Appearances", renderAppearances([]));
    expect(out).toContain("Does not speak in the script yet.");
    expect(out).toContain("## Notes");
  });

  it("does nothing when the writer has deleted the section", () => {
    // Deleting it is a statement. Re-adding it would be the app arguing back.
    const without = sheet.replace(/## Appearances[\s\S]*?(?=## Notes)/, "");
    expect(hasManagedSection(without, "Appearances")).toBe(false);
    expect(writeManagedSection(without, "Appearances", "x")).toBe(without);
  });

  it("handles a managed section that is last in the file", () => {
    const tail = "# X\n\n## Appearances\n" + MANAGED_MARK + "\n- old\n";
    const out = writeManagedSection(tail, "Appearances", renderAppearances([{ ordinal: 0, label: "new" }]));
    expect(out).toContain("- new");
    expect(out).not.toContain("- old");
  });
});

describe("inferType", () => {
  it("believes the file's own front-matter first", () => {
    expect(inferType("misc/whatever.md", "---\ntype: character\n---\n")).toBe("character");
  });

  it("falls back to the conventional directory, nested or not", () => {
    // Case-insensitively: a play made before 1.0 has `characters/`, one made
    // after has `Characters/`, and both are the writer's folder either way.
    expect(inferType("Characters/Sophie.md")).toBe("character");
    expect(inferType("characters/sophie.md")).toBe("character");
    expect(inferType("Notes/characters/sophie.md")).toBe("character");
    // research/ and loglines/ are ordinary folders now — the files in them are
    // documents, which is what they always were.
    expect(inferType("research/tides.md")).toBe("document");
    expect(inferType("loglines/one.md")).toBe("document");
  });

  it("still believes a file that calls itself the outline", () => {
    // The Outline surface finds its scratchpad by this marker after a resync,
    // so it is the one type a file may claim for itself and be believed.
    expect(inferType("notes/outline.md", "---\ntype: outline\n---\n")).toBe("outline");
  });

  it("never infers the outline singleton from a directory", () => {
    // notes/ is the outline's home too; inferring it would make every note
    // claim to be the play's one scratchpad.
    expect(inferType("notes/anything.md")).toBe("document");
  });

  it("bottoms out safely by extension", () => {
    expect(inferType("stray.md")).toBe("document");
    expect(inferType("draft.fountain")).toBe("script");
    expect(inferType("tide-tables.pdf")).toBe("reference");
  });

  it("types a non-Markdown file as a reference even inside a typed folder", () => {
    // research/ is the research folder, but a PDF typed `research` would be
    // handed to the prose editor. References pass through and open externally.
    expect(inferType("research/tide-tables.pdf")).toBe("reference");
    expect(inferType("characters/headshot.png")).toBe("reference");
  });

  it("a .fountain is a script wherever it sits", () => {
    expect(inferType("materials/parked-childhood-bedroom.fountain")).toBe("script");
  });

  it("ignores a front-matter type it does not know", () => {
    expect(inferType("notes/x.md", "---\ntype: nonsense\n---\n")).toBe("document");
  });

  it("resolves a retired front-matter type rather than trusting it", () => {
    expect(inferType("misc/x.md", "---\ntype: research\n---\n")).toBe("document");
    expect(inferType("misc/x.md", "---\ntype: logline\n---\n")).toBe("document");
  });
});

it("starts character notes blank unless prompts were requested", () => {
  const out = renderTemplate({ type: "character", id: "new", title: "Mara", created: "now" });
  expect(out).toContain("type: character");
  expect(out).not.toContain("## Want");
  expect(out).not.toContain(MANAGED_MARK);
});
