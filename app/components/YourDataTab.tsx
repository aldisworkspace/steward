"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useCallback, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  assignTxnIds,
  detectAndParseBank,
  parseBankFlexible,
  type BankColumnMapping,
  type BankColumnRole,
} from "@/lib/parseFlexible";
import { parseFlexibleDate, parseFlexibleAmount } from "@/lib/parseFlexible";
import { parseCsv } from "@/lib/parse";
import { matchLedgerToBank, suggestLedgerMapping } from "@/lib/matchLedger";
import type { GrantTerms, StaffAllocation, Txn } from "@/lib/types";
import { getDemoPasscode } from "../lib/demoPasscode";
import { messageFromConvexError } from "../lib/convexError";
import { fmtTableAmount } from "../format";

const ROLES: BankColumnRole[] = ["date", "description", "amount", "debit", "credit", "memo", "skip"];

export function YourDataTab({
  canWrite,
  onError,
  onRunStarted,
}: {
  canWrite: boolean;
  onError: (m: string | null) => void;
  onRunStarted: () => void;
}) {
  const settings = useQuery(api.settings.get);
  const grantList = useQuery(api.grants.list);
  const updateSettings = useMutation(api.settings.update);
  const generateUploadUrl = useMutation(api.grants.generateUploadUrl);
  const registerGrant = useMutation(api.grants.registerGrant);
  const extractGrant = useAction(api.agent.extractGrant);
  const confirmTerms = useMutation(api.grants.confirmGrantTerms);
  const startWorkspace = useMutation(api.ingest.startCustomWorkspace);
  const runAgent = useAction(api.agent.runAgent);

  const [orgName, setOrgName] = useState("");
  const [bankRaw, setBankRaw] = useState<string | null>(null);
  const [bankMapping, setBankMapping] = useState<BankColumnMapping | null>(null);
  const [bankHeaders, setBankHeaders] = useState<string[]>([]);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [ledgerOrphans, setLedgerOrphans] = useState<{ description: string; date: string; amountCents: number }[]>([]);
  const [glRows, setGlRows] = useState<
    { bankRef: string; date: string; description: string; amountCents: number; account: string; class: string | null; budgetLine: string | null; enteredBy: string }[]
  >([]);
  const [staff, setStaff] = useState<StaffAllocation[]>([]);
  const [busy, setBusy] = useState(false);
  const [draftTerms, setDraftTerms] = useState<Record<string, GrantTerms>>({});

  const org = orgName || settings?.organizationName || "Valencia Youth Collective";
  const readyGrantIds = useMemo(
    () => (grantList ?? []).filter((g) => g.status === "ready").map((g) => g._id as Id<"grants">),
    [grantList],
  );

  const bankPreview = useMemo(() => {
    if (!bankRaw || !bankMapping) return [];
    const { rows } = parseBankFlexible(bankRaw, bankMapping);
    return rows.slice(0, 5);
  }, [bankRaw, bankMapping]);

  const saveOrg = useCallback(async () => {
    if (!canWrite) return;
    try {
      await updateSettings({ passcode: getDemoPasscode(), organizationName: org });
      onError(null);
    } catch (e) {
      onError(messageFromConvexError(e));
    }
  }, [canWrite, org, updateSettings, onError]);

  async function onGrantFiles(files: FileList | null) {
    if (!canWrite || !files?.length) return;
    setBusy(true);
    onError(null);
    try {
      for (const file of [...files]) {
        if (!file.name.toLowerCase().endsWith(".pdf")) continue;
        const uploadUrl = await generateUploadUrl({ passcode: getDemoPasscode() });
        const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": "application/pdf" }, body: file });
        if (!res.ok) throw new Error(`Upload failed: ${file.name}`);
        const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
        const grantDocId = await registerGrant({
          storageId,
          fileName: file.name,
          passcode: getDemoPasscode(),
          source: "upload",
        });
        await extractGrant({ grantDocId, passcode: getDemoPasscode() });
      }
    } catch (e) {
      onError(messageFromConvexError(e));
    } finally {
      setBusy(false);
    }
  }

  function onBankFile(text: string) {
    const detected = detectAndParseBank(text);
    setBankRaw(text);
    setBankHeaders(detected.headers);
    setBankMapping(detected.mapping);
    if (detected.error) {
      onError(detected.error);
      setTxns([]);
      return;
    }
    setTxns(detected.txns);
    onError(null);
  }

  function applyMapping(role: BankColumnRole, header: string | null) {
    if (!bankMapping || !bankRaw) return;
    const next = { ...bankMapping, [role]: header === "" ? null : header };
    setBankMapping(next);
    const { rows, error } = parseBankFlexible(bankRaw, next);
    if (error) {
      onError(error);
      setTxns([]);
      return;
    }
    setTxns(assignTxnIds(rows));
    onError(null);
  }

  function onLedgerFile(text: string) {
    const records = parseCsv(text);
    if (!records.length || !txns.length) return;
    const headers = Object.keys(records[0]!);
    const map = suggestLedgerMapping(headers);
    const ledgerRows = records.map((r) => ({
      date: parseFlexibleDate(r[map.date ?? headers[0]!] ?? ""),
      description: (r[map.description ?? ""] ?? "").trim(),
      amountCents: parseFlexibleAmount(r[map.amount ?? ""] ?? "0"),
      account: r[map.account ?? ""] ?? "5000 Program Expense",
      class: (r[map.class ?? ""] ?? "").trim() || null,
      budgetLine: (r[map.budgetLine ?? ""] ?? "").trim() || null,
      enteredBy: (r[map.enteredBy ?? ""] ?? "").trim() || "bookkeeper",
    }));
    const { gl, orphanFindings } = matchLedgerToBank(ledgerRows, txns);
    setGlRows(gl);
    setLedgerOrphans(orphanFindings);
  }

  async function onRunCustom() {
    if (!canWrite || !txns.length || !readyGrantIds.length) {
      onError("Upload bank transactions and confirm at least one grant.");
      return;
    }
    setBusy(true);
    onError(null);
    try {
      await startWorkspace({
        passcode: getDemoPasscode(),
        transactions: txns,
        glRows,
        staffAllocations: staff,
        grantDocIds: readyGrantIds,
      });
      await runAgent({ passcode: getDemoPasscode() });
      onRunStarted();
    } catch (e) {
      onError(messageFromConvexError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-10 p-6 text-[15px]">
      <section>
        <h2 className="text-[17px] font-semibold">Organization</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            className="rounded-[4px] border border-rule px-3 py-2"
            value={org}
            onChange={(e) => setOrgName(e.target.value)}
            onBlur={() => void saveOrg()}
            disabled={!canWrite}
          />
          <span className="text-[13px] text-ink-2">Shown in the header</span>
        </div>
      </section>

      <section>
        <h2 className="text-[17px] font-semibold">1. Grant agreements</h2>
        <p className="mt-1 text-[13px] text-ink-2">Drop one or more PDFs. Review and confirm terms before Steward uses them.</p>
        <label className="mt-3 flex cursor-pointer flex-col items-center rounded-[6px] border border-dashed border-rule bg-sheet px-6 py-8">
          <span className="text-ink-2">{busy ? "Working…" : "Drop PDFs here or click to browse"}</span>
          <input
            type="file"
            accept="application/pdf"
            multiple
            className="hidden"
            disabled={!canWrite || busy}
            onChange={(e) => void onGrantFiles(e.target.files)}
          />
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          {(grantList ?? [])
            .filter((g) => g.source === "upload")
            .map((g) => (
              <span key={g._id} className="rounded-[4px] border border-rule px-2 py-1 text-[13px]">
                {g.fileName}: {g.status}
                {g.error && <span className="text-redpen"> {g.error}</span>}
              </span>
            ))}
        </div>
        <GrantTermsFromQuery
          grants={grantList ?? []}
          draftTerms={draftTerms}
          setDraftTerms={setDraftTerms}
          canWrite={canWrite}
          confirmTerms={confirmTerms}
          onError={onError}
        />
      </section>

      <section>
        <h2 className="text-[17px] font-semibold">2. Bank export (CSV)</h2>
        <label className="mt-2 inline-block cursor-pointer text-ledger underline">
          Choose CSV
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            disabled={!canWrite}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              void f.text().then(onBankFile);
            }}
          />
        </label>
        {bankMapping && bankHeaders.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="text-[13px]">
              <tbody>
                {ROLES.filter((r) => r !== "skip").map((role) => (
                  <tr key={role}>
                    <td className="py-1 pr-4 capitalize text-ink-2">{role}</td>
                    <td>
                      <select
                        className="rounded border border-rule px-2 py-1"
                        value={bankMapping[role] ?? ""}
                        onChange={(e) => applyMapping(role, e.target.value || null)}
                      >
                        <option value="">—</option>
                        {bankHeaders.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {bankPreview.length > 0 && (
          <table className="mt-4 w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-rule text-left text-ink-2">
                <th className="py-1">Date</th>
                <th>Description</th>
                <th className="text-right">Amount</th>
                <th>Memo</th>
              </tr>
            </thead>
            <tbody>
              {bankPreview.map((r, i) => (
                <tr key={i} className="border-b border-rule">
                  <td className="py-1">{r.date}</td>
                  <td>{r.description}</td>
                  <td className="tabular text-right">{fmtTableAmount(r.amountCents)}</td>
                  <td className="text-ink-2">{r.memo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {txns.length > 0 && <p className="mt-2 text-[13px] text-ledger">{txns.length} transactions parsed</p>}
      </section>

      <section>
        <h2 className="text-[17px] font-semibold">3. Optional ledger &amp; staff</h2>
        <label className="mt-2 inline-block cursor-pointer text-ink-2 underline">
          Bookkeeper ledger CSV
          <input
            type="file"
            accept=".csv"
            className="hidden"
            disabled={!canWrite || !txns.length}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void f.text().then(onLedgerFile);
            }}
          />
        </label>
        {ledgerOrphans.length > 0 && (
          <p className="mt-2 text-[13px] text-pencil">
            {ledgerOrphans.length} ledger row(s) with no matching bank line (±3 days, same amount).
          </p>
        )}
        <StaffEditor staff={staff} setStaff={setStaff} canWrite={canWrite} grants={grantList ?? []} />
      </section>

      <button
        type="button"
        disabled={!canWrite || busy || !txns.length || readyGrantIds.length < 1}
        className="rounded-[4px] bg-ledger px-5 py-2.5 font-medium text-white disabled:opacity-40"
        onClick={() => void onRunCustom()}
      >
        Run Steward on my data
      </button>
    </div>
  );
}

function GrantTermsFromQuery({
  grants,
  draftTerms,
  setDraftTerms,
  canWrite,
  confirmTerms,
  onError,
}: {
  grants: { _id: string; fileName: string; status: string; grantId: string | null; error?: string }[];
  draftTerms: Record<string, GrantTerms>;
  setDraftTerms: (v: Record<string, GrantTerms>) => void;
  canWrite: boolean;
  confirmTerms: (args: { grantDocId: Id<"grants">; terms: GrantTerms; passcode?: string }) => Promise<unknown>;
  onError: (m: string | null) => void;
}) {
  const pending = grants.filter((g) => g.status === "pending_confirm" || g.status === "extracting");
  const fullGrants = useQuery(api.grants.listFull, pending.length ? {} : "skip");
  if (!fullGrants) return null;
  return (
    <>
      {fullGrants
        .filter((g) => g.status === "pending_confirm" && g.terms)
        .map((g) => {
          const id = g._id as string;
          const terms = (draftTerms[id] ?? g.terms) as GrantTerms;
          const lineSum = terms.budgetLines.reduce((a, l) => a + l.amount, 0);
          const sumOk = Math.round(lineSum * 100) === Math.round(terms.totalAward * 100);
          return (
            <article key={id} className="mt-4 rounded-[6px] border border-rule bg-sheet p-4">
              <h3 className="font-semibold">{g.fileName}</h3>
              <p className="text-[13px] text-ink-2">{terms.grantId} · {terms.funder}</p>
              {!sumOk && (
                <p className="mt-2 text-[13px] text-pencil">
                  Lines sum to ${lineSum.toLocaleString()}; award is ${terms.totalAward.toLocaleString()}
                </p>
              )}
              <TermsEditor terms={terms} onChange={(t) => setDraftTerms({ ...draftTerms, [id]: t })} />
              <button
                type="button"
                disabled={!canWrite}
                className="mt-4 rounded-[4px] bg-ledger px-4 py-2 text-[13px] font-medium text-white disabled:opacity-40"
                onClick={() =>
                  void confirmTerms({ grantDocId: g._id as Id<"grants">, terms, passcode: getDemoPasscode() })
                    .then(() => onError(null))
                    .catch((e) => onError(messageFromConvexError(e)))
                }
              >
                Confirm terms
              </button>
            </article>
          );
        })}
    </>
  );
}

function TermsEditor({ terms, onChange }: { terms: GrantTerms; onChange: (t: GrantTerms) => void }) {
  return (
    <div className="mt-3 space-y-2 text-[13px]">
      <label className="flex gap-2">
        Period
        <input
          type="date"
          value={terms.periodStart}
          onChange={(e) => onChange({ ...terms, periodStart: e.target.value })}
          className="rounded border border-rule px-1"
        />
        <input
          type="date"
          value={terms.periodEnd}
          onChange={(e) => onChange({ ...terms, periodEnd: e.target.value })}
          className="rounded border border-rule px-1"
        />
      </label>
      <label>
        Line variance %
        <input
          type="number"
          className="ml-2 w-16 rounded border border-rule px-1"
          value={terms.lineVarianceLimitPct ?? ""}
          onChange={(e) =>
            onChange({ ...terms, lineVarianceLimitPct: e.target.value ? Number(e.target.value) : null })
          }
        />
      </label>
      <table className="mt-2 w-full border-collapse">
        <thead>
          <tr className="text-left text-ink-2">
            <th>Code</th>
            <th>Name</th>
            <th>Amount ($)</th>
          </tr>
        </thead>
        <tbody>
          {terms.budgetLines.map((bl, i) => (
            <tr key={i}>
              <td>
                <input
                  className="w-full rounded border border-rule px-1"
                  value={bl.code}
                  onChange={(e) => {
                    const budgetLines = [...terms.budgetLines];
                    budgetLines[i] = { ...bl, code: e.target.value };
                    onChange({ ...terms, budgetLines });
                  }}
                />
              </td>
              <td>
                <input
                  className="w-full rounded border border-rule px-1"
                  value={bl.name}
                  onChange={(e) => {
                    const budgetLines = [...terms.budgetLines];
                    budgetLines[i] = { ...bl, name: e.target.value };
                    onChange({ ...terms, budgetLines });
                  }}
                />
              </td>
              <td>
                <input
                  type="number"
                  className="w-full rounded border border-rule px-1"
                  value={bl.amount}
                  onChange={(e) => {
                    const budgetLines = [...terms.budgetLines];
                    budgetLines[i] = { ...bl, amount: Number(e.target.value) };
                    onChange({ ...terms, budgetLines });
                  }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StaffEditor({
  staff,
  setStaff,
  canWrite,
  grants,
}: {
  staff: StaffAllocation[];
  setStaff: (s: StaffAllocation[]) => void;
  canWrite: boolean;
  grants: { grantId: string | null; status: string }[];
}) {
  const grantIds = grants.filter((g) => g.status === "ready" && g.grantId).map((g) => g.grantId!);

  function addRow() {
    setStaff([
      ...staff,
      {
        employee: "",
        role: "",
        biweeklyCents: 0,
        allocation: [{ key: "UNRESTRICTED", pct: 1 }],
      },
    ]);
  }

  return (
    <div className="mt-4">
      <p className="text-[13px] text-ink-2">Staff allocation (% per grant line must total 100%)</p>
      {staff.map((row, idx) => (
        <div key={idx} className="mt-2 grid gap-2 border-b border-rule pb-2 md:grid-cols-4">
          <input
            placeholder="Name"
            className="rounded border border-rule px-2 py-1"
            value={row.employee}
            disabled={!canWrite}
            onChange={(e) => {
              const next = [...staff];
              next[idx] = { ...row, employee: e.target.value };
              setStaff(next);
            }}
          />
          <input
            placeholder="Role"
            className="rounded border border-rule px-2 py-1"
            value={row.role}
            disabled={!canWrite}
            onChange={(e) => {
              const next = [...staff];
              next[idx] = { ...row, role: e.target.value };
              setStaff(next);
            }}
          />
          <input
            placeholder="Biweekly $"
            type="number"
            className="rounded border border-rule px-2 py-1"
            value={row.biweeklyCents ? row.biweeklyCents / 100 : ""}
            disabled={!canWrite}
            onChange={(e) => {
              const next = [...staff];
              next[idx] = { ...row, biweeklyCents: Math.round(Number(e.target.value) * 100) };
              setStaff(next);
            }}
          />
          <input
            placeholder="GRANT:LINE=60%;UNRESTRICTED=40%"
            className="rounded border border-rule px-2 py-1 md:col-span-1"
            disabled={!canWrite}
            value={row.allocation.map((a) => `${a.key}=${Math.round(a.pct * 100)}%`).join(";")}
            onChange={(e) => {
              const parts = e.target.value.split(";").map((part) => {
                const [key, pct] = part.split("=");
                return { key: key?.trim() ?? "UNRESTRICTED", pct: parseFloat(pct) / 100 || 0 };
              });
              const next = [...staff];
              next[idx] = { ...row, allocation: parts };
              setStaff(next);
            }}
          />
        </div>
      ))}
      <button type="button" disabled={!canWrite} className="mt-2 text-[13px] text-ledger underline" onClick={addRow}>
        Add staff row
      </button>
      {grantIds.length > 0 && (
        <p className="mt-1 text-[12px] text-ink-2">Grant keys: {grantIds.map((g) => `${g}:LINE`).join(", ")}, UNRESTRICTED</p>
      )}
    </div>
  );
}
