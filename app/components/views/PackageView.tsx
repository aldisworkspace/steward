"use client";

import type { GrantTerms } from "@/lib/types";
import type { AppUrl } from "../../hooks/useAppUrlState";

/** Placeholder until the package detail view lands. */
export function PackageView(_props: { url: AppUrl; grantTerms: GrantTerms[] }) {
  return <p className="py-16 text-center text-base text-ink-2">Package detail is being rebuilt.</p>;
}
