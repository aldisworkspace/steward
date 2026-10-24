# Contributor onboarding — speedriver3

**Contact:** aseke7799@gmail.com · GitHub **[@speedriver3](https://github.com/speedriver3)**

## GitHub

- **Repo:** [github.com/aldisworkspace/steward](https://github.com/aldisworkspace/steward)
- **Access:** `speedriver3` is already a collaborator on `aldisworkspace/steward` (no pending invite). Clone with SSH or HTTPS after accepting any org invite from `aldisworkspace`.

## Branch to use

- **`main`** is the only active branch; all shipped work is merged there.
- **Latest commit:** `f1b3a90` — pre-deploy pass (landing `/`, app `/app`, auto-run after grants, deep links, rules cleanup, docs).
- Workflow: branch off `main`, PR back to `main`. Do not force-push `main`.

## Convex (development)

1. Install deps: `npm install`
2. Log in: `npx convex login` (device flow at [auth.convex.dev/device](https://auth.convex.dev/device)).
3. **Project access:** ask **Aldi** to add your Convex account to the **Steward** team project in [dashboard.convex.dev](https://dashboard.convex.dev) → Project → Settings → Team (same project Aldi uses for this repo).
4. Link dev: from repo root, run `npx convex dev` and select **existing project** (do not create a duplicate prod deployment). This writes `CONVEX_DEPLOYMENT` and `NEXT_PUBLIC_CONVEX_URL` into `.env.local` (gitignored).
5. Read **AGENTS.md** and **PROJECT_STATE.md** before changing code. Do not edit `convex/schema.ts` or `lib/types.ts` without explicit approval.

## API keys (approved)

| Secret | Where | How |
|--------|--------|-----|
| `ANTHROPIC_API_KEY` | **Convex dev deployment only** | Team lead sets in dashboard, or you run `printf '%s' 'sk-…' \| npx convex env set ANTHROPIC_API_KEY` after login. Never commit, log, or paste in Slack/PR. |
| `LLM_PROVIDER` | Convex | `npx convex env set LLM_PROVIDER anthropic` |
| `DEMO_PASSCODE` | Convex + Vercel (prod) | Optional on dev; required for prod write gate. Owner shares out-of-band. |
| `NEXT_PUBLIC_CONVEX_URL` | `.env.local` / Vercel | Set automatically by `npx convex dev` or deploy docs. |

Local Next.js does **not** need the Anthropic key in `.env.local` for normal UI work; model calls run in Convex actions.

## Live demo

| | |
|---|---|
| **Production URL** | *Not deployed yet* — target is Vercel + Convex prod (see `scripts/deploy-production.sh`). |
| **Local** | `npm run dev` → [http://localhost:3000](http://localhost:3000) (landing), [http://localhost:3000/app](http://localhost:3000/app) (app). |
| **Demo passcode (planned prod)** | Owner will confirm after deploy; intended value for next prod cut: `53154b415817` (`?key=` for write access when `DEMO_PASSCODE` is set). |

View-only: open `/app` without `?key=`. Write/seed: `/app?key=<passcode>`.

## Your ticket — T9 · Production deploy + smoke test

**Goal:** Ship Convex prod + Vercel prod, run the smoke checklist, document URLs in README and PROJECT_STATE.

**Files you own (only these unless agreed otherwise):**

- `scripts/deploy-production.sh`
- `README.md` (prod URLs, deploy steps; keep `<!-- EVAL_TABLE -->` placeholder)
- `PROJECT_STATE.md` (Deployed section)
- `.env.example` (document vars only, no values)

**Out of scope:** `convex/schema.ts`, `lib/types.ts`, `lib/rules.ts`, feature UI.

**Acceptance:**

1. `npx convex deploy` succeeds; prod has `ANTHROPIC_API_KEY`, `LLM_PROVIDER=anthropic`, `DEMO_PASSCODE` set (never print API key).
2. Vercel production has `NEXT_PUBLIC_CONVEX_URL`, `DEMO_PASSCODE`, optional `NEXT_PUBLIC_DEMO_KEY`.
3. Smoke: `/`, view-only `/app`, `/app?key=…` → Load July–August → auto-run → inbox → Black Cat deep link → Ask why → Steward approve refused → approve as A. Okafor → undo → ⌘K bank feed → auto-run; no console errors.
4. PR to `main` with updated URLs only after smoke passes.

**Checks before PR:** `npx tsc --noEmit`, `npx eslint app lib convex --quiet`, `npm run build`, all `scripts/test-*.ts` and `scripts/check-*.ts`.
