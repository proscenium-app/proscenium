-- SPDX-FileCopyrightText: 2026 Habiby LLC
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- The whole build version a message was sent from, when the copy says it
-- (docs/engineering/services-and-feedback.md#SERV-273), so feedback from copies
-- on a beta can be counted. NULL for a message from a copy that does not say it.
ALTER TABLE feedback_messages ADD COLUMN version TEXT;
