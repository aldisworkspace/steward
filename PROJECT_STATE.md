# PROJECT_STATE — Cal Hacks 13.0 (solo)

_Last updated: Sat 2026-10-24 03:40 PT_

## Hard facts (from Hacker Guide + Hyphenate track PDF)
- **Submission deadline: Sun 2026-10-25 09:00 PT on Devpost.** Late = not judged. Submit a draft Saturday night.
- Judging: Sun 10:30–12:30 at an assigned table. You must be present the whole window. 2-minute pitch with a **live demo** (required).
- The project must be started during the event.
- Hyphenate judges ask four questions:
  - (1) Real enough?
  - (2) Would you hire it — which seats, limited access, clean record, knows when to ask?
  - (3) Something new?
  - (4) The moment.
- Hyphenate also wants: a demo video that opens with the moment; a live demo where **they may try their own scenario**; one line on the seats; proof (planted errors + answer key).

## Product: Steward
**Seats filled:** grants accountant + grant compliance analyst at a small nonprofit. Steward codes expenses to restricted grants, enforces the grant agreements, and prepares the funder's budget-vs-actual report. The Executive Director stays the approver.

**One-liner:** An autonomous grants accountant for small nonprofits. It reconciles the bank, the books and the grant contracts. It catches the costs a funder would disallow and drafts the funder report, citing the clause behind every call.

**Magic moment (demo opener):** the bookkeeper coded a bar tab as "Program supplies" on the federal grant and charged a coach 100% to the grant when the timesheet says 50%. Steward catches both. It cites §4.2 and §6, proposes the correcting journal entries, and routes them to the ED for approval. When the judge asks "why?", it defends each call with its source chain.

### What the system does (Hyphenate "hard parts" → our answer)
| Hard part | Steward |
|---|---|
| Sources disagree | Bank vs GL (bookkeeper) vs grant contract vs time records; it says which source it trusted and why |
| Time | Precedents (prior rulings) are stored and applied later; the June ruling on participant lunches decides August |
| Working with others | Approval queue; the ED can approve, reject or ask a question; Steward handles a "no" (reclass to unrestricted) |
| Limits | Steward can only *propose* journal entries. It cannot approve, cannot post to a closed period, and cannot move money (segregation of duties) |
| Explainable | Every decision has an audit record: data → rule/clause → model rationale → human approver |

## Demo data (SYNTHETIC, fictional org/funders) — `steward-data/`
| File | Contents |
|---|---|
| `grant_A_federal_passthrough.pdf` | $180K, 2 CFR 200 style, unallowables §4, equipment approval §5, effort §6 |
| `grant_B_harbor_light_foundation.pdf` | $60K, restricted; 15% line variance limit; period ends 9/30 |
| `bank_transactions_q3_2026.csv` | 97 txns, messy formats |
| `gl_export_bookkeeper.csv` | Bookkeeper coded through Aug 31 only (half-done), with 3 types of planted mistake |
| `staff_allocation.csv` | Time and effort records |
| `precedents.json` | Prior rulings |
| `expected_labels.json`, `expected_gl_findings.json` | Answer key = eval set |

Planted: 7 bank-level issues + 6 GL disagreements. Coverage: alcohol, equipment without approval, fine, gala, out-of-period, duplicate, line overrun, effort overcharge, deposit mismatch.

## Architecture
- **Next.js (TS) + Convex** (DB, file storage, actions, scheduled functions → autonomy trigger; reactive live activity feed). Convex replaces Tiger Data.
- **Claude API** (tool use + zod-validated JSON):
  - `extractGrantTerms`
  - `codeTransaction`
  - `reconcile`
  - `explainDecision`
  - `draftFunderReport`
- Deterministic rules engine on top: period, caps, unallowable list, equipment threshold, duplicates, effort %. **Model proposes, rules verify, human approves.**
- Double-entry ledger tables: `journal_entries` (proposed / approved / posted), `audit_log`, `approvals`, `precedents`.
- Eval script: run the agent on the dataset, score against the answer key, show precision/recall in the UI.
- Env vars: `ANTHROPIC_API_KEY`, `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL`.

## Tracks (priority)
| Priority | Track | Prize |
|---|---|---|
| P0 | Hyphenate | $8K / $5K / $3K |
| P0 | Anthropic Public Benefit | needs a real conversation with a nonprofit finance person |
| P0 | Microsoft Built for the Real World | finance named explicitly |
| P1 | Convex | $5K |
| P1 | Best Solo Hack, Best People-First Hack, Overall | general prizes, automatic |
| P1 | Creao Best One-Person Company | requirements unknown — check booth/Slack |
| P2 | Fetch.ai | uAgent wrapper |
| P2 | Commit Fellowship | opt-in at submit |
| P2 | GoDaddy domain | — |
| P2 | DEV post | — |
| Skip | Visa, Bright Data, CRS, Cartesia, Meta, SpaceXAI, Mana, Apify, Spacetime, x402, Factory | Factory: revisit only if Droid SDK can be the agent runtime |

## Open questions
1. Can one project win several prizes? Ask in Slack #0-ask-directors.
2. Claude API key / credits?
3. Approve email to Kara Mitzel (Mission Action) for a 10-min validation call?
4. Creao One-Person Company requirements.

## Verification status
- Data generator runs; answer key produced (fixed: Lakeshore overrun now actually crosses the 15% cap).
- Rules engine (`lib/rules.ts`): 12/12 planted issues flagged, 0 false positives, zero model calls.
  - **Caveat:** September rows used hand-written "naive" candidate codings instead of model output.
  - Grant terms used hand-transcribed fixtures, not extraction.
  - The alcohol hit relies on the memo keyword "appreciation".
  - Generalization is unproven → build a held-out dataset (different vendors/memos) before claiming accuracy.
- App: not started.

## Next 3 actions
1. Scaffold Next.js + Convex; Claude smoke test: `extractGrantTerms` on `grant_A` PDF → valid `GrantTerms`.
2. Ingest bank + GL + staff CSVs into Convex; rules engine catches deterministic issues (period, fine, duplicate, effort %).
3. Claude coding + exception reasoning → approval queue UI → eval score.
