"use client";

import { ConvexProvider } from "convex/react";
import { useState, type ReactNode } from "react";
import { convexReactClient } from "@/lib/convexReactClient";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => convexReactClient());
  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
