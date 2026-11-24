import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from "react";

/** Ledger table: hairline rows, label left, money right in tabular figures. Scrolls inside itself on narrow screens. */
export function Table({
  children,
  caption,
  className = "",
  minWidth,
}: {
  children: ReactNode;
  caption?: string;
  className?: string;
  /** Below this width the table scrolls horizontally inside its own frame, never the page. */
  minWidth?: number;
}) {
  return (
    <div className={`w-full overflow-x-auto ${className}`}>
      <table className="w-full border-collapse text-sm" style={minWidth ? { minWidth } : undefined}>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}

export function Th({
  children,
  align = "left",
  className = "",
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right" }) {
  return (
    <th
      scope="col"
      className={`border-b border-rule px-3 py-2 text-xs font-medium text-ink-2 first:pl-0 last:pr-0 ${align === "right" ? "text-right" : "text-left"} ${className}`}
      {...rest}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = "left",
  money = false,
  className = "",
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right"; money?: boolean }) {
  const right = align === "right" || money;
  return (
    <td
      className={`border-b border-rule px-3 py-2.5 align-top first:pl-0 last:pr-0 ${right ? "text-right" : ""} ${money ? "tabular whitespace-nowrap" : ""} ${className}`}
      {...rest}
    >
      {children}
    </td>
  );
}
