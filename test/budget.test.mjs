import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { readConfig } from '../dist/src/config.js';
import { CLAIM_SQL, claimParameters, actualMicroUsd } from '../dist/src/budget.js';

const migration=readFileSync(new URL('../migrations/0001_initial.sql',import.meta.url),'utf8');
const now=Math.floor(Date.UTC(2026,9,27,19,0,0)/1000);

function fixture() {
  const db=new DatabaseSync(':memory:');
  db.exec(migration);
  const stmt=db.prepare(CLAIM_SQL);
  return {
    db,
    claim(chatId,messageId,at,config, reserve=550) {
      return stmt.run(...claimParameters({chatId,messageId,now:at,reserveMicroUsd:reserve,skill:'ЭМПАТИЯ',config})).changes===1;
    },
  };
}

test('SQL schema accepts unique messages and ledger entries', () => {
  const {db}=fixture();
  db.prepare('INSERT OR IGNORE INTO chat_messages VALUES(?,?,?,?,?,?)').run('-100',1,'7','Имя','Привет',now);
  assert.equal(db.prepare('SELECT count(*) as c FROM chat_messages').get().c,1);
  db.prepare('INSERT OR IGNORE INTO chat_messages VALUES(?,?,?,?,?,?)').run('-100',1,'7','Имя','Привет',now);
  assert.equal(db.prepare('SELECT count(*) as c FROM chat_messages').get().c,1);
  db.close();
});

test('cooldown and deduplication apply across independent writes', () => {
  const {db,claim}=fixture();
  const cfg=readConfig({COOLDOWN_SECONDS:'600'});
  assert.equal(claim('-100',1,now,cfg),true);
  assert.equal(claim('-100',1,now+660,cfg),false);
  assert.equal(claim('-100',2,now+10,cfg),false);
  assert.equal(claim('-100',2,now+660,cfg),true);
  db.close();
});

test('per-chat daily cost cap isolates chats but global daily cap limits all', () => {
  const {db,claim}=fixture();
  const cfg=readConfig({COOLDOWN_SECONDS:'0',CHAT_DAILY_LIMIT_USD:'0.001',GLOBAL_DAILY_LIMIT_USD:'0.0015'});
  assert.equal(claim('-100',1,now,cfg),true); // reserved 550 microUSD
  assert.equal(claim('-100',2,now+1,cfg),false); // > 1000 local cap
  assert.equal(claim('-200',1,now+1,cfg),true);
  assert.equal(claim('-300',1,now+2,cfg),false); // global 1650 > 1500
  db.close();
});

test('per-chat monthly cap and max daily replies enforce hard cutoffs', () => {
  const {db,claim}=fixture();
  const cfg=readConfig({COOLDOWN_SECONDS:'0',MAX_DAILY_REPLIES_PER_CHAT:'2',CHAT_MONTHLY_LIMIT_USD:'0.0017'});
  assert.equal(claim('-100',1,now,cfg),true);
  assert.equal(claim('-100',2,now+1,cfg),true);
  assert.equal(claim('-100',3,now+2,cfg),false); // count 2 reached
  assert.equal(claim('-100',4,now+86400,cfg),true); // month 1650 < 1700
  assert.equal(claim('-100',5,now+86400+1,cfg),false); // month > 1700
  db.close();
});

test('actual usage replaces reserved allowance on successful result', () => {
  const {db,claim}=fixture();
  const cfg=readConfig({COOLDOWN_SECONDS:'0',CHAT_DAILY_LIMIT_USD:'0.001'});
  assert.equal(claim('-100',1,now,cfg),true);
  const cost=actualMicroUsd(100,50,cfg);
  assert.ok(cost<550);
  db.prepare('UPDATE generation_attempts SET actual_micro_usd = ?, status = ? WHERE chat_id = ? AND trigger_message_id = ?')
    .run(cost,'sent','-100',1);
  assert.equal(claim('-100',2,now+1,cfg),true); // actual+550 <= 1000
  db.close();
});
