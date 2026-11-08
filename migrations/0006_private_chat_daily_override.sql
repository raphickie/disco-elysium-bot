INSERT INTO chat_settings(chat_id,context_messages,chat_daily_usd,updated_at)
VALUES(80126579,30,1.00,unixepoch())
ON CONFLICT(chat_id) DO UPDATE SET
  chat_daily_usd=excluded.chat_daily_usd,
  updated_at=excluded.updated_at;
