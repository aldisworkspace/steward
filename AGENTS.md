# AGENTS.md — Steward (Cal Hacks 13.0)

Read this before touching code. Also read PROJECT_STATE.md and the ticket you were assigned in TASKS.md.
Do only your ticket. Touch only the files the ticket owns. If you need to change a shared contract
(`convex/schema.ts`, `lib/types.ts`), stop and report instead.

## Product
Steward is an autonomous grants accountant for small nonprofits. It does five things:
- reads grant agreements (PDF);
- codes bank transactions to grants and budget lines;
- reconciles the bank, the bookkeeper's ledger, the contracts and the staff time records;
- blocks or flags costs a funder would disallow, citing the clause;
- proposes correcting journal entries for human approval, and drafts the funder's budget-vs-actual report.

Core principle: **model proposes → deterministic rules verify → human approves.**
Steward can never approve its own entries, post to a closed period, or move money.

## Stack
- Next.js (App Router, TypeScript, Tailwind).
- Convex for the database, file storage, actions and scheduled functions.
- `@anthropic-ai/sdk`:
  - model `claude-haiku-5-5` for bulk coding;
  - model `claude-sonnet-5-5` for contract extraction, exception reasoning and decision defense.
- `zod` validates all model output. Invalid output → retry once → mark the item `needs_review`. Never fabricate a result.
- `pdf-parse` (server only) extracts PDF text.

## Env vars (never commit values)
- `ANTHROPIC_API_KEY` — set in the Convex dashboard; used only by Convex actions.
- `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL` — set by `npx convex dev`.

Keep `.env.example` in sync. No keys may appear in client code, logs or the README.

## Data (all SYNTHETIC, fictional org) — `steward-data/`
| File | Contents |
|---|---|
| `grant_A_federal_passthrough.pdf` | Grant GA-2026-114, lines A1–A6 |
| `grant_B_harbor_light_foundation.pdf` | Grant HLF-26-031, lines B1–B4 |
| `bank_transactions_q3_2026.csv` | Columns: Posting Date (MM/DD/YYYY), Description, Amount (may contain commas; negative = outflow), Memo |
| `gl_export_bookkeeper.csv` | Columns: bank_ref, date, description, amount, account, class, budget_line, entered_by. Covers dates ≤ 2026-08-31 only |
| `staff_allocation.csv` | Allocation format: `GRANT:LINE=50%;UNRESTRICTED=50%` |
| `precedents.json` | Prior human rulings |
| `expected_labels.json`, `expected_gl_findings.json` | Answer key. **Never read these from app code.** Only `scripts/eval.ts` may use them |

The UI must show a visible "Synthetic demo data" badge whenever demo data is loaded.

## Core types (lib/types.ts is the source of truth)
```ts
type Status = "auto" | "needs_review" | "blocked";
type Source = "bank" | "gl" | "contract" | "time_record" | "precedent" | "human";

interface GrantTerms {
  grantId: string; funder: string; program: string;
  periodStart: string; periodEnd: string;         // ISO dates
  totalAward: number;
  budgetLines: { code: string; name: string; amount: number }[];
  lineVarianceLimitPct: number | null;             // e.g. 10 or 15
  unallowable: { rule: string; clauseRef: string }[];
  priorApproval: { rule: string; thresholdUsd: number | null; clauseRef: string }[];
  indirectCapPct: number | null;
  reportDue: string | null;
  restrictedPurpose: string;
}

interface Decision {               // one per bank transaction
  txnId: string;
  grantId: string | null;          // null = unrestricted / income
  budgetLine: string | null;
  splits?: { grantId: string | null; budgetLine: string | null; amount: number }[];
  status: Status;
  confidence: number;              // 0..1
  rationale: string;               // plain English, 1-3 sentences
  evidence: { source: Source; ref: string; note: string }[]; // clause refs, GL row, precedent id
  ruleHits: string[];              // deterministic rule ids that fired
}

interface ProposedEntry {          // double-entry correction, never auto-posted
  id: string; txnId: string; date: string; memo: string;
  lines: { account: string; class: string | null; budgetLine: string | null; debit: number; credit: number }[];
  state: "proposed" | "approved" | "rejected" | "posted";
  proposedBy: "steward"; approvedBy: string | null;   // approvedBy can never be "steward"
}
```

## Conventions
- Money is stored in integer cents internally and formatted only at the UI layer.
- Every write that changes a decision or entry appends to `auditLog` with: who, when, what, why, and evidence refs.
- Loading, empty and error states are explicit in the UI. If a model call fails, show it; never show fake success.
- Keep it simple: no auth, no extra infra, no new dependencies without a reason in the PR description.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
