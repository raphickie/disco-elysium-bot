import {describe,it,expect} from 'vitest';
import {settings,type Env} from '../src/config';
import {diagnoseClaimRejection} from '../src/storage';

const s=settings({} as Env);
type Row={
  duplicate_count:number;pending_count:number;cooldown_count:number;
  chat_day_usd:number;chat_month_usd:number;global_day_usd:number;global_month_usd:number;
};
function db(row:Partial<Row>):D1Database{
  const full={duplicate_count:0,pending_count:0,cooldown_count:0,chat_day_usd:0,chat_month_usd:0,global_day_usd:0,global_month_usd:0,...row};
  return {prepare:()=>({bind:()=>({first:async()=>full})})} as unknown as D1Database;
}

describe('claim rejection diagnosis',()=>{
  it('identifies cooldown only for ordinary reply mode',async()=>{
    const database=db({cooldown_count:1});
    expect(await diagnoseClaimRejection(database,-1001,7,1_700_000_000,s,false)).toBe('cooldown');
    expect(await diagnoseClaimRejection(database,-1001,7,1_700_000_000,s,true)).toBe('unknown');
  });
  it('distinguishes a chat budget from a simultaneous generation',async()=>{
    expect(await diagnoseClaimRejection(db({chat_day_usd:0.09}),-1001,7,1_700_000_000,s,true)).toBe('chat_daily_budget');
    expect(await diagnoseClaimRejection(db({chat_day_usd:0.09,pending_count:1}),-1001,7,1_700_000_000,s,true)).toBe('already_generating');
  });
});
