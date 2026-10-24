"use client";

export function RubberStamp({
  kind,
  by,
  dateLabel,
  animate,
}: {
  kind: "approved" | "returned";
  by: string;
  dateLabel: string;
  animate: boolean;
}) {
  const isApproved = kind === "approved";
  const line1 = isApproved ? "APPROVED" : "RETURNED";
  const color = isApproved ? "var(--money)" : "var(--redpen)";
  const id = "stamp-noise";
  return (
    <div
      className={`pointer-events-none absolute right-4 top-8 z-10 ${animate ? "stamp-animate" : ""}`}
      style={{ opacity: animate ? undefined : 0.7 }}
      aria-hidden
    >
      <svg width="0" height="0" aria-hidden>
        <filter id={id}>
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="1.2" />
        </filter>
      </svg>
      <div
        className="font-display border-2 px-4 py-2 text-center text-[15px] font-bold leading-tight"
        style={{
          color,
          borderColor: color,
          transform: "rotate(-6deg)",
          filter: `url(#${id})`,
        }}
      >
        {line1}
        <div className="text-[11px] font-semibold opacity-90">
          {by} · {dateLabel}
        </div>
      </div>
    </div>
  );
}
