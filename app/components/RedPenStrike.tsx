"use client";

export function RedPenStrike({
  text,
  className = "",
  animate = true,
}: {
  text: string;
  className?: string;
  animate?: boolean;
}) {
  return (
    <span className={`relative inline-block text-ink-2 ${className}`}>
      <span>{text}</span>
      <svg
        className="pointer-events-none absolute left-0 top-[55%] h-[0.45em] w-full overflow-visible"
        aria-hidden
      >
        <path
          d="M2 6 C 20 2, 40 10, 60 4 S 100 8, 140 5 S 200 3, 260 6"
          fill="none"
          stroke="var(--redpen)"
          strokeWidth="2"
          strokeLinecap="round"
          className={animate ? "redpen-strike-animate" : undefined}
          pathLength={120}
        />
      </svg>
    </span>
  );
}
