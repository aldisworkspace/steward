# Steward, hackathon submission package

Original evidence base: `307470c28f7123e25719f2701f5f907451d6ec3a` in
`aldisworkspace/steward`. Reviewed during integration: threshold and report
inclusion claims corrected; current demo controls may differ from this base.
A live smoke test is still required before using this script with judges.
Scope of this document: submission and demo material only. It changes no shipped
feature, no shared contract (`convex/schema.ts`, `lib/types.ts`), and no data.

Steward's core principle, stated in code at `lib/pipeline.ts:1-5` and in
`AGENTS.md`: **model proposes, deterministic rules verify, human approves.**
The demo rejects Steward as the acting approver. It does not post journal entries
or move money; production authentication and closed-period posting controls are
not implemented or verified.

## Devpost description (concise)

Steward is an autonomous grants accountant for small nonprofits. It reads grant
agreement PDFs, codes bank transactions to grants and budget lines, reconciles
four sources that normally disagree (the bank feed, the bookkeeper's ledger, the
grant contracts, and staff time records), blocks or flags costs a funder would
disallow while citing the exact contract clause, and proposes correcting journal
entries that only a human can approve. Every decision carries an evidence chain
a reviewer can open and challenge with an "Ask why" defense. Built with Next.js,
Convex, and Claude models whose output is validated against Zod schemas before
anything is stored, plus a deterministic rules engine that runs with zero model
calls. All demo data is synthetic and fictional.

## Two-minute judge demo script

Run the demo on synthetic data only. The "Synthetic demo data" badge is visible
in the app whenever demo data is loaded (`app/components/TopBar.tsx:40`).

| Time | On screen | Say / do |
|---|---|---|
| 0:00-0:15 | Landing page at `/` | "Small nonprofits lose grants over bookkeeping, not impact. Steward is an accountant that reads the grant, watches the bank, and refuses to let an unallowable cost through." |
| 0:15-0:40 | Open `/app` with write access, click **Load July-August** (`app/components/StewardApp.tsx`) | "One click loads the bank feed, the bookkeeper's ledger, staff allocations and two grant PDFs. Steward extracts the grant terms itself, then the agent run starts on its own once every grant is ready." Auto-run gating lives in `convex/ingest.ts` (`tryAutoRunPipeline`, `maybeAutoRunPipeline`) and the run executes in `convex/agentRunner.ts`. |
| 0:40-1:05 | Inbox, open the Black Cat case (deep link `/app?tab=inbox&case=black-cat`, resolved by `lib/caseDeepLink.ts`) | "A bar tab coded to a federal grant. The deterministic rules alone do not catch this one, it is left for the model layer, and the case file shows the charge, the proposed coding and the clause it collides with." |
| 1:05-1:25 | Click **Ask why**, then try to approve as Steward, then approve as the named human approver, then undo | "Ask why defends the decision from its evidence chain (`lib/pipeline.ts`, `defendDecision`). The demo blocks actions while acting as Steward; the server also rejects that identity (`convex/approverGuard.ts`). Switch to the named human approver to approve (`convex/approvals.ts`, `approveEntry`), then undo (`undoApproveEntry`). This is a demo role selector, not authenticated identity." |
| 1:25-1:45 | Fund breakdown and funder report tabs | "Every dollar is in one of three states, clean, needs you, or not allowed. The report is a budget-vs-actual draft computed from automatic coding and human-approved exceptions, not typed by hand (`convex/report.ts`, `grantReportData`)." |
| 1:45-2:00 | Overview, deadline banner | "A daily morning check watches funder report deadlines (`convex/crons.ts`, `convex/deadlines.ts`). Steward proposes, rules verify, a human approves. That ordering is the product." |

## Feature claims, each backed by code at the base commit

- Grant PDF extraction into structured terms. `extractGrantTerms` in
  `lib/pipeline.ts` sends the PDF to the judgment model with a Zod schema
  (`GrantTermsZ`, `lib/types.ts:9`) and a dedicated extraction prompt
  (`lib/prompts.ts`).
- Transaction coding in batches, with payroll coded from time records instead of
  the model. `codeTransactions` and `codePayroll` in `lib/pipeline.ts`
  (batch size 25, payroll rationale built from `staff_allocation` shares).
- Two model tiers, swappable provider. Bulk coding uses `claude-haiku-5-5` and
  judgment work (extraction, exceptions, decision defense) uses
  `claude-sonnet-5-5` (`lib/llm.ts:11-12`). `lib/model.ts` switches between
  Anthropic and an xAI client via `LLM_PROVIDER`; `lib/grok.ts` maps the same
  two tiers.
- Deterministic rules with zero model calls. `runRules` in `lib/rules.ts`
  returns findings with evidence and never changes data (header, `lib/rules.ts:1-7`).
  Rule ids in code: `R-GL-ORPHAN` (line 52), `R-DEPOSIT-MISMATCH` (line 58),
  `R-PERIOD`, blocked (line 74), `R-UNALLOWABLE-*` from the grant's own
  unallowable list, blocked (line 88), `R-PRIOR-APPROVAL` (line 103),
  `R-DUPLICATE` above a $250 materiality threshold (25,000 cents)
  (`MATERIALITY_CENTS`, line 20; finding at line 121), `R-EFFORT` against staff
  allocations (line 139), `R-LINE-OVERRUN` against budget plus the contract's
  variance limit (line 161).
- Human-only approval with segregation of duties. `assertHumanApprover` in
  `convex/approverGuard.ts` rejects any approver matching "steward", rejects
  unknown approvers, and rejects approving your own GL entry.
- Proposed journal entries, never auto-posted. Entry state machine in
  `convex/approvals.ts` (`proposed` to `approved` or `rejected`, with undo);
  the `ProposedEntry` contract in `AGENTS.md` states `approvedBy` can never be
  "steward".
- Budget-vs-actual funder report draft. `grantReportData` in
  `convex/report.ts` computes budget, actual, remaining, percent used and the
  variance cap per budget line from decisions, including split charges. The
  narrative regeneration prompt instructs the model to use only the numbers
  provided and not invent figures (`convex/report.ts`, `regenerateNarrative`).
- Autonomous re-runs and deadline watch. `convex/autonomy.ts`
  (`enqueueAgentRun`) schedules a follow-up run when new bank transactions land
  and times out stale runs; `convex/crons.ts` registers a daily "morning
  deadlines" cron that calls `convex/deadlines.ts`.
- Custom data upload beyond the demo set. Bank CSV parsing that detects format
  variants lives in `lib/parseFlexible.ts` and is exercised by
  `scripts/verify-judge-scenario.ts`; the upload UI is
  `app/components/YourDataTab.tsx`.
- Keyboard-first review flow. The command palette opens with Cmd/Ctrl-K
  (`app/components/StewardApp.tsx`, `CommandPalette`).

## Setup and prerequisite checklist

Prerequisites: Node.js with npm, git, a Convex account with access to the
Steward team project (ask the team lead to add you, see `CONTRIBUTOR.md`), and
an Anthropic API key held by the team. No key value belongs in this document,
the repo, or chat.

1. Clone `https://github.com/aldisworkspace/steward` and check out the base
   commit above if you need this exact state.
2. Install dependencies: `npm ci` (a lockfile is committed). Verified in this
   ticket, exit 0.
3. Log in and link the existing project: `npx convex login`, then
   `npx convex dev` and select the existing Steward project. Do not create a
   duplicate production deployment. This writes `CONVEX_DEPLOYMENT` and
   `NEXT_PUBLIC_CONVEX_URL` into `.env.local`.
4. Set secrets in the Convex dashboard or with `npx convex env set`, names
   only: `ANTHROPIC_API_KEY` (Convex only, used by Convex actions),
   `LLM_PROVIDER=anthropic` (or `xai` with `XAI_API_KEY`), `DEMO_PASSCODE`
   (gates writes when set). Optional locally: `NEXT_PUBLIC_DEMO_KEY` so
   marketing links append the demo key automatically. `.env.example` lists
   every variable name.
5. Run the app: `npm run dev`, open `http://localhost:3000` for the landing
   page and `http://localhost:3000/app` for the app.
6. For the demo, open `/app` with write access and click **Load July-August**.
   The run starts automatically once all grants finish extraction.
7. Before presenting, run the checks in the next section in order. Note that
   `npx next typegen` must run before `npx tsc --noEmit` on a fresh checkout
   (see Blockers found).

## Actual checks run for this ticket (2026-10-25, this base commit)

All commands run in a clean checkout of the base commit after `npm ci`.
Nothing below is copied from another branch or from the sealed eval.

- `npm ci`: exit 0.
- `npx tsc --noEmit` on a fresh checkout: **exit 2**,
  `app/layout.tsx(36,50): error TS2304: Cannot find name 'LayoutProps'`.
  After `npx next typegen` (exit 0): `npx tsc --noEmit` **exit 0**.
- `npx eslint app lib convex --quiet`: exit 0.
- `npx tsx scripts/test-rules.ts`: exit 0. Printed recall 11/12, precision
  11/11, with T0065 THE BLACK CAT SF listed as missed by the rules layer and
  left for the model.
- `npx tsx scripts/test-precedents.ts`: exit 0, all assertions passed.
- `npx tsx scripts/test-pipeline.ts`: exit 0. Output includes a sample payroll
  reclassification entry (GUSTO PAYROLL NET PAY, Dr/Cr 1,400.00) moving cost
  from a grant line to unrestricted.
- `npx tsx scripts/check-fund-breakdown.ts`: exit 0, dollar sum check OK
  (clean 11,699,910 cents, needs-you 2,707,400 cents, not-allowed 492,100
  cents, total 14,899,410 cents).
- `npx tsx scripts/check-at-risk.ts`: exit 0. Printed 11 pipeline open
  exceptions and 1,362,886 cents at risk on outflows.
- `npx tsx scripts/verify-judge-scenario.ts`: exit 0, parsed 68 bank rows from
  the judge-scenario CSV format.
- `npm run build` with `NEXT_PUBLIC_CONVEX_URL` set to a placeholder value:
  exit 0, routes `/`, `/app`, `/api/feed`, `/api/seed` built. This proves the
  app compiles. It does not prove a live backend (see Limitations).
- Not run: `scripts/eval.ts` and the sealed eval table. That harness reads the
  answer-key files, which this ticket forbids reading, and it scores a live
  decisions table this ticket did not create. The `<!-- EVAL_TABLE -->`
  placeholder in `README.md` is still empty at this base commit.

## Honest limitations and blockers

- **No verified production deployment at this base commit.** `CONTRIBUTOR.md`
  lists the production URL as not deployed yet, and the integration update for
  this task states production backend access, deployment and the live smoke
  test are still pending. Do not present the placeholder-URL build above as a
  working backend, and do not submit a live URL that has not passed the smoke
  checklist in `CONTRIBUTOR.md`.
- **Blocker found and resolved locally: typegen order.** A fresh checkout
  fails `npx tsc --noEmit` until `npx next typegen` has generated the route
  types (`LayoutProps`). The check sequence in `CONTRIBUTOR.md` omits this
  step. Judges building from source should run typegen first, as recorded
  above.
- **No real auth.** Demo access is a passcode gate only (`PROJECT_STATE.md`,
  Known limits). Anyone with the passcode has write access. This is a demo
  control, not a security model.
- **Rules are heuristics.** Unallowable-category detection in `lib/rules.ts`
  is keyword patterns matched against each grant's own unallowable list
  (comment at `lib/rules.ts:31`). Nuanced cases depend on the model layer and
  `lib/categorizeConcern.ts`, and anything uncertain lands in `needs_review`
  for a human instead of being auto-decided.
- **The rules layer alone misses the Black Cat bar tab** (T0065 in
  `scripts/test-rules.ts`, recall 11/12). The demo shows it as a model-layer
  catch. Do not claim the deterministic rules catch everything.
- **Undo regression fixed during integration; live check still required.**
  At the original evidence base, `undoApproveEntry` left the inbox resolution
  behind. The integration fix removes approval resolutions after the last
  approved entry for that transaction is undone, while preserving independent
  human resolutions and audit history. `scripts/test-approvals.ts` exercises
  the real mutation handlers with an offline database fixture. This does not
  replace the deployed approval/undo smoke test.
- **Live model behavior was not exercised in this ticket.** No live Convex
  deployment was available to this checkout, so extraction and coding quality
  against the real models is unverified here. The offline pipeline test uses
  the project's own fixtures.
- **Demo data limits.** All data is synthetic. The bookkeeper GL export in
  `steward-data/` covers dates up to 2026-08-31 only (`AGENTS.md`), and the
  in-app seed is the July-August sample. Results on real nonprofit books,
  other banks' CSV formats, or scanned PDFs are unproven.
- **Submission deadline risk.** `PROJECT_STATE.md` records the Devpost
  deadline as Sun 2026-10-25 09:00 PT. This package is a draft for the team
  to review and submit. Nothing in this ticket publishes or submits it.
