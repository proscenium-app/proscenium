-- SPDX-FileCopyrightText: 2026 Habiby LLC
-- SPDX-License-Identifier: AGPL-3.0-or-later
CREATE TABLE usage_counts (
  day TEXT NOT NULL, version TEXT NOT NULL, platform TEXT NOT NULL,
  arch TEXT NOT NULL, os TEXT NOT NULL, channel TEXT NOT NULL,
  event TEXT NOT NULL, props TEXT NOT NULL, count INTEGER NOT NULL,
  PRIMARY KEY (day, version, platform, arch, os, channel, event, props)
) WITHOUT ROWID;
