"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RedPenStrike } from "../RedPenStrike";
import { ApproveDemo, DefendDemo, SourcesDisagreeDemo } from "./LandingBentoDemos";
import { Clerk, Corners, ThemeSwitch, type LandingTheme } from "./LandingMarks";

const GITHUB = "https://github.com/aldisworkspace/steward";
const BLACK_CAT_CASE = "black-cat";

function demoPath(query: string): string {
  const q = query.startsWith("?") ? query : `?${query}`;
  const key = process.env.NEXT_PUBLIC_DEMO_KEY;
  return `/app${q}${key ? `&key=${encodeURIComponent(key)}` : ""}`;
}

const demoHref = demoPath("?tab=overview");
const exampleHref = demoPath(`?tab=inbox&case=${BLACK_CAT_CASE}`);

function TryDemoLink({ wide = false }: { wide?: boolean }) {
  return (
    <Link
      href={demoHref}
      aria-label="Try the demo"
      className={`landing-control landing-primary inline-flex min-h-11 items-center justify-center rounded-full px-5 py-2.5 text-[15px] font-semibold ${
        wide ? "w-full sm:w-auto" : ""
      }`}
    >
      {wide ? "Try the demo" : <><span className="sm:hidden">Demo</span><span className="hidden sm:inline">Try the demo</span></>}
    </Link>
  );
}

function ExampleCaseLink({ wide = false }: { wide?: boolean }) {
  return (
    <Link
      href={exampleHref}
      aria-label="Open example case, the Black Cat charge"
      className={`landing-control inline-flex min-h-11 items-center justify-center rounded-[6px] border border-rule bg-sheet px-5 py-2.5 text-center text-[15px] font-medium text-ink ${
        wide ? "w-full sm:w-auto" : ""
      }`}
    >
      Open example case
    </Link>
  );
}

function HeroMiniCase() {
  return (
    <div className="hero-mini-case relative min-w-0 rounded-[8px] border border-rule bg-sheet p-5 sm:p-6">
      <Corners />
      <p className="text-[13px] text-ink-2">Example · not a live result</p>
      <p className="mt-4 text-[14px] font-semibold text-ink">The Black Cat SF</p>
      <p className="mt-1 font-display tabular text-[32px] font-semibold leading-none text-ink">−$482.50</p>
      <p className="mt-2 text-[13px] text-ink-2">Staff appreciation night · synthetic bank row</p>
      <div className="mt-5 border-t border-rule pt-4 text-[14px] leading-relaxed">
        <RedPenStrike text="Youth Pathways · Program supplies" className="hero-strike-delay" animate />
        <span className="landing-accent mt-2 block font-semibold sm:ml-2 sm:mt-0 sm:inline">→ General funds</span>
      </div>
      <blockquote className="mt-4 select-text break-words border-l-2 border-redpen pl-4 font-serif text-[17px] leading-snug text-ink">
        Staff meals and staff appreciation events are unallowable.
        <footer className="mt-2 font-sans text-[13px] text-ink-2">Youth Pathways grant · §4.7</footer>
      </blockquote>
    </div>
  );
}

export function LandingPage() {
  const [scrolled, setScrolled] = useState(false);
  const [theme, setTheme] = useState<LandingTheme>("leaf");
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function chooseTheme(next: LandingTheme) {
    setTheme(next);
  }

  return (
    <div data-theme={theme} className="steward-landing min-h-screen bg-paper text-ink">
      <style>{`
        .steward-landing[data-theme="leaf"] {
          --paper: #ffffff;
          --sheet: #ffffff;
          --ink: #0a0a0a;
          --ink-2: #525252;
          --rule: #e6e6e6;
          --money: #067647;
          --money-tint: #e7f6ee;
          --redpen: #067647;
          --redpen-tint: #e7f6ee;
          --color-paper: #ffffff;
          --color-sheet: #ffffff;
          --color-ink: #0a0a0a;
          --color-ink-2: #525252;
          --color-rule: #e6e6e6;
          --color-money: #067647;
          --color-money-tint: #e7f6ee;
          --color-redpen: #067647;
          --color-redpen-tint: #e7f6ee;
          color-scheme: light;
        }
        .steward-landing[data-theme="ink"] {
          --paper: #000000;
          --sheet: #0a0a0a;
          --ink: #fafafa;
          --ink-2: #a3a3a3;
          --rule: #262626;
          --money: #fafafa;
          --money-tint: #171717;
          --redpen: #fafafa;
          --redpen-tint: #171717;
          --color-paper: #000000;
          --color-sheet: #0a0a0a;
          --color-ink: #fafafa;
          --color-ink-2: #a3a3a3;
          --color-rule: #262626;
          --color-money: #fafafa;
          --color-money-tint: #171717;
          --color-redpen: #fafafa;
          --color-redpen-tint: #171717;
          color-scheme: dark;
        }
        .steward-landing .landing-mode-on {
          background: color-mix(in srgb, var(--ink) 8%, transparent);
        }
        .steward-landing .landing-primary {
          background: var(--money);
          color: #ffffff;
        }
        .steward-landing[data-theme="ink"] .landing-primary {
          color: #000000;
        }
        .steward-landing .landing-accent {
          color: var(--money);
        }
        .steward-landing[data-theme="ink"] .landing-accent {
          color: var(--ink);
          text-decoration: underline;
          text-underline-offset: 3px;
        }
        .steward-landing .landing-dots {
          background-image: radial-gradient(currentColor 0.8px, transparent 0.8px);
          background-size: 22px 22px;
          color: var(--ink);
          opacity: 0.14;
          -webkit-mask-image: linear-gradient(to bottom, #000 10%, transparent 78%);
          mask-image: linear-gradient(to bottom, #000 10%, transparent 78%);
        }
        .steward-landing .landing-caret {
          display: inline-block;
          width: 1px;
          height: 0.9em;
          margin-left: 3px;
          background: currentColor;
          vertical-align: -0.12em;
        }
        .steward-landing .landing-tap,
        .steward-landing .landing-control {
          touch-action: manipulation;
          -webkit-tap-highlight-color: transparent;
        }
        .steward-landing .landing-control {
          -webkit-user-select: none;
          user-select: none;
          -webkit-touch-callout: none;
          transition: transform 160ms cubic-bezier(0.23, 1, 0.32, 1);
        }
        .steward-landing .landing-control:active,
        .steward-landing button.landing-control:active {
          transform: scale(0.97);
          filter: none;
          box-shadow: none;
        }
        .steward-landing a:focus-visible,
        .steward-landing button:focus-visible {
          outline: 2px solid var(--sky);
          outline-offset: 2px;
        }
        @media (hover: hover) and (pointer: fine) {
          .steward-landing a.landing-control:hover {
            filter: brightness(0.97);
          }
          .steward-landing button.landing-control:hover {
            transform: none;
            filter: none;
            box-shadow: none;
          }
          .steward-landing button.landing-control:hover:active {
            transform: scale(0.97);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .steward-landing .landing-control,
          .steward-landing .landing-control:active,
          .steward-landing button.landing-control:active {
            transition: none;
            transform: none;
          }
          .steward-landing .landing-caret {
            animation: none;
          }
        }
        @media (prefers-reduced-motion: no-preference) {
          .steward-landing .landing-step {
            transition: opacity 280ms cubic-bezier(0.23, 1, 0.32, 1), transform 280ms cubic-bezier(0.23, 1, 0.32, 1);
          }
          .steward-landing .landing-step:nth-child(2) { transition-delay: 40ms; }
          .steward-landing .landing-step:nth-child(3) { transition-delay: 80ms; }
          .steward-landing .landing-caret {
            animation: landing-caret 1.1s steps(1, end) infinite;
          }
          @keyframes landing-caret {
            0%, 45% { opacity: 1; }
            50%, 100% { opacity: 0; }
          }
          @starting-style {
            .steward-landing .landing-step {
              opacity: 0;
              transform: translateY(8px);
            }
          }
        }
      `}</style>
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-[6px] focus:bg-sheet focus:px-3 focus:py-2 focus:text-[14px] focus:font-medium focus:text-ink"
      >
        Skip to content
      </a>
      <header
        className={`sticky top-0 z-40 flex items-center justify-between gap-3 px-4 py-3 sm:px-6 ${
          scrolled ? "border-b border-rule bg-sheet" : "bg-transparent"
        }`}
      >
        <Link href="/" className="landing-tap inline-flex items-center gap-2 font-display text-[18px] font-semibold">
          <Clerk />
          Steward
        </Link>
        <nav className="flex items-center gap-2 text-[14px] sm:gap-4" aria-label="Primary">
          <a href="#case" className="landing-tap hidden text-ink-2 hover:text-ink md:inline">
            The case
          </a>
          <a href="#how" className="landing-tap hidden text-ink-2 hover:text-ink md:inline">
            How it works
          </a>
          <a href={GITHUB} className="landing-tap hidden text-ink-2 hover:text-ink lg:inline" target="_blank" rel="noreferrer">
            GitHub
          </a>
          <ThemeSwitch theme={theme} onChange={chooseTheme} />
          <TryDemoLink />
        </nav>
      </header>

      <main id="content">
        <section className="relative mx-auto grid max-w-[1200px] gap-12 px-4 pb-16 pt-10 sm:px-6 sm:pt-14 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:items-start lg:gap-16 lg:pt-20">
          <div aria-hidden className="landing-dots pointer-events-none absolute inset-0" />
          <div className="relative min-w-0">
            <p className="inline-flex items-center text-[13px] text-ink-2">
              Synthetic demo data · a fictional nonprofit
              <span className="landing-caret" />
            </p>
            <h1 className="mt-4 max-w-[16ch] font-display text-[2.25rem] font-semibold leading-[1.08] tracking-tight sm:text-[3.15rem] lg:text-[3.5rem]">
              The grants accountant that reads the contract.
            </h1>
            <p className="mt-5 max-w-[42ch] text-[17px] leading-relaxed text-ink-2">
              Steward reads the grant, checks each bank charge against the clause, and drafts a correcting entry for a
              person to approve. It does not post that entry or move money.
            </p>
            <p className="mt-6 text-[15px] leading-relaxed text-ink">
              <span className="font-semibold">Model proposes</span>
              <span className="text-ink-2"> → </span>
              <span className="font-semibold">rules verify</span>
              <span className="text-ink-2"> → </span>
              <span className="font-semibold">you approve</span>
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <TryDemoLink wide />
              <ExampleCaseLink wide />
            </div>
            <p className="mt-3 max-w-[42ch] text-[13px] leading-relaxed text-ink-2">
              Open example case shows the synthetic Black Cat charge in the inbox, with the clause beside it.
            </p>
          </div>
          <div className="relative">
            <HeroMiniCase />
          </div>
        </section>

        <section id="case" className="mx-auto max-w-[1200px] scroll-mt-24 px-4 py-16 sm:px-6 sm:py-20">
          <p className="inline-flex items-center gap-2 text-[12px] text-ink-2">
            <Clerk />
            fig. 01
          </p>
          <h2 className="mt-3 max-w-[18ch] font-display text-[1.75rem] font-semibold leading-tight sm:text-[2rem]">
            Four records. One disagreement.
          </h2>
          <p className="mt-4 max-w-[62ch] text-[16px] leading-relaxed text-ink-2">
            The bank posted −$482.50 at The Black Cat. The ledger coded it to program supplies. The grant, at §4.7,
            calls staff meals unallowable. Staff time is the fourth record. The mismatch stays marked.
          </p>
          <p className="mt-3 text-[13px] text-ink-2">Synthetic example. Not a live bank result.</p>
          <SourcesDisagreeDemo />
        </section>

        <section id="how" className="mx-auto max-w-[1200px] scroll-mt-24 px-4 py-16 sm:px-6 sm:py-20">
          <p className="text-[12px] text-ink-2">fig. 02 · §</p>
          <h2 className="mt-3 font-display text-[1.75rem] font-semibold leading-tight sm:text-[2rem]">A person still decides</h2>
          <p className="mt-4 max-w-[62ch] text-[16px] leading-relaxed text-ink-2">
            The model suggests. The rules confirm or block. A person decides. Nothing in that chain posts to the books
            by itself.
          </p>
          <ol className="mt-10 grid overflow-hidden rounded-[8px] border border-rule bg-sheet md:grid-cols-3">
            <li className="landing-step min-w-0 border-b border-rule p-6 md:border-r md:border-b-0">
              <p className="tabular text-[13px] text-ink-2">01</p>
              <h3 className="mt-3 text-[17px] font-semibold text-ink">Model proposes</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
                A coding in plain language, and a correcting journal entry when the books need one.
              </p>
            </li>
            <li className="landing-step min-w-0 border-b border-rule p-6 md:border-r md:border-b-0">
              <p className="tabular text-[13px] text-ink-2">02</p>
              <h3 className="mt-3 text-[17px] font-semibold text-ink">Rules verify</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
                Fixed checks look for unallowable costs, dates outside the grant, duplicates, and lines that would
                overrun.
              </p>
              <DefendDemo />
            </li>
            <li className="landing-step min-w-0 p-6">
              <p className="tabular text-[13px] text-ink-2">03</p>
              <h3 className="mt-3 text-[17px] font-semibold text-ink">You approve</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
                A named person accepts or sends it back. Steward cannot approve, post, or move money.
              </p>
              <ApproveDemo />
            </li>
          </ol>
          <p className="mt-6 max-w-[62ch] text-[14px] leading-relaxed text-ink-2">
            A past ruling can be followed. In the synthetic books, a person called a Costco charge workshop snacks. A
            later charge from that vendor can follow it, and you can still override the call.
          </p>
        </section>

        <section id="limits" className="scroll-mt-24 border-t border-rule bg-sheet">
          <div className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6 sm:py-20">
            <p className="inline-flex items-center gap-2 text-[12px] text-ink-2">
              <Clerk />
              fig. 03
            </p>
            <h2 className="mt-3 font-display text-[1.75rem] font-semibold leading-tight sm:text-[2rem]">What this demo is not</h2>
            <ul className="mt-6 max-w-[62ch] space-y-3 text-[15px] leading-relaxed text-ink-2">
              <li>The nonprofit, grants, bank rows, and ledger are synthetic. The app says so when they load.</li>
              <li>This page does not publish a score.</li>
              <li>There is no production login. A demo passcode only gates sample writes.</li>
              <li>Steward cannot approve an entry, post it, or move money.</li>
            </ul>
            <div className="mt-12">
              <h3 className="font-display text-[1.75rem] font-semibold leading-tight sm:text-[2rem]">Try the sample books.</h3>
              <p className="mt-4 max-w-[46ch] text-[17px] leading-relaxed text-ink-2">
                The demo opens a fictional nonprofit. You can also bring a grant PDF and a bank file. Either way,
                Steward proposes. You approve.
              </p>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <TryDemoLink wide />
                <ExampleCaseLink wide />
              </div>
              <p className="mt-4 text-[14px]">
                <Link href={demoPath("?tab=yourdata")} className="landing-tap text-ink underline decoration-rule underline-offset-4">
                  Upload your own grant and bank file
                </Link>
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-2 font-display text-[17px] font-semibold">
              <Clerk />
              Steward
            </p>
            <p className="mt-1 max-w-[36ch] text-[14px] leading-relaxed text-ink-2">
              An autonomous grants accountant for small nonprofits. It proposes. A person approves.
            </p>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-[14px]">
            <a href={GITHUB} className="landing-tap text-ink underline decoration-rule underline-offset-4" target="_blank" rel="noreferrer">
              GitHub
            </a>
            <a href="#case" className="landing-tap text-ink underline decoration-rule underline-offset-4">
              The case
            </a>
            <a href="#how" className="landing-tap text-ink underline decoration-rule underline-offset-4">
              How it works
            </a>
            <a href="#limits" className="landing-tap text-ink underline decoration-rule underline-offset-4">
              Limits
            </a>
            <Link href={demoHref} className="landing-tap text-ink underline decoration-rule underline-offset-4">
              Try the demo
            </Link>
          </div>
        </div>
        <p className="mt-8 max-w-[70ch] text-[13px] leading-relaxed text-ink-2">
          Synthetic demo data. Not financial, legal, or audit advice. Steward does not post entries or move money.
          Built with Claude (Anthropic) and Convex at Cal Hacks 13.0.
        </p>
      </footer>
    </div>
  );
}
