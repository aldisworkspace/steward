import type { ReactNode } from "react";

export type Tone = "neutral" | "green" | "amber" | "red" | "ink";

const TONES: Record<Tone, { wrap: string; dot: string }> = {
  neutral: { wrap: "bg-paper-2 text-ink-2", dot: "bg-ink-3" },
  green: { wrap: "bg-green-tint text-green-ink", dot: "bg-green" },
  amber: { wrap: "bg-amber-tint text-amber-ink", dot: "bg-amber" },
  red: { wrap: "bg-redpen-tint text-redpen-ink", dot: "bg-redpen" },
  ink: { wrap: "bg-ink text-sheet", dot: "bg-sheet" },
};

/** A state word in a pill. Colour is the state, the word says it too (never colour alone). */
export function Badge({
  tone = "neutral",
  children,
  dot = true,
  className = "",
}: {
  tone?: Tone;
  children: ReactNode;
  dot?: boolean;
  className?: string;
}) {
  const t = TONES[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 py-0.5 text-xs font-medium ${t.wrap} ${className}`}
    >
      {dot && <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-pill ${t.dot}`} />}
      {children}
    </span>
  );
}
