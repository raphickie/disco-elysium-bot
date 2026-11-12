import {describe,it,expect} from 'vitest';
import {rollSkillCheck,SKILL_CHECK_PROBABILITIES,skillCheckDirection} from '../src/skill-check';

describe('Disco Elysium skill checks',()=>{
  it('uses 70/25/5 probabilities and exact boundaries',()=>{
    expect(SKILL_CHECK_PROBABILITIES).toEqual({'Успех':70,'Провал':25,'Критический провал':5});
    expect(Object.values(SKILL_CHECK_PROBABILITIES).reduce((sum,n)=>sum+n,0)).toBe(100);
    expect(rollSkillCheck(()=>0)).toBe('Успех');
    expect(rollSkillCheck(()=>0.699999)).toBe('Успех');
    expect(rollSkillCheck(()=>0.7)).toBe('Провал');
    expect(rollSkillCheck(()=>0.949999)).toBe('Провал');
    expect(rollSkillCheck(()=>0.95)).toBe('Критический провал');
    expect(rollSkillCheck(()=>0.999999)).toBe('Критический провал');
  });

  it('produces exactly the specified proportions over a uniformly spaced sample',()=>{
    const counts=new Map([['Успех',0],['Провал',0],['Критический провал',0]]);
    for(let i=0;i<10000;i++){
      const check=rollSkillCheck(()=>(i+0.5)/10000);
      counts.set(check,(counts.get(check)??0)+1);
    }
    expect([...counts.values()]).toEqual([7000,2500,500]);
  });

  it('rejects invalid random values rather than assigning a misleading check',()=>{
    for(const value of [-0.1,1,NaN,Infinity])
      expect(()=>rollSkillCheck(()=>value)).toThrow('Invalid skill check roll');
  });

  it('changes the interpretation requested of the writer, not merely its title',()=>{
    expect(skillCheckDirection('Успех')).toContain('точное');
    expect(skillCheckDirection('Провал')).toContain('ошибочно');
    expect(skillCheckDirection('Критический провал')).toContain('грандиозный');
    expect(skillCheckDirection('Критический провал')).toContain('фантазия');
  });
});
