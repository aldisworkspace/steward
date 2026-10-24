import type { Metadata } from "next";
import { Bricolage_Grotesque, Newsreader, Public_Sans } from "next/font/google";
import "./globals.css";

const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  weight: ["600", "700"],
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
    <html lang="en" className={`${publicSans.variable} ${newsreader.variable} ${bricolage.variable} h-full`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
