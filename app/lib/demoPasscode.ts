const STORAGE_KEY = "steward_demo_key";

export function initDemoPasscodeFromUrl() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const key = url.searchParams.get("key");
  if (!key) return;
  localStorage.setItem(STORAGE_KEY, key);
  // Don't leave the key in the address bar, history, bookmarks or screenshots.
  url.searchParams.delete("key");
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
}

export function getDemoPasscode(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return localStorage.getItem(STORAGE_KEY) ?? undefined;
}

export function hasDemoWriteAccess(requiresPasscode: boolean): boolean {
  if (!requiresPasscode) return true;
  return !!getDemoPasscode();
}
