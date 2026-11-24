import { Geist, Newsreader } from "next/font/google";

// Landing-only faces. Geist (variable) carries UI and the light display sizes;
// Newsreader italic is loaded here because the root layout only loads its upright styles.
export const landingSans = Geist({
  variable: "--font-ld-sans",
  subsets: ["latin"],
  display: "swap",
});

export const landingSerif = Newsreader({
  variable: "--font-ld-serif",
  subsets: ["latin"],
  style: ["italic"],
  display: "swap",
});
