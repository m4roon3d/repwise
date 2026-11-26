import React, { useState } from 'react';
import { formatWeight, fromDisplayWeight, lastSession, suggestNext, toDisplayWeight, weightUnit } from '../services/progress';

const RPE_OPTIONS = ['', '6', '7', '8', '9', '10'];

function ago(ts) {
  const d = Math.round((Date.now() - ts) / 86400000);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
}

/** Log what you actually lifted on one exercise, see last time, and get a next-load suggestion. */
export default function LogSets({ item, logs, unitSystem, weekNumber, dayTitle, onLog, onUndo }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const [rpe, setRpe] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const unit = weightUnit(unitSystem);
  const timed = item.dose === 'time' || item.dose === 'duration';
  const tUnit = item.dose === 'duration' ? 'min' : 's';
  const last = lastSession(logs, item.exercise_id);
  const tip = suggestNext(last, item, unitSystem);

  const openForm = () => {
    const startKg = tip.weightKg ?? (last ? Math.max(...last.sets.map((s) => s.weightKg)) : 0);
    const startW = startKg > 0 ? String(toDisplayWeight(startKg, unitSystem)) : '';
    const n = item.dose === 'duration' ? 1 : item.sets;
    const prefill = (i) => (last?.sets[i] ? String(last.sets[i].reps) : timed ? String(item.dose === 'duration' ? item.minutes : item.time_sec_max) : '');
    setRows(Array.from({ length: n }, (_, i) => ({ weight: timed ? '' : startW, reps: prefill(i) })));
    setRpe('');
    setError('');
    setSaved(false);
    setOpen(true);
  };

  const update = (i, key, value) => setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));

  const save = (e) => {
    e.preventDefault();
    const sets = rows
      .map((r) => ({ reps: Math.round(Number(r.reps) || 0), weight: Number(r.weight) || 0 }))
      .filter((r) => r.reps > 0)
      .map((r) => ({ reps: r.reps, weightKg: fromDisplayWeight(Math.max(0, r.weight), unitSystem) }));
    if (sets.length === 0) {
      setError(timed ? `Enter the ${tUnit === 'min' ? 'minutes' : 'seconds'} for at least one set.` : 'Enter the reps for at least one set.');
      return;
    }
    onLog({ exercise_id: item.exercise_id, ts: Date.now(), weekNumber, dayTitle, rpe: rpe ? Number(rpe) : null, sets, ...(timed ? { unit: tUnit } : {}) });
    setOpen(false);
    setSaved(true);
  };

  return (
    <div className="log-block">
      {last && (
        <p className="muted log-last">
          Last time ({ago(last.ts)}):{' '}
          {last.sets.map((s) => (last.unit ? `${s.reps} ${last.unit}` : s.weightKg > 0 ? `${s.reps}×${formatWeight(s.weightKg, unitSystem)}` : `${s.reps} reps`)).join(', ')}
        </p>
      )}
      {last && (
        <p className={`log-tip log-tip-${tip.action}`} data-testid="progress-tip">
          <strong>Next time:</strong> {tip.message}
        </p>
      )}
      {saved && !open && <div className="status-banner status-success">Logged. Nice work.</div>}

      {!open ? (
        <div className="button-row" style={{ marginTop: '8px' }}>
          <button type="button" className="secondary-btn" onClick={openForm}>
            {last ? 'Log this session' : timed ? (item.dose === 'duration' ? 'Log session' : 'Log holds') : 'Log sets'}
          </button>
          {last && (
            <button type="button" className="secondary-btn" onClick={() => { onUndo(last.id); setSaved(false); }}>
              Remove last log
            </button>
          )}
        </div>
      ) : (
        <form className="log-form" onSubmit={save} aria-label={`Log sets for ${item.exercise_id}`}>
          {rows.map((r, i) => (
            timed ? (
              <div className="log-row log-row-timed" key={i}>
                <span className="log-set">{item.dose === 'duration' ? 'Time' : `Set ${i + 1}`}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  placeholder={tUnit}
                  aria-label={item.dose === 'duration' ? 'Minutes' : `Set ${i + 1} seconds`}
                  value={r.reps}
                  onChange={(e) => update(i, 'reps', e.target.value)}
                />
                <span className="muted">{tUnit === 'min' ? 'minutes' : 'seconds'}</span>
              </div>
            ) : (
            <div className="log-row" key={i}>
              <span className="log-set">Set {i + 1}</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                placeholder={unit}
                aria-label={`Set ${i + 1} weight in ${unit}`}
                value={r.weight}
                onChange={(e) => update(i, 'weight', e.target.value)}
              />
              <span aria-hidden="true">×</span>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                placeholder="reps"
                aria-label={`Set ${i + 1} reps`}
                value={r.reps}
                onChange={(e) => update(i, 'reps', e.target.value)}
              />
            </div>
            )
          ))}
          <label className="log-rpe">
            <span className="muted">How hard was it overall? (optional)</span>
            <select value={rpe} onChange={(e) => setRpe(e.target.value)} aria-label="Overall effort (RPE)">
              {RPE_OPTIONS.map((o) => (
                <option key={o} value={o}>{o ? `RPE ${o}` : 'Skip'}</option>
              ))}
            </select>
          </label>
          {!timed && <p className="muted" style={{ fontSize: '0.78rem' }}>Leave weight empty for bodyweight moves. Skipped sets are not saved.</p>}
          {error && <div className="status-banner status-error" role="alert">{error}</div>}
          <div className="button-row">
            <button type="submit" className="primary-btn">Save</button>
            <button type="button" className="secondary-btn" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
