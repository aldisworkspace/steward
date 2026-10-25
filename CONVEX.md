# Convex — Steward

Backend: база, файлы (PDF грантов), actions (Claude), mutations, cron. Next.js только UI; ключ Anthropic **только** в Convex.

## 1. Первый запуск (облако)

```bash
npm install
npx convex login          # https://auth.convex.dev/device — GitHub/Google
npx convex dev            # создать проект или привязать существующий
npm run dev               # в другом терминале — Next на :3000
```

`npx convex dev` пишет в **`.env.local`** (не коммитить):

| Переменная | Назначение |
|------------|------------|
| `CONVEX_DEPLOYMENT` | dev или prod deployment id |
| `NEXT_PUBLIC_CONVEX_URL` | URL для клиента (`https://….convex.cloud`) |

Локальный **anonymous** (`127.0.0.1:3210`) — только для офлайн-разработки без аккаунта; для демо и команды нужен **cloud**.

## 2. Переменные окружения (Convex Dashboard → Settings → Environment Variables)

| Имя | Dev | Prod | Комментарий |
|-----|-----|------|-------------|
| `ANTHROPIC_API_KEY` | ✓ | ✓ | Только в Convex, не в Vercel и не в git |
| `LLM_PROVIDER` | ✓ | ✓ | `anthropic` |
| `DEMO_PASSCODE` | опц. | ✓ | Пишет/seed; без ключа — view-only в `/app` |

Установка из CLI (значение через stdin, не в истории shell):

```bash
printf '%s' 'sk-…' | npx convex env set ANTHROPIC_API_KEY
npx convex env set LLM_PROVIDER anthropic
printf '%s' 'your-passcode' | npx convex env set DEMO_PASSCODE
```

Prod: те же имена на **production** deployment:

```bash
printf '%s' 'sk-…' | npx convex env set ANTHROPIC_API_KEY --prod
npx convex env set LLM_PROVIDER anthropic --prod
printf '%s' 'your-passcode' | npx convex env set DEMO_PASSCODE --prod
```

Скопировать ключ dev → prod без вывода в терминал:

```bash
printf '%s' "$(npx convex env get ANTHROPIC_API_KEY)" | npx convex env set ANTHROPIC_API_KEY --prod
```

## 3. Production deploy

```bash
npx convex deploy -y
```

После деплоя взять **Production URL** в [dashboard.convex.dev](https://dashboard.convex.dev) → проект → Settings → URL и прописать в Vercel:

`NEXT_PUBLIC_CONVEX_URL=https://….convex.cloud`

На Vercel также нужен `DEMO_PASSCODE` (тот же, что в Convex prod) для `/api/seed`.

Полный скрипт: `./scripts/deploy-production.sh` (после `convex login` и `vercel login`).

## 4. Команда и доступ

1. Владелец: Dashboard → **Settings → Team** → invite по email Convex-аккаунта.
2. Коллаборатор: `npx convex login`, `npx convex dev`, выбрать **существующий** проект Steward (не создавать второй prod).
3. SSH/git: `git@github.com:aldisworkspace/steward.git`, ветка `main`.

## 5. Что лежит в `convex/`

| Модуль | Роль |
|--------|------|
| `schema.ts` | Таблицы (grants, transactions, decisions, …) |
| `ingest.ts` | Demo seed, auto-run после ready grants |
| `agent.ts` / `agentRunner.ts` | Pipeline coding |
| `grants.ts` | PDF upload + extract |
| `ui.ts` | Inbox, overview, case file queries |
| `approvals.ts` | Approve/reject entries |
| `deadlines.ts` + `crons.ts` | Утренний cron (14:00 UTC) — deadline lines в audit |
| `passcode.ts` / `demoAuth.ts` | DEMO_PASSCODE gate |

## 6. Полезные команды

```bash
npx convex dev              # watch + dev deployment
npx convex deploy -y        # prod functions + schema
npx convex env list         # имена секретов (без значений в agent-режиме)
npx convex dashboard        # открыть dashboard
npx convex run dashboard:latestRun '{}'   # пример run query
```

Офлайн-оценка модели (ключ из Convex dev):

```bash
export ANTHROPIC_API_KEY="$(npx convex env get ANTHROPIC_API_KEY)"
npx tsx scripts/eval-offline.ts steward-data
```

## 7. Типичные проблемы

| Симптом | Решение |
|---------|---------|
| `/app` 8 с «Can't reach the data server» | Проверить `NEXT_PUBLIC_CONVEX_URL`, `npx convex dev` или prod URL |
| View-only, seed не работает | `/app?key=<DEMO_PASSCODE>` или снять `DEMO_PASSCODE` на dev |
| Agent не стартует после Load | Оба grant PDF в статусе `ready`, есть transactions |
| `Not logged in` | `npx convex login` |

См. также **AGENTS.md**, **README.md**, **CONTRIBUTOR.md**.
