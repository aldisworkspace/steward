export type LandingTheme = "ink" | "leaf";

export function Clerk({ className = "" }: { className?: string }) {
  return (
    <svg width="14" height="16" viewBox="0 0 14 16" aria-hidden className={`inline-block shrink-0 ${className}`}>
      <circle cx="7" cy="3" r="1.7" fill="currentColor" />
      <path d="M3.2 14.2c.5-3 2.1-4.4 3.8-4.4s3.3 1.4 3.8 4.4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M8.6 8.2 12 9.4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function Corners() {
  const arm = "absolute h-2 w-2 border-ink";
  return (
    <span aria-hidden className="pointer-events-none absolute inset-2">
      <span className={`${arm} left-0 top-0 border-l border-t`} />
      <span className={`${arm} right-0 top-0 border-r border-t`} />
      <span className={`${arm} bottom-0 left-0 border-b border-l`} />
      <span className={`${arm} bottom-0 right-0 border-r border-b`} />
    </span>
  );
}

export function ThemeSwitch({ theme, onChange }: { theme: LandingTheme; onChange: (theme: LandingTheme) => void }) {
  const modes: { id: LandingTheme; label: string }[] = [
    { id: "ink", label: "Black and white" },
    { id: "leaf", label: "White and green" },
  ];
  return (
    <div role="group" aria-label="Color mode" className="flex rounded-[6px] border border-rule p-0.5">
      {modes.map((mode) => (
        <button
          key={mode.id}
          type="button"
          aria-pressed={theme === mode.id}
          aria-label={mode.label}
          className={`landing-control inline-flex min-h-11 min-w-11 items-center justify-center rounded-[4px] ${
            theme === mode.id ? "landing-mode-on" : ""
          }`}
          onClick={() => onChange(mode.id)}
        >
          <span
            aria-hidden
            className={`block h-3.5 w-3.5 rounded-[2px] border ${
              mode.id === "ink" ? "border-[#d4d4d4] bg-black" : "border-[#067647] bg-[#067647]"
            }`}
          />
        </button>
      ))}
    </div>
  );
}
