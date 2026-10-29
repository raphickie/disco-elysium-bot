import type {Voice} from './voices';

// Original game portraits, copied to assets/portraits/ (see README for attribution).
const PORTRAIT_FILES:Record<Voice,string>={
  'ВНУТРЕННЯЯ ИМПЕРИЯ':'inland-empire',
  'ТРЕПЕТ':'shivers',
  'ЭЛЕКТРОХИМИЯ':'electrochemistry',
  'ЛОГИКА':'logic',
  'ЭМПАТИЯ':'empathy',
  'АВТОРИТЕТ':'authority',
  'КОНЦЕПТУАЛИЗАЦИЯ':'conceptualization',
  'ДРАМА':'drama',
  'РИТОРИКА':'rhetoric',
  'ВОЛЯ':'volition'
};

// Telegram downloads these public PNGs from our own repository after deployment.
// Each photo is under Telegram's 5 MB URL-upload limit.
export function portraitUrl(voice:Voice):string {
  return `https://raw.githubusercontent.com/raphickie/disco-elysium-bot/master/assets/portraits/${PORTRAIT_FILES[voice]}.png`;
}

export function formatSkillCaption(voice:Voice,generatedText:string):string {
  const text=generatedText.trim();
  const lines=text.split(/\r?\n/);
  const firstLine=lines[0]??'';
  const match=firstLine.match(/[—–-]\s*\[?(Критический провал|Провал|Успех)\]?/i);
  const status=match?.[1];
  // The writer usually supplies "VOICE — STATUS" itself. Rebuild the heading from
  // the actual director-selected voice so an LLM typo cannot use another portrait name.
  const body=(status || firstLine.startsWith(voice))?lines.slice(1).join('\n').trim():text;
  const heading=status?`${voice} — ${status}`:voice;
  return `${heading}\n${body}`.trim().slice(0,1024);
}
