# TASKS.md — tickets (owner · files · acceptance)

Deadline: Sun 2026-10-25 09:00 PT. P0 = core demo path.

## T1 · P0 · Cursor · Scaffold + schema + ingestion
**Files owned:** `convex/schema.ts`, `convex/ingest.ts`, `app/page.tsx` (shell only), `.env.example`

**Schema.** Create these tables in `convex/schema.ts`. Field names follow AGENTS.md types.
- `grants`: grantId, fileId, terms (GrantTerms | null), status
- `transactions`: txnId, date, description, amountCents, memo
- `glRows`: bankRef, date, description, amountCents, account, class, budgetLine, enteredBy
- `staffAllocations`: employee, role, biweeklyCents, allocation `{key, pct}[]`
- `precedents`: date, by, ruling, scope
- `decisions`: Decision
- `proposedEntries`: ProposedEntry
- `approvals`: entryId, decision, by, note, at
- `auditLog`: at, actor, action, targetId, why, evidence

**Ingestion.** Write a Convex mutation `ingest.loadDemo` that parses the CSV/JSON files in `steward-data/`. Expected behaviour:
- It handles `MM/DD/YYYY` dates and amounts with commas.
- It is idempotent: running it twice gives the same counts.
- It does NOT load the `expected_*` files.

**Shell page.** Add a button "Load demo data" and show the counts plus a "Synthetic demo data" badge.

**Acceptance:** after a fresh `npx convex dev` and one click, the page shows transactions 97, GL rows 69, staff 5, precedents 2. A second click leaves the counts unchanged.

## T2 · P0 · Claude (chat) · Types + rules engine + grant extraction
**Files owned:** `lib/types.ts`, `lib/rules.ts`, `lib/parse.ts`, `convex/extract.ts`, `lib/prompts.ts`

**Acceptance:**
- The rules engine flags these on demo data with zero model calls:
  - fine,
  - out-of-period,
  - duplicate,
  - equipment ≥ threshold,
  - effort overcharge vs staff allocation,
  - deposit mismatch (bank vs GL),
  - line overrun.
- `extract.grantTerms` on grant A returns valid `GrantTerms` with 6 budget lines.

## T3 · P1 · Codex (separate branch) · Eval harness
**Files owned:** `scripts/eval.ts` only.

Read the `decisions` table and compare it against `expected_labels.json` and `expected_gl_findings.json`.

**Output:** JSON plus a printed table with:
- issue recall and precision;
- grant/line accuracy on non-issue rows;
- a list of misses.

**Acceptance:** runs with `npx tsx scripts/eval.ts`, and exits 0 with a score even when the `decisions` table is empty (score 0).

## Later (not yet assigned)
- T4: Claude coding action (Haiku batch → Decision, Sonnet for exceptions).
- T5: Exceptions/approval queue UI + proposed journal entries.
- T6: "Why?" defense panel (evidence chain).
- T7: Funder report.
- T8: Autonomy via Convex cron/trigger on new transactions; live activity feed.
- T9: Deploy (Vercel + Convex).
- T10: Demo video, Devpost, README.
