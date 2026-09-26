-- SPDX-FileCopyrightText: 2026 Habiby LLC
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Bind ?1=start UTC day inclusive, ?2=end UTC day exclusive.
SELECT day, 'usage:' || event AS metric, SUM(count) AS total
FROM usage_counts WHERE day >= ?1 AND day < ?2 GROUP BY day, event
UNION ALL
SELECT day, 'update:' || kind AS metric, SUM(count) AS total
FROM update_counts WHERE day >= ?1 AND day < ?2 GROUP BY day, kind
UNION ALL
SELECT received_day AS day, 'feedback' AS metric, COUNT(*) AS total
FROM feedback_messages WHERE received_day >= ?1 AND received_day < ?2 GROUP BY received_day
ORDER BY day, metric;
