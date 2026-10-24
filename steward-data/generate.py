"""
Generate SYNTHETIC demo data for Steward (Cal Hacks 13.0).

Everything here is fictional: the nonprofit, the funders, the people and the
transactions. Nothing represents a real organization. Output files:

  grant_A_federal_passthrough.pdf   - federal pass-through grant (Uniform Guidance style)
  grant_B_harbor_light_foundation.pdf - private foundation restricted grant
  bank_transactions_q3_2026.csv     - messy operating-account export, Jul-Oct 2026
  staff_allocation.csv              - time/effort allocation by employee
  expected_labels.json              - hand-authored answer key (our eval set)

Run:  python3 generate.py
"""
import csv
import json
import random
from datetime import date, timedelta

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from reportlab.lib import colors

random.seed(42)

ORG = "Valencia Youth Collective (SYNTHETIC DEMO ORG)"

# ---------------------------------------------------------------------------
# Grant agreements
# ---------------------------------------------------------------------------
GRANT_A = {
    "id": "GA-2026-114",
    "file": "grant_A_federal_passthrough.pdf",
    "title": "SUBAWARD AGREEMENT No. GA-2026-114",
    "funder": "Golden Gate Regional Workforce Agency (fictional pass-through entity)",
    "program": "Youth Pathways to Employment",
    "period": ("2026-07-01", "2027-06-30"),
    "award": 180000,
    "lines": [
        ("A1", "Personnel (salaries)", 110000),
        ("A2", "Fringe benefits", 22000),
        ("A3", "Program supplies", 18000),
        ("A4", "Participant stipends", 20000),
        ("A5", "Local travel", 4000),
        ("A6", "Indirect costs", 6000),
    ],
}

GRANT_B = {
    "id": "HLF-26-031",
    "file": "grant_B_harbor_light_foundation.pdf",
    "title": "GRANT AGREEMENT HLF-26-031",
    "funder": "Harbor Light Foundation (fictional private foundation)",
    "program": "Summer Literacy Lab",
    "period": ("2026-06-01", "2026-09-30"),
    "award": 60000,
    "lines": [
        ("B1", "Instructor compensation", 35000),
        ("B2", "Books and learning materials", 15000),
        ("B3", "Field trips", 6000),
        ("B4", "Administration", 4000),
    ],
}


def money(n):
    return f"${n:,.2f}"


def build_pdf(g, sections):
    ss = getSampleStyleSheet()
    h = ParagraphStyle("h", parent=ss["Heading2"], spaceBefore=10, spaceAfter=4)
    body = ParagraphStyle("b", parent=ss["BodyText"], leading=14)
    small = ParagraphStyle("s", parent=ss["BodyText"], fontSize=8, textColor=colors.grey)
    doc = SimpleDocTemplate(g["file"], pagesize=letter,
                            leftMargin=0.9 * inch, rightMargin=0.9 * inch)
    story = [
        Paragraph("SYNTHETIC DOCUMENT FOR SOFTWARE DEMONSTRATION - NOT A REAL AGREEMENT", small),
        Spacer(1, 6),
        Paragraph(g["title"], ss["Title"]),
        Paragraph(f"<b>Funder:</b> {g['funder']}", body),
        Paragraph(f"<b>Recipient:</b> {ORG}", body),
        Paragraph(f"<b>Program:</b> {g['program']}", body),
        Paragraph(f"<b>Period of performance:</b> {g['period'][0]} through {g['period'][1]}", body),
        Paragraph(f"<b>Total award:</b> {money(g['award'])}", body),
        Spacer(1, 8),
    ]
    for heading, paras, table in sections:
        story.append(Paragraph(heading, h))
        for p in paras:
            story.append(Paragraph(p, body))
            story.append(Spacer(1, 4))
        if table:
            t = Table(table, colWidths=[0.8 * inch, 3.6 * inch, 1.6 * inch])
            t.setStyle(TableStyle([
                ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eeeeee")),
                ("ALIGN", (2, 0), (2, -1), "RIGHT"),
            ]))
            story.append(t)
    doc.build(story)


def budget_table(g):
    rows = [["Line", "Category", "Approved budget"]]
    rows += [[c, n, money(a)] for c, n, a in g["lines"]]
    rows.append(["", "TOTAL", money(sum(a for _, _, a in g["lines"]))])
    return rows


build_pdf(GRANT_A, [
    ("Section 1. Purpose",
     ["Funds shall be used solely to operate the Youth Pathways to Employment program, "
      "serving residents aged 16-24 with job-readiness training, paid work experience "
      "(participant stipends) and placement support."], None),
    ("Section 2. Approved Budget", [
        "Expenditures shall be charged to the budget lines below. Cumulative transfers "
        "between budget lines exceeding ten percent (10%) of the total award require prior "
        "written approval of the Agency (see Section 6)."], budget_table(GRANT_A)),
    ("Section 3. Applicable Requirements", [
        "This subaward is funded with federal funds. The Recipient shall comply with "
        "2 CFR Part 200 (Uniform Administrative Requirements, Cost Principles, and Audit "
        "Requirements for Federal Awards), including the cost principles of Subpart E."], None),
    ("Section 4. Unallowable Costs", [
        "4.1 The following costs are unallowable and may not be charged to this award under "
        "any budget line:",
        "4.2 Alcoholic beverages (2 CFR 200.423).",
        "4.3 Entertainment costs, including amusement, diversion and social activities and "
        "any associated costs such as tickets, meals, lodging or gratuities, except where "
        "specifically approved as a programmatic purpose (2 CFR 200.438).",
        "4.4 Fines, penalties, damages and other settlements, including parking and traffic "
        "citations (2 CFR 200.441).",
        "4.5 Fundraising and investment management costs, including costs of galas, donor "
        "events and capital campaigns (2 CFR 200.442).",
        "4.6 Lobbying (2 CFR 200.450).",
        "4.7 Meals are allowable only when provided to program participants during "
        "scheduled program sessions. Staff meals and staff appreciation events are "
        "unallowable."], None),
    ("Section 5. Equipment and Prior Approval", [
        "5.1 Any single item of equipment with a per-unit acquisition cost of $5,000 or more "
        "requires prior written approval of the Agency before purchase. Costs incurred "
        "without prior approval may be disallowed.",
        "5.2 Supplies under $5,000 per unit may be charged to Line A3."], None),
    ("Section 6. Personnel and Effort", [
        "Salaries may be charged only in proportion to documented time spent on this "
        "program, as recorded in the Recipient's time and effort records. Fringe benefits "
        "shall be charged at the Recipient's actual rate, not to exceed 20% of charged "
        "salaries."], None),
    ("Section 7. Indirect Costs", [
        "Indirect costs may be charged at a rate not to exceed ten percent (10%) of "
        "modified total direct costs, and in no case more than the Line A6 budget."], None),
    ("Section 8. Reporting", [
        "8.1 The Recipient shall submit a quarterly financial report showing expenditures "
        "by budget line (budget vs. actual) within thirty (30) days after the end of each "
        "calendar quarter. The first report, covering July 1 - September 30, 2026, is due "
        "October 30, 2026.",
        "8.2 Costs must be incurred within the period of performance."], None),
])

build_pdf(GRANT_B, [
    ("1. Purpose and Restriction",
     ["This grant is restricted to the Summer Literacy Lab, a reading program for "
      "children in grades 2-5. Funds may not be used for any other program or for "
      "general operating expenses of the Grantee."], None),
    ("2. Budget", [
        "The Grantee shall spend the grant substantially in accordance with the budget "
        "below. Any budget line may vary by up to fifteen percent (15%) without prior "
        "approval; variances above 15% on any line require written approval from the "
        "Foundation's program officer."], budget_table(GRANT_B)),
    ("3. Prohibited Uses", [
        "3.1 Grant funds may not be used for capital expenditures, endowment, debt "
        "service, political campaign activity, or fundraising events.",
        "3.2 Administration costs may not exceed $4,000 (Line B4)."], None),
    ("4. Grant Period", [
        "4.1 Only expenses incurred between June 1, 2026 and September 30, 2026 may be "
        "charged to this grant. Expenses incurred after the grant period are not "
        "reimbursable from grant funds.",
        "4.2 Any funds unspent at the end of the grant period must be reported and, unless "
        "an extension is approved in writing, returned to the Foundation."], None),
    ("5. Final Report", [
        "A final narrative and financial report (budget vs. actual by line) is due "
        "October 31, 2026."], None),
])

# ---------------------------------------------------------------------------
# Staff allocation (time & effort)
# ---------------------------------------------------------------------------
STAFF = [
    # name, role, biweekly gross, allocation
    ("J. Rivera", "Program Coordinator", 3200.00, {"GA-2026-114:A1": 1.0}),
    ("M. Chen", "Career Coach", 2800.00, {"GA-2026-114:A1": 0.5, "UNRESTRICTED": 0.5}),
    ("A. Okafor", "Executive Director", 4100.00, {"UNRESTRICTED": 1.0}),
    ("S. Patel", "Literacy Instructor (seasonal)", 2400.00, {"HLF-26-031:B1": 1.0}),
    ("D. Nguyen", "Literacy Instructor (seasonal)", 2400.00, {"HLF-26-031:B1": 1.0}),
]
with open("staff_allocation.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["employee", "role", "biweekly_gross_usd", "allocation"])
    for n, r, g, a in STAFF:
        w.writerow([n, r, f"{g:.2f}", ";".join(f"{k}={v:.0%}" for k, v in a.items())])

# ---------------------------------------------------------------------------
# Transactions
# ---------------------------------------------------------------------------
txns = []  # each: dict with date, description, amount, memo + expected label


def add(d, desc, amt, memo, grant, line, status, issue=None, clause=None):
    txns.append({
        "date": d.isoformat(), "description": desc, "amount": round(amt, 2), "memo": memo,
        "_expected": {"grant": grant, "line": line, "status": status,
                      "issue": issue, "clause": clause},
    })


start = date(2026, 7, 1)

# Payroll: biweekly, Jul 10 - Sep 18 (seasonal instructors only Jul-Aug)
pay = date(2026, 7, 10)
while pay <= date(2026, 9, 30):
    for n, r, g, a in STAFF:
        if "seasonal" in r and pay > date(2026, 8, 28):
            continue
        for k, share in a.items():
            gr, ln = (k.split(":") + [None])[:2] if k != "UNRESTRICTED" else ("UNRESTRICTED", None)
        add(pay, "GUSTO PAYROLL NET PAY", -g, f"Payroll {r} ({n})",
            "SPLIT" if len(a) > 1 else list(a)[0].split(":")[0],
            "SPLIT" if len(a) > 1 else (list(a)[0].split(":")[1] if ":" in list(a)[0] else None),
            "auto")
    pay += timedelta(days=14)

# Rent and general operations (unrestricted)
for m in (7, 8, 9):
    add(date(2026, m, 1), "ACH DEBIT MISSION ST PROPERTIES LLC RENT", -6500.00,
        "Monthly rent", "UNRESTRICTED", None, "auto")
    add(date(2026, m, 5), "COMCAST BUSINESS 800-391-3000", -189.99, "", "UNRESTRICTED", None, "auto")
    add(date(2026, m, 12), "PG&E WEB ONLINE", -round(random.uniform(210, 340), 2), "",
        "UNRESTRICTED", None, "auto")
    add(date(2026, m, 15), "INTUIT *QUICKBOOKS ONLINE", -90.00, "", "UNRESTRICTED", None, "auto")

# Grant A program supplies, stipends, travel
supply_vendors = ["AMAZON MKTPLACE PMTS", "OFFICE DEPOT #2231", "STAPLES 00114", "COSTCO WHSE #0144"]
for i in range(14):
    d = start + timedelta(days=random.randint(3, 88))
    v = random.choice(supply_vendors)
    memo = random.choice(["Workshop supplies", "Resume printing", "Job-readiness kits",
                          "Interview clothing closet", ""])
    add(d, v, -round(random.uniform(45, 420), 2), memo, "GA-2026-114", "A3", "auto")
for m in (7, 8, 9):
    for wk in range(2):
        add(date(2026, m, 8 + wk * 14), "VENMO *PAYOUT BATCH YPE COHORT", -round(random.uniform(1450, 1900), 2),
            "Participant stipends - work experience", "GA-2026-114", "A4", "auto")
for i in range(6):
    add(start + timedelta(days=random.randint(2, 89)), "CLIPPER CARD AUTOLOAD", -40.00,
        "Participant transit to employer sites", "GA-2026-114", "A5", "auto")
# Participant meals during sessions (allowable per 4.7)
for i in range(4):
    add(start + timedelta(days=random.randint(5, 85)), "LA TAQUERIA SF", -round(random.uniform(110, 190), 2),
        "Lunch for participants - Tuesday job readiness session", "GA-2026-114", "A3", "auto")

# Grant B literacy materials, field trips
book_vendors = ["SCHOLASTIC INC", "GREEN APPLE BOOKS", "DEMCO INC", "LAKESHORE LEARNING"]
for i in range(10):
    d = date(2026, 6, 15) + timedelta(days=random.randint(0, 70))
    add(d, random.choice(book_vendors), -round(random.uniform(380, 1350), 2),
        random.choice(["Leveled readers", "Classroom library", "Phonics kits", ""]),
        "HLF-26-031", "B2", "auto")
add(date(2026, 7, 22), "CALIFORNIA ACADEMY OF SCI", -1240.00, "Field trip - Literacy Lab grades 2-3",
    "HLF-26-031", "B3", "auto")
add(date(2026, 8, 14), "EXPLORATORIUM", -1580.00, "Field trip - Literacy Lab grades 4-5",
    "HLF-26-031", "B3", "auto")
add(date(2026, 8, 3), "GOLDEN GATE CHARTER BUS", -980.00, "Bus for Academy field trip",
    "HLF-26-031", "B3", "auto")

# Donations / income (positive)
for i in range(5):
    add(start + timedelta(days=random.randint(1, 90)), "STRIPE TRANSFER ST-DONATIONS",
        round(random.uniform(400, 2600), 2), "Online donations", "INCOME", None, "auto")
add(date(2026, 7, 2), "DEPOSIT GGRWA ADVANCE GA-2026-114", 45000.00, "Q1 advance",
    "INCOME", None, "auto")
add(date(2026, 6, 3), "DEPOSIT HARBOR LIGHT FDN", 60000.00, "Grant payment HLF-26-031",
    "INCOME", None, "auto")

# A refund (messy reality)
add(date(2026, 8, 19), "AMAZON MKTPLACE PMTS REFUND", 63.48, "Return - damaged kits",
    "GA-2026-114", "A3", "auto")

# ---------------------------------------------------------------------------
# PLANTED EXCEPTIONS (the demo "moments")
# ---------------------------------------------------------------------------
add(date(2026, 8, 21), "THE BLACK CAT SF", -482.50, "Staff appreciation night - YPE team",
    "GA-2026-114", None, "blocked", "Alcohol / staff appreciation charged to federal grant",
    "GA-2026-114 §4.2, §4.7; 2 CFR 200.423")
add(date(2026, 9, 2), "DELL MARKETING L.P.", -6240.00, "Rack server for participant data",
    "GA-2026-114", "A3", "needs_review", "Single equipment item >= $5,000 requires prior approval",
    "GA-2026-114 §5.1")
add(date(2026, 9, 9), "SFMTA CITATION PAYMENT", -96.00, "Parking ticket - van at employer site visit",
    "UNRESTRICTED", None, "blocked", "Fines/penalties unallowable on federal award",
    "GA-2026-114 §4.4; 2 CFR 200.441")
add(date(2026, 9, 16), "PALACE OF FINE ARTS EVENTS", -3500.00, "Deposit - Fall Benefit Gala",
    "UNRESTRICTED", None, "blocked", "Fundraising event cannot be charged to either grant",
    "GA-2026-114 §4.5; HLF-26-031 §3.1")
add(date(2026, 10, 3), "BAY AREA DISCOVERY MUSEUM", -1325.00, "Field trip - Literacy Lab wrap-up",
    "UNRESTRICTED", None, "blocked", "Incurred after Harbor Light grant period ended 2026-09-30",
    "HLF-26-031 §4.1")
add(date(2026, 8, 6), "SCHOLASTIC INC", -1284.00, "Classroom library set",
    "HLF-26-031", "B2", "auto")
add(date(2026, 8, 7), "SCHOLASTIC INC", -1284.00, "",
    "HLF-26-031", "B2", "needs_review", "Possible duplicate payment (same vendor, same amount, 1 day apart)",
    None)
# Push Books line (B2) materially over budget: big order
add(date(2026, 8, 25), "LAKESHORE LEARNING", -8350.00, "Take-home book bags for all students",
    "HLF-26-031", "B2", "needs_review", "Pushes Line B2 more than 15% over budget; needs program officer approval",
    "HLF-26-031 §2")

# Sort, assign IDs, write
txns.sort(key=lambda t: t["date"])
for i, t in enumerate(txns, 1):
    t["id"] = f"T{i:04d}"

with open("bank_transactions_q3_2026.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["Posting Date", "Description", "Amount", "Memo"])
    for t in txns:
        # messy formats: US dates, amounts with commas sometimes
        d = date.fromisoformat(t["date"]).strftime("%m/%d/%Y")
        amt = f"{t['amount']:,.2f}" if abs(t["amount"]) >= 1000 and random.random() < 0.5 else f"{t['amount']:.2f}"
        w.writerow([d, t["description"], amt, t["memo"]])

with open("expected_labels.json", "w") as f:
    json.dump([{"id": t["id"], "date": t["date"], "description": t["description"],
                "amount": t["amount"], **t["_expected"]} for t in txns], f, indent=2)

# Summary
b2 = sum(-t["amount"] for t in txns if t["_expected"]["grant"] == "HLF-26-031"
         and t["_expected"]["line"] == "B2" and t["_expected"]["issue"] is None or
         (t["_expected"]["line"] == "B2" and "budget" in (t["_expected"]["issue"] or "")))
issues = [t for t in txns if t["_expected"]["issue"]]
print(f"transactions: {len(txns)}")
print(f"planted issues: {len(issues)}")
for t in issues:
    print(f"  {t['id']} {t['date']} {t['description'][:32]:32} {t['amount']:>10.2f}  {t['_expected']['status']}")
print(f"B2 (books) spend incl. big order, excl. duplicate: {b2:,.2f} vs budget 15,000 (cap +15% = 17,250)")

# ---------------------------------------------------------------------------
# GL export from the part-time bookkeeper: the colleague's half-done work.
# Covers transactions through 2026-08-31 only. It contains planted mistakes
# that disagree with the bank, the contracts and the time records.
# ---------------------------------------------------------------------------
gl_rows = []
gl_mistakes = []
for t in txns:
    if t["date"] > "2026-08-31":
        continue  # handed over half done: September not yet coded
    exp = t["_expected"]
    acct = {"INCOME": "4000 Grant & Contribution Revenue", "UNRESTRICTED": "6000 General Operations"}.get(exp["grant"])
    cls = exp["grant"] if exp["grant"] not in ("INCOME", "UNRESTRICTED", "SPLIT") else ""
    line = exp["line"] or ""
    amount = t["amount"]
    if exp["grant"] == "SPLIT":  # M. Chen: bookkeeper charged 100% to federal grant (timesheet says 50%)
        cls, line = "GA-2026-114", "A1"
        gl_mistakes.append({"id": t["id"], "issue": "Salary charged 100% to GA-2026-114; staff_allocation says 50%",
                            "clause": "GA-2026-114 §6"})
    if t["description"].startswith("THE BLACK CAT"):
        line = "A3"
        gl_mistakes.append({"id": t["id"], "issue": "Bar tab coded as Program supplies on federal grant",
                            "clause": "GA-2026-114 §4.2, §4.7"})
    if t["description"].startswith("DEPOSIT GGRWA"):
        amount = 54000.00
        gl_mistakes.append({"id": t["id"], "issue": "Ledger records $54,000 advance; bank shows $45,000",
                            "clause": None})
    gl_rows.append([t["id"], t["date"], t["description"], f"{amount:.2f}",
                    acct or ("5000 Program Expense" if amount < 0 else "4000 Grant & Contribution Revenue"),
                    cls, line, "bookkeeper:r.lopez"])

with open("gl_export_bookkeeper.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["bank_ref", "date", "description", "amount", "account", "class", "budget_line", "entered_by"])
    w.writerows(gl_rows)

# Prior decisions (time: what happened in June should change what happens in August)
precedents = [
    {"date": "2026-06-20", "by": "A. Okafor (Executive Director / approver)",
     "ruling": "Lunches for program participants during scheduled sessions are allowable on GA-2026-114 Line A3 "
               "under §4.7. Staff-only meals are not.", "scope": "GA-2026-114"},
    {"date": "2026-06-25", "by": "Golden Gate Regional Workforce Agency (email, fictional)",
     "ruling": "No prior approval has been requested or granted for any equipment purchase under §5.1 "
               "as of this date.", "scope": "GA-2026-114"},
]
with open("precedents.json", "w") as f:
    json.dump(precedents, f, indent=2)

with open("expected_gl_findings.json", "w") as f:
    json.dump(gl_mistakes, f, indent=2)

print(f"gl rows (Jul-Aug only): {len(gl_rows)}; planted GL disagreements: {len(gl_mistakes)}")
