import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import worker from '../src/index';
import {parseVoiceCommand,voiceCommandContext} from '../src/voice-commands';
import {store,recent,conversational,claim,diagnoseClaimRejection,settle,replyProbability} from '../src/storage';
import {logReply} from '../src/logging';
import type {Env} from '../src/config';
import type {TelegramMessage} from '../src/telegram';

vi.mock('../src/storage',async importOriginal=>({
  ...await importOriginal<typeof import('../src/storage')>(),
  store:vi.fn(async()=>true),
  recent:vi.fn(async()=>[{author:'Tester',body:'Хочу устроить праздник',user_id:42}]),
  conversational:vi.fn(()=>false),
  claim:vi.fn(async()=>1),
  diagnoseClaimRejection:vi.fn(async()=> 'chat_daily_budget'),
  settle:vi.fn(async()=>{}),
  contextMessageLimit:vi.fn(async()=>30),
  replyProbability:vi.fn(async()=>0),
  chatDailyLimit:vi.fn(async(_db:unknown,_chatId:number,fallback:number)=>fallback)
}));
vi.mock('../src/logging',async importOriginal=>({
  ...await importOriginal<typeof import('../src/logging')>(),logReply:vi.fn()
}));

function message(text:string):TelegramMessage{
  return {message_id:11,date:Math.floor(Date.now()/1000),text,chat:{id:-1001,type:'supergroup'},from:{id:42,first_name:'Tester'}};
}

async function send(text:string,options:{message?:Partial<TelegramMessage>;env?:Partial<Env>;llmFails?:boolean;photoFails?:boolean}={}){
  const llmRequests:Array<{model:string;messages:Array<{content:string}>;response_format?:unknown}>=[];
  const replies:Array<{text?:string;caption?:string;photo?:string;reply_parameters:{message_id:number}}>=[];
  const fetchMock=vi.fn(async(url:string,init?:RequestInit)=>{
    if(url.endsWith('/getMe'))return Response.json({ok:true,result:{username:'DiscoElysiumPersBot'}});
    const body=JSON.parse(String(init?.body));
    if(url==='https://api.openai.com/v1/chat/completions'){
      llmRequests.push(body);
      if(options.llmFails)return new Response('unavailable',{status:429});
      const voice=body.messages[0].content.includes('Голос: ЭЛЕКТРОХИМИЯ')?'ЭЛЕКТРОХИМИЯ':'СУМРАК';
      return Response.json({choices:[{message:{content:`${voice} — Успех\nУ этого праздника подозрительно трезвая смета.`}}],usage:{prompt_tokens:100,completion_tokens:50}});
    }
    if(url.endsWith('/sendPhoto')&&options.photoFails)return new Response('unavailable',{status:400});
    if(url.endsWith('/sendPhoto')||url.endsWith('/sendMessage')){
      replies.push(body);
      return Response.json({ok:true});
    }
    throw Error('Unexpected external call');
  });
  vi.stubGlobal('fetch',fetchMock);
  const env={DB:{} as D1Database,TELEGRAM_BOT_TOKEN:'test',TELEGRAM_WEBHOOK_SECRET:'test',OPENAI_API_KEY:'test',ALLOWED_CHAT_IDS:'-1001',REPLY_PERCENT:'0',...options.env} as Env;
  const pending:Promise<unknown>[]=[];
  const response=await worker.fetch(new Request('https://example.com/telegram/webhook',{
    method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':'test'},
    body:JSON.stringify({update_id:22,message:{...message(text),...options.message}})
  }),env,{waitUntil:(p:Promise<unknown>)=>{pending.push(p);}} as ExecutionContext);
  expect(response.status).toBe(200);
  await Promise.all(pending);
  return {llmRequests,replies,fetchMock};
}

beforeEach(()=>vi.clearAllMocks());
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});

describe('voice command parsing and context',()=>{
  it('parses exact commands, targets and multiline arguments',()=>{
    expect(parseVoiceCommand('/electrochemistry')).toEqual({voice:'ЭЛЕКТРОХИМИЯ',target:undefined,text:''});
    expect(parseVoiceCommand(' /HalfLight@DiscoElysiumPersBot страх\nи злость ')).toEqual({voice:'СУМРАК',target:'DiscoElysiumPersBot',text:'страх\nи злость'});
    for(const text of ['/halflight_extra','/electrochemistryExtra','/halflight@','/halflight!','текст /halflight','/ping'])
      expect(parseVoiceCommand(text)).toBeNull();
  });
  it('bounds transient context and gives command arguments the final focus after the reply target',()=>{
    const history=[1,2,3].map(n=>({author:'Tester',body:`старое ${n}`,user_id:42}));
    const m={...message('/halflight мой ответ'),reply_to_message:{...message(''),text:undefined,caption:'подпись фотографии'}};
    const context=voiceCommandContext(history,m,parseVoiceCommand(m.text!)!,3);
    expect(context.map(c=>c.body)).toEqual(['старое 3','подпись фотографии','мой ответ']);
    expect(history).toHaveLength(3);
    expect(parseVoiceCommand(`/halflight ${'a'.repeat(1000)}`)?.text).toHaveLength(900);
  });
});

describe('voice command webhook to writer',()=>{
  it.each([
    ['/electrochemistry','ЭЛЕКТРОХИМИЯ','Electrochemistry','electrochemistry'],
    ['/halflight','СУМРАК','Half Light','half-light']
  ])('%s calls only the writer with the requested voice even at 0%%',async(command,voice,source,portrait)=>{
    const random=vi.spyOn(Math,'random');
    const {llmRequests,replies}=await send(command);
    expect(llmRequests).toHaveLength(1);
    expect(llmRequests[0].model).toBe('gpt-6.1-sol');
    expect(llmRequests[0].response_format).toBeUndefined();
    expect(llmRequests[0].messages[0].content).toContain(`Голос: ${voice}`);
    expect(llmRequests[0].messages[0].content).toContain(`result/${source}.json:`);
    expect(llmRequests[0].messages[0].content).not.toContain('Режиссёр выбрал тему');
    expect(llmRequests[0].messages[1].content).toContain('Хочу устроить праздник');
    expect(llmRequests[0].messages[1].content).not.toContain(command);
    expect(random).not.toHaveBeenCalled();
    expect(store).not.toHaveBeenCalled();
    expect(replyProbability).not.toHaveBeenCalled();
    expect(conversational).not.toHaveBeenCalled();
    expect(claim).toHaveBeenCalledWith(expect.anything(),-1001,11,expect.any(Number),expect.anything(),true);
    expect(settle).toHaveBeenCalledWith(expect.anything(),1,'sent',0.0007);
    expect(replies).toHaveLength(1);
    expect(replies[0].caption).toContain(voice);
    expect(replies[0].photo).toContain(`${portrait}.png`);
    expect(replies[0].reply_parameters.message_id).toBe(11);
    expect(logReply).toHaveBeenCalledWith(expect.anything(),'sent',expect.objectContaining({mode:'voice_command',voice,candidates:[voice]}));
  });
  it('handles a targeted command and passes its argument to the writer',async()=>{
    const {llmRequests,fetchMock}=await send('/electrochemistry@DiscoElysiumPersBot хочется пиццы');
    expect(llmRequests).toHaveLength(1);
    expect(llmRequests[0].messages[1].content).toContain('2. Tester: хочется пиццы');
    expect(llmRequests[0].messages[1].content).toContain('Главный момент — сообщение 2');
    expect(fetchMock.mock.calls.filter(([url])=>url.endsWith('/getMe'))).toHaveLength(1);
  });
  it('focuses on the message selected through Telegram Reply',async()=>{
    const {llmRequests}=await send('/halflight',{message:{reply_to_message:message('Мне пришла странная посылка')}});
    expect(llmRequests[0].messages[1].content).toContain('2. Tester: Мне пришла странная посылка');
    expect(llmRequests[0].messages[1].content).toContain('Главный момент — сообщение 2');
  });
  it('still writes a greeting when there is no recent conversation',async()=>{
    vi.mocked(recent).mockResolvedValueOnce([]);
    const {llmRequests,replies}=await send('/electrochemistry');
    expect(llmRequests).toHaveLength(1);
    expect(replies).toHaveLength(1);
    expect(llmRequests[0].messages[1].content).toContain('вступительную реплику');
    expect(llmRequests[0].messages[1].content).not.toContain('сообщение 0');
  });
  it('ignores commands addressed to another bot before reading history or claiming a budget',async()=>{
    const {llmRequests,replies}=await send('/halflight@OtherBot');
    expect(llmRequests).toEqual([]);
    expect(replies).toEqual([]);
    expect(recent).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
  });
  it.each([
    {chat:{id:-1002,type:'supergroup'}},
    {chat:{id:42,type:'private'}},
    {from:{id:42,is_bot:true}},
    {date:Math.floor(Date.now()/1000)-600}
  ])('preserves existing chat, sender and freshness restrictions: %j',async(message)=>{
    const {llmRequests,replies}=await send('/halflight',{message});
    expect(llmRequests).toEqual([]);
    expect(replies).toEqual([]);
    expect(claim).not.toHaveBeenCalled();
  });
  it('acknowledges an exhausted budget without calling OpenAI',async()=>{
    vi.mocked(claim).mockResolvedValueOnce(null);
    const {llmRequests,replies}=await send('/electrochemistry');
    expect(llmRequests).toEqual([]);
    expect(replies[0].text).toContain('лимит');
  });
  it('does not generate or send another message for a duplicate command',async()=>{
    vi.mocked(claim).mockResolvedValueOnce(null);
    vi.mocked(diagnoseClaimRejection).mockResolvedValueOnce('duplicate');
    const {llmRequests,replies}=await send('/electrochemistry');
    expect(llmRequests).toEqual([]);
    expect(replies).toEqual([]);
  });
  it('reports unavailable generation',async()=>{
    const {llmRequests,replies}=await send('/electrochemistry',{env:{OPENAI_API_KEY:''}});
    expect(llmRequests).toEqual([]);
    expect(replies[0].text).toContain('недоступна');
  });
  it('settles a failed writer call and reports the failure',async()=>{
    const {llmRequests,replies}=await send('/halflight',{llmFails:true});
    expect(llmRequests).toHaveLength(1);
    expect(settle).toHaveBeenCalledWith(expect.anything(),1,'failed',0);
    expect(replies[0].text).toContain('Не получилось');
  });
  it('keeps the text fallback when the selected portrait cannot be sent',async()=>{
    const {llmRequests,replies}=await send('/halflight',{photoFails:true});
    expect(llmRequests).toHaveLength(1);
    expect(replies).toHaveLength(1);
    expect(replies[0].text).toContain('СУМРАК');
  });
});
