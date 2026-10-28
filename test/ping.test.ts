import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { isPingCommand } from '../src/telegram';
import type { Env } from '../src/config';

afterEach(() => vi.restoreAllMocks());

function request(chatId: number, chatType: string, secret='webhook-secret'): Request {
  return new Request('https://example.workers.dev/telegram/webhook',{
    method: 'POST',
    headers: {'X-Telegram-Bot-Api-Secret-Token':secret,'Content-Type':'application/json'},
    body: JSON.stringify({
      update_id: 101,
      message: {
        message_id:42,
        date:Math.floor(Date.now()/1000),
        text:'/ping',
        chat:{id:chatId,type:chatType},
        from:{id:123,is_bot:false,first_name:'Tester'}
      }
    })
  });
}

function context(): {ctx:ExecutionContext;tasks:Promise<unknown>[]} {
  const tasks:Promise<unknown>[]=[];
  const ctx={waitUntil(p:Promise<unknown>){tasks.push(p);}} as unknown as ExecutionContext;
  return {ctx,tasks};
}

describe('health checks',()=>{
  it('GET /ping returns pong even with no secrets or DB',async()=>{
    const response=await worker.fetch(new Request('https://example.workers.dev/ping'),{} as Env,{} as ExecutionContext);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('pong');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
  it('only matches an exact, unaddressed ping command',()=>{
    expect(isPingCommand('/ping')).toBe(true);
    expect(isPingCommand(' /PING ')).toBe(true);
    expect(isPingCommand('/ping@AnotherBot')).toBe(false);
    expect(isPingCommand('/ping text')).toBe(false);
    expect(isPingCommand('/pingpong')).toBe(false);
    expect(isPingCommand(undefined)).toBe(false);
  });
  it('replies to Telegram /ping in private chat without D1 or OpenAI',async()=>{
    const send=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({ok:true}),{status:200}));
    const env={TELEGRAM_WEBHOOK_SECRET:'webhook-secret',TELEGRAM_BOT_TOKEN:'bot-token'} as Env;
    const {ctx,tasks}=context();
    const response=await worker.fetch(request(1,'private'),env,ctx);
    expect(response.status).toBe(200);
    await Promise.all(tasks);
    expect(send).toHaveBeenCalledOnce();
    const [url,init]=send.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/botbot-token/sendMessage');
    const body=JSON.parse(String((init as RequestInit).body));
    expect(body).toMatchObject({chat_id:1,text:'pong'});
  });
  it('responds in whitelisted group without D1 or OpenAI',async()=>{
    const send=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({ok:true}),{status:200}));
    const env={TELEGRAM_WEBHOOK_SECRET:'webhook-secret',TELEGRAM_BOT_TOKEN:'bot-token',ALLOWED_CHAT_IDS:'-10012'} as Env;
    const {ctx,tasks}=context();
    await worker.fetch(request(-10012,'supergroup'),env,ctx);
    await Promise.all(tasks);
    expect(send).toHaveBeenCalledOnce();
  });
  it('does not respond in disallowed group',async()=>{
    const send=vi.spyOn(globalThis,'fetch');
    const env={TELEGRAM_WEBHOOK_SECRET:'webhook-secret',TELEGRAM_BOT_TOKEN:'bot-token'} as Env;
    const {ctx,tasks}=context();
    await worker.fetch(request(-10012,'supergroup'),env,ctx);
    await Promise.all(tasks);
    expect(send).not.toHaveBeenCalled();
  });
  it('rejects unauthenticated Telegram updates',async()=>{
    const send=vi.spyOn(globalThis,'fetch');
    const env={TELEGRAM_WEBHOOK_SECRET:'webhook-secret',TELEGRAM_BOT_TOKEN:'bot-token'} as Env;
    const {ctx,tasks}=context();
    const response=await worker.fetch(request(1,'private','wrong'),env,ctx);
    await Promise.all(tasks);
    expect(response.status).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });
});
