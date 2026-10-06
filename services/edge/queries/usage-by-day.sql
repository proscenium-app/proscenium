-- SPDX-FileCopyrightText: 2026 Habiby LLC
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Bind ?1=start UTC day inclusive, ?2=end UTC day exclusive.
-- Each day's count of every event and property value, by version and track:
-- what a chart of one feature over time is drawn from
-- (docs/engineering/services-and-feedback.md#CHECKS-D105). These are actions,
-- never people: a copy that opens the app three times in a day is three
-- launches, and there is no identifier to say otherwise. The version is kept so
-- a build that was never published, or a release's own testing before its day,
-- can be left out of what writers did. A beta's rows stay apart from a
-- release's (docs/engineering/services-and-feedback.md#SERV-272).
SELECT day, version, track, event, props, SUM(count) AS actions
FROM usage_counts
WHERE day >= ?1 AND day < ?2
GROUP BY day, version, track, event, props
ORDER BY day, track DESC, version DESC, event, props;
