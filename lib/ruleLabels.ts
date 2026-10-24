/** Plain-language rule labels for UI (ids kept in title tooltips). */
export function ruleLabel(ruleId: string): string {
  const exact: Record<string, string> = {
    "R-PERIOD": "Outside grant period",
    "R-PRIOR-APPROVAL": "Needs funder approval",
    "R-DUPLICATE": "Possible duplicate",
    "R-EFFORT": "Pay exceeds time records",
    "R-LINE-OVERRUN": "Over budget line",
    "R-DEPOSIT-MISMATCH": "Ledger ≠ bank",
    "R-GL-DISAGREE": "Bookkeeper disagrees",
    "R-GL-ORPHAN": "No matching bank line",
  };
  if (exact[ruleId]) return exact[ruleId];
  if (ruleId.startsWith("R-UNALLOWABLE-ALCOHOL")) return "Alcohol or staff event";
  if (ruleId.startsWith("R-UNALLOWABLE-FINES")) return "Fine or penalty";
  if (ruleId.startsWith("R-UNALLOWABLE-FUNDRAISING")) return "Fundraising cost";
  if (ruleId.startsWith("R-UNALLOWABLE-LOBBYING")) return "Lobbying";
  if (ruleId.startsWith("R-UNALLOWABLE-")) return "Unallowable cost";
  return "Steward's judgment";
}

export function tickForSource(source: string): string {
  switch (source) {
    case "bank":
      return "Ⓑ";
    case "gl":
      return "Ⓛ";
    case "contract":
      return "Ⓒ";
    case "time_record":
      return "Ⓣ";
    case "precedent":
      return "Ⓟ";
    default:
      return "Ⓑ";
  }
}
