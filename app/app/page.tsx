"use client";

import { Suspense } from "react";
import { StewardApp } from "../components/StewardApp";
import { AppLoadingShell } from "../components/AppLoadingShell";

export default function AppPage() {
  return (
    <Suspense fallback={<AppLoadingShell />}>
      <StewardApp />
    </Suspense>
  );
}
