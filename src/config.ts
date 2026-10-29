export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  OPENAI_API_KEY: string;
  WHITELIST_ENABLED?: string;
  ALLOWED_CHAT_IDS?: string;
  REPLY_PERCENT?: string;
  COOLDOWN_SECONDS?: string;
  CONTEXT_WINDOW_MINUTES?: string;
  HISTORY_HOURS?: string;
  CHAT_DAILY_USD?: string;
  CHAT_MONTHLY_USD?: string;
  GLOBAL_DAILY_USD?: string;
  GLOBAL_MONTHLY_USD?: string;
  RESERVED_USD_PER_CALL?: string;
  OPENAI_MODEL?: string;
  OPENAI_INPUT_USD_PER_MILLION?: string;
  OPENAI_OUTPUT_USD_PER_MILLION?: string;
}
export type Settings = {
  whitelistEnabled:boolean; allowedChatIds:Set<string>; probability:number; cooldown:number;
  contextWindow:number; historySeconds:number;
  chatDaily:number; chatMonthly:number; globalDaily:number; globalMonthly:number;
  reserve:number; model:string; inputRate:number; outputRate:number;
};
function number(v:string|undefined,fallback:number,min:number,max:number):number {
  if(v===undefined || v.trim()==='')return fallback;
  const n=Number(v);
  if(!Number.isFinite(n)||n<min||n>max)throw Error('Invalid numeric configuration');
  return n;
}
export function settings(e:Env):Settings {
  return {
    whitelistEnabled:(e.WHITELIST_ENABLED??'true').toLowerCase()!=='false',
    allowedChatIds:new Set((e.ALLOWED_CHAT_IDS??'').split(',').map(x=>x.trim()).filter(Boolean)),
    probability:number(e.REPLY_PERCENT,1,0,100),
    cooldown:number(e.COOLDOWN_SECONDS,900,0,86400),
    contextWindow:number(e.CONTEXT_WINDOW_MINUTES,20,1,120)*60,
    historySeconds:number(e.HISTORY_HOURS,48,1,168)*3600,
    chatDaily:number(e.CHAT_DAILY_USD,0.1,0,10000),
    chatMonthly:number(e.CHAT_MONTHLY_USD,1,0,10000),
    globalDaily:number(e.GLOBAL_DAILY_USD,1,0,10000),
    globalMonthly:number(e.GLOBAL_MONTHLY_USD,10,0,10000),
    reserve:number(e.RESERVED_USD_PER_CALL,0.02,0.00001,10),
    model:e.OPENAI_MODEL??'gpt-4.1-mini',
    inputRate:number(e.OPENAI_INPUT_USD_PER_MILLION,0.4,0,10000),
    outputRate:number(e.OPENAI_OUTPUT_USD_PER_MILLION,1.6,0,10000),
  };
}
export function isAllowed(chatId:number,s:Settings):boolean {
  return !s.whitelistEnabled||s.allowedChatIds.has(String(chatId));
}
export function shouldReply(probability:number,roll:number):boolean {
  return roll*100<probability;
}
