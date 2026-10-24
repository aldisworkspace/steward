/** "AMAZON MKTPLACE PMTS REFUND" / "STAPLES 00114" → "AMAZON MKTPLACE" / "STAPLES" */
export function vendorKey(d: string) {
  return d
    .toUpperCase()
    .replace(/[^A-Z ]+/g, " ")
    .replace(/\b(REFUND|PMTS?|INC|LLC|LP|WHSE|DEBIT|ACH)\b/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .join(" ");
}
