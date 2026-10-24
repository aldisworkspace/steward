"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { RedPenStrike } from "../RedPenStrike";

const GITHUB = "https://github.com/aldisworkspace/steward";
const BLACK_CAT_CASE = "T0065";

function demoPath(query: string): string {
  const q = query.startsWith("?") ? query : `?${query}`;
  const key = process.env.NEXT_PUBLIC_DEMO_KEY;
  return `/app${q}${key ? `&key=${encodeURIComponent(key)}` : ""}`;
}

function HeroMiniCase() {
  return (
    <div className="hero-mini-case rounded-[8px] border border-rule bg-sheet p-6">
      <p className="text-[14px] font-semibold text-ink">The Black Cat SF</p>
      <p className="font-display tabular text-[32px] font-semibold text-ink">−$482.50</p>
      <p className="mt-1 text-[13px] text-ink-2">Staff appreciation night</p>
      <div className="mt-4 text-[14px]">
        <RedPenStrike text="Youth Pathways · Program supplies" className="hero-strike-delay" animate />
        <span className="hero-reclass ml-2 font-semibold text-money">→ General funds</span>
      </div>
      <blockquote className="hero-clause mt-4 border-l-2 border-redpen pl-4 font-serif text-[17px] leading-snug text-ink">
        Staff meals and staff appreciation events are unallowable.
        <footer className="mt-2 font-sans text-[13px] text-ink-2">Youth Pathways grant · §4.7</footer>
      </blockquote>
    </div>
  );
}

function BentoCell({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-[8px] border border-rule bg-sheet p-6 transition-colors hover:border-ink-2 ${className}`}
    >
      <h3 className="text-[17px] font-semibold text-ink">{title}</h3>
      <div className="mt-3 text-[14px] text-ink-2">{children}</div>
    </div>
  );
}

export function LandingPage() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="min-h-screen bg-paper text-ink">
      <header
        className={`sticky top-0 z-40 flex h-16 items-center justify-between px-6 transition-colors ${
          scrolled ? "border-b border-rule bg-sheet" : "bg-transparent"
        }`}
      >
        <Link href="/" className="font-display text-[18px] font-semibold">
          Steward
        </Link>
        <nav className="hidden items-center gap-6 text-[14px] md:flex">
          <a href="#how" className="text-ink-2 hover:text-ink">
            How it works
          </a>
          <a href="#proof" className="text-ink-2 hover:text-ink">
            Proof
          </a>
          <a href={GITHUB} className="text-ink-2 hover:text-ink" target="_blank" rel="noreferrer">
            GitHub
          </a>
          <Link
            href={demoPath("?tab=overview")}
            className="rounded-[6px] bg-saffron px-4 py-2 text-[14px] font-semibold text-ink"
          >
            Open live demo
          </Link>
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-[1200px] gap-12 px-6 pb-16 pt-12 lg:grid-cols-2 lg:items-center">
          <div>
            <h1 className="font-display text-[52px] font-semibold leading-[1.08] tracking-tight lg:text-[56px]">
              The grants accountant that reads the contract.
            </h1>
            <p className="mt-4 max-w-[56ch] text-[17px] leading-relaxed text-ink-2">
              Steward checks every bank transaction against your grant agreements, catches the costs a funder would claw
              back, and proposes the fix. You approve.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href={demoPath(`?tab=inbox&case=${BLACK_CAT_CASE}`)}
                className="rounded-[6px] bg-saffron px-4 py-2.5 text-[14px] font-semibold text-ink"
              >
                Watch it catch a $482 bar tab
              </Link>
              <a
                href="#proof"
                className="rounded-[6px] border border-ink-2 bg-sheet px-4 py-2.5 text-[14px] font-medium text-ink"
              >
                See how we tested it
              </a>
            </div>
            <p className="mt-4 text-[13px] text-ink-2">
              Live demo on synthetic data · Real Claude calls · Built solo at Cal Hacks 13.0
            </p>
          </div>
          <HeroMiniCase />
        </section>

        <section id="how" className="mx-auto max-w-[1200px] px-6 py-16">
          <h2 className="font-display text-[28px] font-semibold">What Steward does</h2>
          <div className="mt-8 grid grid-cols-12 gap-4">
            <BentoCell title="Reads the contract" className="col-span-12 lg:col-span-7">
              <p>Upload a grant PDF; Steward extracts budget lines, unallowables, and approval thresholds.</p>
              <div className="mt-4 rounded-[6px] border border-rule bg-paper p-4 text-[13px] text-ink">
                <p className="text-ink-2">Page 1 excerpt</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {["Budget lines: 6", "Unallowable: 6", "Prior approval: 1"].map((c) => (
                    <span key={c} className="rounded-[6px] border border-rule px-2 py-1 text-[13px] text-ink">
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            </BentoCell>
            <BentoCell title="When sources disagree" className="col-span-12 lg:col-span-5">
              <p>Bank, books, and contract are shown side by side; disagreements get a red-pen underline.</p>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[12px]">
                <div className="rounded-[6px] border border-rule p-2">Bank</div>
                <div className="rounded-[6px] border border-redpen p-2 underline decoration-redpen">Books</div>
                <div className="rounded-[6px] border border-rule p-2">Contract</div>
              </div>
            </BentoCell>
            <BentoCell title="Defends its calls" className="col-span-12 md:col-span-4">
              <p className="rounded-[6px] bg-paper p-3">“Could this be team building?”</p>
              <p className="mt-2 text-[13px] text-ink">Stands by it — cites §4.7 and prior rulings.</p>
            </BentoCell>
            <BentoCell title="Can't approve its own work" className="col-span-12 md:col-span-4">
              <button type="button" disabled className="rounded-[6px] bg-rule px-3 py-2 text-[13px] opacity-50">
                Approve
              </button>
              <p className="mt-2 text-[13px]">
                Segregation of duties: Steward proposes entries but cannot approve them.
              </p>
            </BentoCell>
            <BentoCell title="Works while you're away" className="col-span-12 md:col-span-4">
              <ol className="space-y-2 text-[13px]">
                <li>Bank feed arrived</li>
                <li>→ 31 coded</li>
                <li>→ 3 flagged</li>
                <li>→ waiting on you</li>
              </ol>
            </BentoCell>
            <BentoCell title="Remembers your rulings" className="col-span-12">
              <span className="inline-block rounded-[6px] border border-rule px-2 py-1 text-[13px]">
                Past ruling · Oct 24 · A. Okafor: Costco = workshop snacks
              </span>
              <span className="ml-2 text-[13px] text-ink">applied to a later Costco charge.</span>
            </BentoCell>
          </div>
        </section>

        <section id="proof" className="mx-auto max-w-[1200px] px-6 py-16">
          <h2 className="font-display text-[28px] font-semibold">How we know it works</h2>
          <table className="mt-6 w-full border-collapse text-[14px]">
            <thead>
              <tr className="border-b border-rule text-left text-ink-2">
                <th className="py-2 pr-4 font-medium">Dataset</th>
                <th className="py-2 pr-4 font-medium">Planted problems caught</th>
                <th className="py-2 pr-4 font-medium">False alarms</th>
                <th className="py-2 font-medium">Correct coding on clean rows</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-rule">
                <td className="py-3 pr-4">Demo set (tuned)</td>
                <td className="py-3 pr-4">12 of 12</td>
                <td className="py-3 pr-4">1</td>
                <td className="py-3">84 of 85</td>
              </tr>
              <tr className="border-b border-rule">
                <td className="py-3 pr-4">Hold-out set (not used for tuning)</td>
                <td className="py-3 pr-4">15 of 15</td>
                <td className="py-3 pr-4">1</td>
                <td className="py-3">52 of 53</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-4 max-w-[70ch] text-[14px] text-ink-2">
            Both sets are synthetic and written by the builder. Rules alone catch 8 of 15 planted issues on the hold-out;
            Claude catches the rest when the model is allowed to reason over contract text.
          </p>
        </section>

        <section className="border-y border-rule bg-sheet px-6 py-14">
          <div className="mx-auto max-w-[1200px] text-center">
            <h2 className="font-display text-[28px] font-semibold">Try it on your own grant.</h2>
            <p className="mx-auto mt-3 max-w-[56ch] text-[17px] text-ink-2">
              Upload a grant agreement PDF and a bank CSV. Steward reads both and shows what a funder would question.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link
                href={demoPath("?tab=yourdata")}
                className="rounded-[6px] border border-ink-2 bg-sheet px-4 py-2.5 text-[14px] font-medium"
              >
                Upload your data
              </Link>
              <Link
                href={demoPath("?tab=overview")}
                className="rounded-[6px] bg-saffron px-4 py-2.5 text-[14px] font-semibold text-ink"
              >
                Open live demo
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto max-w-[1200px] px-6 py-10">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="font-display text-[17px] font-semibold">Steward</p>
            <p className="mt-1 text-[14px] text-ink-2">An autonomous grants accountant for small nonprofits.</p>
          </div>
          <div className="flex flex-wrap gap-4 text-[14px]">
            <a href={GITHUB} className="text-[#2563EB]" target="_blank" rel="noreferrer">
              GitHub
            </a>
            <a href="#proof" className="text-[#2563EB]">
              Proof
            </a>
            <Link href={demoPath("?tab=overview")} className="text-[#2563EB]">
              Live demo
            </Link>
          </div>
        </div>
        <p className="mt-8 text-[13px] text-ink-2">
          Synthetic demo data. Not financial, legal or audit advice. Built with Claude (Anthropic) and Convex at Cal Hacks
          13.0.
        </p>
      </footer>
    </div>
  );
}
