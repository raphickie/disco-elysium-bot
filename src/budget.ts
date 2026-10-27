import type { Config } from './config.js';
import { utcKeys } from './context.js';
import type { D1Database, SqlValue } from './types.js';

// Reserve a pessimistic upper bound *before* calling the model. A BPE token
// covers at least one UTF-8 byte, so body bytes bound our supplied input
// tokens; additional margin covers API envelope and token accounting overhead.
// IMPORTANT: Update model prices in wrangler.jsonc if you change the model.
export function reservedMicroUsd(requestBody: string, config: Config): number {
  const bytes = new TextEncoder().encode(requestBody).length;
  return Math.max(1, Math.ceil((
    (bytes + 256) * config.modelInputUsdPerMillion +
    config.maxOutputTokens * config.modelOutputUsdPerMillion
  ) * 1.5));
}

export function actualMicroUsd(inputTokens: number, outputTokens: number, config: Config): number {
  return Math.max(0, Math.ceil(
    inputTokens * config.modelInputUsdPerMillion +
    outputTokens * config.modelOutputUsdPerMillion,
  ));
}

export function usdToMicroUsd(usd: number): number {
  return Math.floor(usd * 1_000_000 + 1e-7);
}

export const CLAIM_SQL = `
INSERT INTO generation_attempts (
  chat_id, trigger_message_id, created_at, day_key, month_key,
  reserved_micro_usd, status, skill
)
SELECT ?, ?, ?, ?, ?, ?, 'pending', ?
WHERE
  (SELECT COALESCE(SUM(COALESCE(actual_micro_usd, reserved_micro_usd)), 0)
     FROM generation_attempts WHERE chat_id = ? AND day_key = ?) + ? <= ?
  AND (SELECT COALESCE(SUM(COALESCE(actual_micro_usd, reserved_micro_usd)), 0)
     FROM generation_attempts WHERE chat_id = ? AND month_key = ?) + ? <= ?
  AND (SELECT COALESCE(SUM(COALESCE(actual_micro_usd, reserved_micro_usd)), 0)
     FROM generation_attempts WHERE day_key = ?) + ? <= ?
  AND (SELECT COALESCE(SUM(COALESCE(actual_micro_usd, reserved_micro_usd)), 0)
     FROM generation_attempts WHERE month_key = ?) + ? <= ?
  AND (SELECT COUNT(*) FROM generation_attempts WHERE chat_id = ? AND day_key = ?) < ?
  AND NOT EXISTS (
    SELECT 1 FROM generation_attempts WHERE chat_id = ? AND created_at > ?
  )
  AND NOT EXISTS (
    SELECT 1 FROM generation_attempts WHERE chat_id = ? AND trigger_message_id = ?
  )
`;

export interface ClaimInput {
  chatId: string;
  messageId: number;
  now: number;
  reserveMicroUsd: number;
  skill: string;
  config: Config;
}

export function claimParameters({ chatId, messageId, now, reserveMicroUsd, skill, config }: ClaimInput): SqlValue[] {
  const { day, month } = utcKeys(now);
  return [
    chatId, messageId, now, day, month, reserveMicroUsd, skill,
    chatId, day, reserveMicroUsd, usdToMicroUsd(config.chatDailyLimitUsd),
    chatId, month, reserveMicroUsd, usdToMicroUsd(config.chatMonthlyLimitUsd),
    day, reserveMicroUsd, usdToMicroUsd(config.globalDailyLimitUsd),
    month, reserveMicroUsd, usdToMicroUsd(config.globalMonthlyLimitUsd),
    chatId, day, config.maxDailyRepliesPerChat,
    chatId, now - config.cooldownSeconds,
    chatId, messageId,
  ];
}

export async function claimGeneration(db: D1Database, input: ClaimInput): Promise<boolean> {
  const result = await db.prepare(CLAIM_SQL).bind(...claimParameters(input)).run();
  return result.meta.changes === 1;
}

export async function saveActualUsage(
  db: D1Database,
  chatId: string,
  messageId: number,
  costMicroUsd: number,
  inputTokens: number,
  outputTokens: number,
): Promise<void> {
  await db.prepare(`
    UPDATE generation_attempts
    SET actual_micro_usd = ?, input_tokens = ?, output_tokens = ?, status = 'generated'
    WHERE chat_id = ? AND trigger_message_id = ? AND status = 'pending'
  `).bind(costMicroUsd, inputTokens, outputTokens, chatId, messageId).run();
}

export async function finishGeneration(
  db: D1Database,
  chatId: string,
  messageId: number,
  status: 'sent' | 'failed',
  errorCode: string | null = null,
): Promise<void> {
  await db.prepare(`
    UPDATE generation_attempts SET status = ?, error_code = ?
    WHERE chat_id = ? AND trigger_message_id = ?
  `).bind(status, errorCode, chatId, messageId).run();
}
