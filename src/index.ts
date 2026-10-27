import { claimGeneration, finishGeneration, reservedMicroUsd, saveActualUsage } from './budget.js';
import { generateResponse, requestOpenAiBody, sendTelegramMessage } from './clients.js';
import { readConfig, settingsForChat, type Config } from './config.js';
import { isConversationReady, normaliseMessage, shouldRollReply } from './context.js';
import { INSTRUCTIONS, conversationInput, pickCheck, pickVoice, telegramReply } from './prompt.js';
import type { ChatSettingsRow, Env, StoredMessage, TelegramUpdate, WorkerContext } from './types.js';

const TEXT_RESPONSE_HEADERS = { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' };
const OK = () => new Response('ok', { status: 200, headers: TEXT_RESPONSE_HEADERS });

function sameSecret(a: string | null, b: string | undefined): boolean {
  if (!b || !a) return false;
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return difference === 0;
}

function errorName(error: unknown): string {
  if (error instanceof Error) {
    if (/^[a-z_]+$/.test(error.message) || /^\w+_http_\d+$/.test(error.message)) return error.message;
    if (error.name === 'TimeoutError') return 'upstream_timeout';
  }
  return 'unexpected_error';
}

async function conversation(env: Env, chatId: string, config: Config, now: number): Promise<StoredMessage[]> {
  const result = await env.DB.prepare(`
    SELECT chat_id, message_id, telegram_user_id, author, body, sent_at
    FROM chat_messages
    WHERE chat_id = ? AND sent_at >= ?
    ORDER BY sent_at DESC, message_id DESC
    LIMIT ?
  `).bind(chatId, now - config.contextWindowMinutes * 60, config.contextMessageLimit).all<StoredMessage>();
  return result.results.reverse();
}

async function respondToChat(
  env: Env,
  config: Config,
  chatId: string,
  messageId: number,
  now: number,
): Promise<void> {
  const messages = await conversation(env, chatId, config, now);
  if (!isConversationReady(messages, config)) return;

  const voice = pickVoice();
  const check = pickCheck();
  const input = conversationInput(messages, voice, check);
  const requestBody = requestOpenAiBody(config, INSTRUCTIONS, input);
  const reserve = reservedMicroUsd(requestBody, config);

  const claimed = await claimGeneration(env.DB, {
    chatId,
    messageId,
    now,
    reserveMicroUsd: reserve,
    skill: voice.name,
    config,
  });
  if (!claimed) {
    console.info('generation_skipped_limit_or_cooldown', { chatId });
    return;
  }

  try {
    const result = await generateResponse(env, config, requestBody);
    if (result.actualMicroUsd !== null) {
      await saveActualUsage(env.DB, chatId, messageId, result.actualMicroUsd, result.inputTokens, result.outputTokens);
    }
    const reply = telegramReply(voice, check, result.text, config.maxReplyChars);
    await sendTelegramMessage(env, chatId, reply);
    await finishGeneration(env.DB, chatId, messageId, 'sent');
  } catch (error) {
    const code = errorName(error);
    // Keep the pessimistic reservation if usage is unknown, even on failure.
    // Log no user text, prompt, key or raw API response.
    console.error('generation_failed', { chatId, code });
    await finishGeneration(env.DB, chatId, messageId, 'failed', code);
  }
}

export async function handleTelegramUpdate(
  update: TelegramUpdate,
  env: Env,
  config: Config,
  ctx: WorkerContext,
  now = Math.floor(Date.now() / 1000),
): Promise<Response> {
  const message = update.message;
  if (!message) return OK();
  if (message.chat?.type !== 'group' && message.chat?.type !== 'supergroup') return OK();
  const chatId = String(message.chat.id);

  if (config.whitelistEnabled && !config.allowedChats.has(chatId)) {
    // Useful when obtaining the chat ID via `wrangler tail`; no message text.
    console.info('chat_not_whitelisted', { chatId });
    return OK();
  }
  const stored = normaliseMessage(message, config);
  if (!stored || Math.abs(now - stored.sent_at) > config.maxUpdateAgeSeconds) return OK();

  // Per-chat overrides are optional; all are read before the probability test.
  const chatSettings = await env.DB.prepare(`
    SELECT enabled, reply_percent, chat_daily_limit_usd,
           chat_monthly_limit_usd, cooldown_seconds
    FROM chat_settings WHERE chat_id = ?
  `).bind(chatId).first<ChatSettingsRow>();
  const effective = settingsForChat(config, chatSettings);
  if (!effective.botEnabled) return OK();

  // UNIQUE(chat_id, message_id) handles duplicate Telegram webhook retries.
  const inserted = await env.DB.prepare(`
    INSERT OR IGNORE INTO chat_messages
      (chat_id, message_id, telegram_user_id, author, body, sent_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(stored.chat_id, stored.message_id, stored.telegram_user_id,
    stored.author, stored.body, stored.sent_at).run();
  if (inserted.meta.changes !== 1 || !shouldRollReply(effective.replyPercent)) return OK();

  ctx.waitUntil(respondToChat(env, effective, chatId, stored.message_id, now).catch((error: unknown) => {
    // Unanticipated D1 errors before budget claim are safe to skip; Telegram
    // acknowledged the stored message and won't duplicate model calls.
    console.error('background_processing_failed', { chatId, code: errorName(error) });
  }));
  return OK();
}

async function handleWebhook(request: Request, env: Env, ctx: WorkerContext): Promise<Response> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET || !env.OPENAI_API_KEY) {
    return new Response('Secrets are not configured', { status: 503, headers: TEXT_RESPONSE_HEADERS });
  }
  if (!sameSecret(request.headers.get('x-telegram-bot-api-secret-token'), env.TELEGRAM_WEBHOOK_SECRET)) {
    return new Response('Unauthorized', { status: 401, headers: TEXT_RESPONSE_HEADERS });
  }
  if (!(request.headers.get('content-type') || '').toLowerCase().includes('application/json')) {
    return new Response('Unsupported content type', { status: 415, headers: TEXT_RESPONSE_HEADERS });
  }
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 128_000) return new Response('Payload too large', { status: 413 });

  const raw = await request.text();
  if (raw.length > 128_000) return new Response('Payload too large', { status: 413 });
  let update: TelegramUpdate;
  try {
    update = JSON.parse(raw) as TelegramUpdate;
  } catch {
    return new Response('Invalid JSON', { status: 400, headers: TEXT_RESPONSE_HEADERS });
  }
  const config = readConfig(env);
  return handleTelegramUpdate(update, env, config, ctx);
}

export default {
  async fetch(request: Request, env: Env, ctx: WorkerContext): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (request.method === 'GET' && path === '/health') {
      return new Response('ok', { status: 200, headers: TEXT_RESPONSE_HEADERS });
    }
    if (request.method !== 'POST' || path !== '/telegram/webhook') {
      return new Response('Not found', { status: 404, headers: TEXT_RESPONSE_HEADERS });
    }
    try {
      return await handleWebhook(request, env, ctx);
    } catch (error) {
      // 5xx causes Telegram to retry. Deduplication is enforced by D1.
      console.error('webhook_failed', { code: errorName(error) });
      return new Response('Temporary error', { status: 503, headers: TEXT_RESPONSE_HEADERS });
    }
  },

  async scheduled(_event: unknown, env: Env): Promise<void> {
    const config = readConfig(env);
    const now = Math.floor(Date.now() / 1000);
    // Delete in bounded batches to avoid a long-running cron on free Workers.
    await env.DB.prepare(`
      DELETE FROM chat_messages WHERE rowid IN (
        SELECT rowid FROM chat_messages WHERE sent_at < ? LIMIT 1000
      )
    `).bind(now - config.messageTtlHours * 3600).run();
    // Keep 65 days of cost ledger (no message texts), covering any monthly period.
    await env.DB.prepare(`
      DELETE FROM generation_attempts WHERE id IN (
        SELECT id FROM generation_attempts WHERE created_at < ? LIMIT 500
      )
    `).bind(now - 65 * 86400).run();
  },
};
