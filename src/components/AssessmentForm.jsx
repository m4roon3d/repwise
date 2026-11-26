import React from 'react';
import CoachIntakeChat from './CoachIntakeChat';
import StylePicker from './StylePicker';
import {
  EQUIPMENT_TIER_LABELS,
  cmToFeetInches,
  computeReadinessMetrics,
  feetInchesToCm,
  filterSafeExercises,
  kgToLbs,
  lbsToKg,
} from '../services/catalogFilter';

const GOALS = [
  { id: 'general_fitness', label: 'General Fitness & Health' },
  { id: 'rebuild_consistency', label: 'Build Habit & Consistency' },
  { id: 'strength_hypertrophy', label: 'Lean Muscle & Strength' },
  { id: 'fat_loss_conditioning', label: 'Fat Loss & Conditioning' },
  { id: 'mobility_longevity', label: 'Joint Health & Longevity' },
];

export default function AssessmentForm({
  profile,
  onChange,
  onApplyChatPatch,
  onGenerate,
  loading,
  apiKey,
  model,
  extraSections = null,
}) {
  const metrics = computeReadinessMetrics(profile);
  const safeExercises = filterSafeExercises(profile);
  const isImperial = profile.unitSystem === 'imperial';
  const { feet, inches } = cmToFeetInches(profile.heightCm);
  const weightLbs = kgToLbs(profile.weightKg);

  const updateField = (key, value) => onChange({ ...profile, [key]: value });
  
  return (
    <div className="panel-stack">
      {/* Live Readiness Preview Strip */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <span className="kpi-label">Readiness Score</span>
          <strong className="kpi-value accent-text">{metrics.readinessScore}/100</strong>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">BMI Context</span>
          <strong className="kpi-value">{metrics.bmi}</strong>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Safe Exercises Pool</span>
          <strong className="kpi-value">{safeExercises.length} moves</strong>
        </div>
      </div>

      {/* Conversational AI Intake */}
      <CoachIntakeChat
        profile={profile}
        onApplyPatch={onApplyChatPatch}
        onGenerateNow={onGenerate}
        apiKey={apiKey}
        model={model}
        loadingPlan={loading}
      />

      {/* Equipment Environment Selector */}
      <section className="card">
        <div className="card-head">
          <h2>1. Your Equipment Setup</h2>
          <span className="pill">Switch anytime</span>
        </div>
        <div className="tier-grid">
          {Object.entries(EQUIPMENT_TIER_LABELS).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`tier-btn ${profile.equipmentTier === id ? 'tier-btn-active' : ''}`}
              onClick={() => updateField('equipmentTier', id)}
            >
              <span className="tier-title">{label.split(' (')[0]}</span>
              <span className="tier-sub">
                {id === 'commercial_gym'
                  ? 'Barbells, racks, cables & machines'
                  : id === 'apartment_gym'
                  ? 'Dumbbells, bench & cable stack'
                  : 'Dumbbells, bands & bodyweight'}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Body Vitals & Recovery Metrics + Unit Toggle */}
      <section className="card">
        <div className="card-head" style={{ marginBottom: '12px' }}>
          <h2>2. Body Vitals & Recovery</h2>
          <div className="unit-toggle" role="group" aria-label="Unit System">
            <button
              type="button"
              className={!isImperial ? 'unit-active' : ''}
              onClick={() => updateField('unitSystem', 'metric')}
            >
              cm / kg
            </button>
            <button
              type="button"
              className={isImperial ? 'unit-active' : ''}
              onClick={() => updateField('unitSystem', 'imperial')}
            >
              ft / lbs
            </button>
          </div>
        </div>

        <div className="grid-2">
          <div className="form-group">
            <label htmlFor="f-age">Age</label>
            <input id="f-age"
              type="number"
              min="16"
              max="85"
              value={profile.age}
              onChange={(e) => updateField('age', Number(e.target.value))}
            />
          </div>
          <div className="form-group">
            <label htmlFor="f-resting-hr">Resting HR (bpm)</label>
            <input id="f-resting-hr"
              type="number"
              min="40"
              max="115"
              value={profile.restingHr}
              onChange={(e) => updateField('restingHr', Number(e.target.value))}
            />
          </div>

          {!isImperial ? (
            <>
              <div className="form-group">
                <label htmlFor="f-height-cm">Height (cm)</label>
                <input id="f-height-cm"
                  type="number"
                  min="130"
                  max="220"
                  value={profile.heightCm}
                  onChange={(e) => updateField('heightCm', Number(e.target.value))}
                />
              </div>
              <div className="form-group">
                <label htmlFor="f-weight-kg">Weight (kg)</label>
                <input id="f-weight-kg"
                  type="number"
                  step="0.5"
                  min="40"
                  max="180"
                  value={profile.weightKg}
                  onChange={(e) => updateField('weightKg', Number(e.target.value))}
                />
              </div>
            </>
          ) : (
            <>
              <div className="form-group">
                <label id="f-height-ftin-label">Height (ft / in)</label>
                <div className="input-row" role="group" aria-labelledby="f-height-ftin-label">
                  <input
                    type="number"
                    min="4"
                    max="7"
                    value={feet}
                    aria-label="Feet"
                    onChange={(e) =>
                      updateField('heightCm', feetInchesToCm(e.target.value, inches))
                    }
                  />
                  <input
                    type="number"
                    min="0"
                    max="11"
                    value={inches}
                    aria-label="Inches"
                    onChange={(e) =>
                      updateField('heightCm', feetInchesToCm(feet, e.target.value))
                    }
                  />
                </div>
              </div>
              <div className="form-group">
                <label htmlFor="f-weight-lbs">Weight (lbs)</label>
                <input id="f-weight-lbs"
                  type="number"
                  min="85"
                  max="400"
                  value={weightLbs}
                  onChange={(e) => updateField('weightKg', lbsToKg(e.target.value))}
                />
              </div>
            </>
          )}

          <div className="form-group">
            <label htmlFor="f-sleep-hours">Avg Sleep (hrs/night)</label>
            <input id="f-sleep-hours"
              type="number"
              step="0.5"
              min="3"
              max="12"
              value={profile.sleepHours}
              onChange={(e) => updateField('sleepHours', Number(e.target.value))}
            />
          </div>
          <div className="form-group">
            <label htmlFor="f-stress-level">Daily Stress Level</label>
            <select id="f-stress-level"
              value={profile.stressLevel}
              onChange={(e) => updateField('stressLevel', e.target.value)}
            >
              <option value="low">Low — Well recovered</option>
              <option value="moderate">Moderate — Normal work week</option>
              <option value="high">High — Keep volume gentle</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="f-experience">Training Experience</label>
            <select
              id="f-experience"
              value={profile.experience}
              onChange={(e) => updateField('experience', e.target.value)}
            >
              <option value="beginner">Beginner — New or under ~6 months</option>
              <option value="intermediate">Intermediate — 6 months to 2+ years</option>
              <option value="advanced">Advanced — Several years, confident with technique</option>
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="f-weeks-away">Weeks Since Last Trained (0 = training now)</label>
            <input id="f-weeks-away"
              type="number"
              min="0"
              max="104"
              value={profile.weeksAway}
              onChange={(e) => updateField('weeksAway', Number(e.target.value))}
            />
          </div>
          <div className="form-group">
            <label htmlFor="f-energy-level">Current Energy</label>
            <select id="f-energy-level"
              value={profile.energyLevel}
              onChange={(e) => updateField('energyLevel', e.target.value)}
            >
              <option value="low">Low — Keep it gentle</option>
              <option value="moderate">Moderate — Steady build</option>
              <option value="high">High — Ready to push</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="f-body-fat">Est. Body Fat % (Optional)</label>
            <input id="f-body-fat"
              type="text"
              placeholder="e.g., 22%"
              value={profile.bodyFatPct}
              onChange={(e) => updateField('bodyFatPct', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="f-bp-context">BP Context (Optional, non-medical)</label>
            <input id="f-bp-context"
              type="text"
              placeholder="e.g., 120/80"
              value={profile.bloodPressure}
              onChange={(e) => updateField('bloodPressure', e.target.value)}
            />
          </div>
        </div>
      </section>

      {extraSections}

      {/* Goal, Multi-Week Block Length, Schedule & Joint Safety */}
      <section className="card">
        <h2>3. Goal, Schedule & Block Length</h2>
        <StylePicker profile={profile} onChange={onChange} />
        <div className="grid-2">
          <div className="form-group">
            <label htmlFor="f-goal">Primary Goal</label>
            <select id="f-goal"
              value={profile.goal}
              onChange={(e) => updateField('goal', e.target.value)}
            >
              {GOALS.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label id="f-days-label">Training Days / Week</label>
            <div className="segmented" role="group" aria-labelledby="f-days-label">
              {[2, 3, 4, 5].map((d) => (
                <button
                  key={d}
                  type="button"
                  className={profile.daysPerWeek === d ? 'seg-active' : ''}
                  onClick={() => updateField('daysPerWeek', d)}
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid-2">
          <div className="form-group">
            <label id="f-weeks-label">Progressive Block Length</label>
            <div className="segmented" role="group" aria-labelledby="f-weeks-label">
              {[1, 2, 3, 4].map((w) => (
                <button
                  key={w}
                  type="button"
                  className={profile.programWeeks === w ? 'seg-active' : ''}
                  onClick={() => updateField('programWeeks', w)}
                >
                  {w}w
                </button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="f-session-minutes">Target Session Length: {profile.sessionMinutes} min</label>
            <input id="f-session-minutes"
              type="range"
              min="25"
              max="60"
              step="5"
              value={profile.sessionMinutes}
              onChange={(e) => updateField('sessionMinutes', Number(e.target.value))}
            />
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="f-notes">Personal Coach Notes (preferences, specific aches, dislikes)</label>
          <textarea id="f-notes"
            rows="2"
            placeholder="e.g., Prefer morning sessions, left wrist sensitive, want extra posture work..."
            value={profile.notes}
            onChange={(e) => updateField('notes', e.target.value)}
          />
        </div>

        <p className="muted" style={{ marginBottom: '14px' }}>
          Suggested Starting Intensity: <strong>{metrics.recommendedRpe}</strong>
        </p>

        <button
          type="button"
          className="primary-btn full-width"
          onClick={onGenerate}
          disabled={loading}
        >
          {loading
            ? `Building Your ${profile.programWeeks}-Week Block...`
            : apiKey
            ? `✨ Generate ${profile.programWeeks}-Week Block with Gemini AI`
            : `⚡ Generate ${profile.programWeeks}-Week Block (Local Engine)`}
        </button>
      </section>
    </div>
  );
}
