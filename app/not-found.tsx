import Link from "next/link";
import { landingSans, landingSerif } from "./components/landing/fonts";
import { Strike } from "./components/landing/Strike";
import "./components/landing/landing.css";

export default function NotFound() {
  return (
    <div className={`ld ${landingSans.variable} ${landingSerif.variable}`}>
      <main className="ld-404">
        <div className="ld-wrap">
          <p className="ld-eyebrow">
            <span aria-hidden className="ld-eyebrow__rule" />
            404
          </p>
          <h1 className="ld-h1">
            <Strike draw delay={200} label="struck:">
              Page
            </Strike>{" "}
            <em className="ld-italic">not in the ledger.</em>
          </h1>
          <p className="ld-lead">This page doesn&rsquo;t exist. The books still balance.</p>
          <div className="ld-cta-row">
            <Link href="/" className="ld-btn ld-btn--primary">
              Back to Steward
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
