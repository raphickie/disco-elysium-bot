export const DEFAULT_CONTEXT_MESSAGES = 30;
export const MAX_CONTEXT_MESSAGES = 70;

export type ContextCommand =
  | {kind:'show';target?:string}
  | {kind:'set';value:number;target?:string}
  | {kind:'invalid';message:string;target?:string};

export function parseContextCommand(text:string):ContextCommand|null {
  const match=/^\/context_messages(?:@([A-Za-z0-9_]+))?(?:\s+(.+))?$/i.exec(text.trim());
  if(!match)return null;
  const target=match[1];
  const argument=match[2]?.trim();
  if(!argument)return {kind:'show',target};
  if(!/^\d+$/.test(argument))
    return {kind:'invalid',message:'Используй /context_messages <число от 3 до 70>.',target};
  const value=Number(argument);
  if(!Number.isSafeInteger(value)||value<3||value>MAX_CONTEXT_MESSAGES)
    return {kind:'invalid',message:'Можно установить от 3 до 70 сообщений. Больше 70 нельзя.',target};
  return {kind:'set',value,target};
}
