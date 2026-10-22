-- SPDX-FileCopyrightText: 2026 Habiby LLC
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Bind ?1=start UTC day inclusive, ?2=end UTC day exclusive.
-- Launches per version, track and channel: how many of the day's launches were
-- the newest release, how many an older one, and how many a published beta's,
-- counted apart (docs/engineering/services-and-feedback.md#SERV-272). An alpha
-- build sends no usage counts the service takes, so alphas never appear here;
-- their copies are seen through update checks alone.
SELECT version, track, channel, SUM(count) AS launches
FROM usage_counts
WHERE event = 'app_launched' AND day >= ?1 AND day < ?2
GROUP BY version, track, channel
ORDER BY version DESC, channel;
