import Link from "next/link";
import { RedPenStrikeClient } from "./components/landing/RedPenStrikeClient";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-6">
      <div className="max-w-md rounded-[8px] border border-rule bg-sheet p-8 text-center">
        <p className="text-[17px] text-ink-2">
          <RedPenStrikeClient text="Page" />{" "}
          <span className="font-display text-[28px] font-semibold text-money">Not in the ledger.</span>
        </p>
        <p className="mt-3 text-[14px] text-ink-2">This page doesn&apos;t exist. The books still balance.</p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-[6px] bg-saffron px-4 py-2 text-[14px] font-semibold text-ink"
        >
          Back to Steward
        </Link>
      </div>
    </div>
  );
}
