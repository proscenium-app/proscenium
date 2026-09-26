-- SPDX-FileCopyrightText: 2026 Habiby LLC
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Bind ?1=start UTC day inclusive, ?2=end UTC day exclusive.
-- The denominator uses the same channel. This is actions per 100 launches,
-- not a percentage of people. NULL means no launch denominator was received.
WITH period AS (
  SELECT channel, event, props, SUM(count) AS actions
  FROM usage_counts WHERE day >= ?1 AND day < ?2
  GROUP BY channel, event, props
), launches AS (
  SELECT channel, SUM(actions) AS launches FROM period
  WHERE event = 'app_launched' GROUP BY channel
)
SELECT p.channel, p.event, p.props, p.actions, COALESCE(l.launches, 0) AS launches,
       ROUND(100.0 * p.actions / NULLIF(l.launches, 0), 2) AS actions_per_100_launches
FROM period p LEFT JOIN launches l ON l.channel = p.channel
ORDER BY p.channel, p.event, p.props;
