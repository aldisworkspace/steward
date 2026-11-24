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
      className="no-print status-toast-enter fixed bottom-4 left-4 right-4 z-50 flex items-center gap-4 rounded-md bg-ink px-4 py-3 text-base text-sheet shadow-float sm:right-auto sm:max-w-[520px]"
    >
      <span className="min-w-0">{message}</span>
      {undoLabel && onUndo && (
        <button type="button" className="ml-auto min-h-11 shrink-0 font-medium text-sheet underline underline-offset-4 sm:min-h-0" onClick={onUndo}>
          {undoLabel}
        </button>
      )}
    </div>
  );
}
