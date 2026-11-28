import React, { useState } from 'react';
import NumberInput from './NumberInput';
import { AboutYou, FitnessTest, HealthCheck, InjuryGrid, LabReport, ClearanceBanner } from './HealthSections';
import { EQUIPMENT_TIER_LABELS, cmToFeetInches, feetInchesToCm, kgToLbs, lbsToKg } from '../services/catalogFilter';
import { parqComplete } from '../services/health';
import StylePicker from './StylePicker';
import DietFields from './DietFields';

const GOALS = [
  ['general_fitness', 'General fitness & health'],
  ['strength_hypertrophy', 'Build muscle & strength'],
  ['fat_loss_conditioning', 'Lose fat & get fitter'],
  ['rebuild_consistency', 'Build a habit'],
  ['mobility_longevity', 'Move better, joint health'],
];
const STEPS = ['You', 'Training', 'Health', 'Injuries', 'Food', 'Extras', 'Ready'];

/**
 * Guided first-run setup. Required: who you are, how you'll train, the health check and injuries.
 * Optional: fitness test, blood report and preferences. Everything stays editable on the Coach tab.
 */
export default function Onboarding({ profile, onChange, apiKey, onExtract, onFinish, onSkip, loading }) {
  const [step, setStep] = useState(0);
  const [extra, setExtra] = useState('test');
  const set = (k, v) => onChange({ ...profile, [k]: v });
  const imperial = profile.unitSystem === 'imperial';
  const { feet, inches } = cmToFeetInches(profile.heightCm);
  const canNext = step === 2 ? parqComplete(profile.health) : step === 0 ? Boolean(profile.name?.trim()) : true;

  const body = [
    // 0. You
    <div key="you" className="ob-body">
      <h2>Hi! Let's set up your coach</h2>
      <p className="muted">About 3 minutes. Your answers stay on this device.</p>
      <div className="form-group">
        <label htmlFor="ob-name">What should we call you?</label>
        <input id="ob-name" type="text" maxLength={30} value={profile.name || ''} onChange={(e) => set('name', e.target.value)} autoFocus />
      </div>
      <div className="grid-2">
        <div className="form-group">
          <label htmlFor="ob-age">Age</label>
          <NumberInput id="ob-age" min="16" max="85" value={profile.age} onValue={(v) => set('age', v)} />
        </div>
        <div className="form-group">
          <label htmlFor="ob-sex">Sex (for health ranges)</label>
          <select id="ob-sex" value={profile.sex || ''} onChange={(e) => set('sex', e.target.value)}>
            <option value="">Prefer not to say</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>
      <div className="form-group">
        <label id="ob-units">Units</label>
        <div className="segmented" role="group" aria-labelledby="ob-units">
          {[
            ['metric', 'kg / cm'],
            ['imperial', 'lb / ft'],
          ].map(([v, l]) => (
            <button key={v} type="button" aria-pressed={profile.unitSystem === v} className={profile.unitSystem === v ? 'seg-active' : ''} onClick={() => set('unitSystem', v)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {imperial ? (
        <div className="grid-2">
          <div className="form-group">
            <label htmlFor="ob-ft">Height</label>
            <div style={{ display: 'flex', gap: '6px' }}>
              <NumberInput id="ob-ft" aria-label="Height feet" value={feet} onValue={(v) => set('heightCm', feetInchesToCm(v, inches))} />
              <NumberInput aria-label="Height inches" value={inches} onValue={(v) => set('heightCm', feetInchesToCm(feet, v))} />
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="ob-lb">Weight (lb)</label>
            <NumberInput id="ob-lb" value={kgToLbs(profile.weightKg)} onValue={(v) => set('weightKg', lbsToKg(v))} />
          </div>
        </div>
      ) : (
        <div className="grid-2">
          <div className="form-group">
            <label htmlFor="ob-cm">Height (cm)</label>
            <NumberInput id="ob-cm" value={profile.heightCm} onValue={(v) => set('heightCm', v)} />
          </div>
          <div className="form-group">
            <label htmlFor="ob-kg">Weight (kg)</label>
            <NumberInput id="ob-kg" value={profile.weightKg} onValue={(v) => set('weightKg', v)} />
          </div>
        </div>
      )}
    </div>,

    // 1. Training
    <div key="training" className="ob-body">
      <h2>How will you train?</h2>
      <div className="form-group">
        <label htmlFor="ob-goal">Main goal</label>
        <select id="ob-goal" value={profile.goal} onChange={(e) => set('goal', e.target.value)}>
          {GOALS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>
      <StylePicker profile={profile} onChange={onChange} />
      <div className="form-group">
        <label htmlFor="ob-equip">Where do you train?</label>
        <select id="ob-equip" value={profile.equipmentTier} onChange={(e) => set('equipmentTier', e.target.value)}>
          {Object.entries(EQUIPMENT_TIER_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label id="ob-days">Days per week</label>
        <div className="segmented" role="group" aria-labelledby="ob-days">
          {[2, 3, 4, 5].map((d) => (
            <button key={d} type="button" aria-pressed={profile.daysPerWeek === d} className={profile.daysPerWeek === d ? 'seg-active' : ''} onClick={() => set('daysPerWeek', d)}>
              {d}
            </button>
          ))}
        </div>
      </div>
      <div className="form-group">
        <label htmlFor="ob-min">Session length: {profile.sessionMinutes} min</label>
        <input id="ob-min" type="range" min="25" max="60" step="5" value={profile.sessionMinutes} onChange={(e) => set('sessionMinutes', Number(e.target.value))} />
      </div>
      <div className="grid-2">
        <div className="form-group">
          <label htmlFor="ob-exp">Lifting experience</label>
          <select id="ob-exp" value={profile.experience} onChange={(e) => set('experience', e.target.value)}>
            <option value="beginner">New or under 6 months</option>
            <option value="intermediate">6 months to 2 years</option>
            <option value="advanced">2+ years, consistent</option>
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="ob-away">Weeks since you last trained</label>
          <NumberInput id="ob-away" min="0" max="104" value={profile.weeksAway} onValue={(v) => set('weeksAway', v)} />
        </div>
      </div>
      <div className="grid-2">
        <div className="form-group">
          <label htmlFor="ob-sleep">Average sleep (hours)</label>
          <NumberInput id="ob-sleep" step="0.5" min="3" max="12" value={profile.sleepHours} onValue={(v) => set('sleepHours', v)} />
        </div>
        <div className="form-group">
          <label htmlFor="ob-energy">Energy lately</label>
          <select id="ob-energy" value={profile.energyLevel} onChange={(e) => set('energyLevel', e.target.value)}>
            <option value="low">Low</option>
            <option value="moderate">Okay</option>
            <option value="high">Good</option>
          </select>
        </div>
      </div>
    </div>,

    // 2. Health
    <div key="health" className="ob-body">
      <h2>Quick health check</h2>
      <HealthCheck profile={profile} onChange={onChange} />
    </div>,

    // 3. Injuries
    <div key="injuries" className="ob-body">
      <h2>Any aches or old injuries?</h2>
      <InjuryGrid profile={profile} onChange={onChange} />
    </div>,

    // 4. Food
    <div key="food" className="ob-body">
      <h2>How do you eat?</h2>
      <p className="muted">Your nutrition targets and weekly meal plan use this, along with your training and any blood report. All optional; change it any time.</p>
      <DietFields profile={profile} onChange={onChange} idPrefix="ob-diet" />
    </div>,

    // 5. Extras
    <div key="extras" className="ob-body">
      <h2>Make it smarter (optional)</h2>
      <p className="muted">Each of these sharpens the plan. Skip any, and come back later from the Coach tab.</p>
      <div className="segmented" role="tablist" aria-label="Optional extras">
        {[
          ['test', '🧪 Fitness test'],
          ['labs', '🩸 Blood report'],
          ['about', '🙋 About you'],
        ].map(([v, l]) => (
          <button key={v} type="button" role="tab" aria-selected={extra === v} className={extra === v ? 'seg-active' : ''} onClick={() => setExtra(v)}>
            {l}
          </button>
        ))}
      </div>
      <div style={{ marginTop: '12px' }}>
        {extra === 'test' && <FitnessTest profile={profile} onChange={onChange} />}
        {extra === 'labs' && <LabReport profile={profile} onChange={onChange} apiKey={apiKey} onExtract={onExtract} />}
        {extra === 'about' && <AboutYou profile={profile} onChange={onChange} />}
      </div>
    </div>,

    // 6. Ready
    <div key="ready" className="ob-body">
      <h2>You're all set, {profile.name || 'friend'}</h2>
      <ClearanceBanner profile={profile} />
      <ul className="ob-summary">
        <li>🎯 {GOALS.find(([v]) => v === profile.goal)?.[1]}</li>
        <li>📅 {profile.daysPerWeek} days a week, {profile.sessionMinutes} min · {(profile.styles || ['gym']).join(', ')}</li>
        <li>🏋️ {EQUIPMENT_TIER_LABELS[profile.equipmentTier]}</li>
        <li>{(profile.baselines || []).length ? '🧪 Fitness test done' : '🧪 No fitness test yet (you can do it later)'}</li>
        <li>{profile.labs ? '🩸 Blood report added' : '🩸 No blood report (optional)'}</li>
      </ul>
      <p className="muted">
        {apiKey ? 'Gemini will build your plan from all of this.' : 'Your plan will be built on this device. Add a Gemini key in Settings any time for the AI coach.'} You'll see exactly why each choice was made.
      </p>
    </div>,
  ];

  return (
    <section className="card onboarding" aria-label="Guided setup">
      <div className="ob-progress" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
        {STEPS.map((s, i) => (
          <span key={s} className={`ob-dot ${i <= step ? 'ob-dot-done' : ''}`}>
            <i style={{ display: 'block' }} />
            <small>{s}</small>
          </span>
        ))}
      </div>
      {body[step]}
      <div className="button-row ob-nav">
        {step > 0 && (
          <button type="button" className="secondary-btn" onClick={() => setStep(step - 1)} disabled={loading}>
            Back
          </button>
        )}
        {step < STEPS.length - 1 ? (
          <button type="button" className="primary-btn" disabled={!canNext} onClick={() => setStep(step + 1)}>
            {step === 5 ? 'Continue' : 'Next'}
          </button>
        ) : (
          <button type="button" className="primary-btn" disabled={loading} onClick={onFinish}>
            {loading ? 'Building your plan…' : 'Build my plan'}
          </button>
        )}
      </div>
      {step === 0 && !profile.name?.trim() && <p className="muted" style={{ fontSize: '0.8rem' }}>Add a name to continue.</p>}
      {step === 2 && !canNext && <p className="muted" style={{ fontSize: '0.8rem' }}>Answer all seven questions to continue.</p>}
      <button type="button" className="link-btn" onClick={onSkip} style={{ marginTop: '6px' }}>
        Skip setup and use the full form
      </button>
    </section>
  );
}
