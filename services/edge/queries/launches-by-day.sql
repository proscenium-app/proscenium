-- SPDX-FileCopyrightText: 2026 Habiby LLC
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Bind ?1=start UTC day inclusive, ?2=end UTC day exclusive.
-- Each day's launches by version, track, channel, chip and macOS: which
-- releases and systems the app is opened on, day by day
-- (docs/engineering/services-and-feedback.md#CHECKS-D105). Launches, never
-- people or copies. An alpha build sends no usage counts the service takes, so
-- alphas never appear here; their copies are seen through update checks alone.
SELECT day, version, track, channel, arch, os, SUM(count) AS launches
FROM usage_counts
WHERE event = 'app_launched' AND day >= ?1 AND day < ?2
GROUP BY day, version, track, channel, arch, os
ORDER BY day, version DESC, channel, os, arch;
