"use client";

import { useState, type FormEvent } from "react";

const SYSTEMS = ["QuickBooks Online", "QuickBooks Desktop", "Xero", "Sage Intacct", "Other"];

type State = { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "error"; message: string };

/** Pilot request: contact details only. Files are exchanged privately after a reply, never through this form. */
export function PilotForm() {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget).entries());
    setState({ kind: "sending" });
    try {
      const res = await fetch("/api/pilot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "Something went wrong. Please try again.");
      setState({ kind: "sent" });
    } catch (err) {
      setState({ kind: "error", message: (err as Error).message });
    }
  }

  if (state.kind === "sent") {
    return (
      <div className="ld-pilot__done" role="status">
        <p className="ld-pilot__done-title">Thanks — request received.</p>
        <p className="ld-body">
          We&rsquo;ll reply by email to set up a private workspace. Please don&rsquo;t send financial documents
          until then.
        </p>
      </div>
    );
  }

  const sending = state.kind === "sending";
  return (
    <form className="ld-pilot__form" onSubmit={submit} noValidate={false}>
      <div className="ld-pilot__row">
        <label className="ld-field">
          <span className="ld-field__label">Your name</span>
          <input name="name" required maxLength={120} autoComplete="name" className="ld-field__input" />
        </label>
        <label className="ld-field">
          <span className="ld-field__label">Organization</span>
          <input name="organization" required maxLength={160} autoComplete="organization" className="ld-field__input" />
        </label>
      </div>
      <div className="ld-pilot__row">
        <label className="ld-field">
          <span className="ld-field__label">Work email</span>
          <input name="email" type="email" required maxLength={254} autoComplete="email" inputMode="email" className="ld-field__input" />
        </label>
        <label className="ld-field">
          <span className="ld-field__label">Accounting system</span>
          <select name="system" className="ld-field__input" defaultValue={SYSTEMS[0]}>
            {SYSTEMS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="ld-field">
        <span className="ld-field__label">
          Anything we should know? <span className="ld-field__opt">Optional</span>
        </span>
        <textarea
          name="note"
          maxLength={1000}
          rows={3}
          className="ld-field__input ld-field__input--area"
          placeholder="e.g. two city contracts billed monthly, about 150 GL lines a month"
        />
      </label>
      {/* Honeypot: hidden from people and assistive tech. */}
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden className="ld-pilot__hp" />
      <div className="ld-pilot__actions">
        <button type="submit" className="ld-btn ld-btn--primary" disabled={sending}>
          {sending ? "Sending…" : "Request a pilot"}
        </button>
        <p className="ld-micro">No files here. Don&rsquo;t include account numbers or client data.</p>
      </div>
      {state.kind === "error" && (
        <p className="ld-pilot__error" role="alert">
          {state.message}
        </p>
      )}
    </form>
  );
}
