"use client";

import { useSearchParams } from "next/navigation";

export function useAdminMode(): boolean {
  const params = useSearchParams();
  return params.get("admin") === "1";
}
