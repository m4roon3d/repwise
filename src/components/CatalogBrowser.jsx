import React, { useEffect, useMemo, useState } from 'react';
import ExercisePhotos from './ExercisePhotos';
import { EQUIPMENT_TIER_LABELS } from '../services/catalogFilter';
import { exercises, MOVEMENT_PATTERNS, PATTERN_LABELS, TIERS, STRESS_AREAS, MAX_CUSTOM, slugFor, sanitizeCustomExercise } from '../services/catalog';
import { loadCustomExercises, saveCustomExercises } from '../services/storage';
import { suggestExercises } from '../services/geminiCoach';

const STYLE_OPTIONS = [
  ['all', 'All'],
  ['gym', '🏋️ Gym'],
  ['calisthenics', '🤸 Body'],
  ['yoga', '🧘 Yoga'],
  ['cardio', '🏃 Cardio'],
];
const STYLE_LABELS = { gym: 'Gym', calisthenics: 'Bodyweight', yoga: 'Yoga', cardio: 'Cardio' };
const TIER_SHORT = { commercial_gym: 'Full gym', apartment_gym: 'Apartment gym', home_setup: 'Home' };
const DOSE_LABELS = { reps: 'Sets × reps', time: 'Hold (seconds)', duration: 'Minutes (cardio)' };
const AREA_LABELS = { knee: 'Knee', shoulder: 'Shoulder', lower_back: 'Lower back', wrist: 'Wrist', elbow: 'Elbow', hip: 'Hip', ankle: 'Ankle', neck: 'Neck', impact: 'Jumping / impact' };
const AI_IDEAS = ['Kettlebell moves for shoulders', 'Mobility for desk workers', 'Low-impact cardio at home', 'Core work without lying down', 'Resistance band back exercises'];

const EMPTY_DRAFT = { name: '', movement_pattern: 'core', modalities: ['gym'], equipment_tiers: [...TIERS], equipment_label: '', muscles: '', dose: 'reps', joint_stress_flags: [], cuesText: '' };

function toggle(list, v) {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function ChipToggles({ options, value, onChange, label }) {
  return (
    <div className="chip-row" role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} type="button" aria-pressed={value.includes(v)} className={`chip ${value.includes(v) ? 'chip-active' : ''}`} onClick={() => onChange(toggle(value, v))}>
          {l}
        </button>
      ))}
    </div>
  );
}

/** Add or edit one of your own exercises. */
function ExerciseEditor({ initial, onSave, onCancel }) {
  const [d, setD] = useState(() =>
    initial
      ? { ...EMPTY_DRAFT, ...initial, muscles: initial.primary_muscles.join(', '), cuesText: initial.cues.join('\n') }
      : EMPTY_DRAFT
  );
  const [error, setError] = useState('');
  const set = (k) => (v) => setD((p) => ({ ...p, [k]: v }));

  const save = () => {
    if (!d.name.trim()) return setError('Give it a name.');
    if (!d.modalities.length) return setError('Pick at least one style.');
    const taken = new Set(exercises.map((e) => e.id));
    if (initial) taken.delete(initial.id);
    const dup = exercises.find((e) => e.id !== initial?.id && e.name.toLowerCase() === d.name.trim().toLowerCase());
    if (dup) return setError(`"${dup.name}" is already in the library.`);
    const ex = sanitizeCustomExercise({
      ...d,
      id: initial?.id || slugFor(d.name, taken),
      primary_muscles: d.muscles.split(','),
      cues: d.cuesText.split('\n'),
      source: initial?.source || 'manual',
    });
    if (!ex) return setError('Something in that form is not valid.');
    onSave(ex);
  };

  return (
    <section className="card ex-editor" aria-label={initial ? 'Edit exercise' : 'Add an exercise'}>
      <h3>{initial ? 'Edit exercise' : 'Add an exercise'}</h3>
      <label className="field">
        <span>Name</span>
        <input type="text" value={d.name} maxLength={60} placeholder="e.g. Landmine Press" onChange={(e) => set('name')(e.target.value)} />
      </label>
      <div className="grid-2">
        <label className="field">
          <span>Movement</span>
          <select value={d.movement_pattern} onChange={(e) => set('movement_pattern')(e.target.value)}>
            {MOVEMENT_PATTERNS.map((p) => (
              <option key={p} value={p}>{PATTERN_LABELS[p][0].toUpperCase() + PATTERN_LABELS[p].slice(1)}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Prescribed as</span>
          <select value={d.dose} onChange={(e) => set('dose')(e.target.value)}>
            {Object.entries(DOSE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>Equipment</span>
        <input type="text" value={d.equipment_label} maxLength={50} placeholder="e.g. Barbell in a landmine" onChange={(e) => set('equipment_label')(e.target.value)} />
      </label>
      <label className="field">
        <span>Main muscles (comma separated)</span>
        <input type="text" value={d.muscles} placeholder="e.g. Shoulders, Triceps" onChange={(e) => set('muscles')(e.target.value)} />
      </label>
      <div className="field">
        <span>Style</span>
        <ChipToggles label="Style" options={Object.entries(STYLE_LABELS)} value={d.modalities} onChange={set('modalities')} />
      </div>
      <div className="field">
        <span>Where you can do it</span>
        <ChipToggles label="Where you can do it" options={TIERS.map((t) => [t, TIER_SHORT[t]])} value={d.equipment_tiers} onChange={set('equipment_tiers')} />
      </div>
      <div className="field">
        <span>Leave it out when this is sore</span>
        <ChipToggles label="Leave it out when this is sore" options={STRESS_AREAS.map((a) => [a, AREA_LABELS[a]])} value={d.joint_stress_flags} onChange={set('joint_stress_flags')} />
      </div>
      <label className="field">
        <span>Form cues (one per line)</span>
        <textarea rows={3} value={d.cuesText} placeholder={'Brace before you press.\nKeep ribs down.'} onChange={(e) => set('cuesText')(e.target.value)} />
      </label>
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="btn-row">
        <button type="button" className="primary-btn" onClick={save}>{initial ? 'Save changes' : 'Add to library'}</button>
        <button type="button" className="secondary-btn" onClick={onCancel}>Cancel</button>
      </div>
    </section>
  );
}

/** Describe what you want; Gemini suggests exercises; you pick which to keep. */
function AiAdder({ apiKey, model, profile, room, onAdd, onCancel }) {
  const [request, setRequest] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState([]);
  const [picked, setPicked] = useState([]);

  const run = async (text = request) => {
    setRequest(text);
    setBusy(true);
    setError('');
    setDrafts([]);
    try {
      const list = await suggestExercises({ request: text, profile, apiKey, model, count: Math.min(4, room) });
      setDrafts(list);
      setPicked(list.map((e) => e.id));
    } catch (err) {
      setError(err?.message || 'Could not get suggestions. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card ex-editor" aria-label="Add exercises with AI">
      <h3>✨ Add exercises with AI</h3>
      {!apiKey ? (
        <p className="muted">This needs a Gemini API key. Add one with the key button at the top, or add an exercise by hand.</p>
      ) : (
        <>
          <p className="muted small">Say what you're after. You choose which suggestions to keep.</p>
          <form
            className="ai-ask"
            onSubmit={(e) => {
              e.preventDefault();
              if (request.trim() && !busy) run();
            }}
          >
            <input type="text" value={request} maxLength={300} placeholder="e.g. kettlebell moves for shoulders" onChange={(e) => setRequest(e.target.value)} aria-label="What exercises do you want?" />
            <button type="submit" className="primary-btn" disabled={busy || !request.trim()}>{busy ? 'Thinking…' : 'Suggest'}</button>
          </form>
          {!drafts.length && !busy && (
            <div className="chip-row chip-scroll" aria-label="Ideas">
              {AI_IDEAS.map((idea) => (
                <button key={idea} type="button" className="chip" onClick={() => run(idea)}>{idea}</button>
              ))}
            </div>
          )}
        </>
      )}
      {error && <p className="error-text" role="alert">{error}</p>}
      {drafts.length > 0 && (
        <ul className="ai-drafts">
          {drafts.map((ex) => (
            <li key={ex.id}>
              <label>
                <input type="checkbox" checked={picked.includes(ex.id)} onChange={() => setPicked((p) => toggle(p, ex.id))} />
                <span>
                  <strong>{ex.name}</strong>
                  <span className="muted small"> · {PATTERN_LABELS[ex.movement_pattern]} · {ex.equipment_label}</span>
                  <span className="muted small ai-draft-cue">{ex.primary_muscles.join(', ')} — {ex.cues[0]}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="btn-row">
        {drafts.length > 0 && (
          <button type="button" className="primary-btn" disabled={!picked.length} onClick={() => onAdd(drafts.filter((d) => picked.includes(d.id)))}>
            Add {picked.length} to library
          </button>
        )}
        <button type="button" className="secondary-btn" onClick={onCancel}>{drafts.length ? 'Cancel' : 'Close'}</button>
      </div>
    </section>
  );
}

export default function CatalogBrowser({ defaultTier, profile, onProfileChange, plan, apiKey, model }) {
  const [custom, setCustom] = useState(() => loadCustomExercises());
  const [tierFilter, setTierFilter] = useState(defaultTier || 'all');
  const [patternFilter, setPatternFilter] = useState('all');
  const [styleFilter, setStyleFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState(null);
  const [panel, setPanel] = useState(null); // null | 'add' | 'ai' | { edit: exercise }
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (defaultTier) setTierFilter(defaultTier);
  }, [defaultTier]);

  const all = useMemo(() => [...exercises], [custom]); // eslint-disable-line react-hooks/exhaustive-deps
  const patterns = useMemo(() => ['all', ...MOVEMENT_PATTERNS.filter((p) => all.some((e) => e.movement_pattern === p))], [all]);
  const skipped = profile?.preferences?.dislikes || [];
  const inPlan = useMemo(() => new Set((plan?.weeks || []).flatMap((w) => w.days || []).flatMap((d) => d.exercises || []).map((i) => i.exercise_id)), [plan]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((e) => {
      if (styleFilter === 'mine') return e.custom && (!q || `${e.name} ${e.primary_muscles.join(' ')} ${e.equipment_label}`.toLowerCase().includes(q));
      if (tierFilter !== 'all' && !e.equipment_tiers.includes(tierFilter)) return false;
      if (patternFilter !== 'all' && e.movement_pattern !== patternFilter) return false;
      if (styleFilter !== 'all' && !(e.modalities || ['gym']).includes(styleFilter)) return false;
      if (q && !`${e.name} ${e.primary_muscles.join(' ')} ${e.equipment_label}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [all, tierFilter, patternFilter, styleFilter, query]);

  const commit = (list, message) => {
    setCustom(saveCustomExercises(list));
    setPanel(null);
    setNotice(message);
  };
  const room = MAX_CUSTOM - custom.length;

  const setSkip = (id, skip) => {
    if (!onProfileChange || !profile) return;
    const prefs = profile.preferences || {};
    const dislikes = skip ? [...new Set([...(prefs.dislikes || []), id])].slice(-20) : (prefs.dislikes || []).filter((x) => x !== id);
    onProfileChange({ ...profile, preferences: { ...prefs, dislikes, likes: (prefs.likes || []).filter((x) => x !== id || !skip) } });
  };

  const remove = (ex) => {
    if (inPlan.has(ex.id)) {
      setNotice(`${ex.name} is in your current plan. Swap it out of the plan first, then delete it.`);
      return;
    }
    if (!window.confirm(`Delete ${ex.name} from your library?`)) return;
    setSkip(ex.id, false);
    commit(custom.filter((e) => e.id !== ex.id), `Deleted ${ex.name}.`);
  };

  return (
    <div className="panel-stack library-view">
      <section className="card library-head">
        <div className="card-head">
          <div>
            <h2>Exercise library</h2>
            <p className="muted small">
              {filtered.length} of {all.length} exercises{custom.length ? ` · ${custom.length} of yours` : ''}
            </p>
          </div>
        </div>
        <div className="btn-row lib-actions">
          <button type="button" className="secondary-btn" disabled={room <= 0} onClick={() => setPanel('add')}>+ Add exercise</button>
          <button type="button" className="secondary-btn" disabled={room <= 0} onClick={() => setPanel('ai')}>✨ Add with AI</button>
        </div>
        {room <= 0 && <p className="muted small">You've reached {MAX_CUSTOM} exercises of your own. Delete one to add more.</p>}

        <div className="lib-filters">
          <input type="search" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search exercises" />
          <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value)} aria-label="Equipment setup">
            <option value="all">Any setup</option>
            {Object.entries(EQUIPMENT_TIER_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>

        <div className="chip-row chip-scroll" role="group" aria-label="Filter by style">
          {[...STYLE_OPTIONS, ...(custom.length ? [['mine', '★ Mine']] : [])].map(([v, l]) => (
            <button key={v} type="button" aria-pressed={styleFilter === v} className={`chip ${styleFilter === v ? 'chip-active' : ''}`} onClick={() => setStyleFilter(v)}>
              {l}
            </button>
          ))}
        </div>
        {styleFilter !== 'mine' && (
          <div className="chip-row chip-scroll" role="group" aria-label="Filter by movement">
            {patterns.map((p) => (
              <button key={p} type="button" aria-pressed={patternFilter === p} className={`chip ${patternFilter === p ? 'chip-active' : ''}`} onClick={() => setPatternFilter(p)}>
                {p === 'all' ? 'All moves' : PATTERN_LABELS[p]}
              </button>
            ))}
          </div>
        )}
        {notice && <p className="muted small notice-line" role="status">{notice}</p>}
      </section>

      {panel === 'add' && <ExerciseEditor onSave={(ex) => commit([...custom, ex], `Added ${ex.name}. New plans can now use it.`)} onCancel={() => setPanel(null)} />}
      {panel?.edit && (
        <ExerciseEditor
          initial={panel.edit}
          onSave={(ex) => commit(custom.map((e) => (e.id === ex.id ? ex : e)), `Saved ${ex.name}.`)}
          onCancel={() => setPanel(null)}
        />
      )}
      {panel === 'ai' && (
        <AiAdder
          apiKey={apiKey}
          model={model}
          profile={profile}
          room={room}
          onAdd={(list) => commit([...custom, ...list].slice(0, MAX_CUSTOM), `Added ${list.length} exercise${list.length === 1 ? '' : 's'}. New plans can now use ${list.length === 1 ? 'it' : 'them'}.`)}
          onCancel={() => setPanel(null)}
        />
      )}

      {filtered.length === 0 && (
        <p className="muted small empty-line">{styleFilter === 'mine' ? 'No exercises of your own yet. Add one above.' : 'Nothing matches those filters.'}</p>
      )}

      {filtered.map((ex) => {
        const isOpen = openId === ex.id;
        const isSkipped = skipped.includes(ex.id);
        return (
          <article key={ex.id} className={`card ex-card ${isSkipped ? 'ex-skipped' : ''}`}>
            <div className="card-head">
              <div>
                <span className="pattern-tag">
                  {PATTERN_LABELS[ex.movement_pattern] || ex.movement_pattern}
                  {ex.custom && <span className="mine-tag">{ex.source === 'ai' ? '✨ AI' : '★ Mine'}</span>}
                  {isSkipped && <span className="skip-tag">Not in my plans</span>}
                </span>
                <h3>{ex.name}</h3>
                <p className="muted small">
                  {ex.equipment_label} · {ex.primary_muscles.join(', ')}
                </p>
              </div>
              <button type="button" className="secondary-btn small-btn" aria-expanded={isOpen} onClick={() => setOpenId(isOpen ? null : ex.id)}>
                {isOpen ? 'Hide' : ex.photo ? 'View form' : 'Details'}
              </button>
            </div>

            {isOpen && (
              <div className="ex-details">
                <ExercisePhotos exerciseId={ex.id} compact />
                <ul className="cues-list">
                  {ex.cues.map((c, idx) => (
                    <li key={idx}>{c}</li>
                  ))}
                </ul>
                {ex.joint_stress_flags.length > 0 && (
                  <p className="muted small">Left out automatically when sore: {ex.joint_stress_flags.map((f) => AREA_LABELS[f] || f).join(', ')}</p>
                )}
                <div className="btn-row">
                  {onProfileChange && (
                    <button type="button" className="secondary-btn small-btn" onClick={() => setSkip(ex.id, !isSkipped)}>
                      {isSkipped ? 'Use in my plans again' : "Don't use in my plans"}
                    </button>
                  )}
                  {ex.custom && (
                    <>
                      <button type="button" className="secondary-btn small-btn" onClick={() => setPanel({ edit: ex })}>Edit</button>
                      <button type="button" className="secondary-btn small-btn danger-text" onClick={() => remove(ex)}>Delete</button>
                    </>
                  )}
                </div>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
