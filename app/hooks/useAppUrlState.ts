"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { InboxFilter } from "@/lib/inboxFilters";

export type AppTab =
  | "overview"
  | "inbox"
  | "transactions"
  | "grants"
  | "report"
  | "proof"
  | "yourdata";

const VALID_TABS = new Set<AppTab>([
  "overview",
  "inbox",
  "transactions",
  "grants",
  "report",
  "proof",
  "yourdata",
]);

const VALID_FILTERS = new Set<InboxFilter>([
  "all",
  "not_allowed",
  "needs_you",
  "approval",
  "payroll",
  "books",
  "duplicate",
  "other",
  "done",
]);

export function useAppUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const tab = useMemo((): AppTab => {
    const t = searchParams.get("tab") ?? "overview";
    return VALID_TABS.has(t as AppTab) ? (t as AppTab) : "overview";
  }, [searchParams]);

  const caseId = searchParams.get("case");
  const fundFilter = searchParams.get("fund");
  const inboxFilter = useMemo((): InboxFilter => {
    const f = searchParams.get("filter") ?? "all";
    const legacy: Record<string, InboxFilter> = {
      disallowed: "not_allowed",
      needs_you: "all",
      prior_approval: "approval",
      bookkeeper: "books",
      duplicates: "duplicate",
      resolved: "done",
    };
    const mapped = legacy[f] ?? f;
    return VALID_FILTERS.has(mapped as InboxFilter) ? (mapped as InboxFilter) : "all";
  }, [searchParams]);

  const txnFilter = useMemo((): "all" | "clean" | "exceptions" | "blocked" => {
    const f = searchParams.get("filter");
    if (f === "clean" || f === "exceptions" || f === "blocked") return f;
    return "all";
  }, [searchParams]);

  const replaceParams = useCallback(
    (mutate: (p: URLSearchParams) => void) => {
      const p = new URLSearchParams(searchParams.toString());
      mutate(p);
      const q = p.toString();
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const setTab = useCallback(
    (next: AppTab) => {
      replaceParams((p) => {
        p.set("tab", next);
        if (next !== "inbox") p.delete("case");
        if (next !== "inbox" && next !== "transactions") p.delete("filter");
      });
    },
    [replaceParams],
  );

  const setCaseId = useCallback(
    (txnId: string | null) => {
      replaceParams((p) => {
        p.set("tab", "inbox");
        if (txnId) p.set("case", txnId);
        else p.delete("case");
      });
    },
    [replaceParams],
  );

  const setInboxFilter = useCallback(
    (filter: InboxFilter, fund?: string | null) => {
      replaceParams((p) => {
        p.set("tab", "inbox");
        p.set("filter", filter);
        if (fund) p.set("fund", fund);
        else p.delete("fund");
      });
    },
    [replaceParams],
  );

  const setTxnFilter = useCallback(
    (filter: "all" | "clean" | "exceptions" | "blocked", fund?: string | null) => {
      replaceParams((p) => {
        p.set("tab", "transactions");
        if (filter === "all") p.delete("filter");
        else p.set("filter", filter);
        if (fund) p.set("fund", fund);
        else p.delete("fund");
      });
    },
    [replaceParams],
  );

  const setFundFilter = useCallback(
    (fund: string | null) => {
      replaceParams((p) => {
        if (fund) p.set("fund", fund);
        else p.delete("fund");
      });
    },
    [replaceParams],
  );

  // One replace so a resolved txn id is not overwritten by a later stale replace.
  const openResolvedInboxCase = useCallback(
    (txnId: string, filter: InboxFilter) => {
      replaceParams((p) => {
        p.set("tab", "inbox");
        p.set("case", txnId);
        p.set("filter", filter);
        p.delete("fund");
      });
    },
    [replaceParams],
  );

  return {
    tab,
    caseId,
    inboxFilter,
    txnFilter,
    fundFilter,
    setTab,
    setCaseId,
    setInboxFilter,
    setTxnFilter,
    setFundFilter,
    openResolvedInboxCase,
  };
}
