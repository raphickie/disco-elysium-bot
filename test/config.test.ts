import {describe,it,expect} from 'vitest';
import {isAllowed,shouldReply,settings,type Env} from '../src/config';
import {conversational} from '../src/storage';

describe('probability',()=>{
  it('respects 0%, 1%, 100%',()=>{
    expect(shouldReply(0,0.0)).toBe(false);
    expect(shouldReply(1,0.009)).toBe(true);
    expect(shouldReply(1,0.011)).toBe(false);
    expect(shouldReply(100,0.9999)).toBe(true);
  });
});
describe('whitelist',()=>{
  const env={ALLOWED_CHAT_IDS:'-1001, -1002'} as Env;
  it('denies unknown chats by default',()=>{
    const s=settings(env);
    expect(isAllowed(-1001,s)).toBe(true);
    expect(isAllowed(-1003,s)).toBe(false);
  });
  it('allows all when disabled',()=>{
    const s=settings({...env,WHITELIST_ENABLED:'false'});
    expect(isAllowed(-1003,s)).toBe(true);
  });
});
describe('conversation',()=>{
  it('needs three messages from two humans',()=>{
    const m=(user_id:number)=>({user_id,author:'A',body:'text'});
    expect(conversational([m(1),m(1),m(1)])).toBe(false);
    expect(conversational([m(1),m(2)])).toBe(false);
    expect(conversational([m(1),m(2),m(1)])).toBe(true);
  });
});


describe('stage-specific OpenAI models and pricing',()=>{
  it('defaults to Luna for direction and Sol for writing',()=>{
    const s=settings({} as Env);
    expect(s.director).toEqual({model:'gpt-6-luna',inputRate:0.1,outputRate:0.5,reasoningEffort:'none'});
    expect(s.writer).toEqual({model:'gpt-6.1-sol',inputRate:2,outputRate:10,reasoningEffort:'low'});
    expect(s.reserve).toBe(0.05);
  });
  it('allows stage-specific pricing overrides',()=>{
    const s=settings({
      OPENAI_DIRECTOR_MODEL:'gpt-4.1-mini',
      OPENAI_DIRECTOR_INPUT_USD_PER_MILLION:'0.40',
      OPENAI_DIRECTOR_OUTPUT_USD_PER_MILLION:'1.60',
      OPENAI_WRITER_MODEL:'gpt-6.1-sol',
      OPENAI_WRITER_INPUT_USD_PER_MILLION:'2.00',
      OPENAI_WRITER_OUTPUT_USD_PER_MILLION:'10.00'
    } as Env);
    expect(s.director.inputRate).toBe(0.4);
    expect(s.director.outputRate).toBe(1.6);
    expect(s.director.model).toBe('gpt-4.1-mini');
    expect(s.writer.model).toBe('gpt-6.1-sol');
  });
});
