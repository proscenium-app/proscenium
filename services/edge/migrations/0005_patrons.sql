-- SPDX-FileCopyrightText: 2026 Habiby LLC
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- The program (docs/engineering/services-and-feedback.md#SERV-D105): one row a
-- sponsor, keyed by a digest of their GitHub login. A private sponsor's name is
-- never stored (NULL), so the roll can only count them. A monthly sponsor's row
-- goes when GitHub reports the cancellation; a one-time gift's after a year.
CREATE TABLE patrons (
  sponsor TEXT PRIMARY KEY,
  name TEXT,
  monthly_dollars INTEGER NOT NULL,
  one_time INTEGER NOT NULL CHECK (one_time IN (0, 1)),
  since TEXT NOT NULL
) STRICT;
