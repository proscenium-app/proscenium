-- SPDX-FileCopyrightText: 2026 Habiby LLC
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Feedback is a list, not an email (2026-09-19): no notice is sent, so
-- nothing records whether one was.
ALTER TABLE feedback_messages DROP COLUMN notice_sent;
