"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useMemo, useState, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { detectAndParseBank, parseBankFlexible, assignTxnIds, type BankColumnMapping, type BankColumnRole } from "@/lib/parseFlexible";
import { GL_ROLES, parseGlDetail, type GlColumnMapping, type GlColumnRole, type GlLine } from "@/lib/parseGlDetail";
import type { GrantTerms, StaffAllocation, Txn } from "@/lib/types";
import { messageFromConvexError } from "../../lib/convexError";
import type { AppUrl, DataView as DataSubView } from "../../hooks/useAppUrlState";
import { shortName, useApp } from "../AppContext";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card, SectionTitle } from "../ui/Card";
import { fmtUsd } from "../ui/Money";
import { Table, Td, Th } from "../ui/Table";
import { LedgerTable, TermsSheets } from "./DataTables";

const GL_ROLE_WORDS: Record<GlColumnRole, string> = {
  date: "Date",
  txnType: "Type",
  docRef: "Doc number",
  vendor: "Vendor",
  memo: "Memo",
  account: "Account",
  grant: "Grant / class",
  budgetLine: "Budget line",
  department: "Department",
  amount: "Amount",
  debit: "Debit",
  credit: "Credit",
  split: "Split",
  enteredBy: "Entered by",
};
const BANK_ROLES: BankColumnRole[] = ["date", "description", "amount", "debit", "credit", "memo"];

export function DataView({ url, grantTerms, onError }: { url: AppUrl; grantTerms: GrantTerms[]; onError: (m: string | null) => void }) {
  const view = url.dataView;
  const tabs: { id: DataSubView; label: string }[] = [
    { id: "upload", label: "Files and roles" },
    { id: "ledger", label: "Ledger" },
    { id: "terms", label: "Contract terms" },
  ];
  return (
    <div className="mx-auto max-w-[1040px]">
      <div className="flex flex-wrap items-end justify-between gap-4 pb-6 pt-2 sm:pt-6">
        <h1 className="font-serif text-xl text-ink sm:text-2xl">
          Your data <em className="italic text-ink-2">and who signs</em>
        </h1>
        <div role="tablist" aria-label="Data views" className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={view === t.id}
              onClick={() => url.setDataView(t.id)}
              className={`min-h-11 rounded-pill border px-3 text-sm sm:min-h-8 ${
                view === t.id ? "border-ink bg-ink text-sheet" : "border-rule-strong bg-sheet text-ink hover:border-ink-2"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {view === "upload" && <Uploads onError={onError} onDone={() => url.setTab("packages")} />}
      {view === "ledger" && <LedgerTable grantTerms={grantTerms} />}
      {view === "terms" && <TermsSheets />}
    </div>
  );
}

function Uploads({ onError, onDone }: { onError: (m: string | null) => void; onDone: () => void }) {
  const app = useApp();
  const counts = useQuery(api.ingest.counts);
  const grants = useQuery(api.grants.listFull);
  const receipts = useQuery(api.receipts.list);
  const run = useQuery(api.dashboard.latestRun);
  const startGlWorkspace = useMutation(api.ingest.startGlWorkspace);
  const runAgent = useAction(api.agent.runAgent);

  const [gl, setGl] = useState<{ name: string; raw: string; mapping: GlColumnMapping; headers: string[]; lines: GlLine[]; skipped: number; error: string | null } | null>(null);
  const [bank, setBank] = useState<{ name: string; raw: string; mapping: BankColumnMapping; headers: string[]; txns: Txn[]; error: string | null } | null>(null);
  const [staff] = useState<StaffAllocation[]>([]);
  const contracts = useContractUpload(onError);
  const [busy, setBusy] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);

  const readyGrantIds = (grants ?? []).filter((g) => g.status === "ready").map((g) => g._id as Id<"grants">);
  const loadedLines = counts?.transactions ?? 0;

  function parseGl(name: string, raw: string, mapping?: GlColumnMapping) {
    const r = parseGlDetail(raw, mapping);
    setGl({ name, raw, mapping: r.mapping, headers: r.headers, lines: r.error ? [] : r.lines, skipped: r.skipped.length, error: r.error ?? null });
  }
  function parseBank(name: string, raw: string, mapping?: BankColumnMapping) {
    if (!mapping) {
      const d = detectAndParseBank(raw);
      setBank({ name, raw, mapping: d.mapping, headers: d.headers, txns: d.error ? [] : d.txns, error: d.error ?? null });
      return;
    }
    const { rows, error } = parseBankFlexible(raw, mapping);
    setBank({ name, raw, mapping, headers: bank?.headers ?? [], txns: error ? [] : assignTxnIds(rows), error: error ?? null });
  }

  async function onRun() {
    if (!app.canWrite) return;
    setBusy(true);
    onError(null);
    try {
      if (gl?.lines.length) {
        await startGlWorkspace({
          passcode: app.passcode,
          lines: gl.lines,
          bankLines: (bank?.txns ?? []).map((t, i) => ({
            lineId: `B${String(i + 1).padStart(4, "0")}`,
            date: t.date,
            description: t.description,
            amountCents: t.amountCents,
            memo: t.memo,
          })),
          staffAllocations: staff,
          grantDocIds: readyGrantIds,
          dataSource: "custom",
        });
        setGl(null);
        setBank(null);
      } else {
        await runAgent({ passcode: app.passcode });
      }
      setConfirmReplace(false);
      onDone();
    } catch (e) {
      onError(messageFromConvexError(e));
    } finally {
      setBusy(false);
    }
  }

  const running = run?.status === "running";
  const canRun = app.canWrite && !busy && !running && readyGrantIds.length > 0 && (!!gl?.lines.length || loadedLines > 0);
  const replaces = !!gl?.lines.length && loadedLines > 0;

  return (
    <div className="space-y-4">
      {/* 1. GL detail */}
      <Card className="p-5 sm:p-6">
        <StepHead n="GL detail" required status={gl?.lines.length ? `${gl.lines.length} lines ready` : loadedLines ? `${loadedLines} lines loaded` : "Needed"} tone={gl?.lines.length || loadedLines ? "green" : "amber"}>
          The ledger is the record Steward checks: QuickBooks Transaction Detail by Account, Xero Account Transactions or Sage Intacct GL detail, as CSV.
        </StepHead>
        <DropZone
          allow={["csv"]}
          label={gl ? `Replace ${gl.name}` : "Drop the GL detail CSV, or choose a file"}
          disabled={!app.canWrite}
          onPdfElsewhere={(files) => void contracts.upload(files)}
          onFiles={(files) => {
            const f = files[0];
            if (f) void f.text().then((t) => parseGl(f.name, t));
          }}
        />
        {gl && (
          <div className="mt-5">
            {gl.error ? (
              <p role="alert" className="text-sm text-redpen-ink">
                {gl.error} Map the columns below.
              </p>
            ) : (
              <p className="text-sm text-ink">
                <span className="tabular font-medium">{gl.lines.length}</span> expense lines found in {gl.name}
                {gl.skipped ? <span className="text-ink-2"> · {gl.skipped} rows skipped (totals, cash side, revenue)</span> : null}
              </p>
            )}
            <details className="mt-3" open={!!gl.error}>
              <summary className="min-h-11 cursor-pointer text-sm text-ink-2 hover:text-ink sm:min-h-0">Detected columns</summary>
              <div className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                {GL_ROLES.map((role) => (
                  <label key={role} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-ink-2">{GL_ROLE_WORDS[role]}</span>
                    <select
                      className="min-h-11 w-44 rounded-sm border border-rule-strong bg-sheet px-2 text-sm sm:min-h-8"
                      value={gl.mapping[role] ?? ""}
                      onChange={(e) => parseGl(gl.name, gl.raw, { ...gl.mapping, [role]: e.target.value || null })}
                    >
                      <option value="">—</option>
                      {gl.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </details>
            {gl.lines.length > 0 && (
              <Table caption="First GL lines" className="mt-4" minWidth={560}>
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Vendor</Th>
                    <Th>Account</Th>
                    <Th>Coded to</Th>
                    <Th align="right">Amount</Th>
                  </tr>
                </thead>
                <tbody>
                  {gl.lines.slice(0, 5).map((l) => (
                    <tr key={l.txnId}>
                      <Td className="tabular whitespace-nowrap text-ink-2">{l.date}</Td>
                      <Td>{l.vendor}</Td>
                      <Td className="text-ink-2">{l.account}</Td>
                      <Td className="text-ink-2">{l.glClass ? `${l.glClass} · ${l.glBudgetLine ?? "?"}` : "General funds"}</Td>
                      <Td money>{fmtUsd(l.amountCents)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </div>
        )}
      </Card>

      {/* 2. Receipts */}
      <ReceiptsStep receipts={receipts} />

      {/* 3. Contracts */}
      <ContractsStep grants={grants} onError={onError} contracts={contracts} />

      {/* 4. Bank statement */}
      <Card className="p-5 sm:p-6">
        <StepHead n="Bank statement" status={bank?.txns.length ? `${bank.txns.length} lines ready` : "Optional"} tone="neutral">
          For reconciliation only: Steward checks that what the books paid is what left the bank.
        </StepHead>
        <DropZone
          allow={["csv"]}
          label={bank ? `Replace ${bank.name}` : "Drop a bank CSV, or choose a file"}
          disabled={!app.canWrite}
          onPdfElsewhere={(files) => void contracts.upload(files)}
          onFiles={(files) => {
            const f = files[0];
            if (f) void f.text().then((t) => parseBank(f.name, t));
          }}
        />
        {bank && (
          <div className="mt-4">
            {bank.error ? (
              <p role="alert" className="text-sm text-redpen-ink">
                {bank.error}
              </p>
            ) : (
              <p className="text-sm">
                <span className="tabular font-medium">{bank.txns.length}</span> bank lines in {bank.name}
              </p>
            )}
            <div className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
              {BANK_ROLES.map((role) => (
                <label key={role} className="flex items-center justify-between gap-3 text-sm capitalize">
                  <span className="text-ink-2">{role}</span>
                  <select
                    className="min-h-11 w-44 rounded-sm border border-rule-strong bg-sheet px-2 text-sm normal-case sm:min-h-8"
                    value={bank.mapping[role] ?? ""}
                    onChange={(e) => parseBank(bank.name, bank.raw, { ...bank.mapping, [role]: e.target.value || null })}
                  >
                    <option value="">—</option>
                    {bank.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </div>
        )}
      </Card>

      <RolesStep />

      {/* Run */}
      <div className="sticky bottom-0 z-10 -mx-4 border-t border-rule bg-paper/95 px-4 py-4 backdrop-blur-[6px] sm:static sm:mx-0 sm:rounded-md sm:border sm:bg-sheet sm:px-6 sm:shadow-sheet">
        {confirmReplace && replaces ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-base">
              This replaces the {loadedLines} lines now loaded, and every decision on them. Signed packages keep their frozen numbers.
            </p>
            <Button variant="ghost" onClick={() => setConfirmReplace(false)}>
              Cancel
            </Button>
            <Button variant="primary" busy={busy} busyLabel="Starting…" onClick={() => void onRun()}>
              Replace and run
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              disabled={!canRun}
              busy={busy || running}
              busyLabel={running ? "Steward is reading…" : "Starting…"}
              onClick={() => (replaces ? setConfirmReplace(true) : void onRun())}
            >
              Run Steward
            </Button>
            <p className="min-w-0 flex-1 text-sm text-ink-2">
              {!app.canWrite
                ? "View-only demo: running needs the demo key in the link."
                : readyGrantIds.length === 0
                  ? "Confirm at least one contract first."
                  : !gl?.lines.length && !loadedLines
                    ? "Add a GL detail file first."
                    : gl?.lines.length
                      ? "Steward reads the new files, codes every line and builds this period's packages."
                      : "Re-checks the data already loaded against the contracts and receipts."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function StepHead({
  n,
  status,
  tone,
  required,
  children,
}: {
  n: string;
  status: string;
  tone: "green" | "amber" | "neutral";
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
      <div className="min-w-0 max-w-[64ch]">
        <SectionTitle as="h2">
          {n}
          {required ? <span className="ml-2 font-sans text-xs text-ink-2">required</span> : null}
        </SectionTitle>
        <p className="mt-1 text-sm text-ink-2">{children}</p>
      </div>
      <Badge tone={tone}>{status}</Badge>
    </div>
  );
}

type FileKind = "csv" | "pdf" | "image" | "other";

function fileKind(f: File): FileKind {
  const ext = f.name.toLowerCase().split(".").pop() ?? "";
  if (ext === "csv" || f.type === "text/csv") return "csv";
  if (ext === "pdf" || f.type === "application/pdf") return "pdf";
  if (["png", "jpg", "jpeg", "heic", "heif", "webp", "gif"].includes(ext) || f.type.startsWith("image/")) return "image";
  return "other";
}

const KIND_WORD: Record<FileKind, string> = { csv: "a CSV", pdf: "a PDF", image: "an image", other: "not a supported file" };

/** Where a file of this kind belongs, said plainly. */
function belongsIn(kind: FileKind): string {
  if (kind === "pdf") return "contracts go in Contracts, receipts in Receipts";
  if (kind === "image") return "photos of receipts go in Receipts";
  if (kind === "csv") return "CSVs go in GL detail or Bank statement";
  return "use CSV for the ledger and bank, PDF or a photo for contracts and receipts";
}

const ACCEPT: Record<Exclude<FileKind, "other">, string> = {
  csv: ".csv,text/csv",
  pdf: ".pdf,application/pdf",
  image: ".png,.jpg,.jpeg,.heic,.webp,image/png,image/jpeg,image/heic,image/webp",
};

function DropZone({
  allow,
  label,
  multiple,
  disabled,
  busy,
  onFiles,
  onPdfElsewhere,
}: {
  allow: Exclude<FileKind, "other">[];
  label: string;
  multiple?: boolean;
  disabled?: boolean;
  busy?: boolean;
  onFiles: (files: File[]) => void;
  /** A contract PDF dropped in the wrong zone is sent to Contracts instead of being held here. */
  onPdfElsewhere?: (files: File[]) => void;
}) {
  const [over, setOver] = useState(false);
  const [note, setNote] = useState<{ text: string; tone: "error" | "info" } | null>(null);

  function take(all: File[]) {
    const ok = all.filter((f) => (allow as FileKind[]).includes(fileKind(f)));
    const wrong = all.filter((f) => !ok.includes(f));
    const pdfs = wrong.filter((f) => fileKind(f) === "pdf");
    if (wrong.length && onPdfElsewhere && pdfs.length === wrong.length) {
      onPdfElsewhere(pdfs);
      setNote({ text: `${pdfs.length === 1 ? `${pdfs[0]!.name} is a PDF` : `${pdfs.length} PDFs`}, so ${pdfs.length === 1 ? "it went" : "they went"} to Contracts below.`, tone: "info" });
    } else if (wrong.length) {
      const k = fileKind(wrong[0]!);
      setNote({ text: `${wrong[0]!.name} is ${KIND_WORD[k]} — ${belongsIn(k)}. Nothing was added here.`, tone: "error" });
    } else {
      setNote(null);
    }
    if (ok.length) onFiles(multiple ? ok : ok.slice(0, 1));
  }

  return (
    <div>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!disabled && e.dataTransfer.files.length) take([...e.dataTransfer.files]);
        }}
        className={`flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-sm border border-dashed px-4 py-6 text-center transition-colors duration-150 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ink ${
          disabled ? "cursor-not-allowed border-rule text-ink-2" : over ? "border-ink bg-paper-2 text-ink" : "border-rule-strong bg-paper/50 text-ink hover:border-ink-2"
        }`}
      >
        <span className="text-base">{busy ? "Working…" : label}</span>
        <span className="mt-1 text-xs text-ink-2">
          {allow.map((k) => (k === "csv" ? "CSV" : k === "pdf" ? "PDF" : "PNG, JPG, HEIC")).join(" or ")}
          {multiple ? " · many files at once" : " · one file"}
        </span>
        <input
          type="file"
          accept={allow.map((k) => ACCEPT[k]).join(",")}
          multiple={multiple}
          disabled={disabled || busy}
          className="sr-only"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            if (files.length) take(files);
          }}
        />
      </label>
      {note && (
        <p role={note.tone === "error" ? "alert" : "status"} className={`mt-2 text-sm ${note.tone === "error" ? "text-redpen-ink" : "text-ink-2"}`}>
          {note.text}
        </p>
      )}
    </div>
  );
}

type ReceiptRow = {
  _id: string;
  fileName: string;
  status: string;
  error: string | null;
  extracted: { vendor: string | null; totalCents: number | null; date: string | null } | null;
  matchedTxnId: string | null;
  matchedBy: string | null;
  matchCandidates: string[];
};

function ReceiptsStep({ receipts }: { receipts: ReceiptRow[] | undefined }) {
  const app = useApp();
  const uploadUrl = useMutation(api.receipts.generateUploadUrl);
  const register = useMutation(api.receipts.register);
  const extract = useAction(api.receiptsAgent.extractReceipt);
  const link = useMutation(api.receipts.link);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "matched" | "ambiguous" | "unmatched">("all");
  const [err, setErr] = useState<string | null>(null);

  const kind = (r: ReceiptRow) => (r.matchedTxnId ? "matched" : r.matchCandidates.length ? "ambiguous" : "unmatched");
  const rows = receipts ?? [];
  const n = { matched: 0, ambiguous: 0, unmatched: 0 };
  for (const r of rows) n[kind(r)]++;
  const shown = filter === "all" ? rows : rows.filter((r) => kind(r) === filter);

  async function upload(files: File[]) {
    setBusy("upload");
    setErr(null);
    let i = 0;
    try {
      for (const file of files) {
        i++;
        setProgress(`Reading ${i} of ${files.length}: ${file.name}`);
        const u = await uploadUrl({ passcode: app.passcode });
        const res = await fetch(u, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
        if (!res.ok) throw new Error(`Upload failed: ${file.name}`);
        const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
        const receiptId = await register({ storageId, fileName: file.name, contentType: file.type || undefined, passcode: app.passcode });
        const out = await extract({ receiptId, passcode: app.passcode });
        if (!out.ok) setErr(`${file.name}: ${out.error ?? "could not be read"}`);
      }
    } catch (e) {
      setErr(messageFromConvexError(e));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  return (
    <Card className="p-5 sm:p-6">
      <StepHead n="Receipts" status={rows.length ? `${n.matched} of ${rows.length} matched` : "None yet"} tone={rows.length && n.matched === rows.length ? "green" : rows.length ? "amber" : "neutral"}>
        PDFs or photos of receipts and vendor invoices. Steward reads each one and matches it to a GL line by amount, date and vendor.
      </StepHead>
      <DropZone allow={["pdf", "image"]} multiple label="Drop receipts, or choose files" disabled={!app.canWrite} busy={busy === "upload"} onFiles={(f) => void upload(f)} />
      {progress && (
        <p className="mt-2 text-sm text-ink-2" role="status">
          {progress}
        </p>
      )}
      {err && (
        <p className="mt-2 text-sm text-redpen-ink" role="alert">
          {err}
        </p>
      )}
      {rows.length > 0 && (
        <>
          <div className="mt-5 flex flex-wrap gap-1" role="tablist" aria-label="Receipt match status">
            {(["all", "matched", "ambiguous", "unmatched"] as const).map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={filter === f}
                onClick={() => setFilter(f)}
                className={`min-h-11 rounded-pill border px-3 text-sm sm:min-h-8 ${filter === f ? "border-ink bg-ink text-sheet" : "border-rule-strong bg-sheet hover:border-ink-2"}`}
              >
                {{ all: "All", matched: "Matched", ambiguous: "Could match several", unmatched: "Unmatched" }[f]} <span className="tabular opacity-70">{f === "all" ? rows.length : n[f]}</span>
              </button>
            ))}
          </div>
          <ul className="mt-3 max-h-[420px] divide-y divide-rule overflow-y-auto border-y border-rule">
            {shown.map((r) => {
              const k = kind(r);
              return (
                <li key={r._id} className="grid gap-x-4 gap-y-2 py-3 sm:grid-cols-[1fr_auto_auto] sm:items-center">
                  <div className="min-w-0">
                    <p className="truncate text-base text-ink">{r.extracted?.vendor ?? r.fileName}</p>
                    <p className="truncate text-xs text-ink-2">
                      {r.fileName}
                      {r.extracted?.date ? ` · ${r.extracted.date}` : ""}
                      {r.status !== "ready" ? ` · ${r.status}` : ""}
                      {r.error ? ` · ${r.error}` : ""}
                    </p>
                  </div>
                  <span className="tabular text-base sm:text-right">{r.extracted?.totalCents != null ? fmtUsd(r.extracted.totalCents) : "—"}</span>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <Badge tone={k === "matched" ? "green" : k === "ambiguous" ? "amber" : "neutral"}>
                      {k === "matched" ? `${r.matchedTxnId}${r.matchedBy === "human" ? " · linked by hand" : ""}` : k === "ambiguous" ? `${r.matchCandidates.length} candidates` : "Unmatched"}
                    </Badge>
                    <RelinkControl
                      current={r.matchedTxnId}
                      candidates={r.matchCandidates}
                      disabled={!app.canWrite || !app.canResolve || busy === r._id}
                      title={!app.canResolve ? "Linking receipts needs a reviewer" : undefined}
                      onLink={(txnId) => {
                        setBusy(r._id);
                        setErr(null);
                        void link({ receiptId: r._id as Id<"receipts">, txnId, by: app.actor, passcode: app.passcode })
                          .then(() => app.toast(txnId ? `${r.fileName} linked to ${txnId} by ${shortName(app.actor)}` : `${r.fileName} unlinked`))
                          .catch((e) => setErr(messageFromConvexError(e)))
                          .finally(() => setBusy(null));
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
          {!app.canResolve && <p className="mt-2 text-xs text-ink-2">Re-linking a receipt is a reviewer decision; switch “Acting as” to a reviewer.</p>}
        </>
      )}
    </Card>
  );
}

function RelinkControl({
  current,
  candidates,
  disabled,
  title,
  onLink,
}: {
  current: string | null;
  candidates: string[];
  disabled: boolean;
  title?: string;
  onLink: (txnId: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  if (!editing) {
    return (
      <Button size="sm" variant="ghost" disabled={disabled} title={title} onClick={() => setEditing(true)}>
        {current ? "Re-link" : "Link"}
      </Button>
    );
  }
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        const id = value.trim().toUpperCase();
        if (id) onLink(id);
        setEditing(false);
      }}
    >
      {candidates.length > 0 ? (
        <select autoFocus className="min-h-11 rounded-sm border border-rule-strong bg-sheet px-2 text-sm sm:min-h-8" value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">Pick a line</option>
          {candidates.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      ) : (
        <input
          autoFocus
          aria-label="GL line id"
          placeholder="L0123"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="min-h-11 w-24 rounded-sm border border-rule-strong bg-sheet px-2 text-sm sm:min-h-8"
        />
      )}
      <Button size="sm" type="submit" disabled={!value.trim()}>
        Link
      </Button>
      {current && (
        <Button size="sm" variant="ghost" onClick={() => { onLink(null); setEditing(false); }}>
          Unlink
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
        Cancel
      </Button>
    </form>
  );
}

type GrantRow = { _id: string; fileName: string; grantId?: string; status: string; source?: string; terms: unknown; error?: string };

/** Contract PDF upload + extraction, shared so a PDF dropped in the wrong zone still lands here. */
function useContractUpload(onError: (m: string | null) => void) {
  const app = useApp();
  const uploadUrl = useMutation(api.grants.generateUploadUrl);
  const register = useMutation(api.grants.registerGrant);
  const extract = useAction(api.agent.extractGrant);
  const [busy, setBusy] = useState(false);
  async function upload(files: File[]) {
    if (!app.canWrite) return;
    setBusy(true);
    onError(null);
    try {
      for (const file of files) {
        if (fileKind(file) !== "pdf") continue;
        const u = await uploadUrl({ passcode: app.passcode });
        const res = await fetch(u, { method: "POST", headers: { "Content-Type": "application/pdf" }, body: file });
        if (!res.ok) throw new Error(`Upload failed: ${file.name}`);
        const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
        const grantDocId = await register({ storageId, fileName: file.name, passcode: app.passcode, source: "upload" });
        await extract({ grantDocId, passcode: app.passcode });
      }
    } catch (e) {
      onError(messageFromConvexError(e));
    } finally {
      setBusy(false);
    }
  }
  return { upload, busy };
}

function ContractsStep({
  grants,
  onError,
  contracts,
}: {
  grants: GrantRow[] | undefined;
  onError: (m: string | null) => void;
  contracts: ReturnType<typeof useContractUpload>;
}) {
  const app = useApp();
  const rows = grants ?? [];
  const ready = rows.filter((g) => g.status === "ready").length;

  return (
    <Card className="p-5 sm:p-6">
      <StepHead n="Contracts" status={ready ? `${ready} confirmed` : rows.length ? "Confirm terms" : "Needed"} tone={ready ? "green" : "amber"}>
        Grant agreements and city contracts as PDF. Steward reads the terms; you confirm them before they are used.
      </StepHead>
      <DropZone allow={["pdf"]} multiple label="Drop contract PDFs, or choose files" disabled={!app.canWrite} busy={contracts.busy} onFiles={(f) => void contracts.upload(f)} />
      {rows.length > 0 && (
        <ul className="mt-4 divide-y divide-rule border-y border-rule">
          {rows.map((g) => (
            <li key={g._id} className="py-3">
              <ContractRow g={g} onError={onError} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ContractRow({ g, onError }: { g: GrantRow; onError: (m: string | null) => void }) {
  const app = useApp();
  const confirm = useMutation(api.grants.confirmGrantTerms);
  const t = g.terms as GrantTerms | null;
  const [draft, setDraft] = useState<GrantTerms | null>(null);
  const terms = draft ?? t;
  const pending = g.status === "pending_confirm";
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="min-w-0 text-base text-ink">
          {t?.program ?? g.fileName} <span className="text-sm text-ink-2">{t?.grantId ?? ""}</span>
        </p>
        <Badge tone={g.status === "ready" ? "green" : g.status === "error" ? "red" : "amber"}>
          {g.status === "ready" ? "Confirmed" : g.status === "pending_confirm" ? "Check the terms" : g.status === "extracting" ? "Reading…" : g.status === "error" ? "Couldn't read" : g.status}
        </Badge>
      </div>
      <p className="mt-0.5 text-xs text-ink-2">
        {g.fileName}
        {g.error ? ` · ${g.error}` : ""}
      </p>
      {pending && terms && (
        <div className="mt-3 rounded-sm bg-paper/70 p-4">
          <TermsEditor terms={terms} onChange={setDraft} />
          <Button
            variant="primary"
            size="sm"
            className="mt-4"
            disabled={!app.canWrite}
            onClick={() =>
              void confirm({ grantDocId: g._id as Id<"grants">, terms, passcode: app.passcode })
                .then(() => {
                  onError(null);
                  app.toast(`${terms.grantId} terms confirmed`);
                })
                .catch((e) => onError(messageFromConvexError(e)))
            }
          >
            Confirm terms
          </Button>
        </div>
      )}
    </div>
  );
}

function TermsEditor({ terms, onChange }: { terms: GrantTerms; onChange: (t: GrantTerms) => void }) {
  const billing = terms.billing ?? { frequency: "none" as const, invoiceDueDays: null, costBasis: null };
  const lineSum = terms.budgetLines.reduce((a, l) => a + l.amount, 0);
  const sumOk = Math.round(lineSum * 100) === Math.round(terms.totalAward * 100);
  const field = "mt-1 block min-h-11 w-full rounded-sm border border-rule-strong bg-sheet px-2 text-sm sm:min-h-9";
  return (
    <div className="space-y-4 text-sm">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-ink-2">
          Period start
          <input type="date" className={field} value={terms.periodStart} onChange={(e) => onChange({ ...terms, periodStart: e.target.value })} />
        </label>
        <label className="text-ink-2">
          Period end
          <input type="date" className={field} value={terms.periodEnd} onChange={(e) => onChange({ ...terms, periodEnd: e.target.value })} />
        </label>
        <label className="text-ink-2">
          Billing frequency
          <select className={field} value={billing.frequency} onChange={(e) => onChange({ ...terms, billing: { ...billing, frequency: e.target.value as "monthly" | "quarterly" | "none" } })}>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="none">Once, for the whole award</option>
          </select>
        </label>
        <label className="text-ink-2">
          Invoice due (days after period)
          <input
            type="number"
            min={0}
            className={field}
            value={billing.invoiceDueDays ?? ""}
            onChange={(e) => onChange({ ...terms, billing: { ...billing, invoiceDueDays: e.target.value ? Number(e.target.value) : null } })}
          />
        </label>
        <label className="text-ink-2">
          Indirect rate %
          <input
            type="number"
            min={0}
            step="0.01"
            className={field}
            value={terms.indirectCapPct ?? ""}
            onChange={(e) => onChange({ ...terms, indirectCapPct: e.target.value ? Number(e.target.value) : null })}
          />
        </label>
        <label className="text-ink-2">
          Indirect base
          <select
            className={field}
            value={terms.indirectBase ?? ""}
            onChange={(e) => onChange({ ...terms, indirectBase: (e.target.value || null) as GrantTerms["indirectBase"] })}
          >
            <option value="">Not stated</option>
            <option value="salaries">Salaries</option>
            <option value="direct">All direct costs</option>
            <option value="mtdc">Modified total direct costs</option>
          </select>
        </label>
        <label className="text-ink-2">
          Receipt needed at or above ($)
          <input
            type="number"
            min={0}
            step="0.01"
            className={field}
            placeholder="Workspace setting"
            value={terms.receiptThresholdUsd ?? ""}
            onChange={(e) => onChange({ ...terms, receiptThresholdUsd: e.target.value ? Number(e.target.value) : null })}
          />
        </label>
      </div>
      {!sumOk && (
        <p className="text-amber-ink">
          Budget lines add up to {fmtUsd(Math.round(lineSum * 100))}; the award is {fmtUsd(Math.round(terms.totalAward * 100))}.
        </p>
      )}
      <Table caption="Budget lines" minWidth={420}>
        <thead>
          <tr>
            <Th>Code</Th>
            <Th>Name</Th>
            <Th align="right">Amount ($)</Th>
          </tr>
        </thead>
        <tbody>
          {terms.budgetLines.map((bl, i) => (
            <tr key={i}>
              <Td>
                <input
                  aria-label={`Budget line ${i + 1} code`}
                  className="min-h-9 w-20 rounded-sm border border-rule-strong bg-sheet px-2"
                  value={bl.code}
                  onChange={(e) => {
                    const budgetLines = [...terms.budgetLines];
                    budgetLines[i] = { ...bl, code: e.target.value };
                    onChange({ ...terms, budgetLines });
                  }}
                />
              </Td>
              <Td>
                <input
                  aria-label={`Budget line ${i + 1} name`}
                  className="min-h-9 w-full rounded-sm border border-rule-strong bg-sheet px-2"
                  value={bl.name}
                  onChange={(e) => {
                    const budgetLines = [...terms.budgetLines];
                    budgetLines[i] = { ...bl, name: e.target.value };
                    onChange({ ...terms, budgetLines });
                  }}
                />
              </Td>
              <Td align="right">
                <input
                  aria-label={`Budget line ${i + 1} amount`}
                  type="number"
                  className="tabular min-h-9 w-32 rounded-sm border border-rule-strong bg-sheet px-2 text-right"
                  value={bl.amount}
                  onChange={(e) => {
                    const budgetLines = [...terms.budgetLines];
                    budgetLines[i] = { ...bl, amount: Number(e.target.value) };
                    onChange({ ...terms, budgetLines });
                  }}
                />
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function RolesStep() {
  const app = useApp();
  const settings = useQuery(api.settings.get);
  const update = useMutation(api.settings.update);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const base = useMemo(
    () =>
      settings
        ? {
            organizationName: settings.organizationName,
            preparers: settings.preparers.join("\n"),
            reviewers: settings.reviewers.join("\n"),
            programApprovers: settings.programApprovers.join("\n"),
            threshold: String(settings.receiptThresholdCents / 100),
          }
        : null,
    [settings],
  );
  if (!base) return <Card className="h-48 animate-pulse p-6">{null}</Card>;
  const v = draft ?? base;
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(base);
  const set = (k: string, val: string) => setDraft({ ...v, [k]: val });
  const list = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const cents = Math.round(Number(v.threshold) * 100);
      if (!Number.isFinite(cents) || cents < 0) throw new Error("The receipt threshold must be a positive amount.");
      await update({
        passcode: app.passcode,
        organizationName: v.organizationName!.trim(),
        preparers: list(v.preparers!),
        reviewers: list(v.reviewers!),
        programApprovers: list(v.programApprovers!),
        receiptThresholdCents: cents,
      });
      setDraft(null);
      app.toast("Roles saved");
    } catch (e) {
      setErr(messageFromConvexError(e));
    } finally {
      setSaving(false);
    }
  }

  const area = "mt-1 block w-full rounded-sm border border-rule-strong bg-sheet p-2 text-sm leading-6";
  return (
    <Card className="p-5 sm:p-6">
      <div className="mb-4 max-w-[64ch]">
        <SectionTitle>
          Who does what <em className="italic text-ink-2">— Steward never holds a role</em>
        </SectionTitle>
        <p className="mt-1 text-sm text-ink-2">
          One person per line. The preparer sends a package for review; a different reviewer signs it; program approvers confirm charges
          were for their program.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <label className="text-sm text-ink-2">
          Preparers
          <textarea rows={3} className={area} disabled={!app.canWrite} value={v.preparers} onChange={(e) => set("preparers", e.target.value)} />
        </label>
        <label className="text-sm text-ink-2">
          Reviewers (sign packages)
          <textarea rows={3} className={area} disabled={!app.canWrite} value={v.reviewers} onChange={(e) => set("reviewers", e.target.value)} />
        </label>
        <label className="text-sm text-ink-2">
          Program approvers
          <textarea rows={3} className={area} disabled={!app.canWrite} value={v.programApprovers} onChange={(e) => set("programApprovers", e.target.value)} />
        </label>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="text-sm text-ink-2">
          Receipt needed at or above ($) <span className="text-xs">· unless the contract states its own</span>
          <input
            type="number"
            min={0}
            step="0.01"
            disabled={!app.canWrite}
            className="tabular mt-1 block min-h-11 w-40 rounded-sm border border-rule-strong bg-sheet px-2 text-sm sm:min-h-9"
            value={v.threshold}
            onChange={(e) => set("threshold", e.target.value)}
          />
        </label>
        <label className="text-sm text-ink-2">
          Organization name
          <input
            disabled={!app.canWrite}
            className="mt-1 block min-h-11 w-full rounded-sm border border-rule-strong bg-sheet px-2 text-sm sm:min-h-9"
            value={v.organizationName}
            onChange={(e) => set("organizationName", e.target.value)}
          />
        </label>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button disabled={!dirty || !app.canWrite} busy={saving} onClick={() => void save()}>
          Save roles
        </Button>
        {dirty && (
          <Button variant="ghost" onClick={() => setDraft(null)}>
            Discard changes
          </Button>
        )}
        {err && (
          <p role="alert" className="text-sm text-redpen-ink">
            {err}
          </p>
        )}
      </div>
    </Card>
  );
}
