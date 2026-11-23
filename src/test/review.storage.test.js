/**
 * Storage hardening tests. `it.fails` = confirmed bug (see header of review.services.test.js).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PROFILE,
  appendFeedback,
  exportBackupJson,
  importBackupJson,
  loadApiKey,
  loadFeedbackHistory,
  loadModel,
  loadPlan,
  loadProfile,
  saveApiKey,
  savePlan,
  saveProfile,
} from '../services/storage';

afterEach(() => vi.restoreAllMocks());

const GOOD_PLAN = {
  program_title: 'Keep me',
  weeks: [{ week_number: 1, days: [{ day_id: 'd1', exercises: [] }] }],
};

describe('storage — happy paths', () => {
  it('round-trips key / model / profile / plan', () => {
    saveApiKey('  abc  ');
    expect(loadApiKey()).toBe('abc');
    saveApiKey('   ');
    expect(loadApiKey()).toBe('');
    expect(loadModel()).toBe('gemini-3.8-flash');

    saveProfile({ ...DEFAULT_PROFILE, age: 51 });
    expect(loadProfile().age).toBe(51);
    savePlan(GOOD_PLAN);
    expect(loadPlan().program_title).toBe('Keep me');
  });

  it('fills in newly-added profile fields for profiles saved by an older version', () => {
    localStorage.setItem('mf_profile_v1', JSON.stringify({ age: 60, jointFlags: { knee: true } }));
    const p = loadProfile();
    expect(p.age).toBe(60);
    expect(p.unitSystem).toBe('metric');
    expect(p.jointFlags).toEqual({ knee: true, shoulder: false, lower_back: false });
  });

  it('survives corrupt JSON in every slot', () => {
    for (const k of ['mf_profile_v1', 'mf_active_plan_v1', 'mf_weekly_feedback_v1']) localStorage.setItem(k, '{oops');
    expect(loadProfile()).toEqual(DEFAULT_PROFILE);
    expect(loadPlan()).toBeNull();
    expect(loadFeedbackHistory()).toEqual([]);
  });

  it('caps feedback history at 20, newest first', () => {
    for (let i = 0; i < 25; i++) appendFeedback({ rating: `r${i}` });
    const list = loadFeedbackHistory();
    expect(list).toHaveLength(20);
    expect(list[0].rating).toBe('r24');
  });

  it('backup never contains the key or model and is stable JSON', () => {
    saveApiKey('AIza-secret');
    const json = exportBackupJson();
    expect(json).not.toContain('AIza-secret');
    expect(() => JSON.parse(json)).not.toThrow();
  });
});

describe('import / restore', () => {
  it('rejects invalid JSON without touching existing data', () => {
    saveProfile({ ...DEFAULT_PROFILE, age: 55 });
    expect(() => importBackupJson('{not json')).toThrow();
    expect(loadProfile().age).toBe(55);
  });

  it('accepts a backup with only some sections', () => {
    savePlan(GOOD_PLAN);
    importBackupJson(JSON.stringify({ feedbackHistory: [{ rating: 'x' }] }));
    expect(loadPlan().program_title).toBe('Keep me');
    expect(loadFeedbackHistory()).toHaveLength(1);
  });

  // FIXED: a backup whose activePlan can't be normalised makes savePlan(null) write the string "null",
  // wiping the user's current plan without any error.
  it('does not wipe the current plan when the backup contains an unusable activePlan', () => {
    savePlan(GOOD_PLAN);
    importBackupJson(JSON.stringify({ activePlan: { program_title: 'broken', weeks: [], days: [] } }));
    expect(loadPlan()?.program_title).toBe('Keep me');
  });

  // FIXED: restored profile fields are not type-checked, so a hand-edited / corrupt backup can put
  // strings or nulls into numeric fields and NaN flows into BMI / readiness maths and prompts.
  it('sanitises wrongly-typed numeric fields from a backup', () => {
    importBackupJson(JSON.stringify({ profile: { age: 'abc', heightCm: null, weightKg: '??', daysPerWeek: 'many' } }));
    const p = loadProfile();
    for (const k of ['age', 'heightCm', 'weightKg', 'daysPerWeek']) {
      expect(typeof p[k], k).toBe('number');
      expect(Number.isFinite(p[k]), k).toBe(true);
    }
  });

  it('migrates a v1 (days[]) plan found inside a backup', () => {
    const r = importBackupJson(JSON.stringify({ activePlan: { program_title: 'old', days: [{ day_id: 'd', exercises: [] }] } }));
    expect(r.activePlan.weeks).toHaveLength(1);
  });
});

describe('storage when the browser blocks / limits localStorage', () => {
  // BUG: loaders other than loadProfile/loadPlan/loadFeedback call localStorage.getItem unguarded.
  // App.jsx calls loadApiKey()/loadModel() inside useState initialisers -> a SecurityError there
  // (Safari "block all cookies", some embedded webviews) white-screens the entire app.
  it('loadApiKey / loadModel do not throw when storage access is denied', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(() => loadApiKey()).not.toThrow();
    expect(() => loadModel()).not.toThrow();
  });

  // BUG: setItem is unguarded everywhere; QuotaExceededError (or Safari private mode) throws out of
  // event handlers, so e.g. changing any form field can throw.
  it('saveProfile does not throw on QuotaExceededError', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(() => saveProfile(DEFAULT_PROFILE)).not.toThrow();
  });
});

import { normalizePlan, sanitizeProfile } from '../services/storage';

describe('sanitizeProfile', () => {
  it('returns defaults for null / arrays / junk', () => {
    expect(sanitizeProfile(null)).toEqual(DEFAULT_PROFILE);
    expect(sanitizeProfile([1, 2])).toEqual(DEFAULT_PROFILE);
    expect(sanitizeProfile('x')).toEqual(DEFAULT_PROFILE);
  });

  it('clamps numbers, rejects bad enums, keeps valid values and never mutates DEFAULT_PROFILE', () => {
    const p = sanitizeProfile({
      age: 500, heightCm: '180', weightKg: true, restingHr: NaN, weeksAway: 0, daysPerWeek: 99,
      stressLevel: 'extreme', equipmentTier: 'home_setup', unitSystem: 'imperial',
      notes: 42, jointFlags: { knee: true, shoulder: 'yes', hip: true },
    });
    expect(p).toMatchObject({ age: 85, heightCm: 180, weightKg: DEFAULT_PROFILE.weightKg, restingHr: DEFAULT_PROFILE.restingHr, weeksAway: 0, daysPerWeek: 5, stressLevel: 'moderate', equipmentTier: 'home_setup', unitSystem: 'imperial', notes: '' });
    expect(p.jointFlags).toEqual({ knee: true, shoulder: false, lower_back: false });
    expect(DEFAULT_PROFILE.jointFlags.knee).toBe(false);
  });

  it('a corrupt stored profile is repaired on load', () => {
    localStorage.setItem('mf_profile_v1', JSON.stringify({ age: 'old', sleepHours: null, jointFlags: null }));
    const p = loadProfile();
    expect(p.age).toBe(DEFAULT_PROFILE.age);
    expect(p.jointFlags).toEqual(DEFAULT_PROFILE.jointFlags);
  });
});

describe('normalizePlan / import — structural validation', () => {
  it('rejects plans the UI could not render', () => {
    expect(normalizePlan({ weeks: [{ days: 'x' }] })).toBeNull();
    expect(normalizePlan({ weeks: [{ days: [{ day_id: 'd' }] }] })).toBeNull();
    expect(normalizePlan('plan')).toBeNull();
    expect(normalizePlan({ days: [{ exercises: 'no' }] })).toBeNull();
  });

  it('a corrupt stored plan loads as null instead of crashing RoutineView', () => {
    localStorage.setItem('mf_active_plan_v1', JSON.stringify({ weeks: [{ days: [{}] }] }));
    expect(loadPlan()).toBeNull();
  });

  it('import reports skipped sections and rejects non-object files', () => {
    savePlan(GOOD_PLAN);
    const r = importBackupJson(JSON.stringify({ activePlan: { weeks: [{ days: [{}] }] }, profile: 'nope' }));
    expect(r.skipped).toEqual(['profile', 'activePlan']);
    expect(r.activePlan.program_title).toBe('Keep me');
    expect(() => importBackupJson('[]')).toThrow(/not a Repwise/);
    expect(() => importBackupJson('null')).toThrow();
  });

  it('a valid backup round-trips through export -> import unchanged', () => {
    saveProfile({ ...DEFAULT_PROFILE, age: 52, equipmentTier: 'home_setup' });
    savePlan(GOOD_PLAN);
    const json = exportBackupJson();
    localStorage.clear();
    const r = importBackupJson(json);
    expect(r.skipped).toEqual([]);
    expect(r.profile.age).toBe(52);
    expect(r.activePlan.program_title).toBe('Keep me');
  });
});
