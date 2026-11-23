import { describe, expect, it } from 'vitest';
import exercises from '../data/exercises.json';
import { ANIMATION_LIBRARY } from '../data/animations';
import {
  cmToFeetInches,
  computeReadinessMetrics,
  feetInchesToCm,
  filterSafeExercises,
  kgToLbs,
  lbsToKg,
} from '../services/catalogFilter';
import { DEFAULT_PROFILE } from '../services/storage';

describe('Exercise Catalog Integrity & Joint Pre-Filter', () => {
  it('has 68 unique exercises with valid animation keys and regression links', () => {
    const ids = new Set(exercises.map((e) => e.id));
    expect(exercises.length).toBe(68);
    expect(ids.size).toBe(68);

    for (const ex of exercises) {
      expect(ANIMATION_LIBRARY[ex.animation_key]).toBeDefined();
      expect(ex.regression_id === null || ids.has(ex.regression_id)).toBe(true);
      expect(ex.cues.length).toBeGreaterThanOrEqual(3);
      expect(ex.equipment_tiers.length).toBeGreaterThan(0);
    }
  });

  it('strictly filters out contraindicated moves for knee, shoulder, and lower_back flags', () => {
    for (const joint of ['knee', 'shoulder', 'lower_back']) {
      for (const tier of ['commercial_gym', 'apartment_gym', 'home_setup']) {
        const safe = filterSafeExercises({
          ...DEFAULT_PROFILE,
          equipmentTier: tier,
          jointFlags: { knee: false, shoulder: false, lower_back: false, [joint]: true },
        });
        expect(safe.length).toBeGreaterThanOrEqual(6);
        for (const ex of safe) {
          expect(ex.joint_stress_flags).not.toContain(joint);
          expect(ex.equipment_tiers).toContain(tier);
        }
      }
    }
  });

  it('computes lower readiness when sleep is poor or stress is high', () => {
    const rested = computeReadinessMetrics({
      ...DEFAULT_PROFILE,
      sleepHours: 8,
      stressLevel: 'low',
      energyLevel: 'high',
    });
    const fatigued = computeReadinessMetrics({
      ...DEFAULT_PROFILE,
      sleepHours: 5,
      stressLevel: 'high',
      energyLevel: 'low',
    });
    expect(rested.readinessScore).toBeGreaterThan(fatigued.readinessScore);
    expect(fatigued.recommendedRpe).toContain('RPE 6–7');
  });

  it('converts metric and imperial units consistently', () => {
    const { feet, inches } = cmToFeetInches(178);
    expect(feet).toBe(5);
    expect(inches).toBe(10);
    expect(feetInchesToCm(5, 10)).toBe(178);

    const lbs = kgToLbs(80);
    expect(lbs).toBe(176);
    expect(Math.round(lbsToKg(lbs))).toBe(80);
  });
});
