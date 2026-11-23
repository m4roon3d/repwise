import React from 'react';

export const SAFETY_SHORT =
  'Fitness guidance only — not medical advice. Stop and seek medical help for chest pain, severe dizziness or unusual breathlessness.';

/** Full notice until acknowledged, then a one-line reminder. */
export default function HealthNotice({ acknowledged, onAcknowledge }) {
  if (acknowledged) {
    return (
      <p className="muted health-line" role="note">
        {SAFETY_SHORT}
      </p>
    );
  }
  return (
    <section className="card health-card" aria-labelledby="health-notice-title">
      <h2 id="health-notice-title">Before you start</h2>
      <p>
        Repwise is a fitness-programming tool, not medical advice. Check with your doctor first if you have a heart
        or blood-pressure condition, are recovering from surgery or injury, or are pregnant.
      </p>
      <p>
        <strong>Stop and get medical help</strong> if you feel chest pain or pressure, severe dizziness, fainting,
        unusual shortness of breath, or sharp joint pain. Easy RPE targets are a ceiling, not a goal.
      </p>
      <button type="button" className="primary-btn" onClick={onAcknowledge}>
        I understand
      </button>
    </section>
  );
}
