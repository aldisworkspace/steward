"use client";

import { getFundLabel } from "@/lib/fundLabels";
import type { GrantTerms } from "@/lib/types";
import { useEffect, useMemo, useState } from "react";

export type Command = {
  id: string;
  label: string;
  keywords?: string;
  run: () => void;
};

export function CommandPalette({
  open,
  onClose,
  commands,
  transactions = [],
  grantTerms = [],
  onJumpTxn,
}: {
  open: boolean;
  onClose: () => void;
  commands: Command[];
  transactions?: {
    txnId: string;
    description: string;
    amountCents: number;
    grantId?: string | null;
  }[];
  grantTerms?: GrantTerms[];
  onJumpTxn?: (txnId: string) => void;
}) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base =
      !needle
        ? commands
        : commands.filter(
            (c) =>
              c.label.toLowerCase().includes(needle) ||
              c.keywords?.toLowerCase().includes(needle),
          );
    if (needle.length < 2) return base;
    const jumps = transactions
      .filter(
        (t) =>
          t.txnId.toLowerCase().includes(needle) ||
          t.description.toLowerCase().includes(needle) ||
          String(Math.abs(t.amountCents / 100)).includes(needle),
      )
      .slice(0, 8)
      .map((t) => {
        const fund =
          t.grantId != null ? getFundLabel(t.grantId, grantTerms).title : getFundLabel(null, grantTerms).title;
        return {
          id: `jump-${t.txnId}`,
          label: `Jump to ${t.description} · ${fund} · ${t.txnId}`,
          keywords: `${t.txnId} ${t.description} ${fund}`,
          run: () => onJumpTxn?.(t.txnId),
        };
      });
    return [...base, ...jumps];
  }, [commands, q, transactions, grantTerms, onJumpTxn]);

  useEffect(() => {
    if (!open) {
      setQ("");
      setIdx(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setIdx((i) => Math.min(i + 1, filtered.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setIdx((i) => Math.max(i - 1, 0));
      }
      if (e.key === "Enter" && filtered[idx]) {
        e.preventDefault();
        filtered[idx].run();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, filtered, idx, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-navy/40 pt-[15vh]">
      <button type="button" className="absolute inset-0" aria-label="Close" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-[10px] border border-rule bg-sheet p-2 shadow-none">
        <input
          autoFocus
          className="w-full rounded-[6px] border border-rule px-3 py-2 text-[15px] outline-none focus:border-sky"
          placeholder="Type a command…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setIdx(0);
          }}
        />
        <ul className="mt-2 max-h-64 overflow-y-auto">
          {filtered.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                className={`w-full rounded-[6px] px-3 py-2 text-left text-[15px] ${
                  i === idx ? "bg-money-tint text-ink" : "text-ink hover:bg-paper"
                }`}
                onMouseEnter={() => setIdx(i)}
                onClick={() => {
                  c.run();
                  onClose();
                }}
              >
                {c.label}
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="px-3 py-4 text-[13px] text-ink-2">No matching commands.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
