import {describe,it,expect} from 'vitest';
import {VOICES} from '../src/voices';
import {portraitUrl,formatSkillCaption} from '../src/portraits';

describe('original skill portrait mapping',()=>{
  it('has a unique PNG in our repository for all 24 skills',()=>{
    const urls=VOICES.map(voice=>portraitUrl(voice));
    expect(urls).toHaveLength(24);
    expect(new Set(urls).size).toBe(24);
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
  it('enforces the check selected by code even when the writer disagrees',()=>{
    expect(formatSkillCaption('ЛОГИКА','ЛОГИКА — Успех\nВот мой вывод.','Провал'))
      .toBe('ЛОГИКА — Провал\nВот мой вывод.');
    expect(formatSkillCaption('ДРАМА','ДРАМА — Успех\nМессир, это катастрофа.','Критический провал'))
      .toBe('ДРАМА — Критический провал\nМессир, это катастрофа.');
    expect(formatSkillCaption('ВОЛЯ','Ты ещё можешь продолжать.','Успех'))
      .toBe('ВОЛЯ — Успех\nТы ещё можешь продолжать.');
    expect(formatSkillCaption('РИТОРИКА','РИТОРИКА — Провал\nЭто же чистая демагогия.','Успех'))
      .toBe('РИТОРИКА — Успех\nЭто же чистая демагогия.');
  });
  it('respects Telegram photo caption length limit',()=>{
    expect(formatSkillCaption('ВНУТРЕННЯЯ ИМПЕРИЯ','ВНУТРЕННЯЯ ИМПЕРИЯ — Успех\n'+ 'т'.repeat(2000)).length).toBeLessThanOrEqual(1024);
  });
});
