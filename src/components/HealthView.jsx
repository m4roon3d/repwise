import React, { useMemo, useState } from 'react';
import TrendChart from './TrendChart';
import { MARKERS, MARKER_MAP, analyzeLabs, markerSeries, previousValue, sanitizeReport, tipsFor, groupResults, flaggedHeadline, shortName } from '../services/labs';
import { healthAdjustments, labFinisher } from '../services/health';
import { prepareReportFile } from '../services/images';
import { fmtDate } from '../services/bodyComp';

const STATUS = { low: { label: 'Low', icon: '↓' }, high: { label: 'High', icon: '↑' }, normal: { label: 'Normal', icon: '✓' }, unknown: { label: 'Not checked', icon: '·' } };
const OVERALL = { good: ['✅', 'Looking good'], mixed: ['🟡', 'A few things to work on'], needs_attention: ['⚠️', 'Needs attention'] };
const AREA_ICON = { nutrition: '🥗', sleep: '😴', cardio: '🚶', strength: '🏋️', lifestyle: '🌿' };
const today = () => new Date().toISOString().slice(0, 10);
const shortDate = (iso) => {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : `${d.toLocaleDateString(undefined, { month: 'short' })} '${String(d.getFullYear()).slice(2)}`;
};
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Where a value sits against its typical range, as a small bar. */
function RangeBar({ value, range, status }) {
  if (!range || value == null) return null;
  const hi = range.high >= 1000 ? range.low * 2 : range.high;
  const lo = Math.max(0, range.low);
  const min = Math.min(lo - (hi - lo) * 0.5, value);
  const max = Math.max(hi + (hi - lo) * 0.5, value);
  const pct = (v) => `${(((v - min) / (max - min || 1)) * 100).toFixed(1)}%`;
  return (
    <div className="range-bar" aria-hidden="true">
      <div className="range-ok" style={{ left: pct(lo), width: `calc(${pct(hi)} - ${pct(lo)})` }} />
      <div className={`range-dot range-${status}`} style={{ left: pct(value) }} />
    </div>
  );
}

/** Type values in, or review what Gemini read off a report. */
function ReportEditor({ initial, onSave, onCancel }) {
  const [date, setDate] = useState(initial?.date || today());
  const [rows, setRows] = useState(() =>
    initial?.markers?.length ? initial.markers.map((m) => ({ ...m, value: String(m.value) })) : [{ id: 'hemoglobin', name: MARKER_MAP.hemoglobin.name, value: '', unit: MARKER_MAP.hemoglobin.unit }]
  );
  const [error, setError] = useState('');
  const fromUpload = initial?.source === 'upload';
  const set = (i, patch) => setRows((r) => r.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));

  const save = () => {
    const report = sanitizeReport({ id: initial?.id, date, source: initial?.source || 'manual', markers: rows.filter((r) => r.value !== '').map((r) => ({ ...r, value: Number(r.value) })) });
    if (!report) return setError('Add at least one value.');
    onSave(report);
  };

  return (
    <div className="scan-editor">
      {fromUpload && <div className="status-banner status-warning">Check these against your report, fix or remove anything misread, then save.</div>}
      <div className="form-group" style={{ marginTop: '10px' }}>
        <label htmlFor="lab-date">Report date</label>
        <input id="lab-date" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
      </div>
      <ul className="lab-edit-list">
        {rows.map((r, i) => (
          <li key={i}>
            {fromUpload && !MARKER_MAP[r.id] ? (
              <span className="lab-edit-name">{r.name}</span>
            ) : (
              <select
                aria-label={`Test ${i + 1}`}
                value={r.id || ''}
                onChange={(e) => {
                  const m = MARKER_MAP[e.target.value];
                  set(i, { id: m.id, name: m.name, unit: m.unit });
                }}
              >
                {MARKERS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            )}
            <input type="number" inputMode="decimal" step="any" aria-label={`${r.name} value`} value={r.value} onChange={(e) => set(i, { value: e.target.value })} />
            <span className="lab-edit-unit">{r.unit}</span>
            <button type="button" className="chip" aria-label={`Remove ${r.name}`} onClick={() => setRows((x) => x.filter((_, idx) => idx !== i))}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="link-btn"
        onClick={() => {
          const used = new Set(rows.map((r) => r.id));
          const m = MARKERS.find((x) => !used.has(x.id)) || MARKERS[0];
          setRows((x) => [...x, { id: m.id, name: m.name, value: '', unit: m.unit }]);
        }}
      >
        + Add another test
      </button>
      {error && <div className="status-banner status-error" role="alert">{error}</div>}
      <div className="button-row" style={{ marginTop: '10px' }}>
        <button type="button" className="primary-btn" onClick={save}>Save report</button>
        <button type="button" className="secondary-btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export default function HealthView({ reports, profile, apiKey, onSave, onDelete, onExtract, onAnalyze, onAsk }) {
  const [editing, setEditing] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [showNormal, setShowNormal] = useState(false);
  const [trendId, setTrendId] = useState('');

  const idx = Math.max(0, selectedId ? reports.findIndex((r) => r.id === selectedId) : reports.length - 1);
  const report = reports[idx];
  const isLatest = idx === reports.length - 1;
  const analysis = report?.analysis;
  const results = useMemo(() => (report ? analyzeLabs(report, profile.sex).results : []), [report, profile.sex]);
  const flagged = results.filter((r) => r.status === 'low' || r.status === 'high');
  const normal = results.filter((r) => r.status === 'normal' || r.status === 'unknown');
  const flaggedGroups = useMemo(() => groupResults(flagged), [results]); // eslint-disable-line react-hooks/exhaustive-deps
  const cardId = (r) => `lab-card-${r.id || norm(r.name).replace(/\s+/g, '-')}`;
  const jumpTo = (r) => document.getElementById(cardId(r))?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  const adj = healthAdjustments(profile);
  const finisher = labFinisher(profile);
  const trendable = MARKERS.filter((m) => markerSeries(reports, m.id, profile.sex).length >= 2);
  const aiFor = (r) => analysis?.markers?.find((m) => norm(m.name) === norm(r.name) || (r.id && norm(m.name).includes(norm(MARKER_MAP[r.id]?.name).slice(0, 6))));

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setBusy('read');
    try {
      setEditing(await onExtract(await prepareReportFile(file)));
    } catch (err) {
      setError(err?.message || 'Could not read that report.');
    } finally {
      setBusy('');
    }
  };

  const analyze = async () => {
    setError('');
    setBusy('analyze');
    try {
      await onAnalyze(report.id);
    } catch (err) {
      setError(err?.message || 'The analysis failed. Try again.');
    } finally {
      setBusy('');
    }
  };

  const uploadButtons = (
    <div className="button-row" style={{ marginTop: '12px' }}>
      {apiKey && (
        <>
          <label className={`primary-btn ${busy ? 'is-disabled' : ''}`} style={{ cursor: 'pointer' }}>
            {busy === 'read' ? 'Reading report…' : '📷 Photo of report'}
            <input type="file" accept="image/*" hidden disabled={Boolean(busy)} onChange={pick} aria-label="Upload blood report photo" />
          </label>
          <label className={`secondary-btn ${busy ? 'is-disabled' : ''}`} style={{ cursor: 'pointer' }}>
            📄 PDF
            <input type="file" accept="application/pdf,.pdf" hidden disabled={Boolean(busy)} onChange={pick} aria-label="Upload blood report PDF" />
          </label>
        </>
      )}
      <button type="button" className="secondary-btn" onClick={() => setEditing('new')}>
        Type it in
      </button>
    </div>
  );

  return (
    <div className="panel-stack health-view">
      <section className="card">
        <h2>Blood reports</h2>
        <p className="muted">
          {report
            ? `${reports.length} report${reports.length > 1 ? 's' : ''} · latest ${fmtDate(reports.at(-1).date)}. Results shape your training plan.`
            : 'Add a blood test to get a plain-language analysis, tips to improve your numbers, and a training plan that takes them into account.'}
        </p>
        {!editing && uploadButtons}
        {!apiKey && !editing && <p className="muted" style={{ fontSize: '0.8rem', marginTop: '6px' }}>Add a Gemini key in Settings to read reports automatically and get the AI analysis.</p>}
        {error && <div className="status-banner status-error" role="alert">{error}</div>}
        {editing && (
          <ReportEditor
            initial={editing === 'new' ? null : editing}
            onCancel={() => setEditing(null)}
            onSave={(r) => {
              onSave(r);
              setSelectedId(r.id);
              setEditing(null);
            }}
          />
        )}
        {reports.length > 1 && !editing && (
          <div className="chip-row chip-scroll" style={{ marginTop: '12px' }} role="group" aria-label="Choose report">
            {[...reports].reverse().map((r) => (
              <button key={r.id} type="button" aria-pressed={r.id === report.id} className={`chip ${r.id === report.id ? 'chip-active' : ''}`} onClick={() => setSelectedId(r.id)}>
                {fmtDate(r.date)}
              </button>
            ))}
          </div>
        )}
      </section>

      {report && !editing && (
        <>
          <section className="card">
            <div className="card-head">
              <div>
                <h2>{analysis ? `${OVERALL[analysis.overall][0]} ${OVERALL[analysis.overall][1]}` : flagged.length ? `${flagged.length} result${flagged.length > 1 ? 's' : ''} to work on` : '✅ All within range'}</h2>
                <p className="muted">Report from {fmtDate(report.date)}</p>
              </div>
            </div>
            {flagged.length > 0 && !analysis?.summary && <p className="flag-headline">{flaggedHeadline(flagged)}</p>}
            {analysis?.summary && <p className="summary-text">{analysis.summary}</p>}
            {flagged.length > 0 ? (
              <div className="flag-groups">
                {flaggedGroups.map((g) => (
                  <div key={g.id} className="flag-group">
                    <span className="flag-group-label">{g.label}</span>
                    <ul className="flag-rows">
                      {g.items.map((r) => (
                        <li key={cardId(r)}>
                          <button type="button" className={`flag-row flag-${r.status}`} onClick={() => jumpTo(r)} aria-label={`${r.name}: ${r.value} ${r.unit}, ${STATUS[r.status].label}. Show details`}>
                            <span className="flag-arrow" aria-hidden="true">{STATUS[r.status].icon}</span>
                            <span className="flag-name">{shortName(r)}</span>
                            <span className="flag-val">
                              {r.value} <small>{r.unit}</small>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                <p className="muted small">Tap a result for what it means and what helps.</p>
              </div>
            ) : (
              !analysis?.summary && <p className="summary-text">Every result we could check is within the typical range. Keep doing what you are doing.</p>
            )}
            {apiKey ? (
              <button type="button" className={analysis ? 'link-btn' : 'primary-btn'} onClick={analyze} disabled={Boolean(busy)} style={{ marginTop: '10px' }}>
                {busy === 'analyze' ? 'Analysing…' : analysis ? '↻ Refresh AI analysis' : '✨ Analyse with AI'}
              </button>
            ) : null}
            {analysis && <p className="muted" style={{ fontSize: '0.75rem', marginTop: '4px' }}>AI analysis from {new Date(analysis.generatedAt).toLocaleDateString()}. Not a diagnosis.</p>}
          </section>

          {flagged.length > 0 && (
            <section className="card">
              <h2>Needs attention</h2>
              {flaggedGroups.map((g) => (
              <div key={g.id} className="marker-group">
              {flaggedGroups.length > 1 && <h3 className="marker-group-label">{g.label}</h3>}
              <ul className="marker-list">
                {g.items.map((r, i) => {
                  const ai = aiFor(r);
                  const prev = r.id ? previousValue(reports, idx, r.id) : null;
                  const tips = ai?.tips?.length ? ai.tips : tipsFor(r.id, r.status);
                  return (
                    <li key={i} id={cardId(r)} className={`marker-card lab-${r.status}`}>
                      <div className="lab-head">
                        <strong>{r.name}</strong>
                        <span>
                          {r.value} {r.unit}
                        </span>
                        <span className="lab-badge">
                          {STATUS[r.status].icon} {STATUS[r.status].label}
                        </span>
                      </div>
                      <RangeBar value={r.canonical} range={r.range} status={r.status} />
                      {prev && (
                        <p className="muted marker-prev">
                          Previously {prev.value} {r.canonicalUnit} ({fmtDate(prev.date)}){' '}
                          {Math.abs(r.canonical - prev.value) > 0.001 && (r.canonical - prev.value > 0) === (r.status === 'low') ? '· improving ✓' : ''}
                        </p>
                      )}
                      <p className="marker-text">
                        {r.band ? `In the ${r.band}. ` : ''}
                        {ai?.meaning || r.text}
                      </p>
                      {ai?.training && <p className="marker-text"><strong>Training:</strong> {ai.training}</p>}
                      {tips.length > 0 && (
                        <ul className="tip-list">
                          {tips.map((t, k) => (
                            <li key={k}>{t}</li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
              </div>
              ))}
            </section>
          )}

          {normal.length > 0 && (
            <section className="card">
              <button type="button" className="plan-why-toggle" aria-expanded={showNormal} onClick={() => setShowNormal(!showNormal)}>
                <strong>
                  {(() => {
                    const ok = normal.filter((r) => r.status === 'normal').length;
                    const other = normal.length - ok;
                    return `${ok ? `Within range (${ok})` : 'Other results'}${other ? ` · ${other} not assessed` : ''}`;
                  })()}
                </strong>
                <span aria-hidden="true">{showNormal ? '▴' : '▾'}</span>
              </button>
              {showNormal && (
                <ul className="lab-list">
                  {normal.map((r, i) => (
                    <li key={i} className={`lab-${r.status}`}>
                      <div className="lab-head">
                        <strong>{r.name}</strong>
                        <span>
                          {r.value} {r.unit}
                        </span>
                        <span className="lab-badge">
                          {STATUS[r.status].icon} {STATUS[r.status].label}
                        </span>
                      </div>
                      <RangeBar value={r.canonical} range={r.range} status={r.status} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {isLatest && (adj.labs?.rpeCap || finisher || analysis?.trainingAdjustments?.length) ? (
            <section className="card">
              <h2>How this shapes your training</h2>
              <ul className="insight-list">
                {adj.labs?.rpeCap && (
                  <li>
                    <span aria-hidden="true">📉</span>
                    <span>Effort is capped at RPE {adj.labs.rpeCap} (about {adj.labs.rpeCap <= 7 ? '3' : '2'} reps in reserve) until these results improve.</span>
                  </li>
                )}
                {finisher && (
                  <li>
                    <span aria-hidden="true">🚶</span>
                    <span>
                      Every session ends with a {finisher.title.toLowerCase()}: {finisher.text}
                    </span>
                  </li>
                )}
                {(analysis?.trainingAdjustments || []).map((t, i) => (
                  <li key={i}>
                    <span aria-hidden="true">🧠</span>
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
              <p className="muted" style={{ fontSize: '0.8rem' }}>Generate a new plan on the Coach tab to apply these.</p>
            </section>
          ) : null}

          {analysis?.lifestyleTips?.length > 0 && (
            <section className="card">
              <h2>What helps</h2>
              <ul className="insight-list">
                {analysis.lifestyleTips.map((t, i) => (
                  <li key={i}>
                    <span aria-hidden="true">{AREA_ICON[t.area]}</span>
                    <span>{t.tip}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(analysis?.doctorQuestions?.length > 0 || adj.labs?.doctor) && (
            <section className="card">
              <h2>Ask your doctor</h2>
              {analysis?.doctorQuestions?.length ? (
                <ul className="tip-list">
                  {analysis.doctorQuestions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              ) : (
                <p className="muted">
                  Worth discussing: {flagged.filter((r) => r.doctor).map((r) => r.name).join(', ')}.
                </p>
              )}
            </section>
          )}

          {trendable.length > 0 && (
            <section className="card">
              <h2>Trends</h2>
              <div className="trend-stack">
                {trendable
                  .filter((m) => flagged.some((r) => r.id === m.id))
                  .slice(0, 3)
                  .map((m) => (
                    <TrendChart key={m.id} title={`${m.name} (${m.unit})`} points={markerSeries(reports, m.id, profile.sex)} format={(v) => `${v < 0 ? '−' : ''}${Number(Math.abs(v).toFixed(1))}`} dateLabel={shortDate} />
                  ))}
                <div className="form-group">
                  <label htmlFor="lab-trend">See a trend</label>
                  <select id="lab-trend" value={trendId} onChange={(e) => setTrendId(e.target.value)}>
                    <option value="">Choose a test…</option>
                    {trendable.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
                {trendId && (
                  <TrendChart title={`${MARKER_MAP[trendId].name} (${MARKER_MAP[trendId].unit})`} points={markerSeries(reports, trendId, profile.sex)} format={(v) => `${Number(v.toFixed(1))}`} dateLabel={shortDate} />
                )}
              </div>
            </section>
          )}

          <section className="card">
            <div className="button-row">
              {onAsk && (
                <button type="button" className="secondary-btn" onClick={() => onAsk(`About my blood report from ${report.date}: what should I prioritise, and how should it change my training?`)}>
                  Ask the coach
                </button>
              )}
              <button type="button" className="secondary-btn" onClick={() => setEditing(report)}>
                Edit values
              </button>
              <button
                type="button"
                className="secondary-btn"
                onClick={() => {
                  if (typeof window === 'undefined' || !window.confirm || window.confirm('Delete this report?')) {
                    onDelete(report.id);
                    setSelectedId(null);
                  }
                }}
              >
                Delete report
              </button>
            </div>
            <p className="muted" style={{ fontSize: '0.75rem', marginTop: '10px' }}>
              Typical adult ranges are used; your lab's own ranges take priority. This is general guidance, not a diagnosis. Only the numbers are stored, never the report file.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
