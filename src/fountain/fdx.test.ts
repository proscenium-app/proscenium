// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { fdxToFountain, scriptFromFile } from "./fdx";

const FDX = `<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script" Template="No" Version="1">
  <Content>
    <Paragraph Type="Act"><Text>ACT ONE</Text></Paragraph>
    <Paragraph Type="Scene Heading"><Text>Kitchen, the same morning</Text></Paragraph>
    <Paragraph Type="Action"><Text>Weak light. A kettle that has </Text><Text Style="Italic">already</Text><Text> boiled twice.</Text></Paragraph>
    <Paragraph Type="Character"><Text>marguerite</Text></Paragraph>
    <Paragraph Type="Parenthetical"><Text>not looking up</Text></Paragraph>
    <Paragraph Type="Dialogue"><Text>Then unlock it.</Text></Paragraph>
    <Paragraph Type="Transition"><Text>BLACKOUT.</Text></Paragraph>
    <Paragraph Type="Fizzbuzz"><Text>Something no table knows.</Text></Paragraph>
  </Content>
  <TitlePage>
    <Content><Paragraph Type="General"><Text>The Weight of Water</Text></Paragraph></Content>
  </TitlePage>
</FinalDraft>`;

describe("fdxToFountain", () => {
  const out = fdxToFountain(FDX)!;

  it("reads the title page", () => {
    expect(out.title).toBe("The Weight of Water");
  });

  it("maps every element it knows onto Fountain's own marks", () => {
    expect(out.fountain).toContain("# ACT ONE");
    expect(out.fountain).toContain("## Kitchen, the same morning");
    expect(out.fountain).toContain("MARGUERITE");
    expect(out.fountain).toContain("(not looking up)");
    expect(out.fountain).toContain("> BLACKOUT.");
  });

  it("joins a paragraph's styled runs back into one line", () => {
    expect(out.fountain).toContain("Weak light. A kettle that has already boiled twice.");
  });

  it("keeps a cue welded to its speech, with a blank line before the cue", () => {
    const lines = out.fountain.split("\n");
    const cue = lines.indexOf("MARGUERITE");
    expect(lines[cue - 1]).toBe("");
    expect(lines[cue + 1]).toBe("(not looking up)");
    expect(lines[cue + 2]).toBe("Then unlock it.");
  });

  it("never drops a line it does not understand — it reports the type", () => {
    expect(out.fountain).toContain("Something no table knows.");
    expect(out.unknownTypes).toEqual(["Fizzbuzz"]);
  });

  it("refuses bytes that are not an FDX rather than writing rubbish into a play", () => {
    expect(fdxToFountain("just some text")).toBeNull();
    expect(fdxToFountain("<html><body>no</body></html>")).toBeNull();
  });
});

it("scans quoted tags, comments, CDATA and entity text without treating them as structure", () => {
  const converted = fdxToFountain(`<FinalDraft><!-- <Paragraph> -->
    <TitlePage><Content><Paragraph Type='General'><Text>A title</Text></Paragraph></Content></TitlePage>
    <Content><Paragraph Type="Action" Extra="a > b"><Text>One &amp; </Text><Text><![CDATA[<two>]]></Text><Text> &#x1f642; &#999999999; &amp;lt;</Text></Paragraph><Paragraph Type="General" /></Content></FinalDraft>`)!;
  expect(converted.title).toBe("A title");
  expect(converted.fountain).toContain("One & <two> 🙂 &#999999999; &lt;");
});

it("docs/app/keeping-work/storage-and-file-format.md#STOR-33: refuses incomplete, deeply nested and excessive-node FDX before creating a partial script", () => {
  const para = '<Paragraph Type="Action"><Text>Keep all of me.</Text></Paragraph>';
  for (const xml of [
    `<FinalDraft><Content>${para}<Paragraph></Content></FinalDraft>`,
    `<FinalDraft><Content>${"<Unknown>".repeat(150)}${para}${"</Unknown>".repeat(150)}</Content></FinalDraft>`,
    `<FinalDraft><Content>${para.repeat(25_000)}</Content></FinalDraft>`,
  ]) expect(fdxToFountain(xml)).toBeNull();
});

describe("scriptFromFile", () => {
  it("passes Fountain straight through and reads its title", () => {
    const r = scriptFromFile("draft.fountain", "Title: The Jetty\n\n# ACT ONE\n")!;
    expect(r.title).toBe("The Jetty");
    expect(r.fountain).toContain("# ACT ONE");
  });

  it("declines a file it has no parser for", () => {
    expect(scriptFromFile("notes.pdf", "%PDF")).toBeNull();
  });
});

// A paragraph type that is a property of Object, not of the table (docs/app/importing/document-import.md#IMPT-64).
import { test as a108, expect as a108expect } from "bun:test";
a108("a __proto__ paragraph type is unknown, not a crash", () => {
  const out = fdxToFountain(
    '<FinalDraft><Content><Paragraph Type="__proto__"><Text>Hello</Text></Paragraph><Paragraph Type="constructor"><Text>There</Text></Paragraph></Content></FinalDraft>',
  );
  a108expect(out?.fountain).toContain("Hello");
  a108expect(out?.fountain).toContain("There");
});
