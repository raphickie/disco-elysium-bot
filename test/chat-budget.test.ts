import {describe,it,expect} from 'vitest';
import {chatDailyLimit} from '../src/storage';

describe('per-chat daily budget',()=>{
  it('uses the saved override and falls back to the shared default',async()=>{
    const seen:unknown[]=[];
    const db=(value:number|null)=>({prepare:(sql:string)=>({bind:(chatId:number)=>{
      seen.push([sql,chatId]);
      return {first:async()=>value===null?null:{chat_daily_usd:value}};
    }})}) as unknown as D1Database;
    expect(await chatDailyLimit(db(0.8),-4922375667,0.1)).toBe(0.8);
    expect(await chatDailyLimit(db(null),-1001890425588,0.1)).toBe(0.1);
    expect(seen[0]).toEqual(['SELECT chat_daily_usd FROM chat_settings WHERE chat_id=?',-4922375667]);
  });
});
