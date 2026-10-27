import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import app from '../dist/src/index.js';
import { readConfig } from '../dist/src/config.js';
import { handleTelegramUpdate } from '../dist/src/index.js';

const migration=readFileSync(new URL('../migrations/0001_initial.sql',import.meta.url),'utf8');
const now=Math.floor(Date.UTC(2026,9,27,19,0,0)/1000);
function dbAdapter() {
  const real=new DatabaseSync(':memory:');
  real.exec(migration);
  const db={
    prepare(sql) {
      const statement=real.prepare(sql);
      const bound={
        params:[],
        bind(...args) {this.params=args;return this;},
        async first() {return statement.get(...this.params)??null;},
        async all() {return {results:statement.all(...this.params),success:true};},
        async run() {const output=statement.run(...this.params);return {meta:{changes:output.changes}};},
      };
      return bound;
    },
  };
  return {real,db};
}
function update(msgId,userId,text,chatId=-1001200120012) {
  return {update_id:msgId,message:{
    message_id:msgId,date:now+msgId,chat:{id:chatId,type:'supergroup'},
    from:{id:userId,is_bot:false,first_name:'Гость'+userId},text,
  }};
}

test('HTTP webhook ignores missing/wrong secret and private routes', async () => {
  const env={TELEGRAM_BOT_TOKEN:'X',TELEGRAM_WEBHOOK_SECRET:'secret',OPENAI_API_KEY:'Y'};
  const ctx={waitUntil() {throw new Error('Should not be called');}};
  assert.equal((await app.fetch(new Request('https://test.workers.dev/health'),env,ctx)).status,200);
  assert.equal((await app.fetch(new Request('https://test.workers.dev/nothing'),env,ctx)).status,404);
  const req=new Request('https://test.workers.dev/telegram/webhook',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  assert.equal((await app.fetch(req,env,ctx)).status,401);
});

test('message ingestion is idempotent, whitelisted and contextual generation runs once', async () => {
  const {real,db}=dbAdapter();
  const env={DB:db,TELEGRAM_BOT_TOKEN:'fake',OPENAI_API_KEY:'fake',TELEGRAM_WEBHOOK_SECRET:'secret'};
  const config=readConfig({REPLY_PERCENT:'100',ALLOWED_CHAT_IDS:'-1001200120012',
    MIN_CONTEXT_MESSAGES:'2',MIN_CONTEXT_USERS:'2',COOLDOWN_SECONDS:'300'});
  const scheduled=[];
  const ctx={waitUntil(promise) {scheduled.push(promise);}};
  let openAiCalls=0, telegramCalls=0;
  const previousFetch=globalThis.fetch;
  globalThis.fetch=async (url)=>{
    if (String(url).includes('openai.com')) {
      openAiCalls++;
      return Response.json({output:[{type:'message',content:[{type:'output_text',text:'Вселенная снова подвела тебя.'}]}],usage:{input_tokens:40,output_tokens:60}});
    }
    telegramCalls++;
    return Response.json({ok:true,result:{message_id:123}});
  };
  try {
    await handleTelegramUpdate(update(1,1,'Я хочу спать'),env,config,ctx,now+1);
    assert.equal(scheduled.length,1); // probability rolled but conversation not ready
    await Promise.all(scheduled.splice(0));
    assert.equal(telegramCalls,0);
    await handleTelegramUpdate(update(2,2,'А я хочу чаю'),env,config,ctx,now+2);
    await Promise.all(scheduled.splice(0));
    assert.equal(openAiCalls,1);
    assert.equal(telegramCalls,1);
    assert.equal(real.prepare('SELECT COUNT(*) c FROM generation_attempts').get().c,1);
    assert.equal(real.prepare('SELECT status FROM generation_attempts').get().status,'sent');
    await handleTelegramUpdate(update(2,2,'А я хочу чаю'),env,config,ctx,now+2);
    assert.equal(scheduled.length,0);
    await handleTelegramUpdate(update(3,1,'Привет всем'),env,config,ctx,now+3);
    await Promise.all(scheduled.splice(0));
    assert.equal(telegramCalls,1); // cooldown blocked concurrent responses
    assert.equal(real.prepare('SELECT COUNT(*) c FROM chat_messages').get().c,3);
    await handleTelegramUpdate(update(4,4,'Хэй',-100999),env,config,ctx,now+4);
    assert.equal(real.prepare('SELECT COUNT(*) c FROM chat_messages').get().c,3); // whitelist
  } finally {
    globalThis.fetch=previousFetch;
    real.close();
  }
});
