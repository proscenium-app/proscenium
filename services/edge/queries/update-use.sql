-- SPDX-FileCopyrightText: 2026 Habiby LLC
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Bind ?1=start UTC day inclusive, ?2=end UTC day exclusive (YYYY-MM-DD).
SELECT day, platform, arch, version, os, SUM(count) AS checks
FROM update_counts
WHERE kind = 'check' AND day >= ?1 AND day < ?2
GROUP BY day, platform, arch, version, os
ORDER BY day, version, os, arch;
