import React, { useEffect, useState } from 'react';
import ExerciseAnimator from './ExerciseAnimator';
import { EXERCISE_MAP, EQUIPMENT_TIER_LABELS } from '../services/catalogFilter';
import { SAFETY_SHORT } from './HealthNotice';
import LogSets from './LogSets';

const SWAP_REASONS = [
  'Equipment is busy',
  'Joint feels tight today',
  'Want a fresh variation',
];

const ADAPT_PRESETS = [
  'Only have 25 minutes today',
  'Low sleep / feeling fatigued',
  'Feeling great — slight intensity boost',
];

export default function RoutineView({
  plan,
  onSwapExercise,
  logs = [],
  unitSystem = 'metric',
  onLogExercise = () => {},
  onUndoLog = () => {},
  onAskAbout = () => {},
  onAdaptDay,
  onSubmitFeedback,
  busyKey,
  onGoToAssessment,
}) {
  const [selectedWeekIdx, setSelectedWeekIdx] = useState(0);
  const [selectedDayIdx, setSelectedDayIdx] = useState(0);
  const [checkedWarmups, setCheckedWarmups] = useState({});
  const [swapMenuKey, setSwapMenuKey] = useState(null);
  const [customSwapText, setCustomSwapText] = useState('');
  const [swapAllWeeks, setSwapAllWeeks] = useState(true);
  const [customAdaptText, setCustomAdaptText] = useState('');
  const [feedbackSent, setFeedbackSent] = useState('');

  useEffect(() => {
    setSelectedWeekIdx(0);
    setSelectedDayIdx(0);
    setSwapMenuKey(null);
    setCustomSwapText('');
    setCustomAdaptText('');
    setFeedbackSent('');
  }, [plan?.generatedAt]);

  if (!plan || !plan.weeks?.length) {
    return (
      <div className="card empty-state">
        <h2>No Active Routine Yet</h2>
        <p className="muted">
          Complete your quick vitals & equipment assessment—or chat with your AI coach—to build your training block.
        </p>
        <button type="button" className="primary-btn" onClick={onGoToAssessment}>
          Open Assessment
        </button>
      </div>
    );
  }

  const multiWeek = plan.weeks.length > 1;
  const safeWeekIdx = Math.min(selectedWeekIdx, plan.weeks.length - 1);
  const week = plan.weeks[safeWeekIdx];
  const safeDayIdx = Math.min(selectedDayIdx, Math.max(0, (week.days?.length || 1) - 1));
  const day = week.days?.[safeDayIdx];

  if (!day) return null;

  const toggleWarmup = (idx) => {
    const key = `${week.week_number}-${day.day_id}-${idx}`;
    setCheckedWarmups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleCustomAdaptSubmit = (e) => {
    e.preventDefault();
    const trimmed = customAdaptText.trim();
    if (!trimmed) return;
    setCustomAdaptText('');
    onAdaptDay(safeWeekIdx, safeDayIdx, trimmed);
  };

  const handleCustomSwapSubmit = (e, exIdx) => {
    e.preventDefault();
    const trimmed = customSwapText.trim();
    if (!trimmed) return;
    setCustomSwapText('');
    setSwapMenuKey(null);
    onSwapExercise(safeWeekIdx, safeDayIdx, exIdx, trimmed, swapAllWeeks && multiWeek);
  };

  const adaptBusyId = `adapt-${safeWeekIdx}-${safeDayIdx}`;

  return (
    <div className="panel-stack">
      {/* Program Summary Banner */}
      <section className="card hero-card">
        <div className="card-head">
          <div>
            <span className={`source-badge ${plan.source === 'gemini' ? 'source-ai' : 'source-local'}`}>
              {plan.source === 'gemini' ? `✨ Gemini AI (${plan.modelUsed})` : '⚡ Local Demo Engine'}
            </span>
            <h2 style={{ marginTop: '6px' }}>{plan.program_title}</h2>
          </div>
          <span className="pill">{EQUIPMENT_TIER_LABELS[plan.equipmentTier]?.split(' (')[0]}</span>
        </div>
        <p className="summary-text">{plan.coach_summary}</p>
        <div className="strategy-box">
          <strong>Strategy:</strong> {plan.program_strategy || plan.comeback_strategy}
        </div>
        <p className="muted health-line" role="note">{SAFETY_SHORT}</p>
      </section>

      {/* Multi-Week Block Selector (1–4 Weeks) */}
      {plan.weeks.length > 1 && (
        <section className="card week-strip-card">
          <div className="week-tabs">
            {plan.weeks.map((wk, idx) => (
              <button
                key={wk.week_number}
                type="button"
                className={`week-tab ${idx === safeWeekIdx ? 'week-tab-active' : ''}`}
                onClick={() => {
                  setSelectedWeekIdx(idx);
                  setSwapMenuKey(null);
                }}
              >
                Week {wk.week_number}
              </button>
            ))}
          </div>
          <div className="week-meta">
            <strong>{week.week_label}</strong>
            <p className="muted">{week.phase_focus}</p>
            <small className="progression-line">📈 Progression: {week.progression_rule}</small>
          </div>
        </section>
      )}

      {/* Day Selector Tabs */}
      <div className="day-tabs">
        {week.days.map((d, idx) => (
          <button
            key={d.day_id}
            type="button"
            className={`day-tab ${idx === safeDayIdx ? 'day-tab-active' : ''}`}
            onClick={() => {
              setSelectedDayIdx(idx);
              setSwapMenuKey(null);
            }}
          >
            <span>Day {idx + 1}</span>
            <small>{d.estimated_minutes}m</small>
          </button>
        ))}
      </div>

      {/* Selected Day Header + Preset & Custom Adapt Bar */}
      <section className="card">
        <div className="card-head">
          <div>
            <h3>{day.day_label}</h3>
            <p className="muted">{day.focus}</p>
          </div>
          <span className="pill">~{day.estimated_minutes} min</span>
        </div>

        {day.adaptedBanner && (
          <div className="status-banner status-success" style={{ marginTop: '10px' }}>
            {day.adaptedBanner}
          </div>
        )}

        <div className="adapt-bar">
          <span className="adapt-label">Adapt Today (Quick Presets or Custom Request):</span>
          <div className="chip-row">
            {ADAPT_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className="chip"
                disabled={busyKey === adaptBusyId}
                onClick={() => onAdaptDay(safeWeekIdx, safeDayIdx, preset)}
              >
                {busyKey === adaptBusyId ? 'Adapting...' : preset}
              </button>
            ))}
          </div>
          <form className="inline-prompt-form" onSubmit={handleCustomAdaptSubmit}>
            <input
              type="text"
              placeholder='Custom: e.g. "Only 15 min, upper body only" or "Lower back stiff"'
              value={customAdaptText}
              onChange={(e) => setCustomAdaptText(e.target.value)}
              disabled={busyKey === adaptBusyId}
            />
            <button
              type="submit"
              className="secondary-btn"
              disabled={busyKey === adaptBusyId || !customAdaptText.trim()}
            >
              {busyKey === adaptBusyId ? '...' : 'Adapt'}
            </button>
          </form>
        </div>

        {/* 5-Min Dynamic Warm-up Checklist */}
        {day.warmup_checklist?.length > 0 && (
          <div className="warmup-box">
            <strong>5-Min Dynamic Warm-Up</strong>
            <ul className="warmup-list">
              {day.warmup_checklist.map((item, idx) => {
                const key = `${week.week_number}-${day.day_id}-${idx}`;
                const done = Boolean(checkedWarmups[key]);
                return (
                  <li key={idx}>
                    <label className={`warmup-item ${done ? 'warmup-done' : ''}`}>
                      <input
                        type="checkbox"
                        checked={done}
                        onChange={() => toggleWarmup(idx)}
                      />
                      <span>{item}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      {/* Exercise Cards with Parametric SVG Form Animations & Custom Swap */}
      {day.exercises.map((item, exIdx) => {
        const meta = EXERCISE_MAP[item.exercise_id];
        if (!meta) return null;
        const itemKey = `${safeWeekIdx}-${safeDayIdx}-${exIdx}`;
        const isSwapping = busyKey === `swap-${itemKey}`;

        return (
          <article key={`${item.exercise_id}-${exIdx}`} className="card exercise-card">
            <div className="card-head">
              <div>
                <span className="pattern-tag">{meta.movement_pattern.replace('_', ' ')}</span>
                <h3>{exIdx + 1}. {meta.name}</h3>
                <p className="muted">
                  {meta.equipment_label} · {meta.primary_muscles.join(', ')}
                </p>
              </div>
              <button
                type="button"
                className="secondary-btn"
                disabled={isSwapping}
                onClick={() => {
                  setCustomSwapText('');
                  setSwapMenuKey((prev) => (prev === itemKey ? null : itemKey));
                }}
              >
                {isSwapping ? 'Swapping...' : '⇄ Swap'}
              </button>
            </div>

            {swapMenuKey === itemKey && (
              <div className="swap-drawer">
                <span className="muted">Pick a reason or type your own constraint:</span>
                {multiWeek && (
                  <label className="swap-all-weeks" style={{ display: 'flex', gap: '8px', alignItems: 'center', margin: '8px 0 2px' }}>
                    <input
                      type="checkbox"
                      checked={swapAllWeeks}
                      onChange={(e) => setSwapAllWeeks(e.target.checked)}
                    />
                    <span>Apply to all weeks</span>
                  </label>
                )}
                <div className="chip-row" style={{ marginTop: '6px' }}>
                  {SWAP_REASONS.map((reason) => (
                    <button
                      key={reason}
                      type="button"
                      className="chip chip-active"
                      onClick={() => {
                        setSwapMenuKey(null);
                        onSwapExercise(safeWeekIdx, safeDayIdx, exIdx, reason, swapAllWeeks && multiWeek);
                      }}
                    >
                      {reason}
                    </button>
                  ))}
                </div>
                <form
                  className="inline-prompt-form"
                  style={{ marginTop: '8px' }}
                  onSubmit={(e) => handleCustomSwapSubmit(e, exIdx)}
                >
                  <input
                    type="text"
                    placeholder='e.g., "Left wrist hurts" or "Prefer cables"'
                    value={customSwapText}
                    onChange={(e) => setCustomSwapText(e.target.value)}
                  />
                  <button
                    type="submit"
                    className="primary-btn"
                    style={{ padding: '8px 12px', fontSize: '0.82rem' }}
                    disabled={!customSwapText.trim()}
                  >
                    Ask AI Swap
                  </button>
                </form>
              </div>
            )}

            {/* Structured Log-Ready Prescription Badges */}
            <div className="rx-grid">
              <div className="rx-pill">
                <span>Sets</span>
                <strong>{item.sets}</strong>
              </div>
              <div className="rx-pill">
                <span>Reps</span>
                <strong>{item.rep_min}–{item.rep_max}</strong>
              </div>
              <div className="rx-pill">
                <span>Target RPE</span>
                <strong>{item.target_rpe}</strong>
              </div>
              <div className="rx-pill">
                <span>Rest</span>
                <strong>{item.rest_seconds}s</strong>
              </div>
            </div>

            <ExerciseAnimator animationKey={meta.animation_key} />

            {item.coach_note && (
              <div className="coach-note">
                <strong>Coach Note:</strong> {item.coach_note}
              </div>
            )}

            <ul className="cues-list">
              {meta.cues.map((cue, cIdx) => (
                <li key={cIdx}>{cue}</li>
              ))}
            </ul>

            <div className="button-row" style={{ marginTop: '8px' }}>
              <button type="button" className="secondary-btn" onClick={() => onAskAbout(item.exercise_id)}>
                Form help
              </button>
            </div>

            <LogSets
              item={item}
              logs={logs}
              unitSystem={unitSystem}
              weekNumber={week.week_number}
              dayTitle={day.day_title}
              onLog={onLogExercise}
              onUndo={onUndoLog}
            />
          </article>
        );
      })}

      {/* Weekly Progression Check-In */}
      <section className="card">
        <h3>Week {week.week_number} Check-In (Steers Next Regeneration)</h3>
        <p className="muted">{plan.weekly_progression_tip}</p>
        <div className="button-row" style={{ marginTop: '12px' }}>
          {['Too Easy — Nudge Up', 'Just Right — Keep Building', 'Too Intense — Dial Back'].map(
            (rating) => (
              <button
                key={rating}
                type="button"
                className="secondary-btn"
                onClick={() => {
                  onSubmitFeedback(`Week ${week.week_number}: ${rating}`);
                  setFeedbackSent(`Logged "${rating}" for Week ${week.week_number}.`);
                }}
              >
                {rating}
              </button>
            )
          )}
        </div>
        {feedbackSent && <div className="status-banner status-success">{feedbackSent}</div>}
      </section>
    </div>
  );
}
