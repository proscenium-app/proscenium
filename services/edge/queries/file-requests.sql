-- SPDX-FileCopyrightText: 2026 Habiby LLC
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Bind ?1=start UTC day inclusive, ?2=end UTC day exclusive.
-- Every release file served, by what it was (docs/engineering/services-and-feedback.md#SERV-286):
-- `website` and `homebrew` are downloads, `update` an installed copy updating,
-- `signature` a signature file, `own` the project's own machines. `download` is
-- every file before that, which could not tell them apart.
SELECT day, kind, platform, arch, version, SUM(count) AS requests
FROM update_counts
WHERE kind <> 'check' AND day >= ?1 AND day < ?2
GROUP BY day, kind, platform, arch, version
ORDER BY day, kind, platform, arch, version;
