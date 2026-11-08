import type {Voice} from './voices';
import type {TelegramMessage} from './telegram';
import type {ContextMessage} from './generator';

const COMMAND_VOICES={electrochemistry:'ЭЛЕКТРОХИМИЯ',halflight:'СУМРАК'} as const satisfies Record<string,Voice>;
export type VoiceCommand={voice:Voice;target?:string;text:string};

export function parseVoiceCommand(text:string):VoiceCommand|null{
  const match=/^\/(electrochemistry|halflight)(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if(!match)return null;
  const name=match[1].toLowerCase() as keyof typeof COMMAND_VOICES;
  return {voice:COMMAND_VOICES[name],target:match[2],text:(match[3]??'').trim().slice(0,900)};
}

// Commands stay out of stored history. Their text and reply target are transient
// context, placed last so the writer can focus on the explicitly selected topic.
export function voiceCommandContext(history:ContextMessage[],m:TelegramMessage,command:VoiceCommand,limit:number):ContextMessage[]{
  const context=[...history];
  const add=(message:TelegramMessage,text:string)=>{
    const body=text.trim().slice(0,900);
    if(!body)return;
    const author=[message.from?.first_name,message.from?.last_name].filter(Boolean).join(' ').slice(0,60)
      ||message.from?.username?.slice(0,60)||'Аноним';
    context.push({author,body,user_id:message.from?.id??0});
  };
  if(m.reply_to_message)add(m.reply_to_message,m.reply_to_message.text??m.reply_to_message.caption??'');
  add(m,command.text);
  return context.slice(-limit);
}
