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
  OPENAI_DIRECTOR_MODEL?: string;
  OPENAI_WRITER_MODEL?: string;
  OPENAI_DIRECTOR_INPUT_USD_PER_MILLION?: string;
  OPENAI_DIRECTOR_OUTPUT_USD_PER_MILLION?: string;
  OPENAI_WRITER_INPUT_USD_PER_MILLION?: string;
  OPENAI_WRITER_OUTPUT_USD_PER_MILLION?: string;
}
export type Settings = {
  whitelistEnabled:boolean; allowedChatIds:Set<string>; probability:number; cooldown:number;
  contextWindow:number; historySeconds:number;
  chatDaily:number; chatMonthly:number; globalDaily:number; globalMonthly:number;
  reserve:number;
  director:{model:string; inputRate:number; outputRate:number; reasoningEffort:'none'};
  writer:{model:string; inputRate:number; outputRate:number; reasoningEffort:'low'};
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
    reserve:number(e.RESERVED_USD_PER_CALL,0.05,0.00001,10),
    director:{
      model:e.OPENAI_DIRECTOR_MODEL??'gpt-6-luna',
      inputRate:number(e.OPENAI_DIRECTOR_INPUT_USD_PER_MILLION,0.1,0,10000),
      outputRate:number(e.OPENAI_DIRECTOR_OUTPUT_USD_PER_MILLION,0.5,0,10000),
      reasoningEffort:'none'
    },
    writer:{
      model:e.OPENAI_WRITER_MODEL??'gpt-6.1-sol',
      inputRate:number(e.OPENAI_WRITER_INPUT_USD_PER_MILLION,2,0,10000),
      outputRate:number(e.OPENAI_WRITER_OUTPUT_USD_PER_MILLION,10,0,10000),
      reasoningEffort:'low'
    },
  };
}
export function isAllowed(chatId:number,s:Settings):boolean {
  return !s.whitelistEnabled||s.allowedChatIds.has(String(chatId));
}
export function shouldReply(probability:number,roll:number):boolean {
  return roll*100<probability;
}
