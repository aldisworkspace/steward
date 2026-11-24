"use client";

import type { GrantTerms } from "@/lib/types";
import type { AppUrl } from "../../hooks/useAppUrlState";

/** Placeholder until the Data view lands. */
export function DataView(_props: { url: AppUrl; grantTerms: GrantTerms[]; onError: (m: string | null) => void }) {
  return <p className="py-16 text-center text-base text-ink-2">Data is being rebuilt.</p>;
}
