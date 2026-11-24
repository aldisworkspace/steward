"use client";

/**
 * The closure moment: a rubber stamp lands on a signed package (or a decided case).
 * Ink texture comes from a small displacement filter; animates once, never on reduced motion.
 */
export function RubberStamp({
  label = "SIGNED",
  by,
  dateLabel,
  animate,
  tone = "green",
  className = "",
}: {
  label?: string;
  by: string;
  dateLabel: string;
  animate: boolean;
  tone?: "green" | "red";
  className?: string;
}) {
  const color = tone === "green" ? "var(--green-ink)" : "var(--redpen-ink)";
  const id = `stamp-ink-${tone}`;
  return (
    <div
      className={`pointer-events-none select-none ${animate ? "stamp-animate" : ""} ${className}`}
      style={animate ? undefined : { opacity: 0.88, transform: "rotate(-7deg)" }}
      role="img"
      aria-label={`${label} by ${by}, ${dateLabel}`}
    >
      <svg width="0" height="0" className="absolute" aria-hidden>
        <filter id={id}>
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="1.6" />
        </filter>
      </svg>
      <div
        className="rounded-[4px] border-[2.5px] px-4 pb-1.5 pt-2 text-center"
        style={{ color, borderColor: color, filter: `url(#${id})`, boxShadow: `inset 0 0 0 2px var(--sheet), inset 0 0 0 3px ${color}` }}
      >
        <div className="text-[20px] font-bold leading-none tracking-[0.22em]">{label}</div>
        <div className="mt-1 whitespace-nowrap text-2xs font-semibold uppercase tracking-[0.08em]">
          {by} · {dateLabel}
        </div>
      </div>
    </div>
  );
}
