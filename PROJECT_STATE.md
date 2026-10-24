# PROJECT_STATE — Cal Hacks 13.0 (solo)

_Last updated: Sat 2026-10-24 (pre-deploy pass)_

## Deployed
- **Landing:** `/` — hero, bento, proof; no Convex.
- **App:** `/app` — full UI; passcode via `?key=` or `NEXT_PUBLIC_DEMO_KEY` on marketing links.
- **Deep link:** `/app?tab=inbox&case=black-cat` resolves to BLACK CAT transaction after load.
- **Auto-run:** Agent pipeline starts only after transactions are loaded and every non-error grant is `ready` (triggered from grant extraction completion and post-seed hook).

## Product (shipped)
- Grant PDF extraction, bank/GL/staff ingest, deterministic rules + Claude coding, inbox + case file, fund breakdown, approvals, funder report draft, custom upload tab, deadline banner on Overview, 8s unreachable Convex state on `/app`.

## Env (prod Convex + Vercel)
- `ANTHROPIC_API_KEY`, `LLM_PROVIDER=anthropic`, `DEMO_PASSCODE`, `NEXT_PUBLIC_CONVEX_URL`, optional `NEXT_PUBLIC_DEMO_KEY`.

## Known limits
- No real auth; demo passcode gates writes.
- Rules use generic keyword heuristics only; nuanced cases rely on `categorizeConcern` + model.
- Hold-out fixtures are for offline eval only — never tuned against in app code.

## Submission
- **Deadline:** Sun 2026-10-25 09:00 PT Devpost.
- **Eval table:** filled in README after final sealed run (`<!-- EVAL_TABLE -->`).
