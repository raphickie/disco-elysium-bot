CREATE TABLE IF NOT EXISTS chat_settings (
  chat_id INTEGER PRIMARY KEY,
  context_messages INTEGER NOT NULL CHECK(context_messages BETWEEN 3 AND 70),
  updated_at INTEGER NOT NULL
);
