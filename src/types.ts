// Minimal D1 binding types; avoids coupling the application to Wrangler internals.
// The implementation provided by Cloudflare conforms to these APIs.
export type SqlValue = number | string | boolean | null;

export interface D1Statement {
  bind(...params: SqlValue[]): D1Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[]; success: boolean }>;
  run(): Promise<{ meta: { changes: number } }>;
}

export interface D1Database {
  prepare(query: string): D1Statement;
}

export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  OPENAI_API_KEY?: string;
  BOT_ENABLED?: string;
  WHITELIST_ENABLED?: string;
  ALLOWED_CHAT_IDS?: string;
  REPLY_PERCENT?: string;
  MIN_CONTEXT_MESSAGES?: string;
  MIN_CONTEXT_USERS?: string;
  CONTEXT_MESSAGE_LIMIT?: string;
  CONTEXT_WINDOW_MINUTES?: string;
  MESSAGE_TTL_HOURS?: string;
  MAX_MESSAGE_CHARS?: string;
  MAX_UPDATE_AGE_SECONDS?: string;
  COOLDOWN_SECONDS?: string;
  MAX_DAILY_REPLIES_PER_CHAT?: string;
  CHAT_DAILY_LIMIT_USD?: string;
  CHAT_MONTHLY_LIMIT_USD?: string;
  GLOBAL_DAILY_LIMIT_USD?: string;
  GLOBAL_MONTHLY_LIMIT_USD?: string;
  OPENAI_MODEL?: string;
  MODEL_INPUT_USD_PER_MILLION?: string;
  MODEL_OUTPUT_USD_PER_MILLION?: string;
  MAX_OUTPUT_TOKENS?: string;
  MAX_REPLY_CHARS?: string;
}

export interface WorkerContext {
  waitUntil(promise: Promise<unknown>): void;
}

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface TelegramMessage {
  message_id: number;
  date: number;
  chat: { id: number; type: string };
  from?: TelegramUser;
  sender_chat?: { id: number };
  text?: string;
  caption?: string;
  // Service updates are not conversation messages.
  new_chat_members?: unknown[];
  left_chat_member?: unknown;
  pinned_message?: unknown;
  group_chat_created?: boolean;
  supergroup_chat_created?: boolean;
}

export interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
}

export interface StoredMessage {
  chat_id: string;
  message_id: number;
  telegram_user_id: string;
  author: string;
  body: string;
  sent_at: number;
}

export interface ChatSettingsRow {
  enabled: number;
  reply_percent: number | null;
  chat_daily_limit_usd: number | null;
  chat_monthly_limit_usd: number | null;
  cooldown_seconds: number | null;
}
