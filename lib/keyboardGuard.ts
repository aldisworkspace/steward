export function shouldIgnoreAppShortcut(
  e: KeyboardEvent,
  opts: {
    cmdOpen?: boolean;
    panelOpen?: boolean;
    helpOpen?: boolean;
    popoverOpen?: boolean;
  },
): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return true;
  const t = e.target as HTMLElement | null;
  if (t?.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]')) return true;
  if (opts.cmdOpen || opts.panelOpen || opts.helpOpen || opts.popoverOpen) return true;
  return false;
}
