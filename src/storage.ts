import type {Settings} from './config';
import type {TelegramMessage} from './telegram';
import type {ContextMessage} from './generator';
import {DEFAULT_CONTEXT_MESSAGES,MAX_CONTEXT_MESSAGES} from './context';

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
