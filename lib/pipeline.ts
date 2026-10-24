/**
 * Steward pipeline: model proposes → deterministic rules verify → human approves.
 * Pure functions + an injected ModelClient, so it runs the same in a Convex action,
 * a script, or a test with a fake model.
 */
import { type ModelClient, MODELS, pdfBlock } from "./llm";
import { CODING_SYSTEM, CodingZ, type Coding, DEFENSE_SYSTEM, DefenseZ, EXTRACT_SYSTEM } from "./prompts";
import { runRules } from "./rules";
import { type Candidate, type Decision, type Evidence, type Finding, type GlRow, type GrantTerms, GrantTermsZ,
  type Precedent, type StaffAllocation, type Status, type Txn } from "./types";

export interface PipelineInput {
  txns: Txn[]; gl: GlRow[]; staff: StaffAllocation[]; grants: GrantTerms[]; precedents: Precedent[];
}

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
const isPayroll = (t: Txn) => /payroll/i.test(t.description);
const RANK: Record<Status, number> = { auto: 0, needs_review: 1, blocked: 2 };
const worst = (a: Status, b: Status): Status => (RANK[b] > RANK[a] ? b : a);
const BATCH = 25;

/** Payroll is coded from time records (system of record for effort), not by the model. */
function codePayroll(t: Txn, staff: StaffAllocation[]): (Coding & { splits?: Decision["splits"] }) | null {
  const person = staff.find((s) => t.memo.includes(`(${s.employee})`));
  if (!person) return null;
  const parts = person.allocation.map((a) => {
    const [grantId, budgetLine] = a.key === "UNRESTRICTED" ? [null, null] : a.key.split(":");
    return { grantId, budgetLine, amount: Math.round(t.amountCents * a.pct) };
  });
  const single = parts.length === 1 ? parts[0] : null;
  return {
    txnId: t.txnId, grantId: single?.grantId ?? null, budgetLine: single?.budgetLine ?? null, confidence: 1,
    rationale: `Charged per ${person.employee}'s time-and-effort allocation (${person.allocation.map((a) => `${a.key} ${Math.round(a.pct * 100)}%`).join(", ")}).`,
    clauseRefs: [], concern: null, splits: single ? undefined : parts,
  };
}

export async function codeTransactions(model: ModelClient, input: PipelineInput, onProgress?: (done: number, total: number) => void) {
  const codings = new Map<string, Coding & { splits?: Decision["splits"] }>();
  const errors: string[] = [];
  let usage = { input: 0, output: 0 };
  const glByRef = new Map(input.gl.map((r) => [r.bankRef, r]));

  const forModel: Txn[] = [];
  for (const t of input.txns) {
    const p = isPayroll(t) ? codePayroll(t, input.staff) : null;
    if (p) codings.set(t.txnId, p); else forModel.push(t);
  }

  const context = JSON.stringify({
    grants: input.grants.map((g) => ({ grantId: g.grantId, program: g.program, restrictedPurpose: g.restrictedPurpose,
      period: [g.periodStart, g.periodEnd], budgetLines: g.budgetLines, unallowable: g.unallowable, priorApproval: g.priorApproval })),
    precedents: input.precedents,
  });

  for (let i = 0; i < forModel.length; i += BATCH) {
    const batch = forModel.slice(i, i + BATCH);
    const rows = batch.map((t) => {
      const g = glByRef.get(t.txnId);
      return { txnId: t.txnId, date: t.date, description: t.description, amountUsd: t.amountCents / 100, memo: t.memo,
        gl: g ? { class: g.class, budgetLine: g.budgetLine, enteredBy: g.enteredBy } : null };
    });
    try {
      const { data, usage: u } = await model.json({
        model: MODELS.bulk, system: CODING_SYSTEM, schema: CodingZ, toolName: "record_codings",
        toolDescription: "Record one coding per transaction.",
        content: [{ type: "text", text: `<context>${context}</context>\n<transactions>${JSON.stringify(rows)}</transactions>` }],
      });
      usage = { input: usage.input + u.input, output: usage.output + u.output };
      const validGrants = new Map(input.grants.map((g) => [g.grantId, new Set(g.budgetLines.map((l) => l.code))]));
      for (const c of data.codings) {
        if (!batch.some((t) => t.txnId === c.txnId)) continue; // ignore hallucinated ids
        // Guard: unknown grant/line → unrestricted + review (model output never decides by itself)
        if (c.grantId && (!validGrants.has(c.grantId) || (c.budgetLine && !validGrants.get(c.grantId)!.has(c.budgetLine)))) {
          codings.set(c.txnId, { ...c, grantId: null, budgetLine: null, confidence: 0,
            concern: { status: "needs_review", reason: `Model proposed unknown grant/line ${c.grantId}:${c.budgetLine}`, clauseRef: null } });
        } else codings.set(c.txnId, c);
      }
    } catch (e) {
      errors.push(`Batch ${i / BATCH + 1}: ${(e as Error).message}`);
    }
    for (const t of batch) if (!codings.has(t.txnId)) {
      codings.set(t.txnId, { txnId: t.txnId, grantId: null, budgetLine: null, confidence: 0, rationale: "Not coded: model call failed or skipped this row.",
        clauseRefs: [], concern: { status: "needs_review", reason: "No model coding available", clauseRef: null } });
    }
    onProgress?.(Math.min(i + BATCH, forModel.length), forModel.length);
  }
  return { codings, usage, errors };
}

// ---------------------------------------------------------------------------
const GL_PASS_RULES = /^R-(EFFORT|UNALLOWABLE|PERIOD|PRIOR-APPROVAL|DEPOSIT-MISMATCH|GL-ORPHAN)/;

export function verify(input: PipelineInput, codings: Map<string, Coding & { splits?: Decision["splits"] }>): Omit<PipelineResult, "usage" | "errors"> {
  const glByRef = new Map(input.gl.map((r) => [r.bankRef, r]));

  // Pass M: verify Steward's own proposals.
  const modelCands = new Map<string, Candidate>([...codings.values()].map((c) => [c.txnId,
    { txnId: c.txnId, grantId: c.splits ? null : c.grantId, budgetLine: c.splits ? null : c.budgetLine, origin: "model" as const }]));
  const fm = runRules({ ...input, candidates: modelCands });

  // Pass G: audit the bookkeeper's half-done work.
  const glCands = new Map<string, Candidate>(input.gl.map((r) => [r.bankRef,
    { txnId: r.bankRef, grantId: r.class, budgetLine: r.budgetLine, origin: "gl" as const }]));
  const fg = runRules({ ...input, candidates: glCands })
    .filter((f) => GL_PASS_RULES.test(f.ruleId))
    .map((f) => ({ ...f, message: f.ruleId === "R-DEPOSIT-MISMATCH" || f.ruleId === "R-GL-ORPHAN" ? f.message : `Bookkeeper's coding: ${f.message}` }));

  const seen = new Set<string>();
  const findings = [...fm, ...fg].filter((f) => { const k = `${f.txnId}|${f.ruleId}`; if (seen.has(k)) return false; seen.add(k); return true; });

  const decisions: Decision[] = input.txns.map((t) => {
    const c = codings.get(t.txnId)!;
    const fs = findings.filter((f) => f.txnId === t.txnId);
    const g = glByRef.get(t.txnId);
    let status: Status = c.confidence < 0.7 ? "needs_review" : "auto";
    if (c.concern) status = worst(status, c.concern.status);
    for (const f of fs) status = worst(status, f.status);

    let grantId = c.grantId, budgetLine = c.budgetLine, splits = c.splits;
    const sug = fs.find((f) => f.suggestion)?.suggestion;
    if (sug) {
      if (sug.length === 1) { grantId = sug[0].grantId; budgetLine = sug[0].budgetLine; splits = undefined; }
      else { grantId = null; budgetLine = null; splits = sug.map((s) => ({ grantId: s.grantId, budgetLine: s.budgetLine, amount: s.amountCents })); }
    }

    // Sources disagree: bookkeeper charged a different grant and no rule explains why.
    if (g && !fs.length && (g.class ?? null) !== (splits ? null : grantId) && !splits) {
      status = worst(status, "needs_review");
      findings.push({ ruleId: "R-GL-DISAGREE", txnId: t.txnId, status: "needs_review",
        message: `Bookkeeper charged ${g.class ?? "unrestricted"}${g.budgetLine ? ":" + g.budgetLine : ""}; Steward proposes ${grantId ?? "unrestricted"}${budgetLine ? ":" + budgetLine : ""}. ${c.rationale}`,
        evidence: [{ source: "gl", ref: t.txnId, note: `${g.account} / ${g.class ?? "-"} / ${g.budgetLine ?? "-"} by ${g.enteredBy}` }] });
    }

    const evidence: Evidence[] = [
      { source: "bank", ref: t.txnId, note: `${t.date} ${t.description} ${(t.amountCents / 100).toFixed(2)}${t.memo ? ` — "${t.memo}"` : ""}` },
      ...(g ? [{ source: "gl" as const, ref: t.txnId, note: `bookkeeper: ${g.class ?? "unrestricted"}${g.budgetLine ? ":" + g.budgetLine : ""}` }] : []),
      ...c.clauseRefs.map((r) => ({ source: "contract" as const, ref: r, note: "cited by Steward" })),
      ...(c.concern ? [{ source: "rule" as const, ref: c.concern.clauseRef ?? "model-concern", note: c.concern.reason }] : []),
      ...fs.flatMap((f) => f.evidence),
    ];
    return { txnId: t.txnId, grantId, budgetLine, splits, status, confidence: c.confidence,
      rationale: [c.rationale, ...findings.filter((f) => f.txnId === t.txnId).map((f) => f.message)].join(" "),
      evidence, ruleHits: findings.filter((f) => f.txnId === t.txnId).map((f) => f.ruleId) };
  });

  return { decisions, findings, entries: proposeEntries(input, decisions, findings) };
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

export async function runPipeline(model: ModelClient, input: PipelineInput, onProgress?: (done: number, total: number) => void): Promise<PipelineResult> {
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
