import {settings,isAllowed,shouldReply,type Env,type Settings} from './config';
import {type TelegramUpdate,type TelegramMessage,sendMessage,isPingCommand} from './telegram';
import {store,recent,conversational,claim,settle,cleanup} from './storage';
import {generate} from './generator';

function validMessage(m:TelegramMessage|undefined):m is TelegramMessage {
  if(!m||!['group','supergroup'].includes(m.chat.type))return false;
  if(!m.from||m.from.is_bot)return false;
  const text=(m.text??m.caption??'').trim();
  if(!text||text.startsWith('/'))return false;
  return true;
}

async function process(update:TelegramUpdate,env:Env,s:Settings):Promise<void>{
  const m=update.message;
  if(!m||!m.from||m.from.is_bot)return;
  const isGroup=['group','supergroup'].includes(m.chat.type);
  if(!isGroup&&m.chat.type!=='private')return;
  // Private chats allow an inexpensive ping even before any group is whitelisted.
  // Group pings honour the whitelist, just like normal generated replies.
  if(isGroup&&!isAllowed(m.chat.id,s))return;
  const now=Math.floor(Date.now()/1000);
  // Ignore stale replayed updates and very old messages.
  if(Math.abs(now-m.date)>300)return;

  // Health check: no D1 access, OpenAI token, probability check or LLM costs.
  if(isPingCommand(m.text)){
    if(!env.TELEGRAM_BOT_TOKEN) {
      console.warn('Telegram bot token missing: cannot respond to /ping');
      return;
    }
    await sendMessage(env,m.chat.id,m.message_id,'pong');
    return;
  }

  if(!isGroup||!validMessage(m))return;
  if(!await store(env.DB,update.update_id,m))return;
  if(!env.OPENAI_API_KEY||!shouldReply(s.probability,Math.random()))return;
  const context=await recent(env.DB,m.chat.id,s,now);
  if(!conversational(context))return;

  const id=await claim(env.DB,m.chat.id,m.message_id,now,s);
  if(id===null)return;

  let cost=0;
  try {
    const generated=await generate(env,s,context);
    cost=generated.cost;
    // Enforce the per-request reserve ceiling, even if provider usage surprises us.
    // Cost of the already completed API call is still recorded.
    if(cost>s.reserve)throw Error('LLM cost exceeded configured per-call reserve');
    await sendMessage(env,m.chat.id,m.message_id,generated.text);
    await settle(env.DB,id,'sent',cost);
  }catch(e){
    console.error('Reply failed:',String(e));
    await settle(env.DB,id,'failed',cost);
  }
}

export default {
  async fetch(request:Request,env:Env,ctx:ExecutionContext):Promise<Response>{
    const url=new URL(request.url);
    if(url.pathname==='/health'&&request.method==='GET')return new Response('ok');
    // Public liveness probe, independent of Telegram, D1 and OpenAI credentials.
    if(url.pathname==='/ping'&&request.method==='GET')
      return new Response('pong',{headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
    if(url.pathname!=='/telegram/webhook'||request.method!=='POST')return new Response('Not found',{status:404});
    if(!env.TELEGRAM_WEBHOOK_SECRET||request.headers.get('X-Telegram-Bot-Api-Secret-Token')!==env.TELEGRAM_WEBHOOK_SECRET)
      return new Response('Unauthorized',{status:401});
    if(Number(request.headers.get('content-length')??0)>100_000)return new Response('Too large',{status:413});
    let update:TelegramUpdate;
    try{
      update=await request.json() as TelegramUpdate;
      if(!Number.isSafeInteger(update.update_id))throw Error('Invalid update');
    }catch{return new Response('Bad request',{status:400});}
    let s:Settings;
    try{s=settings(env);}catch(e){console.error('Configuration:',String(e));return new Response('Configuration error',{status:500});}
    ctx.waitUntil(process(update,env,s).catch(e=>console.error('Webhook processing:',String(e))));
    return new Response('ok');
  },
  async scheduled(_event:ScheduledController,env:Env,_ctx:ExecutionContext):Promise<void>{
    await cleanup(env.DB,Math.floor(Date.now()/1000),settings(env).historySeconds/3600);
  }
} satisfies ExportedHandler<Env>;
