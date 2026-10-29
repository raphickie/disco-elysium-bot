import {describe,it,expect} from 'vitest';
import {VOICES} from '../src/voices';
import {portraitUrl,formatSkillCaption} from '../src/portraits';

describe('original skill portrait mapping',()=>{
  it('has a unique PNG in our repository for all ten skills',()=>{
    const urls=VOICES.map(voice=>portraitUrl(voice));
    expect(urls).toHaveLength(10);
    expect(new Set(urls).size).toBe(10);
    expect(urls.every(url=>url.startsWith('https://raw.githubusercontent.com/raphickie/disco-elysium-bot/master/assets/portraits/')&&url.endsWith('.png'))).toBe(true);
  });
  it('preserves the writer check status beneath the correct portrait',()=>{
    expect(formatSkillCaption('ЛОГИКА','ЛОГИКА — Успех\nСухой вывод.')).toBe('ЛОГИКА — Успех\nСухой вывод.');
    expect(formatSkillCaption('ДРАМА','ДРАМА — [Критический провал]\nВот так спектакль.')).toBe('ДРАМА — Критический провал\nВот так спектакль.');
    expect(formatSkillCaption('ВОЛЯ','ЛОГИКА — Провал\nСтой крепко.')).toBe('ВОЛЯ — Провал\nСтой крепко.');
  });
  it('does not fabricate a check status when the writer omits it',()=>{
    expect(formatSkillCaption('ТРЕПЕТ','Слышишь этот город?')).toBe('ТРЕПЕТ\nСлышишь этот город?');
  });
  it('respects Telegram photo caption length limit',()=>{
    expect(formatSkillCaption('ВНУТРЕННЯЯ ИМПЕРИЯ','ВНУТРЕННЯЯ ИМПЕРИЯ — Успех\n'+ 'т'.repeat(2000)).length).toBeLessThanOrEqual(1024);
  });
});
