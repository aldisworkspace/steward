"use client";

import { RedPenStrike } from "../RedPenStrike";

export function RedPenStrikeClient({ text }: { text: string }) {
  return <RedPenStrike text={text} animate />;
}
