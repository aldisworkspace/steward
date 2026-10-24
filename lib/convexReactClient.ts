"use client";

import { ConvexReactClient } from "convex/react";

let singleton: ConvexReactClient | undefined;

export function convexReactClient(): ConvexReactClient {
  if (!singleton) {
    singleton = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  }
  return singleton;
}
