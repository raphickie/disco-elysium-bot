import { actualMicroUsd } from './budget.js';
import type { Config } from './config.js';
import type { Env } from './types.js';

interface ResponsesOutputItem {
  type?: string;
  content?: Array<{ type?: string; text?: string }>;
}

interface ResponsesResult {
  output?: ResponsesOutputItem[];
  output_text?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface GenerateOutput {
  text: string;
  inputTokens: number;
  outputTokens: number;
  actualMicroUsd: number | null;
}

export function requestOpenAiBody(config: Config, instructions: string, input: string): string {
  return JSON.stringify({
    model: config.model,
    instructions,
    input,
    max_output_tokens: config.maxOutputTokens,
    reasoning: { effort: 'none' },
    store: false,
  });
}

export async function generateResponse(
  env: Env,
  config: Config,
  body: string,
  request: typeof fetch = fetch,
): Promise<GenerateOutput> {
  if (!env.OPENAI_API_KEY) throw new Error('missing_openai_key');
  const response = await request('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'content-type': 'application/json',
    },
    body,
    signal: AbortSignal.timeout(17000),
  });
  if (!response.ok) throw new Error(`openai_http_${response.status}`);
  const data = await response.json() as ResponsesResult;
  const text = data.output_text || (data.output ?? []).filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .filter((content) => content.type === 'output_text' && typeof content.text === 'string')
    .map((content) => content.text ?? '').join('\n');
  if (!text.trim()) throw new Error('openai_empty_output');
  const inputTokens = data.usage?.input_tokens;
  const outputTokens = data.usage?.output_tokens;
  const validUsage = typeof inputTokens === 'number' && Number.isFinite(inputTokens) && inputTokens >= 0 &&
    typeof outputTokens === 'number' && Number.isFinite(outputTokens) && outputTokens >= 0;
  return {
    text,
    inputTokens: validUsage ? inputTokens : 0,
    outputTokens: validUsage ? outputTokens : 0,
    // Do not replace the safety reservation if token usage is unavailable.
    actualMicroUsd: validUsage ? actualMicroUsd(inputTokens, outputTokens, config) : null,
  };
}

export async function sendTelegramMessage(
  env: Env,
  chatId: string,
  text: string,
  request: typeof fetch = fetch,
): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error('missing_telegram_token');
  const res = await request(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_notification: true }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`telegram_http_${res.status}`);
  const payload = await res.json() as { ok?: boolean };
  if (!payload.ok) throw new Error('telegram_not_ok');
}
