"use client";

export function StatusBar({
  message,
  undoLabel,
  onUndo,
}: {
  message: string;
  undoLabel?: string;
  onUndo?: () => void;
}) {
  if (!message) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="status-toast-enter fixed bottom-4 left-4 z-50 flex items-center gap-3 rounded-[8px] border border-rule bg-sheet px-4 py-2 text-[14px] text-ink shadow-[0_8px_24px_rgba(14,27,44,0.12)]"
    >
      <span>{message}</span>
      {undoLabel && onUndo && (
        <button type="button" className="font-medium text-[#2563EB]" onClick={onUndo}>
          {undoLabel}
        </button>
      )}
    </div>
  );
}
