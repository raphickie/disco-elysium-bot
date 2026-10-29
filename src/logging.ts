import type {TelegramMessage} from './telegram';

type Detail=string|number|boolean|readonly string[]|undefined;

// One compact, searchable record per processed message. Never log chat text or tokens.
export function logReply(m:TelegramMessage,outcome:string,details:Record<string,Detail>={}):void{
  console.info(JSON.stringify({event:'reply_decision',chat_id:m.chat.id,message_id:m.message_id,outcome,...details}));
}

export function errorCode(error:unknown):string{
  const message=error instanceof Error?error.message:'';
  const http=/^(LLM|Telegram) HTTP (\d{3})$/.exec(message);
  if(http)return `${http[1].toLowerCase()}_http_${http[2]}`;
  if(message.includes('reserve'))return 'reserve_exceeded';
  if(message.includes('copied a game reference'))return 'copied_reference';
  return error instanceof Error?error.name:'unknown';
}
