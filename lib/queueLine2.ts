/** Queue line 2 text per POLISH_SPEC copy deck (rule id). */
export function queueLine2(ruleId: string | null | undefined): string {
  switch (ruleId) {
    case "R-UNALLOWABLE-FUNDRAISING":
      return "Fundraising cost";
    case "R-UNALLOWABLE-FINES":
      return "Fine or penalty";
    case "R-UNALLOWABLE-ALCOHOL_STAFF":
      return "Alcohol or staff event";
    case "R-UNALLOWABLE-LOBBYING":
      return "Lobbying";
    case "R-UNALLOWABLE-OTHER":
      return "Not allowed by the grant";
    case "R-PERIOD":
      return "Outside the grant period";
    case "R-PRIOR-APPROVAL":
      return "Needs funder approval";
    case "R-LINE-OVERRUN":
      return "Over budget line";
    case "R-EFFORT":
      return "Pay exceeds time sheet";
    case "R-DUPLICATE":
      return "Possible duplicate payment";
    case "R-DEPOSIT-MISMATCH":
      return "Books ≠ bank";
    case "R-GL-DISAGREE":
      return "Bookkeeper coded it differently";
    case "R-MODEL-REVIEW":
      return "Needs your review";
    default:
      return "Needs your review";
  }
}

export function queueStatusWord(status: string): string {
  if (status === "blocked") return "Not allowed";
  return "Needs you";
}
