"use client";

import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { Providers } from "./providers";

function StewardHome() {
  const counts = useQuery(api.ingest.counts);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function loadDemo() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/seed", { method: "POST" });
      const body = (await res.json()) as { error?: string; ok?: boolean };
      if (!res.ok) {
        throw new Error(body.error ?? `Seed failed (${res.status})`);
      }
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-full flex flex-col items-center justify-center bg-zinc-50 px-6 py-16">
      <main className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Steward</h1>
          {(loaded || (counts && counts.transactions > 0)) && (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900 ring-1 ring-amber-200">
              Synthetic demo data
            </span>
          )}
        </div>

        <p className="mb-6 text-sm text-zinc-600">
          Load fictional grant, bank, ledger, and staff records into Convex for the demo.
        </p>

        <button
          type="button"
          onClick={() => void loadDemo()}
          disabled={loading}
          className="w-full rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Load demo data"}
        </button>

        {error && (
          <p className="mt-4 text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        <dl className="mt-8 grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-zinc-500">Transactions</dt>
            <dd className="text-lg font-medium tabular-nums text-zinc-900">
              {counts === undefined ? "…" : counts.transactions}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">GL rows</dt>
            <dd className="text-lg font-medium tabular-nums text-zinc-900">
              {counts === undefined ? "…" : counts.glRows}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Staff allocations</dt>
            <dd className="text-lg font-medium tabular-nums text-zinc-900">
              {counts === undefined ? "…" : counts.staffAllocations}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Precedents</dt>
            <dd className="text-lg font-medium tabular-nums text-zinc-900">
              {counts === undefined ? "…" : counts.precedents}
            </dd>
          </div>
        </dl>
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
