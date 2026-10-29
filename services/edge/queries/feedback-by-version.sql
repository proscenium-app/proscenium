-- SPDX-FileCopyrightText: 2026 Habiby LLC
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Bind ?1=start UTC day inclusive, ?2=end UTC day exclusive, ?3=a build's version.
-- The messages from copies on the version received those days, by id alone:
-- no words and no address (docs/engineering/services-and-feedback.md#SERV-280),
-- so the ones the maintainer has marked as no blocker can be set aside by id.
SELECT id FROM feedback_messages
WHERE version = ?3 AND received_day >= ?1 AND received_day < ?2
ORDER BY id;
