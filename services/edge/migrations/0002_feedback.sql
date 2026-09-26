-- SPDX-FileCopyrightText: 2026 Habiby LLC
-- SPDX-License-Identifier: AGPL-3.0-or-later
CREATE TABLE feedback_messages (
  id TEXT PRIMARY KEY NOT NULL,
  message TEXT NOT NULL,
  email TEXT,
  details TEXT,
  received_day TEXT NOT NULL,
  notice_sent INTEGER NOT NULL DEFAULT 0 CHECK (notice_sent IN (0, 1))
);
CREATE INDEX feedback_messages_received ON feedback_messages(received_day);
