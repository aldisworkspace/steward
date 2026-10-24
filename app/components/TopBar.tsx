"use client";

export function TopBar({
  orgDisplay,
  showSyntheticBadge,
  isCustomData,
  viewOnly,
  runStatus,
  runProgress,
  actor,
  setActor,
  approverLabel,
  stewardLabel,
  onOpenCommand,
}: {
  orgDisplay: string;
  showSyntheticBadge: boolean;
  isCustomData: boolean;
  viewOnly: boolean;
  runStatus: string | undefined;
  runProgress: string | undefined;
  actor: "approver" | "steward";
  setActor: (a: "approver" | "steward") => void;
  approverLabel: string;
  stewardLabel: string;
  onOpenCommand: () => void;
}) {
  const running = runStatus === "running";
  return (
    <header className="flex h-14 shrink-0 items-center bg-navy px-4 text-white">
      <div className="flex w-full flex-wrap items-center gap-3">
        <span className="text-[15px] font-medium text-white/95">{orgDisplay}</span>
        {showSyntheticBadge && !isCustomData && (
          <span className="rounded-[4px] border border-white/25 bg-white/10 px-2 py-0.5 text-[12px]">
            Synthetic demo data
          </span>
        )}
        {isCustomData && (
          <span className="rounded-[4px] border border-white/25 px-2 py-0.5 text-[12px] text-white/80">
            Your data
          </span>
        )}
        {viewOnly && <span className="text-[12px] text-white/60">View-only demo</span>}
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-full border border-white/20 bg-navy-2 px-3 py-1.5 text-[13px]">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-navy font-display text-[13px] font-bold">
              S
            </span>
            <span
              className={`h-2 w-2 rounded-full ${running ? "bg-attention presence-dot-running" : "bg-money"}`}
              aria-hidden
            />
            <span className="max-w-[200px] truncate text-white/90">
              {running ? runProgress ?? "Reviewing…" : "Watching the bank feed"}
            </span>
          </div>
          <label className="flex items-center gap-2 text-[13px] text-white/80">
            Acting as
            <select
              className="rounded-[4px] border border-white/25 bg-navy-2 px-2 py-1 text-[13px] text-white"
              value={actor}
              onChange={(e) => setActor(e.target.value as "approver" | "steward")}
            >
              <option value="approver">{approverLabel}</option>
              <option value="steward">{stewardLabel}</option>
            </select>
          </label>
          <button
            type="button"
            onClick={onOpenCommand}
            className="rounded-[6px] border border-white/25 px-2 py-1 text-[13px] text-white/90 hover:bg-white/10"
          >
            ⌘K
          </button>
        </div>
      </div>
    </header>
  );
}
