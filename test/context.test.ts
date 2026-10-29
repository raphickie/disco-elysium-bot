import {describe,it,expect,vi,afterEach} from 'vitest';
import {parseContextCommand} from '../src/context';
import {isChatAdmin} from '../src/telegram';
import type {Env} from '../src/config';
import handler from '../src/index';

vi.mock('../src/generator',()=>({generate:vi.fn()}));

describe('context command',()=>{
  it('shows the current limit without an argument',()=>{
    expect(parseContextCommand('/context_messages')).toEqual({kind:'show',target:undefined});
  });
  it('accepts the boundaries and a command addressed to this bot',()=>{
    expect(parseContextCommand('/context_messages 3')).toEqual({kind:'set',value:3,target:undefined});
    expect(parseContextCommand('/context_messages@ExampleBot 70')).toEqual({kind:'set',value:70,target:'ExampleBot'});
  });
  it('rejects values outside the range and non-integers',()=>{
    for(const value of ['2','71','1.5','abc','9007199254740993'])
      expect(parseContextCommand(`/context_messages ${value}`)?.kind).toBe('invalid');
  });
  it('ignores unrelated commands',()=>{
    expect(parseContextCommand('/context 70')).toBeNull();
    expect(parseContextCommand('/context_messages_extra 70')).toBeNull();
  });
});

describe('Telegram administrator check',()=>{
  afterEach(()=>vi.unstubAllGlobals());
  it.each([['creator',true],['administrator',true],['member',false]])('maps %s to %s',async(status,expected)=>{
    const fetchMock=vi.fn().mockResolvedValue({ok:true,json:async()=>({ok:true,result:{status}})});
    vi.stubGlobal('fetch',fetchMock);
    expect(await isChatAdmin({TELEGRAM_BOT_TOKEN:'test'} as Env,-1001,42)).toBe(expected);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({chat_id:-1001,user_id:42});
  });
});

describe('webhook context command',()=>{
  afterEach(()=>vi.unstubAllGlobals());
  it('saves an administrator setting without storing the command as chat context',async()=>{
    const queries:Array<{sql:string;args:unknown[]}>=[];
    const db={prepare:(sql:string)=>({bind:(...args:unknown[])=>{
      queries.push({sql,args});
      return {run:async()=>({meta:{changes:1}}),first:async()=>null};
    }})};
    const sent:string[]=[];
    vi.stubGlobal('fetch',vi.fn(async(url:string,options?:{body?:string})=>{
      if(url.endsWith('/getChatMember'))return {ok:true,json:async()=>({ok:true,result:{status:'administrator'}})};
      if(url.endsWith('/sendMessage')){
        sent.push(JSON.parse(options!.body!).text);
        return {ok:true,json:async()=>({ok:true})};
      }
      throw Error(`Unexpected Telegram call: ${url}`);
    }));
    const now=Math.floor(Date.now()/1000);
    const pending:Promise<unknown>[]=[];
    const env={DB:db,TELEGRAM_BOT_TOKEN:'test',TELEGRAM_WEBHOOK_SECRET:'secret',ALLOWED_CHAT_IDS:'-1001',REPLY_PERCENT:'100'} as unknown as Env;
    const request=new Request('https://example.com/telegram/webhook',{
      method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':'secret'},
      body:JSON.stringify({update_id:12,message:{message_id:8,date:now,text:'/context_messages 70',chat:{id:-1001,type:'supergroup'},from:{id:42}}})
    });
    const response=await handler.fetch(request,env,{waitUntil:(p:Promise<unknown>)=>{pending.push(p);}} as ExecutionContext);
    await Promise.all(pending);
    expect(response.status).toBe(200);
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain('INSERT INTO chat_settings');
    expect(queries[0].args.slice(0,2)).toEqual([-1001,70]);
    expect(sent).toEqual(['Готово: теперь беру до 70 последних сообщений за 20 минут.']);
  });
});
