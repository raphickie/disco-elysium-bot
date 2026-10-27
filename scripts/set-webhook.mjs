#!/usr/bin/env node
// Requires NODE 22+. Avoid passing secrets as command-line arguments/history.
const { TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, WORKER_URL } = process.env;
if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_WEBHOOK_SECRET || !WORKER_URL) {
  console.error('Set TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and WORKER_URL environment variables.');
  process.exit(1);
}
if (!/^[A-Za-z0-9_-]{1,256}$/.test(TELEGRAM_WEBHOOK_SECRET)) {
  console.error('TELEGRAM_WEBHOOK_SECRET must contain only letters, digits, underscores or hyphens.');
  process.exit(1);
}
const url = `${WORKER_URL.replace(/\/$/, '')}/telegram/webhook`;
if (!url.startsWith('https://')) {
  console.error('WORKER_URL must be HTTPS.');
  process.exit(1);
}
const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    url,
    secret_token: TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ['message'],
    max_connections: 1,
    drop_pending_updates: false,
  }),
});
const data = await response.json();
if (!response.ok || !data.ok) {
  console.error(`Telegram refused webhook setup: HTTP ${response.status} ${data.description || ''}`);
  process.exit(1);
}
console.log('Webhook registered:', url);
