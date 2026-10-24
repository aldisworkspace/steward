# Steward

Autonomous grants accountant for small nonprofits — reads grant PDFs, codes bank transactions, reconciles books vs contracts, flags unallowable spend with clause citations, and proposes journal entries for human approval.

**Synthetic demo data only.** The app shows a “Synthetic demo data” badge when the July–August sample is loaded.

## Routes

| URL | Purpose |
|-----|---------|
| `/` | Marketing landing (no Convex) |
| `/app` | Live Steward UI (Convex) |
| `/app?tab=inbox&case=black-cat` | Deep link to the Black Cat bar-tab example (or first “Not allowed” item) |
| `/app?key=<passcode>` | Write access when `DEMO_PASSCODE` is set in production |

Legacy `/?tab=…` redirects to `/app` via middleware.

## Stack

Next.js (App Router), Convex, Anthropic Claude (`claude-haiku-5-5` bulk coding, `claude-sonnet-5-5` extraction/reasoning), Zod-validated model output, Tailwind v4 theme tokens in `app/globals.css`.

## Local development

```bash
npm install
npx convex dev          # sets CONVEX_DEPLOYMENT + NEXT_PUBLIC_CONVEX_URL
npm run dev             # http://localhost:3000 and http://localhost:3000/app
```

Copy `.env.example` to `.env.local` and set secrets in the Convex dashboard (`ANTHROPIC_API_KEY`, optional `DEMO_PASSCODE`). Never commit keys.

### Demo seed

In `/app`, click **Load July–August** (requires write passcode if configured). The seed API loads `steward-data/`, extracts both grant PDFs, then starts the agent run automatically once all grants are **ready**.

```bash
curl -X POST http://localhost:3000/api/seed \
  -H 'Content-Type: application/json' \
  -d '{"passcode":"YOUR_DEMO_PASSCODE"}'
```

Optional: set `NEXT_PUBLIC_DEMO_KEY` so marketing links append `?key=` automatically.

## Quality checks

```bash
npx tsc --noEmit
npx eslint app lib convex --quiet
npm run build
npx tsx scripts/test-rules.ts
npx tsx scripts/test-precedents.ts
npx tsx scripts/test-pipeline.ts
npx tsx scripts/check-fund-breakdown.ts
npx tsx scripts/check-at-risk.ts
npx tsx scripts/verify-judge-scenario.ts
```

Offline eval (answer keys — not used by app code):

```bash
npx tsx scripts/eval.ts
```

## Eval (sealed run)

<!-- EVAL_TABLE -->

## License

MIT — see [LICENSE](LICENSE).
