import {settings,isAllowed,shouldReply,type Env,type Settings} from './config';
import {type TelegramUpdate,type TelegramMessage,sendMessage,sendSkillPhoto,isPingCommand,mentionsBot,commandTargetsBot,isChatAdmin} from './telegram';
import {store,recent,conversational,claim,diagnoseClaimRejection,settle,cleanup,contextMessageLimit,setContextMessageLimit,replyProbability,setReplyProbability,resetReplyProbability} from './storage';
import {generate} from './generator';
import {parseContextCommand,type ContextCommand} from './context';
import {parseProbabilityCommand,type ProbabilityCommand} from './probability';
import {logReply,errorCode} from './logging';

function validMessage(m:TelegramMessage|undefined):m is TelegramMessage {
  if(!m||!['group','supergroup'].includes(m.chat.type))return false;
  if(!m.from||m.from.is_bot)return false;
  const text=(m.text??m.caption??'').trim();
  if(!text||text.startsWith('/'))return false;
  return true;
}

async function handleContextCommand(m:TelegramMessage,command:ContextCommand,env:Env,now:number):Promise<void>{
  if(!await commandTargetsBot(env,command.target))return;
  if(command.kind==='invalid'){
    await sendMessage(env,m.chat.id,m.message_id,command.message);
    return;
  }
  if(command.kind==='show'){
    const limit=await contextMessageLimit(env.DB,m.chat.id);
    await sendMessage(env,m.chat.id,m.message_id,`Сейчас в контексте до ${limit} сообщений. Изменить: /context_messages <3–70>.`);
    return;
  }
  let admin:boolean;
  try{admin=await isChatAdmin(env,m.chat.id,m.from!.id);}
  catch{
    await sendMessage(env,m.chat.id,m.message_id,'Не удалось проверить права администратора. Попробуй позже.');
    return;
  }
  if(!admin){
    await sendMessage(env,m.chat.id,m.message_id,'Менять размер контекста может только администратор чата.');
    return;
  }
  await setContextMessageLimit(env.DB,m.chat.id,command.value,now);
  await sendMessage(env,m.chat.id,m.message_id,`Готово: теперь беру до ${command.value} последних сообщений за 20 минут.`);
}

async function handleProbabilityCommand(m:TelegramMessage,command:ProbabilityCommand,env:Env,s:Settings,now:number):Promise<void>{
  if(!await commandTargetsBot(env,command.target))return;
  if(command.kind==='invalid'){
    await sendMessage(env,m.chat.id,m.message_id,command.message);
    return;
  }
  if(command.kind==='show'){
    const value=await replyProbability(env.DB,m.chat.id,s.probability);
    await sendMessage(env,m.chat.id,m.message_id,`Вероятность запуска Режиссёра в этом чате: ${value}%. Изменить: /reply_percent <0–100>. Сбросить: /reply_percent reset.`);
    return;
  }
  let admin:boolean;
  try{admin=await isChatAdmin(env,m.chat.id,m.from!.id);}
  catch{
    await sendMessage(env,m.chat.id,m.message_id,'Не удалось проверить права администратора. Попробуй позже.');
    return;
  }
  if(!admin){
    await sendMessage(env,m.chat.id,m.message_id,'Менять вероятность может только администратор чата.');
    return;
  }
  if(command.kind==='reset'){
    await resetReplyProbability(env.DB,m.chat.id,now);
    logReply(m,'setting_changed',{setting:'reply_percent',value:s.probability,source:'default'});
    await sendMessage(env,m.chat.id,m.message_id,`Готово: вероятность снова ${s.probability}% — общий дефолт.`);
    return;
  }
  await setReplyProbability(env.DB,m.chat.id,command.value,now);
  logReply(m,'setting_changed',{setting:'reply_percent',value:command.value,source:'chat'});
  await sendMessage(env,m.chat.id,m.message_id,`Готово: вероятность запуска Режиссёра в этом чате — ${command.value}%.`);
}

async function process(update:TelegramUpdate,env:Env,s:Settings):Promise<void>{
  const m=update.message;
  if(!m||!m.from||m.from.is_bot)return;
  const isGroup=['group','supergroup'].includes(m.chat.type);
  if(!isGroup&&m.chat.type!=='private')return;
  // Private chats allow an inexpensive ping even before any group is whitelisted.
  // Group pings honour the whitelist, just like normal generated replies.
  if(isGroup&&!isAllowed(m.chat.id,s)){
    logReply(m,'whitelist_denied');
    return;
  }
  const now=Math.floor(Date.now()/1000);
  // Ignore stale replayed updates and very old messages.
  if(Math.abs(now-m.date)>300){logReply(m,'stale_update');return;}

  // Health check: no D1 access, OpenAI token, probability check or LLM costs.
  if(isPingCommand(m.text)){
    if(!env.TELEGRAM_BOT_TOKEN) {
      console.warn('Telegram bot token missing: cannot respond to /ping');
      logReply(m,'ping_failed',{reason:'telegram_token_missing'});
      return;
    }
    await sendMessage(env,m.chat.id,m.message_id,'pong');
    logReply(m,'ping_sent');
    return;
  }

  if(!isGroup)return;
  const command=parseContextCommand(m.text??'');
  if(command){await handleContextCommand(m,command,env,now);return;}
  const probabilityCommand=parseProbabilityCommand(m.text??'');
  if(probabilityCommand){await handleProbabilityCommand(m,probabilityCommand,env,s,now);return;}
  if(!validMessage(m)){logReply(m,'ignored_nontext_or_command');return;}
  if(!await store(env.DB,update.update_id,m)){logReply(m,'duplicate_update');return;}
  const mentioned=mentionsBot(m.text??m.caption);
  let mustReply=mentioned;
  let probability:number|undefined;
  if(!mentioned){
    probability=await replyProbability(env.DB,m.chat.id,s.probability);
    const roll=Math.random();
    if(!shouldReply(probability,roll)){
      logReply(m,'probability_miss',{probability,roll});
      return;
    }
    mustReply=probability===100;
  }
  const mode=mentioned?'mention':mustReply?'always':'normal';
  if(!env.OPENAI_API_KEY){
    logReply(m,'generation_unavailable',{reason:'openai_key_missing',mode});
    if(mentioned)await sendMessage(env,m.chat.id,m.message_id,'Сейчас не могу ответить: генерация временно недоступна.');
    return;
  }
  const limit=await contextMessageLimit(env.DB,m.chat.id);
  const context=await recent(env.DB,m.chat.id,s,now,limit);
  if(!mustReply&&!conversational(context)){
    logReply(m,'insufficient_activity',{mode,context_count:context.length});
    return;
  }

  const id=await claim(env.DB,m.chat.id,m.message_id,now,s,mustReply);
  if(id===null){
    let reason='unknown';
    try{reason=await diagnoseClaimRejection(env.DB,m.chat.id,m.message_id,now,s,mustReply);}
    catch{/* Keep the original claim result if diagnosis fails. */}
    logReply(m,'claim_rejected',{mode,reason,probability});
    if(mentioned)await sendMessage(env,m.chat.id,m.message_id,'Сейчас не могу ответить: достигнут лимит или уже обрабатывается другой ответ.');
    return;
  }

  let cost=0;
  let attemptedTelegramSend=false;
  let stage='generation';
  try {
    const generated=await generate(env,s,context,mustReply,amount=>{cost+=amount;});
    // Enforce the per-request reserve ceiling, even if provider usage surprises us.
    // Cost of the already completed API call is still recorded.
    if(cost>s.reserve)throw Error('LLM cost exceeded configured per-call reserve');
    if(generated.kind==='skip'){
      await settle(env.DB,id,'failed',cost);
      logReply(m,'director_skip',{mode,candidates:generated.candidates,cost_usd:cost});
      return;
    }
    attemptedTelegramSend=true;
    stage='telegram_send';
    let delivery:'photo'|'text_fallback'='photo';
    try {
      await sendSkillPhoto(env,m.chat.id,m.message_id,generated.voice,generated.text);
    } catch(photoError) {
      // A blocked/unavailable image must not eat an otherwise valid LLM answer.
      console.warn('Telegram skill photo failed, using text fallback:',errorCode(photoError));
      delivery='text_fallback';
      await sendMessage(env,m.chat.id,m.message_id,generated.text);
    }
    stage='settlement';
    await settle(env.DB,id,'sent',cost);
    logReply(m,'sent',{mode,voice:generated.voice,candidates:generated.candidates,delivery,cost_usd:cost});
  }catch(e){
    logReply(m,'failed',{mode,stage,error_code:errorCode(e),cost_usd:cost});
    await settle(env.DB,id,'failed',cost);
    if(mentioned&&!attemptedTelegramSend)
      await sendMessage(env,m.chat.id,m.message_id,'Не получилось сгенерировать ответ. Попробуй ещё раз позже.');
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
    ctx.waitUntil(process(update,env,s).catch(e=>{
      if(update.message)logReply(update.message,'processing_failed',{error_code:errorCode(e)});
      else console.error('Webhook processing failed:',errorCode(e));
    }));
    return new Response('ok');
  },
  async scheduled(_event:ScheduledController,env:Env,_ctx:ExecutionContext):Promise<void>{
    await cleanup(env.DB,Math.floor(Date.now()/1000),settings(env).historySeconds/3600);
  }
} satisfies ExportedHandler<Env>;
