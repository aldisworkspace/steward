/**
 * GL detail parser: QuickBooks / Xero / Sage Intacct headers, debit/credit, parentheses negatives,
 * class → grant:line mapping, skipped lines, manual mapping. SYNTHETIC inline fixtures.
 *   npx tsx scripts/test-gl-detail.ts
 */
import assert from "node:assert/strict";
import { accountKind, detectGlFormat, parseClass, parseGlDetail, suggestGlMapping } from "../lib/parseGlDetail";

let failures = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`ok   ${name}`); } catch (e) { failures++; console.log(`FAIL ${name}\n     ${(e as Error).message}`); }
}

const QB = `Valencia Youth Collective (SYNTHETIC)
Transaction Detail by Account
"July 1 - July 31, 2026"
Date,Transaction Type,Num,Name,Memo/Description,Account,Class,Location,Split,Amount
07/03/2026,Expense,1041,Office Depot,Printer paper for literacy lab,6100 Office Supplies,HLF-26-031:B2,Literacy,1000 Checking,"1,234.56"
07/03/2026,Check,1042,Office Depot,,6100 Office Supplies,GA-2026-114:A3,Youth Jobs,1000 Checking,84.10
07/05/2026,Journal Entry,JE-7,,Reverse duplicate,6100 Office Supplies,GA-2026-114:A3,Youth Jobs,-Split-,(84.10)
07/09/2026,Expense,1043,Comcast,Internet,6300 Utilities,General,Admin,1000 Checking,129.99
07/10/2026,Deposit,,City of Oakland,Drawdown,4100 Grant Revenue,,Admin,1000 Checking,"5,000.00"
07/10/2026,Deposit,,Harbor Light Foundation,Grant payment,4100 Grant Revenue,HLF-26-031:B4,Admin,1000 Checking,"2,000.00"
07/11/2026,Check,1044,Office Depot,,1000 Checking,,Admin,6100 Office Supplies,-84.10
07/12/2026,Bill,B-88,Dell,Laptop for program,1500 Equipment,GA-2026-114:A3,Youth Jobs,2000 Accounts Payable,"5,400.00"
07/14/2026,Expense,1045,Staples,Zero test,6100 Office Supplies,General,Admin,1000 Checking,0.00
Total for 6100 Office Supplies,,,,,,,,,"1,234.56"
`;

check("QuickBooks: format, header after title rows, mapping", () => {
  const r = parseGlDetail(QB);
  assert.equal(r.error, null);
  assert.equal(r.format, "quickbooks");
  assert.equal(r.mapping.memo, "Memo/Description");
  assert.equal(r.mapping.vendor, "Name");
  assert.equal(r.mapping.docRef, "Num");
  assert.equal(r.mapping.grant, "Class");
  assert.equal(r.mapping.department, "Location");
  assert.equal(r.mapping.amount, "Amount");
});

check("QuickBooks: sign convention, parentheses, class mapping, kept/skipped", () => {
  const r = parseGlDetail(QB);
  const ids = r.lines.map((l) => `${l.txnId} ${l.vendor} ${l.amountCents} ${l.glClass}:${l.glBudgetLine}`);
  assert.equal(r.lines.length, 6, ids.join("\n"));
  const [paper, small, je, comcast, hlfRevenue, dell] = r.lines;
  assert.equal(paper!.txnId, "L0001");
  assert.equal(paper!.amountCents, -123456, "expense positive → outflow negative");
  assert.equal(paper!.glClass, "HLF-26-031");
  assert.equal(paper!.glBudgetLine, "B2");
  assert.equal(paper!.department, "Literacy");
  assert.equal(paper!.docRef, "1041");
  assert.equal(paper!.description, "Office Depot");
  assert.equal(paper!.memo, "Printer paper for literacy lab");
  assert.equal(small!.amountCents, -8410);
  assert.equal(je!.amountCents, 8410, "(84.10) on expense account = credit → positive");
  assert.equal(je!.txnType, "Journal Entry");
  assert.equal(comcast!.glClass, null, "General → unrestricted");
  assert.equal(hlfRevenue!.amountCents, 200000, "revenue with grant class kept as inflow");
  assert.equal(dell!.amountCents, -540000, "fixed asset with grant class kept as outflow");
  assert.equal(dell!.account, "1500 Equipment");
  // skipped: untagged revenue, cash account, zero amount, total row
  const reasons = r.skipped.map((s) => s.reason).join("|");
  assert.match(reasons, /revenue line without a grant class/);
  assert.match(reasons, /payment-side account/);
  assert.match(reasons, /zero amount/);
  assert.match(reasons, /total row/);
});

check("QuickBooks: glRows mirror lines with bankRef = line id", () => {
  const r = parseGlDetail(QB);
  assert.equal(r.glRows.length, r.lines.length);
  const g = r.glRows[0]!;
  assert.equal(g.bankRef, "L0001");
  assert.equal(g.class, "HLF-26-031");
  assert.equal(g.budgetLine, "B2");
  assert.equal(g.amountCents, r.lines[0]!.amountCents);
  assert.equal(g.enteredBy, "bookkeeper");
});

const XERO = `Date,Source,Description,Reference,Debit,Credit,Account,Tracking
2026-07-02,Spend Money,Office Depot - toner,INV-551,212.40,,429 - General Expenses,GA-2026-114 / A3
2026-07-03,Spend Money,Office Depot - credit memo,CM-12,,"(15.00)",429 - General Expenses,GA-2026-114 / A3
2026-07-04,Payable Invoice,Bay Area Discovery Museum,INV-77,"1,050.00",,493 - Travel - National,HLF-26-031 - B3
2026-07-05,Spend Money,Bank fee,,9.00,,404 - Bank Fees,
`;

check("Xero: debit/credit columns, tracking separators", () => {
  const r = parseGlDetail(XERO);
  assert.equal(r.error, null);
  assert.equal(r.format, "xero");
  assert.equal(r.mapping.debit, "Debit");
  assert.equal(r.mapping.credit, "Credit");
  assert.equal(r.mapping.amount, null);
  assert.equal(r.mapping.grant, "Tracking");
  assert.equal(r.mapping.docRef, "Reference");
  assert.equal(r.mapping.txnType, "Source");
  assert.equal(r.lines.length, 4);
  const [toner, cm, museum, fee] = r.lines;
  assert.equal(toner!.amountCents, -21240);
  assert.equal(toner!.glClass, "GA-2026-114");
  assert.equal(toner!.glBudgetLine, "A3");
  assert.equal(toner!.description, "Office Depot - toner", "no contact column → narrative is the description");
  // "(15.00)" in the credit column: parseFlexibleAmount → -1500; credit - debit = -1500.
  // A negative credit is a reversal of a credit, i.e. money out. Keep the arithmetic literal.
  assert.equal(cm!.amountCents, -1500);
  assert.equal(museum!.amountCents, -105000);
  assert.equal(museum!.glClass, "HLF-26-031");
  assert.equal(museum!.glBudgetLine, "B3");
  assert.equal(fee!.glClass, null);
});

const SAGE = `Posting date,Document,Description,Debit,Credit,Account,Department,Class/Grant,Vendor name,Budget line
07/15/2026,AP-1001,Bus charter for field trip,"2,400.00",0.00,6500 Field Trips,Literacy,HLF-26-031,Golden Gate Charter,B3
07/16/2026,AP-1002,Refund from vendor,0.00,120.00,6100 Supplies,Youth Jobs,GA-2026-114,Lakeshore Learning,A3
07/16/2026,AP-1003,Rent July,"3,000.00",0.00,6200 Rent,Admin,Unrestricted,Mission St Properties,
`;

check("Sage Intacct: grant + separate budget line column, vendor name", () => {
  const r = parseGlDetail(SAGE);
  assert.equal(r.error, null);
  assert.equal(r.format, "sage");
  assert.equal(r.mapping.vendor, "Vendor name");
  assert.equal(r.mapping.grant, "Class/Grant");
  assert.equal(r.mapping.budgetLine, "Budget line");
  assert.equal(r.mapping.docRef, "Document");
  const [bus, refund, rent] = r.lines;
  assert.equal(bus!.amountCents, -240000);
  assert.equal(bus!.glClass, "HLF-26-031");
  assert.equal(bus!.glBudgetLine, "B3");
  assert.equal(bus!.description, "Golden Gate Charter");
  assert.equal(bus!.memo, "Bus charter for field trip");
  assert.equal(refund!.amountCents, 12000, "credit to expense = money back");
  assert.equal(rent!.glClass, null);
  assert.equal(rent!.glBudgetLine, null);
});

check("manual mapping override (generic file)", () => {
  const csv = `When,Who,What,Cost,Fund\n07/01/2026,Clipper,Youth transit,(40.00),GA-2026-114:A5\n`;
  assert.notEqual(parseGlDetail(csv).error, null, "no date column detected");
  const r = parseGlDetail(csv, { date: "When", vendor: "Who", memo: "What", amount: "Cost", grant: "Fund" });
  assert.equal(r.error, null);
  assert.equal(r.format, "generic");
  assert.equal(r.lines[0]!.amountCents, 4000, "(40.00) on expense account = credit");
  assert.equal(r.lines[0]!.glBudgetLine, "A5");
});

check("helpers: parseClass, accountKind, suggestGlMapping, detectGlFormat", () => {
  assert.deepEqual(parseClass("GA-2026-114:A3"), { grantId: "GA-2026-114", budgetLine: "A3" });
  assert.deepEqual(parseClass("General"), { grantId: null, budgetLine: null });
  assert.deepEqual(parseClass(""), { grantId: null, budgetLine: null });
  assert.deepEqual(parseClass("GA-2026-114", "A1"), { grantId: "GA-2026-114", budgetLine: "A1" });
  assert.deepEqual(parseClass("CITY-OAK-26:C1"), { grantId: "CITY-OAK-26", budgetLine: "C1" });
  assert.equal(accountKind("6100 Office Supplies"), "expense");
  assert.equal(accountKind("4100 Grant Revenue"), "revenue");
  assert.equal(accountKind("1000 Checking"), "cash");
  assert.equal(accountKind("2000 Accounts Payable"), "cash");
  assert.equal(accountKind("1500 Equipment"), "balance");
  assert.equal(accountKind("Program Supplies"), "expense");
  const m = suggestGlMapping(["Date", "Transaction Type", "Num", "Name", "Memo/Description", "Account", "Class", "Location", "Split", "Amount"]);
  assert.equal(m.vendor, "Name");
  assert.equal(m.split, "Split");
  assert.equal(detectGlFormat(["Date", "Source", "Description", "Reference", "Debit", "Credit", "Account", "Tracking"]), "xero");
});

check("bad date reports the row", () => {
  const r = parseGlDetail(`Date,Name,Account,Amount\n13/45/2026,X,6100 Supplies,1.00\n`);
  assert.match(r.error ?? "", /Row 2/);
});

check("one-cell title/footer rows are skipped, not a bad date (QuickBooks footer)", () => {
  const text = `${QB}\nSYNTHETIC — generated for testing. Accrual basis. Fictional data.\n"Monday, November 23, 2026 10:15 AM GMT-05:00"\n`;
  const r = parseGlDetail(text);
  assert.equal(r.error, null);
  assert.equal(r.lines.length, parseGlDetail(QB).lines.length);
  assert.ok(r.skipped.some((s) => s.reason === "title/footer row"));
});

check("account heading in the date column sets the section account", () => {
  const r = parseGlDetail(`Date,Transaction Type,Num,Name,Memo/Description,Account,Class,Amount\n6100 Office Supplies,,,,,,,\n07/03/2026,Expense,1,Staples,Paper,,GA-1:A1,10.00\n`);
  assert.equal(r.error, null);
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0]!.account, "6100 Office Supplies");
});

check("a multi-cell row with a bad date still fails loudly", () => {
  const r = parseGlDetail(`Date,Name,Account,Amount\nnot a date,X,6100 Supplies,1.00\n`);
  assert.match(r.error ?? "", /Row 2/);
});

if (failures) { console.log(`\n${failures} GL detail check(s) failed`); process.exit(1); }
console.log("\nAll GL detail checks passed");
