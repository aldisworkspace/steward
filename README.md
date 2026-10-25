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
npx next typegen
npx tsc --noEmit
npx eslint app lib convex --quiet
npm run build
npx tsx scripts/test-rules.ts
npx tsx scripts/test-approvals.ts
npx tsx scripts/test-precedents.ts
npx tsx scripts/test-pipeline.ts
npx tsx scripts/check-fund-breakdown.ts
npx tsx scripts/check-at-risk.ts
npx tsx scripts/verify-judge-scenario.ts
```

`next typegen` generates the route helpers used by `LayoutProps` on a fresh
checkout. Builds require the actual `NEXT_PUBLIC_CONVEX_URL` for the existing
Steward deployment. A build with a placeholder URL checks compilation only;
it does not verify that the live demo works.

## Production deployment (T9)

Production hosting and the live demo URL are still pending verification.
Use the existing Steward Convex project and Vercel project; do not create a
second production backend.

1. In **Convex production**, configure `ANTHROPIC_API_KEY`,
   `LLM_PROVIDER=anthropic`, and `DEMO_PASSCODE` through the dashboard.
2. In **Vercel Production**, configure a production `CONVEX_DEPLOY_KEY` from
   that same Convex deployment and the matching `DEMO_PASSCODE`. Keep the
   deployment key out of Preview environments. `NEXT_PUBLIC_DEMO_KEY` is
   optional and public; omit it unless the demo write passcode is deliberately
   meant to be shared with every landing-page visitor.
3. Set the Vercel **Production Build Command** to
   `bash scripts/deploy-production.sh --deploy`. Convex supplies its production
   URL to the Next.js build, preventing a stale development URL from being
   embedded in the frontend. Use a separate build command for Preview.
4. With production variables already available in a local build environment,
   `bash scripts/deploy-production.sh --check` validates local prerequisites
   without deploying or contacting Convex. This does not verify remote secrets.
5. After deployment, run the smoke checklist in `CONTRIBUTOR.md`, including
   read-only access, write passcode, seed/auto-run, Black Cat evidence, refused
   Steward self-approval, human approval/undo, and bank-feed updates. Record
   production URLs only after the checks pass.

The script builds and deploys Convex when explicitly run with `--deploy`;
Vercel publishes the frontend. It does not configure secrets, seed data, or
certify the demo. See the [Convex Vercel deployment guide](https://docs.convex.dev/production/hosting/vercel).

Offline eval (answer keys — not used by app code):

```bash
npx tsx scripts/eval.ts
```

## Eval (sealed run)

Sealed offline evaluation at commit **`fc4ba9b`** (2026-10-25). Real Anthropic calls via `scripts/eval-offline.ts`; answer keys read only for scoring.

| Set | Planted caught | False alarms | Clean coding |
|-----|----------------|--------------|--------------|
| Demo set (used during development) | 12 / 12 | 0 | 85 / 85 |
| Hold-out 1 (written before development finished; rules edited later — not fully independent) | 15 / 15 | 0 | 53 / 53 |
| Hold-out 2 (sealed: never seen by the code until this run) | 17 / 17 | 0 | 42 / 42 |

Misses and false positives: none on all three sets.

## License

MIT — see [LICENSE](LICENSE).
