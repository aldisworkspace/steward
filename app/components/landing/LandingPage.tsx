import Link from "next/link";
import type { CSSProperties } from "react";
import { landingSans, landingSerif } from "./fonts";
import { HeroCard } from "./ProductPanels";
import { ProductReveal } from "./ProductReveal";
import { Strike } from "./Strike";
import "./landing.css";

const GITHUB = "https://github.com/aldisworkspace/steward";
const DEMO_HREF = "/app";
const PRIMARY = "Watch a package get ready";

function Eyebrow({ children }: { children: string }) {
  return (
    <p className="ld-eyebrow">
      <span aria-hidden className="ld-eyebrow__rule" />
      {children}
    </p>
  );
}

function Arrow() {
  return (
    <svg className="ld-arrow" viewBox="0 0 16 16" aria-hidden>
      <path d="M3 8h9.5M8.5 4l4 4-4 4" />
    </svg>
  );
}

const STEPS = [
  {
    n: "01",
    title: "Upload GL detail and receipts",
    body: "The month’s GL detail as a QuickBooks, Xero or Sage export, plus the receipts folder.",
    chips: ["GL_detail_Oct.csv", "receipts/ · 42 files"],
  },
  {
    n: "02",
    title: "Steward checks every line",
    body: "Against the contract’s terms and against the receipts. Rules decide pass or fail, not the model.",
    chips: ["42 lines checked", "2 exceptions"],
  },
  {
    n: "03",
    title: "Review, sign, export",
    body: "Your senior accountant opens only the exceptions, clears them, signs and downloads the invoice package.",
    chips: ["Invoice", "Expenditure report", "Receipts"],
  },
];

const WONT = [
  {
    verb: "Approve its own work",
    body: "Preparer and reviewer are two different people. Steward is neither of them.",
  },
  {
    verb: "Post entries",
    body: "It reads your GL export. Corrections go back to your team as notes, never into the books.",
  },
  {
    verb: "Move money",
    body: "No bank connection and no payment access. It builds the package; your team submits it.",
  },
  {
    verb: "Guess when a receipt is missing",
    body: "A missing receipt stays an exception until someone attaches one.",
  },
];

export function LandingPage() {
  return (
    <div className={`ld ${landingSans.variable} ${landingSerif.variable}`}>
      <a href="#main" className="ld-skip">
        Skip to content
      </a>

      <header className="ld-nav">
        <div className="ld-wrap ld-nav__row">
          <Link href="/" className="ld-wordmark" aria-label="Steward home">
            <span aria-hidden className="ld-wordmark__mark">
              S
            </span>
            Steward
          </Link>
          <nav aria-label="Sections" className="ld-nav__links">
            <a href="#how">How it works</a>
            <a href="#safeguards">Safeguards</a>
            <a href="#testing">Testing</a>
            <a href={GITHUB} target="_blank" rel="noreferrer">
              GitHub
            </a>
          </nav>
          <Link href={DEMO_HREF} className="ld-btn ld-btn--primary ld-btn--sm ld-nav__cta">
            {PRIMARY}
          </Link>
        </div>
      </header>

      <main id="main">
        {/* Hero: Z-pattern — wordmark, nav CTA, headline, product card. */}
        <section className="ld-hero" aria-labelledby="hero-title">
          <div className="ld-wrap ld-hero__grid">
            <div className="ld-hero__text">
              <div className="ld-enter" style={{ "--i": 0 } as CSSProperties}>
                <Eyebrow>Pre-submission review for grant invoices</Eyebrow>
              </div>
              <h1 id="hero-title" className="ld-h1 ld-enter-rise">
                Grant invoices that don&rsquo;t <em className="ld-italic">come back.</em>
              </h1>
              <p className="ld-lead ld-enter" style={{ "--i": 1 } as CSSProperties}>
                Steward checks every GL line against the contract, matches receipts, and ties the expenditure
                report to the penny — your senior accountant reviews only the exceptions and signs.
              </p>
              <div className="ld-cta-row ld-enter" style={{ "--i": 2 } as CSSProperties}>
                <Link href={DEMO_HREF} className="ld-btn ld-btn--primary">
                  {PRIMARY}
                  <Arrow />
                </Link>
                <a href="#how" className="ld-btn ld-btn--ghost">
                  How it works
                </a>
              </div>
              <p className="ld-micro ld-enter" style={{ "--i": 3 } as CSSProperties}>
                Synthetic demo data · no sign-up · about 2 minutes
              </p>
            </div>
            <div className="ld-hero__card">
              <HeroCard />
            </div>
          </div>
        </section>

        {/* The film: one minute, sound on click (no autoplay). */}
        <section id="film" className="ld-section ld-section--film" aria-labelledby="film-title">
          <div className="ld-wrap">
            <Eyebrow>The one-minute film</Eyebrow>
            <h2 id="film-title" className="ld-h2 ld-h2--narrow">
              Watch one invoice get <em className="ld-italic">checked.</em>
            </h2>
            <figure className="ld-film">
              <video
                className="ld-film__video"
                controls
                playsInline
                preload="none"
                poster="/demo/steward-demo-poster.jpg"
                aria-describedby="film-caption"
              >
                <source src="/demo/steward-demo.mp4" type="video/mp4" />
                Your browser can&rsquo;t play this video. <a href="/demo/steward-demo.mp4">Download it (MP4, 5 MB)</a>.
              </video>
              <figcaption id="film-caption" className="ld-micro">
                62 seconds, with sound. A staff dinner is caught against the contract, then the October invoice ties
                out to the cent. Synthetic demo data, fictional organization.
              </figcaption>
            </figure>
          </div>
        </section>

        {/* Loss framing: the cost of one cent. */}
        <section className="ld-section" aria-labelledby="returned-title">
          <div className="ld-wrap ld-split">
            <div>
              <Eyebrow>Why it matters</Eyebrow>
              <h2 id="returned-title" className="ld-h2">
                A <em className="ld-italic">one-cent</em> error sends the whole batch back.
              </h2>
              <p className="ld-body">
                On a cost-reimbursement contract the city returns the invoice, not the line. So a junior
                accountant compiles, a senior accountant re-checks every charge, and the month&rsquo;s
                reimbursement waits on that second pass.
              </p>
              <p className="ld-body ld-body--ink">
                Steward does the line-by-line pass first, so the senior review starts at the exceptions.
              </p>
            </div>
            <div className="ld-returned" role="group" aria-label="Returned invoice notice, synthetic example">
              <div className="ld-returned__head">
                <span>Reimbursement request · October</span>
                <span className="ld-tag ld-tag--dark">Synthetic example</span>
              </div>
              <p className="ld-returned__status">
                <Strike label="struck:">Approved for payment</Strike>
                <span className="ld-returned__flag">Returned</span>
              </p>
              <dl className="ld-returned__rows">
                <div>
                  <dt>Invoice total</dt>
                  <dd>$17,872.21</dd>
                </div>
                <div>
                  <dt>Expenditure report total</dt>
                  <dd>$17,872.22</dd>
                </div>
                <div className="is-diff">
                  <dt>Difference</dt>
                  <dd>$0.01</dd>
                </div>
              </dl>
              <p className="ld-returned__note">Correct and resubmit the full package.</p>
            </div>
          </div>
        </section>

        {/* How it works: numbered steps. */}
        <section id="how" className="ld-section" aria-labelledby="how-title">
          <div className="ld-wrap">
            <Eyebrow>How it works</Eyebrow>
            <h2 id="how-title" className="ld-h2 ld-h2--narrow">
              From GL export to a signed <em className="ld-italic">invoice package.</em>
            </h2>
            <ol className="ld-steps">
              {STEPS.map((s) => (
                <li key={s.n} className="ld-step">
                  <p className="ld-step__n">
                    <span aria-hidden className="ld-eyebrow__rule" />
                    {s.n}
                  </p>
                  <h3 className="ld-h3">{s.title}</h3>
                  <p className="ld-body">{s.body}</p>
                  <ul className="ld-step__chips" aria-label="Example">
                    {s.chips.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Sticky product reveal: Check · Match · Tie out · Sign. */}
        <section className="ld-section ld-section--reveal" aria-labelledby="review-title">
          <div className="ld-wrap">
            <Eyebrow>Inside one review</Eyebrow>
            <h2 id="review-title" className="ld-h2 ld-h2--narrow">
              Every line, checked <em className="ld-italic">before</em> anyone signs.
            </h2>
            <ProductReveal />
          </div>
        </section>

        {/* Safeguards: separation of duties. */}
        <section id="safeguards" className="ld-section" aria-labelledby="wont-title">
          <div className="ld-wrap">
            <Eyebrow>Safeguards</Eyebrow>
            <h2 id="wont-title" className="ld-h2">
              What Steward <em className="ld-italic">won&rsquo;t</em> do.
            </h2>
            <p className="ld-body ld-body--wide">
              A model proposes. Deterministic rules verify. A person approves. Steward stays on the proposing
              side of that line.
            </p>
            <ul className="ld-wont">
              {WONT.map((w) => (
                <li key={w.verb}>
                  <p className="ld-wont__verb">
                    <Strike label="won't:">{w.verb}</Strike>
                  </p>
                  <p className="ld-body">{w.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Honest testing: v2 results pending. */}
        <section id="testing" className="ld-section" aria-labelledby="testing-title">
          <div className="ld-wrap ld-split">
            <div>
              <Eyebrow>Testing</Eyebrow>
              <h2 id="testing-title" className="ld-h2">
                How we test <em className="ld-italic">Steward.</em>
              </h2>
              <p className="ld-body">
                We build synthetic finance workspaces and plant errors in them on purpose, then check that
                Steward flags each one and nothing else.
              </p>
            </div>
            <ul className="ld-tests">
              <li>
                <h3 className="ld-tests__title">Synthetic datasets with planted errors</h3>
                <p className="ld-body">
                  Missing and mismatched receipts, unallowable costs, charges outside the period, duplicate
                  charges, a wrong indirect rate.
                </p>
              </li>
              <li>
                <h3 className="ld-tests__title">A sealed hold-out</h3>
                <p className="ld-body">
                  A second dataset stays sealed while the rules are tuned, so the score can&rsquo;t be fitted
                  to it.
                </p>
              </li>
              <li className="ld-tests__pending">
                <h3 className="ld-tests__title">
                  Results for this version <span className="ld-tag ld-tag--pending">Pending</span>
                </h3>
                <p className="ld-body">
                  Placeholder: the v2 evaluation hasn&rsquo;t run yet. Earlier scores were for a different,
                  bank-first product and aren&rsquo;t shown here.
                </p>
              </li>
            </ul>
          </div>
        </section>
      </main>

      {/* Close and footer as one block. */}
      <footer className="ld-close" aria-labelledby="close-title">
        <div className="ld-wrap">
          <div className="ld-close__band">
            <h2 id="close-title" className="ld-h2">
              See a package go from 7 of 9 to <em className="ld-italic ld-ready-word">ready.</em>
            </h2>
            <div>
              <Link href={DEMO_HREF} className="ld-btn ld-btn--primary">
                {PRIMARY}
                <Arrow />
              </Link>
              <p className="ld-micro">Synthetic demo data · no sign-up · about 2 minutes</p>
            </div>
          </div>
          <div className="ld-foot">
            <p className="ld-foot__brand">Steward · pre-submission review for grant invoices</p>
            <ul className="ld-foot__links">
              <li>
                <a href={GITHUB} target="_blank" rel="noreferrer">
                  Source on GitHub
                </a>
              </li>
              <li>
                <span>Built at Cal Hacks 13.0</span>
              </li>
              <li>
                <span>All demo data is synthetic</span>
              </li>
            </ul>
          </div>
        </div>
      </footer>
    </div>
  );
}
