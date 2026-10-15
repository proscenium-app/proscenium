// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from "bun:test";
import { datedChangelog, lineChangelog, lineVersion, unreleasedInto } from "./version.mjs";

const CHANGELOG = `# Changelog

## [Unreleased]

### Fixed

- A thing.

## [1.0.0] - 2026-09-26

- The first.
`;

test("a release on its line: Unreleased's entries become its undated section, under a fresh Unreleased", () => {
  const lined = lineChangelog(CHANGELOG, "1.0.1");
  expect(lined).toContain("## [Unreleased]\n\n## [1.0.1]\n\n### Fixed\n\n- A thing.");
  expect(lineVersion(lined, "1.0.1")).toBe("1.0.1");
  expect(lineVersion(CHANGELOG, "1.0.0")).toBeNull();
  expect(() => lineChangelog(lined, "1.0.1")).toThrow(/already has a 1.0.1 section/);
  // A heading that named the next release names nothing once it is on its line.
  expect(
    lineChangelog(CHANGELOG.replace("## [Unreleased]", "## [Unreleased] 1.0.1"), "1.0.1"),
  ).toContain("## [Unreleased]\n\n## [1.0.1]\n");
});

test("the release's one change on its line is its section's date", () => {
  const lined = lineChangelog(CHANGELOG, "1.0.1");
  const dated = datedChangelog(lined, "1.0.1", "2026-10-14");
  expect(dated).toContain("## [1.0.1] - 2026-10-14\n\n### Fixed");
  expect(dated.split("\n").filter((l, i) => l !== lined.split("\n")[i])).toEqual([
    "## [1.0.1] - 2026-10-14",
  ]);
  expect(lineVersion(dated, "1.0.1")).toBeNull();
  expect(() => datedChangelog(dated, "1.0.1", "2026-10-15")).toThrow(/no undated 1.0.1 section/);
  expect(() => datedChangelog(lined, "1.0.1", "14 October")).toThrow(/not YYYY-MM-DD/);
});

test("a fix carried to the line moves its entries from Unreleased into the line's section, by kind", () => {
  const lined = lineChangelog(CHANGELOG, "1.0.1");
  const picked = lined.replace(
    "## [Unreleased]\n",
    "## [Unreleased]\n\n### Fixed\n\n- The fix.\n\n### Added\n\n- A word.\n",
  );
  const carried = unreleasedInto(picked, "1.0.1");
  expect(carried).toContain(
    "## [Unreleased]\n\n## [1.0.1]\n\n### Fixed\n\n- A thing.\n- The fix.\n\n### Added\n\n- A word.\n\n## [1.0.0]",
  );
  // Nothing under Unreleased: nothing moves.
  expect(unreleasedInto(lined, "1.0.1")).toBe(lined);
});
