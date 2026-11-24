import type { HTMLAttributes, ReactNode } from "react";

/** The working sheet: white paper on the bone ground. Never nest one sheet in another. */
export function Card({
  as: Tag = "section",
  className = "",
  children,
  ...rest
}: HTMLAttributes<HTMLElement> & { as?: "section" | "article" | "div" | "aside"; children: ReactNode }) {
  return (
    <Tag className={`rounded-md border border-rule bg-sheet shadow-sheet ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

/** Newsreader section title with an optional italic accent: <SectionTitle accent="this month">Tie-out</SectionTitle>. */
export function SectionTitle({
  children,
  accent,
  as: Tag = "h2",
  className = "",
  id,
}: {
  children: ReactNode;
  accent?: ReactNode;
  as?: "h1" | "h2" | "h3";
  className?: string;
  id?: string;
}) {
  return (
    <Tag id={id} className={`font-serif text-lg font-normal tracking-[-0.01em] text-ink text-balance ${className}`}>
      {children}
      {accent ? (
        <>
          {" "}
          <em className="italic text-ink-2">{accent}</em>
        </>
      ) : null}
    </Tag>
  );
}
