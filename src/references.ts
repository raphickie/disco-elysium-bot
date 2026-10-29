import {VOICE_REFERENCES,type VoiceReference} from './voice-references';
import type {Voice} from './voices';

function stems(value:string):Set<string>{
  return new Set((value.toLowerCase().match(/[а-яёa-z0-9]{4,}/g)??[]).map(word=>word.slice(0,5)));
}

function hash(value:string):number{
  let result=2166136261;
  for(let i=0;i<value.length;i++)result=Math.imul(result^value.charCodeAt(i),16777619);
  return result>>>0;
}

export function selectReferences(voice:Voice,query:string,count=5):VoiceReference[]{
  const source=VOICE_REFERENCES[voice];
  if(!source || source.items.length<count)throw Error(`Missing voice references: ${voice}`);
  const terms=stems(query);
  const score=(ref:VoiceReference)=>{
    const tagMatches=[...stems(ref.tags)].filter(term=>terms.has(term)).length;
    const textMatches=[...stems(ref.text)].filter(term=>terms.has(term)).length;
    return tagMatches*4+textMatches;
  };
  return [...source.items].sort((a,b)=>score(b)-score(a)||hash(`${query}:${b.line}`)-hash(`${query}:${a.line}`)).slice(0,count);
}

export function referencePrompt(voice:Voice,refs:VoiceReference[]):string{
  const source=VOICE_REFERENCES[voice].source;
  return refs.map((ref,i)=>`${i+1}. [${source}:${ref.line}] «${ref.text}»`).join('\n');
}

function words(value:string):string[]{
  return (value.toLowerCase().replace(/\*/g,'').match(/[а-яёa-z0-9]+/g)??[]);
}

export function copiesReference(reply:string,refs:VoiceReference[]):boolean{
  const output=words(reply).join(' ');
  return refs.some(ref=>{
    const quoted=words(ref.text);
    const window=Math.min(7,quoted.length);
    if(window<4)return false;
    for(let i=0;i<=quoted.length-window;i++)
      if(output.includes(quoted.slice(i,i+window).join(' ')))return true;
    return false;
  });
}
