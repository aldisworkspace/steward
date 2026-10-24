export function fundFilterParam(grantId: string | null): string | null {
  if (grantId === null) return "general";
  return grantId;
}

export function matchesFundFilter(grantId: string | null, fund: string | null | undefined): boolean {
  if (!fund) return true;
  if (fund === "general") return grantId === null;
  return grantId === fund;
}
