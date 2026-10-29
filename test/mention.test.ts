import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import worker from '../src/index';
import {mentionsBot} from '../src/telegram';
import {store,recent,conversational,claim,settle,contextMessageLimit} from '../src/storage';
import {generate} from '../src/generator';
import type {Env} from '../src/config';

vi.mock('../src/storage',()=>({
  store:vi.fn(async()=>true),
  recent:vi.fn(async()=>[{author:'Tester',body:'одна реплика',user_id:42}]),
  conversational:vi.fn(()=>false),
  claim:vi.fn(async()=>1),
  settle:vi.fn(async()=>{}),
  cleanup:vi.fn(async()=>{}),
  contextMessageLimit:vi.fn(async()=>30),
  setContextMessageLimit:vi.fn(async()=>{})
}));
vi.mock('../src/generator',()=>({generate:vi.fn(async()=>({text:'Голос: ответ',cost:0.001}))}));

async function send(text:string,apiKey='key'):Promise<string[]>{
  const replies:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(_url:string,options?:{body?:string})=>{
    replies.push(JSON.parse(options!.body!).text);
    return new Response(JSON.stringify({ok:true}),{status:200});
  }));
  const now=Math.floor(Date.now()/1000);
  const request=new Request('https://example.com/telegram/webhook',{
    method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':'secret'},
    body:JSON.stringify({update_id:22,message:{message_id:11,date:now,text,chat:{id:-1001,type:'supergroup'},from:{id:42}}})
  });
  const pending:Promise<unknown>[]=[];
  const env={DB:{},TELEGRAM_BOT_TOKEN:'test',TELEGRAM_WEBHOOK_SECRET:'secret',OPENAI_API_KEY:apiKey,ALLOWED_CHAT_IDS:'-1001',REPLY_PERCENT:'0'} as unknown as Env;
  const response=await worker.fetch(request,env,{waitUntil:(p:Promise<unknown>)=>{pending.push(p);}} as ExecutionContext);
  expect(response.status).toBe(200);
  await Promise.all(pending);
  return replies;
}

beforeEach(()=>vi.clearAllMocks());
afterEach(()=>vi.unstubAllGlobals());

describe('direct mention',()=>{
  it('matches the exact bot username',()=>{
    expect(mentionsBot('Привет, @DiscoElysiumPersBot!')).toBe(true);
    expect(mentionsBot('@discoelysiumpersbot ответь')).toBe(true);
    expect(mentionsBot('@DiscoElysiumPersBotExtra')).toBe(false);
    expect(mentionsBot('email@DiscoElysiumPersBot')).toBe(false);
  });
  it('generates despite 0% probability and a one-message conversation',async()=>{
    const replies=await send('@DiscoElysiumPersBot, скажи что-нибудь');
    expect(store).toHaveBeenCalledOnce();
    expect(contextMessageLimit).toHaveBeenCalledOnce();
    expect(recent).toHaveBeenCalledOnce();
    expect(conversational).not.toHaveBeenCalled();
    expect(claim).toHaveBeenCalledWith(expect.anything(),-1001,11,expect.any(Number),expect.anything(),true);
    expect(generate).toHaveBeenCalledOnce();
    expect(settle).toHaveBeenCalledWith(expect.anything(),1,'sent',0.001);
    expect(replies).toEqual(['Голос: ответ']);
  });
  it('keeps ordinary messages under the probability gate',async()=>{
    expect(await send('Обычное сообщение')).toEqual([]);
    expect(generate).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
  });
  it('acknowledges a budget or concurrency rejection',async()=>{
    vi.mocked(claim).mockResolvedValueOnce(null);
    const replies=await send('@DiscoElysiumPersBot');
    expect(generate).not.toHaveBeenCalled();
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('лимит');
  });
  it('acknowledges unavailable generation',async()=>{
    const replies=await send('@DiscoElysiumPersBot','');
    expect(generate).not.toHaveBeenCalled();
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('недоступна');
  });
  it('acknowledges an LLM failure',async()=>{
    vi.mocked(generate).mockRejectedValueOnce(Error('LLM HTTP 429'));
    const replies=await send('@DiscoElysiumPersBot');
    expect(settle).toHaveBeenCalledWith(expect.anything(),1,'failed',0);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('Не получилось');
  });
});
