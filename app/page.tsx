import type { Metadata } from "next";
import { LandingPage } from "./components/landing/LandingPage";

export const metadata: Metadata = {
  title: "Steward — pre-submission review for grant invoices",
  description:
    "Steward checks every GL line against the contract, matches receipts, and ties the expenditure report to the penny. Your senior accountant reviews only the exceptions and signs.",
  openGraph: {
    title: "Steward — grant invoices that don't come back",
    description:
      "Pre-submission review for nonprofit finance teams. Synthetic demo data · Built at Cal Hacks 13.0",
  },
};

export default function Home() {
  return <LandingPage />;
}
