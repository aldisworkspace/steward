#!/usr/bin/env python3
"""
Generate the SYNTHETIC Steward v2 datasets (GL detail + receipts vs grant contracts).

    uv run --with reportlab --with faker python scripts/generate_v2.py

Outputs (all fictional, labelled "SYNTHETIC — generated for testing"):
  steward-data-v2/                 demo / development set (Calle Nueva Family Center)
  steward-holdout-v2-SEALED.zip    sealed hold-out set (Northfen Youth Athletics League);
                                   the unzipped steward-holdout-v2/ folder is deleted after zipping.

Deterministic: fixed seeds, reportlab invariant mode, fixed zip timestamps.
Money is handled in integer cents end to end; output only as 2-decimal strings or *Cents ints.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import shutil
import sys
import zipfile
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path
import random

from faker import Faker
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from reportlab import rl_config

rl_config.invariant = 1  # no timestamps / random IDs inside PDFs

from reportlab.lib import colors  # noqa: E402
from reportlab.lib.pagesizes import letter  # noqa: E402
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet  # noqa: E402
from reportlab.lib.units import inch  # noqa: E402
from reportlab.pdfgen import canvas as rl_canvas  # noqa: E402
from reportlab.platypus import (  # noqa: E402
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parent.parent
SYNTH = "SYNTHETIC — generated for testing"
MONTHS = ["", "January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]
MON = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


# --------------------------------------------------------------------------- money helpers
def rdiv(n: int, d: int) -> int:
    """Integer division rounded half up (symmetric for negatives)."""
    if n < 0:
        return -rdiv(-n, d)
    return (2 * n + d) // (2 * d)


def fmt(c: int) -> str:
    s = "-" if c < 0 else ""
    c = abs(c)
    return f"{s}{c // 100}.{c % 100:02d}"


def usd(c: int) -> str:
    s = "-" if c < 0 else ""
    c = abs(c)
    return f"{s}${c // 100:,}.{c % 100:02d}"


def pct(c: int, bp: int) -> int:
    return rdiv(c * bp, 10000)


def split_weights(total: int, weights: list[int]) -> list[int]:
    """Largest-remainder split of `total` cents proportional to integer weights."""
    W = sum(weights)
    raw = [total * w for w in weights]
    out = [r // W for r in raw]
    rem = total - sum(out)
    order = sorted(range(len(weights)), key=lambda i: (-(raw[i] % W), i))
    for i in order[:rem]:
        out[i] += 1
    return out


def d2(d: date) -> str:
    return d.strftime("%m/%d/%Y")


def iso(d: date) -> str:
    return d.isoformat()


def esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def month_end(y: int, m: int) -> date:
    return (date(y + (m == 12), m % 12 + 1, 1) - timedelta(days=1))


def D(s: str) -> date:
    return date.fromisoformat(s)


# --------------------------------------------------------------------------- data classes
@dataclass
class Receipt:
    kind: str                      # retail | restaurant | invoice
    vendor: dict
    date: date
    number: str
    items: list                    # (desc, qty, unit_cents)
    subtotal: int
    tax: int
    tax_bp: int
    tip: int
    fees: list                     # (desc, cents) untaxed
    total: int
    payment: str
    fmt: str = "pdf"               # pdf | png | none
    filename: str = ""
    time_str: str = ""
    extra: dict = field(default_factory=dict)


@dataclass
class Row:
    seq: int
    date: date
    ttype: str
    num: str
    name: str
    memo: str
    account: str
    cls: str
    location: str
    split: str
    amount: int
    txn: int
    kind: str                      # payroll | fringe | indirect | purchase
    meta: dict = field(default_factory=dict)

    def ref(self) -> dict:
        return {"date": iso(self.date), "num": self.num, "name": self.name,
                "amount": fmt(self.amount), "class": self.cls, "account": self.account}


@dataclass
class Txn:
    id: int
    date: date
    ttype: str
    num: str
    name: str
    vendor_key: str
    rows: list
    receipt: Receipt | None
    total: int


class Ctx:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.rng = random.Random(cfg["seed"])
        self.fake = Faker("en_US")
        self.fake.seed_instance(cfg["seed"])
        self.rows: list[Row] = []
        self.txns: list[Txn] = []
        self.bank: list[tuple] = []
        self.issues: list[dict] = []
        self.receipt_nums: set[str] = set()
        self.filenames: set[str] = set()
        self.seq = 0
        self.check_no = cfg["check_start"]
        self.dd_no = cfg["dd_start"]
        self.vendors = {}

    # ---- helpers
    def next_check(self) -> str:
        self.check_no += 1
        return str(self.check_no)

    def rnum(self, lo=1000, hi=9999, prefix="") -> str:
        while True:
            n = f"{prefix}{self.rng.randint(lo, hi)}"
            if n not in self.receipt_nums:
                self.receipt_nums.add(n)
                return n

    def add_row(self, **kw) -> Row:
        self.seq += 1
        r = Row(seq=self.seq, **kw)
        self.rows.append(r)
        return r

    def issue(self, iid, kind, rule, status, note, row: Row, related=(), evidence=None, extra=None):
        e = {"id": iid, "kind": kind, "glRef": row.ref(), "expectedRule": rule,
             "expectedStatus": status, "note": note}
        if related:
            e["relatedRefs"] = [r.ref() for r in related]
        if evidence:
            e["evidence"] = evidence
        if extra:
            e.update(extra)
        row.meta["issue"] = iid
        row.meta["status"] = status
        row.meta["kind"] = kind
        for r in related:
            r.meta.setdefault("related", iid)
        self.issues.append(e)
        return e


# --------------------------------------------------------------------------- vendors
def make_vendor(ctx: Ctx, key, display, gl_name, slug, kind, bank, tax_bp=0, catalog=(), terms="",
                city=None):
    f = ctx.fake
    city = city or ctx.cfg["city_line"]
    v = {
        "key": key, "display": display, "gl_name": gl_name, "slug": slug, "kind": kind,
        "bank": bank, "tax_bp": tax_bp, "catalog": list(catalog), "terms": terms,
        "addr": [f"{ctx.rng.randint(100, 9899)} {f.last_name()} "
                 f"{ctx.rng.choice(['Street', 'Avenue', 'Boulevard', 'Way', 'Road', 'Court'])}", city],
        "phone": f"(555) 555-01{ctx.rng.randint(10, 99)}",
        "store": f"#{ctx.rng.randint(100, 2999):04d}",
    }
    ctx.vendors[key] = v
    return v


def price(rng, lo, hi):
    u = rng.randint(lo, hi)
    return (u // 100) * 100 + rng.choice([99, 49, 29, 79, 0, 99, 89])


def build_items(rng, catalog, S, must=()):
    """Return items (desc, qty, unit) whose extended total is exactly S cents."""
    must = list(must)
    base = sum(q * u for _, q, u in must)
    B = S - base
    assert B > 0, (S, must)
    cat = [c for c in catalog if c[0] not in {m[0] for m in must}]
    for attempt in range(2000):
        hi_n = max(0, min(4, len(cat) - 1))
        n_other = rng.randint(0, min(1, hi_n)) if B < 2500 else rng.randint(min(1, hi_n), hi_n)
        pool = rng.sample(cat, n_other + 1)
        others, last = pool[:-1], pool[-1]
        items = list(must)
        target_others = B * rng.randint(45, 80) // 100 if others else 0
        used = 0
        if others:
            ws = [rng.randint(1, 5) for _ in others]
            shares = split_weights(target_others, ws)
            for (desc, lo, hi), share in zip(others, shares):
                u = price(rng, lo, hi)
                q = max(1, min(80, rdiv(share, u)))
                items.append((desc, q, u))
                used += q * u
        rem = B - used
        if rem < 150:
            continue
        desc, lo, hi = last
        mid = (lo + hi) // 2
        want = max(1, rdiv(rem, mid))
        chosen = None
        for q in sorted(range(max(1, want - 4), want + 5), key=lambda q: abs(q - want)):
            if rem % q == 0 and lo // 2 <= rem // q <= hi * 2:
                chosen = q
                break
        if chosen is None:
            if lo // 2 <= rem <= hi * 3:
                chosen = 1
            else:
                continue
        items.append((desc, chosen, rem // chosen))
        assert sum(q * u for _, q, u in items) == S
        return items
    raise RuntimeError(f"could not build items for {S}")


def build_receipt(ctx: Ctx, v: dict, d: date, target: int, *, exact=None, must=(), kind=None,
                  number=None, payment="CARD ****{card}", tip_bp=1800, fees=()) -> Receipt:
    rng = ctx.rng
    kind = kind or v["kind"]
    tax_bp = v["tax_bp"]
    fees = list(fees)
    fee_total = sum(c for _, c in fees)
    tip = 0
    if exact is None:
        target += rng.randint(-140, 140)  # avoid suspiciously round totals
    if exact is not None:
        items = list(exact)
        S = sum(q * u for _, q, u in items)
        tax = pct(S, tax_bp)
    elif kind == "restaurant":
        S = rdiv((target - fee_total) * 10000, 10000 + tax_bp + tip_bp)
        items = build_items(rng, v["catalog"], S, must)
        tax = pct(S, tax_bp)
        tip = pct(S, tip_bp)
    else:
        S = rdiv((target - fee_total) * 10000, 10000 + tax_bp)
        items = build_items(rng, v["catalog"], S, must)
        tax = pct(S, tax_bp)
    total = S + tax + tip + fee_total
    if number is None:
        number = ctx.rnum()
    hh = rng.randint(9, 19) if kind != "restaurant" else rng.randint(17, 21)
    r = Receipt(kind=kind, vendor=v, date=d, number=number, items=items, subtotal=S, tax=tax,
                tax_bp=tax_bp, tip=tip, fees=fees, total=total,
                payment=payment.format(card=ctx.cfg["card_last4"]),
                time_str=f"{hh:02d}:{rng.randint(0, 59):02d}")
    return r


# --------------------------------------------------------------------------- transactions
def purchase(ctx: Ctx, ds: str, vkey: str, rows, *, ttype="Expense", num=None, receipt="pdf",
             gl_delta=0, receipt_date=None, exact=None, must=(), fees=(), rkind=None, name=None,
             bank=True, tip_bp=1800, inv_number=None, pay=None):
    """rows: list of (class, account, location, target_cents, memo). Returns Txn."""
    d = D(ds)
    v = ctx.vendors[vkey]
    targets = [r[3] for r in rows]
    T = sum(targets)
    if ttype == "Bill":
        number = inv_number or ctx.rnum(prefix=v.get("inv_prefix", ""))
        payment = v["terms"] or "Terms: Net 30"
    else:
        number = inv_number or ctx.rnum()
        payment = "CARD ****{card}" if ttype in ("Expense", "Credit Card Credit") else "PAID BY CHECK"
    rec = build_receipt(ctx, v, D(receipt_date) if receipt_date else d, T, exact=exact, must=must,
                        kind=rkind, number=number, payment=payment, tip_bp=tip_bp, fees=fees)
    gl_total = rec.total + gl_delta
    if exact is not None and sum(targets) == gl_total:
        amounts = targets
    else:
        amounts = split_weights(gl_total, targets) if len(rows) > 1 else [gl_total]
    if ttype == "Credit Card Credit":
        amounts = [-a for a in amounts]
        gl_total = -gl_total
    if num is None:
        if ttype == "Bill":
            num = number
        elif ttype == "Check":
            num = ctx.next_check()
        else:
            num = str(ctx.rng.randint(1000, 9999)) if ctx.rng.random() < 0.35 else ""
    pay_acct = {"Expense": ctx.cfg["card_acct"], "Credit Card Credit": ctx.cfg["card_acct"],
                "Check": ctx.cfg["checking_acct"], "Bill": "2000 Accounts Payable"}[ttype]
    if pay == "checking":
        pay_acct = ctx.cfg["checking_acct"]
    split = pay_acct if len(rows) == 1 else "-Split-"
    tid = len(ctx.txns) + 1
    gl_name = name or v["gl_name"]
    out_rows = []
    for (cls, acct, loc, _t, memo), amt in zip(rows, amounts):
        out_rows.append(ctx.add_row(date=d, ttype=ttype, num=num, name=gl_name, memo=memo,
                                    account=acct, cls=cls, location=loc, split=split, amount=amt,
                                    txn=tid, kind="purchase", meta={"vendor": vkey}))
    if receipt in ("pdf", "png"):
        rec.fmt = receipt
        ext = receipt
        fname = f"{iso(rec.date)}_{v['slug']}_{rec.number.split('-')[-1]}.{ext}"
        assert fname not in ctx.filenames, fname
        ctx.filenames.add(fname)
        rec.filename = fname
    else:
        rec.fmt = "none"
    t = Txn(id=tid, date=d, ttype=ttype, num=num, name=gl_name, vendor_key=vkey, rows=out_rows,
            receipt=rec, total=gl_total)
    ctx.txns.append(t)
    for r in out_rows:
        r.meta["receipt"] = rec.filename or None
    if bank:
        rng = ctx.rng
        if pay == "checking" and ttype == "Expense":
            ctx.bank.append((d, v["bank"], -gl_total, ctx.cfg["checking_memo"]))
        elif ttype in ("Expense", "Credit Card Credit"):
            ctx.bank.append((d + timedelta(days=rng.randint(1, 2)), v["bank"], -gl_total,
                             f"Card x{ctx.cfg['card_last4']}"))
        elif ttype == "Check":
            ctx.bank.append((d + timedelta(days=rng.randint(2, 6)), f"CHECK {num}", -gl_total,
                             ctx.cfg["checking_memo"]))
        else:  # bill paid by check
            ctx.bank.append((d + timedelta(days=rng.randint(7, 14)), f"CHECK {ctx.next_check()}",
                             -gl_total, ctx.cfg["checking_memo"]))
    return t


def duplicate_txn(ctx: Ctx, t: Txn, ds: str, ttype=None) -> Txn:
    d = D(ds)
    tid = len(ctx.txns) + 1
    rows = []
    for r in t.rows:
        rows.append(ctx.add_row(date=d, ttype=ttype or r.ttype, num=r.num, name=r.name, memo=r.memo,
                                account=r.account, cls=r.cls, location=r.location,
                                split=(ctx.cfg["checking_acct"] if (ttype == "Check" and len(t.rows) == 1) else r.split),
                                amount=r.amount, txn=tid, kind="purchase",
                                meta={"vendor": t.vendor_key, "receipt": None}))
    nt = Txn(id=tid, date=d, ttype=ttype or t.ttype, num=t.num, name=t.name, vendor_key=t.vendor_key,
             rows=rows, receipt=None, total=t.total)
    ctx.txns.append(nt)
    return nt


def payroll(ctx: Ctx, pay_dates, employees, overrides):
    """employees: list of dict(name, role, gross, alloc=[(key, bp)], loc)."""
    acct = ctx.cfg["acct"]["salaries"]
    for pd in pay_dates:
        run_total = 0
        for e in employees:
            ov = overrides.get((pd, e["name"]), {})
            gross = ov.get("gross", e["gross"])
            alloc = ov.get("alloc", e["alloc"])
            alloc = [(k, bp) for k, bp in alloc if bp > 0]
            parts = split_weights(gross, [bp for _, bp in alloc])
            ctx.dd_no += 1
            num = f"DD{ctx.dd_no}"
            tid = len(ctx.txns) + 1
            rows = []
            for (k, bp), amt in zip(alloc, parts):
                cls = "General" if k == "UNRESTRICTED" else k
                memo = ""
                if ctx.rng.random() < 0.25:
                    memo = f"PPE {d2(pd - timedelta(days=6))[:5]}"
                rows.append(ctx.add_row(date=pd, ttype="Paycheck", num=num, name=e["name"], memo=memo,
                                        account=acct, cls=cls, location=e["loc"],
                                        split=ctx.cfg["checking_acct"] if len(alloc) == 1 else "-Split-",
                                        amount=amt, txn=tid, kind="payroll",
                                        meta={"employee": e["name"], "alloc_bp": bp, "gross": gross}))
            ctx.txns.append(Txn(id=tid, date=pd, ttype="Paycheck", num=num, name=e["name"],
                                vendor_key="payroll", rows=rows, receipt=None, total=gross))
            run_total += gross
        ctx.bank.append((pd, f"PAYROLL SVC ACH DEBIT PPE {pd.strftime('%m%d')}", -run_total, "ACH"))


def journal_rows(ctx: Ctx, d: date, num: str, memo: str, account: str, offset: str, cls_amounts, kind, loc):
    tid = len(ctx.txns) + 1
    rows = []
    for cls, amt in cls_amounts:
        if amt == 0:
            continue
        rows.append(ctx.add_row(date=d, ttype="Journal Entry", num=num, name="", memo=memo,
                                account=account, cls=cls, location=loc.get(cls, ctx.cfg["admin_loc"]),
                                split=offset, amount=amt, txn=tid, kind=kind, meta={}))
    ctx.txns.append(Txn(id=tid, date=d, ttype="Journal Entry", num=num, name="", vendor_key="je",
                        rows=rows, receipt=None, total=sum(a for _, a in cls_amounts)))
    return rows


def fringe_and_indirect(ctx: Ctx, months, plant_month, wrong_method):
    cfg = ctx.cfg
    c = cfg["contract"]
    base_cls = f"{c['id']}:{c['indirect_base']}"
    ind_cls = f"{c['id']}:{c['indirect_line']}"
    out = {}
    for (y, m) in months:
        me = month_end(y, m)
        sal = [r for r in ctx.rows if r.kind == "payroll" and (r.date.year, r.date.month) == (y, m)]
        # fringe
        by_cls = {}
        for r in sal:
            fc = cfg["fringe_map"][r.cls]
            by_cls[fc] = by_cls.get(fc, 0) + r.amount
        amounts = [(fc, pct(v, cfg["fringe_bp"])) for fc, v in sorted(by_cls.items())]
        journal_rows(ctx, me, f"JE-{y % 100:02d}{m:02d}-02", f"Employer taxes & benefits alloc {MON[m]}",
                     cfg["acct"]["fringe"], "2310 Accrued Payroll Liabilities", amounts, "fringe",
                     cfg["loc_by_class"])
        # indirect
        base_rows = [r for r in sal if r.cls == base_cls]
        base = sum(r.amount for r in base_rows)
        correct = pct(base, c["indirect_bp"])
        booked = correct
        if (y, m) == plant_month:
            if wrong_method == "dollar_rounded_base":
                wrong_base = sum(rdiv(r.amount, 100) * 100 for r in base_rows)
                booked = pct(wrong_base, c["indirect_bp"])
            elif wrong_method == "per_row_truncate":
                booked = sum(r.amount * c["indirect_bp"] // 10000 for r in base_rows)
            assert 2 <= abs(booked - correct) <= 25, (booked, correct)
        rows = journal_rows(ctx, me, f"JE-{y % 100:02d}{m:02d}-03",
                            f"Indirect {c['indirect_bp'] // 100}% - {MON[m]}", cfg["acct"]["indirect"],
                            "4900 Indirect Cost Recovery", [(ind_cls, booked)], "indirect",
                            cfg["loc_by_class"])
        out[(y, m)] = {"row": rows[0], "base": base, "correct": correct, "booked": booked}
    return out


# --------------------------------------------------------------------------- PDF: receipts
def receipt_lines(r: Receipt) -> list[dict]:
    v = r.vendor
    L = []
    L.append({"l": v["display"], "s": "h1", "c": True})
    for a in v["addr"]:
        L.append({"l": a, "s": "sm", "c": True})
    L.append({"l": v["phone"], "s": "sm", "c": True})
    if r.kind == "retail":
        L.append({"l": f"Store {v['store']}", "s": "sm", "c": True})
    L.append({"s": "rule"})
    L.append({"l": f"{d2(r.date)}  {r.time_str}", "r": f"#{r.number}"})
    if r.kind == "restaurant":
        L.append({"l": f"Server: {r.extra.get('server', 'K.')}", "r": f"Guests: {r.extra.get('guests', max(2, r.subtotal // 1400))}"})
    else:
        L.append({"l": f"Reg {r.extra.get('reg', 3)}  Cashier {r.extra.get('cashier', '041')}"})
    L.append({"s": "rule"})
    for desc, q, u in r.items:
        L.append({"l": desc[:30], "r": fmt(q * u)})
        if q > 1:
            L.append({"l": f"   {q} @ {fmt(u)}", "s": "sm"})
    L.append({"s": "rule"})
    L.append({"l": "SUBTOTAL", "r": fmt(r.subtotal)})
    if r.tax_bp:
        L.append({"l": f"TAX {r.tax_bp // 100}.{r.tax_bp % 100:02d}%", "r": fmt(r.tax)})
    for desc, c in r.fees:
        L.append({"l": desc.upper(), "r": fmt(c)})
    if r.tip:
        L.append({"l": "TIP", "r": fmt(r.tip)})
    L.append({"l": "TOTAL", "r": fmt(r.total), "s": "b"})
    L.append({"l": r.payment, "r": fmt(r.total)})
    L.append({"l": f"AUTH {r.extra.get('auth', '000000')}", "s": "sm"})
    L.append({"s": "rule"})
    L.append({"l": "THANK YOU", "s": "sm", "c": True})
    L.append({"l": SYNTH, "s": "sm", "c": True})
    L.append({"l": "Fictional receipt - not a real transaction", "s": "sm", "c": True})
    return L


def draw_receipt_pdf(path: Path, r: Receipt):
    L = receipt_lines(r)
    W = 3.2 * inch
    lh = {"h1": 15, "sm": 9.5, "b": 12, None: 11, "rule": 8}
    H = sum(lh.get(x.get("s")) for x in L) + 40
    c = rl_canvas.Canvas(str(path), pagesize=(W, H), invariant=1)
    c.setTitle(f"Receipt {r.number} - {r.vendor['display']} ({SYNTH})")
    c.setAuthor(SYNTH)
    y = H - 24
    m = 12
    for x in L:
        s = x.get("s")
        if s == "rule":
            c.setDash(2, 2)
            c.line(m, y + 3, W - m, y + 3)
            c.setDash()
            y -= lh["rule"]
            continue
        font = {"h1": ("Courier-Bold", 11), "sm": ("Courier", 6.5), "b": ("Courier-Bold", 9)}.get(s, ("Courier", 8))
        c.setFont(*font)
        if x.get("c"):
            c.drawCentredString(W / 2, y, x["l"])
        else:
            c.drawString(m, y, x.get("l", ""))
            if x.get("r"):
                c.drawRightString(W - m, y, x["r"])
        y -= lh.get(s)
    c.showPage()
    c.save()


def _font(size):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # very old Pillow
        return ImageFont.load_default()


def draw_receipt_png(path: Path, r: Receipt, angle: float, rng: random.Random):
    L = receipt_lines(r)
    W = 560
    lh = {"h1": 40, "sm": 24, "b": 32, None: 29, "rule": 20}
    H = sum(lh.get(x.get("s")) for x in L) + 70
    paper = Image.new("RGB", (W, H), (248, 245, 236))
    dr = ImageDraw.Draw(paper)
    fonts = {"h1": _font(30), "sm": _font(17), "b": _font(24), None: _font(21)}
    y = 30
    m = 26
    for x in L:
        s = x.get("s")
        if s == "rule":
            for xx in range(m, W - m, 12):
                dr.line([(xx, y + 8), (xx + 6, y + 8)], fill=(90, 90, 90), width=2)
            y += lh["rule"]
            continue
        f = fonts.get(s, fonts[None])
        x = {k: (v.replace("—", "-") if isinstance(v, str) else v) for k, v in x.items()}  # default font lacks em dash
        ink = (35, 35, 40)
        if x.get("c"):
            tw = dr.textlength(x["l"], font=f)
            dr.text(((W - tw) / 2, y), x["l"], font=f, fill=ink)
        else:
            dr.text((m, y), x.get("l", ""), font=f, fill=ink)
            if x.get("r"):
                tw = dr.textlength(x["r"], font=f)
                dr.text((W - m - tw, y), x["r"], font=f, fill=ink)
        y += lh.get(s)
    # phone-photo look: desk background, slight rotation, soft blur, light vignette band
    bg = (96, 82, 70)
    rot = paper.rotate(angle, resample=Image.BICUBIC, expand=True, fillcolor=bg)
    canvas_img = Image.new("RGB", (rot.width + 90, rot.height + 110), bg)
    shadow = Image.new("RGB", rot.size, (70, 58, 48))
    canvas_img.paste(shadow, (52, 64))
    canvas_img.paste(rot, (40, 48))
    band = Image.new("RGB", canvas_img.size, (255, 250, 230))
    mask = Image.linear_gradient("L").resize(canvas_img.size).point(lambda p: p // 9)
    canvas_img = Image.composite(band, canvas_img, mask)
    canvas_img = canvas_img.filter(ImageFilter.GaussianBlur(0.7))
    canvas_img.save(path, format="PNG")


def draw_invoice_pdf(path: Path, r: Receipt, org: dict):
    ss = getSampleStyleSheet()
    body = ParagraphStyle("b", parent=ss["BodyText"], fontName="Helvetica", fontSize=9, leading=12)
    big = ParagraphStyle("t", parent=body, fontName="Helvetica-Bold", fontSize=15, leading=18)
    v = r.vendor
    story = [
        Paragraph(esc(v["display"]), big),
        Paragraph("<br/>".join(esc(a) for a in v["addr"] + [v["phone"]]), body),
        Spacer(1, 10),
        Paragraph("<b>INVOICE</b>", ParagraphStyle("i", parent=body, fontSize=13, leading=16)),
        Spacer(1, 4),
    ]
    due = r.date + timedelta(days=30 if "30" in r.payment else 15)
    meta = Table([["Invoice #", r.number, "Bill to", esc(org["name"])],
                  ["Invoice date", d2(r.date), "", org["addr"][0]],
                  ["Due date", d2(due), "", org["addr"][1]],
                  ["Terms", r.payment.replace("Terms: ", ""), "", ""]],
                 colWidths=[1.0 * inch, 1.6 * inch, 0.8 * inch, 3.0 * inch])
    meta.setStyle(TableStyle([("FONT", (0, 0), (-1, -1), "Helvetica", 9),
                              ("FONT", (0, 0), (0, -1), "Helvetica-Bold", 9),
                              ("FONT", (2, 0), (2, 0), "Helvetica-Bold", 9)]))
    story += [meta, Spacer(1, 12)]
    data = [["Description", "Qty", "Unit price", "Amount"]]
    for desc, q, u in r.items:
        data.append([Paragraph(esc(desc), body), str(q), fmt(u), fmt(q * u)])
    data.append(["", "", "Subtotal", fmt(r.subtotal)])
    if r.tax_bp:
        data.append(["", "", f"Sales tax {r.tax_bp // 100}.{r.tax_bp % 100:02d}%", fmt(r.tax)])
    for desc, c in r.fees:
        data.append(["", "", desc, fmt(c)])
    data.append(["", "", "TOTAL DUE", usd(r.total)])
    t = Table(data, colWidths=[3.6 * inch, 0.6 * inch, 1.3 * inch, 1.1 * inch])
    n = len(r.items)
    t.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, -1), "Helvetica", 9),
        ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 9),
        ("FONT", (2, -1), (-1, -1), "Helvetica-Bold", 9),
        ("LINEBELOW", (0, 0), (-1, 0), 0.8, colors.black),
        ("LINEBELOW", (0, n), (-1, n), 0.5, colors.grey),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story += [t, Spacer(1, 14)]
    if r.extra.get("note"):
        story.append(Paragraph(esc(r.extra["note"]), body))
    story.append(Paragraph(f"Please remit to {esc(v['display'])}, {esc(v['addr'][0])}, {esc(v['addr'][1])}. "
                           "Reference the invoice number with payment.", body))

    def footer(c, doc):
        c.saveState()
        c.setFont("Helvetica", 7)
        c.setFillColor(colors.grey)
        c.drawString(0.75 * inch, 0.5 * inch, f"{SYNTH} · Fictional vendor and invoice · {r.number}")
        c.restoreState()

    doc = SimpleDocTemplate(str(path), pagesize=letter, leftMargin=0.75 * inch, rightMargin=0.75 * inch,
                            topMargin=0.75 * inch, bottomMargin=0.8 * inch,
                            title=f"Invoice {r.number} - {v['display']} ({SYNTH})", author=SYNTH,
                            invariant=1)
    doc.build(story, onFirstPage=footer, onLaterPages=footer)


# --------------------------------------------------------------------------- PDF: agreements
def styles():
    ss = getSampleStyleSheet()
    body = ParagraphStyle("body", parent=ss["BodyText"], fontName="Times-Roman", fontSize=10,
                          leading=13, spaceAfter=5, alignment=4)
    return {
        "body": body,
        "small": ParagraphStyle("small", parent=body, fontSize=8.5, leading=11),
        "title": ParagraphStyle("title", parent=body, fontName="Times-Bold", fontSize=15, leading=19,
                                alignment=1, spaceAfter=4),
        "sub": ParagraphStyle("sub", parent=body, fontName="Times-Roman", fontSize=11, leading=14,
                              alignment=1, spaceAfter=10),
        "h": ParagraphStyle("h", parent=body, fontName="Times-Bold", fontSize=11, leading=14,
                            spaceBefore=8, spaceAfter=4, alignment=0),
        "clause": ParagraphStyle("clause", parent=body, leftIndent=18, firstLineIndent=-18),
        "banner": ParagraphStyle("banner", parent=body, fontName="Helvetica-Bold", fontSize=8,
                                 textColor=colors.HexColor("#8a1c1c"), alignment=1),
    }


def doc_footer(label):
    def f(c, doc):
        c.saveState()
        c.setFont("Helvetica", 7.5)
        c.setFillColor(colors.grey)
        c.drawString(0.9 * inch, 0.55 * inch, f"{SYNTH} · Fictional parties · {label}")
        c.drawRightString(letter[0] - 0.9 * inch, 0.55 * inch, f"Page {doc.page}")
        c.restoreState()
    return f


def budget_table(lines, total, st, with_desc=True):
    data = [["Line", "Category", "Description", "Annual amount"]] if with_desc else [["Line", "Category", "Amount"]]
    for code, name, amt, desc in lines:
        if with_desc:
            data.append([code, Paragraph(esc(name), st["small"]), Paragraph(esc(desc), st["small"]), usd(amt)])
        else:
            data.append([code, name, usd(amt)])
    data.append(["", "TOTAL", "", usd(total)] if with_desc else ["", "TOTAL", usd(total)])
    widths = [0.5 * inch, 1.5 * inch, 3.3 * inch, 1.2 * inch] if with_desc else [0.6 * inch, 3.6 * inch, 1.4 * inch]
    t = Table(data, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, -1), "Times-Roman", 9),
        ("FONT", (0, 0), (-1, 0), "Times-Bold", 9),
        ("FONT", (0, -1), (-1, -1), "Times-Bold", 9),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.grey),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eeeeee")),
        ("ALIGN", (-1, 0), (-1, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    return t


def write_contract(path: Path, cfg: dict):
    c = cfg["contract"]
    org = cfg["org"]
    st = styles()
    S = c["sec"]
    thr = usd(c["receipt_threshold"])
    eq = usd(c["equipment_threshold"])
    lines = c["lines"]
    total = sum(a for _, _, a, _ in lines)
    assert total == c["total"], (total, c["total"])
    ind_rate = f"{c['indirect_bp'] // 100}%"
    base_code = c["indirect_base"]
    base_name = next(n for code, n, _, _ in lines if code == base_code)
    ind_code = c["indirect_line"]
    fr = c["funder"]
    P = lambda t, s="body": Paragraph(t, st[s])  # noqa: E731

    def cl(num, text):
        return P(f"<b>{num}</b>&nbsp;&nbsp;{text}", "clause")

    term_s, term_e = D(c["start"]), D(c["end"])
    long_d = lambda d: f"{MONTHS[d.month]} {d.day}, {d.year}"  # noqa: E731
    story = [
        P(f"{SYNTH.upper()} — FICTIONAL PARTIES — NOT A REAL AGREEMENT", "banner"),
        Spacer(1, 6),
        P(esc(fr["name"].upper()), "title"),
        P(esc(fr["dept"]), "sub"),
        P(f"<b>COST-REIMBURSEMENT {esc(c['kind_word'].upper())} No. {c['id']}</b>", "sub"),
    ]
    info = Table([
        ["Contractor:", org["name"]],
        ["Program:", c["program"]],
        ["Term:", f"{long_d(term_s)} through {long_d(term_e)}"],
        ["Maximum amount:", f"{usd(total)} (not to exceed)"],
        ["Payment basis:", "Monthly cost reimbursement in arrears"],
    ], colWidths=[1.5 * inch, 4.8 * inch])
    info.setStyle(TableStyle([("FONT", (0, 0), (-1, -1), "Times-Roman", 10),
                              ("FONT", (0, 0), (0, -1), "Times-Bold", 10)]))
    story += [info, Spacer(1, 8)]
    story.append(P(
        f"This {c['kind_word']} (\"Agreement\") is entered into by and between the {esc(fr['name'])}, acting by and "
        f"through its {esc(fr['dept'])} (\"{fr['short']}\"), and {esc(org['name'])}, a {org['entity']} with its "
        f"principal office at {esc(org['addr'][0])}, {esc(org['addr'][1])} (\"Contractor\")."))
    story.append(P("<b>RECITALS</b>", "h"))
    story.append(P(
        f"A. {fr['short']} has appropriated funds to support community-based services described in Article "
        f"{S['scope_art']}. "
        f"B. Contractor was selected through {fr['short']}'s competitive solicitation {c['rfp']} and has the "
        f"qualifications and capacity to deliver those services. C. The parties wish to set out the terms under "
        f"which {fr['short']} will reimburse Contractor for actual, allowable costs. NOW, THEREFORE, the parties agree "
        f"as follows:"))

    def art(n, title, clauses):
        story.append(P(f"ARTICLE {n} — {title.upper()}", "h"))
        for num, text in clauses:
            story.append(cl(num, text))

    arts = {}
    arts[S["term_art"]] = ("Term", [
        (f"{S['term_art']}.1", f"This Agreement is effective {long_d(term_s)} (the \"Start Date\") and expires "
         f"{long_d(term_e)} (the \"End Date\"), unless terminated earlier under Article {S['termination_art']}."),
        (S["period"], f"Only costs incurred within the term are reimbursable. Costs incurred before the Start Date or "
         f"after the End Date are not allowable under this Agreement, regardless of when they are paid, recorded or "
         f"invoiced."),
    ])
    arts[S["scope_art"]] = ("Scope of services", [
        (f"{S['scope_art']}.1", f"Contractor shall operate the {esc(c['program'])} as described in Contractor's "
         f"proposal, including {esc(c['scope_text'])}"),
        (f"{S['scope_art']}.2", f"Contractor shall serve not fewer than {c['served']} unduplicated participants during "
         f"the term and shall report service counts with each invoice."),
        (f"{S['scope_art']}.3", "Contractor shall notify the Program Officer in writing within ten (10) business days "
         "of any change in key personnel funded under this Agreement."),
    ])
    arts[S["comp_art"]] = ("Compensation", [
        (f"{S['comp_art']}.1", f"{fr['short']} shall reimburse Contractor for actual, allowable and allocable costs "
         f"incurred in performing this Agreement, in an amount not to exceed <b>{usd(total)}</b>."),
        (f"{S['comp_art']}.2", f"Costs are reimbursable only within the budget lines of Exhibit A. No advance payments "
         f"will be made."),
    ])
    arts[S["inv_art"]] = ("Invoicing and expenditure reports", [
        (f"{S['inv_art']}.1", f"Contractor shall submit <b>monthly invoices</b>. Each invoice is due no later than "
         f"<b>thirty (30) calendar days after the end of the month</b> in which the costs were incurred."),
        (f"{S['inv_art']}.2", "Each invoice shall be accompanied by an Expenditure Report in the form of Exhibit B "
         "<b>listing every charge claimed</b>: transaction date, payee, description and purpose, budget line, and "
         "amount, together with current-period and cumulative-to-date totals for each budget line. The invoice total "
         "must equal the Expenditure Report total to the cent."),
        (S["duplicate"], "A cost may be claimed only once. Contractor shall not claim the same cost twice under this "
         "Agreement, nor claim under this Agreement any cost charged to another funding source."),
        (f"{S['inv_art']}.{int(S['duplicate'].split('.')[1]) + 1}",
         f"{fr['short']} will pay approved invoices within thirty (30) days of approval. The final invoice is due "
         f"within sixty (60) days after the End Date."),
    ])
    arts[S["ind_art"]] = ("Indirect costs", [
        (S["indirect"], f"Indirect costs are reimbursable on Line {ind_code} at <b>{ind_rate} of direct salaries and "
         f"wages charged to Line {base_code} ({esc(base_name)})</b> in the same invoice period. The base is Line "
         f"{base_code} salaries and wages only; it excludes fringe benefits, payroll taxes, supplies, participant "
         f"costs, travel, occupancy and all other costs."),
        (f"{S['ind_art']}.{int(S['indirect'].split('.')[1]) + 1}",
         f"Indirect costs shall be computed once per invoice as (total Line {base_code} salaries and wages for the "
         f"invoice period) x {ind_rate}, rounded to the nearest cent (one-half cent rounds up). Cumulative indirect "
         f"costs may not exceed the Line {ind_code} amount in Exhibit A."),
    ])
    un = c["unallowable"]
    un_clauses = [(f"{S['unallow_art']}.{i + 1}", t) for i, t in enumerate(un)]
    arts[S["unallow_art"]] = ("Unallowable costs", [
        (f"{S['unallow_art']}", "The following costs are not allowable and shall not be charged to any budget line "
         "of this Agreement:")] + un_clauses)
    arts[S["doc_art"]] = ("Documentation and prior approvals", [
        (S["receipts"], f"<b>Receipts are required for every non-payroll charge of {thr} or more.</b> For each such "
         f"charge Contractor shall retain, and furnish with the Expenditure Report upon request, an itemized receipt "
         f"or vendor invoice that supports the date, payee and amount of that specific charge. Charges without "
         f"supporting documentation will be disallowed."),
    ] + ([(S["purpose"], "The Expenditure Report shall state the program purpose of every charge. Charges whose "
           "program purpose is not stated, or is not evident from the supporting documentation, will be held "
           "pending clarification.")] if S.get("purpose") else []) + [
        (S["equipment"], f"<b>Equipment.</b> Any item of equipment with a unit acquisition cost of {eq} or more "
         f"(including tax, delivery and installation) requires the {fr['short']}'s <b>prior written approval</b>. "
         f"Equipment purchased without prior written approval is not reimbursable."),
        (S["payroll"], "Personnel charges shall be supported by timesheets and shall follow the personnel allocation "
         "(percentage of each position charged to each budget line) on file with the Program Officer."),
    ])
    arts[S["budget_art"]] = ("Budget flexibility and invoice accuracy", [
        (S["variance"], f"Contractor may vary expenditures on any budget line by not more than "
         f"<b>{c['variance_pct']}% of that line's annual amount</b> in Exhibit A without a written amendment, provided "
         f"the maximum amount is not exceeded. Variance is measured on cumulative expenditures claimed to date against "
         f"the annual line amount; a claim that would bring cumulative expenditures on a line above "
         f"{100 + c['variance_pct']}% of its annual amount requires an approved budget amendment before payment."),
        (S["arith"], "<b>Invoices with arithmetic errors will be returned in full</b>, unpaid, for correction and "
         "resubmission. This includes errors in computed lines such as indirect costs and any mismatch between the "
         "invoice and the Expenditure Report."),
    ])
    arts[S["ins_art"]] = ("Insurance and indemnification", [
        (f"{S['ins_art']}.1", "Contractor shall maintain commercial general liability insurance of not less than "
         "$1,000,000 per occurrence, workers' compensation as required by law, and abuse and molestation coverage "
         "where services involve minors, and shall name the funder as additional insured."),
        (f"{S['ins_art']}.2", "Contractor shall indemnify and hold harmless the funder, its officers and employees "
         "from claims arising out of Contractor's performance, except to the extent caused by the funder's own "
         "negligence."),
    ])
    arts[S["conf_art"]] = ("Nondiscrimination and confidentiality", [
        (f"{S['conf_art']}.1", "Contractor shall not discriminate in the delivery of services or in employment on any "
         "basis protected by law."),
        (f"{S['conf_art']}.2", "Participant records are confidential. Expenditure Reports shall not include "
         "participant names; participant stipends and supports are reported in aggregate."),
    ])
    arts[S["termination_art"]] = ("Termination", [
        (f"{S['termination_art']}.1", "Either party may terminate this Agreement for convenience on sixty (60) days' "
         "written notice. The funder may terminate for cause on ten (10) days' notice if Contractor fails to cure a "
         "material breach."),
        (f"{S['termination_art']}.2", "Upon termination Contractor is entitled to reimbursement only for allowable "
         "costs incurred before the effective date of termination."),
    ])
    arts[S["notice_art"]] = ("Notices and general provisions", [
        (f"{S['notice_art']}.1", f"Notices shall be in writing to the Program Officer, {esc(fr['dept'])}, "
         f"{esc(fr['addr'])}, and to Contractor's Executive Director at the address above."),
        (f"{S['notice_art']}.2", "This Agreement, including Exhibits A and B, is the entire agreement of the parties "
         "and may be amended only in a writing signed by both parties. Contractor is an independent contractor."),
    ])
    fillers = [
        "Contractor shall maintain accounting records that identify the source and application of all funds received "
        "under this Agreement, using a class or fund code for each budget line.",
        "Invoices shall be signed by an authorized officer of Contractor and submitted through the funder's grants "
        "portal using the funder's invoice template.",
        "The funder may request additional supporting documentation for any charge before approving an invoice; "
        "the review period does not begin until requested documentation is received.",
        "Contractor shall retain all records for four (4) years after final payment and make them available for "
        "monitoring and audit.",
    ]
    for n in sorted(arts):
        title, clauses = arts[n]
        clauses = [x for x in clauses if x[0]]
        subs = {int(x[0].split(".")[1]): x for x in clauses if "." in x[0]}
        if subs:
            fi = 0
            for k in range(1, max(subs) + 1):
                if k not in subs:
                    subs[k] = (f"{n}.{k}", fillers[fi % len(fillers)])
                    fi += 1
            if n == S["doc_art"]:
                subs[max(subs) + 1] = (f"{n}.{max(subs) + 1}", fillers[3])
            clauses = [x for x in clauses if "." not in x[0]] + [subs[k] for k in sorted(subs)]
        art(n, title, clauses)

    sig = Table([
        [P(f"<b>{esc(fr['name'].upper())}</b>"), P(f"<b>{esc(org['name'].upper())}</b>")],
        ["By: ______________________________", "By: ______________________________"],
        [P(f"{esc(fr['signer'])}<br/>{esc(fr['signer_title'])}"), P(f"{esc(org['ed'])}<br/>Executive Director")],
        [f"Date: {d2(D(c['signed']))}", f"Date: {d2(D(c['signed']))}"],
    ], colWidths=[3.2 * inch, 3.2 * inch])
    sig.setStyle(TableStyle([("FONT", (0, 0), (-1, -1), "Times-Roman", 10), ("TOPPADDING", (0, 1), (-1, 1), 16)]))
    story += [Spacer(1, 10), KeepTogether([P("IN WITNESS WHEREOF, the parties have executed this Agreement.", "body"),
                                           Spacer(1, 6), sig])]
    story.append(PageBreak())
    story.append(P(f"EXHIBIT A — LINE-ITEM BUDGET ({c['id']})", "h"))
    story.append(P(f"Term {d2(term_s)} – {d2(term_e)}. Amounts are annual. Line {ind_code} is computed under "
                   f"§{S['indirect']} ({ind_rate} of Line {base_code} salaries and wages)."))
    story.append(budget_table(lines, total, st))
    story.append(Spacer(1, 8))
    story.append(P(f"Line amounts sum to the maximum amount of {usd(total)}. Variances are governed by "
                   f"§{S['variance']}."))
    story.append(P("EXHIBIT B — EXPENDITURE REPORT FORMAT", "h"))
    story.append(P("One row per charge claimed, in date order within each budget line, with columns: "
                   "(1) transaction date; (2) payee; (3) description and program purpose; (4) budget line; "
                   "(5) amount; (6) reference to receipt or invoice (required for non-payroll charges of "
                   f"{thr} or more). Personnel rows may be summarized by employee and pay date. Each budget "
                   "line shows: annual budget, prior cumulative, current period, cumulative to date, and remaining "
                   "balance. The certification below shall be signed by Contractor's Executive Director or Finance "
                   "Director."))
    story.append(P("<i>\"I certify that the costs claimed are actual, allowable, were incurred within the term, have "
                   "not been claimed from any other source, and that the invoice total equals the Expenditure Report "
                   "total.\"</i>"))
    doc = SimpleDocTemplate(str(path), pagesize=letter, leftMargin=0.9 * inch, rightMargin=0.9 * inch,
                            topMargin=0.8 * inch, bottomMargin=0.85 * inch,
                            title=f"{c['kind_word'].title()} {c['id']} ({SYNTH})", author=SYNTH, invariant=1)
    doc.build(story, onFirstPage=doc_footer(c["id"]), onLaterPages=doc_footer(c["id"]))


def write_grant(path: Path, cfg: dict):
    g = cfg["grant"]
    org = cfg["org"]
    st = styles()
    P = lambda t, s="body": Paragraph(t, st[s])  # noqa: E731
    lines = g["lines"]
    total = sum(a for _, _, a, _ in lines)
    assert total == g["total"]
    s, e = D(g["start"]), D(g["end"])
    long_d = lambda d: f"{MONTHS[d.month]} {d.day}, {d.year}"  # noqa: E731
    story = [
        P(f"{SYNTH.upper()} — FICTIONAL PARTIES — NOT A REAL AGREEMENT", "banner"),
        Spacer(1, 6),
        P(esc(g["funder"].upper()), "title"),
        P(esc(g["funder_addr"]), "sub"),
        P(f"{d2(D(g['signed']))}", "body"),
        P(f"{esc(org['ed'])}<br/>Executive Director<br/>{esc(org['name'])}<br/>{esc(org['addr'][0])}<br/>"
          f"{esc(org['addr'][1])}", "body"),
        Spacer(1, 4),
        P(f"<b>Re: Grant Agreement {g['id']} — {esc(g['program'])}</b>", "body"),
        P(f"Dear {esc(org['ed'].split()[0])},"),
        P(f"On behalf of the Board of Trustees, I am pleased to confirm a restricted grant of <b>{usd(total)}</b> "
          f"to {esc(org['name'])} (\"Grantee\"). This letter, once countersigned, is the grant agreement. "
          f"Please read the terms carefully."),
    ]
    sec = g["sec"]

    def h(t):
        story.append(P(t, "h"))

    h("1. Purpose and restriction")
    story.append(P(f"1.1 The grant is restricted to the <b>{esc(g['program'])}</b>. Funds may not be used for any "
                   f"other program or for general operations of the Grantee."))
    h("2. Amount and grant period")
    story.append(P(f"2.1 Grant amount: {usd(total)}, paid in two installments of {usd(total // 2)} on execution and "
                   f"on approval of the second quarterly report. 2.2 Grant period: <b>{long_d(s)} through "
                   f"{long_d(e)}</b>. Costs incurred outside the grant period may not be charged to the grant."))
    h("3. Approved budget")
    story.append(budget_table(lines, total, st))
    story.append(Spacer(1, 4))
    story.append(P(f"3.1 Grantee may move up to {g['variance_pct']}% of any line to another line without prior "
                   f"approval; larger reallocations require written approval of the program officer."))
    if sec["payroll"].startswith("3"):
        story.append(P(f"{sec['payroll']} Personnel costs on Line {lines[0][0]} must follow the effort allocation "
                       f"submitted with the proposal (Attachment B, staff allocation). Charges above a position's "
                       f"approved percentage require prior written approval."))
    h("4. Use of funds")
    story.append(P(f"4.1 Funds shall be spent only on the budget lines in Section 3 and only for costs incurred "
                   f"during the grant period."))
    if sec["payroll"].startswith("4"):
        story.append(P(f"{sec['payroll']} Personnel costs on Line {lines[0][0]} must follow the effort allocation "
                       f"submitted with the proposal (Attachment B, staff allocation). Charges above a position's "
                       f"approved percentage require prior written approval."))
    start = 3 if sec["payroll"].startswith("4") else 2
    for i, t in enumerate(g["unallowable"]):
        story.append(P(f"4.{i + start} {t}"))
    h("5. Reporting")
    story.append(P(f"5.1 Grantee shall submit <b>quarterly</b> narrative and financial reports within thirty (30) days "
                   f"after the end of each grant quarter ({g['quarters']}). The financial report shows expenditures "
                   f"by budget line for the quarter and cumulatively, and lists each non-payroll charge. "
                   f"5.2 A final report is due within sixty (60) days after the end of the grant period."))
    h("6. Records and audit")
    story.append(P("6.1 Grantee shall keep receipts, invoices and payroll records supporting every charge for at "
                   "least three (3) years and make them available to the Foundation on request. 6.2 Unexpended or "
                   "misused funds shall be returned to the Foundation."))
    h("7. Acknowledgement")
    story.append(P("Please countersign below to accept these terms. We look forward to working with you."))
    sig = Table([
        [P(f"<b>{esc(g['funder'])}</b>"), P(f"<b>{esc(org['name'])}</b>")],
        ["______________________________", "______________________________"],
        [P(f"{esc(g['signer'])}<br/>{esc(g['signer_title'])}"), P(f"{esc(org['ed'])}<br/>Executive Director")],
    ], colWidths=[3.2 * inch, 3.2 * inch])
    sig.setStyle(TableStyle([("FONT", (0, 0), (-1, -1), "Times-Roman", 10), ("TOPPADDING", (0, 1), (-1, 1), 16)]))
    story += [Spacer(1, 8), KeepTogether([sig])]
    doc = SimpleDocTemplate(str(path), pagesize=letter, leftMargin=0.9 * inch, rightMargin=0.9 * inch,
                            topMargin=0.8 * inch, bottomMargin=0.85 * inch,
                            title=f"Grant Agreement {g['id']} ({SYNTH})", author=SYNTH, invariant=1)
    doc.build(story, onFirstPage=doc_footer(g["id"]), onLaterPages=doc_footer(g["id"]))


# --------------------------------------------------------------------------- dataset configs
DEMO_CFG = {
    "seed": 260412,
    "out": "steward-data-v2",
    "city_line": "Port Calloway, CA 94617",
    "card_last4": "4417",
    "card_acct": "2110 Business Credit Card x4417",
    "checking_acct": "1010 Operating Checking",
    "checking_memo": "Checking x0912",
    "check_start": 10440,
    "dd_start": 5100,
    "admin_loc": "Administration",
    "fringe_bp": 2200,
    "acct": {"salaries": "6010 Salaries & Wages", "fringe": "6020 Payroll Taxes & Benefits",
             "indirect": "6900 Indirect Cost Allocation"},
    "org": {"name": "Calle Nueva Family Center", "entity": "California nonprofit public benefit corporation",
            "addr": ["2218 Corliss Avenue, Suite 200", "Port Calloway, CA 94617"]},
    "contract": {
        "id": "FS-27-0412", "kind_word": "contract", "total": 24000000,
        "start": "2026-07-01", "end": "2027-06-30", "signed": "2026-06-18", "rfp": "RFP DFS-2026-07",
        "program": "Familias Adelante Family Support Program",
        "scope_text": "home visits, weekly Family Night sessions with a shared meal for enrolled families, case "
                      "management, and participant stipends for completion of parenting workshops.",
        "served": 120,
        "funder": {"name": "City of Port Calloway", "dept": "Department of Family Services", "short": "City",
                   "addr": "400 Civic Center Plaza, Port Calloway, CA 94612",
                   "signer_title": "Director, Department of Family Services"},
        "lines": [
            ("C1", "Personnel", 13300000, "Direct salaries and wages of program staff per the personnel allocation on file."),
            ("C2", "Fringe benefits", 2926000, "Employer payroll taxes and benefits for C1 staff (22% of C1)."),
            ("C3", "Program supplies", 480000, "Consumable supplies, curriculum materials and printing used in the program."),
            ("C4", "Participant support", 2724000, "Stipends, meals for enrolled families during scheduled sessions, and other direct participant supports."),
            ("C5", "Local travel", 240000, "Staff mileage and transit for home visits within the service area."),
            ("C6", "Rent / occupancy", 3000000, "Program space at the Family Resource Center."),
            ("C7", "Indirect", 1330000, "10% of Line C1 salaries and wages."),
        ],
        "indirect_line": "C7", "indirect_base": "C1", "indirect_bp": 1000,
        "receipt_threshold": 7500, "equipment_threshold": 500000, "variance_pct": 10,
        "unallowable": [
            "<b>Alcoholic beverages</b> of any kind.",
            "<b>Entertainment</b>, including staff appreciation events, parties, gifts to staff and <b>staff meals</b>. "
            "Meals provided to enrolled participants during scheduled program activities are not entertainment.",
            "<b>Fines, penalties</b>, late fees and interest.",
            "<b>Fundraising</b> and donor cultivation costs.",
            "<b>Lobbying</b> or political activity of any kind.",
        ],
        "sec": {"term_art": 1, "scope_art": 2, "comp_art": 3, "inv_art": 4, "ind_art": 5, "unallow_art": 6,
                "doc_art": 7, "budget_art": 8, "ins_art": 9, "conf_art": 10, "termination_art": 11,
                "notice_art": 12,
                "period": "1.2", "duplicate": "4.3", "indirect": "5.1", "receipts": "7.1", "equipment": "7.2",
                "payroll": "7.3", "variance": "8.1", "arith": "8.2",
                "alcohol": "6.1", "entertainment": "6.2", "fines": "6.3", "fundraising": "6.4", "lobbying": "6.5"},
    },
    "grant": {
        "id": "RF-26-118", "total": 5000000, "start": "2026-06-01", "end": "2027-05-31", "signed": "2026-05-20",
        "funder": "Thistlewick Foundation", "funder_addr": "88 Larkspur Row, Port Calloway, CA 94610",
        "signer_title": "Program Officer", "program": "Puentes Youth Mentoring Program", "variance_pct": 15,
        "quarters": "Jun–Aug, Sep–Nov, Dec–Feb, Mar–May",
        "lines": [
            ("F1", "Personnel & fringe", 2700000, "Mentor coordinator and youth mentor time per Attachment B."),
            ("F2", "Program materials", 900000, "Materials used by mentoring participants."),
            ("F3", "Family engagement events", 800000, "Events for mentees and their families."),
            ("F4", "Evaluation", 600000, "External evaluation services."),
        ],
        "unallowable": [
            "Grant funds may not be used for alcoholic beverages.",
            "Grant funds may not be used for lobbying, political campaigns or attempts to influence legislation.",
            "Grant funds may not be used for fundraising events or donor cultivation.",
        ],
        "sec": {"payroll": "4.2"},
    },
    "loc_by_class": {},
}

HOLD_CFG = {
    "seed": 731903,
    "out": "steward-holdout-v2",
    "city_line": "Marrow Bay, CA 95421",
    "card_last4": "2290",
    "card_acct": "2120 Visa Business x2290",
    "checking_acct": "1000 Checking - Tolland Bay CU",
    "checking_memo": "Share draft x3381",
    "check_start": 3310,
    "dd_start": 880,
    "admin_loc": "Administration",
    "fringe_bp": 2400,
    "acct": {"salaries": "5010 Wages - Coaches & Staff", "fringe": "5020 Employer Taxes & Benefits",
             "indirect": "5900 Indirect Costs"},
    "org": {"name": "Northfen Youth Athletics League", "entity": "California nonprofit public benefit corporation",
            "addr": ["615 Ferrow Street", "Marrow Bay, CA 95421"]},
    "contract": {
        "id": "YR-27-0093", "kind_word": "agreement", "total": 15000000,
        "start": "2026-07-01", "end": "2027-06-30", "signed": "2026-06-24", "rfp": "solicitation OYR-26-11",
        "program": "Saturday Leagues & Coaching Program",
        "scope_text": "Saturday youth soccer and basketball leagues, weekday practices, tournament transportation for "
                      "registered players, and coach training.",
        "served": 300,
        "funder": {"name": "County of Marrow Bay", "dept": "Office of Youth Recreation", "short": "County",
                   "addr": "1 Courthouse Square, Marrow Bay, CA 95420",
                   "signer_title": "Director, Office of Youth Recreation"},
        "lines": [
            ("Y1", "Coach & staff wages", 8500000, "Direct wages of coaches and program staff per the allocation on file."),
            ("Y2", "Fringe benefits", 2040000, "Employer taxes and benefits for Y1 staff (24% of Y1)."),
            ("Y3", "Equipment & uniforms", 1200000, "Balls, nets, uniforms, field supplies and printing."),
            ("Y4", "Participant transportation", 600000, "Charter transportation of registered players to games."),
            ("Y5", "Staff training & travel", 240000, "Coach certification, clinics, mileage."),
            ("Y6", "Field & facility rental", 1400000, "Field and gym rental for league play."),
            ("Y7", "Indirect", 1020000, "12% of Line Y1 wages."),
        ],
        "indirect_line": "Y7", "indirect_base": "Y1", "indirect_bp": 1200,
        "receipt_threshold": 5000, "equipment_threshold": 500000, "variance_pct": 15,
        "unallowable": [
            "<b>Alcoholic beverages</b>, including alcohol served with an otherwise allowable meal.",
            "<b>Entertainment</b>, social events and gifts for staff, board or volunteers.",
            "<b>Fines and penalties</b>, including late fees and interest.",
            "<b>Fundraising</b> costs.",
            "<b>Lobbying</b> and political activity.",
        ],
        "sec": {"term_art": 2, "scope_art": 3, "comp_art": 1, "inv_art": 4, "ind_art": 5, "unallow_art": 9,
                "doc_art": 11, "budget_art": 12, "ins_art": 6, "conf_art": 7, "termination_art": 8,
                "notice_art": 10,
                "period": "2.2", "duplicate": "4.5", "indirect": "5.1", "receipts": "11.2", "purpose": "11.3",
                "equipment": "11.4", "payroll": "11.5", "variance": "12.1", "arith": "12.3",
                "alcohol": "9.1", "entertainment": "9.2"},
    },
    "grant": {
        "id": "QL-26-052", "total": 6000000, "start": "2026-07-01", "end": "2027-06-30", "signed": "2026-06-10",
        "funder": "Quenby Lark Foundation", "funder_addr": "12 Heronsgate Lane, Marrow Bay, CA 95424",
        "signer_title": "Senior Program Officer", "program": "Girls' Futsal & Mentoring Program", "variance_pct": 20,
        "quarters": "Jul–Sep, Oct–Dec, Jan–Mar, Apr–Jun",
        "lines": [
            ("Q1", "Personnel & fringe", 4200000, "Program manager and coach time per Attachment B."),
            ("Q2", "Program equipment", 800000, "Balls, goals, pinnies and training equipment for the program."),
            ("Q3", "Tournaments & family events", 600000, "Tournament costs and meals for registered players."),
            ("Q4", "Coach development", 400000, "Training for program coaches."),
        ],
        "unallowable": [
            "Grant funds may not be used for alcoholic beverages.",
            "Grant funds may not be used for gifts, awards or gift cards for staff or volunteers.",
            "Grant funds may not be used for lobbying or political activity.",
        ],
        "sec": {"payroll": "3.2"},
    },
    "loc_by_class": {},
}


# --------------------------------------------------------------------------- demo plan
def build_demo(ctx: Ctx):
    cfg = ctx.cfg
    f = ctx.fake
    rng = ctx.rng
    FS, RF = "FS-27-0412", "RF-26-118"
    FRC, YM, ADM = "Family Resource Center", "Youth Mentoring", "Administration"
    cfg["loc_by_class"] = {f"{FS}:C2": FRC, f"{FS}:C7": FRC, f"{RF}:F1": YM, "General": ADM}
    cfg["fringe_map"] = {f"{FS}:C1": f"{FS}:C2", f"{RF}:F1": f"{RF}:F1", "General": "General"}
    cfg["org"]["ed"] = f"{f.first_name()} {f.last_name()}"
    cfg["contract"]["funder"]["signer"] = f"{f.first_name()} {f.last_name()}"
    cfg["grant"]["signer"] = f"{f.first_name()} {f.last_name()}"
    names = [f"{f.first_name()} {f.last_name()}" for _ in range(6)]
    names = list(dict.fromkeys(names))[:5]
    E = [
        {"name": names[0], "role": "Program Director", "gross": 304615, "loc": FRC,
         "alloc": [(f"{FS}:C1", 6000), (f"{RF}:F1", 1000), ("UNRESTRICTED", 3000)]},
        {"name": names[1], "role": "Family Advocate", "gross": 200000, "loc": FRC,
         "alloc": [(f"{FS}:C1", 10000)]},
        {"name": names[2], "role": "Family Advocate", "gross": 160000, "loc": FRC,
         "alloc": [(f"{FS}:C1", 8000), ("UNRESTRICTED", 2000)]},
        {"name": names[3], "role": "Youth Mentor (part-time)", "gross": 107692, "loc": YM,
         "alloc": [(f"{RF}:F1", 5000), ("UNRESTRICTED", 5000)]},
        {"name": cfg["org"]["ed"], "role": "Executive Director", "gross": 380000, "loc": ADM,
         "alloc": [("UNRESTRICTED", 10000)]},
    ]
    ctx.employees = E
    pay_dates = [D("2026-07-03") + timedelta(days=14 * i) for i in range(9)]  # Jul 3 .. Oct 23
    overrides = {
        (D("2026-09-11"), names[0]): {"alloc": [(f"{FS}:C1", 6000), (f"{RF}:F1", 2000), ("UNRESTRICTED", 2000)]},
        (D("2026-10-23"), names[2]): {"gross": 141231},  # one unpaid day
    }
    payroll(ctx, pay_dates, E, overrides)

    mk = lambda *a, **k: make_vendor(ctx, *a, **k)  # noqa: E731
    mk("officedepot", "Office Depot", "Office Depot", "office-depot", "retail", "OFFICE DEPOT #1187 PORT CALLOWAY",
       925, [("Copy paper 10-ream case", 4899, 5899), ("Gel pens 12pk", 899, 1499),
             ("Composition notebooks 6pk", 799, 1199), ("Dry erase markers 8pk", 1099, 1599),
             ("File folders 100ct", 1299, 1899), ("Toner cartridge black", 6999, 11999),
             ("Sticky notes 24pk", 1499, 2299), ("Binders 1in 6pk", 1599, 2399), ("Laminating pouches 100ct", 1899, 2699)])
    mk("costco", "Costco Wholesale", "Costco", "costco", "retail", "COSTCO WHSE #0482 PORT CALLOWAY", 925,
       [("Granola bars 48ct", 1299, 1699), ("Fruit cups 24ct", 1199, 1499), ("Juice boxes 40ct", 1399, 1799),
        ("Kids backpacks 4pk", 3999, 4999), ("Crayons 64ct 6pk", 1599, 1999), ("Paper towels 12rl", 2199, 2599),
        ("Hand sanitizer 3pk", 1199, 1599), ("Storage bins 6pk", 2999, 3999), ("Bottled water 40pk", 699, 899),
        ("Construction paper 500ct", 1499, 1899), ("Board games 3pk", 3499, 4499), ("Diapers size 4 box", 3999, 4799)])
    mk("amazon", "Amazon.com", "Amazon", "amazon", "retail", "AMZN MKTP US*2K41L09QA", 925,
       [("Bilingual picture books set", 2499, 3999), ("Kids headphones 5pk", 3999, 5499),
        ("Card game family pack", 1499, 2499), ("Wooden puzzle set", 1899, 2999), ("Label maker", 2999, 3999),
        ("Parenting workbook (Spanish)", 1299, 1899), ("Fidget toy assortment", 1599, 2499),
        ("Journal notebooks 12pk", 1999, 2899)])
    mk("plaza", "Plaza Discount Mart", "Plaza Discount Mart", "plaza-discount-mart", "retail",
       "PLAZA DISCOUNT MART PORT CALLOWAY", 925,
       [("Tape 6pk", 499, 799), ("Balloons 50ct", 399, 699), ("Paper plates 100ct", 599, 899),
        ("Napkins 250ct", 399, 599), ("Markers 10ct", 499, 799)])
    mk("willowmark", "Willowmark Art Supply", "Willowmark Art Supply", "willowmark-art-supply", "retail",
       "WILLOWMARK ART SUPPLY", 925,
       [("Tempera paint 12-color set", 2499, 3499), ("Brushes classpack 72", 2999, 3999),
        ("Watercolor paper pad", 1299, 1899), ("Modeling clay 24lb", 3499, 4499), ("Canvas panels 24pk", 3999, 4999),
        ("Glue sticks 30pk", 1199, 1599), ("Scissors classpack 24", 2499, 2999)])
    mk("pizza", "Tres Robles Pizzeria", "Tres Robles Pizzeria", "tres-robles-pizzeria", "restaurant",
       "TRES ROBLES PIZZERIA", 925,
       [("Large cheese pizza", 1899, 2199), ("Large veggie pizza", 2199, 2499), ("Large pepperoni pizza", 2099, 2399),
        ("Family garden salad", 1299, 1499), ("Agua fresca pitcher", 999, 1199), ("Garlic knots dozen", 899, 1099)])
    mk("casalumbre", "Casa Lumbre Cocina", "Casa Lumbre Cocina", "casa-lumbre-cocina", "restaurant",
       "CASA LUMBRE COCINA", 925,
       [("Mole poblano plate", 2299, 2599), ("Carne asada plate", 2499, 2899), ("Chile relleno plate", 1999, 2299),
        ("Guacamole table", 1399, 1599), ("Flan", 899, 999), ("Sparkling water", 499, 599)])
    mk("transit", "Port Calloway Transit Authority", "Port Calloway Transit", "pc-transit", "retail",
       "PCTA PASS SALES", 0, [("Monthly adult pass", 4300, 4300)])
    mk("landlord", "Ninth & Corliss Holdings LLC", "Ninth & Corliss Holdings", "ninth-corliss-holdings", "invoice",
       "CHECK", 0, terms="Terms: Due on receipt")
    mk("pinecrest", "Pinecrest Prepaid Cards", "Pinecrest Prepaid Cards", "pinecrest-prepaid", "invoice", "CHECK", 0,
       terms="Terms: Net 15")
    mk("printshop", "Alder Street Print & Copy", "Alder Street Print & Copy", "alder-street-print", "invoice",
       "CHECK", 925, [("Tri-fold program flyers 1,000 ct", 9800, 12800), ("Posters 18x24 25 ct", 6400, 8400),
                      ("Family Night sign-in sheets, padded", 2400, 3600), ("Bilingual brochures 500 ct", 7200, 9400)],
       terms="Terms: Net 15")
    mk("appliance", "Harborline Commercial Appliance", "Harborline Commercial Appliance", "harborline-appliance",
       "invoice", "CHECK", 925, terms="Terms: Net 30")
    mk("evaluator", "Quillfeather Evaluation Group", "Quillfeather Evaluation Group", "quillfeather-evaluation",
       "invoice", "CHECK", 0, terms="Terms: Net 30")
    mk("utility", "Port Calloway Power & Water", "Port Calloway Power & Water", "pcpw", "invoice",
       "PCPW AUTOPAY", 0, [("Electric & water service", 20000, 40000)])
    mk("bankfee", "Harborstone Community Bank", "Harborstone Community Bank", "harborstone-bank", "invoice",
       "SERVICE CHARGE", 0, [("Monthly service charge", 1800, 1800)])
    mk("insurance", "Linden & Pike Insurance Brokers", "Linden & Pike Insurance", "linden-pike", "invoice", "CHECK", 0,
       terms="Terms: Net 30")
    mk("events", "Juniper Hall Events", "Juniper Hall Events", "juniper-hall", "invoice", "CHECK", 0,
       terms="Terms: Due on receipt")
    ctx.vendors["landlord"]["inv_prefix"] = "NC-"
    ctx.vendors["pinecrest"]["inv_prefix"] = "PP-"
    ctx.vendors["evaluator"]["inv_prefix"] = "QEG-"
    ctx.vendors["appliance"]["inv_prefix"] = "HCA-"

    A = {"sup": "6110 Program Supplies", "off": "6115 Office Supplies", "part": "6120 Participant Support",
         "trav": "6130 Local Travel & Mileage", "rent": "6210 Rent", "meals": "6160 Meals & Entertainment",
         "equip": "6180 Equipment & Furniture", "cont": "6310 Contract Services", "util": "6220 Utilities",
         "ins": "6230 Insurance", "fee": "6250 Bank Fees", "fund": "6410 Fundraising Events",
         "print": "6140 Printing & Copying"}
    C = lambda line: f"{FS}:{line}"  # noqa: E731
    R = lambda line: f"{RF}:{line}"  # noqa: E731
    G = "General"
    c_ = lambda dollars: int(round(dollars * 100))  # noqa: E731  (plan targets only; exact cents come from receipts)
    X = {}

    # (f) before contract start
    X["f"] = purchase(ctx, "2026-06-28", "costco", [(C("C3"), A["sup"], FRC, c_(212.40), "kits")])

    for m, ds in [(7, "2026-07-01"), (8, "2026-08-01"), (9, "2026-09-01"), (10, "2026-10-01")]:
        purchase(ctx, ds, "landlord",
                 [(C("C6"), A["rent"], FRC, 250000, f"{MON[m]} rent"), (G, A["rent"], ADM, 125000, f"{MON[m]} rent")],
                 ttype="Bill", exact=[("Suite 200 - Family Resource Center program space, monthly rent", 1, 250000),
                                      ("Suite 210 - administrative offices, monthly rent", 1, 125000)],
                 inv_number=f"NC-26{m:02d}")
        purchase(ctx, f"2026-{m:02d}-{rng.randint(14, 17)}", "utility", [(G, A["util"], ADM, c_(rng.randint(260, 340)), "")],
                 ttype="Expense", receipt=None, num="", pay="checking")
        purchase(ctx, month_end(2026, m).isoformat(), "bankfee", [(G, A["fee"], ADM, 1800, "")], ttype="Expense",
                 receipt=None, exact=[("Monthly service charge", 1, 1800)], num="", pay="checking")

    # July
    purchase(ctx, "2026-07-07", "costco", [(C("C3"), A["sup"], FRC, c_(620), "welcome kits"),
                                           (R("F2"), A["sup"], YM, c_(140), ""), (G, A["sup"], ADM, c_(55), "")])
    purchase(ctx, "2026-07-09", "officedepot", [(C("C3"), A["off"], FRC, c_(96), "")])
    X["b"] = purchase(ctx, "2026-07-14", "amazon", [(C("C3"), A["sup"], FRC, c_(143), "books")], gl_delta=-1,
                      num="7731")
    purchase(ctx, "2026-07-16", "amazon", [(C("C3"), A["sup"], FRC, 2499, "return")], ttype="Credit Card Credit",
             receipt=None, exact=[("Fidget toy assortment (returned)", 1, 2286)], num="")
    purchase(ctx, "2026-07-18", "pinecrest", [(C("C4"), A["part"], FRC, 120000, "Jul stipends")], ttype="Bill",
             exact=[("Prepaid stipend card, $100 load (workshop completion)", 12, 10000)])
    purchase(ctx, "2026-07-21", "pizza", [(C("C4"), A["part"], FRC, c_(214), "Family night - participants")],
             receipt="png")
    purchase(ctx, "2026-07-22", "willowmark", [(R("F2"), A["sup"], YM, c_(265), "art supplies")])
    purchase(ctx, "2026-07-24", "transit", [(C("C5"), A["trav"], FRC, 8600, "passes")],
             exact=[("Monthly adult pass", 2, 4300)])
    purchase(ctx, "2026-07-29", "plaza", [(C("C3"), A["sup"], FRC, c_(38), "")], receipt=None)
    purchase(ctx, "2026-07-30", "transit", [(C("C5"), A["trav"], FRC, 4830, "mileage Jul")], ttype="Check",
             name=names[1], receipt=None, exact=[("Mileage 69 mi @ 0.70", 1, 4830)], rkind="invoice")

    # August
    purchase(ctx, "2026-08-04", "costco", [(C("C3"), A["sup"], FRC, c_(1460), "backpacks"), (G, A["sup"], ADM, c_(80), "")])
    X["a"] = purchase(ctx, "2026-08-11", "officedepot", [(C("C3"), A["off"], FRC, c_(167), "")], receipt=None, num="")
    X["a2"] = purchase(ctx, "2026-08-13", "officedepot", [(R("F2"), A["off"], YM, c_(134), "mentoring journals")])
    purchase(ctx, "2026-08-17", "pinecrest", [(C("C4"), A["part"], FRC, 150000, "Aug stipends")], ttype="Bill",
             exact=[("Prepaid stipend card, $100 load (workshop completion)", 15, 10000)])
    purchase(ctx, "2026-08-18", "pizza", [(C("C4"), A["part"], FRC, c_(236), "Family night")])
    X["g1"] = purchase(ctx, "2026-08-19", "printshop", [(C("C3"), A["print"], FRC, c_(318), "flyers")], ttype="Bill",
                       inv_number="4471")
    X["g2"] = duplicate_txn(ctx, X["g1"], "2026-08-20")
    purchase(ctx, "2026-08-21", "insurance", [(G, A["ins"], ADM, 64200, "")], ttype="Bill", receipt=None,
             exact=[("General liability premium - installment 1", 1, 64200)])
    purchase(ctx, "2026-08-24", "amazon", [(C("C3"), A["sup"], FRC, c_(88), ""), (G, A["off"], ADM, c_(46), "")])
    purchase(ctx, "2026-08-25", "events", [(G, A["fund"], ADM, 150000, "gala deposit")], ttype="Bill", receipt=None,
             exact=[("Venue deposit - fall benefit gala", 1, 150000)])
    purchase(ctx, "2026-08-26", "evaluator", [(R("F4"), A["cont"], YM, 125000, "")], ttype="Bill",
             exact=[("Evaluation services - August (survey design), 10 hrs", 10, 12500)])
    purchase(ctx, "2026-08-27", "transit", [(C("C5"), A["trav"], FRC, 6195, "mileage Aug")], ttype="Check",
             name=names[2], receipt=None, exact=[("Mileage 88.5 mi @ 0.70", 1, 6195)], rkind="invoice")
    purchase(ctx, "2026-08-30", "plaza", [(R("F3"), A["part"], YM, c_(52), "")], receipt=None)

    # September
    purchase(ctx, "2026-09-04", "willowmark", [(C("C3"), A["sup"], FRC, c_(640), "art supplies")])
    X["h"] = purchase(ctx, "2026-09-08", "appliance", [(C("C4"), A["equip"], FRC, 548585, "pantry fridge")],
                      ttype="Bill",
                      exact=[("Two-door commercial reach-in refrigerator, 49 cu ft, stainless", 1, 482000)],
                      fees=[("Delivery & installation", 22000)])
    # (j) one receipt, two GL lines with the same amount, receipt date equidistant
    jrec = build_receipt(ctx, ctx.vendors["costco"], D("2026-09-12"), c_(96), number="5520")
    jx = [(d_, q, u) for d_, q, u in jrec.items]
    X["j1"] = purchase(ctx, "2026-09-10", "costco", [(C("C4"), A["part"], FRC, jrec.total, "snacks")],
                       exact=jx, receipt="pdf", receipt_date="2026-09-12", num="4521", inv_number="5520")
    X["j2"] = purchase(ctx, "2026-09-14", "costco", [(R("F3"), A["part"], YM, jrec.total, "family event snacks")],
                       exact=jx, receipt=None, num="4588")
    purchase(ctx, "2026-09-15", "pinecrest", [(C("C4"), A["part"], FRC, 150000, "Sep stipends")], ttype="Bill",
             exact=[("Prepaid stipend card, $100 load (workshop completion)", 15, 10000)])
    purchase(ctx, "2026-09-16", "amazon", [(C("C3"), A["sup"], FRC, c_(210), ""), (R("F2"), A["sup"], YM, c_(120), "")])
    purchase(ctx, "2026-09-17", "officedepot", [(C("C3"), A["off"], FRC, c_(64), "")], receipt=None, num="")
    purchase(ctx, "2026-09-20", "willowmark", [(R("F2"), A["sup"], YM, c_(180), "")])
    purchase(ctx, "2026-09-22", "pizza", [(C("C4"), A["part"], FRC, c_(198), "family night")], receipt="png")
    purchase(ctx, "2026-09-24", "transit", [(C("C5"), A["trav"], FRC, 7500, "youth passes")],
             exact=[("Youth monthly pass", 3, 2500)])
    purchase(ctx, "2026-09-25", "transit", [(C("C5"), A["trav"], FRC, 7482, "mileage Sep")], ttype="Check",
             name=names[1], receipt=None, exact=[("Mileage 106.9 mi @ 0.70", 1, 7482)], rkind="invoice")
    purchase(ctx, "2026-09-29", "costco", [(G, A["fund"], ADM, c_(210), "Donor appreciation breakfast")])

    # October: (e) the big C3 purchase is sized so cumulative C3 crosses 110% of the annual line here
    c3 = [r for r in ctx.rows if r.cls == C("C3")]
    blocked_ids = {X["f"].rows[0].seq, X["a"].rows[0].seq, X["g2"].rows[0].seq}
    excl_all = blocked_ids | {X["b"].rows[0].seq, X["g1"].rows[0].seq}
    cap = 480000 * 110 // 100
    all_in = sum(r.amount for r in c3)
    lean = sum(r.amount for r in c3 if r.seq not in excl_all)
    assert all_in < cap, all_in
    X["e"] = purchase(ctx, "2026-10-05", "costco",
                      [(C("C3"), A["sup"], FRC, cap - lean + c_(rng.randint(180, 320)), "program supplies")])
    X["d"] = purchase(ctx, "2026-10-09", "casalumbre", [(C("C3"), A["meals"], FRC, c_(486), "Staff appreciation dinner")])
    X["d"].receipt.extra.update({"guests": 14, "server": "Marisol"})
    purchase(ctx, "2026-10-13", "pinecrest", [(C("C4"), A["part"], FRC, 180000, "Oct stipends")], ttype="Bill",
             exact=[("Prepaid stipend card, $100 load (workshop completion)", 18, 10000)])
    purchase(ctx, "2026-10-15", "pizza", [(C("C4"), A["part"], FRC, c_(228), "family night - participants")])
    purchase(ctx, "2026-10-19", "evaluator", [(R("F4"), A["cont"], YM, 125000, "")], ttype="Bill",
             exact=[("Evaluation services - October (data collection), 10 hrs", 10, 12500)])
    purchase(ctx, "2026-10-20", "willowmark", [(R("F2"), A["sup"], YM, c_(155), "")])
    purchase(ctx, "2026-10-22", "amazon", [(R("F2"), A["sup"], YM, c_(92), "journals"), (G, A["off"], ADM, c_(40), "")],
             receipt="png")
    purchase(ctx, "2026-10-23", "officedepot", [(G, A["off"], ADM, c_(130), "admin supplies")])
    purchase(ctx, "2026-10-26", "transit", [(C("C5"), A["trav"], FRC, 5740, "mileage Oct")], ttype="Check",
             name=names[2], receipt=None, exact=[("Mileage 82 mi @ 0.70", 1, 5740)], rkind="invoice")

    # deposits (bank only)
    for ds, desc, amt in [("2026-07-08", "MOBILE DEPOSIT", 125000), ("2026-08-12", "ACH CREDIT DONOR PLATFORM PAYOUT", 48650),
                          ("2026-09-29", "ACH CREDIT CITY OF PORT CALLOWAY", 0), ("2026-10-14", "MOBILE DEPOSIT", 90000)]:
        if amt:
            ctx.bank.append((D(ds), desc, amt, cfg["checking_memo"]))

    ind = fringe_and_indirect(ctx, [(2026, m) for m in (7, 8, 9, 10)], (2026, 10), "dollar_rounded_base")

    # ---- planted issues (recorded only in expected_v2.json)
    S = cfg["contract"]["sec"]
    ctx.issue("D-a", "receipt_missing", f"§{S['receipts']}", "blocked",
              "Office Depot charge coded to FS-27-0412:C3 with empty memo and no receipt; a second Office Depot "
              "charge the same week is coded to RF-26-118:F2 and does have a receipt.",
              X["a"].rows[0], evidence={"sameWeekOtherCharge": X["a2"].rows[0].ref(),
                                        "sameWeekOtherReceipt": X["a2"].receipt.filename})
    ctx.issue("D-b", "receipt_amount_mismatch", f"§{S['receipts']}", "needs_review",
              f"Receipt total {fmt(X['b'].receipt.total)} is $0.01 higher than the GL amount {fmt(X['b'].total)}.",
              X["b"].rows[0], evidence={"receipt": X["b"].receipt.filename,
                                        "receiptTotalCents": X["b"].receipt.total, "glAmountCents": X["b"].total})
    io_ = ind[(2026, 10)]
    ctx.issue("D-c", "indirect_rate", f"§{S['indirect']}; §{S['arith']}", "blocked",
              f"October C7 indirect booked {fmt(io_['booked'])} but 10% of October C1 salaries "
              f"({fmt(io_['base'])}) is {fmt(io_['correct'])} (difference {fmt(io_['booked'] - io_['correct'])}); "
              f"the bookkeeper used a whole-dollar salary summary as the base. Invoice would be returned in full.",
              io_["row"], extra={"correctIndirectCents": io_["correct"], "bookedIndirectCents": io_["booked"],
                                 "baseCents": io_["base"]})
    ctx.issue("D-d", "unallowable_cost", f"§{S['entertainment']}", "blocked",
              "Staff appreciation dinner at a restaurant coded to FS-27-0412:C3 (entertainment / staff meal).",
              X["d"].rows[0], evidence={"receipt": X["d"].receipt.filename})
    ctx.issue("D-f", "outside_period", f"§{S['period']}", "blocked",
              "Charge dated 2026-06-28 coded to FS-27-0412, before the contract start date 2026-07-01.",
              X["f"].rows[0], evidence={"receipt": X["f"].receipt.filename})
    ctx.issue("D-g", "duplicate_charge", f"§{S['duplicate']}", "needs_review",
              "Same vendor, amount and bill Num entered on 08/19 and again on 08/20; one vendor invoice and one bank "
              "payment exist. The 08/20 entry is the duplicate.",
              X["g2"].rows[0], related=X["g1"].rows, evidence={"receipt": X["g1"].receipt.filename})
    ctx.issue("D-h", "equipment_prior_approval", f"§{S['equipment']}", "blocked",
              f"Commercial refrigerator, unit cost incl. tax and installation {fmt(X['h'].total)} (>= $5,000), coded "
              f"to C4 with no prior written approval (precedents state none was requested).",
              X["h"].rows[0], evidence={"receipt": X["h"].receipt.filename})
    p_i = next(r for r in ctx.rows if r.kind == "payroll" and r.date == D("2026-09-11") and r.name == names[0]
               and r.cls == R("F1"))
    allowed = split_weights(E[0]["gross"], [6000, 1000, 3000])[1]
    ctx.issue("D-i", "payroll_allocation_exceeded", f"RF-26-118 §{cfg['grant']['sec']['payroll']}", "needs_review",
              f"{names[0]} is allocated 10% to RF-26-118:F1 ({fmt(allowed)} per paycheck) but the 09/11 paycheck "
              f"charged {fmt(p_i.amount)} (20%) to F1.",
              p_i, extra={"allowedCents": allowed, "chargedCents": p_i.amount})
    ctx.issue("D-j", "receipt_ambiguous_match", f"§{S['receipts']}", "needs_review",
              f"One Costco receipt dated 2026-09-12 for {fmt(jrec.total)} matches two GL lines with the same amount "
              f"(09/10 FS-27-0412:C4 and 09/14 RF-26-118:F3), two days either side; it cannot be assigned, so one of "
              f"the two lines is effectively undocumented.",
              X["j1"].rows[0], related=X["j2"].rows, evidence={"receipt": X["j1"].receipt.filename})
    ctx.plant_e = X["e"]
    ctx.indirect = ind
    return X


# --------------------------------------------------------------------------- hold-out plan
def build_holdout(ctx: Ctx):
    cfg = ctx.cfg
    f = ctx.fake
    rng = ctx.rng
    YR, QL = "YR-27-0093", "QL-26-052"
    LG, GF, ADM = "Youth Leagues", "Girls' Futsal Program", "Administration"
    cfg["loc_by_class"] = {f"{YR}:Y2": LG, f"{YR}:Y7": LG, f"{QL}:Q1": GF, "General": ADM}
    cfg["fringe_map"] = {f"{YR}:Y1": f"{YR}:Y2", f"{QL}:Q1": f"{QL}:Q1", "General": "General"}
    cfg["org"]["ed"] = f"{f.first_name()} {f.last_name()}"
    cfg["contract"]["funder"]["signer"] = f"{f.first_name()} {f.last_name()}"
    cfg["grant"]["signer"] = f"{f.first_name()} {f.last_name()}"
    names = list(dict.fromkeys(f"{f.first_name()} {f.last_name()}" for _ in range(6)))[:4]
    E = [
        {"name": names[0], "role": "Head Coach", "gross": 242308, "loc": LG,
         "alloc": [(f"{YR}:Y1", 7500), ("UNRESTRICTED", 2500)]},
        {"name": names[1], "role": "Assistant Coach (part-time)", "gross": 92308, "loc": LG,
         "alloc": [(f"{YR}:Y1", 10000)]},
        {"name": names[2], "role": "Assistant Coach (part-time)", "gross": 84615, "loc": GF,
         "alloc": [(f"{YR}:Y1", 6000), (f"{QL}:Q1", 4000)]},
        {"name": names[3], "role": "Program Manager", "gross": 184615, "loc": GF,
         "alloc": [(f"{QL}:Q1", 5000), ("UNRESTRICTED", 5000)]},
        {"name": cfg["org"]["ed"], "role": "Executive Director", "gross": 346154, "loc": ADM,
         "alloc": [("UNRESTRICTED", 10000)]},
    ]
    ctx.employees = E
    pay_dates = [D("2026-07-09") + timedelta(days=14 * i) for i in range(9)]  # Jul 9 .. Oct 29
    overrides = {(D("2026-08-20"), names[3]): {"alloc": [(f"{QL}:Q1", 8000), ("UNRESTRICTED", 2000)]}}
    payroll(ctx, pay_dates, E, overrides)

    mk = lambda *a, **k: make_vendor(ctx, *a, **k)  # noqa: E731
    mk("fieldhouse", "Fieldhouse Sports Supply", "Fieldhouse Sports Supply", "fieldhouse-sports", "retail",
       "FIELDHOUSE SPORTS SUPPLY MARROW BAY", 875,
       [("Youth jersey, printed", 1899, 2499), ("Practice pinnies 12pk", 3499, 4499), ("Size 4 soccer ball", 1999, 2799),
        ("Basketball youth size 5", 2299, 2999), ("Shin guards youth", 899, 1399), ("Goalkeeper gloves", 1999, 2899),
        ("Agility ladder", 2499, 3299), ("Ball bag", 1599, 2199), ("Corner flags set", 3999, 4999)])
    mk("amazon", "Amazon.com", "Amazon", "amazon", "retail", "AMAZON MKTPL*Q71HD02B3", 875,
       [("Bluetooth speaker", 3999, 5999), ("USB-C cables 3pk", 1299, 1899), ("Agility cones 50pk", 1999, 2699),
        ("Desk organizer", 1999, 2899), ("First aid kit, sports", 2999, 4499), ("Ball pump with needles", 1299, 1899),
        ("Whistles 12pk", 899, 1299), ("Clipboards 6pk", 1399, 1999)])
    mk("kestrel", "Kestrel Print Works", "Kestrel Print Works", "kestrel-print", "invoice", "CHECK", 875,
       [("Vinyl tournament banner 3x8 ft", 8900, 11900), ("Game-day programs 300 ct", 7400, 9800),
        ("Field signage, coroplast", 4400, 6200)], terms="Terms: Net 15")
    mk("gullhaven", "Gullhaven Conference Hotel", "Gullhaven Conference Hotel", "gullhaven-hotel", "restaurant",
       "GULLHAVEN CONF HOTEL F&B", 875,
       [("Grilled salmon", 2899, 3299), ("Chicken piccata", 2499, 2899), ("Caesar salad", 1299, 1499),
        ("Iced tea", 399, 499), ("Seasonal vegetable risotto", 2299, 2599), ("Chocolate torte", 999, 1199)])
    mk("corvane", "Corvane Athletic Equipment", "Corvane Athletic Equipment", "corvane-athletic", "invoice", "CHECK",
       875, terms="Terms: Net 30")
    mk("harrow", "Harrow Hardware", "Harrow Hardware", "harrow-hardware", "retail", "HARROW HARDWARE #2", 875,
       [("Field marking chalk 50lb", 1899, 2399), ("Line marker paint 6pk", 3299, 3999), ("Zip ties 100ct", 599, 899)])
    mk("tidewell", "Tidewell Charter Coaches", "Tidewell Charter Coaches", "tidewell-charter", "invoice", "CHECK", 0,
       terms="Terms: Net 15")
    mk("eastfen", "Eastfen Sports Complex", "Eastfen Sports Complex", "eastfen-sports-complex", "invoice", "CHECK", 0,
       terms="Terms: Due on receipt")
    mk("greenline", "Greenline Grocery Outlet", "Greenline Grocery Outlet", "greenline-grocery", "retail",
       "GREENLINE GROCERY OUTLET", 0,
       [("Orange slices tray", 899, 1199), ("Sports drink 24pk", 1499, 1899), ("Granola bars 36ct", 1199, 1499),
        ("Bananas case", 1899, 2399), ("Water 24pk", 499, 699)])
    mk("slicehouse", "Brickoven Slice House", "Brickoven Slice House", "brickoven-slice-house", "restaurant",
       "BRICKOVEN SLICE HOUSE", 875,
       [("Extra-large cheese pizza", 2299, 2599), ("Extra-large pepperoni pizza", 2499, 2799),
        ("Caesar salad family", 1399, 1599), ("Lemonade pitcher", 899, 1099)])
    mk("meridel", "Meridel Coaching Institute", "Meridel Coaching Institute", "meridel-coaching", "invoice", "CHECK", 0,
       terms="Terms: Due on receipt")
    mk("saltmarsh", "Saltmarsh Row Properties", "Saltmarsh Row Properties", "saltmarsh-row", "invoice", "CHECK", 0,
       terms="Terms: Due on receipt")
    mk("insurance", "Abbotsford Mutual Sports Insurance", "Abbotsford Mutual", "abbotsford-mutual", "invoice",
       "CHECK", 0, terms="Terms: Net 30")
    mk("bankfee", "Tolland Bay Credit Union", "Tolland Bay Credit Union", "tolland-bay-cu", "invoice", "SHARE DRAFT FEE",
       0)
    ctx.vendors["corvane"]["inv_prefix"] = "CAE-"
    ctx.vendors["tidewell"]["inv_prefix"] = "TCC-"
    ctx.vendors["eastfen"]["inv_prefix"] = "ESC-"
    ctx.vendors["meridel"]["inv_prefix"] = "MCI-"

    A = {"eq": "5110 Sports Equipment & Uniforms", "trans": "5130 Player Transportation",
         "train": "5150 Coach Training & Travel", "field": "5210 Field Rental", "rent": "6010 Office Rent",
         "food": "5140 Team Meals & Snacks", "print": "5120 Printing", "ins": "6030 Insurance", "fee": "6050 Bank Fees",
         "supplies": "6020 Office & Misc Supplies", "capex": "1550 Equipment (capitalized)"}
    Y = lambda line: f"{YR}:{line}"  # noqa: E731
    Q = lambda line: f"{QL}:{line}"  # noqa: E731
    G = "General"
    c_ = lambda dollars: int(round(dollars * 100))  # noqa: E731
    X = {}

    X["h5"] = purchase(ctx, "2026-06-30", "fieldhouse", [(Y("Y3"), A["eq"], LG, c_(228), "uniform deposit")])
    for m in (7, 8, 9, 10):
        purchase(ctx, f"2026-{m:02d}-01", "eastfen", [(Y("Y6"), A["field"], LG, 115000, f"field rental {MON[m]}")],
                 ttype="Bill", exact=[(f"Turf field B, Saturday league blocks - {MONTHS[m]} 2026", 1, 115000)])
        purchase(ctx, f"2026-{m:02d}-01", "saltmarsh", [(G, A["rent"], ADM, 185000, "")], ttype="Bill", receipt=None,
                 exact=[("Office rent", 1, 185000)], inv_number=f"SR-{m:02d}26")
        purchase(ctx, month_end(2026, m).isoformat(), "bankfee", [(G, A["fee"], ADM, 1200, "")], receipt=None,
                 exact=[("Monthly fee", 1, 1200)], num="", pay="checking")
    # July
    purchase(ctx, "2026-07-08", "fieldhouse", [(Y("Y3"), A["eq"], LG, c_(1240), "uniforms")])
    purchase(ctx, "2026-07-11", "tidewell", [(Y("Y4"), A["trans"], LG, 145000, "charter 7/11")], ttype="Bill",
             exact=[("56-passenger coach, Marrow Bay - Fenwick tournament, round trip", 1, 145000)])
    X["h1"] = purchase(ctx, "2026-07-16", "fieldhouse", [(Y("Y3"), A["eq"], LG, c_(384), "pinnies")], gl_delta=2)
    purchase(ctx, "2026-07-18", "greenline", [(Q("Q3"), A["food"], GF, c_(86), "team snacks")], receipt="png")
    purchase(ctx, "2026-07-20", "amazon", [(G, A["supplies"], ADM, c_(58), "")], receipt=None)
    purchase(ctx, "2026-07-22", "meridel", [(Y("Y5"), A["train"], LG, 3850, "mileage")], ttype="Check", name=names[1],
             receipt=None, exact=[("Mileage 55 mi @ 0.70", 1, 3850)])
    purchase(ctx, "2026-07-25", "slicehouse", [(Q("Q3"), A["food"], GF, c_(142), "team pizza - players")])
    purchase(ctx, "2026-07-28", "meridel", [(Y("Y5"), A["train"], LG, 32500, "coach cert")], ttype="Bill",
             exact=[("Youth Coaching Certificate, Level 1 - registration", 1, 32500)])
    # August
    X["h6a"] = purchase(ctx, "2026-08-05", "kestrel", [(Y("Y3"), A["print"], LG, c_(276), "tournament banners")],
                        ttype="Bill", inv_number="KP-2210")
    X["h6b"] = duplicate_txn(ctx, X["h6a"], "2026-08-06", ttype="Check")
    purchase(ctx, "2026-08-08", "tidewell", [(Y("Y4"), A["trans"], LG, 198000, "charter 8/8")], ttype="Bill",
             exact=[("56-passenger coach x2, Harlow Valley league day, round trip", 1, 198000)])
    X["h2"] = purchase(ctx, "2026-08-12", "amazon", [(Y("Y3"), A["eq"], LG, c_(146), ""), (Q("Q2"), A["eq"], GF, c_(98), ""),
                                                     (G, A["supplies"], ADM, c_(61), "")],
                       must=[("Bluetooth speaker", 1, 4999), ("USB-C cables 3pk", 1, 1499), ("Desk organizer", 1, 2399)])
    purchase(ctx, "2026-08-14", "fieldhouse", [(Q("Q2"), A["eq"], GF, c_(420), "futsal balls")])
    purchase(ctx, "2026-08-19", "greenline", [(Q("Q3"), A["food"], GF, c_(72), "snacks - players")])
    purchase(ctx, "2026-08-22", "fieldhouse", [(Y("Y3"), A["eq"], LG, c_(640), "balls & nets")])
    purchase(ctx, "2026-08-26", "meridel", [(Y("Y5"), A["train"], LG, 4410, "mileage")], ttype="Check", name=names[0],
             receipt=None, exact=[("Mileage 63 mi @ 0.70", 1, 4410)])
    purchase(ctx, "2026-08-28", "insurance", [(G, A["ins"], ADM, 112000, "")], ttype="Bill", receipt=None,
             exact=[("Participant accident policy - installment", 1, 112000)])
    # September
    purchase(ctx, "2026-09-05", "tidewell", [(Y("Y4"), A["trans"], LG, 186000, "charter 9/5")], ttype="Bill",
             exact=[("56-passenger coach x2, county cup qualifier, round trip", 1, 186000)])
    purchase(ctx, "2026-09-09", "fieldhouse", [(Y("Y3"), A["eq"], LG, c_(520), "gk gloves")])
    purchase(ctx, "2026-09-12", "slicehouse", [(Q("Q3"), A["food"], GF, c_(156), "team meal")], receipt="png")
    purchase(ctx, "2026-09-16", "amazon", [(Y("Y3"), A["eq"], LG, c_(112), "first aid")])
    X["h3"] = purchase(ctx, "2026-09-19", "gullhaven", [(Y("Y5"), A["train"], LG, c_(268), "Coaches clinic dinner")],
                       must=[("House pinot noir (glass)", 3, 1300)])
    X["h3"].receipt.extra.update({"guests": 5, "server": "Theo"})
    purchase(ctx, "2026-09-23", "meridel", [(Y("Y5"), A["train"], LG, 32500, "coach cert")], ttype="Bill",
             exact=[("Youth Coaching Certificate, Level 1 - registration", 1, 32500)])
    purchase(ctx, "2026-09-26", "greenline", [(Q("Q3"), A["food"], GF, c_(64), "")])
    purchase(ctx, "2026-09-29", "meridel", [(Y("Y5"), A["train"], LG, 4175, "mileage")], ttype="Check", name=names[1],
             receipt=None, exact=[("Mileage 59.6 mi @ 0.70", 1, 4175)])
    # October
    y4 = [r for r in ctx.rows if r.cls == Y("Y4")]
    cap = 600000 * 115 // 100
    so_far = sum(r.amount for r in y4)
    assert so_far < cap
    x_amt = cap - so_far + 100 * rng.randint(180, 420)
    X["h10"] = purchase(ctx, "2026-10-03", "tidewell", [(Y("Y4"), A["trans"], LG, x_amt, "charter 10/3")], ttype="Bill",
                        exact=[("56-passenger coach x2, county cup finals, round trip", 1, x_amt)])
    X["h7"] = purchase(ctx, "2026-10-07", "corvane", [(Y("Y3"), A["eq"], LG, 0, "scoreboard")], ttype="Bill",
                       exact=[("Portable LED scoreboard with wireless controller", 1, 548000)],
                       fees=[("Installation", 38000)])
    purchase(ctx, "2026-10-10", "fieldhouse", [(Q("Q2"), A["eq"], GF, c_(310), "futsal goals nets")])
    X["h9"] = purchase(ctx, "2026-10-14", "harrow", [(Y("Y3"), A["eq"], LG, c_(63.40), "field chalk")], receipt=None,
                       num="")
    purchase(ctx, "2026-10-17", "slicehouse", [(Q("Q3"), A["food"], GF, c_(134), "players pizza")])
    purchase(ctx, "2026-10-21", "amazon", [(Q("Q2"), A["eq"], GF, c_(89), "pump & needles")], receipt="png")
    purchase(ctx, "2026-10-24", "meridel", [(Y("Y5"), A["train"], LG, 3620, "mileage")], ttype="Check", name=names[0],
             receipt=None, exact=[("Mileage 51.7 mi @ 0.70", 1, 3620)])
    for ds, desc, amt in [("2026-07-15", "DEPOSIT REGISTRATION FEES", 412500), ("2026-09-02", "ACH CREDIT QUENBY LARK FDN", 3000000),
                          ("2026-10-09", "DEPOSIT SPONSORSHIP", 150000)]:
        ctx.bank.append((D(ds), desc, amt, cfg["checking_memo"]))

    ind = fringe_and_indirect(ctx, [(2026, m) for m in (7, 8, 9, 10)], (2026, 9), "per_row_truncate")

    S = cfg["contract"]["sec"]
    ctx.issue("H-01", "receipt_amount_mismatch", f"§{S['receipts']}", "needs_review",
              f"Receipt total {fmt(X['h1'].receipt.total)} is $0.02 LOWER than the GL amount {fmt(X['h1'].total)}.",
              X["h1"].rows[0], evidence={"receipt": X["h1"].receipt.filename,
                                         "receiptTotalCents": X["h1"].receipt.total, "glAmountCents": X["h1"].total})
    ctx.issue("H-02", "purpose_unclear", f"§{S['purpose']}", "needs_review",
              "Amazon order split across YR-27-0093:Y3, QL-26-052:Q2 and General with empty memos; the receipt shows a "
              "Bluetooth speaker, cables and a desk organizer alongside sports items, so the county share's program "
              "purpose is not evident.",
              X["h2"].rows[0], related=X["h2"].rows[1:], evidence={"receipt": X["h2"].receipt.filename})
    ctx.issue("H-03", "unallowable_cost", f"§{S['alcohol']}", "blocked",
              "Coaches clinic dinner coded to Y5; the receipt includes 3 glasses of wine (alcohol). At minimum the "
              "alcohol plus its share of tax and tip is unallowable; the line cannot be claimed as booked.",
              X["h3"].rows[0], evidence={"receipt": X["h3"].receipt.filename, "alcoholSubtotalCents": 3900})
    io_ = ind[(2026, 9)]
    ctx.issue("H-04", "indirect_rate", f"§{S['indirect']}; §{S['arith']}", "blocked",
              f"September Y7 indirect booked {fmt(io_['booked'])}; 12% of September Y1 wages ({fmt(io_['base'])}) is "
              f"{fmt(io_['correct'])}. The bookkeeper truncated 12% on each paycheck line and summed.",
              io_["row"], extra={"correctIndirectCents": io_["correct"], "bookedIndirectCents": io_["booked"],
                                 "baseCents": io_["base"]})
    ctx.issue("H-05", "outside_period", f"§{S['period']}", "blocked",
              "Uniform deposit dated 2026-06-30 coded to YR-27-0093 (term starts 2026-07-01).",
              X["h5"].rows[0], evidence={"receipt": X["h5"].receipt.filename})
    ctx.issue("H-06", "duplicate_charge", f"§{S['duplicate']}", "needs_review",
              "Kestrel Print Works invoice KP-2210 entered as a Bill on 08/05 and again as a Check on 08/06 with the "
              "same Num and amount; one invoice, one bank payment.",
              X["h6b"].rows[0], related=X["h6a"].rows, evidence={"receipt": X["h6a"].receipt.filename})
    ctx.issue("H-07", "equipment_prior_approval", f"§{S['equipment']}", "blocked",
              f"Portable LED scoreboard {fmt(X['h7'].total)} incl. tax and installation, no prior written approval.",
              X["h7"].rows[0], evidence={"receipt": X["h7"].receipt.filename})
    p8 = next(r for r in ctx.rows if r.kind == "payroll" and r.date == D("2026-08-20") and r.name == names[3]
              and r.cls == Q("Q1"))
    allowed = split_weights(E[3]["gross"], [5000, 5000])[0]
    ctx.issue("H-08", "payroll_allocation_exceeded", f"QL-26-052 §{cfg['grant']['sec']['payroll']}", "needs_review",
              f"{names[3]} is allocated 50% to QL-26-052:Q1 ({fmt(allowed)}) but the 08/20 paycheck charged "
              f"{fmt(p8.amount)} (80%).", p8, extra={"allowedCents": allowed, "chargedCents": p8.amount})
    ctx.issue("H-09", "receipt_missing", f"§{S['receipts']}", "blocked",
              f"Harrow Hardware {fmt(X['h9'].total)} coded to Y3 with no receipt; the county threshold is $50 (not $75).",
              X["h9"].rows[0])
    ctx.plant_e = X["h10"]
    ctx.indirect = ind
    return X


# --------------------------------------------------------------------------- checks, expected, writers
def cumulative_crossing(rows, cls, cap, exclude=frozenset()):
    tot = 0
    for r in sorted((r for r in rows if r.cls == cls and r.seq not in exclude), key=lambda r: (r.date, r.seq)):
        tot += r.amount
        if tot > cap:
            return r, tot
    return None, tot


def finalize(ctx: Ctx, X: dict, budget_issue_id: str):
    cfg = ctx.cfg
    c = cfg["contract"]
    g = cfg["grant"]
    rows = ctx.rows
    # ---- (e) budget-line variance: verify crossing row under three interpretations
    e_row = ctx.plant_e.rows[0]
    line = e_row.cls.split(":")[1]
    ann = next(a for code, _, a, _ in c["lines"] if code == line)
    cap = ann * (100 + c["variance_pct"]) // 100
    blocked = frozenset(r.seq for r in rows if r.meta.get("status") == "blocked")
    flagged = frozenset(r.seq for r in rows if r.meta.get("issue") or r.meta.get("related"))
    for excl in (frozenset(), blocked, flagged):
        hit, _ = cumulative_crossing(rows, e_row.cls, cap, excl)
        assert hit is e_row, (hit, e_row)
    cum_all = cumulative_crossing(rows, e_row.cls, 10 ** 12)[1]
    S = c["sec"]
    ctx.issue(budget_issue_id, "budget_line_variance", f"§{S['variance']}", "blocked",
              f"Cumulative {line} through October reaches {fmt(cum_all)} (all booked rows) against an annual line of "
              f"{fmt(ann)}; the {c['variance_pct']}% ceiling is {fmt(cap)}. This October charge is the one that "
              f"crosses the ceiling (true whether or not other flagged rows are excluded).",
              e_row, evidence={"receipt": ctx.plant_e.receipt.filename if ctx.plant_e.receipt and ctx.plant_e.receipt.fmt != "none" else None},
              extra={"annualLineCents": ann, "ceilingCents": cap, "cumulativeThroughOctCents": cum_all})
    # other lines must stay under their ceilings
    for gid, lines, vp in ((c["id"], c["lines"], c["variance_pct"]), (g["id"], g["lines"], g["variance_pct"])):
        for code, _, a, _ in lines:
            cls = f"{gid}:{code}"
            if cls == e_row.cls:
                continue
            hit, tot = cumulative_crossing(rows, cls, a * (100 + vp) // 100)
            assert hit is None, (cls, tot)
    # ---- guards against accidental issues on clean rows
    issue_rows = {r.seq for r in rows if r.meta.get("issue") or r.meta.get("related")}
    thr = c["receipt_threshold"]
    cs, ce = D(c["start"]), D(c["end"])
    gs, ge = D(g["start"]), D(g["end"])
    for t in ctx.txns:
        clean = all(r.seq not in issue_rows for r in t.rows)
        if not clean:
            continue
        for r in t.rows:
            if r.cls.startswith(c["id"]):
                assert cs <= r.date <= ce, r
            if r.cls.startswith(g["id"]):
                assert gs <= r.date <= ge, r
        grant_coded = any(r.cls != "General" for r in t.rows)
        if t.vendor_key not in ("payroll", "je") and grant_coded and abs(t.total) >= thr:
            assert t.receipt and t.receipt.fmt != "none", (t.date, t.name, t.total)
        if t.receipt and t.receipt.fmt != "none":
            assert t.receipt.total == t.total, (t.name, t.total)
    # receipts: each must match exactly one GL txn by vendor+amount within 7 days (except planted)
    for t in ctx.txns:
        r = t.receipt
        if not r or r.fmt == "none":
            continue
        cands = [u for u in ctx.txns if u.vendor_key == t.vendor_key and u.total == r.total
                 and abs((u.date - r.date).days) <= 7]
        planted = any(x.meta.get("issue") or x.meta.get("related") for x in t.rows)
        if not planted:
            assert len(cands) == 1, (r.filename, [(u.date, u.total) for u in cands])
        # no other receipt with same total
        same = [u for u in ctx.txns if u is not t and u.receipt and u.receipt.fmt != "none" and u.receipt.total == r.total
                and u.vendor_key == t.vendor_key and abs((u.date - t.date).days) <= 7]
        assert not same, r.filename
    # duplicate guard
    np_txns = [t for t in ctx.txns if t.vendor_key not in ("payroll", "je")]
    for i, a in enumerate(np_txns):
        for b in np_txns[i + 1:]:
            if a.vendor_key == b.vendor_key and a.total == b.total and abs((a.date - b.date).days) <= 2:
                assert any(x.meta.get("issue") for x in a.rows + b.rows), (a.name, a.date, b.date)
    # unique row refs
    keys = [(r.date, r.num, r.name, r.amount, r.cls) for r in rows]
    assert len(keys) == len(set(keys)), "row refs not unique"


def packages(ctx: Ctx):
    c = ctx.cfg["contract"]
    cid = c["id"]
    issues_by_id = {i["id"]: i for i in ctx.issues}
    out = []
    ind_cls = f"{cid}:{c['indirect_line']}"
    pre = [r for r in ctx.rows if r.cls.startswith(cid + ":") and r.date < D(c["start"])]
    for (y, m), ind in sorted(ctx.indirect.items()):
        rows_m = [r for r in ctx.rows if r.cls.startswith(cid + ":") and (r.date.year, r.date.month) == (y, m)]
        booked = sum(r.amount for r in rows_m)
        excluded, by_line, kinds = [], {}, set()
        clean_only = 0
        for r in rows_m:
            iid = r.meta.get("issue")
            if iid:
                kinds.add(issues_by_id[iid]["kind"])
            code = r.cls.split(":")[1]
            if r.cls == ind_cls:
                continue
            if iid and r.meta.get("status") == "blocked":
                excluded.append(iid)
                continue
            by_line[code] = by_line.get(code, 0) + r.amount
            if not iid and not r.meta.get("related"):
                clean_only += r.amount
        by_line[c["indirect_line"]] = ind["correct"]
        if (y, m) == (2026, 7) and pre:
            for r in pre:
                kinds.add(issues_by_id[r.meta["issue"]]["kind"])
        exp_total = sum(by_line.values())
        out.append({
            "grant": cid,
            "period": f"{y}-{m:02d}",
            "dueDate": iso(month_end(y, m) + timedelta(days=30)),
            "glBookedTotalCents": booked,
            "expectedInvoiceTotalCents": exp_total,
            "cleanOnlyTotalCents": clean_only + ind["correct"],
            "byLineCents": dict(sorted(by_line.items())),
            "indirect": {"baseLine": c["indirect_base"], "baseCents": ind["base"], "rateBp": c["indirect_bp"],
                         "correctCents": ind["correct"], "bookedCents": ind["booked"]},
            "excludedIssueIds": sorted(set(excluded)),
            "expectedChecksFailing": sorted(kinds),
        })
    return out


def write_outputs(ctx: Ctx, out_dir: Path, readme: str):
    cfg = ctx.cfg
    if out_dir.exists():
        shutil.rmtree(out_dir)
    (out_dir / "receipts").mkdir(parents=True)
    write_contract(out_dir / cfg["contract_file"], cfg)
    write_grant(out_dir / cfg["grant_file"], cfg)
    # GL
    rows = sorted(ctx.rows, key=lambda r: (r.account, r.date, r.ttype, r.num, r.name, r.cls, r.seq))
    with open(out_dir / "gl_detail_qb.csv", "w", newline="") as fh:
        w = csv.writer(fh, lineterminator="\n")
        w.writerow(["Date", "Transaction Type", "Num", "Name", "Memo/Description", "Account", "Class", "Location",
                    "Split", "Amount"])
        for r in rows:
            w.writerow([d2(r.date), r.ttype, r.num, r.name, r.memo, r.account, r.cls, r.location, r.split, fmt(r.amount)])
    # bank
    with open(out_dir / "bank_statement.csv", "w", newline="") as fh:
        w = csv.writer(fh, lineterminator="\n")
        w.writerow(["Posting Date", "Description", "Amount", "Memo"])
        for d, desc, amt, memo in sorted(ctx.bank, key=lambda b: (b[0], b[1], b[2])):
            w.writerow([d2(d), desc, fmt(amt), memo])
    # staff allocation
    with open(out_dir / "staff_allocation.csv", "w", newline="") as fh:
        w = csv.writer(fh, lineterminator="\n")
        w.writerow(["employee", "role", "biweekly_gross_usd", "allocation"])
        for e in ctx.employees:
            w.writerow([e["name"], e["role"], fmt(e["gross"]),
                        ";".join(f"{k}={bp // 100}%" for k, bp in e["alloc"])])
    (out_dir / "precedents.json").write_text(json.dumps(cfg["precedents"], indent=2, ensure_ascii=False) + "\n")
    # receipts
    png_rng = random.Random(cfg["seed"] + 1)
    n_pdf = n_png = 0
    for t in ctx.txns:
        r = t.receipt
        if not r or r.fmt == "none":
            continue
        r.extra.setdefault("auth", f"{png_rng.randint(100000, 999999)}")
        r.extra.setdefault("cashier", f"{png_rng.randint(10, 99):03d}")
        r.extra.setdefault("reg", png_rng.randint(1, 9))
        p = out_dir / "receipts" / r.filename
        if r.fmt == "png":
            ang = png_rng.choice([-1, 1]) * png_rng.randint(15, 40) / 10
            draw_receipt_png(p, r, ang, png_rng)
            n_png += 1
        elif r.kind == "invoice":
            draw_invoice_pdf(p, r, cfg["org"])
            n_pdf += 1
        else:
            draw_receipt_pdf(p, r)
            n_pdf += 1
    # expected
    issue_seqs = {r.seq for r in ctx.rows if r.meta.get("issue") or r.meta.get("related")}
    clean = [{"date": iso(r.date), "num": r.num, "name": r.name, "amount": fmt(r.amount), "class": r.cls,
              "account": r.account}
             for r in rows if r.seq not in issue_seqs]
    assert len(clean) >= 100, len(clean)
    expected = {
        "_label": f"{SYNTH}. Answer key — the app must never read this file.",
        "conventions": {"dates": "ISO YYYY-MM-DD (the GL CSV itself uses MM/DD/YYYY)",
                        "amount": "2-decimal string exactly as in the GL Amount column",
                        "cents": "*Cents fields are integers",
                        "packageTotals": "expectedInvoiceTotalCents = contract rows dated in the period, minus rows "
                                         "whose issue is 'blocked', with the indirect line restated to the correctly "
                                         "computed amount; needs_review rows are included at booked amount. "
                                         "cleanOnlyTotalCents additionally drops every needs_review and related row."},
        "issues": sorted(ctx.issues, key=lambda i: i["id"]),
        "clean": clean,
        "packages": packages(ctx),
    }
    (out_dir / "expected_v2.json").write_text(json.dumps(expected, indent=2, ensure_ascii=False) + "\n")
    (out_dir / "README.md").write_text(readme)
    return {"rows": len(ctx.rows), "clean": len(clean), "pdf_receipts": n_pdf, "png_receipts": n_png,
            "issues": len(ctx.issues), "bank": len(ctx.bank)}


GL_CONVENTIONS = """\
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
| `Class` | Funding source and budget line, `GRANT-ID:LINE` (e.g. `{cls_example}`), or `General` for unrestricted |
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
"""


def regen_block(extra=""):
    return f"""\
## Regenerate

```bash
uv run --with reportlab --with faker python scripts/generate_v2.py
```

Deterministic (fixed seeds, reportlab invariant mode). {extra}
"""


def demo_readme(cfg):
    return f"""\
# steward-data-v2 — demo set

> **{SYNTH}.** Every organization, agency, foundation, person, address, phone number, receipt and amount in
> this folder is fictional. (A few common retailer names appear only as vendor labels on fabricated receipts.)

Development / tuning set for Steward v2: check a nonprofit's **GL detail + receipts** against its grant
contracts and build a monthly invoice + expenditure report that ties out to the cent.

- Organization: **{cfg['org']['name']}** (fictional), fiscal year July 2026 – June 2027, billing months
  July – October 2026.
- `{cfg['contract_file']}` — City of Port Calloway (fictional) cost-reimbursement contract, $240,000, monthly
  invoices, Exhibit A line-item budget C1–C7.
- `{cfg['grant_file']}` — Thistlewick Foundation (fictional) restricted grant, $50,000, lines F1–F4, quarterly
  reporting.
- `gl_detail_qb.csv`, `receipts/`, `bank_statement.csv`, `staff_allocation.csv`, `precedents.json` — see below.
- `expected_v2.json` — answer key for evaluation. **Planted issues are listed in expected_v2.json.** The app must
  never read it.

{GL_CONVENTIONS.format(cls_example='FS-27-0412:C3')}
{regen_block("Also rebuilds the sealed hold-out zip (`steward-holdout-v2-SEALED.zip`); do not unzip it while tuning.")}"""


def holdout_readme(cfg):
    return f"""\
# steward-holdout-v2 — SEALED hold-out set

> **{SYNTH}.** All parties, people, receipts and amounts are fictional.

Written before any tuning of Steward v2, from the same generator as `steward-data-v2/` but with a different
seed, organization, funders, vendors, clause numbering, thresholds and issue forms. Do not tune on it.

- Organization: **{cfg['org']['name']}** (fictional youth sports nonprofit), FY July 2026 – June 2027,
  billing months July – October 2026.
- `{cfg['contract_file']}` — County of Marrow Bay (fictional) Office of Youth Recreation cost-reimbursement agreement,
  $150,000, monthly invoices, lines Y1–Y7.
- `{cfg['grant_file']}` — Quenby Lark Foundation (fictional) restricted grant, $60,000, lines Q1–Q4.
- `expected_v2.json` — answer key (planted issues, clean rows, package totals).

{GL_CONVENTIONS.format(cls_example='YR-27-0093:Y3')}
{regen_block()}"""


def sha256_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def tree_hash(d: Path) -> str:
    h = hashlib.sha256()
    for p in sorted(d.rglob("*")):
        if p.is_file():
            h.update(str(p.relative_to(d)).encode())
            h.update(hashlib.sha256(p.read_bytes()).digest())
    return h.hexdigest()


def zip_sealed(src: Path, zpath: Path):
    if zpath.exists():
        zpath.unlink()
    with zipfile.ZipFile(zpath, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for p in sorted(src.rglob("*")):
            if p.is_file():
                arc = f"{src.name}/{p.relative_to(src).as_posix()}"
                zi = zipfile.ZipInfo(arc, date_time=(2026, 11, 22, 0, 0, 0))
                zi.compress_type = zipfile.ZIP_DEFLATED
                zi.external_attr = 0o644 << 16
                zi.create_system = 3
                zf.writestr(zi, p.read_bytes())


def main():
    # demo
    cfg = json.loads(json.dumps(DEMO_CFG))
    cfg["contract_file"] = "contract_city_FS-27-0412.pdf"
    cfg["grant_file"] = "grant_foundation_RF-26-118.pdf"
    ctx = Ctx(cfg)
    X = build_demo(ctx)
    f = ctx.fake
    cfg["precedents"] = [
        {"date": "2026-07-01", "by": f"{f.first_name()} {f.last_name()} (Program Officer, City of Port Calloway "
                                     f"Department of Family Services — fictional)",
         "ruling": "No prior written approval has been requested or granted for any equipment purchase under §7.2 "
                   "of FS-27-0412 as of this date.", "scope": "FS-27-0412"},
        {"date": "2026-07-08", "by": f"{cfg['contract']['funder']['signer']} (Director, Department of Family Services — fictional)",
         "ruling": "Meals for enrolled families during scheduled Family Night sessions are allowable participant "
                   "support on Line C4. Staff-only meals and staff appreciation events are not allowable (§6.2).",
         "scope": "FS-27-0412"},
        {"date": "2026-06-05", "by": f"{cfg['grant']['signer']} (Program Officer, Thistlewick Foundation — fictional)",
         "ruling": "Materials charged to F2 must be used by Puentes Youth Mentoring participants; general office "
                   "supplies for the organization are not eligible.", "scope": "RF-26-118"},
    ]
    finalize(ctx, X, "D-e")
    demo_dir = ROOT / cfg["out"]
    stats_demo = write_outputs(ctx, demo_dir, demo_readme(cfg))
    demo_pkgs = packages(ctx)

    # hold-out
    hcfg = json.loads(json.dumps(HOLD_CFG))
    hcfg["contract_file"] = "agreement_county_YR-27-0093.pdf"
    hcfg["grant_file"] = "grant_foundation_QL-26-052.pdf"
    hctx = Ctx(hcfg)
    HX = build_holdout(hctx)
    f = hctx.fake
    hcfg["precedents"] = [
        {"date": "2026-07-01", "by": f"{hcfg['contract']['funder']['signer']} (Director, Office of Youth Recreation, "
                                     f"County of Marrow Bay — fictional)",
         "ruling": "No prior written approval has been requested or granted for any equipment purchase under §11.4 "
                   "of YR-27-0093 as of this date.", "scope": "YR-27-0093"},
        {"date": "2026-07-14", "by": f"{f.first_name()} {f.last_name()} (Contract Analyst, Office of Youth Recreation — fictional)",
         "ruling": "Coach certification registration and clinic meals are allowable on Y5; alcohol served with any "
                   "meal is not (§9.1) and must be removed with its share of tax and tip.", "scope": "YR-27-0093"},
        {"date": "2026-06-20", "by": f"{hcfg['grant']['signer']} (Senior Program Officer, Quenby Lark Foundation — fictional)",
         "ruling": "Post-game meals and snacks for registered players are allowable on Q3. Coach-only meals are not.",
         "scope": "QL-26-052"},
    ]
    finalize(hctx, HX, "H-10")
    hold_dir = ROOT / hcfg["out"]
    stats_hold = write_outputs(hctx, hold_dir, holdout_readme(hcfg))
    zpath = ROOT / "steward-holdout-v2-SEALED.zip"
    zip_sealed(hold_dir, zpath)
    shutil.rmtree(hold_dir)

    print("demo:", json.dumps(stats_demo))
    print("demo issues:")
    for i in sorted(ctx.issues, key=lambda i: i["id"]):
        g = i["glRef"]
        print(f"  {i['id']:5} {i['kind']:28} {i['expectedStatus']:12} {i['expectedRule']:22} "
              f"{g['date']} {g['num'] or '-':10} {g['name'][:28]:28} {g['amount']:>9} {g['class']}")
    print("demo packages:")
    for p in demo_pkgs:
        print(f"  {p['grant']} {p['period']} booked={fmt(p['glBookedTotalCents'])} "
              f"expected={fmt(p['expectedInvoiceTotalCents'])} cleanOnly={fmt(p['cleanOnlyTotalCents'])} "
              f"failing={p['expectedChecksFailing']}")
    print("holdout:", json.dumps(stats_hold))
    print("demo tree sha256:", tree_hash(demo_dir))
    print("sealed zip sha256:", sha256_file(zpath))


if __name__ == "__main__":
    sys.exit(main())
