import React from 'react';
import { STYLES, assignDayStyles, sanitizeStyles } from '../services/styles';

/** Pick any mix of gym, calisthenics, yoga and cardio, and see how the week will be laid out. */
export default function StylePicker({ profile, onChange }) {
  const chosen = sanitizeStyles(profile.styles);
  const week = assignDayStyles(profile);
  const toggle = (id) => {
    const next = chosen.includes(id) ? chosen.filter((s) => s !== id) : [...chosen, id];
    if (next.length) onChange({ ...profile, styles: next });
  };
  const icon = Object.fromEntries(STYLES.map((s) => [s.id, s.icon]));
  const label = Object.fromEntries(STYLES.map((s) => [s.id, s.label]));
  return (
    <div className="form-group">
      <label id="style-label">Training styles (pick any mix)</label>
      <div className="style-grid" role="group" aria-labelledby="style-label">
        {STYLES.map((s) => (
          <button key={s.id} type="button" aria-pressed={chosen.includes(s.id)} className={`style-tile ${chosen.includes(s.id) ? 'style-on' : ''}`} onClick={() => toggle(s.id)}>
            <span className="style-icon" aria-hidden="true">{s.icon}</span>
            <strong>{s.label}</strong>
            <small>{s.blurb}</small>
          </button>
        ))}
      </div>
      <p className="style-week" aria-label="Your week">
        {week.map((s, i) => (
          <span key={i} className={`style-day style-day-${s}`}>
            {icon[s]} {label[s]}
          </span>
        ))}
      </p>
    </div>
  );
}
