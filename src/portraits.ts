import type {Voice} from './voices';
import type {SkillCheck} from './skill-check';

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
  'ВОЛЯ':'volition',
  'ЭНЦИКЛОПЕДИЯ':'encyclopedia',
  'ВИЗУАЛЬНАЯ РЕКОНСТРУКЦИЯ':'visual-calculus',
  'ESPRIT DE CORPS':'esprit-de-corps',
  'ВНУШЕНИЕ':'suggestion',
  'СТОЙКОСТЬ':'endurance',
  'БОЛЕВОЙ ПОРОГ':'pain-threshold',
  'ГРУБАЯ СИЛА':'physical-instrument',
  'СУМРАК':'half-light',
  'КООРДИНАЦИЯ':'hand-eye-coordination',
  'ВОСПРИЯТИЕ':'perception-sight',
  'СКОРОСТЬ РЕАКЦИИ':'reaction-speed',
  'ЭКВИЛИБРИСТИКА':'savoir-faire',
  'ТЕХНИКА':'interfacing',
  'САМООБЛАДАНИЕ':'composure'
};

// Telegram downloads these public PNGs from our own repository after deployment.
// Each photo is under Telegram's 5 MB URL-upload limit.
export function portraitUrl(voice:Voice):string {
  return `https://raw.githubusercontent.com/raphickie/disco-elysium-bot/master/assets/portraits/${PORTRAIT_FILES[voice]}.png`;
}

export function formatSkillCaption(voice:Voice,generatedText:string,forcedCheck?:SkillCheck):string {
  const text=generatedText.trim();
  const lines=text.split(/\r?\n/);
  const firstLine=lines[0]??'';
  const match=firstLine.match(/[—–-]\s*\[?(Критический провал|Провал|Успех)\]?/i);
  const status=forcedCheck??match?.[1];
  // Strip any heading invented by the writer, but never discard a genuine
  // first sentence merely because a status was supplied by the application.
  const hasWriterHeading=Boolean(match)||firstLine.startsWith(voice);
  const body=hasWriterHeading?lines.slice(1).join('\n').trim():text;
  const heading=status?`${voice} — ${status}`:voice;
  return `${heading}\n${body}`.trim().slice(0,1024);
}
