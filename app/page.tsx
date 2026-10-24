"use client";

import { StewardApp } from "./components/StewardApp";
import { Providers } from "./providers";

export default function Home() {
  return (
    <Providers>
      <StewardApp />
    </Providers>
  );
}
