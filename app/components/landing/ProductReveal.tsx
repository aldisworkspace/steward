"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckPanel, MatchPanel, SignPanel, TieOutPanel } from "./ProductPanels";

type Step = { verb: string; body: string; panel: ReactNode };

const STEPS: Step[] = [
  {
    verb: "Check",
    body: "Every GL line against the contract: allowable, inside the period, under its budget cap. Each finding cites the clause it rests on.",
    panel: <CheckPanel />,
  },
  {
    verb: "Match",
    body: "Every receipt to its ledger line, to the cent. A one-cent gap is an exception, never a rounding.",
    panel: <MatchPanel />,
  },
  {
    verb: "Tie out",
    body: "The expenditure report, the invoice and the GL agree to the penny before anyone is asked to sign.",
    panel: <TieOutPanel />,
  },
  {
    verb: "Sign",
    body: "Your senior accountant clears the exceptions and signs. Steward prepares the package; it never signs it.",
    panel: <SignPanel />,
  },
];

export function ProductReveal() {
  const [active, setActive] = useState(0);
  const stepRefs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    const els = stepRefs.current.filter((el): el is HTMLElement => el !== null);
    if (els.length === 0 || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActive(Number((entry.target as HTMLElement).dataset.step ?? 0));
          }
        }
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className="ld-reveal">
      <ol className="ld-reveal__steps">
        {STEPS.map((step, i) => (
          <li
            key={step.verb}
            ref={(el) => {
              stepRefs.current[i] = el;
            }}
            data-step={i}
            className={`ld-reveal__step${i === active ? " is-active" : ""}`}
          >
            <h3 className="ld-verb">{step.verb}</h3>
            <p className="ld-reveal__body">{step.body}</p>
            {/* Inline panel: shown under each step below 1024px; screen-reader copy on desktop. */}
            <div className="ld-reveal__inline">{step.panel}</div>
          </li>
        ))}
      </ol>

      <div className="ld-reveal__stage" aria-hidden>
        <div className="ld-reveal__sticky">
          <div className="ld-reveal__tabs">
            {STEPS.map((step, i) => (
              <span key={step.verb} className={i === active ? "is-active" : i < active ? "is-done" : ""}>
                {step.verb}
              </span>
            ))}
          </div>
          <div className="ld-reveal__frame">
            {STEPS.map((step, i) => (
              <div key={step.verb} className={`ld-reveal__panel${i === active ? " is-active" : ""}`}>
                {step.panel}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
