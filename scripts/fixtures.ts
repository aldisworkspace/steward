/** Hand-transcribed grant terms for offline tests. The app extracts these from the PDFs. */
import type { GrantTerms } from "../lib/types";

export const FIXTURE_GRANTS: GrantTerms[] = [
  { grantId: "GA-2026-114", funder: "GGRWA", program: "Youth Pathways to Employment",
    periodStart: "2026-07-01", periodEnd: "2027-06-30", totalAward: 180000,
    budgetLines: [["A1", "Personnel", 110000], ["A2", "Fringe", 22000], ["A3", "Program supplies", 18000],
      ["A4", "Participant stipends", 20000], ["A5", "Local travel", 4000], ["A6", "Indirect", 6000]].map(([code, name, amount]) => ({ code: code as string, name: name as string, amount: amount as number })),
    lineVarianceLimitPct: null,
    unallowable: [
      { rule: "Alcoholic beverages", clauseRef: "GA-2026-114 §4.2; 2 CFR 200.423" },
      { rule: "Entertainment costs", clauseRef: "GA-2026-114 §4.3; 2 CFR 200.438" },
      { rule: "Fines, penalties, parking citations", clauseRef: "GA-2026-114 §4.4; 2 CFR 200.441" },
      { rule: "Fundraising costs incl. galas", clauseRef: "GA-2026-114 §4.5; 2 CFR 200.442" },
      { rule: "Lobbying", clauseRef: "GA-2026-114 §4.6; 2 CFR 200.450" },
      { rule: "Staff meals and staff appreciation events", clauseRef: "GA-2026-114 §4.7" },
    ],
    priorApproval: [{ rule: "Equipment item >= $5,000 per unit", thresholdUsd: 5000, clauseRef: "GA-2026-114 §5.1" }],
    indirectCapPct: 10, reportDue: "2026-10-30", restrictedPurpose: "Youth Pathways to Employment" },
  { grantId: "HLF-26-031", funder: "Harbor Light Foundation", program: "Summer Literacy Lab",
    periodStart: "2026-06-01", periodEnd: "2026-09-30", totalAward: 60000,
    budgetLines: [{ code: "B1", name: "Instructors", amount: 35000 }, { code: "B2", name: "Books and materials", amount: 15000 },
      { code: "B3", name: "Field trips", amount: 6000 }, { code: "B4", name: "Administration", amount: 4000 }],
    lineVarianceLimitPct: 15,
    unallowable: [{ rule: "Capital expenditures, endowment, debt service, political activity, fundraising events", clauseRef: "HLF-26-031 §3.1" }],
    priorApproval: [], indirectCapPct: null, reportDue: "2026-10-31", restrictedPurpose: "Summer Literacy Lab" },
];

