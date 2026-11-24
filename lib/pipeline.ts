/**
 * Steward pipeline: model proposes → deterministic rules verify → human approves.
 * Pure functions + an injected ModelClient, so it runs the same in a Convex action,
 * a script, or a test with a fake model.
 */
import { type ModelClient, MODELS, pdfBlock } from "./llm";
import { CODING_SYSTEM, CodingZ, type Coding, DEFENSE_SYSTEM, DefenseZ, EXTRACT_SYSTEM } from "./prompts";
import { atRiskCentsForTxn } from "./atRisk";
import { categorizeConcern, clauseRefEquals } from "./categorizeConcern";
import { grantLineText } from "./fundLabels";
import { isPayrollTxn, matchStaffForTxn } from "./payrollMatch";
import { glPayrollShare, MATERIALITY_CENTS, maxUnitCostCents, receiptNote, runRules } from "./rules";
import { isSoftRule } from "./softRules";
import { ruleLabel, tickForSource } from "./ruleLabels";
import { applyTypedPrecedentsForTxn } from "./typedPrecedents";
import { receiptCoverage, type ReceiptCoverage } from "./matchReceipts";
import { type BankLine, type Candidate, type Decision, type DecisionCheck, type Evidence, type Finding, type GlRow, type GrantTerms, GrantTermsZ,
  type Precedent, type ReceiptRecord, type StaffAllocation, type Status, type Txn, type TypedPrecedent } from "./types";

export interface PipelineInput {
  txns: Txn[]; gl: GlRow[]; staff: StaffAllocation[]; grants: GrantTerms[]; precedents: Precedent[];
  typedPrecedents?: TypedPrecedent[];
  /** Optional bank statement for GL-first reconciliation. */
  bankLines?: BankLine[];
  /** Receipts uploaded for this workspace (matched deterministically before the run). */
  receipts?: ReceiptRecord[];
  receiptThresholdCents?: number;
  /** The nonprofit whose books these are (workspace settings): receipts addressed to it are its own. */
  organizationName?: string;
}

/** Receipt per line: a receipt matched to a split group documents every row of that group. */
function receiptByTxn(receipts: ReceiptRecord[] | undefined, txns: Txn[]) {
  const m = new Map<string, ReceiptCoverage<ReceiptRecord>>();
  for (const [id, cov] of receiptCoverage((receipts ?? []).filter((r) => r.extracted), txns)) m.set(id, cov);
  return m;
}

/**
 * Monthly allocation journal entries (fringe, indirect): their basis is payroll and the contract rate,
 * both verified deterministically (R-EFFORT, R-INDIRECT-RATE, tie-out), so the model is not asked
 * to second-guess them.
 */
const ALLOCATION_JE = /alloc|indirect|fringe|benefit|overhead/i;
export function isAllocationEntry(t: Txn) {
  return t.source === "gl" && /journal/i.test(t.txnType ?? "") && ALLOCATION_JE.test(`${t.description} ${t.memo} ${t.account ?? ""}`);
}

/** GL-first workspace: the primary records are GL detail lines (source "gl"). */
export const isGlFirst = (txns: Txn[]) => txns.some((t) => t.source === "gl");
/** In a GL-first workspace a source "bank" record is a bank outflow missing from the GL. */
const isBankPlaceholder = (t: Txn, glFirst: boolean) => glFirst && t.source === "bank";
const hardOnly = (fs: Finding[]) => fs.filter((f) => !isSoftRule(f.ruleId));

export interface ProposedEntryDraft {
  txnId: string; date: string; memo: string; reason: string;
  lines: { account: string; class: string | null; budgetLine: string | null; debitCents: number; creditCents: number }[];
}

export interface PipelineResult {
  decisions: Decision[];
  findings: Finding[];
  entries: ProposedEntryDraft[];
  usage: { input: number; output: number };
  errors: string[];
}

// ---------------------------------------------------------------------------
export async function extractGrantTerms(model: ModelClient, pdfBase64: string): Promise<GrantTerms> {
  const { data } = await model.json({
    model: MODELS.judgment, system: EXTRACT_SYSTEM, toolName: "record_grant_terms",
    toolDescription: "Record the financial terms of this grant agreement.",
    schema: GrantTermsZ, content: [pdfBlock(pdfBase64), { type: "text", text: "Extract the grant terms." }],
  });
  return data;
}

// ---------------------------------------------------------------------------
const isPayroll = (t: Txn) => isPayrollTxn(t);
import { vendorKey } from "./vendorKey";
export { vendorKey };
const RANK: Record<Status, number> = { auto: 0, needs_review: 1, blocked: 2 };
const worst = (a: Status, b: Status): Status => (RANK[b] > RANK[a] ? b : a);
// GL-first rows carry GL dimensions, vendor history and receipt items; 25 codings overflowed 8k output tokens.
const BATCH = 12;

/**
 * GL-first payroll: the bookkeeper already split each paycheck into one line per class, so the claim
 * is checked against that line's share of the paycheck gross. Within a cent → keep the claim; more →
 * split the excess to unrestricted (R-EFFORT explains it); a class not in the allocation → unrestricted.
 */
function codePayrollGl(t: Txn, staff: StaffAllocation[], txns: Txn[]): (Coding & { splits?: Decision["splits"] }) | null {
  const key = t.glClass ? `${t.glClass}:${t.glBudgetLine}` : "UNRESTRICTED";
  const share = glPayrollShare(t, txns, staff, key);
  if (!share) return null;
  const { person } = share;
  const alloc = person.allocation.map((a) => `${a.key} ${Math.round(a.pct * 100)}%`).join(", ");
  const base = { txnId: t.txnId, confidence: 1, clauseRefs: [], concern: null };
  if (!t.glClass || share.allowedCents - t.amountCents <= 1) {
    return { ...base, grantId: t.glClass ?? null, budgetLine: t.glClass ? (t.glBudgetLine ?? null) : null,
      rationale: `${person.employee}'s paycheck line for ${key} is within the time-and-effort allocation (${alloc}).` };
  }
  if (!share.allowedCents) {
    return { ...base, grantId: null, budgetLine: null,
      rationale: `${person.employee}'s time records (${alloc}) allocate nothing to ${key}; charge general funds.` };
  }
  return { ...base, grantId: null, budgetLine: null,
    splits: [{ grantId: t.glClass, budgetLine: t.glBudgetLine ?? null, amount: share.allowedCents },
             { grantId: null, budgetLine: null, amount: t.amountCents - share.allowedCents }],
    rationale: `Charged per ${person.employee}'s time-and-effort allocation (${alloc}); the excess over ${Math.round(share.pct * 100)}% of the paycheck goes to general funds.` };
}

/** Allocation JE: keep the bookkeeper's claim when it names a real grant line (or general funds). */
function codeAllocationEntry(t: Txn, grants: GrantTerms[]): Coding | null {
  const cls = t.glClass ?? null, line = t.glBudgetLine ?? null;
  if (cls && !grants.find((g) => g.grantId === cls)?.budgetLines.some((l) => l.code === line)) return null;
  return { txnId: t.txnId, grantId: cls, budgetLine: cls ? line : null, confidence: 1, clauseRefs: [], concern: null,
    rationale: `Monthly allocation journal entry (${t.docRef || t.description}) kept on the bookkeeper's ${cls ? `${cls}:${line}` : "general funds"} coding; its base and rate are checked deterministically.` };
}

/** Payroll is coded from time records (system of record for effort), not by the model. */
function codePayroll(t: Txn, staff: StaffAllocation[]): (Coding & { splits?: Decision["splits"] }) | null {
  const person = matchStaffForTxn(t, staff);
  if (!person) return null;
  const parts = person.allocation.map((a, idx) => {
    const [grantId, budgetLine] = a.key === "UNRESTRICTED" ? [null, null] : a.key.split(":");
    if (idx === person.allocation.length - 1) {
      const prior = person.allocation
        .slice(0, idx)
        .reduce((sum, x) => sum + Math.round(t.amountCents * x.pct), 0);
      return { grantId, budgetLine, amount: t.amountCents - prior };
    }
    return { grantId, budgetLine, amount: Math.round(t.amountCents * a.pct) };
  });
  const single = parts.length === 1 ? parts[0] : null;
  return {
    txnId: t.txnId, grantId: single?.grantId ?? null, budgetLine: single?.budgetLine ?? null, confidence: 1,
    rationale: `Charged per ${person.employee}'s time-and-effort allocation (${person.allocation.map((a) => `${a.key} ${Math.round(a.pct * 100)}%`).join(", ")}).`,
    clauseRefs: [], concern: null, splits: single ? undefined : parts,
  };
}

export async function codeTransactions(model: ModelClient, input: PipelineInput, onProgress?: (done: number, total: number) => void | Promise<void>) {
  const codings = new Map<string, Coding & { splits?: Decision["splits"] }>();
  const errors: string[] = [];
  let usage = { input: 0, output: 0 };
  const glByRef = new Map(input.gl.map((r) => [r.bankRef, r]));

  const forModel: Txn[] = [];
  const glFirst = isGlFirst(input.txns);
  for (const t of input.txns) {
    if (isBankPlaceholder(t, glFirst)) {
      // Not in the books yet: nothing to code. Reconciliation rules ask a human to record it.
      codings.set(t.txnId, { txnId: t.txnId, grantId: null, budgetLine: null, confidence: 1,
        rationale: "Bank outflow with no GL line; it has to be recorded in the books before it can be coded.",
        clauseRefs: [], concern: null });
      continue;
    }
    const p = isAllocationEntry(t) ? codeAllocationEntry(t, input.grants)
      : !isPayroll(t) ? null : t.source === "gl" ? codePayrollGl(t, input.staff, input.txns) : codePayroll(t, input.staff);
    if (p) codings.set(t.txnId, p); else forModel.push(t);
  }

  const jsonForModel = (value: unknown) =>
    JSON.stringify(value).replace(/</g, "\\u003c");

  const context = jsonForModel({
    ...(input.organizationName?.trim() ? { organization: input.organizationName.trim() } : {}),
    grants: input.grants.map((g) => ({ grantId: g.grantId, program: g.program, restrictedPurpose: g.restrictedPurpose,
      period: [g.periodStart, g.periodEnd], budgetLines: g.budgetLines, unallowable: g.unallowable, priorApproval: g.priorApproval })),
    precedents: input.precedents,
  });

  // How the organization previously coded each vendor (from the GL), excluding the row itself.
  const memoByTxn = new Map(input.txns.map((t) => [t.txnId, t.memo]));
  const history = new Map<string, { class: string | null; budgetLine: string | null; memo: string; txnId: string; amountCents: number; date: string }[]>();
  for (const r of input.gl) {
    if (r.amountCents >= 0) continue;
    const k = vendorKey(r.description);
    history.set(k, [...(history.get(k) ?? []), { class: r.class, budgetLine: r.budgetLine, memo: memoByTxn.get(r.bankRef) ?? "", txnId: r.bankRef, amountCents: r.amountCents, date: r.date }]);
  }

  const validGrants = new Map(input.grants.map((g) => [g.grantId, new Set(g.budgetLines.map((l) => l.code))]));
  const receipts = receiptByTxn(input.receipts, input.txns);
  const batchStarts: number[] = [];
  for (let i = 0; i < forModel.length; i += BATCH) batchStarts.push(i);

  const batchResults = await Promise.all(
    batchStarts.map(async (i) => {
      const batch = forModel.slice(i, i + BATCH);
      const rows = batch.map((t) => {
        const g = glByRef.get(t.txnId);
        const vendorHistory = (history.get(vendorKey(t.description)) ?? []).filter((h) => h.txnId !== t.txnId).slice(-3)
          .map(({ class: c, budgetLine, memo, amountCents, date }) => ({ grantId: c, budgetLine, memo, amountUsd: amountCents / 100, date }));
        const cov = receipts.get(t.txnId);
        const r = cov?.receipt.extracted;
        return { txnId: t.txnId, date: t.date, description: t.description, amountUsd: t.amountCents / 100, memo: t.memo,
          gl: g ? { class: g.class, budgetLine: g.budgetLine, enteredBy: g.enteredBy,
            // GL-first: this is the bookkeeper's claim being checked, with its GL dimensions.
            ...(t.source === "gl" ? { account: t.account, department: t.department, docRef: t.docRef, txnType: t.txnType, vendor: t.vendor } : {}) } : null,
          vendorHistory,
          // Receipt text is untrusted data (escaped below with the rest of the row).
          ...(r && cov ? { receipt: { vendor: r.vendor, date: r.date, totalUsd: r.totalCents == null ? null : r.totalCents / 100,
            // Deterministic facts: does the printed total equal what the GL booked (for a split purchase, all its rows)?
            totalMatchesGl: r.totalCents != null && r.totalCents === cov.coveredCents,
            ...(cov.lineIds.length > 1 ? { splitAcrossLines: cov.lineIds.map((id) => { const x = input.txns.find((y) => y.txnId === id)!;
              return { txnId: id, class: x.glClass ?? null, budgetLine: x.glBudgetLine ?? null, amountUsd: x.amountCents / 100 }; }) } : {}),
            lineItems: r.lineItems.map((i) => ({ description: i.description, amountUsd: i.amountCents / 100 })), purposeText: r.purposeText } } : {}) };
      });
      try {
        const { data, usage: u } = await model.json({
          model: MODELS.bulk, system: CODING_SYSTEM, schema: CodingZ, toolName: "record_codings",
          toolDescription: "Record one coding per transaction.", maxTokens: 16000,
          content: [{ type: "text", text: `<context>${context}</context>\n<transactions>${jsonForModel(rows)}</transactions>` }],
        });
        return { i, batch, data, u, err: null as string | null };
      } catch (e) {
        return { i, batch, data: null, u: null, err: (e as Error).message };
      }
    }),
  );

  batchResults.sort((a, b) => a.i - b.i);
  let done = 0;
  for (const { i, batch, data, u, err } of batchResults) {
    if (err) errors.push(`Batch ${i / BATCH + 1}: ${err}`);
    else if (data && u) {
      usage = { input: usage.input + u.input, output: usage.output + u.output };
      for (const c of data.codings) {
        if (!batch.some((t) => t.txnId === c.txnId)) continue;
        const unknownGrant = c.grantId && !validGrants.has(c.grantId);
        const unknownLine =
          c.grantId &&
          (!c.budgetLine || !validGrants.get(c.grantId)?.has(c.budgetLine));
        if (unknownGrant || unknownLine) {
          codings.set(c.txnId, {
            ...c,
            grantId: null,
            budgetLine: null,
            confidence: 0,
            concern: {
              status: "needs_review",
              reason: `Model proposed unknown grant/line ${c.grantId ?? "?"}:${c.budgetLine ?? "?"}`,
              clauseRef: null,
            },
          });
        } else codings.set(c.txnId, c);
      }
    }
    for (const t of batch) {
      if (!codings.has(t.txnId)) {
        codings.set(t.txnId, {
          txnId: t.txnId,
          grantId: null,
          budgetLine: null,
          confidence: 0,
          rationale: "Not coded: model call failed or skipped this row.",
          clauseRefs: [],
          concern: { status: "needs_review", reason: "No model coding available", clauseRef: null },
        });
      }
    }
    done += batch.length;
    // Awaited: in a Convex action the callback runs a mutation, and an un-awaited call is still outstanding
    // when the action returns ("outstanding mutation call" warning, progress writes lost).
    await onProgress?.(Math.min(done, forModel.length), forModel.length);
  }
  return { codings, usage, errors };
}

// ---------------------------------------------------------------------------
const GL_PASS_RULES = /^R-(EFFORT|UNALLOWABLE|PERIOD|PRIOR-APPROVAL|DEPOSIT-MISMATCH|GL-ORPHAN|INDIRECT-RATE)/;
// GL-first: the bookkeeper's claim is what gets invoiced, so cumulative line variance is checked on it too.
const GL_FIRST_PASS_RULES = /^R-LINE-OVERRUN$/;

/** Concern categories that ask a question rather than cite a verified prohibition. */
const QUESTION_RULES = new Set(["R-NEEDS-DOCS", "R-MODEL-REVIEW"]);

export function verify(input: PipelineInput, codings: Map<string, Coding & { splits?: Decision["splits"] }>): Omit<PipelineResult, "usage" | "errors"> {
  const glByRef = new Map(input.gl.map((r) => [r.bankRef, r]));
  const receiptsByTxn = receiptByTxn(input.receipts, input.txns);
  const glFirst = isGlFirst(input.txns);

  // Pass M: verify Steward's own proposals.
  const modelCands = new Map<string, Candidate>([...codings.values()].map((c) => [c.txnId,
    { txnId: c.txnId, grantId: c.splits ? null : c.grantId, budgetLine: c.splits ? null : c.budgetLine, origin: "model" as const }]));
  const fm = runRules({ ...input, candidates: modelCands });

  // Pass G: audit the bookkeeper's half-done work.
  const glCands = new Map<string, Candidate>(input.gl.map((r) => [r.bankRef,
    { txnId: r.bankRef, grantId: r.class, budgetLine: r.budgetLine, origin: "gl" as const }]));
  const fg = runRules({ ...input, candidates: glCands })
    .filter((f) => GL_PASS_RULES.test(f.ruleId) || (glFirst && GL_FIRST_PASS_RULES.test(f.ruleId)))
    .map((f) => ({ ...f, message: f.ruleId === "R-DEPOSIT-MISMATCH" || f.ruleId === "R-GL-ORPHAN" ? f.message : `Bookkeeper's coding: ${f.message}` }));

  const seen = new Set<string>();
  const findings = [...fm, ...fg].filter((f) => { const k = `${f.txnId}|${f.ruleId}`; if (seen.has(k)) return false; seen.add(k); return true; });

  const decisions: Decision[] = input.txns.map((t) => {
    const c = codings.get(t.txnId)!;
    let txnFindings = findings.filter((f) => f.txnId === t.txnId);
    const g = glByRef.get(t.txnId);

    let grantId = c.grantId, budgetLine = c.budgetLine, splits = c.splits;
    const applySuggestion = (sug: NonNullable<Finding["suggestion"]>) => {
      if (sug.length === 1) { grantId = sug[0].grantId; budgetLine = sug[0].budgetLine; splits = undefined; }
      else { grantId = null; budgetLine = null; splits = sug.map((s) => ({ grantId: s.grantId, budgetLine: s.budgetLine, amount: s.amountCents })); }
    };
    const sugFinding = txnFindings.find((f) => f.suggestion);
    if (sugFinding) applySuggestion(sugFinding.suggestion!);

    let note = "";
    // Materiality may skip thin documentation, never contradicting evidence: an immaterial line is waived only
    // when its receipt/memo is positively consistent with the charged purpose and line (or there is none).
    const evidenceConsistent = materialityConsistent(t, c, receiptsByTxn.get(t.txnId));
    const glLineValid = !!g?.class && !!input.grants.find((x) => x.grantId === g.class)?.budgetLines.some((l) => l.code === g.budgetLine);
    let materialityAuto = false;
    const immaterial = Math.abs(t.amountCents) < MATERIALITY_CENTS;
    if (
      g &&
      glLineValid &&
      !hardOnly(txnFindings).length &&
      !splits &&
      grantId === null &&
      immaterial &&
      evidenceConsistent &&
      (!c.concern || c.concern.status === "needs_review")
    ) {
      grantId = g.class;
      budgetLine = g.budgetLine;
      materialityAuto = true;
      note = ` Immaterial (< $${MATERIALITY_CENTS / 100}); accepted the bookkeeper's coding ${g.class}:${g.budgetLine}.`;
    }

    // Sources disagree: bookkeeper charged a different grant and no rule explains why.
    if (g && !hardOnly(txnFindings).length && (g.class ?? null) !== (splits ? null : grantId) && !splits) {
      findings.push({ ruleId: "R-GL-DISAGREE", txnId: t.txnId, status: "needs_review",
        message: `Bookkeeper charged ${g.class ?? "unrestricted"}${g.budgetLine ? ":" + g.budgetLine : ""}; Steward proposes ${grantId ?? "unrestricted"}${budgetLine ? ":" + budgetLine : ""}.`,
        evidence: [{ source: "gl", ref: t.txnId, note: `${g.account} / ${g.class ?? "-"} / ${g.budgetLine ?? "-"} by ${g.enteredBy}` }] });
      txnFindings = findings.filter((f) => f.txnId === t.txnId);
    }

    // The model's concern is verified like any proposal: only an exact clause of the grant this line is
    // charged to (bookkeeper) or that Steward proposes can make it a block. Anything else is a question.
    let cat =
      c.concern && !materialityAuto
        ? categorizeConcern(
            { status: c.concern.status, reason: c.concern.reason, clauseRef: c.concern.clauseRef },
            input.grants,
            t,
            [g?.class, grantId, c.grantId, ...(splits ?? []).map((s) => s.grantId)],
          )
        : null;

    // GL-first: a documentation question (or low confidence) is not an exception when Steward agrees with
    // the bookkeeper, no rule fired, and the line is documented or nothing is at stake. A question citing a
    // verified prohibition is never waived, and an undocumented, material, uncertain line stays a question.
    const waiver = documentationWaiver(t, g, { grantId, budgetLine, splits }, txnFindings, receiptsByTxn.get(t.txnId), immaterial, c.confidence, evidenceConsistent);
    const waived = !!waiver && (!cat || QUESTION_RULES.has(cat.ruleId)) && (!!c.concern || c.confidence < 0.7);
    // An immaterial grant charge whose receipt or memo contradicts the coding (or leaves the program unclear) is a
    // "which program was this for?" question, not a waived one.
    if (!waived && immaterial && !evidenceConsistent && g?.class && t.amountCents < 0 && !hardOnly(txnFindings).length
        && (!cat || QUESTION_RULES.has(cat.ruleId)) && (!!c.concern || c.confidence < 0.7)) {
      const r = receiptsByTxn.get(t.txnId)?.receipt;
      cat = { ruleId: "R-PURPOSE-UNCLEAR", status: "needs_review",
        message: c.concern?.reason ?? `The ${r ? "receipt" : "memo"} doesn't show that this $${(Math.abs(t.amountCents) / 100).toFixed(2)} charge was for ${grantLineText(g.class, g.budgetLine, input.grants)}. Note which program it was for, or move it.`,
        evidence: [] };
    }
    const waivedCheck: DecisionCheck[] = [];
    let settled = false;
    // A per-unit prior-approval question the itemized receipt already answers (every unit below the threshold)
    // is settled by the deterministic check, not left open on the model's doubt.
    if (cat?.ruleId === "R-PRIOR-APPROVAL" && c.concern && !hardOnly(txnFindings).some((f) => f.ruleId === "R-PRIOR-APPROVAL")) {
      const ref = cat.evidence.find((e) => e.source === "contract")?.ref ?? c.concern.clauseRef ?? "";
      const pa = input.grants.flatMap((gr) => gr.priorApproval).find((p) => p.perUnit && p.thresholdUsd != null && clauseRefEquals(ref, p.clauseRef));
      const unit = pa ? maxUnitCostCents(receiptsByTxn.get(t.txnId)?.receipt.extracted) : null;
      if (pa && unit != null && unit < pa.thresholdUsd! * 100) {
        waivedCheck.push({ ruleId: null, label: "Question settled", tick: "Ⓡ",
          message: `${c.concern.reason} (settled: the itemized receipt shows a highest per-unit cost of $${(unit / 100).toFixed(2)}, below the $${pa.thresholdUsd!.toFixed(2)} per-unit threshold in ${pa.clauseRef})` });
        cat = null;
        settled = true;
      }
    }
    if (waived) {
      note += ` No exception: ${waiver}, and the coding agrees with the bookkeeper.`;
      if (c.concern) waivedCheck.push({ ruleId: null, label: "Question waived", message: `${c.concern.reason} (waived: ${waiver})`, tick: "Ⓑ" });
      cat = null;
    }

    let concernForApply: { status: Status; reason: string } | null =
      cat && c.concern ? { status: cat.status, reason: c.concern.reason } : null;

    // Soft findings (reconciliation, receipts) don't stand in for the model's own concern.
    if (cat && !hardOnly(txnFindings).length) {
      const derived: Finding = {
        ruleId: cat.ruleId,
        txnId: t.txnId,
        status: cat.status,
        message: cat.message,
        evidence: cat.evidence,
      };
      findings.push(derived);
      txnFindings = [...txnFindings, derived];
    }
    const precedentApply = applyTypedPrecedentsForTxn({
      t,
      grantId: splits ? null : grantId,
      budgetLine: splits ? null : budgetLine,
      findings: txnFindings,
      concern: concernForApply,
      typed: input.typedPrecedents ?? [],
      grants: input.grants,
      chargedGrantIds: [g?.class, c.grantId],
      untyped: input.precedents,
      chargedLines: [{ grantId: g?.class, budgetLine: g?.budgetLine }, { grantId: c.grantId, budgetLine: c.budgetLine }],
      citedPrecedentIds: c.clauseRefs.filter((r) => /^P\d+$/.test(r)),
      concernRuleId: cat?.ruleId ?? null,
    });
    // Substantive findings first so the queue label (ruleHits[0]) names the real issue.
    // Open questions (R-NEEDS-DOCS / R-MODEL-REVIEW) go last: a deterministic fact such as a $0.01 receipt
    // mismatch is the clearer thing to show and fix first.
    txnFindings = [...hardOnly(precedentApply.findings), ...precedentApply.findings.filter((f) => isSoftRule(f.ruleId))];
    txnFindings = [...txnFindings.filter((f) => !QUESTION_RULES.has(f.ruleId)), ...txnFindings.filter((f) => QUESTION_RULES.has(f.ruleId))];
    concernForApply = precedentApply.concern;
    if (!splits) {
      grantId = precedentApply.grantId;
      budgetLine = precedentApply.budgetLine;
    }
    // A ruling cleared the finding whose correction moved the coding (e.g. the funder's prior approval is on
    // file): the next remaining correction applies, else the coding the line had before that correction.
    if (sugFinding && !precedentApply.forcedStatus && !precedentApply.findings.includes(sugFinding)) {
      const next = precedentApply.findings.find((f) => f.suggestion);
      if (next) applySuggestion(next.suggestion!);
      else { grantId = c.grantId; budgetLine = c.budgetLine; splits = c.splits; }
    }

    // The model's doubt was the question a deterministic check just settled: its low confidence doesn't hold the line.
    let status: Status = c.confidence < 0.7 && !waived && !settled ? "needs_review" : "auto";
    if (concernForApply) status = worst(status, concernForApply.status);
    for (const f of txnFindings) status = worst(status, f.status);
    if (precedentApply.forcedStatus) status = precedentApply.forcedStatus;
    if (materialityAuto && status === "needs_review" && !txnFindings.length && !concernForApply) status = "auto";

    const checks: DecisionCheck[] = txnFindings.map((f) => ({
      ruleId: f.ruleId,
      label: ruleLabel(f.ruleId),
      message: f.message,
      tick: tickForSource(f.evidence[0]?.source ?? "bank"),
    }));
    if (concernForApply && !txnFindings.some((f) => f.ruleId === "R-MODEL-REVIEW" || f.ruleId === "R-NEEDS-DOCS" || f.ruleId.startsWith("R-UNALLOWABLE") || f.message === concernForApply!.reason)) {
      checks.push({
        ruleId: null,
        label: "Steward's judgment",
        message: concernForApply.reason,
        tick: "Ⓑ",
      });
    }
    checks.push(...precedentApply.checks, ...waivedCheck);

    const knownClauseRefs: string[] = [];
    for (const gr of input.grants) {
      for (const u of gr.unallowable) knownClauseRefs.push(u.clauseRef);
      for (const p of gr.priorApproval) knownClauseRefs.push(p.clauseRef);
    }
    const clauseRefOk = (ref: string) => !!ref.trim() && knownClauseRefs.some((k) => clauseRefEquals(ref, k));
    const keptClauseRefs = c.clauseRefs.filter(clauseRefOk);
    if (keptClauseRefs.length < c.clauseRefs.length) {
      checks.push({
        ruleId: null,
        label: "Verification",
        message: "Dropped an unverified clause reference.",
        tick: "Ⓒ",
      });
    }

    const clauseNote = (ref: string) => {
      if (!ref.trim()) return ref;
      for (const gr of input.grants) {
        for (const u of [...gr.unallowable, ...gr.priorApproval.map((p) => ({ rule: p.rule, clauseRef: p.clauseRef }))]) {
          if (clauseRefEquals(ref, u.clauseRef)) return u.rule;
        }
      }
      return ref;
    };

    const precById = new Map(input.precedents.map((p) => [p.id, p]));
    const receipt = receiptsByTxn.get(t.txnId)?.receipt;
    const evidence: Evidence[] = [
      t.source === "gl"
        ? { source: "gl", ref: t.txnId, note: `${t.date} ${t.vendor ?? t.description} ${(t.amountCents / 100).toFixed(2)} · ${t.account ?? ""}${t.docRef ? ` · #${t.docRef}` : ""}${t.memo ? ` — "${t.memo}"` : ""}` }
        : { source: "bank", ref: t.txnId, note: `${t.date} ${t.description} ${(t.amountCents / 100).toFixed(2)}${t.memo ? ` — "${t.memo}"` : ""}` },
      ...(g ? [{ source: "gl" as const, ref: t.txnId, note: `Bookkeeper coded it to ${grantLineText(g.class, g.budgetLine, input.grants)}` }] : []),
      ...(receipt ? [{ source: "receipt" as const, ref: receipt.receiptId, note: receiptNote(receipt) }] : []),
      ...c.clauseRefs
        .filter((r) => r.startsWith("P") && precById.has(r))
        .map((r) => ({ source: "precedent" as const, ref: r, note: precById.get(r)!.ruling })),
      ...keptClauseRefs.filter((r) => !r.startsWith("P")).map((r) => ({ source: "contract" as const, ref: r, note: clauseNote(r) })),
      ...(c.concern?.clauseRef && clauseRefOk(c.concern.clauseRef)
        ? [{ source: "contract" as const, ref: c.concern.clauseRef, note: clauseNote(c.concern.clauseRef) }]
        : []),
      ...txnFindings.flatMap((f) => f.evidence),
      ...precedentApply.evidence,
    ];

    const modelRationale = c.rationale + note;
    const atRiskCents = atRiskCentsForTxn(t, {
      txnId: t.txnId, grantId, budgetLine, splits, status, confidence: c.confidence,
      rationale: modelRationale, evidence, ruleHits: txnFindings.map((f) => f.ruleId),
    }, g, txnFindings, input.staff, input.grants);

    return {
      txnId: t.txnId, grantId, budgetLine, splits, status, confidence: c.confidence,
      rationale: modelRationale,
      modelRationale,
      checks,
      atRiskCents,
      evidence,
      ruleHits: txnFindings.map((f) => f.ruleId),
    };
  });

  return { decisions, findings, entries: proposeEntries(input, decisions, findings) };
}

/**
 * Why a GL-first line needs no human question even if the model was unsure: returns the basis, or null.
 * Requires agreement with the bookkeeper's coding and no finding of any kind (soft ones included). Bases:
 * general funds on both sides (no grant charged), a credit, under materiality, or (confidence >= 0.7) a
 * matched receipt whose total equals the GL amount.
 */
export function documentationWaiver(
  t: Txn, g: GlRow | undefined, coding: { grantId: string | null; budgetLine: string | null; splits?: Decision["splits"] },
  findings: Finding[], cov: ReceiptCoverage<ReceiptRecord> | undefined, immaterial: boolean, confidence: number,
  /** The receipt/memo is consistent with the charged purpose and line (see materialityConsistent). */
  evidenceConsistent = true,
): string | null {
  if (t.source !== "gl" || !g || coding.splits || findings.length) return null;
  if ((g.class ?? null) !== coding.grantId) return null;
  if (coding.grantId && (g.budgetLine ?? null) !== coding.budgetLine) return null;
  if (coding.grantId === null) return "it stays in general funds, so no grant is charged";
  if (t.amountCents > 0) return "it is a credit that reduces the grant charge";
  // Contradicting evidence is never waived: not by materiality, not by a receipt total that ties.
  if (!evidenceConsistent) return null;
  if (immaterial) return `it is under the $${MATERIALITY_CENTS / 100} materiality threshold`;
  // A material line is documented by a receipt whose total ties to the cent, unless Steward itself is unsure
  // of the coding (confidence < 0.7): an unresolved doubt on a material charge stays a question.
  const total = cov?.receipt.extracted?.totalCents;
  if (cov && total != null && total === cov.coveredCents && confidence >= 0.7) return "the matched receipt total equals the GL amount";
  return null;
}

/**
 * Positive consistency for the materiality waiver. With no receipt and no memo there is nothing to contradict
 * (thin documentation, which materiality may skip), whatever the model says. With a receipt or memo, the model must not report that it
 * contradicts the coding (evidenceFit "contradicts"); when it gives no evidenceFit, a concern raised with
 * confidence under 0.7 on a documented line means Steward could not reconcile the evidence with the coding.
 */
export function materialityConsistent(t: Txn, c: Pick<Coding, "concern" | "confidence" | "evidenceFit">, cov: ReceiptCoverage<ReceiptRecord> | undefined): boolean {
  // Only a receipt or memo can contradict the coding; vendor history or a missing note cannot.
  const documented = !!cov || !!t.memo.trim();
  if (!documented) return true;
  if (c.evidenceFit === "contradicts") return false;
  if (c.evidenceFit === "consistent" || c.evidenceFit === "thin") return true;
  return !c.concern || c.confidence >= 0.7;
}

/** Correcting journal entries for the bookkeeper's GL. Proposed only; a human must approve. */
function proposeEntries(input: PipelineInput, decisions: Decision[], findings: Finding[]): ProposedEntryDraft[] {
  const glByRef = new Map(input.gl.map((r) => [r.bankRef, r]));
  const entries: ProposedEntryDraft[] = [];
  for (const d of decisions) {
    const g = glByRef.get(d.txnId);
    if (!g || g.amountCents >= 0) continue;
    const target = d.splits ?? [{ grantId: d.grantId, budgetLine: d.budgetLine, amount: g.amountCents }];
    const same = target.length === 1 && (target[0].grantId ?? null) === (g.class ?? null) && (target[0].budgetLine ?? null) === (g.budgetLine ?? null);
    if (same || d.status === "auto") continue;
    const lines: ProposedEntryDraft["lines"] = [];
    for (const s of target) {
      if ((s.grantId ?? null) === (g.class ?? null) && (s.budgetLine ?? null) === (g.budgetLine ?? null)) continue;
      lines.push({ account: g.account, class: s.grantId, budgetLine: s.budgetLine, debitCents: -s.amount, creditCents: 0 });
    }
    const moved = lines.reduce((a, l) => a + l.debitCents, 0);
    if (!moved) continue;
    lines.push({ account: g.account, class: g.class, budgetLine: g.budgetLine, debitCents: 0, creditCents: moved });
    entries.push({ txnId: d.txnId, date: g.date, memo: `Reclass ${d.txnId} ${g.description}`,
      reason: findings.filter((f) => f.txnId === d.txnId).map((f) => f.message).join(" "), lines });
  }
  for (const f of findings.filter((x) => x.ruleId === "R-DEPOSIT-MISMATCH")) {
    const g = glByRef.get(f.txnId)!, t = input.txns.find((x) => x.txnId === f.txnId)!;
    const diff = g.amountCents - t.amountCents;
    if (!diff) continue;
    entries.push({ txnId: f.txnId, date: g.date, memo: `Correct ${g.description} to bank amount`, reason: f.message,
      lines: diff > 0
        ? [{ account: g.account, class: g.class, budgetLine: g.budgetLine, debitCents: diff, creditCents: 0 },
           { account: "1000 Operating Cash", class: null, budgetLine: null, debitCents: 0, creditCents: diff }]
        : [{ account: "1000 Operating Cash", class: null, budgetLine: null, debitCents: -diff, creditCents: 0 },
           { account: g.account, class: g.class, budgetLine: g.budgetLine, debitCents: 0, creditCents: -diff }] });
  }
  for (const e of entries) {
    const dr = e.lines.reduce((a, l) => a + l.debitCents, 0), cr = e.lines.reduce((a, l) => a + l.creditCents, 0);
    if (dr !== cr) throw new Error(`Unbalanced entry for ${e.txnId}: Dr ${dr} != Cr ${cr}`);
  }
  return entries;
}

export async function runPipeline(model: ModelClient, input: PipelineInput, onProgress?: (done: number, total: number) => void | Promise<void>): Promise<PipelineResult> {
  const { codings, usage, errors } = await codeTransactions(model, input, onProgress);
  return { ...verify(input, codings), usage, errors };
}

// ---------------------------------------------------------------------------
export async function defendDecision(model: ModelClient, args: { question: string; decision: Decision; grants: GrantTerms[] }) {
  const { data } = await model.json({
    model: MODELS.judgment, system: DEFENSE_SYSTEM, schema: DefenseZ, toolName: "answer_challenge",
    toolDescription: "Answer the challenge to this decision.", maxTokens: 1500,
    content: [{ type: "text", text: `<decision>${JSON.stringify(args.decision)}</decision>\n<grants>${JSON.stringify(args.grants)}</grants>\n<question>${args.question}</question>` }],
  });
  return data;
}
