-- SPDX-FileCopyrightText: 2026 Habiby LLC
-- SPDX-License-Identifier: AGPL-3.0-or-later
CREATE TABLE update_counts (
  day TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('check', 'download')),
  platform TEXT NOT NULL,
  arch TEXT NOT NULL,
  version TEXT NOT NULL,
  os TEXT NOT NULL,
  count INTEGER NOT NULL CHECK (count > 0),
  PRIMARY KEY (day, kind, platform, arch, version, os)
) WITHOUT ROWID;
