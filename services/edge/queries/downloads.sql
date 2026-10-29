-- SPDX-FileCopyrightText: 2026 Habiby LLC
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Bind ?1=start UTC day inclusive, ?2=end UTC day exclusive.
-- Downloads by people: from the website and Homebrew (docs/engineering/services-and-feedback.md#SERV-286).
-- Requests, not completed installations. Before that, every file was counted
-- as `download`, updates and signatures among them; those rows are included as
-- they were, and `file-requests.sql` tells them apart.
SELECT day, version, SUM(count) AS download_requests
FROM update_counts
WHERE kind IN ('download', 'website', 'homebrew') AND day >= ?1 AND day < ?2
GROUP BY day, version ORDER BY day, version;
