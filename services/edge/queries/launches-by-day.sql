-- SPDX-FileCopyrightText: 2026 Habiby LLC
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Bind ?1=start UTC day inclusive, ?2=end UTC day exclusive.
-- Each day's launches by version, track, system, channel, chip and the
-- system's version: which releases and systems the app is opened on, day by
-- day (docs/engineering/services-and-feedback.md#CHECKS-D105). Launches, never
-- people or copies. The system is the batch's own (`darwin`, `windows`, `ios`),
-- never read from the channel: a Mac's and an iPad's both say `app-store`. An
-- alpha build sends no usage counts the service takes, so alphas never appear
-- here; a Mac's or a PC's copies are seen through update checks alone, and an
-- iPad's, which never checks, not at all.
SELECT day, version, track, platform, channel, arch, os, SUM(count) AS launches
FROM usage_counts
WHERE event = 'app_launched' AND day >= ?1 AND day < ?2
GROUP BY day, version, track, platform, channel, arch, os
ORDER BY day, version DESC, platform, channel, os, arch;
