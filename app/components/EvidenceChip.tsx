"use client";

import type { ReactNode } from "react";

const STYLES: Record<string, string> = {
  bank: "bg-navy text-white",
  gl: "bg-slate text-white",
  contract: "border-2 border-money bg-sheet text-money font-serif",
  time_record: "bg-sky/15 text-ink border border-sky/40",
  precedent: "bg-attention-tint text-ink border border-attention/50",
};

export function EvidenceChip({
  source,
  label,
  body,
}: {
  source: string;
  label: string;
  body: ReactNode;
}) {
  const style = STYLES[source] ?? "border border-rule bg-sheet text-ink";
  return (
    <div className={`rounded-[6px] p-3 ${style}`}>
      <p className="text-[12px] font-semibold uppercase tracking-wide opacity-90">{label}</p>
      <div className="mt-2 text-[13px] leading-snug">{body}</div>
    </div>
  );
}
