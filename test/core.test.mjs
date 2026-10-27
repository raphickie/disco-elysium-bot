import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig, parseAllowedChats, settingsForChat } from '../dist/src/config.js';
import { normaliseMessage, isConversationReady, shouldRollReply, utcKeys } from '../dist/src/context.js';
import { reservedMicroUsd, actualMicroUsd, usdToMicroUsd } from '../dist/src/budget.js';
import { pickVoice, pickCheck, telegramReply, conversationInput } from '../dist/src/prompt.js';
import { requestOpenAiBody, generateResponse, sendTelegramMessage } from '../dist/src/clients.js';

const config = readConfig({});
const telegramMessage = (from = 7) => ({
  message_id: 101, date: 1730000000,
  chat: { id: -100123456789, type: 'supergroup' },
  from: { id: from, first_name: 'Ник', is_bot: false },
  text: 'Ужасно.   Опять всё сломалось.',
});

test('whitelist defaults closed; invalid chat ids are rejected', () => {
  assert.equal(config.whitelistEnabled, true);
  assert.equal(config.allowedChats.size, 0);
  assert.deepEqual([...parseAllowedChats('-100, -200, -100')], ['-100', '-200']);
  assert.throws(() => parseAllowedChats('123;echo bad'), /Invalid chat ID/);
  assert.equal(readConfig({WHITELIST_ENABLED:'false'}).whitelistEnabled, false);
  assert.throws(() => readConfig({REPLY_PERCENT:'101'}), /Invalid REPLY_PERCENT/);
  assert.throws(() => readConfig({OPENAI_MODEL:'different-model'}), /explicitly set both/);
});

test('per-chat overrides take effect without changing global/whitelist policy', () => {
  const c = readConfig({REPLY_PERCENT:'10', CHAT_DAILY_LIMIT_USD:'0.5'});
  const amended = settingsForChat(c, {
    enabled: 1, reply_percent: 3.5, chat_daily_limit_usd: 0.02,
    chat_monthly_limit_usd: null, cooldown_seconds: 99,
  });
  assert.equal(amended.replyPercent, 3.5);
  assert.equal(amended.chatDailyLimitUsd, 0.02);
  assert.equal(amended.cooldownSeconds, 99);
  assert.equal(amended.chatMonthlyLimitUsd, c.chatMonthlyLimitUsd);
  assert.equal(settingsForChat(c, {enabled: 0, reply_percent: null, chat_daily_limit_usd: null,
    chat_monthly_limit_usd: null, cooldown_seconds: null}).botEnabled, false);
});

test('only real group chat text is stored and normalised; bots/services skipped', () => {
  assert.deepEqual(normaliseMessage(telegramMessage(), config), {
    chat_id:'-100123456789', message_id:101, telegram_user_id:'7',
    author:'Ник', body:'Ужасно. Опять всё сломалось.', sent_at:1730000000,
  });
  assert.equal(normaliseMessage({...telegramMessage(), from:{id:7,is_bot:true}},config),null);
  assert.equal(normaliseMessage({...telegramMessage(), new_chat_members:[{}]},config),null);
  assert.equal(normaliseMessage({...telegramMessage(), chat:{id:7,type:'private'}},config),null);
  assert.equal(normaliseMessage({...telegramMessage(), text:'   '},config),null);
});

test('roll probability and active discussion thresholds', () => {
  assert.equal(shouldRollReply(0, () => 0),false);
  assert.equal(shouldRollReply(100, () => 0.9999),true);
  assert.equal(shouldRollReply(1, () => 0.005),true);
  assert.equal(shouldRollReply(1, () => 0.01),false);
  const m=normaliseMessage(telegramMessage(),config);
  assert.equal(isConversationReady([m,m,m,m],config),false);
  assert.equal(isConversationReady([m,m,{...m,telegram_user_id:'8'},m],config),true);
  assert.equal(utcKeys(Date.UTC(2026,9,27)/1000).day,'2026-10-27');
});

test('voice formatting is original, short and context-aware', () => {
  const voice=pickVoice(() => 0);
  assert.equal(voice.name,'ВНУТРЕННЯЯ ИМПЕРИЯ');
  assert.equal(pickCheck(() => 0.01),'Критический провал');
  const message=normaliseMessage(telegramMessage(),config);
  const input=conversationInput([message],voice,'Провал');
  assert.match(input,/Опять всё сломалось/);
  const reply=telegramReply(voice,'Провал','Человек ищет смысл. Находит баги.',160);
  assert.match(reply,/ВНУТРЕННЯЯ ИМПЕРИЯ — \[Провал\]/);
});

test('pessimistic budget is positive, bounded by configuration, actual usage measured', () => {
  const body=requestOpenAiBody(config,'Внутренний голос','Привет, мир');
  const parsed=JSON.parse(body);
  assert.equal(parsed.model,'gpt-6-luna');
  assert.equal(parsed.store,false);
  assert.equal(parsed.max_output_tokens,220);
  assert.equal(parsed.reasoning.effort,'none');
  const pessimistic=reservedMicroUsd(body,config);
  assert.ok(pessimistic>0);
  assert.ok(actualMicroUsd(90,70,config)<pessimistic);
  assert.equal(usdToMicroUsd(0.05),50000);
});

test('mock OpenAI response + Telegram transport (no real API calls)', async () => {
  const body=requestOpenAiBody(config,'Be funny','Two people are fighting over tea');
  let telegramBody;
  const mockFetch=async (url,options) => {
    if (url.includes('openai.com')) return Response.json({
      output:[{type:'message',content:[{type:'output_text',text:'Теперь чай — это геополитика.'}]}],
      usage:{input_tokens:50,output_tokens:80},
    });
    telegramBody=JSON.parse(options.body);
    return Response.json({ok:true,result:{message_id:7}});
  };
  const generated=await generateResponse({OPENAI_API_KEY:'test'},config,body,mockFetch);
  assert.equal(generated.text,'Теперь чай — это геополитика.');
  assert.equal(generated.inputTokens,50);
  assert.ok(generated.actualMicroUsd>0);
  await sendTelegramMessage({TELEGRAM_BOT_TOKEN:'test'},'-100','HELLO',mockFetch);
  assert.deepEqual(telegramBody,{chat_id:'-100',text:'HELLO',disable_notification:true});
});
