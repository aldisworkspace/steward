"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Providers } from "./providers";

function fmt(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function StewardHome() {
  const counts = useQuery(api.ingest.counts);
  const grants = useQuery(api.grants.list);
  const decisions = useQuery(api.dashboard.listDecisions);
  const run = useQuery(api.dashboard.latestRun);
  const runAgent = useAction(api.agent.runAgent);
  const extractGrant = useAction(api.agent.extractGrant);
  const generateUploadUrl = useMutation(api.grants.generateUploadUrl);
  const registerGrant = useMutation(api.grants.registerGrant);

  const [seedLoading, setSeedLoading] = useState(false);
  const [runLoading, setRunLoading] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const bothReady = (grants ?? []).filter((g) => g.status === "ready").length >= 2;
  const showBadge = loaded || (counts && counts.transactions > 0);

  async function loadDemo() {
    setSeedLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/seed", { method: "POST" });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Seed failed (${res.status})`);
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setSeedLoading(false);
    }
  }

  async function onRunSteward() {
    setRunLoading(true);
    setError(null);
    try {
      await runAgent({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Run failed");
    } finally {
      setRunLoading(false);
    }
  }

  async function onUploadPdf(file: File) {
    setUploadLoading(true);
    setError(null);
    try {
      const uploadUrl = await generateUploadUrl({});
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": "application/pdf" },
        body: file,
      });
      if (!res.ok) throw new Error("Upload failed");
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      const grantDocId = await registerGrant({ storageId, fileName: file.name });
      await extractGrant({ grantDocId });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadLoading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="min-h-full bg-zinc-50 px-4 py-10">
      <main className="mx-auto max-w-5xl space-y-8">
        <header className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">Steward</h1>
          {showBadge && (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900 ring-1 ring-amber-200">
              Synthetic demo data
            </span>
          )}
        </header>

        <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void loadDemo()}
              disabled={seedLoading}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {seedLoading ? "Loading demo…" : "Load demo data"}
            </button>
            <button
              type="button"
              onClick={() => void onRunSteward()}
              disabled={!bothReady || runLoading || run?.status === "running"}
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-50"
            >
              {runLoading || run?.status === "running" ? "Running…" : "Run Steward"}
            </button>
            <label className="cursor-pointer rounded-lg border border-dashed border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50">
              {uploadLoading ? "Uploading…" : "Upload grant agreement (PDF)"}
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                disabled={uploadLoading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onUploadPdf(f);
                }}
              />
            </label>
          </div>
          {run && (
            <p className="mt-3 text-sm text-zinc-600">
              Run: {run.status} — {run.progress}
              {run.status !== "running" && run.usageInput + run.usageOutput > 0 && (
                <> · tokens in {run.usageInput} / out {run.usageOutput}</>
              )}
            </p>
          )}
          {error && (
            <p className="mt-3 text-sm text-red-600" role="alert">
              {error}
            </p>
          )}
          <dl className="mt-6 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            {(
              [
                ["Transactions", counts?.transactions],
                ["GL rows", counts?.glRows],
                ["Staff", counts?.staffAllocations],
                ["Precedents", counts?.precedents],
              ] as const
            ).map(([label, val]) => (
              <div key={label}>
                <dt className="text-zinc-500">{label}</dt>
                <dd className="text-lg font-medium tabular-nums">{val ?? "…"}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-medium text-zinc-900">Grant agreements</h2>
          <ul className="space-y-2 text-sm">
            {(grants ?? []).map((g) => (
              <li key={g._id} className="flex flex-wrap items-center gap-2 border-b border-zinc-100 py-2 last:border-0">
                <span className="font-medium">{g.fileName}</span>
                <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs">{g.status}</span>
                {g.grantId && <span className="text-zinc-600">{g.grantId}</span>}
                {g.status === "ready" && (
                  <span className="text-zinc-500">{g.budgetLineCount} budget lines</span>
                )}
                {g.error && <span className="text-red-600">{g.error}</span>}
              </li>
            ))}
            {grants?.length === 0 && <li className="text-zinc-500">No grants loaded yet.</li>}
          </ul>
        </section>

        <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          <h2 className="border-b border-zinc-100 px-6 py-4 text-lg font-medium">Decisions</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-zinc-50 text-zinc-600">
                <tr>
                  <th className="px-4 py-2 font-medium">Txn</th>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Description</th>
                  <th className="px-4 py-2 font-medium">Amount</th>
                  <th className="px-4 py-2 font-medium">Grant:line</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Rationale</th>
                </tr>
              </thead>
              <tbody>
                {(decisions ?? []).map((d) => (
                  <tr key={d.txnId} className="border-t border-zinc-100">
                    <td className="px-4 py-2 font-mono text-xs">{d.txnId}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{d.date}</td>
                    <td className="max-w-[12rem] truncate px-4 py-2" title={d.description}>
                      {d.description}
                    </td>
                    <td className="px-4 py-2 tabular-nums">{fmt(d.amountCents)}</td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {d.grantId ? `${d.grantId}:${d.budgetLine ?? "?"}` : "unrestricted"}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={
                          d.status === "blocked"
                            ? "text-red-700"
                            : d.status === "needs_review"
                              ? "text-amber-700"
                              : "text-zinc-600"
                        }
                      >
                        {d.status}
                      </span>
                    </td>
                    <td className="max-w-md truncate px-4 py-2 text-zinc-600" title={d.rationale}>
                      {d.rationale}
                    </td>
                  </tr>
                ))}
                {decisions?.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-zinc-500">
                      Run Steward after grants are ready.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

export default function Home() {
  return (
    <Providers>
      <StewardHome />
    </Providers>
  );
}
