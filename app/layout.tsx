import type { Metadata } from "next";
import { Geist, Newsreader } from "next/font/google";
import "./globals.css";

// App UI: Geist (shared with the landing) for interface and tabular money.
const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  display: "swap",
});

// Display moments and verbatim contract quotes; italic carries the accent word.
const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Steward — pre-submission review for grant invoices",
  description:
    "Steward checks every GL line against the grant contract, matches receipts, and ties the invoice package to the cent. A human reviewer signs.",
  openGraph: {
    title: "Steward — pre-submission review for grant invoices",
    description:
      "Pre-submission review for nonprofit grant invoices. Synthetic demo · Real Claude · Built at Cal Hacks 13.0",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geist.variable} ${newsreader.variable} h-full`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
