"use client";

import { Check } from "lucide-react";
import { useState } from "react";

export function SourcesDisagreeDemo() {
  return (
    <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[12px]">
      <div className="rounded-[6px] border border-rule bg-paper p-2 text-ink-2">Bank</div>
      <div className="rounded-[6px] border border-rule bg-paper p-2 text-ink-2">
        <span className="border-b-2 border-redpen pb-0.5 text-ink">Books</span>
      </div>
      <div className="rounded-[6px] border border-rule bg-paper p-2 text-ink-2">Contract</div>
    </div>
  );
}

export function DefendDemo() {
  const [sent, setSent] = useState(false);
  return (
    <div className="mt-1">
      <div className="flex gap-2 rounded-[6px] bg-paper p-2">
        <p className="flex-1 text-[14px] text-ink-2">“Could this be team building?”</p>
        <button
          type="button"
          className={`chip-button shrink-0 rounded-[6px] border border-ink-2 bg-sheet px-3 py-1.5 text-[13px] font-medium text-ink transition-transform active:scale-95 ${
            sent ? "bento-send-pop bg-money-tint" : ""
          }`}
          onClick={() => {
            setSent(true);
            window.setTimeout(() => setSent(false), 600);
          }}
        >
          Send
        </button>
      </div>
      <p className="mt-2 text-[13px] text-ink">Stands by it — cites §4.7 and prior rulings.</p>
    </div>
  );
}

export function ApproveDemo() {
  const [clicked, setClicked] = useState(false);
  return (
    <div>
      <button
        type="button"
        className={`chip-button rounded-[6px] border border-ink-2 bg-sheet px-4 py-2 text-[14px] font-semibold text-ink transition-all hover:bg-paper hover:brightness-105 active:scale-95 ${
          clicked ? "bento-approve-shake border-redpen text-redpen" : ""
        }`}
        onClick={() => {
          setClicked(true);
          window.setTimeout(() => setClicked(false), 1200);
        }}
      >
        {clicked ? (
          <span className="inline-flex items-center gap-1">
            <Check size={16} aria-hidden />
            Blocked
          </span>
        ) : (
          "Approve"
        )}
      </button>
      <p className="mt-2 text-[13px]">
        Segregation of duties: Steward proposes entries but cannot approve them.
      </p>
    </div>
  );
}
