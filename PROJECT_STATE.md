# PROJECT_STATE — Steward v2 (finance-team rebuild)

_Last updated: 2026-11-24 · branch `feat/finance-team-v2` (not merged, not deployed)_

## Why v2
Feedback from a nonprofit finance team (Nov 20, 2026; not quotable, not named publicly):
bank statements carry no purpose, so work from **GL detail + receipts**; city cost-reimbursement
contracts are billed monthly with an **invoice + expenditure report** and a one-cent error returns the
whole batch; juniors compile, a senior accountant reviews every charge. Goal: the reviewer sees only
exceptions and signs a package that ties out to the cent.

The bank-first v1 for small nonprofits is frozen at tag `v1-small-nonprofit` / branch `legacy/small-nonprofit`.
Production (`steward.nur.capital`) still runs v1 (`main@5ad6ca7`).

## Product (on the branch)
- **`/`** landing: "Grant invoices that don't come back." Dark, synthetic mocks only, testing section marked pending.
- **`/app`** three screens + package sheet:
  - **Packages**: one card per grant × billing period, claimable total, "N of 7 checks pass", due date.
  - **Review**: exceptions only, grouped by fix. Each case reads What we found → Why → What to do.
  - **Package sheet**: 7 tie-out checks with cents, expenditure report, preparer → reviewer sign-off, CSV export, print.
  - **Data**: GL detail (required), receipts, contracts, bank (optional), roles, receipt threshold.
- **Ingest**: QuickBooks / Xero / Sage GL detail with column mapping (`lib/parseGlDetail.ts`). Bank is optional, used for reconciliation (`bankLines`).
- **Receipts**:
  - Claude Sonnet reads each receipt (`convex/receiptsAgent.ts`).
  - A deterministic one-to-one matcher pairs receipts with lines, including split purchases (`lib/matchReceipts.ts`).
- **Rules (new)**: R-RECEIPT-MISSING / MISMATCH / AMBIGUOUS, R-PURPOSE-UNCLEAR, R-INDIRECT-RATE, R-BANK-UNRECORDED, R-GL-NO-BANK, R-AMOUNT-MISMATCH, R-NEEDS-DOCS.
  - Documentation gaps are `needs_review`. Contract prohibitions are `blocked`.
  - Open questions sort after deterministic facts.
- **Packages** (`lib/tieOut.ts`, `convex/packages.ts`):
  - Seven checks: SUM_TIES, INDIRECT_ROUNDING, CUMULATIVE_WITHIN_BUDGET, IN_PERIOD, RECEIPTS, NO_OPEN_EXCEPTIONS, PROGRAM_APPROVAL.
  - Signing is blocked until all pass. The preparer and the reviewer must be different people, and Steward can't be either.
  - Open charges can be held out of an invoice. They stay listed as excluded.
- **Roles**: program approvers, preparers and reviewers are name-based (no auth yet).
- **Design**: `DESIGN.md`, `PRODUCT.md`, tokens in `app/globals.css`, primitives in `app/components/ui/`.

## Invariants (unchanged)
Model proposes → rules verify → human approves; nothing posts or moves money; every decision cites
evidence and existing clauseRefs; integer cents; balanced entries; answer keys never read by app code;
synthetic data labelled.

## Data & evaluation
- `steward-data-v2/` is a synthetic city contract plus a foundation grant: QuickBooks GL (164 lines), 36 receipts and 10 planted issues. It is used for tuning.
- `steward-holdout-v2-SEALED.zip` is a separate fictional org. It is opened once, for the final measurement below.
- Demo v2 on the dev deployment (`scripts/eval-v2-dev.ts`, real Claude):
  - **10/10 planted issues caught**;
  - **2/152 false alarms**;
  - 13 open exceptions;
  - status matches the key on 8/10. D-e (line overrun) and D-h (equipment) come out `needs_review`, not `blocked`, by design: missing approval is fixable.
- Hold-out v2: see "Hold-out result" below.
- Legacy v1 sets (`steward-data`, `steward-holdout*`) still pass offline (`test-rules` 12/12).

## Hold-out result (sealed v2 hold-out, opened once on 2026-11-24, 2 runs, identical scores)
- **Recall: 8/10 planted issues caught.**
  - H-02 missed: Amazon purpose unclear. The model stayed silent under the "<$250 routine" materiality rule.
  - H-09 missed: a $62.11 line with no receipt. The county threshold of $50 (§11.2) is not extracted from the contract; the workspace default is $75.
- **Status matches the key on 4/10.** In every mismatch the key says `blocked` and the app gives `needs_review`:
  - alcohol (H-03): this should be `blocked`, so it is a real defect;
  - prior approval (H-07), line overrun (H-10) and the indirect rate (H-04).
- **False alarms: 1/122 clean lines.** The memo says futsal goals, but the receipt shows bibs and a ball, so Steward proposes another line. Arguably fair.
- **Contract extraction**: amounts, lines, billing basis, indirect 12% on salaries, variance and clauses were all correct. Only the receipt threshold is missing.
- **Packages**: Jul and Aug match the key to the cent. Sep and Oct differ only by the missed or soft-status items.
- **Bugs seen, not yet fixed:**
  - an unresolved recode already moves the invoice total;
  - packages are built for an advance-paid foundation grant;
  - an un-awaited mutation warning in `agentRunner:run`;
  - the hold-out seed deletes the v2 contracts.
- **This hold-out is now spent.** Any fix made after seeing it must be measured on a NEW sealed hold-out before claiming numbers.


## Fix round 2 + hold-out v3 (2026-11-24)
Fixes (8 commits after `9dc2cc8`):
- the receipt threshold is now taken from the contract;
- "can't be billed as-is" = `blocked` for the blocked portion: prohibitions incl. receipt line items, missing prior approval, line overrun, indirect excess;
- the materiality waiver needs consistent evidence;
- a pending recode no longer moves the invoice;
- advance-paid grants get no invoice packages;
- an un-awaited callback is fixed;
- seeds park other sets' contracts.

Demo v2 after the fixes: 10/10 caught, 10/10 status, 1–3/152 false alarms.

**Hold-out v3** (sealed, written independently of the fixes, opened once; 2 runs):
- **caught 11/12 and 12/12**;
- **status matches the key 9/12 and 10/12**;
- blocked cents match 4/6;
- **false alarms 12/85 in both runs**, so precision is the weak spot;
- no packages for the advance-paid grant (correct).

Main false-alarm causes:
- a lease exemption in the contract isn't modelled (4 rent lines);
- the MTDC base is built from a line-name regex and does not exclude client direct assistance (3 indirect JEs + a wrong blocked amount);
- receipts are judged "for another org" because the org name isn't in the prompt;
- R-PRIOR-APPROVAL ignores precedents.

Other misses and bugs:
- out-of-period H3-01: a bank-line tie in the receipt matcher hides it;
- the GL parser rejects a file with a one-cell footer row.

The v3 hold-out is now spent too.

## Fix round 3 — hold-out v3 causes (2026-11-23)
General rules only (no vendor or line-id cases); offline tests in `scripts/test-holdout-v3-fixes.ts` and `test-gl-detail.ts`.
1. **Receipt exemptions.** Terms get optional `receiptExemptions` (`documentTerms` naming the agreement + optional `costTerms`).
   A line is exempt only when its memo/account names the agreement ("lease on file"); "client rent assistance" is not.
   Honoured by R-RECEIPT-MISSING and the package RECEIPTS check.
2. **Indirect base.** Optional `indirectBaseLines` / `indirectExcludedLines` from the contract; the line-name regex is a fallback only.
3. **Organization name** (workspace settings) is in the coding context.
4. **Free-text prior approval.** A precedent with approval wording (not "no approval…") in scope of the grant or grant:line,
   within its "not to exceed $X" cap, and tied to the line (memo quotes its reference, or the model cites it) clears
   R-PRIOR-APPROVAL and the model's matching concern. Typed `prior_approval_granted` now clears that concern too.
5. **GL-first receipts** never match bank lines; **R-PERIOD** also fires when the matched invoice/receipt is dated outside the period.
6. **GL parser** skips one-cell title/footer rows (and account headings in the date column); the seed-route workaround is gone.

Contracts must be re-read after an extraction-prompt change: `npx convex run evalDev:resetGrantTerms '{"fileNames":[…]}'`, then seed again.

Results (dev, contracts re-extracted with the new prompt, 1 run each):
- **Demo v2: 10/10 caught, status 10/10, 3/152 false alarms** (all three are model questions on office/art supplies).
- **Hold-out v3 — sanity only, the set is spent:** caught 11/12 (was 11–12), status 11/12 (was 9–10),
  blocked cents 6/6 (was 4/6), **false alarms 0/85 (was 12/85)**; every NONA package ties once Steward's blocked portions are approved.
  Miss: H3-11 (split amounts swapped between two grants) came out `auto` — model-dependent, caught in one of the two earlier runs.
- **No public claim from these numbers.** A new sealed hold-out v4, written without seeing these fixes, is needed.

## Hold-out v4 result (sealed, opened once on 2026-11-23, 2 runs, identical scores)
Written by an agent that did not read the detection code or fix round 3 (zip sha256 `6e1c71d3…`). The contracts were extracted cold with the current prompt.
- **Recall: caught 12/13.** H4-11 was missed: a refund was not recorded, and the line came out `auto`.
- **Status matches the key on 11/13. Blocked cents match 6/8.**
  - H4-03: a fine itemised on a receipt blocks the whole line ($455.09) instead of the fine itself ($60.00).
  - H4-04: a receipt amount mismatch comes out `blocked` via R-UNALLOWABLE-ALCOHOL_STAFF; the key expects `needs_review`.
  - H4-05 (duplicate) was caught only through R-RECEIPT-MISSING.
- **False alarms: 11/86**, all three causes deterministic:
  - 9 biweekly stipend-roster lines get R-RECEIPT-MISSING (participant stipends documented by a roster need no receipt);
  - a line of exactly $75.00 is flagged, but the contract says "exceeding $75" (threshold inclusivity is not extracted);
  - R-PRIOR-APPROVAL tests the order total, but the contract tests per unit cost.
- **Packages:** April ties to the cent. May–July differ by the items above.
- Demo v2 after seeding back: 10/10 caught, 3/152 false alarms.
- **This hold-out is now spent.**

## Fix round 4 — hold-out v4 false alarms (2026-11-23)
General rules only; offline tests are in `scripts/test-holdout-v4-fixes.ts`.
- **Threshold inclusivity.** `receiptThresholdExclusive` is set for wording like "exceeding $75": exactly $75.00 then needs no receipt. Applies to R-RECEIPT-MISSING and the package RECEIPTS check.
- **Other documenting records.** `receiptExemptions` now also covers charges documented by another record, wherever the clause sits (e.g. "stipends are documented by the stipend roster" → costTerms `stipend`, documentTerms `roster`).
- **Per-unit prior approval.** A per-unit threshold is tested per item (`priorApproval[].perUnit`):
  - quantity is read from the receipt (new optional `lineItems[].quantity`, also added to the Convex validators) or from the item text;
  - tax, delivery and installation lines are spread over the goods, not counted as units;
  - with no itemized invoice it is a `needs_review` question;
  - a model prior-approval question that the itemized receipt settles is closed (check "Question settled").

Results on dev, with contracts and receipts re-read using the new prompts:
- **Demo v2: 10/10 caught, status 10/10, 2–3/152 false alarms.** One intermediate run had D-h as `needs_review`: tax and delivery were counted as units. Fixed before these numbers.
- **Hold-out v4, sanity only (the set is spent):**
  - **false alarms 0/86 (was 11/86)** in 3 runs, plus 1/86 in the run before the "Question settled" fix;
  - caught 11–12/13, status 10–11/13, blocked cents 6/8.

Still open on v4:
- H4-11: an unrecorded refund is missed.
- H4-09: a split allocation error is caught only in some runs (depends on the model).
- H4-03: a fine itemised on a receipt blocks the whole line.
- H4-04: a receipt mismatch is blocked via alcohol.

A new sealed hold-out v5 is needed for any public claim.

## Fix round 5 — remaining hold-out v4 misses (2026-11-23)
General rules only; tests 4–7 in `scripts/test-holdout-v4-fixes.ts`.
- **Alcohol keywords are whole words**: "twine" is no longer wine (H4-04 was blocked by mistake).
- **Fines itemised on a receipt** (R-UNALLOWABLE-FINES): only those items are blocked, with no tax share; the rest of the line stays.
  "Fine" alone is not a fine ("fine-point markers").
- **Split receipt that doesn't tie**: every grant-charged row of the split gets R-RECEIPT-MISMATCH; the difference is sized once.
- **R-REFUND-UNRECORDED** (new, blocked): a bank credit/refund from a vendor with no matching GL credit blocks the refunded
  amount on that vendor's earlier grant-charged expense (90-day window). A return recorded in the GL is not flagged.
- **Low confidence after a settled question**: when a deterministic check settles the model's only question, the model's
  low confidence no longer keeps the line open.

Results on dev:
- **Demo v2: 10/10 caught, status 10/10, 2–3/152 false alarms.**
- **Hold-out v4 — sanity only, the set is spent:** 3 runs, all **13/13 caught, status 13/13, blocked cents 8/8**, and every
  package ties once Steward's blocked portions are approved. False alarms 0/86 in 2 runs; 1/86 in the run before the
  settled-question fix.
- Not re-checked after this round: hold-out v3.

A new sealed hold-out v5 is needed for any public claim.

## Known limits / risks
- **Real data.** No auth, single workspace, shared dev deployment. **Do not load real nonprofit data** until real auth, an `orgId` on every table and data deletion exist.
- **Old leaked passcode.** The demo passcode from commit `307470c` is still in public `main` history. Rotating `DEMO_PASSCODE` is the owner's call.
- **Package totals differ from the answer key's convention.** Totals include `needs_review` lines at their booked amount until resolved. Seeded history holds open lines out.
- **Two false alarms remain on the demo.** Both are specific questions.
- **Not verified live:** the print layout; dropping a PDF on the GL zone routes it to Contracts.
- **Vercel route limit.** The v2 seed takes ~60–80 s with contracts cached. A cold seed extracts contracts too, so watch the 300 s limit.

## Env
Convex: `ANTHROPIC_API_KEY`, `LLM_PROVIDER`, `DEMO_PASSCODE` (optional). Vercel: `NEXT_PUBLIC_CONVEX_URL`, `DEMO_PASSCODE`.
Never set `NEXT_PUBLIC_DEMO_KEY`. Dev deployment: `judicious-hummingbird-654`; prod: `dependable-tern-388`.

## Checks
`npx tsc --noEmit` · `npx eslint app lib convex --quiet` · `npm run build` · `scripts/test-*.ts` · `scripts/check-*.ts` · `scripts/verify-judge-scenario.ts`.
Live demo score: `npx convex run evalDev:rematchReceipts && npx convex run agentRunner:run && npx tsx scripts/eval-v2-dev.ts`.
After an extraction-prompt change: `evalDev:resetGrantTerms` on the set's contracts, then seed the set again.
