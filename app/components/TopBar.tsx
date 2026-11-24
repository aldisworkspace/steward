"use client";

import Link from "next/link";
import type { AppTab } from "../hooks/useAppUrlState";
import { ROLE_WORD, shortName, type Person } from "./AppContext";

const NAV: { id: AppTab; label: string }[] = [
  { id: "packages", label: "Packages" },
  { id: "review", label: "Review" },
  { id: "data", label: "Data" },
];

export function TopBar({
  orgDisplay,
  showSyntheticBadge,
  isCustomData,
  viewOnly,
  runStatus,
  runProgress,
  tab,
  onTab,
  reviewCount,
  actor,
  people,
  setActor,
  onOpenCommand,
}: {
  orgDisplay: string;
  showSyntheticBadge: boolean;
  isCustomData: boolean;
  viewOnly: boolean;
  runStatus: string | undefined;
  runProgress: string | undefined;
  tab: AppTab;
  onTab: (t: AppTab) => void;
  reviewCount: number;
  actor: string;
  people: Person[];
  setActor: (name: string) => void;
  onOpenCommand: () => void;
}) {
  const running = runStatus === "running";
  const me = people.find((p) => p.name === actor);
  const activeNav: AppTab = tab === "package" ? "packages" : tab;
  return (
    <header className="no-print z-30 border-b border-rule bg-paper/95 backdrop-blur-[6px] lg:sticky lg:top-0">
      <div className="mx-auto flex max-w-[1360px] flex-wrap items-center gap-x-6 gap-y-2 px-4 pt-3 sm:px-6 lg:flex-nowrap lg:pb-0 lg:pt-0">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3 lg:h-16">
          <Link href="/" className="inline-flex min-h-11 items-center font-serif text-[22px] leading-none tracking-[-0.02em] text-ink">
            Steward
          </Link>
          <span className="hidden h-4 w-px bg-rule-strong sm:block" aria-hidden />
          <span className="hidden truncate text-sm text-ink-2 sm:block">{orgDisplay}</span>
          {showSyntheticBadge && !isCustomData && (
            <span className="whitespace-nowrap rounded-pill border border-rule-strong px-2 py-0.5 text-2xs font-medium text-ink-2">
              Synthetic<span className="hidden sm:inline"> demo</span> data
            </span>
          )}
          {isCustomData && (
            <span className="whitespace-nowrap rounded-pill border border-rule-strong px-2 py-0.5 text-2xs font-medium text-ink-2">
              Your data
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2 lg:order-3">
          <span className="hidden items-center gap-2 text-xs text-ink-2 md:flex" role="status" aria-live="polite">
            <span
              aria-hidden
              className={`h-1.5 w-1.5 rounded-pill ${running ? "presence-dot-running bg-amber" : runStatus === "error" ? "bg-redpen" : "bg-green"}`}
            />
            <span className="max-w-[180px] truncate">
              {running ? (runProgress ?? "Steward is reading…") : runStatus === "error" ? "Last run failed" : "Up to date"}
            </span>
          </span>
          <label className="flex items-center gap-2 text-xs text-ink-2">
            <span className="hidden sm:inline">Acting as</span>
            <span className="sr-only sm:hidden">Acting as</span>
            <select
              title={me ? me.roles.map((r) => ROLE_WORD[r]).join(", ") : undefined}
              className="min-h-11 max-w-[8.5rem] rounded-pill sm:max-w-[14rem] border border-rule-strong bg-sheet py-1 pl-3 pr-7 text-sm text-ink sm:min-h-8"
              value={actor}
              onChange={(e) => setActor(e.target.value)}
            >
              {people.map((p) => (
                <option key={p.name} value={p.name}>
                  {shortName(p.name)}
                </option>
              ))}
            </select>
          </label>
          {me && <span className="hidden whitespace-nowrap text-xs text-ink-2 sm:inline">{me.roles.map((r) => ROLE_WORD[r]).join(" · ")}</span>}
          <button
            type="button"
            onClick={onOpenCommand}
            aria-label="Open command palette"
            className="hidden min-h-8 items-center rounded-pill border border-rule-strong bg-sheet px-2.5 text-xs text-ink-2 hover:border-ink-2 hover:text-ink sm:inline-flex"
          >
            ⌘K
          </button>
        </div>

        <nav aria-label="Main" className="-mx-1 flex w-full items-stretch lg:order-2 lg:mx-0 lg:w-auto">
          {NAV.map((n) => {
            const active = activeNav === n.id;
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => onTab(n.id)}
                aria-current={active ? "page" : undefined}
                className={`relative flex min-h-11 flex-1 items-center justify-center gap-2 px-3 text-base lg:h-16 lg:flex-none ${
                  active ? "font-medium text-ink" : "text-ink-2 hover:text-ink"
                }`}
              >
                {n.label}
                {n.id === "review" && reviewCount > 0 && (
                  <span className="tabular rounded-pill bg-amber-tint px-1.5 text-2xs font-medium leading-[18px] text-amber-ink">
                    {reviewCount}
                  </span>
                )}
                <span
                  aria-hidden
                  className={`absolute inset-x-3 bottom-0 h-0.5 rounded-pill bg-ink transition-opacity duration-150 ${active ? "opacity-100" : "opacity-0"}`}
                />
              </button>
            );
          })}
        </nav>
      </div>
      {viewOnly && (
        <p className="border-t border-rule px-4 py-1.5 text-center text-xs text-ink-2 sm:px-6">
          View-only demo: you can look at everything; changes need the demo key in the link.
        </p>
      )}
    </header>
  );
}
