"use client";

import { useEffect, useRef, useState } from "react";

export function RedPenStrike({
  text,
  className = "",
  animate = true,
}: {
  text: string;
  className?: string;
  animate?: boolean;
}) {
  const textRef = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);

  const w = Math.max(width, 1);

  return (
    <span className={`relative inline-block text-ink-2 ${className}`}>
      <span ref={textRef}>{text}</span>
      {w > 0 && (
        <svg
          className="pointer-events-none absolute left-0 top-[55%] overflow-visible"
          width={w}
          height={8}
          viewBox={`0 0 ${w} 8`}
          aria-hidden
        >
          <path
            d={`M1 5 C ${w * 0.15} 2, ${w * 0.35} 7, ${w * 0.55} 4 S ${w * 0.85} 6, ${w - 1} 5`}
            fill="none"
            stroke="var(--redpen)"
            strokeWidth="2"
            strokeLinecap="round"
            className={animate ? "redpen-strike-animate" : undefined}
            pathLength={120}
          />
        </svg>
      )}
    </span>
  );
}
