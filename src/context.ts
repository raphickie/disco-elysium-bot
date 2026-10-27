import type { Config } from './config.js';
import type { StoredMessage, TelegramMessage } from './types.js';

export function normaliseMessage(message: TelegramMessage, config: Config): StoredMessage | null {
  if (message.chat.type !== 'group' && message.chat.type !== 'supergroup') return null;
  if (!message.from || message.from.is_bot || message.sender_chat) return null;
  if (message.new_chat_members || message.left_chat_member || message.pinned_message || message.group_chat_created || message.supergroup_chat_created) return null;
  if (!Number.isSafeInteger(message.chat.id) || !Number.isSafeInteger(message.message_id)) return null;
  if (!Number.isSafeInteger(message.from.id) || !Number.isSafeInteger(message.date)) return null;
  const body = (message.text ?? message.caption ?? '').replace(/\s+/g, ' ').trim().slice(0, config.maxMessageChars);
  if (!body) return null;
  const author = (message.from.first_name || message.from.username || `Участник ${message.from.id}`)
    .replace(/\s+/g, ' ').trim().slice(0, 60);
  return {
    chat_id: String(message.chat.id),
    message_id: message.message_id,
    telegram_user_id: String(message.from.id),
    author: author || 'Участник',
    body,
    sent_at: message.date,
  };
}

export function isConversationReady(messages: readonly StoredMessage[], config: Config): boolean {
  if (messages.length < config.minContextMessages) return false;
  return new Set(messages.map((message) => message.telegram_user_id)).size >= config.minContextUsers;
}

export function shouldRollReply(percent: number, random: () => number = Math.random): boolean {
  if (percent <= 0) return false;
  if (percent >= 100) return true;
  return random() < percent / 100;
}

export function utcKeys(timestampSeconds: number): { day: string; month: string } {
  const iso = new Date(timestampSeconds * 1000).toISOString();
  return { day: iso.slice(0, 10), month: iso.slice(0, 7) };
}
