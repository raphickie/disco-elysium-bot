ALTER TABLE chat_settings ADD COLUMN chat_daily_usd REAL CHECK(chat_daily_usd BETWEEN 0 AND 10000);

INSERT INTO chat_settings(chat_id,context_messages,chat_daily_usd,updated_at)
VALUES(-4922375667,30,0.80,unixepoch())
ON CONFLICT(chat_id) DO UPDATE SET
  chat_daily_usd=excluded.chat_daily_usd,
  updated_at=excluded.updated_at;
