import React, { useMemo, useState } from 'react';
import {
  CONDITIONS,
  INJURY_AREAS,
  PARQ_QUESTIONS,
  PREGNANCY_OPTIONS,
  healthAdjustments,
  injuryStatus,
  parqComplete,
  sanitizeHealth,
  setInjury,
} from '../services/health';
import { BASELINE_TESTS, LEVEL_LABEL, MOBILITY_CHECKS, baselineDelta, latestBaseline, retestDue, scoreBaseline } from '../services/baseline';
import { MARKERS, MARKER_MAP, analyzeLabs } from '../services/labs';
import { prepareReportFile } from '../services/images';
import exercises from '../data/exercises.json';

const YesNo = ({ value, onChange, label }) => (
  <div className="segmented yesno" role="group" aria-label={label}>
    {[
      [true, 'Yes'],
      [false, 'No'],
    ].map(([v, t]) => (
      <button key={t} type="button" aria-pressed={value === v} className={value === v ? 'seg-active' : ''} onClick={() => onChange(v)}>
        {t}
      </button>
    ))}
  </div>
);

export function ClearanceBanner({ profile }) {
  const { clearance } = healthAdjustments(profile);
  if (clearance === 'none') return null;
  return (
    <div className={`status-banner ${clearance === 'strong' ? 'status-error' : 'status-warning'}`} role="status">
      {clearance === 'strong'
        ? '⚠️ Please check with a doctor before you start. Until then your plan stays very light.'
        : 'ℹ️ A quick check with your doctor is a good idea. Your plan starts gentle in the meantime.'}
    </div>
  );
}

/** PAR-Q style screening, conditions, medicine and pregnancy. */
export function HealthCheck({ profile, onChange }) {
  const h = sanitizeHealth(profile.health);
  const set = (patch) => onChange({ ...profile, health: { ...h, ...patch } });
  const toggleCondition = (id) =>
    set({ conditions: h.conditions.includes(id) ? h.conditions.filter((c) => c !== id) : [...h.conditions, id] });
  const adj = healthAdjustments(profile);

  return (
    <div className="health-check">
      <p className="muted">Seven quick yes/no questions, based on the PAR-Q+ screening used by gyms. A yes doesn't stop you training; it makes the plan more careful.</p>
      <ol className="parq-list">
        {PARQ_QUESTIONS.map((q) => (
          <li key={q.id}>
            <span>{q.text}</span>
            <YesNo label={q.text} value={h.parq[q.id]} onChange={(v) => set({ parq: { ...h.parq, [q.id]: v } })} />
          </li>
        ))}
      </ol>

      <div className="form-group">
        <label id="hc-cond">Anything a doctor has told you about? (tap all that apply)</label>
        <div className="chip-row" role="group" aria-labelledby="hc-cond">
          {CONDITIONS.map((c) => (
            <button key={c.id} type="button" aria-pressed={h.conditions.includes(c.id)} className={`chip ${h.conditions.includes(c.id) ? 'chip-active' : ''}`} onClick={() => toggleCondition(c.id)}>
              {h.conditions.includes(c.id) ? '✓ ' : '+ '}
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="parq-list">
        <div className="parq-row">
          <span>Do you take beta-blockers (often for blood pressure or heart rhythm)?</span>
          <YesNo label="Beta-blockers" value={h.betaBlocker} onChange={(v) => set({ betaBlocker: v })} />
        </div>
        {(h.conditions.includes('diabetes') || h.glucoseLoweringMeds) && (
          <div className="parq-row">
            <span>Do you take insulin or tablets that can make your sugar go low?</span>
            <YesNo label="Glucose-lowering medicine" value={h.glucoseLoweringMeds} onChange={(v) => set({ glucoseLoweringMeds: v })} />
          </div>
        )}
      </div>

      {profile.sex !== 'male' && (
        <div className="form-group">
          <label htmlFor="hc-preg">Pregnancy or recent birth</label>
          <select id="hc-preg" value={h.pregnancy} onChange={(e) => set({ pregnancy: e.target.value })}>
            {PREGNANCY_OPTIONS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <ClearanceBanner profile={profile} />
      {adj.notes.filter((n) => n.kind === 'safety' || n.kind === 'warning').length > 0 && (
        <ul className="health-notes">
          {adj.notes
            .filter((n) => n.kind === 'safety' || n.kind === 'warning')
            .map((n, i) => (
              <li key={i}>{n.text}</li>
            ))}
        </ul>
      )}
      {!parqComplete(h) && <p className="muted" style={{ fontSize: '0.8rem' }}>Answer all seven questions so the plan knows how careful to be.</p>}
    </div>
  );
}

const STATUS_LABEL = { none: 'Fine', old: 'Old injury', current: 'Sore now' };

/** Eight body areas, each fine / old injury / sore now. "Sore now" removes exercises that load it. */
export function InjuryGrid({ profile, onChange }) {
  return (
    <div className="injury-grid">
      {INJURY_AREAS.map((a) => {
        const status = injuryStatus(profile, a.id);
        return (
          <div className="injury-row" key={a.id}>
            <span className="injury-name">{a.label}</span>
            <div className="segmented" role="group" aria-label={`${a.label} status`}>
              {['none', 'old', 'current'].map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-label={`${a.label}: ${STATUS_LABEL[s]}`}
                  aria-pressed={status === s}
                  className={status === s ? `seg-active ${s === 'current' ? 'seg-warn' : ''}` : ''}
                  onClick={() => onChange(setInjury(profile, a.id, s))}
                >
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          </div>
        );
      })}
      <p className="muted" style={{ fontSize: '0.8rem' }}>
        <strong>Sore now</strong> removes exercises that load that area. <strong>Old injury</strong> keeps them but adds a warm-up note.
      </p>
    </div>
  );
}

/** Three short tests plus two mobility checks. Saving adds an entry to the person's test history. */
export function FitnessTest({ profile, onChange }) {
  const last = latestBaseline(profile);
  const [form, setForm] = useState({ pushups: '', pushupType: 'standard', sitToStand: '', plankSec: '', overheadReach: null, deepSquat: null });
  const [saved, setSaved] = useState(false);
  const score = scoreBaseline(last, profile.age);
  const delta = baselineDelta(profile);
  const due = retestDue(profile);
  const upd = (k, v) => {
    setSaved(false);
    setForm((f) => ({ ...f, [k]: v }));
  };
  const anyValue = form.pushups !== '' || form.sitToStand !== '' || form.plankSec !== '' || form.overheadReach !== null || form.deepSquat !== null;

  const save = () => {
    const entry = {
      ts: Date.now(),
      pushups: form.pushups === '' ? null : Number(form.pushups),
      pushupType: form.pushupType,
      sitToStand: form.sitToStand === '' ? null : Number(form.sitToStand),
      plankSec: form.plankSec === '' ? null : Number(form.plankSec),
      overheadReach: form.overheadReach,
      deepSquat: form.deepSquat,
    };
    onChange({ ...profile, baselines: [entry, ...(profile.baselines || [])] });
    setForm({ pushups: '', pushupType: form.pushupType, sitToStand: '', plankSec: '', overheadReach: null, deepSquat: null });
    setSaved(true);
  };

  const fmtDelta = (k, unit) => (delta?.[k] == null ? '' : ` (${delta[k] >= 0 ? '+' : ''}${delta[k]}${unit} vs last time)`);

  return (
    <div className="fitness-test">
      {last && (
        <div className="kpi-card" style={{ marginBottom: '10px' }}>
          <span className="kpi-label">Last test · {new Date(last.ts).toLocaleDateString()}</span>
          <strong className="kpi-value accent-text">{score?.level ? LEVEL_LABEL[score.level] : 'Mobility checked'}</strong>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: '0.85rem' }}>
            {last.pushups != null && `${last.pushups} ${last.pushupType === 'knee' ? 'knee ' : ''}push-ups${fmtDelta('pushups', '')}. `}
            {last.sitToStand != null && `${last.sitToStand} chair stands${fmtDelta('sitToStand', '')}. `}
            {last.plankSec != null && `${last.plankSec}s plank${fmtDelta('plankSec', 's')}.`}
          </p>
        </div>
      )}
      {due && <div className="status-banner status-warning">⏱️ It's been a full block since your last test. Retest to see your progress.</div>}
      <p className="muted">About 3 minutes. Do what you can and leave the rest blank; warm up first and stop if anything hurts.</p>

      {BASELINE_TESTS.map((t) => (
        <div className="form-group" key={t.id}>
          <label htmlFor={`bt-${t.id}`}>
            {t.name} ({t.unit})
          </label>
          <p className="muted" style={{ fontSize: '0.8rem', margin: '0 0 6px' }}>{t.how}</p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input id={`bt-${t.id}`} type="number" inputMode="numeric" min="0" max={t.max} value={form[t.id]} onChange={(e) => upd(t.id, e.target.value)} />
            {t.id === 'pushups' && (
              <select aria-label="Push-up type" value={form.pushupType} onChange={(e) => upd('pushupType', e.target.value)}>
                <option value="standard">Full push-ups</option>
                <option value="knee">Knee push-ups</option>
              </select>
            )}
          </div>
        </div>
      ))}
      {MOBILITY_CHECKS.map((m) => (
        <div className="parq-row" key={m.id}>
          <span>{m.question}</span>
          <YesNo label={m.question} value={form[m.id]} onChange={(v) => upd(m.id, v)} />
        </div>
      ))}
      {saved && <div className="status-banner status-success">Saved. Your next plan will use these results.</div>}
      <button type="button" className="secondary-btn" disabled={!anyValue} onClick={save}>
        Save test results
      </button>
    </div>
  );
}

const STATUS_BADGE = { low: '↓ Low', high: '↑ High', normal: '✓ Normal', unknown: '·' };

/** Upload a report (Gemini reads it) or type values in; shows what each flagged value means for training. */
export function LabReport({ profile, onChange, apiKey, onExtract }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState(null);
  const [manual, setManual] = useState({ id: 'hemoglobin', value: '' });
  const analysis = useMemo(() => (profile.labs ? analyzeLabs(profile.labs, profile.sex) : null), [profile.labs, profile.sex]);

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setBusy(true);
    try {
      const prepared = await prepareReportFile(file);
      setDraft(await onExtract(prepared));
    } catch (err) {
      setError(err?.message || 'Could not read that report.');
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = () => {
    onChange({ ...profile, labs: draft });
    setDraft(null);
  };

  const addManual = () => {
    const m = MARKER_MAP[manual.id];
    const v = Number(manual.value);
    if (!Number.isFinite(v) || manual.value === '') return;
    const existing = profile.labs?.markers || [];
    const markers = [...existing.filter((x) => x.id !== m.id), { id: m.id, name: m.name, value: v, unit: m.unit }];
    onChange({ ...profile, labs: { date: profile.labs?.date || new Date().toISOString().slice(0, 10), source: 'manual', markers } });
    setManual({ ...manual, value: '' });
  };

  const rows = draft ? analyzeLabs(draft, profile.sex).results : analysis?.results || [];

  return (
    <div className="lab-report">
      <p className="muted">
        Add a recent blood test to fine-tune effort and get plain-language notes. Only the numbers are saved, never the file.
        {apiKey ? ' The file is sent to Google Gemini with your key to read the values.' : ' Without an API key you can type the values in.'}
      </p>

      {apiKey && (
        <label className={`secondary-btn ${busy ? 'is-disabled' : ''}`} style={{ display: 'inline-block', cursor: 'pointer' }}>
          {busy ? 'Reading report…' : '📄 Upload report (photo or PDF)'}
          <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" hidden disabled={busy} onChange={pick} aria-label="Upload blood report" />
        </label>
      )}
      {error && <div className="status-banner status-error" role="alert">{error}</div>}

      {rows.length > 0 && (
        <>
          {draft && <div className="status-banner status-warning">Check these against your report, remove anything misread, then save.</div>}
          <ul className="lab-list">
            {rows.map((r, i) => (
              <li key={`${r.name}-${i}`} className={`lab-${r.status}`}>
                <div className="lab-head">
                  <strong>{r.name}</strong>
                  <span>
                    {r.value} {r.unit}
                  </span>
                  <span className="lab-badge">{STATUS_BADGE[r.status] || ''}</span>
                  <button
                    type="button"
                    className="chip"
                    aria-label={`Remove ${r.name}`}
                    onClick={() => {
                      const src = draft || profile.labs;
                      const markers = src.markers.filter((_, idx) => idx !== i);
                      if (draft) setDraft(markers.length ? { ...draft, markers } : null);
                      else onChange({ ...profile, labs: markers.length ? { ...src, markers } : null });
                    }}
                  >
                    ✕
                  </button>
                </div>
                {r.text && (r.status === 'low' || r.status === 'high') && (
                  <p className="muted lab-text">
                    {r.band ? `In the ${r.band}. ` : ''}
                    {r.text}
                    {r.doctor ? ' Worth discussing with your doctor.' : ''}
                  </p>
                )}
              </li>
            ))}
          </ul>
          {draft ? (
            <div className="button-row">
              <button type="button" className="primary-btn" onClick={saveDraft}>Save these results</button>
              <button type="button" className="secondary-btn" onClick={() => setDraft(null)}>Discard</button>
            </div>
          ) : (
            <p className="muted" style={{ fontSize: '0.8rem' }}>
              {analysis?.flagged.length ? `${analysis.flagged.length} value(s) outside the usual range.` : 'Everything readable is within the usual range.'} Reference ranges vary by lab; yours wins. This is not a diagnosis.
            </p>
          )}
        </>
      )}

      {!draft && (
        <div className="form-group" style={{ marginTop: '10px' }}>
          <label htmlFor="lab-manual">Or type a value in</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <select id="lab-manual" value={manual.id} onChange={(e) => setManual({ ...manual, id: e.target.value })}>
              {MARKERS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.unit})
                </option>
              ))}
            </select>
            <input type="number" inputMode="decimal" step="any" aria-label="Value" placeholder="value" value={manual.value} onChange={(e) => setManual({ ...manual, value: e.target.value })} />
            <button type="button" className="secondary-btn" onClick={addManual}>Add</button>
          </div>
        </div>
      )}
      {profile.labs && !draft && (
        <button type="button" className="secondary-btn" onClick={() => onChange({ ...profile, labs: null })}>
          Delete blood report data
        </button>
      )}
    </div>
  );
}

const ACTIVITY = [
  ['sedentary', 'Mostly sitting'],
  ['light', 'Light (some walking)'],
  ['active', 'On my feet a lot'],
  ['very_active', 'Very active / physical job'],
];
const TIMES = [
  ['morning', 'Morning'],
  ['afternoon', 'Afternoon'],
  ['evening', 'Evening'],
  ['any', 'Varies'],
];

/** Goal in their own words, lifestyle, and exercises they love or hate. */
export function AboutYou({ profile, onChange }) {
  const pref = profile.preferences || {};
  const set = (patch) => onChange({ ...profile, preferences: { ...pref, ...patch } });
  const [pickLike, setPickLike] = useState('');
  const [pickDislike, setPickDislike] = useState('');
  const sorted = useMemo(() => [...exercises].sort((a, b) => a.name.localeCompare(b.name)), []);
  const name = (id) => exercises.find((e) => e.id === id)?.name || id;
  const list = (key, label) => (
    <div className="chip-row">
      {(pref[key] || []).map((id) => (
        <button key={id} type="button" className="chip chip-active" aria-label={`Remove ${name(id)} from ${label}`} onClick={() => set({ [key]: pref[key].filter((x) => x !== id) })}>
          {name(id)} ✕
        </button>
      ))}
    </div>
  );
  const adder = (key, value, setValue, label) => (
    <div style={{ display: 'flex', gap: '8px' }}>
      <select aria-label={label} value={value} onChange={(e) => setValue(e.target.value)}>
        <option value="">Choose an exercise…</option>
        {sorted
          .filter((e) => !(pref.likes || []).includes(e.id) && !(pref.dislikes || []).includes(e.id))
          .map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
      </select>
      <button
        type="button"
        className="secondary-btn"
        disabled={!value}
        onClick={() => {
          set({ [key]: [...(pref[key] || []), value] });
          setValue('');
        }}
      >
        Add
      </button>
    </div>
  );

  return (
    <div className="about-you">
      <div className="form-group">
        <label htmlFor="ay-goal">In your own words, what would success look like in 3 months?</label>
        <input id="ay-goal" type="text" maxLength={160} placeholder="e.g. do 10 proper push-ups, lift my kid without back pain" value={pref.specificGoal || ''} onChange={(e) => set({ specificGoal: e.target.value })} />
      </div>
      <div className="form-group">
        <label htmlFor="ay-why">Why does that matter to you? (optional)</label>
        <input id="ay-why" type="text" maxLength={200} value={pref.goalWhy || ''} onChange={(e) => set({ goalWhy: e.target.value })} />
      </div>
      <div className="grid-2">
        <div className="form-group">
          <label htmlFor="ay-activity">Day-to-day activity</label>
          <select id="ay-activity" value={pref.activity || ''} onChange={(e) => set({ activity: e.target.value })}>
            <option value="">Choose…</option>
            {ACTIVITY.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="ay-time">Usual training time</label>
          <select id="ay-time" value={pref.timeOfDay || ''} onChange={(e) => set({ timeOfDay: e.target.value })}>
            <option value="">Choose…</option>
            {TIMES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-group">
        <label htmlFor="ay-sports">Other sports or activities (optional)</label>
        <input id="ay-sports" type="text" maxLength={100} placeholder="e.g. badminton twice a week, weekend runs" value={pref.sports || ''} onChange={(e) => set({ sports: e.target.value })} />
      </div>
      <div className="form-group">
        <label>Exercises you enjoy (the coach will favour them)</label>
        {list('likes', 'likes')}
        {adder('likes', pickLike, setPickLike, 'Add an exercise you enjoy')}
      </div>
      <div className="form-group">
        <label>Exercises you'd rather skip</label>
        {list('dislikes', 'dislikes')}
        {adder('dislikes', pickDislike, setPickDislike, "Add an exercise you'd rather skip")}
      </div>
    </div>
  );
}

/** How complete the profile is, for a progress bar. */
export function profileCompleteness(profile) {
  const pref = profile.preferences || {};
  const checks = [
    ['Basics', true],
    ['Health check', parqComplete(profile.health)],
    ['Injuries', Object.keys(profile.health?.injuries || {}).length > 0 || Object.values(profile.jointFlags || {}).some(Boolean)],
    ['Fitness test', (profile.baselines || []).length > 0],
    ['Blood report', Boolean(profile.labs)],
    ['About you', Boolean(pref.specificGoal || pref.activity)],
  ];
  return { checks, pct: Math.round((checks.filter(([, ok]) => ok).length / checks.length) * 100) };
}
