import type {Voice} from './voices';
import {isBareBotMention,type TelegramMessage} from './telegram';
import type {ContextMessage} from './generator';

const COMMAND_VOICES={
  inlandempire:'ВНУТРЕННЯЯ ИМПЕРИЯ',
  shivers:'ТРЕПЕТ',
  electrochemistry:'ЭЛЕКТРОХИМИЯ',
  logic:'ЛОГИКА',
  empathy:'ЭМПАТИЯ',
  authority:'АВТОРИТЕТ',
  conceptualization:'КОНЦЕПТУАЛИЗАЦИЯ',
  drama:'ДРАМА',
  rhetoric:'РИТОРИКА',
  volition:'ВОЛЯ',
  encyclopedia:'ЭНЦИКЛОПЕДИЯ',
  visualcalculus:'ВИЗУАЛЬНАЯ РЕКОНСТРУКЦИЯ',
  espritdecorps:'ESPRIT DE CORPS',
  suggestion:'ВНУШЕНИЕ',
  endurance:'СТОЙКОСТЬ',
  painthreshold:'БОЛЕВОЙ ПОРОГ',
  physicalinstrument:'ГРУБАЯ СИЛА',
  halflight:'СУМРАК',
  handeyecoordination:'КООРДИНАЦИЯ',
  perception:'ВОСПРИЯТИЕ',
  reactionspeed:'СКОРОСТЬ РЕАКЦИИ',
  savoirfaire:'ЭКВИЛИБРИСТИКА',
  interfacing:'ТЕХНИКА',
  composure:'САМООБЛАДАНИЕ'
} as const satisfies Record<string,Voice>;
export type VoiceCommand={voice:Voice;target?:string;text:string};

export function parseVoiceCommand(text:string):VoiceCommand|null{
  const match=/^\/([a-z0-9_]{1,32})(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if(!match||!Object.hasOwn(COMMAND_VOICES,match[1].toLowerCase()))return null;
  const name=match[1].toLowerCase() as keyof typeof COMMAND_VOICES;
  return {voice:COMMAND_VOICES[name],target:match[2],text:(match[3]??'').trim().slice(0,900)};
}

// A Telegram reply is used as focus only if it is a real human message.
function humanMessage(m:TelegramMessage,rawText:string):ContextMessage|null{
  const body=rawText.trim().slice(0,900);
  if(!body || m.from?.is_bot || isBareBotMention(body))return null;
  const author=[m.from?.first_name,m.from?.last_name].filter(Boolean).join(' ').slice(0,60)
    ||m.from?.username?.slice(0,60)||'Аноним';
  return {author,body,user_id:m.from?.id??0};
}

// Put the selected human message last, so a bare trigger doesn't become the focus.
// Historical bare bot mentions are ignored as well.
export function focusedHumanContext(history:ContextMessage[],m:TelegramMessage,limit:number,older?:ContextMessage|null):ContextMessage[]{
  const context=history.filter(message=>message.body.trim()&&!isBareBotMention(message.body));
  const target=m.reply_to_message;
  const reply=target?humanMessage(target,target.text??target.caption??''):null;
  if(reply)context.push(reply);
  else if(context.length===0 && older && older.body.trim()&&!isBareBotMention(older.body))context.push(older);
  return context.slice(-limit);
}

// Commands stay out of stored history. Explicit command text is always the focus;
// bare commands instead focus on the previous human message, not a bot reply.
export function voiceCommandContext(history:ContextMessage[],m:TelegramMessage,command:VoiceCommand,limit:number,older?:ContextMessage|null):ContextMessage[]{
  const context=focusedHumanContext(history,m,limit,older);
  if(command.text){
    const inline=humanMessage(m,command.text);
    if(inline)context.push(inline);
  }
  return context.slice(-limit);
}
