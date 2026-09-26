-- SPDX-FileCopyrightText: 2026 Habiby LLC
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Bind ?1=start UTC day inclusive, ?2=end UTC day exclusive.
-- Proof that messages arrived, without their words or addresses: safe to show.
SELECT received_day AS day, id, length(message) AS characters,
       email IS NOT NULL AS with_email, details IS NOT NULL AS with_details
FROM feedback_messages WHERE received_day >= ?1 AND received_day < ?2
ORDER BY received_day, id;
