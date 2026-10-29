import {afterEach,describe,it,expect,vi} from 'vitest';
import {logReply,errorCode} from '../src/logging';
import type {TelegramMessage} from '../src/telegram';

afterEach(()=>vi.restoreAllMocks());

describe('structured reply diagnostics',()=>{
  it('logs identifiers and outcome without message text or user ID',()=>{
    const spy=vi.spyOn(console,'info').mockImplementation(()=>{});
    const message={message_id:12,date:1,text:'секретный текст',chat:{id:-1001,type:'supergroup'},from:{id:42}} as TelegramMessage;
    logReply(message,'probability_miss',{probability:1,roll:0.75});
    const line=spy.mock.calls[0][0] as string;
    expect(JSON.parse(line)).toEqual({event:'reply_decision',chat_id:-1001,message_id:12,outcome:'probability_miss',probability:1,roll:0.75});
    expect(line).not.toContain('секретный текст');
    expect(line).not.toContain('user_id');
  });
  it('reports safe error codes instead of raw provider messages',()=>{
    expect(errorCode(Error('LLM HTTP 429'))).toBe('llm_http_429');
    expect(errorCode(Error('LLM cost exceeded configured per-call reserve'))).toBe('reserve_exceeded');
    expect(errorCode(Error('opaque private detail'))).toBe('Error');
  });
});
