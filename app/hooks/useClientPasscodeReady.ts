"use client";

import { useSyncExternalStore } from "react";
import { initDemoPasscodeFromUrl } from "../lib/demoPasscode";

let initialized = false;

function getSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  if (!initialized) {
    initDemoPasscodeFromUrl();
    initialized = true;
  }
  return true;
}

function getServerSnapshot(): boolean {
  return false;
}

function subscribe(): () => void {
  return () => {};
}

export function useClientPasscodeReady(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
