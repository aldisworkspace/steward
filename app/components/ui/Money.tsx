/** Money always renders from integer cents, in tabular figures. */
export function fmtUsd(cents: number, opts: { sign?: "auto" | "never" | "parens" } = {}) {
  const sign = opts.sign ?? "auto";
  const s = (Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (cents < 0 && sign === "parens") return `($${s})`;
  if (cents < 0 && sign === "auto") return `−$${s}`;
  return `$${s}`;
}

export function Money({
  cents,
  sign = "auto",
  className = "",
  focal = false,
}: {
  cents: number;
  sign?: "auto" | "never" | "parens";
  className?: string;
  /** The single focal number on a screen: cents set smaller so the dollars read first. */
  focal?: boolean;
}) {
  const text = fmtUsd(cents, { sign });
  if (!focal) return <span className={`tabular ${className}`}>{text}</span>;
  const dot = text.lastIndexOf(".");
  return (
    <span className={`tabular ${className}`} aria-label={text}>
      <span aria-hidden>{text.slice(0, dot)}</span>
      <span aria-hidden className="text-[0.55em] align-[0.62em] text-ink-2">
        {text.slice(dot)}
      </span>
    </span>
  );
}
