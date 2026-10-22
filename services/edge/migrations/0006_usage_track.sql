-- SPDX-FileCopyrightText: 2026 Habiby LLC
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- A published beta's usage counts are taken as a release's and counted apart
-- (docs/engineering/services-and-feedback.md#SERV-272): each row says the track
-- that released its version, which the Worker reads from the lists when it
-- admits the batch. Every row before this one is a release's.
ALTER TABLE usage_counts ADD COLUMN track TEXT NOT NULL DEFAULT 'stable' CHECK (track IN ('stable', 'beta'));
