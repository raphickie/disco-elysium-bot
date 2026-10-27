-- Telegram group message history, deleted automatically after MESSAGE_TTL_HOURS.
CREATE TABLE IF NOT EXISTS chat_messages (
  chat_id TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  telegram_user_id TEXT NOT NULL,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (chat_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_context
  ON chat_messages(chat_id, sent_at DESC, message_id DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_expiry
  ON chat_messages(sent_at);

-- Small, non-content-bearing cost ledger. NULL actual_micro_usd means the
-- reserved worst-case amount is still counted against the spend limit.
CREATE TABLE IF NOT EXISTS generation_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  trigger_message_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  day_key TEXT NOT NULL,
  month_key TEXT NOT NULL,
  reserved_micro_usd INTEGER NOT NULL CHECK (reserved_micro_usd > 0),
  actual_micro_usd INTEGER CHECK (actual_micro_usd >= 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'generated', 'sent', 'failed')),
  skill TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  error_code TEXT,
  UNIQUE(chat_id, trigger_message_id)
);
CREATE INDEX IF NOT EXISTS idx_attempts_chat_day
  ON generation_attempts(chat_id, day_key);
CREATE INDEX IF NOT EXISTS idx_attempts_chat_month
  ON generation_attempts(chat_id, month_key);
CREATE INDEX IF NOT EXISTS idx_attempts_global_day
  ON generation_attempts(day_key);
CREATE INDEX IF NOT EXISTS idx_attempts_global_month
  ON generation_attempts(month_key);
CREATE INDEX IF NOT EXISTS idx_attempts_chat_time
  ON generation_attempts(chat_id, created_at DESC);

-- Optional per-chat overrides. NULL means use wrangler.jsonc defaults.
CREATE TABLE IF NOT EXISTS chat_settings (
  chat_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  reply_percent REAL CHECK (reply_percent BETWEEN 0 AND 100),
  chat_daily_limit_usd REAL CHECK (chat_daily_limit_usd >= 0),
  chat_monthly_limit_usd REAL CHECK (chat_monthly_limit_usd >= 0),
  cooldown_seconds INTEGER CHECK (cooldown_seconds >= 0),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
