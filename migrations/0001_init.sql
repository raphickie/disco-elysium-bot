CREATE TABLE IF NOT EXISTS messages (
  chat_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  update_id INTEGER NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(chat_id,message_id)
);
CREATE INDEX IF NOT EXISTS messages_chat_time ON messages(chat_id,created_at DESC);

CREATE TABLE IF NOT EXISTS reply_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  day_key TEXT NOT NULL,
  month_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','sent','failed')),
  reserved_usd REAL NOT NULL,
  actual_usd REAL NOT NULL DEFAULT 0,
  UNIQUE(chat_id,message_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_per_chat ON reply_attempts(chat_id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS attempts_chat_day ON reply_attempts(chat_id,day_key);
CREATE INDEX IF NOT EXISTS attempts_month ON reply_attempts(month_key);
CREATE INDEX IF NOT EXISTS attempts_day ON reply_attempts(day_key);
CREATE INDEX IF NOT EXISTS attempts_chat_time ON reply_attempts(chat_id,created_at DESC);
