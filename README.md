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

## CI/CD: GitHub Actions

**Ничего не нужно запускать локально, чтобы применить миграции и задеплоить бота.** Workflow [`.github/workflows/ci.yml`](.github/workflows/ci.yml) выполняется после каждого push в `master` и может запускаться вручную через GitHub Actions → **CI / Deploy** → **Run workflow**:

1. TypeScript typecheck + тесты.
2. Автоматическое применение ожидающих миграций в удалённую базу D1 `disco-elysium` (`npm run db:remote`).
3. Только при успехе миграций — деплой Worker (`npm run deploy`).

Pull request запускает только тесты, без доступа к секретам и Cloudflare. Деплои сериализованы, чтобы избежать одновременного применения миграций. Уже применённые миграции Wrangler пропускает.

### Одноразовая настройка доступа GitHub → Cloudflare

База **`disco-elysium`** уже создана, её ID прописан в `wrangler.jsonc` с binding `DB`. Создавать базу заново не нужно.

1. В [Cloudflare Dashboard](https://dash.cloudflare.com/) найди **Account ID** твоего Cloudflare-аккаунта — это **не** Database ID D1.
2. В [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens) создай токен для CI (можно использовать шаблон **Edit Cloudflare Workers**). Ограничь его нужным Cloudflare-аккаунтом и предоставь права на развёртывание Workers и **D1: Edit** для миграций. Токен не публикуй.
3. Открой [GitHub → Settings → Secrets and variables → Actions](https://github.com/raphickie/disco-elysium-bot/settings/secrets/actions) и добавь два **repository secret**:
   - `CLOUDFLARE_ACCOUNT_ID` — Account ID из Cloudflare.
   - `CLOUDFLARE_API_TOKEN` — созданный Cloudflare API token.
4. Открой [GitHub Actions](https://github.com/raphickie/disco-elysium-bot/actions) → **CI / Deploy** → **Run workflow**. После успешных тестов workflow сам применит миграцию D1 и создаст/обновит Worker.

Пока хотя бы один из двух секретов отсутствует, workflow успешно проверяет код, но **пропускает** миграцию и деплой с явным уведомлением в логах и Summary. После добавления секретов нужно **повторно запустить** workflow (или запушить коммит).

### Одноразовая настройка секретов самого Worker

После первого деплоя зайди в **Cloudflare Dashboard → Workers & Pages → disco-elysium-bot → Settings → Variables and Secrets** и добавь следующие значения как **Secret**:

- `TELEGRAM_BOT_TOKEN` — выдан @BotFather.
- `TELEGRAM_WEBHOOK_SECRET` — случайная строка для проверки webhook.
- `OPENAI_API_KEY` — отдельный платный ключ OpenAI API.

Это **секреты Cloudflare Worker**, не GitHub Actions. Не присылай ключи в чат и не сохраняй в файлах репозитория. После первичной настройки при дальнейших пушах обычно ничего вводить заново не требуется.

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

Для первого теста можно временно выставить `WHITELIST_ENABLED: "false"` и добавить бота в группу. Однако безопаснее узнать ID через Telegram `getUpdates` **до установки webhook** или отдельного бота: у групп ID обычно отрицательный (`-100...`). Затем внеси нужные ID через запятую в `ALLOWED_CHAT_IDS` в `wrangler.jsonc` и закоммить изменение: GitHub Actions сам задеплоит новую конфигурацию.

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

**Необязательно, для локальной разработки:** установи Node.js 22+, выполни `npm install`, `cp .dev.vars.example .dev.vars`, заполни локальные секреты, `npm run db:local`, `npm run dev`. Telegram webhook требует публичного HTTPS URL; обычные миграции и production deploy при этом по-прежнему выполняются автоматически из GitHub Actions.

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
