"use client";

export function AppLoadingShell() {
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <div className="h-14 animate-pulse bg-navy/90" />
      <div className="flex flex-1">
        <div className="w-16 shrink-0 border-r border-rule bg-sheet" />
        <div className="flex flex-1 flex-col gap-4 p-6">
          <div className="h-10 w-64 animate-pulse rounded-[8px] bg-rule" />
          <div className="h-48 animate-pulse rounded-[8px] bg-rule" />
          <div className="grid flex-1 gap-4 md:grid-cols-2">
            <div className="h-40 animate-pulse rounded-[8px] bg-rule" />
            <div className="h-40 animate-pulse rounded-[8px] bg-rule" />
          </div>
        </div>
      </div>
    </div>
  );
}
