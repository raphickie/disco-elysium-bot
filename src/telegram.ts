import type {Env} from './config';
export type TelegramMessage={
  message_id:number;date:number;text?:string;caption?:string;
  chat:{id:number;type:string};
  from?:{id:number;is_bot?:boolean;first_name?:string;last_name?:string;username?:string};
};
export type TelegramUpdate={update_id:number;message?:TelegramMessage};

// Only handle the exact command; never react to a command addressed to another bot.
export function isPingCommand(text:string|undefined):boolean {
  return typeof text==='string' && text.trim().toLowerCase()==='/ping';
}
export function mentionsBot(text:string|undefined):boolean {
  return typeof text==='string' && /(^|[^A-Za-z0-9_@])@DiscoElysiumPersBot(?![A-Za-z0-9_])/i.test(text);
}
export async function commandTargetsBot(env:Env,target?:string):Promise<boolean>{
  if(!target)return true;
  const r=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getMe`);
  if(!r.ok)throw Error(`Telegram getMe HTTP ${r.status}`);
  const data=await r.json() as {ok?:boolean;result?:{username?:string}};
  if(!data.ok||!data.result?.username)throw Error('Telegram getMe failed');
  return data.result.username.toLowerCase()===target.toLowerCase();
}

export async function isChatAdmin(env:Env,chatId:number,userId:number):Promise<boolean>{
  const r=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getChatMember`,{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({chat_id:chatId,user_id:userId})
  });
  if(!r.ok)throw Error(`Telegram getChatMember HTTP ${r.status}`);
  const data=await r.json() as {ok?:boolean;result?:{status?:string}};
  if(!data.ok||!data.result?.status)throw Error('Telegram getChatMember failed');
  return data.result.status==='creator'||data.result.status==='administrator';
}

export async function sendMessage(env:Env,chatId:number,replyTo:number,text:string):Promise<void>{
  const r=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({chat_id:chatId,text,reply_parameters:{message_id:replyTo,allow_sending_without_reply:true}})
  });
  if(!r.ok)throw Error(`Telegram HTTP ${r.status}`);
  const data=await r.json() as {ok?:boolean};
  if(!data.ok)throw Error('Telegram rejected message');
}
