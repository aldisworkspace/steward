import type { CSSProperties, ReactNode } from "react";

/**
 * Red-pen strike: the landing's one signature mark for "caught".
 * `draw` animates the stroke once on load (after `delay` ms); reduced motion shows it drawn.
 */
export function Strike({
  children,
  draw = false,
  delay = 0,
  label,
}: {
  children: ReactNode;
  draw?: boolean;
  delay?: number;
  /** Screen-reader text, e.g. "struck:" — the stroke itself is decorative. */
  label?: string;
}) {
  const style = draw ? ({ "--ld-strike-delay": `${delay}ms` } as CSSProperties) : undefined;
  return (
    <span className={`ld-strike${draw ? " ld-strike--draw" : ""}`} style={style}>
      {label ? <span className="ld-sr">{label} </span> : null}
      {children}
      <svg className="ld-strike__pen" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden>
        <path d="M1 6.2 C 14 3.4, 32 8.4, 52 5.2 S 84 6.8, 99 4.6" />
      </svg>
    </span>
  );
}
