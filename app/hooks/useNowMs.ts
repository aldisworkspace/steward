"use client";

import { useSyncExternalStore } from "react";

/** Stable "now" for date math; refreshes every minute (SSR snapshot is 0). */
export function useNowMs(tickMs = 60_000): number {
  return useSyncExternalStore(
    (onStoreChange) => {
      const id = setInterval(onStoreChange, tickMs);
      return () => clearInterval(id);
    },
    () => Date.now(),
    () => 0,
  );
}
