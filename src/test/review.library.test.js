/** The expanded exercise library: structure, coverage per equipment tier / joint, and animation sanity. */
import { describe, expect, it } from 'vitest';
import exercises from '../data/exercises.json';
import { filterSafeExercises } from '../services/catalogFilter';
import { DEFAULT_PROFILE } from '../services/storage';

const TIERS = ['commercial_gym', 'apartment_gym', 'home_setup'];
const PATTERNS = ['squat', 'hinge', 'horizontal_push', 'vertical_push', 'horizontal_pull', 'vertical_pull', 'lunge', 'core', 'carry', 'mobility', 'arms', 'calves', 'yoga', 'cardio'];
const JOINTS = ['knee', 'shoulder', 'lower_back'];

describe('exercise records', () => {
  it('every record is well-formed', () => {
    for (const e of exercises) {
      expect(e.id).toMatch(/^[a-z0-9_]+$/);
      expect(e.name.length).toBeGreaterThan(3);
      expect(PATTERNS).toContain(e.movement_pattern);
      expect(e.primary_muscles.length).toBeGreaterThan(0);
      expect(e.equipment_tiers.every((t) => TIERS.includes(t))).toBe(true);
      expect(e.joint_stress_flags.every((j) => JOINTS.includes(j))).toBe(true);
      expect(e.cues).toHaveLength(3);
      expect(e.cues.every((c) => c.length > 15 && c.length < 140 && /[.!]$/.test(c))).toBe(true);
      expect(e.equipment_label.length).toBeGreaterThan(2);
    }
  });

  it('names are unique and a regression never points at itself or forms a loop', () => {
    expect(new Set(exercises.map((e) => e.name)).size).toBe(exercises.length);
    const byId = Object.fromEntries(exercises.map((e) => [e.id, e]));
    for (const e of exercises) {
      const seen = new Set([e.id]);
      for (let r = e.regression_id; r; r = byId[r]?.regression_id) {
        expect(byId[r]).toBeDefined();
        expect(seen.has(r)).toBe(false);
        seen.add(r);
      }
    }
  });

  it('each movement pattern has enough choices in every tier to rotate and swap', () => {
    for (const tier of TIERS) {
      for (const p of PATTERNS) {
        const n = exercises.filter((e) => e.movement_pattern === p && e.equipment_tiers.includes(tier)).length;
        const need = p === 'calves' || p === 'arms' ? 2 : 3;
        expect(n, `${tier} / ${p}`).toBeGreaterThanOrEqual(need);
      }
    }
  });

  it('the library grew: at least 60 exercises, and every tier has 40+', () => {
    expect(exercises.length).toBeGreaterThanOrEqual(60);
    for (const t of TIERS) expect(exercises.filter((e) => e.equipment_tiers.includes(t)).length).toBeGreaterThanOrEqual(40);
  });

  it('joint filtering still leaves a healthy pool for every joint x tier, including the new categories', () => {
    for (const joint of JOINTS) {
      for (const tier of TIERS) {
        const safe = filterSafeExercises({ ...DEFAULT_PROFILE, equipmentTier: tier, jointFlags: { knee: false, shoulder: false, lower_back: false, [joint]: true } });
        expect(safe.length).toBeGreaterThanOrEqual(25);
        expect(safe.some((e) => e.movement_pattern === 'arms')).toBe(true);
      }
    }
  });
});
