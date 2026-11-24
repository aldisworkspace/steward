"use client";

import { createContext, useContext } from "react";

export type Person = { name: string; roles: ("preparer" | "reviewer" | "program_approver")[] };

export type AppCtx = {
  /** The person the viewer is acting as (name-based roles until real auth). */
  actor: string;
  people: Person[];
  isPreparer: boolean;
  isReviewer: boolean;
  isProgramApprover: boolean;
  /** Who may resolve exceptions and link receipts (the approver guard on the backend). */
  canResolve: boolean;
  canWrite: boolean;
  passcode: string | undefined;
  toast: (message: string, undo?: () => void) => void;
  fail: (message: string) => void;
};

export const AppContext = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp outside AppContext");
  return ctx;
}

export const ROLE_WORD: Record<Person["roles"][number], string> = {
  preparer: "Preparer",
  reviewer: "Reviewer",
  program_approver: "Program approver",
};

/** "A. Okafor (Executive Director)" → "A. Okafor". */
export function shortName(name: string) {
  return name.replace(/\s*\(.*\)\s*$/, "");
}
