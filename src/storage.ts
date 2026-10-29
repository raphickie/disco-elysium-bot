import type {Settings} from './config';
import type {TelegramMessage} from './telegram';
import type {ContextMessage} from './generator';
import {DEFAULT_CONTEXT_MESSAGES,MAX_CONTEXT_MESSAGES} from './context';

export async function replyProbability(db:D1Database,chatId:number,fallback:number):Promise<number>{
  const row=await db.prepare('SELECT reply_percent FROM chat_settings WHERE chat_id=?')
    .bind(chatId).first<{reply_percent:number|null}>();
  return row?.reply_percent??fallback;
}

export async function setReplyProbability(db:D1Database,chatId:number,value:number,now:number):Promise<void>{
  if(!Number.isFinite(value)||value<0||value>100)throw Error('Invalid reply probability');
  await db.prepare(`INSERT INTO chat_settings(chat_id,context_messages,reply_percent,updated_at)
    VALUES(?,?,?,?) ON CONFLICT(chat_id) DO UPDATE SET
    reply_percent=excluded.reply_percent,updated_at=excluded.updated_at`)
    .bind(chatId,DEFAULT_CONTEXT_MESSAGES,value,now).run();
}

export async function resetReplyProbability(db:D1Database,chatId:number,now:number):Promise<void>{
  await db.prepare('UPDATE chat_settings SET reply_percent=NULL,updated_at=? WHERE chat_id=?')
    .bind(now,chatId).run();
}

export async function store(db:D1Database,updateId:number,m:TelegramMessage):Promise<boolean>{
  const name=[m.from?.first_name,m.from?.last_name].filter(Boolean).join(' ').slice(0,60) || m.from?.username?.slice(0,60) || 'Аноним';
  const body=(m.text??m.caption??'').slice(0,900).trim();
  const result=await db.prepare(
    'INSERT OR IGNORE INTO messages(chat_id,message_id,update_id,user_id,author,body,created_at) VALUES(?,?,?,?,?,?,?)'
  ).bind(m.chat.id,m.message_id,updateId,m.from!.id,name,body,m.date).run();
  return result.meta.changes===1;
}

export async function contextMessageLimit(db:D1Database,chatId:number):Promise<number>{
  const row=await db.prepare('SELECT context_messages FROM chat_settings WHERE chat_id=?')
    .bind(chatId).first<{context_messages:number}>();
  return row?.context_messages??DEFAULT_CONTEXT_MESSAGES;
}

export async function setContextMessageLimit(db:D1Database,chatId:number,limit:number,now:number):Promise<void>{
  if(!Number.isInteger(limit)||limit<3||limit>MAX_CONTEXT_MESSAGES)
    throw Error('Invalid context message limit');
  await db.prepare(`INSERT INTO chat_settings(chat_id,context_messages,updated_at)
    VALUES(?,?,?) ON CONFLICT(chat_id) DO UPDATE SET
    context_messages=excluded.context_messages,updated_at=excluded.updated_at`)
    .bind(chatId,limit,now).run();
}

export async function recent(db:D1Database,chatId:number,s:Settings,now:number,limit:number):Promise<ContextMessage[]>{
  const result=await db.prepare(
    'SELECT author,body,user_id FROM messages WHERE chat_id=? AND created_at>=? ORDER BY created_at DESC,message_id DESC LIMIT ?'
  ).bind(chatId,now-s.contextWindow,limit).all<ContextMessage>();
  return result.results.reverse();
}

export function conversational(messages:ContextMessage[]):boolean{
  return messages.length>=3 && new Set(messages.map(m=>m.user_id)).size>=2;
}

function dateKeys(now:number):{day:string;month:string}{
  const iso=new Date(now*1000).toISOString();
  return {day:iso.slice(0,10),month:iso.slice(0,7)};
}

// The claim is ONE atomic SQL statement. SQLite serializes competing writes.
// A partial unique index prevents simultaneous generations for the same chat.
// Budget checks include pending reservations so concurrent chats cannot overspend.
export async function claim(
  db:D1Database,chatId:number,messageId:number,now:number,s:Settings,ignoreCooldown=false
):Promise<number|null>{
  const {day,month}=dateKeys(now);
  const sql=`
INSERT OR IGNORE INTO reply_attempts(chat_id,message_id,created_at,day_key,month_key,status,reserved_usd,actual_usd)
SELECT ?,?,?,?,?,'pending',?,0
WHERE (?=1 OR NOT EXISTS(
  SELECT 1 FROM reply_attempts
  WHERE chat_id=? AND status='sent' AND created_at>?
))
AND (SELECT COALESCE(SUM(CASE WHEN status='pending' THEN reserved_usd ELSE actual_usd END),0)
     FROM reply_attempts WHERE chat_id=? AND day_key=?) + ? <= ?
AND (SELECT COALESCE(SUM(CASE WHEN status='pending' THEN reserved_usd ELSE actual_usd END),0)
     FROM reply_attempts WHERE chat_id=? AND month_key=?) + ? <= ?
AND (SELECT COALESCE(SUM(CASE WHEN status='pending' THEN reserved_usd ELSE actual_usd END),0)
     FROM reply_attempts WHERE day_key=?) + ? <= ?
AND (SELECT COALESCE(SUM(CASE WHEN status='pending' THEN reserved_usd ELSE actual_usd END),0)
     FROM reply_attempts WHERE month_key=?) + ? <= ?
RETURNING id`;
  try {
    const row=await db.prepare(sql).bind(
      chatId,messageId,now,day,month,s.reserve,
      ignoreCooldown?1:0,chatId,now-s.cooldown,
      chatId,day,s.reserve,s.chatDaily,
      chatId,month,s.reserve,s.chatMonthly,
      day,s.reserve,s.globalDaily,
      month,s.reserve,s.globalMonthly
    ).first<{id:number}>();
    return row?.id??null;
  }catch(e){
    // A partial unique index can reject concurrent claims from the same chat.
    if(String(e).includes('UNIQUE constraint failed'))return null;
    throw e;
  }
}

export type ClaimRejectionReason=
  'duplicate'|'already_generating'|'cooldown'|'chat_daily_budget'|'chat_monthly_budget'|
  'global_daily_budget'|'global_monthly_budget'|'unknown';

// Read-only diagnosis after the atomic claim rejects. A race may change the state
// between the claim and this query, so "unknown" remains a valid result.
export async function diagnoseClaimRejection(
  db:D1Database,chatId:number,messageId:number,now:number,s:Settings,ignoreCooldown:boolean
):Promise<ClaimRejectionReason>{
  const {day,month}=dateKeys(now);
  const row=await db.prepare(`SELECT
    (SELECT COUNT(*) FROM reply_attempts WHERE chat_id=? AND message_id=?) AS duplicate_count,
    (SELECT COUNT(*) FROM reply_attempts WHERE chat_id=? AND status='pending') AS pending_count,
    (SELECT COUNT(*) FROM reply_attempts WHERE chat_id=? AND status='sent' AND created_at>?) AS cooldown_count,
    (SELECT COALESCE(SUM(CASE WHEN status='pending' THEN reserved_usd ELSE actual_usd END),0) FROM reply_attempts WHERE chat_id=? AND day_key=?) AS chat_day_usd,
    (SELECT COALESCE(SUM(CASE WHEN status='pending' THEN reserved_usd ELSE actual_usd END),0) FROM reply_attempts WHERE chat_id=? AND month_key=?) AS chat_month_usd,
    (SELECT COALESCE(SUM(CASE WHEN status='pending' THEN reserved_usd ELSE actual_usd END),0) FROM reply_attempts WHERE day_key=?) AS global_day_usd,
    (SELECT COALESCE(SUM(CASE WHEN status='pending' THEN reserved_usd ELSE actual_usd END),0) FROM reply_attempts WHERE month_key=?) AS global_month_usd`)
    .bind(chatId,messageId,chatId,chatId,now-s.cooldown,chatId,day,chatId,month,day,month)
    .first<{
      duplicate_count:number;pending_count:number;cooldown_count:number;
      chat_day_usd:number;chat_month_usd:number;global_day_usd:number;global_month_usd:number;
    }>();
  if(!row)return 'unknown';
  if(row.duplicate_count>0)return 'duplicate';
  if(row.pending_count>0)return 'already_generating';
  if(!ignoreCooldown&&row.cooldown_count>0)return 'cooldown';
  if(row.chat_day_usd+s.reserve>s.chatDaily)return 'chat_daily_budget';
  if(row.chat_month_usd+s.reserve>s.chatMonthly)return 'chat_monthly_budget';
  if(row.global_day_usd+s.reserve>s.globalDaily)return 'global_daily_budget';
  if(row.global_month_usd+s.reserve>s.globalMonthly)return 'global_monthly_budget';
  return 'unknown';
}

export async function settle(db:D1Database,id:number,status:'sent'|'failed',cost:number):Promise<void>{
  await db.prepare(
    'UPDATE reply_attempts SET status=?,actual_usd=? WHERE id=? AND status=?'
  ).bind(status,Math.max(0,cost),id,'pending').run();
}

export async function cleanup(db:D1Database,now:number,hours:number):Promise<void>{
  // Failed/expired pending reservations release their unused budget.
  await db.prepare(
    "UPDATE reply_attempts SET status='failed' WHERE status='pending' AND created_at<?"
  ).bind(now-600).run();
  await db.prepare('DELETE FROM messages WHERE created_at<?').bind(now-hours*3600).run();
  await db.prepare("DELETE FROM reply_attempts WHERE created_at<? AND status!='pending'").bind(now-90*86400).run();
}
