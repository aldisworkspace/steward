"use client";

import { useSyncExternalStore } from "react";

let nowSnapshot = 0;
const listeners = new Set<() => void>();
let ticker: ReturnType<typeof setInterval> | null = null;

function startTicker(tickMs: number) {
  if (ticker != null) return;
  nowSnapshot = Date.now();
  ticker = setInterval(() => {
    nowSnapshot = Date.now();
    listeners.forEach((l) => l());
  }, tickMs);
}

/** Stable "now" for date math; refreshes every minute (SSR snapshot is 0). */
export function useNowMs(tickMs = 60_000): number {
  return useSyncExternalStore(
    (onStoreChange) => {
      startTicker(tickMs);
      listeners.add(onStoreChange);
      return () => listeners.delete(onStoreChange);
    },
    () => nowSnapshot,
    () => 0,
  );
}
