-- SPDX-FileCopyrightText: 2026 Habiby LLC
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- A request for a release's file is counted by what it was
-- (docs/engineering/services-and-feedback.md#SERV-286): a download by where it
-- came from, `website` or `homebrew`; `update` from an installed copy;
-- `signature` for a signature file; `own` from the project's own machines.
-- Each counts the system and chip it is for. SQLite cannot change a CHECK in
-- place, so the table is built again with every row kept. Rows before this one
-- counted a file of any kind as `download`, with no system or chip, and stay
-- as they were: `download` is written no more.
CREATE TABLE update_counts_new (
  day TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (
    kind IN ('check', 'download', 'website', 'homebrew', 'update', 'signature', 'own')
  ),
  platform TEXT NOT NULL,
  arch TEXT NOT NULL,
  version TEXT NOT NULL,
  os TEXT NOT NULL,
  count INTEGER NOT NULL CHECK (count > 0),
  PRIMARY KEY (day, kind, platform, arch, version, os)
) WITHOUT ROWID;
INSERT INTO update_counts_new (day, kind, platform, arch, version, os, count)
  SELECT day, kind, platform, arch, version, os, count FROM update_counts;
DROP TABLE update_counts;
ALTER TABLE update_counts_new RENAME TO update_counts;
