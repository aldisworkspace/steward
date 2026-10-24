"use client";

export function KeyboardHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <>
      <button type="button" className="fixed inset-0 z-50 bg-navy/30" aria-label="Close" onClick={onClose} />
      <div
        className="fixed left-1/2 top-[20%] z-50 w-full max-w-md -translate-x-1/2 rounded-[8px] border border-rule bg-sheet p-6 shadow-[0_8px_32px_rgba(14,27,44,0.12)]"
        role="dialog"
        aria-label="Keyboard shortcuts"
      >
        <h2 className="text-[17px] font-semibold">Keyboard shortcuts</h2>
        <ul className="mt-4 space-y-2 text-[14px] text-ink">
          <li>
            <kbd className="rounded border border-rule px-1">J</kbd> / <kbd className="rounded border border-rule px-1">K</kbd> — Next / previous in queue
          </li>
          <li>
            <kbd className="rounded border border-rule px-1">A</kbd> — Approve / acknowledge
          </li>
          <li>
            <kbd className="rounded border border-rule px-1">R</kbd> — Reject / override
          </li>
          <li>
            <kbd className="rounded border border-rule px-1">E</kbd> — Toggle evidence
          </li>
          <li>
            <kbd className="rounded border border-rule px-1">⌘K</kbd> — Command palette
          </li>
          <li>
            <kbd className="rounded border border-rule px-1">?</kbd> — This help (in inbox, opens Ask why when a case is selected)
          </li>
          <li>
            <kbd className="rounded border border-rule px-1">Esc</kbd> — Close panel
          </li>
        </ul>
        <button type="button" className="mt-4 text-[14px] text-sky underline" onClick={onClose}>
          Close
        </button>
      </div>
    </>
  );
}
