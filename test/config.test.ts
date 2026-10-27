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
