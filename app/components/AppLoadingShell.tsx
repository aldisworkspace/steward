"use client";

/** First paint while Convex connects: the shell's own shapes, no spinner. */
export function AppLoadingShell() {
  return (
    <div className="flex min-h-screen flex-col bg-paper" aria-busy aria-label="Loading Steward">
      <div className="border-b border-rule">
        <div className="mx-auto flex h-16 max-w-[1360px] items-center gap-6 px-4 sm:px-6">
          <span className="font-serif text-[22px] leading-none text-ink">Steward</span>
          <div className="hidden h-3 w-48 rounded-pill bg-paper-2 sm:block" />
          <div className="ml-auto h-8 w-40 rounded-pill bg-paper-2" />
        </div>
      </div>
      <div className="mx-auto w-full max-w-[1040px] animate-pulse px-4 pt-8 sm:px-6">
        <div className="h-9 w-80 max-w-full rounded-sm bg-paper-2" />
        <div className="mt-4 h-4 w-96 max-w-full rounded-sm bg-paper-2" />
        <div className="mt-8 space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[148px] rounded-md border border-rule bg-sheet" />
          ))}
        </div>
      </div>
    </div>
  );
}
