"use client";

import Link from "next/link";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const BASE =
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-pill font-medium transition-[background-color,border-color,color,box-shadow] duration-150 ease-out disabled:cursor-not-allowed aria-disabled:cursor-not-allowed";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-ink text-sheet hover:bg-[#2c2920] active:bg-black disabled:bg-paper-2 disabled:text-ink-2 aria-disabled:bg-paper-2 aria-disabled:text-ink-2",
  secondary:
    "border border-rule-strong bg-sheet text-ink hover:border-ink-2 hover:bg-paper active:bg-paper-2 disabled:text-ink-2 disabled:hover:border-rule-strong disabled:hover:bg-sheet",
  ghost: "text-ink-2 hover:bg-paper-2 hover:text-ink active:bg-paper-2 disabled:opacity-50",
  danger:
    "border border-redpen-ink bg-sheet text-redpen-ink hover:bg-redpen-tint active:bg-redpen-tint disabled:opacity-50",
};

/** Tap targets stay at 44px on touch-sized screens; desktop gets the denser size. */
const SIZES: Record<ButtonSize, string> = {
  sm: "min-h-11 px-3 text-sm sm:min-h-8",
  md: "min-h-11 px-5 text-base sm:min-h-10",
};

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", extra = "") {
  return `${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${extra}`.trim();
}

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a quiet busy label and blocks double submits. */
  busy?: boolean;
  busyLabel?: string;
  icon?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "secondary", size = "md", busy, busyLabel, icon, className = "", children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={buttonClass(variant, size, className)}
      {...rest}
    >
      {icon}
      {busy ? (busyLabel ?? "Working…") : children}
    </button>
  );
});

export function ButtonLink({
  href,
  variant = "secondary",
  size = "md",
  className = "",
  children,
  download,
  external,
  onClick,
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
  download?: boolean;
  external?: boolean;
  onClick?: () => void;
}) {
  if (download || external) {
    return (
      <a href={href} download={download || undefined} className={buttonClass(variant, size, className)} onClick={onClick}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={buttonClass(variant, size, className)} onClick={onClick}>
      {children}
    </Link>
  );
}
