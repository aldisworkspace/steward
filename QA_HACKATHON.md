# QA_HACKATHON — Steward judge-path QA (T-274f69339a6d)

> Integration note: this report records the original base commit below.
> The approval/undo defect is patched in the integration branch with offline
> mutation regression tests; the typegen order is now documented in
> CONTRIBUTOR.md and README.md. The live backend walkthrough remains pending.

- **QA worker:** speedriver3.grok
- **Base commit:** `307470c28f7123e25719f2701f5f907451d6ec3a` (pinned; no branch pulled in)
- **Workspace:** `work/steward-grok` (isolated checkout, clean before this file)
- **Date:** 2026-10-25 (PT)
- **Scope rule followed:** only this file was added. No app code, schema, types, answer keys, credentials, backend seeding or deploy touched.

## 1. Offline quality checks (actually run)

Node v24.22.0, npm 11.19.1, macOS.

| Check | Command | Result |
|---|---|---|
| Install | `npm ci --no-audit --no-fund` | PASS |
| Typecheck (cold) | `npx tsc --noEmit` | **FAIL**: `app/layout.tsx(36,50): error TS2304: Cannot find name 'LayoutProps'` |
| Route typegen | `npx next typegen` | PASS |
| Typecheck (after typegen) | `npx tsc --noEmit` | PASS |
| Lint | `npx eslint app lib convex --quiet` | PASS |
| Rules tests | `npx tsx scripts/test-rules.ts` | PASS (exit 0) |
| Pipeline tests | `npx tsx scripts/test-pipeline.ts` | PASS (exit 0) |
| Precedent tests | `npx tsx scripts/test-precedents.ts` | PASS (exit 0) |
| At-risk check | `npx tsx scripts/check-at-risk.ts` | PASS (exit 0) |
| Fund breakdown check | `npx tsx scripts/check-fund-breakdown.ts` | PASS (exit 0) |
| Judge CSV parse | `npx tsx scripts/verify-judge-scenario.ts` | PASS: "parsed 68 bank rows from judge CSV format" |
| Production build | `NEXT_PUBLIC_CONVEX_URL=https://placeholder-qa.convex.cloud npx next build` | PASS (routes `/`, `/app`, `/api/seed`, `/api/feed`). Placeholder URL only; this is not a working backend. |
| Real-model eval | `scripts/eval-offline.ts <dir>` | **NOT RUN**: needs `ANTHROPIC_API_KEY` and a dataset arg; no key used by this worker. |
| Sealed eval | `scripts/eval.ts` | **NOT RUN**: needs live Convex + model. |

Note: CONTRIBUTOR.md lists `npx tsc --noEmit` as a pre-PR check, but it fails on a clean checkout until `next typegen` (or `next build`/`next dev`) generates the global `LayoutProps` type. Document the order or add a `typecheck` script that runs typegen first.

## 2. Judge demo path audit

Live click-through was **BLOCKED**: no `.env.local` / dev Convex deployment is linked in this workspace and the ticket forbids seeding a production backend. Every step below is a **source audit** at the base commit, not a live run.

| # | Step | Code path | Result |
|---|---|---|---|
| 1 | Landing `/` | `app/page.tsx`, `components/landing/LandingPage.tsx` (`BLACK_CAT_CASE = "black-cat"`) | Builds as static. Live render BLOCKED. |
| 2 | Load July–August (seed) | `StewardApp.tsx:235` → `POST /api/seed` → `ingest.loadDemo`, grant extraction, `maybeAutoRunPipeline` | Passcode gate present (403 on mismatch). Filters bank rows `< 2026-09-01`. Live BLOCKED. |
| 3 | Auto-run | `ingest.maybeAutoRunPipeline` / `tryAutoRunPipeline` | Wired after seed. Live BLOCKED. |
| 4 | Black Cat deep link | `/app?tab=inbox&case=black-cat` → `lib/caseDeepLink.ts` | Matches bank row 66 `08/21/2026,THE BLACK CAT SF,-482.50,Staff appreciation night - YPE team` by description. Source PASS. Note: if no match, it silently falls back to the first blocked txn, which could open the wrong case without telling the judge. |
| 5 | Ask why | `WhyDrawer.tsx` → `agent.explain` (passcode-gated action) | Wired. Needs model key. Live BLOCKED. |
| 6 | Reject Steward self-approval | `StewardApp.tsx:37` actor label `Steward (agent)` → `convex/approverGuard.ts` `/steward/i` → `ConvexError("Segregation of duties…")` | Source PASS. Applies to approve, reject, acknowledge, override and both undo mutations. |
| 7 | Human approve | `approvals.approveEntry` | Source PASS for the guard (named approver or Controller, and not the GL `enteredBy`). |
| 8 | Undo approve | `StewardApp.tsx:567/633` → `approvals.undoApproveEntry` | **FAIL (source)**, see D1. |
| 9 | ⌘K bank feed | `StewardApp.tsx:281` → `POST /api/feed` (Sept–Oct rows) → `ingest.appendBankTransactions` | Wired, passcode-gated. Live BLOCKED. |

## 3. Highest-priority defects

### D1 (P0, judge-visible): undoing an approval leaves the case resolved
- `approveEntry` sets the entry to `approved` **and** inserts an `inboxResolutions` row (`resolution: "approved_entry"`).
- `undoApproveEntry` only resets the entry to `proposed`. It does not delete that `inboxResolutions` row.
- `lib/inboxResolved.ts` `isInboxResolved` returns true when `resolvedTxnIds` has the txn, so after undo the case **stays out of the open inbox**, the badge/at-risk totals don't go back up, and the Black Cat case disappears from the judge path.
- Re-approving after undo inserts a second `inboxResolutions` row and a second `approvals` row (no idempotency).
- **Repro (needs a dev backend):** `/app?key=…` → Load July–August → wait for auto-run → open Black Cat → approve as A. Okafor → click Undo on the toast. Expected: case reopens in the inbox. Predicted from source: it stays resolved.
- **Suggested fix (owner of `convex/approvals.ts`, not this ticket):** in `undoApproveEntry`, delete the `inboxResolutions` row for `entry.txnId` where `resolution === "approved_entry"`, and log the reversal. The UI does not need to change.

### D2 (P1): cold `tsc --noEmit` fails
See section 1. Not a runtime bug, but it fails the documented pre-PR check on a fresh clone.

### D3 (P2): deep-link fallback can open the wrong case
`resolveCaseDeepLink` returns `notAllowedTxnIds[0]` when the slug doesn't match. A typo or a data change opens some other blocked case with no notice.

### D4 (P2, known limit): approver identity is client-supplied
`by` is a free string from the client. Anyone holding the demo passcode can approve as the named approver. This is consistent with "No real auth" in PROJECT_STATE.md and shouldn't be presented as real segregation of duties beyond the demo.

## 4. Blockers
- No dev Convex deployment or `.env.local` in this workspace. A live click-through needs one (per CONTRIBUTOR.md: `npx convex login` plus project access from Aldi). Production seeding is out of scope.
- No `ANTHROPIC_API_KEY` for this worker, so Ask why, extraction and the real-model eval weren't exercised.
