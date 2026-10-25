# Convex для Альнура (Alunur)

**GitHub:** [@speedriver3](https://github.com/speedriver3) — доступ к репо уже есть.

## Aldi: выдать доступ к Convex (1 раз)

1. [dashboard.convex.dev](https://dashboard.convex.dev) → проект **Steward** (тот, где dev/prod deployments).
2. **Settings → Team → Invite** — email Convex-аккаунта Альнура (тот же, с которым он сделает `npx convex login`, часто совпадает с GitHub email).
3. Роль: **Developer** (достаточно для dev + deploy по договорённости).
4. Passcode и `ANTHROPIC_API_KEY` в чат не слать — только «доступ в team есть, ключи уже в deployment» или dev passcode лично.

Альнур **не** создаёт новый Convex-проект — в `npm run convex:dev` выбирает **Existing project → Steward**.

## Альнур: быстрый старт

```bash
git clone git@github.com:aldisworkspace/steward.git
cd steward && npm install
npx convex login
npm run convex:dev    # existing Steward project
npm run dev           # второй терминал
```

Документация: **CONVEX.md**, **CONTRIBUTOR.md**, **AGENTS.md**.

Задача: **T9** — prod deploy + smoke (файлы в CONTRIBUTOR.md).
