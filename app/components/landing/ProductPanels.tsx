import { Strike } from "./Strike";

/* Static product mocks. Every number here is SYNTHETIC demo data and each panel says so. */

function SyntheticTag() {
  return <span className="ld-tag">Synthetic data</span>;
}

function PanelHead({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div className="ld-panel__head">
      <div>
        <p className="ld-panel__kicker">{kicker}</p>
        <p className="ld-panel__title">{title}</p>
      </div>
      <SyntheticTag />
    </div>
  );
}

function Mark({ ok }: { ok: boolean }) {
  return (
    <span className={`ld-mark ${ok ? "ld-mark--ok" : "ld-mark--no"}`} aria-hidden>
      {ok ? (
        <svg viewBox="0 0 16 16">
          <path d="M3.5 8.4 6.6 11.3 12.5 4.9" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16">
          <path d="M8 3.6v5.6M8 11.6v.6" />
        </svg>
      )}
    </span>
  );
}

export function HeroCard() {
  return (
    <div className="ld-card ld-hero-card" role="group" aria-label="Example review, synthetic data">
      <div className="ld-panel__head">
        <div>
          <p className="ld-panel__kicker">City contract FS-27-0412</p>
          <p className="ld-panel__title">October 2026 invoice</p>
        </div>
        <SyntheticTag />
      </div>

      <div className="ld-hero-card__amount">
        <p className="ld-panel__kicker">Claimable this month</p>
        <p className="ld-amount">$17,872.21</p>
      </div>

      <div className="ld-progress">
        <p className="ld-progress__label">
          <span>5 of 7 checks pass</span>
          <span className="ld-progress__left">2 left for review</span>
        </p>
        <div className="ld-progress__bar" aria-hidden>
          {Array.from({ length: 7 }, (_, i) => (
            <span key={i} className={i < 5 ? "is-ok" : "is-no"} />
          ))}
        </div>
      </div>

      <ul className="ld-exceptions" aria-label="Exceptions">
        <li>
          <Mark ok={false} />
          <div>
            <p className="ld-exceptions__title">Amazon receipt is $0.01 more than the ledger line</p>
            <p className="ld-exceptions__meta">
              Ledger{" "}
              <Strike draw delay={1100} label="struck:">
                $48.36
              </Strike>{" "}
              · Receipt $48.37
            </p>
          </div>
        </li>
        <li>
          <Mark ok={false} />
          <div>
            <p className="ld-exceptions__title">
              Office Depot $166.22 — no receipt, vendor billed to two grants this month
            </p>
            <p className="ld-exceptions__meta">
              <Strike draw delay={1450} label="struck:">
                Claimed on FS-27-0412
              </Strike>{" "}
              · held for review
            </p>
          </div>
        </li>
      </ul>

      <div className="ld-hero-card__foot">
        <span>Senior accountant signs after review</span>
        <span className="ld-chip-disabled" aria-hidden>
          Sign
        </span>
      </div>
    </div>
  );
}

export function CheckPanel() {
  return (
    <div className="ld-card ld-panel">
      <PanelHead kicker="Check · GL line against the contract" title="Oct 14 · Office Depot · 6120 Supplies" />
      <div className="ld-row ld-row--strong">
        <span>Amount</span>
        <span className="ld-num">$166.22</span>
      </div>
      <blockquote className="ld-clause">
        <p>
          “Each cost claimed must be supported by an itemized receipt or invoice dated within the billing
          period.”
        </p>
        <footer>Contract FS-27-0412 · §7.3 Supporting documentation</footer>
      </blockquote>
      <div className="ld-result ld-result--no">
        <Mark ok={false} />
        <span>No receipt found — exception, cites §7.3</span>
      </div>
      <div className="ld-result ld-result--ok">
        <Mark ok />
        <span>Oct 03 · Staples · $212.40 — receipt on file, §7.3 met</span>
      </div>
    </div>
  );
}

export function MatchPanel() {
  return (
    <div className="ld-card ld-panel">
      <PanelHead kicker="Match · receipt to ledger line" title="Oct 09 · Amazon · 6120 Supplies" />
      <div className="ld-match">
        <div className="ld-match__side">
          <p className="ld-panel__kicker">Receipt</p>
          <p className="ld-match__vendor">Amazon.com order</p>
          <p className="ld-match__amt ld-num">$48.37</p>
          <p className="ld-match__meta">Oct 09 · order total</p>
        </div>
        <div className="ld-match__link" aria-hidden>
          <span />
          <em>≠</em>
          <span />
        </div>
        <div className="ld-match__side">
          <p className="ld-panel__kicker">GL line</p>
          <p className="ld-match__vendor">AMAZON MKTPL</p>
          <p className="ld-match__amt ld-num">
            <Strike label="struck:">$48.36</Strike>
          </p>
          <p className="ld-match__meta">Oct 09 · 6120 Supplies</p>
        </div>
      </div>
      <div className="ld-result ld-result--no">
        <Mark ok={false} />
        <span>Differs by $0.01. Not rounded — a person decides.</span>
      </div>
      <div className="ld-result ld-result--ok">
        <Mark ok />
        <span>Oct 02 · Comcast Business · $89.95 = $89.95</span>
      </div>
    </div>
  );
}

const TIE_OUT: { label: string; value: string; ok: boolean }[] = [
  // The same seven tie-out checks the app runs (lib/tieOut.ts), in its own words.
  { label: "Invoice, expenditure report and ledger agree", value: "$17,872.21", ok: true },
  { label: "Indirect computed once, to the cent", value: "10.00%", ok: true },
  { label: "Every budget line within its cap", value: "6 of 6", ok: true },
  { label: "Every charge in the billing period", value: "Oct 1–31", ok: true },
  { label: "Lines approved for the program", value: "42 of 42", ok: true },
  { label: "A receipt for every charge over $75", value: "41 of 42", ok: false },
  { label: "No open exceptions", value: "2 open", ok: false },
];

export function TieOutPanel() {
  return (
    <div className="ld-card ld-panel">
      <PanelHead kicker="Tie out · expenditure report" title="5 of 7 checks pass" />
      <ul className="ld-checklist">
        {TIE_OUT.map((row) => (
          <li key={row.label} className={row.ok ? "" : "is-no"}>
            <Mark ok={row.ok} />
            <span className="ld-checklist__label">{row.label}</span>
            <span className="ld-num">{row.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SignPanel() {
  return (
    <div className="ld-card ld-panel">
      <PanelHead kicker="Sign · reviewer" title="October 2026 invoice package" />
      <div className="ld-ready">
        <Mark ok />
        <div>
          <p className="ld-ready__title">Ready to submit</p>
          <p className="ld-ready__meta">7 of 7 checks pass · 2 exceptions cleared by the reviewer</p>
        </div>
      </div>
      <div className="ld-sign">
        <div className="ld-row">
          <span>Prepared by</span>
          <span>Staff accountant</span>
        </div>
        <div className="ld-row">
          <span>Reviewed by</span>
          <span className="ld-sign__line">Senior accountant</span>
        </div>
        <div className="ld-row">
          <span>Package</span>
          <span>Invoice · Expenditure report · 42 receipts</span>
        </div>
      </div>
      <p className="ld-cant">
        <strong>Steward can&rsquo;t sign.</strong> The reviewer must be someone other than the preparer.
      </p>
    </div>
  );
}
