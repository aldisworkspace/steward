"""
SEALED hold-out v3 for Steward v2. Written independently of the v2 demo and v2 hold-out sets.

Fictional org (refugee resettlement nonprofit), a fictional state-agency contract
(cost-reimbursement, monthly invoices) and a fictional foundation grant paid in advance
(semiannual report, no invoices). Every document is synthetic.

Run:  uv run --with reportlab --with faker python scripts/generate_holdout_v3.py
Out:  steward-holdout-v3-SEALED.zip (the unzipped folder is removed); prints sha256.
      Pass --keep to leave steward-holdout-v3/ on disk.
"""
import csv
import hashlib
import io
import json
import os
import random
import shutil
import sys
import zipfile
from datetime import date

from faker import Faker
from PIL import Image, ImageDraw, ImageFont
from reportlab import rl_config
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

rl_config.invariant = 1  # deterministic PDF bytes (no timestamps / random IDs)

SEED = 30319
rng = random.Random(SEED)
fake = Faker("en_US")
Faker.seed(SEED)

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "steward-holdout-v3")
ZIP = os.path.join(ROOT, "steward-holdout-v3-SEALED.zip")
LABEL = "SYNTHETIC — generated for testing"

ORG = "Cedar Hollow Refugee Welcome Center"
ORG_ADDR = "418 Juniper Avenue, Ellery Falls, NK 60412"
STATE = "State of Northmark"
AGENCY = "Northmark Office of New Americans"
NONA = "NONA-27-0193"
LAFF = "LAFF-2026-14"
FOUND = "Linden Ash Family Foundation"
TAX_BP = 725  # 7.25% fictional Northmark sales tax
CHECKING = "1010 Cedar Valley Credit Union Checking"
AP = "2000 Accounts Payable (A/P)"

money = lambda c: f"${c / 100:,.2f}"
amt = lambda c: f"{c / 100:.2f}"
mdy = lambda d: d.strftime("%m/%d/%Y")


def rhu(x):  # round half up, x is a float/int of cents*something
    return int(x + 0.5) if x >= 0 else -int(-x + 0.5)


def tax_of(cents):
    return (cents * TAX_BP + 5000) // 10000


CITIES = ["Ellery Falls", "Port Ellery", "Wexford Junction", "Marlow Bay"]


def addr():
    return f"{fake.street_address()}, {rng.choice(CITIES)}, NK {rng.randint(60400, 60499)}"


# ----------------------------------------------------------------------------- contracts
NONA_LINES = [
    ("A1", "Personnel (salaries & wages)", 15600000),
    ("A2", "Fringe benefits", 3450000),
    ("A3", "Client direct assistance", 3600000),
    ("A4", "Interpretation & translation services", 1800000),
    ("A5", "Program supplies & materials", 1000000),
    ("A6", "Local travel", 120000),
    ("A7", "Equipment", 600000),
    ("A8", "Staff training & conferences", 300000),
    ("A9", "Indirect costs", 2400000),
]
NONA_TOTAL = sum(a for *_, a in NONA_LINES)
LAFF_LINES = [
    ("L1", "Youth mentoring & family ESL staff", 7000000),
    ("L2", "Youth mentoring activities", 600000),
    ("L3", "ESL instructional materials", 440000),
    ("L4", "Program space rent", 960000),
]
LAFF_TOTAL = sum(a for *_, a in LAFF_LINES)
RECEIPT_THRESHOLD = 15000  # $150.00 (contract 8.1)
PRIOR_APPROVAL = 250000  # $2,500.00 (contract 7.1)
VARIANCE_PCT = 10  # contract 4.1
IDC_RATE_BP = 1000  # 10% of MTDC (contract 10.1)
FRINGE_BP = 2200  # booked fringe rate; cap 24% (contract 9.1)
SESSIONS = [date(2026, 7, 15), date(2026, 8, 12), date(2026, 9, 9), date(2026, 10, 14),
            date(2026, 11, 11), date(2026, 12, 9)]


def contract_pdf(path, title, header, sections, exhibit=None):
    ss = getSampleStyleSheet()
    body = ParagraphStyle("b", parent=ss["BodyText"], leading=14)
    h = ParagraphStyle("h", parent=ss["Heading3"], spaceBefore=8)
    lab = ParagraphStyle("s", parent=body, fontSize=9, textColor=colors.red)
    story = [Paragraph(LABEL, lab), Paragraph(title, ss["Title"])]
    story += [Paragraph(x, body) for x in header] + [Spacer(1, 6)]
    for head, paras, table in sections:
        story.append(Paragraph(head, h))
        story += [Paragraph(p, body) for p in paras]
        if table:
            t = Table(table, colWidths=[0.8 * inch, 3.8 * inch, 1.5 * inch])
            t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                                   ("ALIGN", (2, 0), (2, -1), "RIGHT"),
                                   ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold")]))
            story.append(t)
    if exhibit:
        story.append(Paragraph(exhibit[0], h))
        story += [Paragraph(p, body) for p in exhibit[1]]
    story += [Spacer(1, 10), Paragraph(LABEL + ". Fictional parties; not a real agreement.", lab)]
    SimpleDocTemplate(path, pagesize=letter, title=title, author="synthetic",
                      leftMargin=0.9 * inch, rightMargin=0.9 * inch).build(story)


def budget_table(lines):
    return ([["Code", "Budget line", "Amount"]] + [[c, n, money(a)] for c, n, a in lines]
            + [["", "Total", money(sum(a for *_, a in lines))]])


def write_contracts():
    contract_pdf(
        f"{OUT}/contract_NONA-27-0193_state_new_americans.pdf",
        f"STANDARD SERVICES CONTRACT No. {NONA}",
        [f"<b>Department:</b> {AGENCY}, {STATE} (fictional state agency)",
         f"<b>Contractor:</b> {ORG}, {ORG_ADDR}",
         "<b>Program:</b> Refugee Resettlement Case Management &amp; Cultural Orientation",
         "<b>Term:</b> July 1, 2026 through June 30, 2027",
         f"<b>Maximum contract amount:</b> {money(NONA_TOTAL)}",
         "<b>Payment basis:</b> Cost reimbursement, billed monthly in arrears"],
        [("1. Term", ["1.1 This Contract is effective July 1, 2026 and ends June 30, 2027 (the Term)."], None),
         ("2. Scope of Services", [
             "2.1 Contractor shall provide case management, housing placement support, employment "
             "readiness and cultural orientation to newly arrived adult refugees and asylees in Ellery County.",
             "2.2 Costs charged to this Contract must be necessary and reasonable for the services in 2.1."], None),
         ("3. Budget", [f"3.1 The approved budget is set out below. The budget lines total the maximum contract amount of {money(NONA_TOTAL)}."],
          budget_table(NONA_LINES)),
         ("4. Budget Flexibility", [
             f"4.1 Cumulative billings on any budget line may not exceed that line's approved annual amount by more than "
             f"ten percent ({VARIANCE_PCT}%) without a written budget revision executed by the Department. Amounts above that "
             "limit are not reimbursable."], None),
         ("5. Payment", [
             "5.1 This is a cost-reimbursement contract. Contractor shall submit one invoice per calendar month, within 30 "
             "days after month end, for allowable costs incurred during that month, itemized by budget line and tied to "
             "Contractor's general ledger.",
             "5.2 The Department makes no advance payments under this Contract.",
             "5.3 Costs incurred before the start or after the end of the Term are not allowable, regardless of when the "
             "vendor invoice is dated, received or paid."], None),
         ("6. Allowable and Unallowable Costs", [
             "6.1 Alcoholic beverages are unallowable under all circumstances.",
             "6.2 Entertainment costs (tickets, shows, amusements) and gifts to staff or clients are unallowable.",
             "6.3 Fines, penalties, late fees and interest are unallowable.",
             "6.4 Costs of lobbying or influencing legislation are unallowable.",
             "6.5 Light meals and refreshments for clients during scheduled cultural orientation sessions listed in "
             "Exhibit B are allowable on line A5, not to exceed $15.00 per attendee.",
             "6.6 Meals of Contractor staff while attending a conference charged to line A8 are allowable at actual cost, "
             "excluding alcoholic beverages."], None),
         ("7. Prior Approval", [
             f"7.1 Any single purchase of equipment, furniture or information-technology hardware totaling {money(PRIOR_APPROVAL)} "
             "or more (including tax and delivery) requires the Department's prior written approval. A purchase made without "
             "that approval is unallowable.",
             "7.2 Travel outside the State of Northmark requires the Department's prior written approval."], None),
         ("8. Documentation", [
             f"8.1 Contractor shall retain an itemized receipt or vendor invoice for every expenditure of {money(RECEIPT_THRESHOLD)} "
             "or more charged to this Contract. Expenditures below that amount may be supported by the general ledger entry alone.",
             "8.2 Recurring charges made under an executed lease or service agreement on file with the Department are "
             "documented by that agreement and do not require per-payment receipts.",
             "8.3 The amount billed must agree with the supporting receipt or invoice.",
             "8.4 Salaries and wages may be charged only in accordance with the staff allocation percentages on file with "
             "the Department, as supported by time and effort records."], None),
         ("9. Personnel and Fringe", [
             "9.1 Fringe benefits are reimbursed at actual cost, not to exceed twenty-four percent (24%) of the salaries "
             "billed on line A1 in the same month."], None),
         ("10. Indirect Costs", [
             "10.1 Contractor may bill indirect costs on line A9 at ten percent (10%) of modified total direct costs (MTDC).",
             "10.2 MTDC means all direct costs billed for the month on lines A1, A2, A4, A5, A6 and A8. MTDC excludes "
             "client direct assistance (line A3) and equipment (line A7).",
             "10.3 Indirect costs are computed and billed monthly on that month's MTDC."], None),
         ("11. Records and Audit", [
             "11.1 Records shall be retained for five years after final payment and made available to the Department on request."], None)],
        exhibit=("Exhibit B - Scheduled Cultural Orientation Sessions (Term year 1, first half)",
                 ["Sessions are held 10:00 a.m. to 2:00 p.m. at Contractor's Juniper Avenue site: "
                  + "; ".join(d.strftime("%B %d, %Y") for d in SESSIONS) + "."]))

    contract_pdf(
        f"{OUT}/grant_LAFF-2026-14_linden_ash_foundation.pdf",
        f"GRANT AGREEMENT No. {LAFF}",
        [f"<b>Grantor:</b> {FOUND} (fictional private foundation)",
         f"<b>Grantee:</b> {ORG}, {ORG_ADDR}",
         "<b>Project:</b> Bridges Youth Mentoring &amp; Family ESL",
         "<b>Grant period:</b> July 1, 2026 through June 30, 2027",
         f"<b>Grant amount:</b> {money(LAFF_TOTAL)}"],
        [("Section 1. Purpose", ["1.1 The grant supports one-to-one and group mentoring for refugee youth ages 12-18 and "
                                 "English-language classes for their families."], None),
         ("Section 2. Payment", [
             "2.1 The Foundation pays this grant in ADVANCE in two installments: $45,000.00 upon execution (July 2026) and "
             "$45,000.00 in January 2027 upon acceptance of the first semiannual report.",
             "2.2 Grantee does not submit invoices or reimbursement requests under this Agreement."], None),
         ("Section 3. Budget", ["3.1 Approved budget (total equals the grant amount):",
                                "3.2 Grantee may reallocate up to fifteen percent (15%) of any budget line without prior consent."],
          budget_table(LAFF_LINES)),
         ("Section 4. Restrictions", [
             "4.1 Grant funds may not be used for cash or cash-equivalent assistance to individuals, including gift cards, "
             "prepaid cards, store cards or vouchers.",
             "4.2 Grant funds may not be used for lobbying or electoral activity.",
             "4.3 Grant funds may not be used to purchase equipment with a unit cost above $1,000.00.",
             "4.4 Group outings and educational admissions for mentored youth are allowable on line L2."], None),
         ("Section 5. Records", [
             "5.1 Grantee shall retain receipts for single expenditures of $250.00 or more charged to the grant. Rent paid "
             "under the lease on file needs no per-payment receipt."], None),
         ("Section 6. Reporting", [
             "6.1 Grantee submits a semiannual narrative and financial report by budget line, due January 31, 2027 "
             "(period July-December 2026) and July 31, 2027 (period January-June 2027).",
             "6.2 Unexpended advance funds at the end of the grant period are returned to the Foundation."], None)])


# ----------------------------------------------------------------------------- GL model
rows = []  # each: dict with GL fields + meta
receipts = []  # receipt specs
seq = {"dd": 4100, "chk": 1036}


def add(d, ttype, num, name, memo, account, cls, loc, cents, split=CHECKING, receipt=None, issue=None, tag=None):
    r = dict(date=d, ttype=ttype, num=num, name=name, memo=memo, account=account, cls=cls, loc=loc,
             split=split, cents=cents, receipt=receipt, issue=issue, tag=tag)
    rows.append(r)
    return r


def items_total(items):
    sub = sum(q * u for _, q, u, *_ in items)
    taxable = sum(q * u for _, q, u, *t in items if (t[0] if t else True))
    tax = tax_of(taxable)
    return sub, tax, sub + tax


def rcpt(fname, vendor, d, items, kind="pdf", doc="RECEIPT", number=None, notes=(), payment="Debit card ****4417",
         service=None, bill_to=False):
    sub, tax, total = items_total(items)
    spec = dict(file=f"receipts/{fname}.{kind}", vendor=vendor, address=addr(), date=d, items=items, sub=sub, tax=tax,
                total=total, kind=kind, doc=doc, number=number or f"{rng.randint(100000, 999999)}", notes=list(notes),
                payment=payment, service=service, bill_to=bill_to)
    receipts.append(spec)
    return spec


def nontax(desc, q, u):
    return (desc, q, u, False)


# ---- payroll -------------------------------------------------------------------------
STAFF = [  # employee, role, biweekly gross cents, allocation [(class, pct)], location
    ("R. Haddad", "Program Manager", 290000, [(f"{NONA}:A1", 70), ("General", 30)], "Resettlement Services"),
    ("T. Mwangi", "Case Manager", 230000, [(f"{NONA}:A1", 100)], "Resettlement Services"),
    ("L. Ortiz", "Case Manager / ESL Liaison", 230000, [(f"{NONA}:A1", 70), (f"{LAFF}:L1", 30)], "Resettlement Services"),
    ("P. Sorensen", "Executive Director", 420000, [("General", 100)], "Administration"),
    ("F. Rahimi", "Youth Mentor Coordinator", 195000, [(f"{LAFF}:L1", 100)], "Youth & Family ESL"),
]
PAYDATES = [date(2026, 7, 10), date(2026, 7, 24), date(2026, 8, 7), date(2026, 8, 21), date(2026, 9, 4),
            date(2026, 9, 18), date(2026, 10, 2), date(2026, 10, 16), date(2026, 10, 30)]

for pd in PAYDATES:
    for emp, role, gross, alloc, loc in STAFF:
        seq["dd"] += 1
        num = f"DD{seq['dd']}"
        memo = f"Payroll {mdy(pd)} - biweekly"
        if pd == date(2026, 9, 18) and emp == "R. Haddad":
            add(pd, "Paycheck", num, emp, memo, "6010 Salaries & Wages", f"{NONA}:A1", loc, gross,
                issue=dict(kind="payroll_over_allocation", status="needs_review", clause=f"{NONA} §8.4",
                           note="Full biweekly gross coded 100% to A1; allocation on file is A1=70% / unrestricted=30% "
                                "(over by $870.00)."))
            continue
        parts = []
        remaining = gross
        for i, (cls, pct) in enumerate(alloc):
            c = remaining if i == len(alloc) - 1 else gross * pct // 100
            remaining -= c
            parts.append((cls, c))
        for cls, c in parts:
            add(pd, "Paycheck", num, emp, memo, "6010 Salaries & Wages", cls, loc, c)

# ---- recurring rent / utilities (General + LAFF:L4) ------------------------------------
for m in (7, 8, 9, 10):
    d = date(2026, m, 1)
    num = f"ACH{m:02d}01"
    add(d, "Expense", num, "Larchmont Properties LLC", "Monthly rent - 418 Juniper Ave (lease on file)", "6800 Rent",
        f"{LAFF}:L4", "Youth & Family ESL", 80000, tag="tricky:recurring rent under lease, no receipt needed")
    add(d, "Expense", num, "Larchmont Properties LLC", "Monthly rent - 418 Juniper Ave (lease on file)", "6800 Rent",
        "General", "Administration", 240000)
    add(date(2026, m, 6), "Expense", "", "Northmark Power & Light", f"Electric service {date(2026, m, 1):%b %Y}",
        "6810 Utilities", "General", "Administration", rng.randint(31000, 46000))
    add(date(2026, m, 9), "Expense", "", "Clearwave Telecom", f"Phone & internet {date(2026, m, 1):%b %Y}",
        "6820 Telephone & Internet", "General", "Administration", 21849)
    add(date(2026, m, 28), "Expense", "", "Cedar Valley Credit Union", "Monthly service fee", "6850 Bank Fees",
        "General", "Administration", 1500)
add(date(2026, 7, 14), "Check", str(seq["chk"]), "Tamarack Mutual Insurance", "General liability premium FY27 Q1",
    "6830 Insurance", "General", "Administration", 186500)

# ---- NONA A3 client direct assistance ------------------------------------------------
A3 = [(date(2026, 7, 17), "Brookline Court Apartments", 145000, "R-2611"),
      (date(2026, 8, 14), "Garnet Ridge Rentals", 127500, "R-2634"),
      (date(2026, 9, 15), "Brookline Court Apartments", 145000, "R-2652"),
      (date(2026, 10, 13), "Willow Terrace Homes", 118000, "R-2679")]
for d, v, c, case in A3:
    seq["chk"] += 1
    sp = rcpt(f"{d.isoformat()}_{v.split()[0].lower()}", v, d,
              [nontax(f"Rent - Unit {rng.randint(101, 412)}, {d:%B %Y} (tenant case {case})", 1, c)],
              doc="RENT INVOICE", number=f"INV-{rng.randint(3000, 3999)}", payment=f"Check #{seq['chk']}",
              notes=[f"Bill to: {ORG} - rental assistance program", "First-month rent for newly arrived household"],
              bill_to=True)
    add(d, "Check", str(seq["chk"]), v, f"Client rent assistance - case {case}", "6200 Client Direct Assistance",
        f"{NONA}:A3", "Resettlement Services", sp["total"], receipt=sp)
add(date(2026, 7, 21), "Expense", "", "Northmark Regional Transit", "Client 10-ride passes x2",
    "6200 Client Direct Assistance", f"{NONA}:A3", "Resettlement Services", 7200)
add(date(2026, 9, 22), "Expense", "", "Northmark Regional Transit", "Client 10-ride passes x3",
    "6200 Client Direct Assistance", f"{NONA}:A3", "Resettlement Services", 10800)

# ---- NONA A4 interpretation ----------------------------------------------------------
sp = rcpt("2026-06-30_meridian-language", "Meridian Language Partners", date(2026, 6, 30),
          [nontax("Consecutive interpretation - Dari, 06/08-06/26/2026", 10, 6500),
           nontax("Document translation - housing lease (4 pp)", 1, 21500)],
          doc="INVOICE", number="MLP-0617", payment="Net 15", service="Service period: 06/08/2026 - 06/26/2026",
          bill_to=True)
add(date(2026, 7, 9), "Bill", "MLP-0617", "Meridian Language Partners", "Interpretation services inv MLP-0617",
    "6300 Contract Services - Interpretation", f"{NONA}:A4", "Resettlement Services", sp["total"], split=AP, receipt=sp,
    issue=dict(kind="out_of_period", status="blocked", clause=f"{NONA} §5.3 / §1.1",
               note="Invoice covers services 06/08-06/26/2026, before the Term began 07/01/2026; booked in July."))

LUMEN = [(date(2026, 7, 31), "LIG-2240", 17), (date(2026, 8, 28), "LIG-2291", 19), (date(2026, 9, 30), "LIG-2337", 21),
         (date(2026, 10, 30), "LIG-2384", 18)]
for d, inv, hrs in LUMEN:
    start = d.replace(day=1)
    sp = rcpt(f"{d.isoformat()}_lumen-interpreting", "Lumen Interpreting Group", d,
              [nontax(f"On-site interpretation (Arabic, Pashto, Tigrinya) {start:%m/%d}-{d:%m/%d/%Y}", hrs, 6000)],
              doc="INVOICE", number=inv, payment="Net 30", service=f"Service period: {mdy(start)} - {mdy(d)}",
              bill_to=True)
    add(d, "Bill", inv, "Lumen Interpreting Group", f"Interpretation {start:%b %Y} - inv {inv}",
        "6300 Contract Services - Interpretation", f"{NONA}:A4", "Resettlement Services", sp["total"], split=AP,
        receipt=sp)
    if inv == "LIG-2291":
        seq["chk"] += 1
        dup_chk = str(seq["chk"])
        add(date(2026, 8, 31), "Check", dup_chk, "Lumen Interpreting Group", "Payment inv LIG-2291",
            "6300 Contract Services - Interpretation", f"{NONA}:A4", "Resettlement Services", sp["total"], receipt=sp,
            issue=dict(kind="duplicate_charge", status="needs_review", clause=f"{NONA} §8.3 / §5.1",
                       note="Invoice LIG-2291 is already booked as a Bill on 08/28; the payment was written as a Check "
                            "coded to expense instead of a Bill Payment, so the cost is booked twice. Bank shows one payment."))
for m, c in ((7, 8450), (8, 11230), (9, 9740), (10, 13165)):
    add(date(2026, m, 25), "Expense", "", "VoxBridge Language Line", f"Telephonic interpretation minutes {date(2026, m, 1):%b}",
        "6300 Contract Services - Interpretation", f"{NONA}:A4", "Resettlement Services", c)

# ---- NONA A5 supplies ----------------------------------------------------------------
sp = rcpt("2026-07-08_oakfield-office", "Oakfield Office Supply", date(2026, 7, 8),
          [("Case file folders, letter, box/100", 4, 1879), ("Hanging file frame", 2, 2499),
           ("Copy paper, 10-ream case", 2, 5649), ("Ballpoint pens, box/60", 1, 1599)])
add(date(2026, 7, 8), "Expense", "", "Oakfield Office Supply", "Case file supplies", "6400 Program Supplies",
    f"{NONA}:A5", "Resettlement Services", sp["total"], receipt=sp)
add(date(2026, 7, 28), "Expense", "", "Oakfield Office Supply", "Toner", "6400 Program Supplies", f"{NONA}:A5",
    "Resettlement Services", 4635)

for d, n in ((date(2026, 8, 12), 14), (date(2026, 10, 14), 16)):
    sp = rcpt(f"{d.isoformat()}_saffron-table", "Saffron Table Catering", d,
              [("Boxed lunch - rice, lentils, vegetables", n, 1100), ("Bottled water", n, 150)],
              number=f"ST-{rng.randint(1000, 9999)}",
              notes=[f"Event: Cultural Orientation session, {d:%m/%d/%Y} - {n} attendees"])
    add(d, "Expense", "", "Saffron Table Catering", f"Client lunch - cultural orientation session {mdy(d)}",
        "6420 Program Meals & Refreshments", f"{NONA}:A5", "Resettlement Services", sp["total"], receipt=sp,
        tag="tricky:client meal at Exhibit B session, under $15/attendee")

sp = rcpt("2026-08-18_oakfield-office", "Oakfield Office Supply", date(2026, 8, 18),
          [("Binders, 1.5 in, 12-pack", 2, 3299), ("Sheet protectors, box/200", 2, 2149),
           ("Label maker tape", 3, 1495), ("Whiteboard markers, 12-pk", 2, 1389), ("Desk organizer", 4, 2275),
           ("Copy paper, 10-ream case", 1, 5649)])
add(date(2026, 8, 18), "Expense", "", "Oakfield Office Supply", "Office/program supplies", "6400 Program Supplies",
    f"{NONA}:A5", "Resettlement Services", sp["total"] + 27, receipt=sp,
    issue=dict(kind="receipt_amount_mismatch", status="needs_review", clause=f"{NONA} §8.3",
               note=f"GL amount exceeds receipt total {money(sp['total'])} by $0.27."))

sp = rcpt("2026-09-03_brightcart", "BrightCart Marketplace", date(2026, 9, 3),
          [("Wireless gaming headset w/ RGB lights", 1, 6499), ("Bluetooth karaoke microphone", 1, 3999),
           ("Phone tripod with ring light", 1, 4497)],
          number=f"BC-{rng.randint(10**8, 10**9 - 1)}", notes=["Sold by: third-party seller", "Ship to: 418 Juniper Ave"])
add(date(2026, 9, 3), "Expense", "", "BrightCart Marketplace", "Program supplies", "6400 Program Supplies",
    f"{NONA}:A5", "Resettlement Services", sp["total"], receipt=sp,
    issue=dict(kind="purpose_unclear", status="needs_review", clause=f"{NONA} §2.2 / §6.2",
               note="Marketplace order (gaming headset, karaoke mic, ring-light tripod) has no evident link to adult "
                    "case management; ask what it was for."))

add(date(2026, 9, 8), "Expense", "", "Kestrel Print & Copy", "Flyers - September employment workshops",
    "6400 Program Supplies", f"{NONA}:A5", "Resettlement Services", 15620,
    issue=dict(kind="missing_receipt", status="needs_review", clause=f"{NONA} §8.1",
               note="$156.20 is at/above the $150.00 receipt threshold; no receipt provided."))
add(date(2026, 9, 24), "Expense", "", "Harbor Street Hardware", "Shelving brackets - client donation room",
    "6400 Program Supplies", f"{NONA}:A5", "Resettlement Services", 14890,
    tag="tricky:just below $150 threshold, no receipt required")
add(date(2026, 10, 2), "Expense", "", "Kestrel Print & Copy", "Copies - orientation handbooks", "6400 Program Supplies",
    f"{NONA}:A5", "Resettlement Services", 6420)

split_items = [("Case file folders, letter, box/100", 3, 1879), ("Hanging file frame", 2, 2499), ("Toner cartridge", 1, 6480),
               ("Everyday English Level 1 workbook", 12, 1495), ("Picture dictionary, bilingual", 6, 1150)]
sp = rcpt("2026-10-06_oakfield-office", "Oakfield Office Supply", date(2026, 10, 6), split_items)
nona_sub = 3 * 1879 + 2 * 2499 + 6480
laff_sub = 12 * 1495 + 6 * 1150
nona_share = nona_sub + tax_of(nona_sub)
laff_share = laff_sub + tax_of(laff_sub)
assert nona_share + laff_share == sp["total"], (nona_share, laff_share, sp["total"])
split_memo = "Split: case file supplies (NONA) / ESL workbooks (LAFF)"
r_laff_split = add(date(2026, 10, 6), "Expense", "", "Oakfield Office Supply", split_memo, "6400 Program Supplies",
                   f"{LAFF}:L3", "Youth & Family ESL", nona_share, receipt=sp)
add(date(2026, 10, 6), "Expense", "", "Oakfield Office Supply", split_memo, "6400 Program Supplies",
    f"{NONA}:A5", "Resettlement Services", laff_share, receipt=sp,
    issue=dict(kind="split_allocation_mismatch", status="needs_review", clause=f"{NONA} §8.3 / §2.2",
               note=f"One receipt ({money(sp['total'])}) split across both grants, but the amounts are swapped: case-file items "
                    f"for NONA come to {money(nona_share)} incl. tax, ESL workbooks for LAFF to {money(laff_share)}. NONA is "
                    f"charged {money(laff_share)}. The LAFF:L3 row of the same purchase is the mirror error."))
r_laff_split["tag"] = "related"

# ---- NONA A6 local travel ------------------------------------------------------------
a6 = []
for m, kind in ((7, "pdf"), (8, "pdf"), (9, "png"), (10, "pdf")):
    d = date(2026, m, 3 if m != 10 else 1)
    k = "png" if kind == "png" else "pdf"
    sp = rcpt(f"{d.isoformat()}_nm-regional-transit", "Northmark Regional Transit", d,
              [nontax(f"Adult monthly pass - {d:%B %Y}", 2, 9600)], kind=k, notes=["Staff passes: T. Mwangi, L. Ortiz"])
    a6.append(add(d, "Expense", "", "Northmark Regional Transit", "Staff monthly transit passes", "6500 Local Travel",
                  f"{NONA}:A6", "Resettlement Services", sp["total"], receipt=sp))
for d, miles, days in ((date(2026, 9, 22), 96, 1), (date(2026, 10, 27), 212, 2)):
    sp = rcpt(f"{d.isoformat()}_ridgeline-van", "Ridgeline Van & Truck Rental", d,
              [("15-passenger van, per day", days, 18900), ("Mileage", miles, 45), ("Collision damage waiver, per day", days, 3400)],
              number=f"RA-{rng.randint(20000, 29999)}", notes=["Purpose: client airport arrival pickup"])
    a6.append(add(d, "Expense", "", "Ridgeline Van & Truck Rental", "Van rental - client airport arrival",
                  "6500 Local Travel", f"{NONA}:A6", "Resettlement Services", sp["total"], receipt=sp))
a6_cap = 120000 * (100 + VARIANCE_PCT) // 100
cum = 0
for r in sorted(a6, key=lambda r: r["date"]):
    before = cum
    cum += r["cents"]
    if before <= a6_cap < cum:
        assert r is a6[-1]
        excess = cum - a6_cap
        r["issue"] = dict(kind="line_overrun", status="blocked", clause=f"{NONA} §4.1", blocked=excess,
                          note=f"Cumulative A6 billings reach {money(cum)} against the {money(120000)} line + 10% "
                               f"= {money(a6_cap)}; the excess {money(excess)} of this charge is not billable.")
assert a6[-1]["issue"], "overrun not planted"

# ---- NONA A7 equipment ---------------------------------------------------------------
sp = rcpt("2026-08-11_hollis-business", "Hollis Business Machines", date(2026, 8, 11),
          [("Multifunction copier/printer MX-4100", 1, 259500), nontax("Delivery & network setup", 1, 8500)],
          doc="INVOICE", number=f"HB-{rng.randint(40000, 49999)}", payment="Debit card ****4417")
assert sp["total"] >= PRIOR_APPROVAL
add(date(2026, 8, 11), "Expense", "", "Hollis Business Machines",
    "MFP copier - prior approval NONA ltr PA-2026-03 dated 07/22/2026", "6600 Equipment", f"{NONA}:A7",
    "Resettlement Services", sp["total"], receipt=sp, tag="tricky:over approval threshold but pre-approved (memo + precedent)")
sp = rcpt("2026-09-14_corvane-computers", "Corvane Computers", date(2026, 9, 14),
          [("Corvane 14in notebook, 16GB/512GB", 3, 104900)], number=f"CC-{rng.randint(700000, 799999)}")
assert sp["total"] >= PRIOR_APPROVAL
add(date(2026, 9, 14), "Expense", "", "Corvane Computers", "Laptops - case management team", "6600 Equipment",
    f"{NONA}:A7", "Resettlement Services", sp["total"], receipt=sp,
    issue=dict(kind="missing_prior_approval", status="blocked", clause=f"{NONA} §7.1",
               note=f"Single IT hardware purchase of {money(sp['total'])} (>= $2,500.00) with no prior written approval "
                    "in memo or precedents."))

# ---- NONA A8 training & conferences --------------------------------------------------
sp = rcpt("2026-08-04_nrsc-registration", "Northmark Refugee Services Coalition", date(2026, 8, 4),
          [nontax("Annual Conference registration, Port Ellery, Aug 19-20, 2026", 3, 12500)], doc="REGISTRATION RECEIPT",
          notes=["Attendees: R. Haddad, T. Mwangi, L. Ortiz"])
add(date(2026, 8, 4), "Expense", "", "Northmark Refugee Services Coalition", "NRSC annual conference - 3 staff",
    "6700 Conferences & Training", f"{NONA}:A8", "Resettlement Services", sp["total"], receipt=sp)
dinner = [("Mezze platter", 1, 1600), ("Grilled trout", 2, 2400), ("Lentil stew", 1, 1900), ("Chicken tagine", 1, 2200),
          ("Sparkling water", 2, 400), ("House red wine (glass)", 2, 1200), ("Baklava", 2, 750)]
sp = rcpt("2026-08-19_basil-and-brine", "Basil & Brine Bistro", date(2026, 8, 19), dinner,
          number=f"Check {rng.randint(100, 999)} / Table 12 / Guests 3")
alc = 2 * 1200
alc_blocked = alc + tax_of(alc)
add(date(2026, 8, 19), "Expense", "", "Basil & Brine Bistro", "NRSC conference - team dinner",
    "6700 Conferences & Training", f"{NONA}:A8", "Resettlement Services", sp["total"], receipt=sp,
    issue=dict(kind="unallowable_line_item", status="blocked", clause=f"{NONA} §6.1 / §6.6", blocked=alc_blocked,
               note=f"Receipt includes 2 glasses of house wine ($24.00 + 7.25% tax = {money(alc_blocked)}); the rest of "
                    "the staff conference dinner is allowable."))

# ---- LAFF direct costs ---------------------------------------------------------------
sp = rcpt("2026-08-06_lakeside-learning", "Lakeside Learning Books", date(2026, 8, 6),
          [("Graded ESL reader set, Level A", 4, 3895), ("Family literacy activity kit", 2, 4250),
           ("Flash cards, everyday vocabulary", 6, 1299)])
add(date(2026, 8, 6), "Expense", "", "Lakeside Learning Books", "ESL class materials - family classes",
    "6400 Program Supplies", f"{LAFF}:L3", "Youth & Family ESL", sp["total"], receipt=sp)
sp = rcpt("2026-08-25_fernway-grocers", "Fernway Grocers", date(2026, 8, 25),
          [nontax("Fernway gift card - $50.00", 8, 5000)], kind="png", notes=["Gift cards are not redeemable for cash"])
add(date(2026, 8, 25), "Expense", "", "Fernway Grocers", "Family support - grocery cards for mentee households",
    "6450 Youth Program Activities", f"{LAFF}:L2", "Youth & Family ESL", sp["total"], receipt=sp,
    issue=dict(kind="restricted_use_advance_grant", status="blocked", clause=f"{LAFF} §4.1",
               note="Eight $50 grocery gift cards charged to the advance-paid foundation grant, which prohibits cash "
                    "equivalents including gift cards. Must be moved off LAFF (no invoice involved)."))
sp = rcpt("2026-09-12_pinecrest-lanes", "Pinecrest Lanes", date(2026, 9, 12),
          [nontax("Lane rental, per lane-hour", 4, 3200), nontax("Shoe rental", 14, 450)], kind="png",
          notes=["Group: Bridges youth mentoring (12 youth, 2 mentors)"])
add(date(2026, 9, 12), "Expense", "", "Pinecrest Lanes", "Mentoring group outing - bowling", "6450 Youth Program Activities",
    f"{LAFF}:L2", "Youth & Family ESL", sp["total"], receipt=sp, tag="tricky:outing looks like entertainment, allowed by LAFF 4.4")
sp = rcpt("2026-10-17_riverbend-museum", "Riverbend Science Museum", date(2026, 10, 17),
          [nontax("Youth group admission", 12, 1400), nontax("Chaperone admission (complimentary)", 2, 0)],
          notes=["School/youth group rate"])
add(date(2026, 10, 17), "Expense", "", "Riverbend Science Museum", "Mentoring group - museum visit",
    "6450 Youth Program Activities", f"{LAFF}:L2", "Youth & Family ESL", sp["total"], receipt=sp)


# ---- month-end JEs: fringe + indirect ------------------------------------------------
def month_rows(m, prefix):
    return [r for r in rows if r["date"].month == m and r["date"].year == 2026 and r["cls"].startswith(prefix)]


MONTH_END = {7: date(2026, 7, 31), 8: date(2026, 8, 31), 9: date(2026, 9, 30), 10: date(2026, 10, 31)}
for m, d in MONTH_END.items():
    a1 = sum(r["cents"] for r in month_rows(m, f"{NONA}:A1"))
    other = sum(r["cents"] for r in rows if r["date"].month == m and r["ttype"] == "Paycheck"
                and not r["cls"].startswith(f"{NONA}:"))
    fr_n = rhu(a1 * FRINGE_BP / 10000)
    assert fr_n <= a1 * 24 // 100
    add(d, "Journal Entry", f"JE-FR-{m:02d}", "", f"Fringe allocation {d:%b %Y} - 22% of A1 wages",
        "6100 Payroll Taxes & Benefits", f"{NONA}:A2", "Resettlement Services", fr_n, split="2100 Payroll Liabilities")
    add(d, "Journal Entry", f"JE-FR-{m:02d}", "", f"Fringe allocation {d:%b %Y} - other staff",
        "6100 Payroll Taxes & Benefits", "General", "Administration", rhu(other * FRINGE_BP / 10000),
        split="2100 Payroll Liabilities")

IDC = {}
for m, d in MONTH_END.items():
    nr = [r for r in month_rows(m, f"{NONA}:") if not r["cls"].endswith(":A9")]
    mtdc = sum(r["cents"] for r in nr if r["cls"].split(":")[1] in ("A1", "A2", "A4", "A5", "A6", "A8"))
    tdc = sum(r["cents"] for r in nr)
    allowed = rhu(mtdc * IDC_RATE_BP / 10000)
    if m == 9:
        booked = rhu(tdc * IDC_RATE_BP / 10000)
        memo = f"Indirect 10% x {d:%b} direct costs {money(tdc)}"
        issue = dict(kind="indirect_wrong_base", status="blocked", clause=f"{NONA} §10.1-10.3", blocked=booked - allowed,
                     note=f"Indirect computed on total direct costs {money(tdc)} (includes A3 client assistance and A7 "
                          f"equipment). Allowed = 10% x MTDC {money(mtdc)} = {money(allowed)}; excess {money(booked - allowed)}.")
    else:
        booked, memo, issue = allowed, f"Indirect 10% x {d:%b} MTDC {money(mtdc)}", None
    IDC[m] = (mtdc, tdc, allowed, booked)
    add(d, "Journal Entry", f"JE-IDC-{m:02d}", "", memo, "6900 Indirect Cost Allocation", f"{NONA}:A9", "Administration",
        booked, split="6990 Indirect Cost Recovery", issue=issue)

rows.sort(key=lambda r: (r["date"], r["ttype"] != "Paycheck", r["num"], r["name"], r["cls"]))


# ----------------------------------------------------------------------------- receipts render
def render_pdf_receipt(sp):
    lines = []
    lines.append(("B", sp["vendor"]))
    lines.append(("", sp["address"]))
    lines.append(("", ""))
    lines.append(("B", sp["doc"]))
    lines.append(("", f"No. {sp['number']}"))
    lines.append(("", f"Date: {mdy(sp['date'])}"))
    if sp["bill_to"]:
        lines.append(("", f"Bill to: {ORG}"))
        lines.append(("", ORG_ADDR))
    if sp["service"]:
        lines.append(("", sp["service"]))
    lines.append(("", "-" * 52))
    for desc, q, u, *t in sp["items"]:
        lines.append(("I", (desc, q, u, q * u)))
    lines.append(("", "-" * 52))
    lines.append(("T", ("Subtotal", sp["sub"])))
    lines.append(("T", (f"Sales tax {TAX_BP / 100:.2f}%", sp["tax"])))
    lines.append(("TB", ("TOTAL", sp["total"])))
    lines.append(("", ""))
    lines.append(("", f"Payment: {sp['payment']}"))
    for n in sp["notes"]:
        lines.append(("", n))
    lines.append(("", ""))
    lines.append(("", "Thank you!"))
    W, H = 4.6 * inch, (2.0 + 0.22 * len(lines) + 0.3 * sum(1 for k, _ in lines if k == "I")) * inch
    path = f"{OUT}/{sp['file']}"
    c = canvas.Canvas(path, pagesize=(W, H), invariant=1)
    c.setTitle(f"{sp['vendor']} {sp['doc'].lower()} {sp['number']}")
    c.setFillColor(colors.red)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(14, H - 18, LABEL)
    c.setFillColor(colors.black)
    y = H - 42
    for k, v in lines:
        if k == "B":
            c.setFont("Helvetica-Bold", 11)
            c.drawString(14, y, v)
        elif k == "I":
            desc, q, u, ext = v
            c.setFont("Helvetica", 8.5)
            c.drawString(14, y, desc[:60])
            y -= 12
            c.drawString(26, y, f"{q} @ {u / 100:,.2f}")
            c.drawRightString(W - 14, y, f"{ext / 100:,.2f}")
        elif k in ("T", "TB"):
            c.setFont("Helvetica-Bold" if k == "TB" else "Helvetica", 9.5)
            c.drawString(150, y, v[0])
            c.drawRightString(W - 14, y, f"{v[1] / 100:,.2f}")
        else:
            c.setFont("Helvetica", 8.5)
            c.drawString(14, y, v)
        y -= 14
    c.setFont("Helvetica-Oblique", 7)
    c.setFillColor(colors.grey)
    c.drawString(14, 12, LABEL)
    c.showPage()
    c.save()


def render_png_receipt(sp):
    try:
        font = ImageFont.load_default(size=17)
        big = ImageFont.load_default(size=21)
    except TypeError:  # very old Pillow
        font = big = ImageFont.load_default()
    txt = [(big, sp["vendor"]), (font, sp["address"]), (font, ""), (big, sp["doc"]), (font, f"No. {sp['number']}"),
           (font, f"Date: {mdy(sp['date'])}"), (font, "-" * 40)]
    for desc, q, u, *t in sp["items"]:
        txt.append((font, desc[:44]))
        txt.append((font, f"   {q} @ {u / 100:,.2f}    {q * u / 100:>10,.2f}"))
    txt += [(font, "-" * 40), (font, f"Subtotal          {sp['sub'] / 100:>10,.2f}"),
            (font, f"Tax {TAX_BP / 100:.2f}%         {sp['tax'] / 100:>10,.2f}"),
            (big, f"TOTAL  {sp['total'] / 100:,.2f}"), (font, ""), (font, f"Payment: {sp['payment']}")]
    txt += [(font, n) for n in sp["notes"]] + [(font, ""), (font, "SYNTHETIC - generated for testing")]
    W, H = 560, 70 + 27 * len(txt)
    img = Image.new("RGB", (W, H), (246, 243, 236))
    dr = ImageDraw.Draw(img)
    dr.text((20, 16), "SYNTHETIC - generated for testing", fill=(200, 0, 0), font=font)
    y = 50
    for f, s in txt:
        dr.text((20, y), s, fill=(30, 30, 30), font=f)
        y += 27
    bg = Image.new("RGB", (W + 80, H + 80), (120, 110, 100))
    bg.paste(img, (40, 40))
    bg = bg.rotate(1.8, resample=Image.BICUBIC, fillcolor=(120, 110, 100))
    bg.save(f"{OUT}/{sp['file']}", format="PNG", optimize=False)


# ----------------------------------------------------------------------------- answer key
def gl_ref(r):
    return dict(date=mdy(r["date"]), num=r["num"], name=r["name"], amount=amt(r["cents"]))


def build_key():
    issues, clean = [], []
    n = 0
    for r in rows:
        if r["issue"]:
            n += 1
            it = r["issue"]
            e = dict(id=f"H3-{n:02d}", kind=it["kind"], glRef=gl_ref(r), cls=r["cls"], expectedStatus=it["status"],
                     clause=it["clause"], note=it["note"])
            if it["status"] == "blocked":
                e["blockedCents"] = it.get("blocked", r["cents"])
            if it["kind"] == "split_allocation_mismatch":
                e["relatedRefs"] = [dict(gl_ref(r_laff_split), cls=r_laff_split["cls"])]
            issues.append(e)
        elif r["cls"] != "General" and r["tag"] != "related":
            c = dict(date=mdy(r["date"]), num=r["num"], name=r["name"], amount=amt(r["cents"]), **{"class": r["cls"]})
            if r["tag"] and r["tag"].startswith("tricky:"):
                c["note"] = r["tag"][7:]
            clean.append(c)
    conv = ("Package = all GL rows with Class NONA-27-0193:* dated in the period (GL date month). Clean and needs_review "
            "rows count at booked amount; blocked rows are excluded in full, except line_overrun / indirect_wrong_base / "
            "unallowable_line_item where only blockedCents (the excess / unallowable portion, alcohol incl. its 7.25% tax) "
            "is excluded. Allowed indirect = 10% of that month's booked MTDC (A1,A2,A4,A5,A6,A8 at booked amounts, not "
            "reduced for other findings). A6 overrun measured on cumulative booked A6 since 07/01/2026 vs $1,200 x 110%.")
    packages = []
    for m in (7, 8, 9, 10):
        tot = 0
        for r in rows:
            if r["date"].month != m or not r["cls"].startswith(f"{NONA}:"):
                continue
            it = r["issue"]
            if it and it["status"] == "blocked":
                tot += r["cents"] - it.get("blocked", r["cents"])
            else:
                tot += r["cents"]
        packages.append(dict(grant=NONA, period=f"2026-{m:02d}", expectedInvoiceTotalCents=tot, conventions=conv))
    return dict(version="holdout-v3", seed=SEED, org=ORG,
                grants=[dict(id=NONA, funder=AGENCY, basis="cost_reimbursement", billing="monthly", total=amt(NONA_TOTAL)),
                        dict(id=LAFF, funder=FOUND, basis="advance", billing="none (semiannual report)",
                             total=amt(LAFF_TOTAL))],
                statusConvention="blocked = cannot be billed as-is (prohibited, missing prior approval, over line cap, "
                                 "excess indirect, out of period; partial where blockedCents given). needs_review = "
                                 "documentation gap or question (missing/mismatched receipt, purpose unclear, duplicate, "
                                 "payroll allocation, split allocation).",
                issues=issues, clean=clean, packages=packages,
                notes=["No packages for LAFF-2026-14 (advance-paid). The LAFF gift-card issue is a restriction finding only.",
                       "Fringe JE is 22% of booked A1 wages incl. the over-allocated paycheck; under the 24% cap, so clean.",
                       "General-class rows are unrestricted and not listed in clean."])


# ----------------------------------------------------------------------------- writers
def write_gl():
    with open(f"{OUT}/gl_transaction_detail_by_account.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow([ORG])
        w.writerow(["Transaction Detail by Account"])
        w.writerow(["July 1 - October 31, 2026"])
        w.writerow([])
        w.writerow(["Date", "Transaction Type", "Num", "Name", "Memo/Description", "Account", "Class", "Location",
                    "Split", "Amount"])
        for r in sorted(rows, key=lambda r: (r["account"], r["date"], r["num"], r["cls"])):
            w.writerow([mdy(r["date"]), r["ttype"], r["num"], r["name"], r["memo"], r["account"], r["cls"], r["loc"],
                        r["split"], amt(r["cents"])])
        w.writerow([])
        w.writerow([f"{LABEL}. Accrual basis. Fictional data."])


def write_bank():
    out = [(date(2026, 7, 6), f"DEPOSIT {FOUND.upper()}", 4500000, f"Grant {LAFF} installment 1 (advance)")]
    for pd in PAYDATES:
        tot = sum(r["cents"] for r in rows if r["ttype"] == "Paycheck" and r["date"] == pd)
        out.append((pd, "LEDGERLINE PAYROLL FUNDING", -tot, f"Payroll {mdy(pd)}"))
    seen = set()
    for r in rows:
        key = (r["date"], r["num"], r["name"])
        if r["ttype"] in ("Expense", "Check") and r["split"] == CHECKING and key not in seen:
            seen.add(key)
            tot = sum(x["cents"] for x in rows if (x["date"], x["num"], x["name"]) == key and x["ttype"] == r["ttype"])
            if r["ttype"] == "Check":
                desc, d = f"CHECK {r['num']}", date.fromordinal(r["date"].toordinal() + rng.randint(2, 6))
            elif r["account"] == "6850 Bank Fees":
                desc, d = "MONTHLY SERVICE FEE", r["date"]
            elif r["num"].startswith("ACH"):
                desc, d = f"ACH DEBIT {r['name'].upper()}", r["date"]
            else:
                desc, d = f"DEBIT CARD PURCHASE {r['name'].upper()[:28]}", date.fromordinal(r["date"].toordinal() + 1)
            out.append((d, desc, -tot, ""))
    for r in rows:  # bill payments (bills paid ~2 weeks later; Aug Lumen paid by the duplicate check instead)
        if r["ttype"] == "Bill" and r["num"] != "LIG-2291":
            d = date.fromordinal(r["date"].toordinal() + 15)
            if d <= date(2026, 10, 31):
                out.append((d, f"BILL PMT {r['name'].upper()}", -r["cents"], f"Inv {r['num']}"))
    out.sort(key=lambda x: (x[0], x[1]))
    with open(f"{OUT}/bank_statement.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["Posting Date", "Description", "Amount", "Memo"])
        for d, desc, c, memo in out:
            w.writerow([mdy(d), desc, amt(c), memo])


def write_misc():
    with open(f"{OUT}/staff_allocation.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["employee", "role", "biweekly_gross_usd", "allocation"])
        for emp, role, gross, alloc, _ in STAFF:
            a = ";".join(f"{'UNRESTRICTED' if c == 'General' else c}={p}%" for c, p in alloc)
            w.writerow([emp, role, amt(gross), a])
    prec = [dict(date="2026-07-22", by=f"D. Varga, Contract Officer, {AGENCY}",
                 ruling="Prior written approval PA-2026-03 granted for purchase of one multifunction copier/printer, "
                        "not to exceed $3,000.00 including delivery and setup, chargeable to line A7.",
                 scope=f"{NONA}:A7")]
    with open(f"{OUT}/precedents.json", "w") as f:
        json.dump(prec, f, indent=2)
    with open(f"{OUT}/README.md", "w") as f:
        f.write(f"""# Steward hold-out v3 (SEALED)

**{LABEL}.** Every organization, agency, foundation, person, vendor, address and amount here is fictional.
Do not open this set while changing detection logic; score it once.

Org: {ORG} (refugee resettlement). Period: July-October 2026.

| File | What |
|---|---|
| `contract_NONA-27-0193_state_new_americans.pdf` | Fictional state agency contract, cost-reimbursement, monthly invoices |
| `grant_LAFF-2026-14_linden_ash_foundation.pdf` | Fictional foundation grant paid in advance, semiannual report, no invoices |
| `gl_transaction_detail_by_account.csv` | QuickBooks Online "Transaction Detail by Account" export ({len(rows)} lines) |
| `receipts/` | {len(receipts)} receipts/invoices (PDF, plus a few PNG photos) |
| `bank_statement.csv` | Checking account activity |
| `staff_allocation.csv` | Payroll allocation on file |
| `precedents.json` | Funder rulings on file |
| `expected_v3.json` | Answer key (issues, clean lines, expected invoice package totals). Scorer-only. |

Regenerate: `uv run --with reportlab --with faker python scripts/generate_holdout_v3.py` (deterministic, seed {SEED}).
""")


def zip_dir():
    files = []
    for dp, _, fns in os.walk(OUT):
        for fn in fns:
            files.append(os.path.relpath(os.path.join(dp, fn), OUT))
    files.sort()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for rel in files:
            zi = zipfile.ZipInfo(f"steward-holdout-v3/{rel}", date_time=(2026, 11, 1, 0, 0, 0))
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            with open(os.path.join(OUT, rel), "rb") as fh:
                z.writestr(zi, fh.read())
    data = buf.getvalue()
    with open(ZIP, "wb") as fh:
        fh.write(data)
    return hashlib.sha256(data).hexdigest()


def main():
    if os.path.exists(OUT):
        shutil.rmtree(OUT)
    os.makedirs(f"{OUT}/receipts")
    write_contracts()
    for sp in receipts:
        (render_png_receipt if sp["kind"] == "png" else render_pdf_receipt)(sp)
    write_gl()
    write_bank()
    write_misc()
    key = build_key()
    with open(f"{OUT}/expected_v3.json", "w") as f:
        json.dump(key, f, indent=2)
    digest = zip_dir()
    if "--keep" not in sys.argv:
        shutil.rmtree(OUT)
    print(f"gl_lines={len(rows)} receipts={len(receipts)} "
          f"png={sum(1 for s in receipts if s['kind'] == 'png')} issues={len(key['issues'])} clean={len(key['clean'])}")
    print(f"sha256 {digest}  {os.path.relpath(ZIP, ROOT)}")


if __name__ == "__main__":
    main()
