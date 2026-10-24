"use client";

import { useConvex } from "convex/react";
import { useEffect, useState } from "react";

export function useConvexConnection(delayMs = 2000) {
  const convex = useConvex();
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = convex.subscribeToConnectionState(({ isWebSocketConnected }) => {
      if (isWebSocketConnected) {
        if (timer) clearTimeout(timer);
        timer = null;
        setOffline(false);
      } else {
        if (!timer) {
          timer = setTimeout(() => setOffline(true), delayMs);
        }
      }
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, [convex, delayMs]);

  return offline;
}
