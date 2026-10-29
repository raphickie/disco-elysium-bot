import {afterEach,describe,it,expect,vi} from 'vitest';
import {settings,type Env} from '../src/config';
import {generate} from '../src/generator';
import {selectReferences,copiesReference} from '../src/references';
import {VOICE_REFERENCES} from '../src/voice-references';
import {VOICES} from '../src/voices';

const env={OPENAI_API_KEY:'test'} as Env;
const s=settings(env);
const context=[{author:'Аня',body:'Опять опоздал автобус',user_id:1},{author:'Борис',body:'Зато дождь пошёл',user_id:2}];
function response(content:string,prompt_tokens=100,completion_tokens=50):Response{
  return new Response(JSON.stringify({choices:[{message:{content}}],usage:{prompt_tokens,completion_tokens}}),{status:200});
}
function decision(respond:boolean,voice='ТРЕПЕТ'):string{
  return JSON.stringify({respond,voice,focus_message:2,topic:'автобус и дождь',mood:'ироничная тоска',angle:'остановка стала главным героем'});
}
afterEach(()=>vi.unstubAllGlobals());

describe('two-stage generation',()=>{
  it('asks the director for a strict decision and uses its chosen voice',async()=>{
    const fetchMock=vi.fn().mockResolvedValueOnce(response(decision(true))).mockResolvedValueOnce(response('ТРЕПЕТ — Успех\nДаже остановка сегодня ждёт чуда.'));
    vi.stubGlobal('fetch',fetchMock);
    const costs:number[]=[];
    const result=await generate(env,s,context,false,cost=>costs.push(cost));
    expect(result).toMatchObject({kind:'reply',voice:'ТРЕПЕТ'});
    expect(costs).toHaveLength(2);
    expect(result.cost).toBeCloseTo(costs[0]+costs[1]);
    const first=JSON.parse(fetchMock.mock.calls[0][1].body);
    const second=JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(first.model).toBe('gpt-6-luna');
    expect(first.reasoning_effort).toBe('none');
    expect(first.max_completion_tokens).toBe(250);
    expect(second.model).toBe('gpt-6.1-sol');
    expect(second.reasoning_effort).toBe('low');
    expect(second.max_completion_tokens).toBe(1200);
    expect(costs[0]).toBeCloseTo((100*0.1+50*0.5)/1_000_000);
    expect(costs[1]).toBeCloseTo((100*2+50*10)/1_000_000);
    expect(first.response_format.json_schema.strict).toBe(true);
    expect(first.response_format.json_schema.schema.properties.voice.enum).toContain('ТРЕПЕТ');
    expect(first.messages[0].content).toContain('Обычный разговор: можно промолчать');
    expect(second.response_format).toBeUndefined();
    expect(second.messages[0].content).toContain('Голос: ТРЕПЕТ');
    expect(second.messages[0].content).toContain('остановка стала главным героем');
    expect(second.messages[0].content).toContain('result/Shivers.json:');
    expect((second.messages[0].content.match(/\[result\/Shivers\.json:/g)??[])).toHaveLength(15);
    expect(second.messages[1].content).toContain('Главный момент — сообщение 2');
  });
  it('skips the writer when the director sees no useful reply',async()=>{
    const fetchMock=vi.fn().mockResolvedValueOnce(response(decision(false)));
    vi.stubGlobal('fetch',fetchMock);
    const result=await generate(env,s,context);
    expect(result.kind).toBe('skip');
    expect(result.cost).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('writes a reply to a direct mention even when the director returns false',async()=>{
    const fetchMock=vi.fn().mockResolvedValueOnce(response(decision(false,'ЭМПАТИЯ'))).mockResolvedValueOnce(response('ЭМПАТИЯ — Успех\nТебя услышали.'));
    vi.stubGlobal('fetch',fetchMock);
    const result=await generate(env,s,context,true);
    expect(result).toMatchObject({kind:'reply',voice:'ЭМПАТИЯ'});
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content).toContain('respond обязан быть true');
  });
  it('reports director usage when the writer request fails',async()=>{
    const fetchMock=vi.fn().mockResolvedValueOnce(response(decision(true))).mockResolvedValueOnce(new Response('error',{status:429}));
    vi.stubGlobal('fetch',fetchMock);
    const costs:number[]=[];
    await expect(generate(env,s,context,false,cost=>costs.push(cost))).rejects.toThrow('LLM HTTP 429');
    expect(costs).toHaveLength(1);
    expect(costs[0]).toBeGreaterThan(0);
  });
  it('keeps a longer reply allowed by the edited writer prompt',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(response(decision(true)))
      .mockResolvedValueOnce(response(`ТРЕПЕТ — Успех\n${'Новая мысль. '.repeat(50)}`)));
    const result=await generate(env,s,context);
    expect(result.kind).toBe('reply');
    if(result.kind==='reply')expect(result.text.length).toBeGreaterThan(550);
  });
  it('regenerates once when the writer copies a game line',async()=>{
    const query='автобус и дождь ироничная тоска остановка стала главным героем Зато дождь пошёл';
    const copied=selectReferences('ТРЕПЕТ',query)[0].text;
    const fetchMock=vi.fn().mockResolvedValueOnce(response(decision(true)))
      .mockResolvedValueOnce(response(`ТРЕПЕТ — Успех\n${copied}`))
      .mockResolvedValueOnce(response('ТРЕПЕТ — Успех\nУ остановки сегодня собственный прогноз: ждать вечно.'));
    vi.stubGlobal('fetch',fetchMock);
    const result=await generate(env,s,context);
    expect(result.kind).toBe('reply');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).messages[1].content).toContain('слишком дословно');
  });
});

describe('curated game references',()=>{
  it('has enough source-linked examples for every active voice',()=>{
    for(const voice of VOICES){
      const pool=VOICE_REFERENCES[voice];
      expect(pool.items).toHaveLength(15);
      expect(new Set(pool.items.map(r=>r.line)).size).toBe(15);
      const refs=selectReferences(voice,'дождь спор вечеринка');
      expect(refs).toHaveLength(8);
      expect(new Set(refs.map(r=>r.line)).size).toBe(8);
      expect(refs.every(r=>r.text.length>20)).toBe(true);
      expect(pool.items.every(r=>r.tags.length>0)).toBe(true);
    }
  });
  it('ranks a topical example and detects a copied line',()=>{
    const refs=selectReferences('ТРЕПЕТ','дождь снег остановка город');
    expect(refs.some(ref=>ref.line===209)).toBe(true);
    expect(copiesReference(`ТРЕПЕТ — Успех\n${refs[0].text}`,refs)).toBe(true);
    expect(copiesReference('ТРЕПЕТ — Успех\nУ дождя сегодня смена без выходных.',refs)).toBe(false);
  });
});
