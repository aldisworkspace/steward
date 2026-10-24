"use client";

import { useAction } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";

type Msg = { role: "user" | "steward"; text: string; stance?: string; cited?: string[]; change?: string };

export function WhyDrawer({
  txnId,
  open,
  onClose,
}: {
  txnId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const explain = useAction(api.agent.explain);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [thread, setThread] = useState<Msg[]>([]);

  useEffect(() => {
    if (!open) {
      setThread([]);
      setInput("");
    }
  }, [open, txnId]);

  if (!open || !txnId) return null;

  async function ask() {
    if (!input.trim()) return;
    const q = input.trim();
    setInput("");
    setThread((t) => [...t, { role: "user", text: q }]);
    setLoading(true);
    try {
      const ans = await explain({ txnId: txnId!, question: q });
      const stanceMap: Record<string, string> = {
        stand_by: "Stands by it",
        revise: "Will revise",
        need_human: "Needs a person",
      };
      setThread((t) => [
        ...t,
        {
          role: "steward",
          text: ans.answer,
          stance: stanceMap[ans.stance] ?? ans.stance,
          cited: ans.citedEvidence,
          change: ans.wouldChangeIf,
        },
      ]);
    } catch (e) {
      setThread((t) => [...t, { role: "steward", text: (e as Error).message }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button type="button" className="fixed inset-0 z-40 bg-ink/20" aria-label="Close drawer" onClick={onClose} />
      <aside
        className="fixed right-0 top-0 z-50 flex h-full w-[440px] max-w-full flex-col border-l border-rule bg-sheet"
        role="dialog"
        aria-labelledby="why-title"
      >
        <header className="border-b border-rule px-5 py-4">
          <h2 id="why-title" className="text-[17px] font-semibold text-ink">
            Ask Steward why
          </h2>
          <p className="mt-1 text-[13px] text-ink-2">{txnId}</p>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {thread.map((m, i) => (
            <div key={i} className="max-w-[65ch]">
              {m.role === "user" ? (
                <p className="text-[15px] text-ink">{m.text}</p>
              ) : (
                <div className="space-y-2">
                  {m.stance && (
                    <p
                      className={`text-[13px] font-medium ${
                        m.stance === "Stands by it"
                          ? "text-ledger"
                          : m.stance === "Will revise"
                            ? "text-pencil"
                            : "text-redpen"
                      }`}
                    >
                      {m.stance}
                    </p>
                  )}
                  <p className="text-[15px] text-ink">{m.text}</p>
                  {m.cited && m.cited.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {m.cited.map((c) => (
                        <span key={c} className="rounded-[4px] border border-rule px-2 py-0.5 text-[13px] text-ink-2">
                          {c}
                        </span>
                      ))}
                    </div>
                  )}
                  {m.change && <p className="text-[13px] text-ink-2">Would change if: {m.change}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
        <footer className="border-t border-rule p-4">
          <div className="flex gap-2">
            <input
              className="min-w-0 flex-1 rounded-[4px] border border-rule px-3 py-2 text-[15px]"
              placeholder="Challenge this decision…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void ask()}
            />
            <button
              type="button"
              disabled={loading}
              onClick={() => void ask()}
              className="rounded-[4px] bg-ledger px-3 py-2 text-[15px] font-medium text-white disabled:opacity-50"
            >
              Ask
            </button>
          </div>
        </footer>
      </aside>
    </>
  );
}
