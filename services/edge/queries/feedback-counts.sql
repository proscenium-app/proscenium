-- SPDX-FileCopyrightText: 2026 Habiby LLC
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Bind ?1=start UTC day inclusive, ?2=end UTC day exclusive.
SELECT received_day AS day, COUNT(*) AS messages
FROM feedback_messages WHERE received_day >= ?1 AND received_day < ?2
GROUP BY received_day ORDER BY received_day;
