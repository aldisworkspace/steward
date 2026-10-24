/** Grant terms matching steward-holdout PDFs (for offline judge-scenario checks). */
import type { GrantTerms } from "../lib/types";

export const HOLDOUT_GRANTS: GrantTerms[] = [
  {
    grantId: "PCAC-26-0412",
    funder: "Pacific Coast Arts Council",
    program: "Corridor Arts Season 2026-27",
    periodStart: "2026-08-01",
    periodEnd: "2027-07-31",
    totalAward: 90000,
    budgetLines: [
      { code: "C-1", name: "Artist fees", amount: 40000 },
      { code: "C-2", name: "Materials and supplies", amount: 12000 },
      { code: "C-3", name: "Venue rental", amount: 15000 },
      { code: "C-4", name: "Marketing and outreach", amount: 8000 },
      { code: "C-5", name: "Administration", amount: 5000 },
    ],
    lineVarianceLimitPct: 10,
    unallowable: [
      { rule: "Alcohol, food or hospitality at receptions or donor events", clauseRef: "PCAC-26-0412 III.a" },
      { rule: "Entertainment or social activities for staff, board or volunteers", clauseRef: "PCAC-26-0412 III.b" },
      { rule: "Influence legislation or appropriations including advocacy to state legislators", clauseRef: "PCAC-26-0412 III.c" },
      { rule: "Travel outside the State of California", clauseRef: "PCAC-26-0412 III.d" },
      { rule: "Fines, penalties and late fees", clauseRef: "PCAC-26-0412 III.e" },
    ],
    priorApproval: [{ rule: "Single vendor purchase over $10,000", thresholdUsd: 10000, clauseRef: "PCAC-26-0412 IV.1" }],
    indirectCapPct: null,
    reportDue: null,
    restrictedPurpose: "Corridor Arts Season public performances and exhibitions in the Bayview district",
  },
  {
    grantId: "FCF-2026-77",
    funder: "Fogline Community Fund",
    program: "Youth Mural Program",
    periodStart: "2026-07-15",
    periodEnd: "2026-12-31",
    totalAward: 40000,
    budgetLines: [
      { code: "D-1", name: "Lead muralist", amount: 20000 },
      { code: "D-2", name: "Paint and equipment", amount: 12000 },
      { code: "D-3", name: "Youth stipends", amount: 6000 },
      { code: "D-4", name: "Insurance and permits", amount: 2000 },
    ],
    lineVarianceLimitPct: 20,
    unallowable: [
      { rule: "Single equipment item over $2,500", clauseRef: "FCF-2026-77 §3.1" },
      { rule: "Entertainment costs", clauseRef: "FCF-2026-77 §3.2" },
    ],
    priorApproval: [],
    indirectCapPct: null,
    reportDue: null,
    restrictedPurpose: "Youth Mural Program for teens aged 14-18",
  },
];
