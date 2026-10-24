"use client";

import { Suspense } from "react";
import { StewardApp } from "./components/StewardApp";
import { Providers } from "./providers";

export default function Home() {
  return (
    <Providers>
      <Suspense
        fallback={
          <div className="flex min-h-screen items-center justify-center bg-paper text-[15px] text-ink-2">
            Loading…
          </div>
        }
      >
        <StewardApp />
      </Suspense>
    </Providers>
  );
}
