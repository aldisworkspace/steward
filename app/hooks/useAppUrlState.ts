"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FIX_TYPES, type ReviewFilter } from "../lib/fixType";

export type AppTab = "packages" | "review" | "package" | "data";
export type DataView = "upload" | "ledger" | "terms";

const VALID_TABS = new Set<AppTab>(["packages", "review", "package", "data"]);

/** Old tab names (bookmarks, the landing, shared links) land somewhere sensible. */
const LEGACY_TABS: Record<string, { tab: AppTab; view?: DataView }> = {
  overview: { tab: "packages" },
  inbox: { tab: "review" },
  report: { tab: "packages" },
  yourdata: { tab: "data" },
  transactions: { tab: "data", view: "ledger" },
  grants: { tab: "data", view: "terms" },
  proof: { tab: "packages" },
};

const VALID_FILTERS = new Set<string>(["all", "done", ...FIX_TYPES.map((f) => f.id)]);
const LEGACY_FILTERS: Record<string, ReviewFilter> = {
  disallowed: "not_allowed",
  needs_you: "all",
  prior_approval: "approval",
  bookkeeper: "fund",
  books: "fund",
  duplicates: "amount",
  duplicate: "amount",
  resolved: "done",
  other: "fund",
};

/** GL line (L0001), legacy bank txn (T0001) or unrecorded bank line (B0001). */
export function isTxnId(value: string): boolean {
  return /^[TLB]\d+$/i.test(value.trim());
}

/** Atomic URL update: undefined leaves a param alone, null removes it. */
export type AppParamsUpdate = {
  tab?: AppTab;
  filter?: string | null;
  case?: string | null;
  id?: string | null;
  view?: DataView | null;
  fund?: string | null;
  vendor?: string | null;
};

/** A package is addressed by grant and period start: FS-27-0412_2026-10-01. */
export function packageKey(grantId: string, periodStart: string) {
  return `${grantId}_${periodStart}`;
}
export function parsePackageKey(key: string | null): { grantId: string; periodStart: string } | null {
  if (!key) return null;
  const m = key.match(/^(.+)_(\d{4}-\d{2}-\d{2})$/);
  return m ? { grantId: m[1]!, periodStart: m[2]! } : null;
}

export function useAppUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const rawTab = searchParams.get("tab");
  const caseParam = searchParams.get("case");

  const { tab, legacyView } = useMemo((): { tab: AppTab; legacyView: DataView | null } => {
    if (rawTab && VALID_TABS.has(rawTab as AppTab)) return { tab: rawTab as AppTab, legacyView: null };
    if (rawTab && LEGACY_TABS[rawTab]) return { tab: LEGACY_TABS[rawTab]!.tab, legacyView: LEGACY_TABS[rawTab]!.view ?? null };
    // A ?case= deep link without a valid tab opens Review.
    if (caseParam) return { tab: "review", legacyView: null };
    return { tab: "packages", legacyView: null };
  }, [rawTab, caseParam]);

  const needsRewrite = !!rawTab && !VALID_TABS.has(rawTab as AppTab);

  /** Only a real line id selects a case; slugs like "black-cat" are deep links to resolve. */
  const caseId = caseParam && isTxnId(caseParam) ? caseParam.toUpperCase() : null;
  const caseSlug = caseParam && !isTxnId(caseParam) ? caseParam : searchParams.get("vendor");
  const fundFilter = searchParams.get("fund");
  const packageId = searchParams.get("id");

  const reviewFilter = useMemo((): ReviewFilter => {
    const f = searchParams.get("filter") ?? "all";
    const mapped = LEGACY_FILTERS[f] ?? f;
    return VALID_FILTERS.has(mapped) ? (mapped as ReviewFilter) : "all";
  }, [searchParams]);

  const dataView = useMemo((): DataView => {
    const v = searchParams.get("view");
    if (v === "ledger" || v === "terms" || v === "upload") return v;
    return legacyView ?? "upload";
  }, [searchParams, legacyView]);

  const replaceParams = useCallback(
    (mutate: (p: URLSearchParams) => void, mode: "replace" | "push" = "replace") => {
      const p = new URLSearchParams(searchParams.toString());
      mutate(p);
      const q = p.toString();
      const href = q ? `${pathname}?${q}` : pathname;
      if (mode === "push") router.push(href, { scroll: false });
      else router.replace(href, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const setParams = useCallback(
    (update: AppParamsUpdate, mode: "replace" | "push" = "replace") => {
      replaceParams((p) => {
        for (const [key, value] of Object.entries(update)) {
          if (value === undefined) continue;
          if (value === null) p.delete(key);
          else p.set(key, value);
        }
      }, mode);
    },
    [replaceParams],
  );

  /** Switching views is navigation: it goes into history so Back works. */
  const setTab = useCallback(
    (next: AppTab) => {
      replaceParams((p) => {
        p.set("tab", next);
        if (next !== "review") {
          p.delete("case");
          p.delete("filter");
        }
        if (next !== "package") p.delete("id");
        if (next !== "data") p.delete("view");
        p.delete("vendor");
      }, "push");
    },
    [replaceParams],
  );

  const setCaseId = useCallback(
    (txnId: string | null) => {
      // Phones show a case full-screen over the list: opening one from the list is a history step, so the
      // browser's Back returns to the list. Moving between cases (J/K, desktop) replaces instead.
      const narrow = typeof window !== "undefined" && !window.matchMedia("(min-width: 1024px)").matches;
      const mode = narrow && txnId && !searchParams.get("case") ? "push" : "replace";
      replaceParams((p) => {
        p.set("tab", "review");
        if (txnId) p.set("case", txnId);
        else p.delete("case");
      }, mode);
    },
    [replaceParams, searchParams],
  );

  const setReviewFilter = useCallback(
    (filter: ReviewFilter, fund?: string | null) => {
      replaceParams((p) => {
        p.set("tab", "review");
        if (filter === "all") p.delete("filter");
        else p.set("filter", filter);
        if (fund !== undefined) {
          if (fund) p.set("fund", fund);
          else p.delete("fund");
        }
      });
    },
    [replaceParams],
  );

  const openPackage = useCallback(
    (key: string) => {
      replaceParams((p) => {
        p.set("tab", "package");
        p.set("id", key);
        p.delete("case");
        p.delete("filter");
      }, "push");
    },
    [replaceParams],
  );

  /** From a failing check: open that line in Review, remembering which package to return to. */
  const openCase = useCallback(
    (txnId: string, fromPackage?: string) => {
      replaceParams((p) => {
        p.set("tab", "review");
        p.set("case", txnId);
        p.delete("filter");
        if (fromPackage) p.set("id", fromPackage);
      }, "push");
    },
    [replaceParams],
  );

  const setDataView = useCallback(
    (view: DataView) => {
      replaceParams((p) => {
        p.set("tab", "data");
        if (view === "upload") p.delete("view");
        else p.set("view", view);
      });
    },
    [replaceParams],
  );

  return {
    tab,
    needsRewrite,
    legacyView,
    caseId,
    caseSlug,
    reviewFilter,
    fundFilter,
    packageId,
    dataView,
    setTab,
    setCaseId,
    setReviewFilter,
    openPackage,
    openCase,
    setDataView,
    setParams,
  };
}
export type AppUrl = ReturnType<typeof useAppUrlState>;
