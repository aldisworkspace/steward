"use client";

/**
 * The red-pen signature: a hand-drawn stroke through the wrong coding.
 * Drawn as a background on an inline span with box-decoration-break: clone, so every wrapped
 * line gets its own stroke. Draws once (left to right); static under reduced motion.
 */
const STROKE =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 10" preserveAspectRatio="none"><path d="M1 6 C 14 3, 32 8, 52 5 S 84 7, 99 5" fill="none" stroke="#E0433A" stroke-width="2.2" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`,
  );

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
    <span className={`text-ink-2 ${className}`}>
      <span className="sr-only">Struck out: </span>
      <span
        className={animate ? "redpen-strike-draw" : undefined}
        style={{
          backgroundImage: `url("${STROKE}")`,
          backgroundRepeat: "no-repeat",
          backgroundPosition: "0 60%",
          backgroundSize: "100% 0.55em",
          WebkitBoxDecorationBreak: "clone",
          boxDecorationBreak: "clone",
        }}
      >
        {text}
      </span>
    </span>
  );
}
