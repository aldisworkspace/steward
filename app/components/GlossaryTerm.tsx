"use client";

import type { ReactNode } from "react";

const DEFINITIONS = {
  "restricted funds":
    "Money a funder gave for a specific program; it can only be spent on that grant’s allowed budget lines.",
  "general funds":
    "Money with no funder restrictions—often where disallowed or miscoded costs are moved.",
  reclass:
    "A journal entry that moves a charge from one fund or budget line to another without changing the bank balance.",
  "journal entry":
    "The formal debit-and-credit record that updates the books after you approve Steward’s correction.",
  disallowed:
    "A cost the grant agreement prohibits; Steward flags it and usually moves it off grant funds.",
  "prior approval":
    "Spend that needs the funder’s written OK before you pay—Steward flags it when no approval is on file.",
  variance:
    "How far actual spending on a budget line is above the grant’s allowed percentage over the approved amount.",
} as const;

export type GlossaryKey = keyof typeof DEFINITIONS;

export function GlossaryTerm({
  term,
  children,
}: {
  term: GlossaryKey;
  children?: ReactNode;
}) {
  const text = children ?? term;
  return (
    <span className="group relative cursor-help border-b border-dotted border-ink-2">
      {text}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-0 z-50 mb-1 hidden max-w-[280px] rounded-[6px] border border-rule bg-sheet px-2 py-1.5 text-[12px] font-normal normal-case leading-snug text-ink shadow-[0_4px_24px_rgba(14,27,44,0.12)] group-hover:block group-focus-within:block"
      >
        {DEFINITIONS[term]}
      </span>
    </span>
  );
}
