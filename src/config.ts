import type { ChatSettingsRow, Env } from './types.js';

export interface Config {
  botEnabled: boolean;
  whitelistEnabled: boolean;
  allowedChats: ReadonlySet<string>;
  replyPercent: number;
  minContextMessages: number;
  minContextUsers: number;
  contextMessageLimit: number;
  contextWindowMinutes: number;
  messageTtlHours: number;
  maxMessageChars: number;
  maxUpdateAgeSeconds: number;
  cooldownSeconds: number;
  maxDailyRepliesPerChat: number;
  chatDailyLimitUsd: number;
  chatMonthlyLimitUsd: number;
  globalDailyLimitUsd: number;
  globalMonthlyLimitUsd: number;
  model: string;
  modelInputUsdPerMillion: number;
  modelOutputUsdPerMillion: number;
  maxOutputTokens: number;
  maxReplyChars: number;
}

function numberValue(value: string | undefined, fallback: number, min: number, max: number, key: string): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`Invalid ${key}: expected a number between ${min} and ${max}`);
  }
  return parsed;
}

function booleanValue(value: string | undefined, fallback: boolean, key: string): boolean {
  if (value === undefined || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Invalid ${key}: use true or false`);
}

export function parseAllowedChats(raw = ''): Set<string> {
  const ids = raw.split(',').map((value) => value.trim()).filter(Boolean);
  for (const id of ids) {
    if (!/^-?\d+$/.test(id)) throw new Error(`Invalid chat ID in ALLOWED_CHAT_IDS: ${id}`);
  }
  return new Set(ids);
}

export function readConfig(env: Env): Config {
  const model = env.OPENAI_MODEL || 'gpt-6-luna';
  if (model !== 'gpt-6-luna' && (!env.MODEL_INPUT_USD_PER_MILLION || !env.MODEL_OUTPUT_USD_PER_MILLION)) {
    throw new Error('When changing OPENAI_MODEL, explicitly set both MODEL_*_USD_PER_MILLION rates');
  }

  return {
    botEnabled: booleanValue(env.BOT_ENABLED, true, 'BOT_ENABLED'),
    whitelistEnabled: booleanValue(env.WHITELIST_ENABLED, true, 'WHITELIST_ENABLED'),
    allowedChats: parseAllowedChats(env.ALLOWED_CHAT_IDS),
    replyPercent: numberValue(env.REPLY_PERCENT, 1, 0, 100, 'REPLY_PERCENT'),
    minContextMessages: numberValue(env.MIN_CONTEXT_MESSAGES, 4, 1, 30, 'MIN_CONTEXT_MESSAGES'),
    minContextUsers: numberValue(env.MIN_CONTEXT_USERS, 2, 1, 20, 'MIN_CONTEXT_USERS'),
    contextMessageLimit: numberValue(env.CONTEXT_MESSAGE_LIMIT, 10, 2, 30, 'CONTEXT_MESSAGE_LIMIT'),
    contextWindowMinutes: numberValue(env.CONTEXT_WINDOW_MINUTES, 30, 1, 180, 'CONTEXT_WINDOW_MINUTES'),
    messageTtlHours: numberValue(env.MESSAGE_TTL_HOURS, 24, 1, 168, 'MESSAGE_TTL_HOURS'),
    maxMessageChars: numberValue(env.MAX_MESSAGE_CHARS, 400, 20, 1000, 'MAX_MESSAGE_CHARS'),
    maxUpdateAgeSeconds: numberValue(env.MAX_UPDATE_AGE_SECONDS, 300, 10, 3600, 'MAX_UPDATE_AGE_SECONDS'),
    cooldownSeconds: numberValue(env.COOLDOWN_SECONDS, 1200, 0, 86400, 'COOLDOWN_SECONDS'),
    maxDailyRepliesPerChat: numberValue(env.MAX_DAILY_REPLIES_PER_CHAT, 8, 0, 1000, 'MAX_DAILY_REPLIES_PER_CHAT'),
    chatDailyLimitUsd: numberValue(env.CHAT_DAILY_LIMIT_USD, 0.05, 0, 100, 'CHAT_DAILY_LIMIT_USD'),
    chatMonthlyLimitUsd: numberValue(env.CHAT_MONTHLY_LIMIT_USD, 0.5, 0, 1000, 'CHAT_MONTHLY_LIMIT_USD'),
    globalDailyLimitUsd: numberValue(env.GLOBAL_DAILY_LIMIT_USD, 0.5, 0, 1000, 'GLOBAL_DAILY_LIMIT_USD'),
    globalMonthlyLimitUsd: numberValue(env.GLOBAL_MONTHLY_LIMIT_USD, 5, 0, 10000, 'GLOBAL_MONTHLY_LIMIT_USD'),
    model,
    modelInputUsdPerMillion: numberValue(env.MODEL_INPUT_USD_PER_MILLION, 0.1, 0.0001, 1000, 'MODEL_INPUT_USD_PER_MILLION'),
    modelOutputUsdPerMillion: numberValue(env.MODEL_OUTPUT_USD_PER_MILLION, 0.5, 0.0001, 1000, 'MODEL_OUTPUT_USD_PER_MILLION'),
    maxOutputTokens: numberValue(env.MAX_OUTPUT_TOKENS, 220, 32, 1000, 'MAX_OUTPUT_TOKENS'),
    maxReplyChars: numberValue(env.MAX_REPLY_CHARS, 520, 100, 2000, 'MAX_REPLY_CHARS'),
  };
}

export function settingsForChat(config: Config, row: ChatSettingsRow | null): Config {
  if (!row) return config;
  return {
    ...config,
    botEnabled: config.botEnabled && row.enabled !== 0,
    replyPercent: row.reply_percent ?? config.replyPercent,
    chatDailyLimitUsd: row.chat_daily_limit_usd ?? config.chatDailyLimitUsd,
    chatMonthlyLimitUsd: row.chat_monthly_limit_usd ?? config.chatMonthlyLimitUsd,
    cooldownSeconds: row.cooldown_seconds ?? config.cooldownSeconds,
  };
}
