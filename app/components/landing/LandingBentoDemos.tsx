"use client";

import { useState } from "react";
import { Clerk } from "./LandingMarks";

const SOURCES = [
  { label: "Bank", value: "−$482.50", marked: false },
  { label: "Ledger", value: "Program supplies", marked: true },
  { label: "Contract", value: "§4.7", marked: false },
  { label: "Time records", value: "Staff allocation", marked: false },
];

export function SourcesDisagreeDemo() {
  return (
    <dl className="mt-8 max-w-[40rem] border-t border-rule">
      {SOURCES.map((source) => (
        <div
          key={source.label}
          className="grid grid-cols-[minmax(7.5rem,11rem)_minmax(0,1fr)] items-baseline gap-4 border-b border-rule py-3.5"
        >
          <dt className="text-[13px] text-ink-2">{source.label}</dt>
          <dd className={`min-w-0 break-words text-[15px] text-ink ${source.label === "Bank" ? "tabular" : ""}`}>
            {source.marked ? (
              <span className="inline-flex items-center gap-2">
                <span className="border-b-2 border-redpen pb-0.5">{source.value}</span>
                <Clerk className="text-ink-2" />
              </span>
            ) : (
              source.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function DefendDemo() {
  const [sent, setSent] = useState(false);
  return (
    <div className="mt-4">
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 text-[14px] leading-snug text-ink">“Could this be team building?”</p>
        <button
          type="button"
          aria-pressed={sent}
          aria-label="Send the sample question. This does not call the model."
          className={`landing-control chip-button inline-flex min-h-11 shrink-0 items-center rounded-[6px] border bg-sheet px-3 text-[13px] font-medium text-ink ${
            sent ? "border-money bg-money-tint" : "border-rule"
          }`}
          onClick={() => setSent((open) => !open)}
        >
          {sent ? "Sent" : "Send"}
        </button>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
        Sample reply: it stands by §4.7. This button does not call the model.
      </p>
    </div>
  );
}

export function ApproveDemo() {
  const [clicked, setClicked] = useState(false);
  return (
    <div className="mt-4">
      <button
        type="button"
        aria-pressed={clicked}
        aria-describedby="example-approve-note"
        className={`landing-control chip-button inline-flex min-h-11 items-center rounded-[6px] border bg-sheet px-4 text-[14px] font-semibold ${
          clicked ? "border-redpen text-redpen" : "border-rule text-ink"
        }`}
        onClick={() => setClicked((open) => !open)}
      >
        {clicked ? "Not allowed" : "Approve"}
      </button>
      <p id="example-approve-note" className="mt-2 select-text text-[13px] leading-relaxed text-ink-2">
        Example only. Steward can propose an entry. It cannot approve it, post it, or move money.
      </p>
    </div>
  );
}
