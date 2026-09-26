-- SPDX-FileCopyrightText: 2026 Habiby LLC
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- The private daily pull by the maintainer's scheduled jobs into their copy of the list, and nothing else.
-- Never put this result in logs, a notification or a public summary.
-- Bind ?1=cursor day, ?2=cursor id, ?3=today (UTC). Start with empty cursors;
-- page until empty. Today is excluded, so each day is pulled once it is complete.
SELECT id, received_day, message, email, details
FROM feedback_messages
WHERE received_day < ?3
  AND (received_day > ?1 OR (received_day = ?1 AND id > ?2))
ORDER BY received_day, id LIMIT 100;
