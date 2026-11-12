// Disco Elysium-inspired skill checks. The outcome is drawn independently
// of the selected voice and before the writer is asked to compose a reply.
export type SkillCheck='Успех'|'Провал'|'Критический провал';

export const SKILL_CHECK_PROBABILITIES={
  'Успех':70,
  'Провал':25,
  'Критический провал':5
} as const satisfies Record<SkillCheck,number>;

export function rollSkillCheck(random:()=>number=Math.random):SkillCheck{
  const roll=random();
  if(!Number.isFinite(roll)||roll<0||roll>=1)throw Error('Invalid skill check roll');
  if(roll<SKILL_CHECK_PROBABILITIES['Успех']/100)return 'Успех';
  if(roll<(SKILL_CHECK_PROBABILITIES['Успех']+SKILL_CHECK_PROBABILITIES['Провал'])/100)return 'Провал';
  return 'Критический провал';
}

export function skillCheckDirection(check:SkillCheck):string{
  switch(check){
    case 'Успех':
      return 'ПРОВЕРКА УСПЕШНА: навык замечает что-то точное, неожиданное и уместное. Его вывод может быть язвительным или странным, но опирается на реальные детали беседы.';
    case 'Провал':
      return 'ПРОВЕРКА ПРОВАЛЕНА: навык добросовестно, но ошибочно интерпретирует одну деталь разговора. Пусть эта небольшая ошибка меняет смысл мысли и создаёт комедийный поворот. Голос уверен в своей версии; не превращай провал в просто плохой или скучный ответ.';
    case 'Критический провал':
      return 'КРИТИЧЕСКИЙ ПРОВАЛ: навык уверенно делает грандиозный, нелепый, преувеличенный вывод из мелочи. Развивай абсурд в духе персонажа, а не просто поставь соответствующий заголовок. Ясно показывай, что это фантазия внутреннего голоса, а не реальные факты или обвинения в адрес участников.';
  }
}
