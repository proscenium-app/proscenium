-- SPDX-FileCopyrightText: 2026 Habiby LLC
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Bind ?1=start UTC day inclusive, ?2=end UTC day exclusive.
-- Counts requests for DMG, archive and signature; not unique installations.
SELECT day, version, SUM(count) AS download_requests
FROM update_counts
WHERE kind = 'download' AND day >= ?1 AND day < ?2
GROUP BY day, version ORDER BY day, version;
