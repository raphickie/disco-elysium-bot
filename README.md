# Disco Elysium Telegram Bot

Telegram-бот на TypeScript + Cloudflare Workers + D1 + OpenAI. Оригинальные короткие комментарии голосами навыков Disco Elysium. Требования: [SPEC.md](SPEC.md).

## Как работает

1. Telegram отправляет новые сообщения группы на HTTPS webhook Worker.
2. Worker проверяет секрет Telegram, группу и вайтлист. Сообщение сохраняется в D1, повторные обновления игнорируются.
3. Для каждого нового человеческого сообщения с вероятностью `REPLY_PERCENT` (по умолчанию **1%**) проверяется контекст: минимум три сообщения двух разных участников за последние 20 минут.
4. При выполнении условий и наличии бюджета Worker атомарно резервирует лимит на вызов LLM. Для одного чата одновременно возможна только одна генерация.
5. OpenAI генерирует оригинальную реплику, бот отправляет её ответом на сообщение. Фактическая стоимость токенов учитывается в D1.
6. Cron раз в 10 минут очищает устаревшие сообщения и зависшие попытки.

В чате не нужно писать команду. Если никто не пишет или бюджет исчерпан, бот молчит. Бот не проверяет личность участников сверх Telegram user ID.

## Настройка с нуля

Нужны Node.js 22+, аккаунт Cloudflare, Telegram-бот из [@BotFather](https://t.me/BotFather) и отдельный оплачиваемый OpenAI API-аккаунт.

```bash
npm install
npx wrangler login
npx wrangler d1 create disco_bot
```

Команда `d1 create` вернёт `database_id`. Замени `REPLACE_WITH_D1_DATABASE_ID` в `wrangler.jsonc` на реальный ID, затем:

```bash
npm run db:remote
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put OPENAI_API_KEY
npm run deploy
```

Каждая команда `secret put` запросит значение **в терминале**. Не добавляй ключи в GitHub и не коммить `.dev.vars`.

Сгенерируй `TELEGRAM_WEBHOOK_SECRET` как случайную строку из латинских букв, цифр, `_` или `-` (1–256 символов). Используй **одинаковое** значение для Worker и регистрации webhook.

После деплоя Wrangler выведет URL, например `https://disco-elysium-bot.<account>.workers.dev`. Зарегистрируй webhook (токен и секрет подставь **локально**, не отправляй их в чат):

```bash
read -rs TELEGRAM_BOT_TOKEN; echo
read -rs TELEGRAM_WEBHOOK_SECRET; echo
curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  --data-urlencode "url=https://YOUR-WORKER.workers.dev/telegram/webhook" \
  --data-urlencode "secret_token=${TELEGRAM_WEBHOOK_SECRET}" \
  --data-urlencode 'allowed_updates=["message"]'
unset TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET
```

В BotFather выключи **Group Privacy** (`/setprivacy` → Disable), иначе бот не увидит обычные сообщения группы. После переключения удали его из группы и добавь заново. Предупреди участников о передаче небольших фрагментов переписки внешнему LLM-провайдеру.

### Как узнать chat ID

Для первого теста можно временно выставить `WHITELIST_ENABLED: "false"` и добавить бота в группу. Однако безопаснее узнать ID через Telegram `getUpdates` **до установки webhook** или отдельного бота: у групп ID обычно отрицательный (`-100...`). Затем внеси нужные ID через запятую в `ALLOWED_CHAT_IDS` в `wrangler.jsonc` и сделай `npm run deploy`.

По умолчанию вайтлист **включён**, а список пуст — бот не отвечает ни в одном чате до явного разрешения.

## Настройки в wrangler.jsonc

| Переменная | Значение по умолчанию | Назначение |
| --- | --- | --- |
| `WHITELIST_ENABLED` | `true` | Обрабатывать только разрешённые чаты |
| `ALLOWED_CHAT_IDS` | пусто | ID через запятую |
| `REPLY_PERCENT` | `1` | Вероятность срабатывания на сообщение, 0–100 |
| `COOLDOWN_SECONDS` | `900` | Минимальный интервал между ответами одного чата |
| `CONTEXT_MESSAGES` | `12` | Максимум последних сообщений |
| `CONTEXT_WINDOW_MINUTES` | `20` | Период активной беседы |
| `CHAT_DAILY_USD` / `CHAT_MONTHLY_USD` | `0.10` / `1.00` | Бюджет одного чата |
| `GLOBAL_DAILY_USD` / `GLOBAL_MONTHLY_USD` | `1.00` / `10.00` | Общий бюджет |
| `RESERVED_USD_PER_CALL` | `0.02` | Резерв стоимости одного вызова |
| `OPENAI_MODEL` | `gpt-4.1-mini` | Модель генерации |
| `OPENAI_INPUT_USD_PER_MILLION` / `OPENAI_OUTPUT_USD_PER_MILLION` | `0.40` / `1.60` | Тарифы для учёта расходов |

**Важно:** тарифы в конфигурации — лишь начальные значения, их нужно сверить с актуальной стоимостью выбранной модели. Лимиты в D1 являются внутренними ограничителями **расчётных** расходов, а не заменой платёжных лимитов OpenAI. Дополнительно установи ограничение бюджета на стороне API-провайдера. При ошибке Telegram после успешной генерации стоимость LLM всё равно учитывается. У зависших попыток резерв освобождается через 10 минут.

Для локального запуска: `cp .dev.vars.example .dev.vars`, заполнить локальные секреты, `npm run db:local`, `npm run dev`. Telegram webhook требует публичного HTTPS URL.

## Проверка

```bash
npm run typecheck
npm test
curl https://YOUR-WORKER.workers.dev/health
```

Для теста в чате можно временно поставить `REPLY_PERCENT: "100"`, `COOLDOWN_SECONDS: "0"`, затем вернуть рабочие значения. Для генерации требуется активный разговор минимум двух людей.

## Безопасность и ограничения

- Публичный endpoint принимает только запросы с `X-Telegram-Bot-Api-Secret-Token`.
- Чатовые сообщения обрезаются до 900 символов; сохраняются максимум на 48 часов, после чего удаляются по cron.
- Реквизиты OpenAI и Telegram хранятся только в Cloudflare Secrets.
- D1 обеспечивает атомарность бюджетных проверок, а уникальные индексы защищают от повторной обработки.
- Учет стоимости ориентировочный: возможны расхождения с фактическим биллингом OpenAI. При сбое между отправкой сообщения в Telegram и отметкой в D1 повторная отправка **не происходит автоматически**.
- Команда `/silence`, админ-панель и цитаты из игровых файлов пока не реализованы: это возможные следующие итерации.
