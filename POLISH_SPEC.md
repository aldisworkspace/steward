# POLISH_SPEC.md — final polish pass (from 3 independent audits)

Work top to bottom.
- Commit and push after each numbered section.
- After each section, run `npx tsc --noEmit`, `npm run build`, `npx tsx scripts/test-rules.ts steward-data` and `CAUTIOUS=history npx tsx scripts/test-pipeline.ts steward-data`.
- Do not change prompts in lib/prompts.ts.
- If the Sankey fix (labels/collisions/tooltip) is not committed yet, finish it first.

---

## 1. P0 — Safety and correctness (things that can break the live demo)

### 1.1 Keyboard handlers ignore focus — CRITICAL
Typing "a" in the Ask-why input or a note textarea approves the entry. Typing "j"/"k" switches the case mid-question.

The handlers are StewardApp.tsx (~134–155, J/K/?) and CaseFile.tsx (~304–323, A/R/E). At the top of BOTH handlers add:
```ts
if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
const t = e.target as HTMLElement | null;
if (t?.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]')) return;
if (cmdOpen || panelOpen || helpOpen || popoverOpen) return;
```
This also stops ⌘R / ⌘A from being swallowed.

### 1.2 Optimistic actions must not lie
CaseFile ~186–254 calls `onResolved()` and the "Entry approved" toast BEFORE the mutation resolves. Fix it like this:
- Keep the instant UI, but if the mutation throws, roll back: re-insert and re-select the item, replace the toast with the error, and never call setState on an unmounted component.
- Add a pending state to "Approve all N" (disable while running). Show a single summary toast. If one approval fails partway through, report "3 of 4 approved — 1 failed: <reason>".
- Undo must have a `.catch`. After undo, clear the toast and re-select the case.

### 1.3 Don't show the seed screen while loading
StewardApp ~278: when `counts === undefined` (refresh, slow network, socket reconnect), render a skeleton, NOT "Load July–August". Show the seed screen only when `counts.transactions === 0`.

Add a connection banner as well. Use `subscribeToConnectionState`: when disconnected for more than 2s, show a thin strip "Offline — reconnecting…".

### 1.4 Hide developer controls from judges
"Reset", "Reload demo", "Run morning check" and "Bank feed arrives" go behind `?admin=1` and into ⌘K.
- Reset needs `confirm()`.
- Exception: keep ONE visible demo control on Overview, "Simulate Sept–Oct bank feed" (secondary button). It is part of the autonomy story.
- Overview timeline pills that do nothing (`onJournalFilter={() => {}}`) must become non-interactive.

### 1.5 Categorize model concerns deterministically (fixes "Steward's judgment")
Root cause: rules only test the grant a charge is currently on. When Claude already keeps a cost off-grant and raises a concern, no Finding exists. The item then has `ruleHits=[]` and the generic label.

In `lib/pipeline.ts verify()`: when a decision has a model concern and no rule finding, derive a category from the clause the model cited. Implement `categorizeConcern(concern, grants, txn)`:
1. If `concern.clauseRef` prefix-matches a grant's `unallowable[i].clauseRef`, map that clause's rule text through the existing `UNALLOWABLE_PATTERNS` termRule (export it from rules.ts). This gives one of:
   - `R-UNALLOWABLE-FUNDRAISING`
   - `R-UNALLOWABLE-FINES`
   - `R-UNALLOWABLE-ALCOHOL_STAFF`
   - `R-UNALLOWABLE-LOBBYING`
   - new `R-UNALLOWABLE-OTHER`, labelled "Not allowed by the grant", for travel, entertainment, purpose and similar.
2. If it matches `priorApproval[i].clauseRef` → `R-PRIOR-APPROVAL`.
3. Otherwise, if the txn date is outside the period of the grant the clause belongs to → `R-PERIOD`.
4. Otherwise → `R-MODEL-REVIEW` ("Needs your review").

Then push a Finding with that ruleId, `status = concern.status`, `message = concern.reason`, and evidence `{source:"contract", ref: clauseRef, note: rule text}`.

Add an offline test case for this in scripts/test-pipeline.ts using a fake concern. After the change, re-run Steward once. This is cheap.

### 1.6 At-risk money must be one number everywhere
- inboxQueue rows must carry `memo` and `atRiskCents` (from `d.atRiskCents`, computed in lib/atRisk.ts).
- lib/inboxGroups.ts must sum `atRiskCents`, NOT `|amountCents|`. Right now the GUSTO group shows $11,200 but the truth is $5,600.
- ui.ts ~39: remove the fallback that treats the full amount as at-risk when `atRiskCents` is 0. Use `d.atRiskCents ?? 0`.
- Group payroll by EMPLOYEE, not vendor. Key = `ruleId|employee` (the employee matched from staff allocation names). The label is in the copy deck below.
- The Inbox header shows the total: "13 items · $7,871 a funder could ask you to repay". Overview, Inbox header, groups and the case file must all agree. Verify with a quick script.

### 1.7 Refunds and tiny inflows
In pipeline.ts the materiality shortcut is limited to outflows and to "no concern". Change it to:
```ts
const immaterial = Math.abs(t.amountCents) < MATERIALITY_CENTS;
if (g && glLineValid && !txnFindings.length && !splits && grantId === null && immaterial
    && (!c.concern || c.concern.status === "needs_review")) { /* accept bookkeeper coding, auto, note */ }
```
Clear the concern when this applies. The $63.48 Amazon refund must not be in the inbox.

### 1.8 Filter chips must partition the queue
Rewrite lib/inboxFilters.ts with ONE category per row, first match wins:

| Rule | Category |
|---|---|
| `status==="blocked"` or any `R-UNALLOWABLE-*` / `R-PERIOD` | `not_allowed` |
| `R-PRIOR-APPROVAL` or `R-LINE-OVERRUN` | `approval` |
| `R-EFFORT` | `payroll` |
| `R-GL-DISAGREE` / `R-DEPOSIT-MISMATCH` / `R-GL-ORPHAN` | `books` |
| `R-DUPLICATE` | `duplicate` |
| anything else | `other` (chip shown only when > 0) |

Chip counts must sum to "All".

The "Done" chip (was Resolved) count must always be computed:
- `approveEntry`/`rejectEntry` must also insert an `inboxResolutions` row, or derive "done" from entries + resolutions.
- Sankey "needs_you" maps to filter "all".

J/K navigate the FILTERED + GROUPED list that is visible. After resolving an item, select the next visible item.

### 1.9 Messages
- Success toasts (approved / agreed / override recorded) go to the bottom StatusBar in neutral ink with Undo. Never use red `role=alert` for success; red is for errors only.
- Errors get a dismiss button and clear on the next successful action.
- The "All clear. Nothing needs you." empty state shows only when the All count is 0. Use per-filter empty text otherwise (copy deck).

---

## 2. P0 — Layout and structure

### 2.1 Fixed-height two-pane inbox
```
grid h-[calc(100dvh-<topbar+tabs>)] grid-cols-[minmax(340px,30%)_1fr]
```
Both columns get `min-h-0 overflow-y-auto`. Remove `pb-28` / `min-h-[480px]`. The queue scrolls on its own and the case header stays visible.

### 2.2 Case file order — no empty half-screen
1. Header: vendor display name (17px/600 ink), meta line "Sep 16, 2026 · Bank: PALACE OF FINE ARTS EVENTS" (13px ink-2), status pill, amount (40px, baseline-aligned with the title).
2. The verbatim contract clause, when there is one, directly under the header: Newsreader 17px, `border-l-2 border-redpen pl-4`, with "Youth Pathways grant · §4.5" under it (13px ink-2).
3. Three sentences (What happened / What Steward did / What you do), using the copy-deck templates.
4. **Action row right here**: primary + secondary + "Ask Steward why" (ghost button). Show a sticky footer ONLY if the journal entry pushes actions off-screen.
5. Coding strip: "Books say: <label | not coded yet> → Steward says: <label>". Red-pen strike only when the books had a coding.
6. Evidence: open by default for blocked/needs_review. A 3-column grid with each source card. The chips act as anchors/toggles per source. Remove the "Expand" link.
7. "Correction" block, if there is an entry. First line in plain English: "Move $1,400 from Youth Pathways · Personnel to General funds." Below it, a collapsed "Accounting detail" holding the Dr/Cr table. Then "Effect on grant budget" (before→after bars).

### 2.3 Popovers (Override / Send back / Agree-with-note)
Use `position: fixed` near the action row, `role="dialog" aria-modal`, `autoFocus` on the textarea, Esc closes, click-outside closes. They must never open below the fold.

### 2.4 Nav rail
Use a fixed 64px spacer. The inner rail is `absolute inset-y-0 left-0 z-30` and expands OVER the content on hover. No content reflow.

### 2.5 Ask Steward why
The panel docks on the right WITHOUT a scrim, so the case stays visible. Esc closes. A question about case X stays bound to X even if J/K is pressed.

### 2.6 Filter chips
Use a single row (`flex-nowrap`): All · Not allowed · Funder approval · Payroll · More ▾. "More" holds Books don't match, Duplicates, Other and Done. Counts are tabular. Zero-count chips are dimmed (`opacity-60`).
- Active: `border-ink bg-sheet font-semibold`.
- Inactive: `border-rule text-ink-2`.
- No sky ring.

---

## 3. P1 — Copy deck (use these exact strings)

### Helpers
- **`displayVendor(raw)`**:
  - title case; small words (of, the, and, for) lowercase;
  - keep acronyms SF, SFMTA, GGRWA, PG&E, LLC;
  - INC→Inc., L.P.→L.P.;
  - MKTPLACE→Marketplace, PMTS→Payments;
  - strip trailing store numbers (#0144, 00114) and grant codes.
  - Show the raw descriptor ONLY as grey meta in the case file.
- **`fmtDate`**: use `Intl.DateTimeFormat("en-US", {month:"short", day:"numeric", year:"numeric"})` everywhere (queue meta, header, tables, chips, periods "Jul 1, 2026 – Jun 30, 2027"). Due chips read "Due Oct 30 · in 6 days" or "Overdue by 3 days".
- **Money formats**:
  - Outflows: "−$3,500.00" with U+2212.
  - Inflows: "+$45,000.00" in money green.
  - Parentheses only inside accounting tables (Correction detail, Transactions, Reports).
  - At-risk totals in whole dollars ("$5,600").
- **`humanize(msg, grants)`**: replace `GRANT-ID[:LINE]` in any rule/check message with "<Fund title> · <line name>". Remove prefixes like "Bookkeeper's coding:" and "Steward's judgment:".

### Status pill
Clean · Needs you · Not allowed

### Chips
All · Not allowed · Funder approval · Payroll · Books don't match · Duplicates · Other · Done

### Queue line 2, then " · <Fund title>"

| Rule | Line 2 text |
|---|---|
| `R-UNALLOWABLE-FUNDRAISING` | Fundraising cost |
| `R-UNALLOWABLE-FINES` | Fine or penalty |
| `R-UNALLOWABLE-ALCOHOL_STAFF` | Alcohol or staff event |
| `R-UNALLOWABLE-LOBBYING` | Lobbying |
| `R-UNALLOWABLE-OTHER` | Not allowed by the grant |
| `R-PERIOD` | Outside the grant period |
| `R-PRIOR-APPROVAL` | Needs funder approval |
| `R-LINE-OVERRUN` | Over budget line by $<over> |
| `R-EFFORT` | Pay exceeds time sheet |
| `R-DUPLICATE` | Possible duplicate payment |
| `R-DEPOSIT-MISMATCH` | Books ≠ bank by $<diff> |
| `R-GL-DISAGREE` | Bookkeeper coded it differently |
| `R-MODEL-REVIEW` | Needs your review |

- Group row: "M. Chen's pay exceeds time sheets ×4 · $5,600 over-charged". It has a ChevronRight and a secondary button "Approve 4 corrections".
- Queue rows also show a small status word ("Not allowed" / "Needs you") next to the amount, so status is never conveyed by color alone.

### Case file — What happened
- Outflow: "On {Mon D} you paid {Vendor} {$X}{ for "{memo}"}."
  - Example: "On Sep 16 you paid Palace of Fine Arts Events $3,500 for "Deposit – Fall Benefit Gala"."
- Inflow: "On {Mon D}, {Vendor} sent you {$X}."
- If GL exists, append: " Your bookkeeper charged it to {Fund · Line}."
- If no GL, append: " Your bookkeeper hasn't coded it yet."

### Case file — What Steward did

| Case | Text |
|---|---|
| Not allowed, off-grant | "Steward kept it off {the {Fund} grant / both grants} and charged it to general funds: {cost type} is prohibited by {Fund A} (§x.y){ and {Fund B} (§a.b)}." |
| Bookkeeper had it on a grant | "Your bookkeeper charged it to {Fund · Line}. Steward moved it to general funds because {reason} ({Fund} §x.y)." |
| Period | "That's after the {Fund} grant ended on {Sep 30, 2026}, so Steward charged it to general funds ({Fund} §4.1)." |
| Prior approval | "A single {$6,240} purchase meets the {Fund} equipment rule ({$5,000}, §5.1), and no funder approval is on file. Steward kept it off the grant until you get approval." |
| Effort | "{M. Chen}'s time sheet puts {50%} on {Fund}, but payroll charged 100%. Steward proposes moving {$1,400} to general funds." |
| Duplicate | "Same vendor, same amount, {1 day} after {another payment}. Steward flagged it before it reaches a grant." |
| Deposit | "Your books record {$54,000}, but the bank received {$45,000}. The bank is the record, so Steward proposes correcting the books by {$9,000}." |
| Overrun | "This purchase takes {Books and materials} to {$17,755}, over the {15%} overage {Harbor Light} allows without approval." |
| Model review | Model rationale, humanized, max 2 sentences. |

### Case file — What you do
| Case | Text |
|---|---|
| Decision without entry | "Agree, or override with a reason." |
| Entry exists | "Approve the correction, or send it back with a reason." |
| Prior approval | "Ask {Funder} for written approval, or keep it on general funds." |

### Buttons
- Decision: **Agree** (primary) / **Override…**
- Entry: **Approve correction** (primary) / **Send back…**
- Always: **Ask Steward why** (ghost)
- Popover question: "Why are you overriding? This is kept in the audit trail."
- Remember-scope: "Remember this for: ( ) this charge only ( ) all future {Vendor} charges"

### Toasts
- "Agreed — Steward's call stands. Undo"
- "Override recorded. Undo"
- "Correction approved. Undo"
- "4 corrections approved. Undo"

### Empty states
- Inbox: "All clear. Nothing needs you."
- Empty filter: "Nothing in {chip} right now."
- Done: "Nothing decided yet."
- Case panel: "Pick an item on the left to see what happened and what to do."
- No data: "Steward has no bank data yet. Load the July–August sample to start."
- Read-only: "View-only link. Ask for the edit link to approve or override."
- Acting as Steward: "You're viewing as Steward, which can propose but not approve. Switch to A. Okafor to approve."

### Evidence source names
Bank record · Bookkeeper's entry · Grant agreement · Time sheet · Past ruling

Drop the Ⓑ Ⓛ Ⓒ Ⓣ Ⓟ glyphs everywhere, including the legend.

### Shortcuts
Remove the footer hint string. Add a small ghost button "Keyboard shortcuts" (Keyboard icon) in the case header area. It opens the help dialog, which uses `<kbd>` elements: J / K next · A agree/approve · O override · E evidence · ⌘K search · ? help. Inside buttons, show the key as a faint `<kbd>` only at ≥1280px.

### Jargon in the journal and audit
- "Reclass T0011" → "Correction for {Vendor} ({date})".
- "Waiting on Executive Director" → "Waiting on A. Okafor".
- Never print a raw grant id or rule id in user-facing text.

---

## 4. P1 — Visual system cleanup

1. Set `html{font-size:16px}` (it is currently 15px, which puts every Tailwind spacing value off the 8px grid). Replace the half-steps (py-1.5, py-2.5, px-2.5, gap-1.5, mt-0.5) with 4/8-grid values.
2. Type scale per view: 40 (amount/hero), 17 (titles), 14 (body, queue titles, buttons), 13 (meta, chips). Remap 15→14, 12→13, 16→17, 22→17, 10/11→13.
   - No `font-bold` on Public Sans (only 400/500/600 are loaded); use `font-semibold`.
   - Bricolage is for display only (hero, big amounts, stamps). Remove it from the "S" avatar and the nav wordmark.
3. Evidence chips use ONE neutral style: `rounded-[6px] border border-rule bg-sheet px-2 h-7 text-[13px] text-ink`, plus a 14px icon per source (Landmark, BookOpen, FileText, Clock, History). No fills, and no serif inside chips.
4. Queue rows:
   - `border-b border-rule`.
   - Selected row: `bg-sheet font-semibold`, a 4px left bar in its status color, `aria-current`.
   - Hover: `bg-sheet/60`.
   - Icons: Ban (redpen) for not allowed; CircleAlert (ink-2) for needs you; plus specific icons (Wine, Ticket, Landmark, Plane, Copy, Scale, CalendarX, Stamp, ArrowLeftRight, Gauge, BookX, Unlink).
   - Icons are 16px, strokeWidth 1.75. Never color an icon saffron.
5. Contrast fixes (WCAG AA 4.5:1 for text):

   | Text / element | Fix |
   |---|---|
   | White on saffron buttons (2.0:1) | ink text |
   | Sky link text (2.9–3.3:1) | use #2563EB for links |
   | Redpen text on redpen-tint (3.4:1) | ink text + redpen icon |
   | Redpen alert text on white (4.17) | ink text + redpen icon |
   | Saffron status bar on paper (1.78:1, non-text) | pair with icon + status word |
   | Button borders | `border-ink-2`, not `border-rule` |

6. Radius: 6px for buttons, chips and inputs; 8px for panels/cards/palette; 0 for tables. No `rounded-[4px]` and no `rounded-full` except avatars and the status dot.
7. Shadows: a single `--shadow-panel: 0 8px 24px rgba(14,27,44,.12)`, used only on the right panel and the ⌘K palette. Everything else is border-only.
8. Every button has hover, active and focus-visible states. Disabled buttons get `opacity-50` plus a `title` explaining why.
9. One primary button per view. "Approve all/4 corrections" is secondary/outline.
10. Remove legacy token aliases (ledger, pencil, ledger-wash, slate) and the stray `sky/10–40` tints. All colors come from the brief tokens.

---

## 5. P1 — Accessibility and performance

- Roles:
  - Queue: `role=listbox` / `role=option aria-selected`.
  - Chips: `role=tablist` / `tab aria-selected`.
  - Nav: `aria-current="page"`.
  - Evidence toggles: `aria-expanded`.
  - Icon-only buttons: `aria-label`.
- Live regions: StatusBar and the presence chip get `role="status" aria-live="polite"`. Errors keep `role="alert"`.
- Global reduced motion:
  ```css
  @media (prefers-reduced-motion:reduce){*,::before,::after{animation:none!important;transition:none!important}}
  ```
- ⌘K palette:
  - focus trap, return focus on close, labelled input, `role=listbox`;
  - "Jump to transaction" works on every tab (include the ledger query on the inbox tab);
  - jumping to a clean transaction shows no approve actions.
  - Fix the stale closure in `paletteCommands` deps. Remove the unused `cmdk` dependency, or use it.
- Queries:
  - `ingest.counts`: return counts via `.take`/indexes or a single `hasData` query instead of collecting 4 tables.
  - `ui.caseFile`: use `by_txnId` indexes; drop the unused staff payload.
  - Move the `latestRun` subscription into TopBar.
  - `React.memo` InboxQueue and CaseFile.
- J/K must not flash a skeleton. Keep the previous case data and dim it until the new data arrives.
- Use `next/dynamic` for YourDataTab and TransactionsVirtualTable. Newsreader gets `preload:false`.
- RubberStamp must be visible on approve. Show the stamp for 700ms BEFORE the case leaves the queue, or show it in the next state.
- Long text: queue titles get `title={raw}`; the case header gets `break-words`.

---

## 6. Verification (do it, report results)

1. Production build (`npm run build && npm start`). Walk through:
   - Overview → click the red band → Inbox "Not allowed".
   - Black Cat: the clause is visible without clicking; actions are right under the three sentences.
   - Type "a r e j k" in Ask why: nothing else happens.
   - Approve: the stamp shows, then the next item; Undo works.
   - Group "M. Chen ×4" shows $5,600 → Approve 4 corrections.
   - Chip counts sum to All. Done increases.
   - Bank feed via ⌘K (admin) → live run.
   - Resolve everything → "All clear".
2. Compare totals: the Overview at-risk = the Inbox header total = the sum of the rows. Print them.
3. Screenshots go in design-screenshots/v4/: overview, inbox-black-cat, inbox-group, ask-why, keyboard-help, done-state.
4. Report max 15 lines: what was done per section, the totals check, anything skipped.
