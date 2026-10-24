"use client";

import {
  FileText,
  Inbox,
  LayoutDashboard,
  List,
  Pin,
  ScrollText,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { AppTab } from "../hooks/useAppUrlState";

const ITEMS: { id: AppTab; label: string; Icon: typeof Inbox }[] = [
  { id: "overview", label: "Overview", Icon: LayoutDashboard },
  { id: "inbox", label: "Inbox", Icon: Inbox },
  { id: "transactions", label: "Transactions", Icon: List },
  { id: "grants", label: "Grants", Icon: FileText },
  { id: "report", label: "Reports", Icon: ScrollText },
  { id: "proof", label: "Proof", Icon: ShieldCheck },
  { id: "yourdata", label: "Your data", Icon: Upload },
];

export function NavRail({
  tab,
  onTab,
  inboxCount,
}: {
  tab: AppTab;
  onTab: (t: AppTab) => void;
  inboxCount: number;
}) {
  const [pinned, setPinned] = useState(false);
  const [hover, setHover] = useState(false);
  const wide = pinned || hover;

  useEffect(() => {
    try {
      setPinned(localStorage.getItem("steward-nav-pinned") === "1");
    } catch {
      /* ignore */
    }
  }, []);

  function togglePin() {
    setPinned((p) => {
      const next = !p;
      try {
        localStorage.setItem("steward-nav-pinned", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  return (
    <nav
      className={`absolute inset-y-0 left-0 z-30 flex flex-col border-r border-rule bg-sheet shadow-[0_8px_24px_rgba(14,27,44,0.12)] transition-[width] duration-200 ${
        wide ? "w-[220px]" : "w-16"
      }`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-label="Main"
    >
      <div className="flex h-14 items-center justify-between px-2">
        {wide && <span className="font-display pl-2 text-[15px] font-bold text-navy">Steward</span>}
        {wide && (
          <button
            type="button"
            onClick={togglePin}
            className="rounded-[6px] p-1.5 text-ink-2 hover:bg-paper"
            title={pinned ? "Unpin navigation" : "Pin navigation"}
          >
            <Pin size={16} className={pinned ? "fill-current" : ""} />
          </button>
        )}
      </div>
      <ul className="flex flex-1 flex-col gap-1 px-2 pb-4">
        {ITEMS.map(({ id, label, Icon }) => {
          const active = tab === id;
          return (
            <li key={id}>
              <button
                type="button"
                title={!wide ? label : undefined}
                onClick={() => onTab(id)}
                className={`flex w-full items-center gap-3 rounded-[8px] px-3 py-2.5 text-[14px] ${
                  active ? "bg-money-tint font-medium text-ink" : "text-ink-2 hover:bg-paper"
                }`}
              >
                <span className="relative shrink-0">
                  <Icon size={20} strokeWidth={active ? 2.25 : 2} aria-hidden />
                  {id === "inbox" && inboxCount > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-attention px-1 text-[10px] font-semibold text-ink">
                      {inboxCount > 99 ? "99+" : inboxCount}
                    </span>
                  )}
                </span>
                {wide && <span className="truncate">{label}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
