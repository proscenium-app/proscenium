-- SPDX-FileCopyrightText: 2026 Habiby LLC
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- A release's file asked for by a program, not a person, is counted as
-- `crawler` (docs/engineering/services-and-feedback.md#SERV-290), so the
-- website's downloads are people's. SQLite cannot change a CHECK in place, so
-- the table is built again with every row kept, as 0008 did. Rows before this
-- one counted such a fetch as `website`, and stay as they were.
CREATE TABLE update_counts_new (
  day TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (
    kind IN (
      'check', 'download', 'website', 'homebrew', 'update', 'signature', 'own', 'crawler'
    )
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
