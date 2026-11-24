"use client";

import type { GrantTerms } from "@/lib/types";
import type { AppUrl } from "../../hooks/useAppUrlState";

/** Placeholder until the exceptions-only Review view lands. */
export function ReviewView(_props: {
  url: AppUrl;
  grantTerms: GrantTerms[];
  cmdOpen: boolean;
  helpOpen: boolean;
  panelOpen: boolean;
  onWhy: (txnId: string) => void;
  onHelp: () => void;
}) {
  return <p className="py-16 text-center text-base text-ink-2">Review is being rebuilt.</p>;
}
