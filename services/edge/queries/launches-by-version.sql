-- SPDX-FileCopyrightText: 2026 Habiby LLC
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Bind ?1=start UTC day inclusive, ?2=end UTC day exclusive.
-- Launches per version and channel: how many of the day's launches were the
-- newest release, and how many an older one. Only a released version's copies
-- send usage counts (reports.ts admits no track build), so alpha and beta
-- builds never appear here; their copies are seen through update checks alone.
SELECT version, channel, SUM(count) AS launches
FROM usage_counts
WHERE event = 'app_launched' AND day >= ?1 AND day < ?2
GROUP BY version, channel
ORDER BY version DESC, channel;
