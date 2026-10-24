const STORAGE_KEY = "steward_demo_key";

export function initDemoPasscodeFromUrl() {
  if (typeof window === "undefined") return;
  const key = new URLSearchParams(window.location.search).get("key");
  if (key) localStorage.setItem(STORAGE_KEY, key);
}

export function getDemoPasscode(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return localStorage.getItem(STORAGE_KEY) ?? undefined;
}

export function hasDemoWriteAccess(requiresPasscode: boolean): boolean {
  if (!requiresPasscode) return true;
  return !!getDemoPasscode();
}
