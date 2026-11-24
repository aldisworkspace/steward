# Product

<!-- impeccable:product-schema 1 -->

> Written from the lead's design brief (no live interview was possible in this session). Every fact below comes from that brief or the codebase; nothing is invented.

## Platform

web

## Users

- **Preparer** (junior staff accountant) compiles the monthly billing package for a city cost-reimbursement contract or foundation grant.
- **Reviewer** (senior accountant / executive director / controller) signs the package. Wants to look only at exceptions.
- **Program approver** (program director) confirms charges were for their program.

## Product Purpose

Steward prepares a billing package (invoice + expenditure report) per grant and billing period that ties out to the cent. A one-cent error returns the whole batch. Success: the reviewer reviews only exceptions and signs a package whose checks all pass.

## Positioning

Steward proposes; deterministic rules verify; humans approve. It reads the contract, the GL detail, receipts and (optionally) the bank statement. Steward never signs, posts or moves money.

## Operating Context

Monthly close for nonprofits on city cost-reimbursement contracts. Inputs: GL detail CSV (QuickBooks / Xero / Sage), receipts (PDF/images), contract PDFs, optional bank statement. Output: signed package, CSV export, printed PDF with a signature block.

## Capabilities and Constraints

- Packages flow draft → ready for review (preparer) → signed (reviewer, only when all 7 tie-out checks pass; preparer ≠ reviewer) → exported.
- Roles are name-based until real authentication lands.
- Demo data is synthetic and must be labelled as such whenever it is loaded.
- Money is integer cents; format only at the UI.

## Evidence on Hand

Synthetic v2 dataset in `steward-data-v2/` (GL detail, bank statement, two contracts, 36 receipts). No real customers, testimonials or statistics: never invent them.

## Product Principles

1. Show exceptions, not everything. Clean lines stay quiet.
2. Every number ties out to the cent and shows its working.
3. Steward proposes, a named person decides, and the audit trail says who.
4. Irreversible steps (sign, reopen, export) are explicit and confirmed.
5. Plain English first; jargon only behind a definition.

## Accessibility & Inclusion

WCAG 2.2 AA: text contrast ≥ 4.5:1, visible focus, keyboard operation (J/K/A/O in Review), tap targets ≥ 44px on mobile, respects reduced motion.
