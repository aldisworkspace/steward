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
  title: "Steward — the grants accountant that reads the contract",
  description:
    "Steward checks bank transactions against grant agreements, catches clawback risk, and proposes corrections for human approval.",
  openGraph: {
    title: "Steward — the grants accountant that reads the contract",
    description:
      "Autonomous grants accountant for small nonprofits. Synthetic demo · Real Claude · Cal Hacks 13.0",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geist.variable} ${newsreader.variable} h-full`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
