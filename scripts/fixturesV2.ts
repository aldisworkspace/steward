/**
 * Hand-transcribed terms of the SYNTHETIC v2 agreements (steward-data-v2/*.pdf) for offline tests.
 * In the app these come from extractGrantTerms on the PDFs.
 */
import type { GrantTerms } from "../lib/types";

export const FIXTURE_GRANTS_V2: GrantTerms[] = [
  {
    grantId: "FS-27-0412", funder: "City of Port Calloway Department of Family Services", program: "Familias Adelante Family Support Program",
    periodStart: "2026-07-01", periodEnd: "2027-06-30", totalAward: 240000,
    budgetLines: [
      { code: "C1", name: "Personnel", amount: 133000 }, { code: "C2", name: "Fringe benefits", amount: 29260 },
      { code: "C3", name: "Program supplies", amount: 4800 }, { code: "C4", name: "Participant support", amount: 27240 },
      { code: "C5", name: "Local travel", amount: 2400 }, { code: "C6", name: "Rent / occupancy", amount: 30000 },
      { code: "C7", name: "Indirect", amount: 13300 },
    ],
    lineVarianceLimitPct: 10,
    unallowable: [
      { rule: "Alcoholic beverages of any kind", clauseRef: "FS-27-0412 §6.1" },
      { rule: "Entertainment, including staff appreciation events, parties, gifts to staff and staff meals", clauseRef: "FS-27-0412 §6.2" },
      { rule: "Fines, penalties, late fees and interest", clauseRef: "FS-27-0412 §6.3" },
      { rule: "Fundraising and donor cultivation costs", clauseRef: "FS-27-0412 §6.4" },
      { rule: "Lobbying or political activity", clauseRef: "FS-27-0412 §6.5" },
    ],
    priorApproval: [{ rule: "Equipment with unit cost of $5,000 or more", thresholdUsd: 5000, clauseRef: "FS-27-0412 §7.2" }],
    indirectCapPct: 10, reportDue: null, restrictedPurpose: "Familias Adelante Family Support Program",
    billing: { frequency: "monthly", invoiceDueDays: 30, costBasis: "reimbursement" },
    indirectBase: "salaries",
  },
  {
    grantId: "RF-26-118", funder: "Thistlewick Foundation", program: "Puentes Youth Mentoring Program",
    periodStart: "2026-06-01", periodEnd: "2027-05-31", totalAward: 50000,
    budgetLines: [
      { code: "F1", name: "Personnel & fringe", amount: 27000 }, { code: "F2", name: "Program materials", amount: 9000 },
      { code: "F3", name: "Family engagement events", amount: 8000 }, { code: "F4", name: "Evaluation", amount: 6000 },
    ],
    lineVarianceLimitPct: 15,
    unallowable: [
      { rule: "Alcoholic beverages", clauseRef: "RF-26-118 §4.3" },
      { rule: "Lobbying, political campaigns or attempts to influence legislation", clauseRef: "RF-26-118 §4.4" },
      { rule: "Fundraising events or donor cultivation", clauseRef: "RF-26-118 §4.5" },
    ],
    priorApproval: [{ rule: "Personnel charges above a position's approved percentage", thresholdUsd: null, clauseRef: "RF-26-118 §4.2" }],
    indirectCapPct: null, reportDue: null, restrictedPurpose: "Puentes Youth Mentoring Program",
    billing: { frequency: "quarterly", invoiceDueDays: 30, costBasis: "advance" },
    indirectBase: null,
  },
];
