export type ProbabilityCommand =
  | {kind:'show';target?:string}
  | {kind:'set';value:number;target?:string}
  | {kind:'reset';target?:string}
  | {kind:'invalid';message:string;target?:string};

export function parseProbabilityCommand(text:string):ProbabilityCommand|null {
  const match=/^\/reply_percent(?:@([A-Za-z0-9_]+))?(?:\s+(.+))?$/i.exec(text.trim());
  if(!match)return null;
  const target=match[1];
  const argument=match[2]?.trim();
  if(!argument)return {kind:'show',target};
  if(argument.toLowerCase()==='reset')return {kind:'reset',target};
  if(!/^\d{1,3}(?:\.\d{1,2})?$/.test(argument))
    return {kind:'invalid',message:'Используй /reply_percent <0–100> или /reply_percent reset. Можно указать до двух знаков после точки.',target};
  const value=Number(argument);
  if(value<0||value>100)
    return {kind:'invalid',message:'Вероятность должна быть от 0 до 100%.',target};
  return {kind:'set',value,target};
}
