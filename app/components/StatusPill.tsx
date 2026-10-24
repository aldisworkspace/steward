"use client";

import { AlertTriangle, Ban, CheckCircle2, HelpCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export function StatusPill({ status }: { status: string }) {
  let Icon: LucideIcon = HelpCircle;
  let label = "Needs review";
  let className = "bg-attention-tint text-ink border-attention/40";

  if (status === "auto") {
    Icon = CheckCircle2;
    label = "Clean";
    className = "bg-money-tint text-ink border-money/40";
  } else if (status === "blocked") {
    Icon = Ban;
    label = "Disallowed";
    className = "bg-redpen-tint text-ink border-redpen/40";
  } else if (status === "needs_review") {
    Icon = AlertTriangle;
    label = "Needs you";
    className = "bg-attention-tint text-ink border-attention/40";
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px] font-medium ${className}`}
    >
      <Icon size={14} aria-hidden />
      {label}
    </span>
  );
}
