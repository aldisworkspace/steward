/**
 * Deterministic verification layer. The model (or the bookkeeper's GL) proposes a coding;
 * these rules verify it against the contracts, time records, bank and precedents.
 * Rules never change data. They return findings with evidence and an optional suggestion
 * that a human must approve.
 */
import { NON_CASH_TYPE, reconcileGlToBank } from "./matchLedger";
import { contractReceiptExemption, daysApart, RECEIPT_DATE_WINDOW_DAYS, receiptCoverage, receiptExempt } from "./matchReceipts";
import { isPayrollTxn, matchStaffForTxn } from "./payrollMatch";
import { applyRate, baseLineCodes, indirectLineCode, receiptRequired, receiptThresholdFor, receiptThresholdText } from "./tieOut";
import { vendorKey } from "./vendorKey";
import type { BankLine, Candidate, Evidence, Finding, GlRow, GrantTerms, Precedent, ReceiptExtract, ReceiptRecord, StaffAllocation, Txn } from "./types";

export interface RuleInput {
  txns: Txn[];
  gl: GlRow[];
  staff: StaffAllocation[];
  grants: GrantTerms[];
  precedents: Precedent[];
  candidates: Map<string, Candidate>;
  /** Optional bank statement (GL-first workspaces). Reconciliation rules run only when present. */
  bankLines?: BankLine[];
  /** Receipts uploaded for this workspace. Receipt rules run only when this is provided. */
  receipts?: ReceiptRecord[];
  /**
   * Grant-charged lines at or above this need a receipt (workspaceSettings.receiptThresholdCents). A grant whose
   * terms state their own receiptThresholdUsd uses that instead.
   */
  receiptThresholdCents?: number;
}

export const DEFAULT_RECEIPT_THRESHOLD_CENTS = 75_00;

/** Differences below this are not worth a human's attention for duplicate checks. */
export const MATERIALITY_CENTS = 250_00;

const usd = (c: number) => `$${(Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const isPayroll = (t: Txn) => isPayrollTxn(t);
const isOutflow = (t: Txn) => t.amountCents < 0;
const text = (t: Txn) => `${t.description} ${t.memo}`;

function daysBetween(a: string, b: string) {
  return Math.abs((Date.parse(a) - Date.parse(b)) / 86_400_000);
}

/** Keyword heuristics for unallowable categories. The model handles anything these miss. */
export const UNALLOWABLE_TERM_PATTERNS: { id: string; txn: RegExp; termRule: RegExp; label: string }[] = [
  { id: "fines", txn: /citation|violation|penalt|\bfine[sd]?\b|late fee/i, termRule: /fine|penalt|violation/i, label: "a fine or penalty" },
  { id: "fundraising", txn: /gala|benefit (gala|dinner|concert|event|auction|luncheon)|fundrais|donor (event|dinner)|auction/i, termRule: /fundrais/i, label: "a fundraising cost" },
  { id: "alcohol_staff", txn: /\bbar\b|brewery|winery|wine|liquor|happy hour/i,
    termRule: /alcohol|hospitality|staff (meals|appreciation)/i, label: "an alcohol purchase" },
  { id: "staff_event", txn: /staff (appreciation|party|outing|retreat|celebration)|appreciation (night|dinner|event|party)|holiday party|team[- ]building/i,
    termRule: /staff (meals|appreciation)|entertainment|social activit|recreation|team-building/i, label: "a staff event or meal" },
  { id: "lobbying", txn: /lobby|lobbying/i,
    termRule: /lobby|legislat|advocacy|appropriations|influence/i, label: "lobbying" },
];

/**
 * Alcohol as it is itemised on a receipt (a bar tab or a meal receipt with a glass of wine). Only item names
 * that are alcohol by themselves: "bar" and "ale" are left out because receipts print "granola bar", "ginger ale",
 * and "root beer" / "ginger beer" are soft drinks.
 */
export const ALCOHOL_ITEM = /\b(wines?|(?<!root |ginger |birch )beers?|pinot|cabernet|merlot|chardonnay|sauvignon|riesling|malbec|zinfandel|ros[ée] wine|prosecco|champagne|cava|sangria|mimosa|margarita|cocktail|cocktails|martini|mojito|vodka|whisk(?:e)?y|bourbon|scotch|tequila|mezcal|rum|gin|liquor|ipa|lager|pilsner|stout|porter|hard (?:cider|seltzer)|sake|soju)\b/i;
const ALCOHOL_TERM = /alcohol|liquor|wine|beer/i;

/**
 * The share of a charge that pays for alcohol itemised on its receipt, with its pro-rata share of tax and tip
 * (alcohol items ÷ item subtotal × receipt total, then this line's share of a split receipt). Null when no
 * item is alcohol; the whole line when the items carry no amounts to size it with.
 */
export function receiptAlcoholCents(t: Txn, cov: { receipt: ReceiptRecord; coveredCents: number } | undefined): { cents: number; items: string[] } | null {
  const x = cov?.receipt.extracted;
  if (!x || !cov) return null;
  const hits = x.lineItems.filter((i) => ALCOHOL_ITEM.test(i.description));
  if (!hits.length) return null;
  const own = -t.amountCents;
  const alcohol = hits.reduce((a, i) => a + Math.max(0, i.amountCents), 0);
  const subtotal = x.lineItems.reduce((a, i) => a + Math.max(0, i.amountCents), 0);
  const total = x.totalCents ?? cov.coveredCents;
  if (alcohol <= 0 || subtotal <= 0 || total <= 0 || cov.coveredCents <= 0) return { cents: own, items: hits.map((i) => i.description) };
  const onReceipt = Math.round((alcohol * total) / subtotal);
  const cents = Math.min(own, Math.round((onReceipt * own) / cov.coveredCents));
  return { cents, items: hits.map((i) => i.description) };
}

const QTY_IN_TEXT = /(?:\bqty\.?|\bquantity)\s*:?\s*(\d{1,4})\b|\b(\d{1,4})\s*(?:@|x\b|×|units?\b|pcs\b|ea\b)|(?:^|\s)[x×]\s*(\d{1,4})\b/i;

const ADD_ON_CHARGE = /\b(sales )?tax(es)?\b|\bvat\b|\bgst\b|deliver|shipping|freight|install|set[- ]?up\b|handling|\bsurcharge|\bfees?\b|\btip\b|gratuity|service charge|subtotal|\btotal\b/i;

/**
 * Highest per-unit cost on an itemized receipt, with its pro-rata share of tax and freight (item / quantity x
 * total / item subtotal). Quantity is the printed one, else one read from the item text ("5 @", "x5", "Qty 5"),
 * else 1. Null when the receipt has no itemized amounts.
 */
export function maxUnitCostCents(x: ReceiptExtract | null | undefined): number | null {
  // Tax, delivery, installation and similar charges are part of each unit's acquisition cost, not units themselves.
  const items = (x?.lineItems ?? []).filter((i) => i.amountCents > 0 && !ADD_ON_CHARGE.test(i.description));
  if (!items.length) return null;
  const subtotal = items.reduce((a, i) => a + i.amountCents, 0);
  const scale = x?.totalCents && subtotal > 0 ? Math.max(1, x.totalCents / subtotal) : 1;
  return Math.max(...items.map((i) => {
    const m = i.description.match(QTY_IN_TEXT);
    const qty = i.quantity ?? (m ? Number(m[1] ?? m[2] ?? m[3]) : 1);
    return Math.round((i.amountCents / Math.max(1, qty)) * scale);
  }));
}

export function runRules(input: RuleInput): Finding[] {
  const { txns, gl, staff, grants, precedents, candidates } = input;
  const grantById = new Map(grants.map((g) => [g.grantId, g]));
  const txnById = new Map(txns.map((t) => [t.txnId, t]));
  const findings: Finding[] = [];
  const blockedOrDup = new Set<string>();
  const coverage = receiptCoverage((input.receipts ?? []).filter((r) => r.extracted), txns);

  // R-DEPOSIT-MISMATCH: bank is the system of record for cash.
  for (const row of gl) {
    const t = txnById.get(row.bankRef);
    if (!t) {
      findings.push({ ruleId: "R-GL-ORPHAN", txnId: row.bankRef, status: "needs_review",
        message: `Ledger entry "${row.description}" has no matching bank transaction.`,
        evidence: [{ source: "gl", ref: row.bankRef, note: `entered by ${row.enteredBy}` }] });
      continue;
    }
    if (t.amountCents !== row.amountCents) {
      findings.push({ ruleId: "R-DEPOSIT-MISMATCH", txnId: t.txnId, status: "needs_review",
        message: `Ledger records ${usd(row.amountCents)} but the bank shows ${usd(t.amountCents)}. The bank is the system of record for cash, so the ledger entry should be corrected by ${usd(row.amountCents - t.amountCents)}.`,
        evidence: [
          { source: "bank", ref: t.txnId, note: `${t.date} ${t.description} ${usd(t.amountCents)}` },
          { source: "gl", ref: row.bankRef, note: `${row.account} ${usd(row.amountCents)} (entered by ${row.enteredBy})` },
        ] });
    }
  }

  for (const t of txns) {
    const c = candidates.get(t.txnId);
    const g = c?.grantId ? grantById.get(c.grantId) : undefined;

    // R-PERIOD: costs must be incurred within the grant period.
    if (g && isOutflow(t) && (t.date < g.periodStart || t.date > g.periodEnd)) {
      blockedOrDup.add(t.txnId);
      findings.push({ ruleId: "R-PERIOD", txnId: t.txnId, status: "blocked",
        message: `Incurred ${t.date}, outside ${g.grantId}'s period (${g.periodStart} to ${g.periodEnd}). Cannot be charged to this grant; move to unrestricted funds.`,
        evidence: [{ source: "contract", ref: `${g.grantId} period of performance`, note: `${g.periodStart} – ${g.periodEnd}` },
                   { source: "bank", ref: t.txnId, note: `${t.date} ${t.description}` }],
        suggestion: [{ grantId: null, budgetLine: null, amountCents: t.amountCents }] });
    } else if (g && isOutflow(t) && t.source === "gl") {
      // GL-first: the date a cost was incurred is the vendor's document date, not the date it was booked. An
      // invoice dated before the period (booked inside it) is a pre-award cost the funder returns.
      const cov = coverage.get(t.txnId);
      const rd = cov?.receipt.extracted?.date;
      if (rd && (rd < g.periodStart || rd > g.periodEnd)) {
        blockedOrDup.add(t.txnId);
        findings.push({ ruleId: "R-PERIOD", txnId: t.txnId, status: "blocked",
          message: `Booked ${t.date}, but the matched ${/invoice/i.test(cov!.receipt.fileName) ? "invoice" : "receipt/invoice"} is dated ${rd}, outside ${g.grantId}'s period (${g.periodStart} to ${g.periodEnd}): the cost was incurred ${rd < g.periodStart ? "before the period began" : "after the period ended"}. Cannot be charged to this grant; move to unrestricted funds.`,
          evidence: [{ source: "contract", ref: `${g.grantId} period of performance`, note: `${g.periodStart} – ${g.periodEnd}` },
                     { source: "receipt", ref: cov!.receipt.receiptId, note: receiptNote(cov!.receipt) },
                     { source: "gl", ref: t.txnId, note: `${t.date} ${t.vendor ?? t.description}` }],
          suggestion: [{ grantId: null, budgetLine: null, amountCents: t.amountCents }] });
      }
    }

    // R-UNALLOWABLE: keyword heuristics matched against the grant's own unallowable list.
    if (g && isOutflow(t)) {
      for (const p of UNALLOWABLE_TERM_PATTERNS) {
        if (!p.txn.test(text(t))) continue;
        const terms = g.unallowable.filter((u) => p.termRule.test(u.rule));
        if (!terms.length) continue;
        blockedOrDup.add(t.txnId);
        findings.push({ ruleId: `R-UNALLOWABLE-${p.id.toUpperCase()}`, txnId: t.txnId, status: "blocked",
          message: `This looks like ${p.label}. The ${g.program?.trim() || g.grantId} grant doesn't allow that (${terms.map((u) => u.clauseRef).join("; ")}), so it should move to unrestricted funds.`,
          evidence: [...terms.map<Evidence>((u) => ({ source: "contract", ref: u.clauseRef, note: u.rule })),
                     { source: "bank", ref: t.txnId, note: text(t) }],
          suggestion: [{ grantId: null, budgetLine: null, amountCents: t.amountCents }] });
        break;
      }
      // Alcohol itemised on the matched receipt (e.g. wine with an otherwise allowable meal): that share,
      // with its tax and tip, can't be billed as booked → blocked, with the alcohol share moved off the grant.
      const terms = g.unallowable.filter((u) => ALCOHOL_TERM.test(u.rule));
      const alc = !blockedOrDup.has(t.txnId) && terms.length ? receiptAlcoholCents(t, coverage.get(t.txnId)) : null;
      if (alc && alc.cents > 0) {
        const own = -t.amountCents;
        const whole = alc.cents >= own;
        const r = coverage.get(t.txnId)!.receipt;
        findings.push({ ruleId: "R-UNALLOWABLE-ALCOHOL_STAFF", txnId: t.txnId, status: "blocked",
          message: `The receipt lists alcohol (${alc.items.join(", ")}). The ${g.program?.trim() || g.grantId} grant doesn't allow alcohol (${terms.map((u) => u.clauseRef).join("; ")}), even with an otherwise allowable meal, so ${whole ? "this charge" : `${usd(alc.cents)} of it (the alcohol with its share of tax and tip)`} can't be billed as booked. Move ${whole ? "it" : "that share"} to unrestricted funds.`,
          evidence: [...terms.map<Evidence>((u) => ({ source: "contract", ref: u.clauseRef, note: u.rule })),
                     { source: "receipt", ref: r.receiptId, note: receiptNote(r) }],
          suggestion: whole
            ? [{ grantId: null, budgetLine: null, amountCents: t.amountCents }]
            : [{ grantId: c!.grantId, budgetLine: c!.budgetLine, amountCents: t.amountCents + alc.cents }, { grantId: null, budgetLine: null, amountCents: -alc.cents }],
          exposureCents: alc.cents });
      }
    }

    // R-PRIOR-APPROVAL: single purchases at or above a contract threshold.
    if (g && isOutflow(t) && !isPayroll(t)) {
      for (const pa of g.priorApproval) {
        if (pa.thresholdUsd == null || -t.amountCents < pa.thresholdUsd * 100) continue;
        if (/stipend|payout/i.test(text(t))) continue;
        const thresholdCents = pa.thresholdUsd * 100;
        if (pa.perUnit) {
          // A per-unit test: several items below the threshold bought together are not one item at the threshold.
          const unit = maxUnitCostCents(coverage.get(t.txnId)?.receipt.extracted);
          if (unit != null && unit < thresholdCents) continue;
          if (unit == null) {
            findings.push({ ruleId: "R-PRIOR-APPROVAL", txnId: t.txnId, status: "needs_review",
              message: `${usd(t.amountCents)} purchase meets the ${usd(thresholdCents)} per-unit prior-approval threshold in total (${pa.clauseRef}), but no itemized invoice shows the per-unit cost. Attach the invoice: if any one item costs ${usd(thresholdCents)} or more, the funder's written approval is needed.`,
              evidence: [{ source: "contract", ref: pa.clauseRef, note: pa.rule }], exposureCents: -t.amountCents });
            continue;
          }
        }
        const prior = precedents.filter((p) => p.scope === g.grantId && /prior approval/i.test(p.ruling));
        // Can't be billed as booked until the funder approves: blocked, held off the grant meanwhile. The way out
        // is to record the funder's written approval (a human resolution), which keeps the bookkeeper's coding.
        findings.push({ ruleId: "R-PRIOR-APPROVAL", txnId: t.txnId, status: "blocked",
          message: `${usd(t.amountCents)} single purchase meets the ${usd(pa.thresholdUsd * 100)} prior-approval threshold (${pa.clauseRef}). No approval on file, so it can't be billed yet. Record the funder's written approval, or move it to unrestricted funds.`,
          evidence: [{ source: "contract", ref: pa.clauseRef, note: pa.rule },
                     ...prior.map<Evidence>((p) => ({ source: "precedent", ref: p.id, note: `${p.date} ${p.by}: ${p.ruling}` }))],
          suggestion: [{ grantId: null, budgetLine: null, amountCents: t.amountCents }],
          exposureCents: -t.amountCents });
      }
    }
  }

  // R-DUPLICATE: same vendor + same amount within 3 days, above materiality
  // (small identical recurring charges like transit reloads are normal, not duplicates).
  const outflows = txns.filter((t) => isOutflow(t) && -t.amountCents >= MATERIALITY_CENTS)
    .sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 0; i < outflows.length; i++) {
    for (let j = i + 1; j < outflows.length; j++) {
      const a = outflows[i], b = outflows[j];
      if (daysBetween(a.date, b.date) > 3) break;
      if (a.amountCents === b.amountCents && a.description === b.description && !isPayroll(a)) {
        blockedOrDup.add(b.txnId);
        findings.push({ ruleId: "R-DUPLICATE", txnId: b.txnId, status: "needs_review",
          message: `Possible duplicate of ${a.txnId}: same vendor and amount (${usd(b.amountCents)}) ${daysBetween(a.date, b.date)} day(s) apart. Confirm with the vendor before it is charged to a grant.`,
          evidence: [{ source: "bank", ref: a.txnId, note: `${a.date} ${a.description} ${usd(a.amountCents)}` },
                     { source: "bank", ref: b.txnId, note: `${b.date} ${b.description} ${usd(b.amountCents)}` }] });
      }
    }
  }

  // R-EFFORT: salary charged to a grant beyond the documented time-and-effort share.
  for (const t of txns.filter(isPayroll)) {
    const c = candidates.get(t.txnId);
    if (!c?.grantId) continue;
    if (t.source === "gl") {
      const f = glEffortFinding(t, c, txns, staff);
      if (f) findings.push(f);
      continue;
    }
    const person = matchStaffForTxn(t, staff);
    if (!person) continue;
    const key = `${c.grantId}:${c.budgetLine}`;
    const allowedPct = person.allocation.find((a) => a.key === key)?.pct ?? 0;
    if (allowedPct >= 0.999) continue;
    const over = Math.round(-t.amountCents * (1 - allowedPct));
    findings.push({ ruleId: "R-EFFORT", txnId: t.txnId, status: "needs_review",
      message: `${person.employee}'s pay (${usd(t.amountCents)}) is charged 100% to ${key}, but time records allocate ${Math.round(allowedPct * 100)}%. Overcharge: ${usd(over)}. Split per the allocation.`,
      evidence: [{ source: "time_record", ref: `staff_allocation:${person.employee}`, note: person.allocation.map((a) => `${a.key}=${Math.round(a.pct * 100)}%`).join("; ") },
                 { source: c.origin === "gl" ? "gl" : "rule", ref: t.txnId, note: `charged to ${key}` }],
      suggestion: allocationSplit(t.amountCents, person.allocation) });
  }

  // R-LINE-OVERRUN: cumulative spend per grant line vs budget + allowed variance.
  for (const g of grants) {
    if (g.lineVarianceLimitPct == null) continue;
    for (const line of g.budgetLines) {
      const cap = Math.round(line.amount * 100 * (1 + g.lineVarianceLimitPct / 100));
      let running = 0;
      const charged = txns
        .filter((t) => { const c = candidates.get(t.txnId); return c?.grantId === g.grantId && c.budgetLine === line.code && !blockedOrDup.has(t.txnId); })
        .sort((a, b) => a.date.localeCompare(b.date));
      for (const t of charged) {
        running += -t.amountCents;
        if (running > cap) {
          // Only the portion over the cap (budget + allowed variance) can't be billed without a budget revision.
          const own = -t.amountCents;
          const over = Math.min(own, running - cap);
          findings.push({ ruleId: "R-LINE-OVERRUN", txnId: t.txnId, status: "blocked",
            message: `This charge takes ${g.grantId} line ${line.code} (${line.name}) to ${usd(running)} vs budget ${usd(line.amount * 100)} — over the ${g.lineVarianceLimitPct}% variance allowed without approval (cap ${usd(cap)}). ${over >= own ? "This charge" : `${usd(over)} of it`} can't be billed without the funder's approval of a budget change. Record that approval, or move the excess to unrestricted funds.`,
            evidence: [{ source: "contract", ref: `${g.grantId} budget ${line.code}`, note: `budget ${usd(line.amount * 100)}, variance limit ${g.lineVarianceLimitPct}%` }],
            suggestion: over >= own
              ? [{ grantId: null, budgetLine: null, amountCents: t.amountCents }]
              : [{ grantId: g.grantId, budgetLine: line.code, amountCents: t.amountCents + over }, { grantId: null, budgetLine: null, amountCents: -over }],
            exposureCents: over });
          break;
        }
      }
    }
  }

  if (txns.some((t) => t.source === "gl")) findings.push(...indirectRateFindings(input));
  if (input.bankLines?.length) findings.push(...reconciliationFindings(input));
  findings.push(...receiptFindings(input));

  return findings;
}

/**
 * Reconciliation findings (GL-first, bank file present). Always needs_review; at-risk is 0 unless
 * the line is charged to a grant (bank-only lines are not charged to anything yet).
 */
export function reconciliationFindings(input: RuleInput): Finding[] {
  const bank = input.bankLines ?? [];
  const glLines = input.txns.filter((t) => t.source !== "bank");
  const rec = reconcileGlToBank(glLines, bank);
  const out: Finding[] = [];
  const chargedGrant = (t: Txn) => t.glClass ?? input.candidates.get(t.txnId)?.grantId ?? null;
  const bankEv = (b: BankLine): Evidence => ({ source: "bank", ref: b.lineId, note: `${b.date} ${b.description} ${usd(b.amountCents)}` });
  const bankById = new Map(bank.map((b) => [b.lineId, b]));

  for (const b of rec.unrecorded) {
    out.push({ ruleId: "R-BANK-UNRECORDED", txnId: b.lineId, status: "needs_review",
      message: `The bank shows ${usd(b.amountCents)} to "${b.description}" on ${b.date}, but no GL line records it (same amount within 3 days). Record it in the books or explain it.`,
      evidence: [bankEv(b)], exposureCents: 0 });
  }

  for (const t of glLines) {
    const m = rec.matches.get(t.txnId);
    const grant = chargedGrant(t);
    if (!m) {
      if (t.amountCents >= 0 || !rec.statementStart || !rec.statementEnd) continue;
      if (t.date < rec.statementStart || t.date > rec.statementEnd) continue;
      if (NON_CASH_TYPE.test(t.txnType ?? "") || isPayrollTxn(t)) continue;
      out.push({ ruleId: "R-GL-NO-BANK", txnId: t.txnId, status: "needs_review",
        message: `GL line ${t.txnId} (${t.vendor ?? t.description}, ${usd(t.amountCents)}, ${t.date}) has no matching bank line on the statement (${rec.statementStart} to ${rec.statementEnd}). Confirm it was paid before billing it.`,
        evidence: [{ source: "gl", ref: t.txnId, note: `${t.date} ${t.account ?? ""} ${usd(t.amountCents)}`.trim() }],
        exposureCents: grant ? Math.abs(t.amountCents) : 0 });
      continue;
    }
    if (m.tier === "near" && m.bankAmountCents !== t.amountCents) {
      const diff = Math.abs(Math.abs(m.bankAmountCents) - Math.abs(t.amountCents));
      const b = bankById.get(m.bankLineId)!;
      out.push({ ruleId: "R-AMOUNT-MISMATCH", txnId: t.txnId, status: "needs_review",
        message: `The GL records ${usd(t.amountCents)} but the matching bank line shows ${usd(m.bankAmountCents)} (difference ${usd(diff)}). Correct the GL before billing; a one-cent difference returns the whole invoice.`,
        evidence: [{ source: "gl", ref: t.txnId, note: `${t.date} ${t.vendor ?? t.description} ${usd(t.amountCents)}` }, bankEv(b)],
        exposureCents: grant ? diff : 0 });
    }
  }
  return out;
}

export const receiptNote = (r: ReceiptRecord) => {
  const x = r.extracted;
  if (!x) return `${r.fileName} (not read)`;
  const items = x.lineItems.slice(0, 3).map((i) => i.description).join(", ");
  return `${x.vendor ?? "Unknown vendor"} receipt, ${x.totalCents == null ? "total not printed" : usd(x.totalCents)} on ${x.date ?? "an unprinted date"}${items ? `: ${items}` : ""}`;
};

/**
 * Receipt rules (all needs_review, never blocked):
 * - R-RECEIPT-MISSING: grant-charged line ≥ threshold with no matched receipt (only when receipts were provided).
 * - R-RECEIPT-AMBIGUOUS: a receipt ties between this line and others; a person must link it.
 * - R-RECEIPT-MISMATCH: matched receipt total differs by ≥1 cent, or its date is >5 days from the line.
 * - R-PURPOSE-UNCLEAR (GL-first): the same vendor is charged to ≥2 grants in one billing month and
 *   this line has neither a memo nor a matched receipt — the two-Office-Depot problem.
 * A receipt matched to a split group documents every row of that group (lib/matchReceipts.ts).
 */
export function receiptFindings(input: RuleInput): Finding[] {
  const out: Finding[] = [];
  const glFirst = input.txns.some((t) => t.source === "gl");
  const receipts = input.receipts;
  const grantById = new Map(input.grants.map((g) => [g.grantId, g]));
  const thresholdOf = (grantId: string) => receiptThresholdFor(grantById.get(grantId), input.receiptThresholdCents ?? DEFAULT_RECEIPT_THRESHOLD_CENTS);
  const chargedGrant = (t: Txn) => t.glClass ?? input.candidates.get(t.txnId)?.grantId ?? null;
  const lines = input.txns.filter((t) => t.amountCents < 0 && !(glFirst && t.source === "bank"));
  // A receipt documents its matched line, or the whole split group it was matched to.
  const coverage = receiptCoverage(receipts ?? [], input.txns);
  const ambiguous = new Map<string, ReceiptRecord[]>();
  for (const r of receipts ?? []) {
    if (r.matchedTxnId) continue;
    for (const id of r.candidates ?? []) ambiguous.set(id, [...(ambiguous.get(id) ?? []), r]);
  }

  for (const t of lines) {
    const grant = chargedGrant(t);
    const abs = -t.amountCents;
    const cov = coverage.get(t.txnId);
    const r = cov?.receipt;
    const threshold = grant ? thresholdOf(grant) : 0;
    // The charged grant's own documentation clause can exempt a charge (rent under the lease on file).
    const gt = grant ? grantById.get(grant) : undefined;
    const wsCents = input.receiptThresholdCents ?? DEFAULT_RECEIPT_THRESHOLD_CENTS;
    if (receipts && !r && grant && receiptRequired(abs, gt, wsCents) && !receiptExempt(t) && !contractReceiptExemption(t, grantById.get(grant))) {
      const tie = ambiguous.get(t.txnId);
      if (tie?.length) {
        const others = [...new Set(tie.flatMap((x) => x.candidates ?? []))].filter((id) => id !== t.txnId);
        out.push({ ruleId: "R-RECEIPT-AMBIGUOUS", txnId: t.txnId, status: "needs_review",
          message: `${tie.map((x) => x.fileName).join(", ")} could belong to this line or ${others.join(", ")} (same amount and date window). Link the receipt to the right line.`,
          evidence: tie.map<Evidence>((x) => ({ source: "receipt", ref: x.receiptId, note: receiptNote(x) })),
          exposureCents: abs });
      } else {
        out.push({ ruleId: "R-RECEIPT-MISSING", txnId: t.txnId, status: "needs_review",
          message: `${usd(t.amountCents)} charged to ${grant} has no receipt (required ${receiptThresholdText(gt, wsCents)}${grantById.get(grant)?.receiptThresholdUsd != null ? " by the contract" : ""}). Attach the receipt or invoice before billing.`,
          evidence: [{ source: "gl", ref: t.txnId, note: `${t.date} ${t.vendor ?? t.description} ${usd(t.amountCents)}` },
                     ...(grantById.get(grant)?.receiptThresholdUsd != null
                       ? [{ source: "contract" as const, ref: `${grant} receipt threshold`, note: `receipts required ${receiptThresholdText(gt, wsCents)}` }] : [])],
          exposureCents: abs });
      }
    }
    // Report a receipt difference once per receipt: on its first grant-charged covered line.
    const reportsFor = cov && (cov.lineIds.find((id) => { const l = input.txns.find((x) => x.txnId === id); return l && chargedGrant(l); }) ?? cov.lineIds[0]);
    if (r?.extracted && cov && reportsFor === t.txnId) {
      const x = r.extracted;
      const split = cov.lineIds.length > 1;
      const diff = x.totalCents == null ? null : Math.abs(x.totalCents - cov.coveredCents);
      const dateOff = x.date ? daysApart(x.date, t.date) : 0;
      if ((diff != null && diff >= 1) || dateOff > RECEIPT_DATE_WINDOW_DAYS) {
        const parts = [
          diff != null && diff >= 1 ? `the receipt total is ${usd(x.totalCents!)} vs ${usd(cov.coveredCents)} in the GL${split ? ` (split lines ${cov.lineIds.join(", ")})` : ""} (difference ${usd(diff)})` : null,
          dateOff > RECEIPT_DATE_WINDOW_DAYS ? `the receipt is dated ${x.date}, ${Math.round(dateOff)} days from the GL date ${t.date}` : null,
        ].filter(Boolean);
        out.push({ ruleId: "R-RECEIPT-MISMATCH", txnId: t.txnId, status: "needs_review",
          message: `Receipt doesn't match: ${parts.join("; ")}. Correct the GL or attach the right receipt.`,
          evidence: [{ source: "receipt", ref: r.receiptId, note: receiptNote(r) }],
          exposureCents: grant ? (diff ?? 0) : 0 });
      }
    }
  }

  if (glFirst) {
    const groups = new Map<string, Txn[]>();
    for (const t of lines) {
      if (receiptExempt(t)) continue;
      const k = `${vendorKey(t.vendor ?? t.description)}|${t.date.slice(0, 7)}`;
      groups.set(k, [...(groups.get(k) ?? []), t]);
    }
    for (const members of groups.values()) {
      const grants = new Set(members.map(chargedGrant).filter((g): g is string => !!g));
      if (grants.size < 2) continue;
      for (const t of members) {
        const grant = chargedGrant(t);
        // A matched receipt documents what was bought; the question is only for undocumented lines.
        if (!grant || t.memo.trim() || coverage.has(t.txnId)) continue;
        out.push({ ruleId: "R-PURPOSE-UNCLEAR", txnId: t.txnId, status: "needs_review",
          message: `${t.vendor ?? t.description} is charged to ${[...grants].join(" and ")} in ${t.date.slice(0, 7)}, and this ${usd(t.amountCents)} line has no memo or receipt note saying which program it was for. Attach a receipt or note which program this was for.`,
          evidence: members.filter((m) => m.txnId !== t.txnId).map<Evidence>((m) => ({ source: "gl", ref: m.txnId, note: `${m.date} ${usd(m.amountCents)} → ${chargedGrant(m) ?? "general funds"}` })),
          exposureCents: -t.amountCents });
      }
    }
  }
  return out;
}

/** Split an amount by allocation percentages; the last part takes the rounding remainder so the parts sum exactly. */
export function allocationSplit(amountCents: number, allocation: { key: string; pct: number }[]) {
  let used = 0;
  return allocation.map((a, i) => {
    const [grantId, budgetLine] = a.key === "UNRESTRICTED" ? [null, null] : (a.key.split(":") as [string, string]);
    const amt = i === allocation.length - 1 ? amountCents - used : Math.round(amountCents * a.pct);
    used += amt;
    return { grantId, budgetLine, amountCents: amt };
  });
}

/**
 * GL-first payroll: the GL already has one line per employee per class per paycheck, so each line is
 * checked against its share of that paycheck's gross (same employee + check number / pay date).
 * Returns the allowed cents for this line (null when not a matched payroll line).
 */
export function glPayrollShare(t: Txn, txns: Txn[], staff: StaffAllocation[], key: string) {
  const person = matchStaffForTxn(t, staff);
  if (!person) return null;
  const group = txns.filter((x) => x.source === "gl" && isPayrollTxn(x) && matchStaffForTxn(x, staff) === person &&
    (t.docRef ? x.docRef === t.docRef : x.date === t.date));
  const gross = group.reduce((a, x) => a + x.amountCents, 0);
  const pct = person.allocation.find((a) => a.key === key)?.pct ?? 0;
  return { person, grossCents: gross, pct, allowedCents: Math.round(gross * pct) };
}

function glEffortFinding(t: Txn, c: Candidate, txns: Txn[], staff: StaffAllocation[]): Finding | null {
  const key = `${c.grantId}:${c.budgetLine}`;
  const share = glPayrollShare(t, txns, staff, key);
  if (!share) return null;
  const over = share.allowedCents - t.amountCents; // amounts negative: positive = charged more than allowed
  if (over <= 1) return null; // within a cent of the allocation (bookkeeper rounding)
  const { person } = share;
  return { ruleId: "R-EFFORT", txnId: t.txnId, status: "needs_review",
    message: `${person.employee}'s ${key} share of this paycheck is ${usd(t.amountCents)}, but time records allocate ${Math.round(share.pct * 100)}% of ${usd(share.grossCents)} gross = ${usd(share.allowedCents)}. Overcharge: ${usd(over)}. Move it to unrestricted.`,
    evidence: [{ source: "time_record", ref: `staff_allocation:${person.employee}`, note: person.allocation.map((a) => `${a.key}=${Math.round(a.pct * 100)}%`).join("; ") },
               { source: "gl", ref: t.txnId, note: `charged to ${key}` }],
    suggestion: share.allowedCents
      ? [{ grantId: c.grantId, budgetLine: c.budgetLine, amountCents: share.allowedCents }, { grantId: null, budgetLine: null, amountCents: t.amountCents - share.allowedCents }]
      : [{ grantId: null, budgetLine: null, amountCents: t.amountCents }],
    exposureCents: over };
}

/**
 * R-INDIRECT-RATE (GL-first): the indirect line is computed once, to the cent, from the stated base
 * (e.g. 10% of the month's C1 salaries as booked). A booked allocation above the computed amount is a
 * claim the funder returns → blocked, with the excess moved to unrestricted; below it → needs_review.
 * Only grants whose terms state both the rate and its base are checked (a cap on direct costs is a
 * ceiling, handled at tie-out).
 */
export function indirectRateFindings(input: RuleInput): Finding[] {
  const out: Finding[] = [];
  const lines = input.txns.filter((t) => t.source === "gl");
  for (const g of input.grants) {
    const code = indirectLineCode(g);
    if (!code || g.indirectCapPct == null || !g.indirectBase) continue;
    const rateBps = Math.round(g.indirectCapPct * 100);
    const baseCodes = baseLineCodes(g, g.indirectBase, code);
    const months = new Map<string, { base: number; booked: Txn[] }>();
    for (const t of lines) {
      if (t.glClass !== g.grantId) continue;
      const m = months.get(t.date.slice(0, 7)) ?? { base: 0, booked: [] };
      if (t.glBudgetLine === code) m.booked.push(t);
      else if (t.glBudgetLine && baseCodes.includes(t.glBudgetLine)) m.base -= t.amountCents;
      months.set(t.date.slice(0, 7), m);
    }
    for (const [month, m] of months) {
      if (!m.booked.length) continue;
      const booked = m.booked.reduce((a, t) => a - t.amountCents, 0);
      const computed = applyRate(m.base, rateBps);
      if (booked === computed) continue;
      const t = [...m.booked].sort((a, b) => a.date.localeCompare(b.date) || a.txnId.localeCompare(b.txnId)).at(-1)!;
      const over = booked - computed;
      const ownCents = -t.amountCents;
      out.push({ ruleId: "R-INDIRECT-RATE", txnId: t.txnId, status: over > 0 ? "blocked" : "needs_review",
        message: `${month} indirect on ${g.grantId} ${code} is booked at ${usd(booked)}, but ${g.indirectCapPct}% of the ${g.indirectBase} base ${usd(m.base)} (lines ${baseCodes.join(", ")}) is ${usd(computed)} — ${over > 0 ? `over by ${usd(over)}. Claim the computed amount and move the excess to unrestricted.` : `under by ${usd(-over)}. Correct the allocation entry before billing.`}`,
        evidence: [{ source: "contract", ref: `${g.grantId} indirect rate`, note: `${g.indirectCapPct}% of ${g.indirectBase} (${baseCodes.join(", ")})` },
                   { source: "gl", ref: t.txnId, note: `${t.date} ${t.docRef ?? ""} ${usd(t.amountCents)} on ${code}`.replace(/\s+/g, " ") }],
        ...(over > 0 && over <= ownCents ? { suggestion: [{ grantId: g.grantId, budgetLine: code, amountCents: t.amountCents + over }, { grantId: null, budgetLine: null, amountCents: -over }] } : {}),
        exposureCents: Math.abs(over) });
    }
  }
  return out;
}
