"use client";

import { useEffect } from "react";

const KEYS: [string, string][] = [
  ["J / K", "Next / previous exception"],
  ["A", "Take the primary action on the open case"],
  ["O", "Override with a note"],
  ["E", "Show or hide the evidence"],
  ["⌘K", "Command palette"],
  ["?", "This list"],
  ["Esc", "Close"],
];

export function KeyboardHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <button type="button" className="fixed inset-0 z-50 bg-ink/25" aria-label="Close shortcuts" onClick={onClose} />
      <div
        className="fixed left-1/2 top-[18%] z-50 w-[calc(100%-32px)] max-w-md -translate-x-1/2 rounded-md border border-rule bg-sheet p-6 shadow-float"
        role="dialog"
        aria-modal="true"
        aria-labelledby="kbd-title"
      >
        <h2 id="kbd-title" className="font-serif text-lg">
          Keyboard shortcuts
        </h2>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-base">
          {KEYS.map(([k, v]) => (
            <div key={k} className="contents">
              <dt>
                <kbd className="tabular rounded-[4px] border border-rule-strong px-1.5 text-sm">{k}</kbd>
              </dt>
              <dd className="text-ink-2">{v}</dd>
            </div>
          ))}
        </dl>
        <button type="button" autoFocus className="mt-6 min-h-10 rounded-pill border border-rule-strong px-4 text-base hover:bg-paper" onClick={onClose}>
          Close
        </button>
      </div>
    </>
  );
}
