/** Goal-gradient bar: thin, ink until complete, green when every step passes. */
export function ProgressBar({
  value,
  max,
  label,
  className = "",
}: {
  value: number;
  max: number;
  label: string;
  className?: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const done = max > 0 && value >= max;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={`h-1 w-full overflow-hidden rounded-pill bg-paper-2 ${className}`}
    >
      <div
        className={`h-full rounded-pill transition-[width] duration-300 ease-out ${done ? "bg-green" : "bg-ink"}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
