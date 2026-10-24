# PROJECT_STATE — Cal Hacks 13.0 (solo)

_Last updated: Sat 2026-10-24 06:45 PT_

## Deployed
- **Marketing / landing:** `/` (no Convex) — hero, bento, proof table, CTAs.
- **App:** `/app` — full Steward UI (Convex live queries, passcode via `?key=` or `NEXT_PUBLIC_DEMO_KEY` on links).
- **Production URLs:** set after Vercel + Convex prod deploy (see `.env` / Vercel dashboard). Local dev: `http://localhost:3000` and `http://localhost:3000/app`.

## Product (shipped)
- Grant PDF extraction, bank/GL/staff ingest, deterministic rules + Claude coding, inbox queue with filters, case file, ask-why, fund breakdown (replaces Sankey), approvals with segregation of duties, synthetic demo seed, optional custom upload tab, funder report draft, offline eval scripts.

## Eval (offline, synthetic answer keys)
| Set | Planted caught | False alarms | Clean coding |
|---|---|---|---|
| Demo (tuned) | **12 / 12** | **1** | **84 / 85** |
| Hold-out (not tuned) | **15 / 15** | **1** | **52 / 53** |

Rules-only recall on hold-out planted issues: **8 / 15**; pipeline + Claude covers the rest.

## Env (prod Convex + Vercel)
- `ANTHROPIC_API_KEY`, `LLM_PROVIDER=anthropic`, `DEMO_PASSCODE` (server seed/write gate), `NEXT_PUBLIC_CONVEX_URL`, optional `NEXT_PUBLIC_DEMO_KEY` (appended to marketing demo links only — not a secret in client bundle if you rotate passcode separately).

## Known limits
- No real auth; demo passcode is the write gate. View-only without key.
- Custom upload path is best-effort; judge demo uses `steward-data/` synthetic set.
- Lighthouse / full prod smoke depends on deployed Convex + Vercel env being configured.

## Submission
- **Deadline:** Sun 2026-10-25 09:00 PT Devpost.
- **Tracks:** Hyphenate P0, Anthropic Public Benefit, Microsoft Real World, Convex P1.
