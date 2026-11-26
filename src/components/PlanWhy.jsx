import React, { useState } from 'react';
import { buildPlanRationale } from '../services/rationale';

/** "Why this plan": each choice linked to the person's own answers, with a one-tap follow-up question. */
export default function PlanWhy({ plan, profile, onAsk, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const lines = Array.isArray(plan?.rationale) && plan.rationale.length ? plan.rationale : buildPlanRationale(profile, plan);
  if (!lines.length) return null;

  return (
    <section className="card plan-why" aria-label="Why this plan">
      <button type="button" className="plan-why-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>
          <strong>Why this plan?</strong>
          <span className="muted"> {lines.length} reasons, based on your answers</span>
        </span>
        <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <ul className="why-list">
          {lines.map((l) => (
            <li key={l.id}>
              <span className="why-icon" aria-hidden="true">
                {l.icon}
              </span>
              <div>
                <strong>{l.title}</strong>
                <p>{l.text}</p>
                {onAsk && l.ask && (
                  <button type="button" className="link-btn" onClick={() => onAsk(l.ask)}>
                    Ask the coach about this →
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
