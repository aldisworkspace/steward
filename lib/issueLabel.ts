/**
 * One plain-language label for an inbox item, shared by the queue row, case file and dashboard.
 * Takes the decision status as well as the rule so a blocked item can never read "Needs your review"
 * and a needs_review item can never read "Not allowed".
 */
export function issueLabel(ruleId: string | null | undefined, status: string): string {
  const blocked = status === "blocked";
  switch (ruleId) {
    case "R-UNALLOWABLE-FUNDRAISING":
      return blocked ? "Fundraising cost — not allowed" : "Possible fundraising cost";
    case "R-UNALLOWABLE-FINES":
      return blocked ? "Fine or penalty — not allowed" : "Possible fine or penalty";
    case "R-UNALLOWABLE-ALCOHOL_STAFF":
      return blocked ? "Alcohol — not allowed" : "Possible alcohol charge";
    case "R-UNALLOWABLE-STAFF_EVENT":
      return blocked ? "Staff event or meal — not allowed" : "Possible staff event or meal";
    case "R-UNALLOWABLE-LOBBYING":
      return blocked ? "Lobbying — not allowed" : "Possible lobbying cost";
    case "R-PERIOD":
      return "Outside the grant period";
    case "R-PRIOR-APPROVAL":
      return blocked ? "No funder approval — can't bill yet" : "Needs funder approval";
    case "R-LINE-OVERRUN":
      return blocked ? "Over budget line — can't bill the excess" : "Over budget line";
    case "R-INDIRECT-RATE":
      return blocked ? "Indirect over the contract rate" : "Indirect doesn't match the rate";
    case "R-EFFORT":
      return "Pay exceeds time sheet";
    case "R-DUPLICATE":
      return "Possible duplicate payment";
    case "R-DEPOSIT-MISMATCH":
      return "Books ≠ bank";
    case "R-GL-DISAGREE":
      return "Bookkeeper coded it differently";
    case "R-GL-ORPHAN":
      return "No matching bank line";
    case "R-NEEDS-DOCS":
      return "Needs documentation";
    case "R-BANK-UNRECORDED":
      return "Bank payment not in the books";
    case "R-GL-NO-BANK":
      return "No matching bank payment";
    case "R-AMOUNT-MISMATCH":
      return "Books ≠ bank amount";
    case "R-RECEIPT-MISSING":
      return "Missing receipt";
    case "R-RECEIPT-MISMATCH":
      return "Receipt doesn't match";
    case "R-RECEIPT-AMBIGUOUS":
      return "Receipt could match several lines";
    case "R-PURPOSE-UNCLEAR":
      return "Which program was this for?";
    default:
      if (ruleId?.startsWith("R-UNALLOWABLE")) {
        return blocked ? "Not allowed by the grant" : "Check against grant terms";
      }
      return blocked ? "Not allowed by the grant" : "Needs your review";
  }
}

export function queueStatusWord(status: string): string {
  if (status === "blocked") return "Not allowed";
  if (status === "auto") return "Clean";
  return "Needs you";
}
