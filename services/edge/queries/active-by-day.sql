-- SPDX-FileCopyrightText: 2026 Habiby LLC
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Bind ?1=start UTC day inclusive, ?2=end UTC day exclusive.
-- Each day's active copies by version, track, platform, chip, system version,
-- channel, period and installed (docs/engineering/services-and-feedback.md#CHECKS-D105).
-- A copy sends one `copy_active` the first time it runs in a UTC day, an ISO
-- week (Monday to Sunday, UTC) and a calendar month, and drops one its period
-- has ended before it was sent, so each row is copies counted for the first
-- time in that period on that day
-- (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-86). Summing a period's
-- rows over the days it covers is that period's distinct active copies:
-- `day` over one day, `week` over Monday to Sunday, `month` over the month.
-- Sum across every other column for a total; each copy is in one row only,
-- under the version and system it ran when first counted in the period.
-- `installed` is how long ago the copy first ran, when it was counted: `new`
-- days 1 to 7, `recent` 8 to 30, `earlier` after. Releases and published betas
-- only (docs/engineering/services-and-feedback.md#SERV-272), and only copies
-- with usage reports switched on.
SELECT day, version, track, platform, arch, os, channel,
  json_extract(props, '$.period') AS period,
  json_extract(props, '$.installed') AS installed,
  SUM(count) AS copies
FROM usage_counts
WHERE event = 'copy_active' AND day >= ?1 AND day < ?2
GROUP BY day, version, track, platform, arch, os, channel, period, installed
ORDER BY day, period, installed, track DESC, version DESC, platform, channel, arch, os;
