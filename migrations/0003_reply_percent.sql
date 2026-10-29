ALTER TABLE chat_settings ADD COLUMN reply_percent REAL CHECK(reply_percent BETWEEN 0 AND 100);
