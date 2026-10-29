import {afterEach,describe,it,expect,vi} from 'vitest';
import {parseProbabilityCommand} from '../src/probability';
import handler from '../src/index';
import type {Env} from '../src/config';

vi.mock('../src/generator',()=>({generate:vi.fn()}));
afterEach(()=>vi.unstubAllGlobals());

describe('reply probability command',()=>{
  it('shows, sets fractional percentages, and resets',()=>{
    expect(parseProbabilityCommand('/reply_percent')).toEqual({kind:'show',target:undefined});
    expect(parseProbabilityCommand('/reply_percent 0')).toEqual({kind:'set',value:0,target:undefined});
    expect(parseProbabilityCommand('/reply_percent 0.5')).toEqual({kind:'set',value:0.5,target:undefined});
    expect(parseProbabilityCommand('/reply_percent@DiscoElysiumPersBot 100')).toEqual({kind:'set',value:100,target:'DiscoElysiumPersBot'});
    expect(parseProbabilityCommand('/reply_percent reset')).toEqual({kind:'reset',target:undefined});
  });
  it('rejects invalid values and unrelated commands',()=>{
    for(const value of ['-1','100.01','101','0.123','NaN','1e2'])
      expect(parseProbabilityCommand(`/reply_percent ${value}`)?.kind).toBe('invalid');
    expect(parseProbabilityCommand('/reply_percent_extra 5')).toBeNull();
  });
});

type Query={sql:string;args:unknown[]};
async function sendCommand(text:string,status='administrator',stored:number|null=null):Promise<{queries:Query[];sent:string[];calls:string[]}>{
  const queries:Query[]=[];
  const db={prepare:(sql:string)=>({bind:(...args:unknown[])=>{
    queries.push({sql,args});
    return {run:async()=>({meta:{changes:1}}),first:async()=>sql.includes('SELECT reply_percent')?(stored===null?null:{reply_percent:stored}):null};
  }})};
  const sent:string[]=[];
  const calls:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string,options?:{body?:string})=>{
    calls.push(url);
    if(url.endsWith('/getMe'))return {ok:true,json:async()=>({ok:true,result:{username:'DiscoElysiumPersBot'}})};
    if(url.endsWith('/getChatMember'))return {ok:true,json:async()=>({ok:true,result:{status}})};
    if(url.endsWith('/sendMessage')){
      sent.push(JSON.parse(options!.body!).text);
      return {ok:true,json:async()=>({ok:true})};
    }
    throw Error(`Unexpected call: ${url}`);
  }));
  const now=Math.floor(Date.now()/1000);
  const pending:Promise<unknown>[]=[];
  const env={DB:db,TELEGRAM_BOT_TOKEN:'test',TELEGRAM_WEBHOOK_SECRET:'secret',ALLOWED_CHAT_IDS:'-1001',REPLY_PERCENT:'1'} as unknown as Env;
  const request=new Request('https://example.com/telegram/webhook',{
    method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':'secret'},
    body:JSON.stringify({update_id:12,message:{message_id:8,date:now,text,chat:{id:-1001,type:'supergroup'},from:{id:42}}})
  });
  const response=await handler.fetch(request,env,{waitUntil:(p:Promise<unknown>)=>{pending.push(p);}} as ExecutionContext);
  expect(response.status).toBe(200);
  await Promise.all(pending);
  return {queries,sent,calls};
}

describe('webhook probability setting',()=>{
  it('saves an administrator override without storing the command in chat history',async()=>{
    const {queries,sent,calls}=await sendCommand('/reply_percent 2.5');
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain('INSERT INTO chat_settings');
    expect(queries[0].args.slice(0,3)).toEqual([-1001,30,2.5]);
    expect(calls.some(url=>url.endsWith('/getChatMember'))).toBe(true);
    expect(sent).toEqual(['Готово: вероятность запуска Режиссёра в этом чате — 2.5%.']);
  });
  it('shows the default without requiring administrator rights',async()=>{
    const {queries,sent,calls}=await sendCommand('/reply_percent','member');
    expect(queries[0].sql).toContain('SELECT reply_percent');
    expect(calls.some(url=>url.endsWith('/getChatMember'))).toBe(false);
    expect(sent[0]).toContain('1%');
  });
  it('resets a saved value to the default',async()=>{
    const {queries,sent}=await sendCommand('/reply_percent reset');
    expect(queries[0].sql).toContain('reply_percent=NULL');
    expect(sent[0]).toContain('снова 1%');
  });
  it('blocks a non-administrator from changing it',async()=>{
    const {queries,sent}=await sendCommand('/reply_percent 50','member');
    expect(queries).toEqual([]);
    expect(sent[0]).toContain('только администратор');
  });
  it('rejects out-of-range values before database access',async()=>{
    const {queries,sent}=await sendCommand('/reply_percent 101');
    expect(queries).toEqual([]);
    expect(sent[0]).toContain('от 0 до 100%');
  });
  it('ignores a command addressed to a different bot',async()=>{
    const {queries,sent}=await sendCommand('/reply_percent@OtherBot 50');
    expect(queries).toEqual([]);
    expect(sent).toEqual([]);
  });
});
