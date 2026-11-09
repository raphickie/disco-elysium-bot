import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import worker from '../src/index';
import {parseVoiceCommand,voiceCommandContext,focusedHumanContext} from '../src/voice-commands';
import {VOICES,type Voice} from '../src/voices';
import {VOICE_REFERENCES} from '../src/voice-references';
import {portraitUrl} from '../src/portraits';
import {store,recent,conversational,claim,diagnoseClaimRejection,settle,replyProbability,latestHumanMessage} from '../src/storage';
import {logReply} from '../src/logging';
import type {Env} from '../src/config';
import type {TelegramMessage} from '../src/telegram';

const VOICE_COMMANDS=[
  ['/inlandempire','ВНУТРЕННЯЯ ИМПЕРИЯ'],
  ['/shivers','ТРЕПЕТ'],
  ['/electrochemistry','ЭЛЕКТРОХИМИЯ'],
  ['/logic','ЛОГИКА'],
  ['/empathy','ЭМПАТИЯ'],
  ['/authority','АВТОРИТЕТ'],
  ['/conceptualization','КОНЦЕПТУАЛИЗАЦИЯ'],
  ['/drama','ДРАМА'],
  ['/rhetoric','РИТОРИКА'],
  ['/volition','ВОЛЯ'],
  ['/encyclopedia','ЭНЦИКЛОПЕДИЯ'],
  ['/visualcalculus','ВИЗУАЛЬНАЯ РЕКОНСТРУКЦИЯ'],
  ['/espritdecorps','ESPRIT DE CORPS'],
  ['/suggestion','ВНУШЕНИЕ'],
  ['/endurance','СТОЙКОСТЬ'],
  ['/painthreshold','БОЛЕВОЙ ПОРОГ'],
  ['/physicalinstrument','ГРУБАЯ СИЛА'],
  ['/halflight','СУМРАК'],
  ['/handeyecoordination','КООРДИНАЦИЯ'],
  ['/perception','ВОСПРИЯТИЕ'],
  ['/reactionspeed','СКОРОСТЬ РЕАКЦИИ'],
  ['/savoirfaire','ЭКВИЛИБРИСТИКА'],
  ['/interfacing','ТЕХНИКА'],
  ['/composure','САМООБЛАДАНИЕ']
] as const satisfies ReadonlyArray<readonly [string,Voice]>;

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
  chatDailyLimit:vi.fn(async(_db:unknown,_chatId:number,fallback:number)=>fallback),
  latestHumanMessage:vi.fn(async()=>null)
}));
vi.mock('../src/logging',async importOriginal=>({
  ...await importOriginal<typeof import('../src/logging')>(),logReply:vi.fn()
}));

function message(text:string):TelegramMessage{
  return {message_id:11,date:Math.floor(Date.now()/1000),text,chat:{id:-1001,type:'supergroup'},from:{id:42,first_name:'Tester'}};
}

async function send(text:string,options:{message?:Partial<TelegramMessage>;env?:Partial<Env>;llmFails?:boolean;photoFails?:boolean}={}){
  const llmRequests:Array<{model:string;messages:Array<{content:string}>;response_format?:unknown}>=[];
  const replies:Array<{chat_id:number;text?:string;caption?:string;photo?:string;reply_parameters:{message_id:number}}>=[];
  const fetchMock=vi.fn(async(url:string,init?:RequestInit)=>{
    if(url.endsWith('/getMe'))return Response.json({ok:true,result:{username:'DiscoElysiumPersBot'}});
    const body=JSON.parse(String(init?.body));
    if(url==='https://api.openai.com/v1/chat/completions'){
      llmRequests.push(body);
      if(options.llmFails)return new Response('unavailable',{status:429});
      if(body.response_format){
        const voice=body.response_format.json_schema.schema.properties.voice.enum[0];
        return Response.json({choices:[{message:{content:JSON.stringify({respond:false,voice,focus_message:1,topic:'праздник',mood:'восторг',angle:'трезвая смета'})}}],usage:{prompt_tokens:100,completion_tokens:50}});
      }
      const voice=body.messages[0].content.match(/Голос: ([^.]+)\./)?.[1];
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
  it('covers every available voice with a distinct command',()=>{
    expect(VOICE_COMMANDS.map(([,voice])=>voice).sort()).toEqual([...VOICES].sort());
    expect(new Set(VOICE_COMMANDS.map(([command])=>command)).size).toBe(VOICES.length);
    for(const [command,voice] of VOICE_COMMANDS)
      expect(parseVoiceCommand(command)).toEqual({voice,target:undefined,text:''});
  });
  it('parses exact commands, targets and multiline arguments',()=>{
    expect(parseVoiceCommand('/electrochemistry')).toEqual({voice:'ЭЛЕКТРОХИМИЯ',target:undefined,text:''});
    expect(parseVoiceCommand(' /HalfLight@DiscoElysiumPersBot страх\nи злость ')).toEqual({voice:'СУМРАК',target:'DiscoElysiumPersBot',text:'страх\nи злость'});
    for(const text of ['/halflight_extra','/electrochemistryExtra','/halflight@','/halflight!','текст /halflight','/ping',
      '/shivers_extra','/shivers!','/unknown','/constructor','/__proto__','/toString'])
      expect(parseVoiceCommand(text)).toBeNull();
  });
  it('does not use a reply to the bot as context for a bare command',()=>{
    const previous=[{author:'Аня',body:'Сломался чайник, как быть?',user_id:100}];
    const command=parseVoiceCommand('/logic')!;
    const botReply={...message('ЛОГИКА — Успех'),from:{id:999,is_bot:true,first_name:'DiscoBot'}};
    const context=voiceCommandContext(previous,{...message('/logic'),reply_to_message:botReply},command,30);
    expect(context.map(m=>m.body)).toEqual(['Сломался чайник, как быть?']);
  });
  it('prefers a human reply target to the last chronological message',()=>{
    const previous=[{author:'Аня',body:'Второе сообщение',user_id:100}];
    const target={...message('Первое сообщение'),from:{id:111,first_name:'Борис',is_bot:false}};
    const context=voiceCommandContext(previous,{...message('/drama'),reply_to_message:target},parseVoiceCommand('/drama')!,30);
    expect(context.at(-1)).toMatchObject({body:'Первое сообщение',author:'Борис'});
  });
  it('ignores bare bot mentions as conversation content',()=>{
    const history=[{author:'Аня',body:'Хочу собаку',user_id:100},{author:'Tester',body:'@DiscoElysiumPersBot',user_id:42}];
    expect(focusedHumanContext(history,message('@DiscoElysiumPersBot'),30).map(m=>m.body)).toEqual(['Хочу собаку']);
  });
  it('uses an earlier human message outside the 20-minute window for an empty command',async()=>{
    vi.mocked(recent).mockResolvedValueOnce([]);
    vi.mocked(latestHumanMessage).mockResolvedValueOnce({author:'Борис',body:'Вчера потерял документы',user_id:55});
    const {llmRequests}=await send('/drama');
    expect(latestHumanMessage).toHaveBeenCalledWith(expect.anything(),-1001,11,expect.any(Number),expect.any(Number));
    expect(llmRequests).toHaveLength(1);
    expect(llmRequests[0].messages[1].content).toContain('1. Борис: Вчера потерял документы');
    expect(llmRequests[0].messages[1].content).toContain('Главный момент — сообщение 1');
    expect(llmRequests[0].messages[1].content).not.toContain('вступительную реплику');
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
  it.each(VOICE_COMMANDS)('%s calls only the writer with the requested voice even at 0%%',async(command,voice)=>{
    const random=vi.spyOn(Math,'random');
    const {llmRequests,replies}=await send(command);
    expect(llmRequests).toHaveLength(1);
    expect(llmRequests[0].model).toBe('gpt-6.1-sol');
    expect(llmRequests[0].response_format).toBeUndefined();
    expect(llmRequests[0].messages[0].content).toContain(`Голос: ${voice}`);
    expect(llmRequests[0].messages[0].content).toContain(`${VOICE_REFERENCES[voice].source}:`);
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
    expect(replies[0].photo).toBe(portraitUrl(voice));
    expect(replies[0].reply_parameters.message_id).toBe(11);
    expect(logReply).toHaveBeenCalledWith(expect.anything(),'sent',expect.objectContaining({mode:'voice_command',voice,candidates:[voice]}));
  });
  it('handles a targeted command and passes its argument to the writer',async()=>{
    const {llmRequests,fetchMock}=await send('/shivers@DiscoElysiumPersBot хочется чаю');
    expect(llmRequests).toHaveLength(1);
    expect(llmRequests[0].messages[0].content).toContain('Голос: ТРЕПЕТ');
    expect(llmRequests[0].messages[1].content).toContain('2. Tester: хочется чаю');
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
    const {llmRequests,replies}=await send('/shivers@OtherBot');
    expect(llmRequests).toEqual([]);
    expect(replies).toEqual([]);
    expect(recent).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
  });
  it.each(['/unknown','/shivers_extra','/constructor','/__proto__'])('ignores unsupported commands without generating: %s',async(command)=>{
    const {llmRequests,replies}=await send(command);
    expect(llmRequests).toEqual([]);
    expect(replies).toEqual([]);
    expect(store).not.toHaveBeenCalled();
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

describe('private replies for explicitly allowed users',()=>{
  const privateMessage={chat:{id:80126579,type:'private'},from:{id:80126579,first_name:'Tester'}};
  const privateEnv={ALLOWED_PRIVATE_USER_IDS:'80126579',ALLOWED_CHAT_IDS:''};

  it('answers an ordinary DM through both stages even at 0% and when the director would skip',async()=>{
    const {llmRequests,replies}=await send('Хочу устроить праздник',{message:privateMessage,env:privateEnv});
    expect(llmRequests.map(r=>r.model)).toEqual(['gpt-6-luna','gpt-6.1-sol']);
    expect(llmRequests[0].messages[0].content).toContain('respond обязан быть true');
    expect(store).toHaveBeenCalledWith(expect.anything(),22,expect.objectContaining({chat:privateMessage.chat}));
    expect(recent).toHaveBeenCalledWith(expect.anything(),80126579,expect.anything(),expect.any(Number),30);
    expect(replyProbability).not.toHaveBeenCalled();
    expect(conversational).not.toHaveBeenCalled();
    expect(claim).toHaveBeenCalledWith(expect.anything(),80126579,11,expect.any(Number),expect.anything(),true);
    expect(replies).toHaveLength(1);
    expect(replies[0].chat_id).toBe(80126579);
    expect(vi.mocked(settle).mock.calls[0][3]).toBeCloseTo(0.000735);
    expect(logReply).toHaveBeenCalledWith(expect.anything(),'sent',expect.objectContaining({mode:'private'}));
  });
  it.each(VOICE_COMMANDS)('allows %s in the same private chat without the director',async(command,voice)=>{
    const {llmRequests,replies}=await send(command,{message:privateMessage,env:privateEnv});
    expect(llmRequests.map(r=>r.model)).toEqual(['gpt-6.1-sol']);
    expect(llmRequests[0].messages[0].content).toContain(`Голос: ${voice}`);
    expect(replies).toHaveLength(1);
    expect(replies[0].chat_id).toBe(80126579);
    expect(store).not.toHaveBeenCalled();
  });
  it('answers the reported shivers command with its inline topic in the allowed DM',async()=>{
    const {llmRequests,replies}=await send('/shivers хочешься чаю',{message:privateMessage,env:privateEnv});
    expect(llmRequests.map(r=>r.model)).toEqual(['gpt-6.1-sol']);
    expect(llmRequests[0].messages[0].content).toContain('Голос: ТРЕПЕТ');
    expect(llmRequests[0].messages[1].content).toContain('2. Tester: хочешься чаю');
    expect(llmRequests[0].messages[1].content).toContain('Главный момент — сообщение 2');
    expect(replies).toHaveLength(1);
    expect(replies[0].caption).toContain('ТРЕПЕТ');
    expect(replies[0].chat_id).toBe(80126579);
  });
  it.each(['Привет','/electrochemistry','/halflight','/shivers'])('denies another user before storing, reading context or generating: %s',async(text)=>{
    const {llmRequests,replies}=await send(text,{
      message:{chat:{id:42,type:'private'},from:{id:42}},
      env:{...privateEnv,WHITELIST_ENABLED:'false',ALLOWED_CHAT_IDS:'42'}
    });
    expect(llmRequests).toEqual([]);
    expect(replies).toEqual([]);
    expect(store).not.toHaveBeenCalled();
    expect(recent).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
    expect(logReply).toHaveBeenCalledWith(expect.anything(),'private_user_denied');
  });
  it.each([
    {chat:{id:80126579,type:'private'},from:{id:42}},
    {chat:{id:42,type:'private'},from:{id:80126579}},
    {chat:{id:-1002,type:'supergroup'},from:{id:80126579}}
  ])('requires both the private sender and private chat to be allowed: %j',async(message)=>{
    const {llmRequests,replies}=await send('Привет',{message,env:privateEnv});
    expect(llmRequests).toEqual([]);
    expect(replies).toEqual([]);
    expect(store).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
  });
  it('does not generate in private chats without explicit configuration',async()=>{
    const {llmRequests,replies}=await send('Привет',{message:privateMessage});
    expect(llmRequests).toEqual([]);
    expect(replies).toEqual([]);
    expect(store).not.toHaveBeenCalled();
  });
  it('reports a budget rejection in the allowed private chat',async()=>{
    vi.mocked(claim).mockResolvedValueOnce(null);
    const {llmRequests,replies}=await send('Привет',{message:privateMessage,env:privateEnv});
    expect(llmRequests).toEqual([]);
    expect(replies[0].text).toContain('лимит');
  });
  it('reports unavailable generation in the allowed private chat',async()=>{
    const {llmRequests,replies}=await send('Привет',{message:privateMessage,env:{...privateEnv,OPENAI_API_KEY:''}});
    expect(llmRequests).toEqual([]);
    expect(replies[0].text).toContain('недоступна');
  });
  it('deduplicates ordinary private messages before generation',async()=>{
    vi.mocked(store).mockResolvedValueOnce(false);
    const {llmRequests,replies}=await send('Привет',{message:privateMessage,env:privateEnv});
    expect(llmRequests).toEqual([]);
    expect(replies).toEqual([]);
    expect(claim).not.toHaveBeenCalled();
  });
});
