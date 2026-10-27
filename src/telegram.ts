import type {Env} from './config';
export type TelegramMessage={
  message_id:number;date:number;text?:string;caption?:string;
  chat:{id:number;type:string};
  from?:{id:number;is_bot?:boolean;first_name?:string;last_name?:string;username?:string};
};
export type TelegramUpdate={update_id:number;message?:TelegramMessage};
export async function sendMessage(env:Env,chatId:number,replyTo:number,text:string):Promise<void>{
  const r=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({chat_id:chatId,text,reply_parameters:{message_id:replyTo,allow_sending_without_reply:true}})
  });
  if(!r.ok)throw Error(`Telegram HTTP ${r.status}`);
  const data=await r.json() as {ok?:boolean};
  if(!data.ok)throw Error('Telegram rejected message');
}
