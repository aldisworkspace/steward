# steward-data-v2 — demo set

> **SYNTHETIC — generated for testing.** Every organization, agency, foundation, person, address, phone number, receipt and amount in
> this folder is fictional. (A few common retailer names appear only as vendor labels on fabricated receipts.)

Development / tuning set for Steward v2: check a nonprofit's **GL detail + receipts** against its grant
contracts and build a monthly invoice + expenditure report that ties out to the cent.

- Organization: **Calle Nueva Family Center** (fictional), fiscal year July 2026 – June 2027, billing months
  July – October 2026.
- `contract_city_FS-27-0412.pdf` — City of Port Calloway (fictional) cost-reimbursement contract, $240,000, monthly
  invoices, Exhibit A line-item budget C1–C7.
- `grant_foundation_RF-26-118.pdf` — Thistlewick Foundation (fictional) restricted grant, $50,000, lines F1–F4, quarterly
  reporting.
- `gl_detail_qb.csv`, `receipts/`, `bank_statement.csv`, `staff_allocation.csv`, `precedents.json` — see below.
- `expected_v2.json` — answer key for evaluation. **Planted issues are listed in expected_v2.json.** The app must
  never read it.

## `gl_detail_qb.csv` conventions

Flattened QuickBooks Online **Transaction Detail by Account** export (report range 06/01/2026–10/31/2026).
The account group header rows and "Total for …" subtotal rows that QuickBooks prints were removed; every
row is one posting line. Rows are sorted by Account, then Date.

| Column | Meaning |
|---|---|
| `Date` | Transaction date, `MM/DD/YYYY` |
| `Transaction Type` | `Paycheck`, `Expense` (card), `Check`, `Bill`, `Credit Card Credit`, `Journal Entry` |
| `Num` | Check number, vendor bill/invoice number, paycheck number (`DD…`), JE number, or card reference. Often blank for card expenses. |
| `Name` | Vendor, or employee for paychecks and mileage checks; blank on journal entries |
| `Memo/Description` | Line memo as typed by staff — often terse or empty |
| `Account` | Expense account (number + name) |
| `Class` | Funding source and budget line, `GRANT-ID:LINE` (e.g. `FS-27-0412:C3`), or `General` for unrestricted |
| `Location` | Department / program |
| `Split` | The other side of the posting: payment account for single-line transactions, `-Split-` when one transaction is spread over several lines (e.g. one receipt split across grants and General), the AP account for Bills, the offset account for journal entries |
| `Amount` | Signed amount of this posting line, 2 decimals, no currency symbol or thousands separator. **Sign convention:** as QuickBooks shows it for expense accounts — debits (costs) are **positive**, credits such as refunds/returns (`Credit Card Credit`) are **negative**. |

One vendor receipt can correspond to several GL rows (same Date, Name, Transaction Type and Num, `Split = -Split-`);
the receipt total equals the sum of those rows. Payroll rows are one per employee per class per pay date.
Fringe and indirect are monthly journal entries dated the last day of the month.

## Other files

- `receipts/` — vendor receipts and invoices for non-payroll charges (PDF; a few are PNG phone photos).
  Filenames are `YYYY-MM-DD_vendor-slug_NNNN.ext` where NNNN is the receipt/invoice number printed on the
  document (not a GL row id). Receipt dates are purchase dates; vendor names on receipts may differ slightly from
  the GL `Name` (e.g. "Costco Wholesale" vs "Costco").
- `bank_statement.csv` — `Posting Date,Description,Amount,Memo`. Bank-style uppercase descriptors with no purpose
  information. Debits **negative**, credits positive. Payroll appears as one ACH line per pay date at total gross
  (a simplification). Bills appear when paid by check.
- `staff_allocation.csv` — `employee,role,biweekly_gross_usd,allocation`; allocation is
  `GRANT:LINE=%;…;UNRESTRICTED=%` and is the approved share of each paycheck per funding line.
- `precedents.json` — prior rulings from funders/approvers: `date, by, ruling, scope`.

## Regenerate

```bash
uv run --with reportlab --with faker python scripts/generate_v2.py
```

Deterministic (fixed seeds, reportlab invariant mode). Also rebuilds the sealed hold-out zip (`steward-holdout-v2-SEALED.zip`); do not unzip it while tuning.
