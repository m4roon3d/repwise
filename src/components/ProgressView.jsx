import React, { useMemo, useState } from 'react';
import TrendChart, { MiniBars } from './TrendChart';
import {
  BODY_METRICS,
  HEADLINE_METRICS,
  METRIC_MAP,
  bodyInsights,
  delta,
  fmtDate,
  judge,
  nextScanDue,
  sanitizeScan,
  series,
  today,
} from '../services/bodyComp';
import { strengthTrends, weeklySessions, toDisplayWeight, weightUnit } from '../services/progress';
import { LEVEL_LABEL, scoreBaseline } from '../services/baseline';
import { prepareReportFile } from '../services/images';

const KG_TO_LB = 2.20462;

function useUnits(unitSystem) {
  const imperial = unitSystem === 'imperial';
  const unitFor = (m) => (m.mass && imperial ? 'lb' : m.unit);
  const toDisplay = (m, v) => (m.mass && imperial ? v * KG_TO_LB : v);
  const fromDisplay = (m, v) => (m.mass && imperial ? v / KG_TO_LB : v);
  const fmt = (m, v, signed = false) => {
    const n = toDisplay(m, v);
    const dp = m.mass && imperial ? 1 : m.dp;
    const txt = Math.abs(n).toFixed(dp);
    const sign = signed ? (n < 0 ? '−' : '') : n < 0 ? '−' : '';
    const u = unitFor(m);
    return `${sign}${txt}${u ? (u === '%' ? '%' : u === '/100' ? '' : ` ${u}`) : ''}`;
  };
  return { unitFor, toDisplay, fromDisplay, fmt };
}

const shortDate = (iso) => {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : `${d.toLocaleDateString(undefined, { month: 'short' })} '${String(d.getFullYear()).slice(2)}`;
};

/** Review / edit a scan before saving, whether it was read by Gemini or typed in. */
function ScanEditor({ initial, units, onSave, onCancel, currentWeightKg }) {
  const [date, setDate] = useState(initial?.date || today());
  const [vals, setVals] = useState(() => Object.fromEntries(BODY_METRICS.map((m) => [m.id, initial?.metrics?.[m.id] != null ? String(Number(units.toDisplay(m, initial.metrics[m.id]).toFixed(m.mass ? 1 : m.dp))) : ''])));
  const [more, setMore] = useState(() => Boolean(initial && BODY_METRICS.some((m) => !HEADLINE_METRICS.includes(m.id) && m.id !== 'bfmKg' && initial.metrics[m.id] != null)));
  const [updateWeight, setUpdateWeight] = useState(true);
  const [error, setError] = useState('');
  const shown = BODY_METRICS.filter((m) => more || HEADLINE_METRICS.includes(m.id) || m.id === 'bfmKg');

  const save = () => {
    const metrics = {};
    for (const m of BODY_METRICS) if (vals[m.id] !== '') metrics[m.id] = units.fromDisplay(m, Number(vals[m.id]));
    const scan = sanitizeScan({ id: initial?.id, date, source: initial?.source || 'manual', device: initial?.device, metrics });
    if (!scan) {
      setError('Enter at least one value within a realistic range.');
      return;
    }
    const dropped = Object.keys(metrics).filter((k) => scan.metrics[k] == null).map((k) => METRIC_MAP[k].label);
    if (dropped.length) {
      setError(`These look out of range, so they were left out: ${dropped.join(', ')}. Fix them or save anyway.`);
      if (!error) return;
    }
    onSave(scan, updateWeight && scan.metrics.weightKg != null);
  };

  return (
    <div className="scan-editor">
      {initial?.source === 'upload' && <div className="status-banner status-warning">Check these against your report and fix anything misread, then save.</div>}
      <div className="form-group" style={{ marginTop: '10px' }}>
        <label htmlFor="scan-date">Scan date</label>
        <input id="scan-date" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div className="scan-grid">
        {shown.map((m) => (
          <div className="form-group" key={m.id}>
            <label htmlFor={`scan-${m.id}`}>
              {m.label}
              {units.unitFor(m) ? ` (${units.unitFor(m)})` : ''}
            </label>
            <input id={`scan-${m.id}`} type="number" inputMode="decimal" step="any" value={vals[m.id]} onChange={(e) => setVals({ ...vals, [m.id]: e.target.value })} />
          </div>
        ))}
      </div>
      <button type="button" className="link-btn" onClick={() => setMore(!more)}>
        {more ? 'Show fewer fields' : 'More fields (BMR, water, segmental lean…)'}
      </button>
      {vals.weightKg !== '' && (
        <label className="check-row">
          <input type="checkbox" checked={updateWeight} onChange={(e) => setUpdateWeight(e.target.checked)} />
          <span>Also update my profile weight{currentWeightKg ? ` (now ${units.fmt(METRIC_MAP.weightKg, currentWeightKg)})` : ''}</span>
        </label>
      )}
      {error && <div className="status-banner status-error" role="alert">{error}</div>}
      <div className="button-row" style={{ marginTop: '10px' }}>
        <button type="button" className="primary-btn" onClick={save}>
          {error ? 'Save anyway' : 'Save scan'}
        </button>
        <button type="button" className="secondary-btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export default function ProgressView({ scans, onSaveScan, onDeleteScan, onExtract, apiKey, profile, logs, onAsk, onRetest }) {
  const units = useUnits(profile.unitSystem);
  const [editing, setEditing] = useState(null); // null | 'new' | scan
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [extra, setExtra] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  const due = nextScanDue(scans);
  const latest = scans.at(-1);
  const insights = useMemo(() => bodyInsights(scans, profile), [scans, profile]);
  const strength = useMemo(() => strengthTrends(logs), [logs]);
  const weeks = useMemo(() => weeklySessions(logs, 8), [logs]);
  const otherMetrics = BODY_METRICS.filter((m) => !['weightKg', 'smmKg', 'pbf', 'bfmKg'].includes(m.id) && series(scans, m.id).length >= 2);

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setBusy(true);
    try {
      setEditing(await onExtract(await prepareReportFile(file)));
    } catch (err) {
      setError(err?.message || 'Could not read that report.');
    } finally {
      setBusy(false);
    }
  };

  const chartFor = (m) => {
    const pts = series(scans, m.id);
    if (pts.length < 2) return null;
    return (
      <TrendChart
        key={m.id}
        title={m.label}
        points={pts.map((p) => ({ ...p, value: Number(units.toDisplay(m, p.value).toFixed(2)) }))}
        format={(v, signed) => {
          const u = units.unitFor(m);
          const tail = u === '%' ? '%' : signed && u && u !== '/100' ? ` ${u}` : '';
          return `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(m.mass && profile.unitSystem === 'imperial' ? 1 : m.dp)}${tail}`;
        }}
        dateLabel={shortDate}
        better={m.better}
      />
    );
  };

  const weightUnitLabel = weightUnit(profile.unitSystem);

  return (
    <div className="panel-stack progress-view">
      {/* ---- Body composition ---- */}
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Body composition</h2>
            <p className="muted">
              {latest
                ? `Last scan ${fmtDate(latest.date)}${due ? (due.daysLeft > 0 ? ` · next due in ${due.daysLeft} days` : ' · a new scan is due') : ''}`
                : 'Add your InBody (or any body-composition) scans to track muscle and fat over time.'}
            </p>
          </div>
        </div>

        {due && due.daysLeft <= 0 && !editing && <div className="status-banner status-warning">⏱️ It's been 2 months. Time for a new scan.</div>}

        {!editing && (
          <div className="button-row" style={{ marginTop: '12px' }}>
            {apiKey && (
              <label className={`primary-btn ${busy ? 'is-disabled' : ''}`} style={{ cursor: 'pointer' }}>
                {busy ? 'Reading scan…' : '📄 Upload scan report'}
                <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" hidden disabled={busy} onChange={pick} aria-label="Upload body scan report" />
              </label>
            )}
            <button type="button" className="secondary-btn" onClick={() => setEditing('new')}>
              Type it in
            </button>
          </div>
        )}
        {!apiKey && !editing && <p className="muted" style={{ fontSize: '0.8rem', marginTop: '6px' }}>Add a Gemini key in Settings to read a photo or PDF of the report automatically.</p>}
        {error && <div className="status-banner status-error" role="alert">{error}</div>}

        {editing && (
          <ScanEditor
            initial={editing === 'new' ? null : editing}
            units={units}
            currentWeightKg={profile.weightKg}
            onCancel={() => setEditing(null)}
            onSave={(scan, updateWeight) => {
              onSaveScan(scan, updateWeight);
              setEditing(null);
            }}
          />
        )}

        {latest && !editing && (
          <>
            <div className="stat-grid">
              {HEADLINE_METRICS.filter((id) => latest.metrics[id] != null).map((id) => {
                const m = METRIC_MAP[id];
                const d = delta(scans, id);
                const tone = d ? judge(id, d.change) : null;
                return (
                  <div className="stat-tile" key={id}>
                    <span className="stat-label">{m.short || m.label}</span>
                    <strong className="stat-value">{units.fmt(m, latest.metrics[id])}</strong>
                    {d && (
                      <span className={`stat-change trend-${tone || 'flat'}`}>
                        {d.change > 0 ? '▲' : d.change < 0 ? '▼' : '•'} {units.fmt(m, Math.abs(d.change))}
                        <span className="sr-only">{tone === 'good' ? ' (improved)' : tone === 'bad' ? ' (worse)' : ''}</span>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            {scans.length > 1 && <p className="muted" style={{ fontSize: '0.78rem', marginTop: '6px' }}>Changes are since your previous scan.</p>}
          </>
        )}
      </section>

      {insights.length > 0 && !editing && (
        <section className="card">
          <h2>What your scans say</h2>
          <ul className="insight-list">
            {insights.map((i, n) => (
              <li key={n} className={`insight-${i.kind}`}>
                <span aria-hidden="true">{i.kind === 'good' ? '✅' : i.kind === 'watch' ? '⚠️' : '💡'}</span>
                <span>{i.text}</span>
              </li>
            ))}
          </ul>
          {onAsk && (
            <button type="button" className="link-btn" onClick={() => onAsk('Looking at my body-composition scans, what should I focus on in training and nutrition?')}>
              Ask the coach about my scans →
            </button>
          )}
        </section>
      )}

      {scans.length >= 2 && !editing && (
        <section className="card">
          <h2>Trends</h2>
          <div className="trend-stack">
            {['weightKg', 'smmKg', 'pbf', 'bfmKg'].map((id) => chartFor(METRIC_MAP[id]))}
            {otherMetrics.length > 0 && (
              <div className="form-group">
                <label htmlFor="extra-metric">Another measure</label>
                <select id="extra-metric" value={extra} onChange={(e) => setExtra(e.target.value)}>
                  <option value="">Choose…</option>
                  {otherMetrics.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {extra && chartFor(METRIC_MAP[extra])}
          </div>
        </section>
      )}

      {scans.length > 0 && !editing && (
        <section className="card">
          <button type="button" className="plan-why-toggle" aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}>
            <strong>Scan history ({scans.length})</strong>
            <span aria-hidden="true">{showHistory ? '▴' : '▾'}</span>
          </button>
          {showHistory && (
            <ul className="scan-list">
              {[...scans].reverse().map((s) => (
                <li key={s.id}>
                  <div>
                    <strong>{fmtDate(s.date)}</strong>
                    <span className="muted">
                      {' '}
                      {['weightKg', 'smmKg', 'pbf']
                        .filter((id) => s.metrics[id] != null)
                        .map((id) => `${METRIC_MAP[id].short || METRIC_MAP[id].label} ${units.fmt(METRIC_MAP[id], s.metrics[id])}`)
                        .join(' · ')}
                    </span>
                  </div>
                  <div className="button-row">
                    <button type="button" className="mini-btn" onClick={() => setEditing(s)} aria-label={`Edit scan from ${fmtDate(s.date)}`}>
                      Edit
                    </button>
                    <button type="button" className="mini-btn" onClick={() => onDeleteScan(s.id)} aria-label={`Delete scan from ${fmtDate(s.date)}`}>
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ---- Training ---- */}
      <section className="card">
        <h2>Training</h2>
        <MiniBars
          title="Training days per week"
          bars={weeks.map((w, i) => ({ value: w.count, start: w.start, highlight: i === weeks.length - 1 }))}
          max={Math.max(3, Number(profile.daysPerWeek) || 3)}
          formatLabel={(b) => new Date(b.start).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }).replace(' ', ' ')}
          note={`target ${profile.daysPerWeek}/wk`}
        />
        {strength.length === 0 ? (
          <p className="muted">Log your sets on the Workout tab and your strength trends will appear here.</p>
        ) : (
          <div className="trend-stack">
            {strength.map((t) =>
              t.points.length >= 2 ? (
                <TrendChart
                  key={t.id}
                  title={`${t.name}: estimated 1-rep max`}
                  points={t.points.map((p) => ({ date: new Date(p.ts).toISOString().slice(0, 10), value: toDisplayWeight(p.value, profile.unitSystem) }))}
                  format={(v, signed) => `${signed && v < 0 ? '−' : ''}${Math.abs(v)} ${weightUnitLabel}`}
                  dateLabel={(d) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                  better="up"
                />
              ) : (
                <p key={t.id} className="muted">
                  <strong>{t.name}</strong>: estimated 1-rep max {toDisplayWeight(t.points[0].value, profile.unitSystem)} {weightUnitLabel}. Log it again to see a trend.
                </p>
              )
            )}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Fitness tests</h2>
        {(profile.baselines || []).length === 0 ? (
          <p className="muted">No fitness test yet. It takes about 3 minutes.</p>
        ) : (
          <ul className="scan-list">
            {(profile.baselines || []).map((t, i) => {
              const sc = scoreBaseline(t, profile.age);
              return (
                <li key={t.ts}>
                  <div>
                    <strong>{new Date(t.ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit' })}</strong>
                    {i === 0 && <span className="pill" style={{ marginLeft: 6 }}>latest</span>}
                    <div className="muted">
                      {[t.pushups != null && `${t.pushups} push-ups`, t.sitToStand != null && `${t.sitToStand} chair stands`, t.plankSec != null && `${t.plankSec}s plank`].filter(Boolean).join(' · ')}
                      {sc?.level ? ` · ${LEVEL_LABEL[sc.level]}` : ''}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <button type="button" className="link-btn" onClick={onRetest}>
          {(profile.baselines || []).length ? 'Retest now →' : 'Take the test →'}
        </button>
      </section>
    </div>
  );
}
