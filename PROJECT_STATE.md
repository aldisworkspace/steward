# PROJECT_STATE — Cal Hacks 13.0

_Last updated: Sun 2026-10-25 (T9 deployment readiness)_

## Implemented routes (production URL not yet verified)
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

## Deployment readiness (T9)
- Added the previously missing `scripts/deploy-production.sh`. Its default
  `--check` mode makes no network calls; `--deploy` is the Vercel Production
  build command and injects the matching Convex production URL into Next.js.
- Production Convex/Vercel access, remote secrets, live URL, and the full smoke
  checklist in `CONTRIBUTOR.md` still need verification. No production deployment
  was performed during this readiness change.
- On a fresh checkout, run `npx next typegen` before `npx tsc --noEmit`.

## Demo hardening (integration, October 25)
- Cursor's UI changes atomically resolve deep links, preserve approval results
  and Undo feedback after async mutations, and expose seed/view-only errors.
  Acting as Steward disables review actions in addition to server-side guards.
- Undoing the last approved entry now clears its approval-only inbox
  resolutions, preserves independent resolutions and audit history, and resets
  `approvedBy` to the schema's required `null` value. Offline mutation regression
  coverage is in `scripts/test-approvals.ts`.
- `QA_HACKATHON.md` records Grok's findings against the original base commit.
  `docs/hackathon-submission.md` contains Muse's draft with integration corrections;
  neither document certifies a live deployment or a sealed evaluation.
- Integrated checks: TypeScript, lint, seven offline scripts, and a production
  build using an explicitly non-live placeholder Convex URL passed. The live
  demo, real model calls and approval/undo against Convex still need testing.

## Submission
- **Deadline:** Sun 2026-10-25 09:00 PT Devpost.
- **Eval table:** filled in README after final sealed run (`<!-- EVAL_TABLE -->`).
