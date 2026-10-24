"use client";

import { useEffect } from "react";
import { WhyDrawer } from "./WhyDrawer";

export type PanelMode = "why" | "evidence" | "transaction" | null;

export function ContextPanel({
  mode,
  onClose,
  txnId,
  passcode,
  canWrite,
  title,
  children,
}: {
  mode: PanelMode;
  onClose: () => void;
  txnId: string | null;
  passcode?: string;
  canWrite: boolean;
  title?: string;
  children?: React.ReactNode;
}) {
  const open = mode !== null;

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  if (mode === "why" && txnId) {
    return (
      <>
        <aside
          className="fixed right-0 top-0 z-50 flex h-full w-[440px] max-w-[100vw] flex-col border-l border-rule bg-sheet shadow-[0_8px_24px_rgba(14,27,44,0.12)]"
          role="dialog"
          aria-modal="true"
          aria-label="Ask Steward why"
        >
          <WhyDrawer txnId={txnId} open passcode={passcode} canWrite={canWrite} embedded onClose={onClose} />
        </aside>
      </>
    );
  }

  return (
    <>
      <button type="button" className="fixed inset-0 z-40 bg-navy/30" aria-label="Close panel" onClick={onClose} />
      <aside
        className="fixed right-0 top-0 z-50 flex h-full w-[440px] max-w-[100vw] flex-col border-l border-rule bg-sheet shadow-[0_8px_32px_rgba(14,27,44,0.12)]"
        role="dialog"
        aria-modal="true"
        aria-label={title ?? "Details"}
      >
        <header className="flex items-center justify-between border-b border-rule px-5 py-4">
          <h2 className="text-[17px] font-semibold text-ink">{title}</h2>
          <button type="button" onClick={onClose} className="text-[14px] text-ink-2 underline">
            Close
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-5 text-[14px] text-ink">{children}</div>
      </aside>
    </>
  );
}
