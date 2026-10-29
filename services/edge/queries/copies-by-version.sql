-- SPDX-FileCopyrightText: 2026 Habiby LLC
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Bind ?1=start UTC day inclusive, ?2=end UTC day exclusive, ?3=a build's version.
-- Copies on the version, as near as the counts can say
-- (docs/engineering/services-and-feedback.md#SERV-280): the most update checks
-- it made on one of those days. A copy checks once a day and has no identifier,
-- and one opened twice in a day checks twice, so this is an estimate of copies,
-- never a count of people. NULL when the service counted no check at all those
-- days: the counts are missing, which says nothing of the copies.
SELECT CASE
  WHEN NOT EXISTS (
    SELECT 1 FROM update_counts WHERE kind = 'check' AND day >= ?1 AND day < ?2
  ) THEN NULL
  ELSE COALESCE((
    SELECT MAX(checks) FROM (
      SELECT SUM(count) AS checks FROM update_counts
      WHERE kind = 'check' AND version = ?3 AND day >= ?1 AND day < ?2
      GROUP BY day
    )
  ), 0)
END AS copies;
