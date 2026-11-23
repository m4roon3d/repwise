/** The expanded exercise library: structure, coverage per equipment tier / joint, and animation sanity. */
import { describe, expect, it } from 'vitest';
import exercises from '../data/exercises.json';
import { ANIMATION_LIBRARY } from '../data/animations';
import { filterSafeExercises } from '../services/catalogFilter';
import { DEFAULT_PROFILE } from '../services/storage';

const TIERS = ['commercial_gym', 'apartment_gym', 'home_setup'];
const PATTERNS = ['squat', 'hinge', 'horizontal_push', 'vertical_push', 'horizontal_pull', 'vertical_pull', 'lunge', 'core', 'carry', 'mobility', 'arms', 'calves'];
const JOINTS = ['knee', 'shoulder', 'lower_back'];
const KEYS = ['head', 'neck', 'lShoulder', 'rShoulder', 'lElbow', 'rElbow', 'lHand', 'rHand', 'lHip', 'rHip', 'lKnee', 'rKnee', 'lAnkle', 'rAnkle', 'lFoot', 'rFoot'];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

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
        const need = p === 'calves' ? 2 : p === 'arms' ? 2 : 3;
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

describe('animations', () => {
  it('every animation has three complete, finite poses and matching phase labels', () => {
    for (const [key, a] of Object.entries(ANIMATION_LIBRARY)) {
      expect(a.poses, key).toHaveLength(3);
      expect(a.phaseLabels, key).toHaveLength(3);
      for (const pose of a.poses) for (const k of KEYS) {
        expect(pose[k], `${key}.${k}`).toHaveLength(3);
        expect(pose[k].every(Number.isFinite)).toBe(true);
      }
    }
  });

  it('the new animations keep limb lengths believable in every pose (no stretching bones)', () => {
    const NEW = ['curl', 'pushdown', 'calf_raise', 'plank', 'pushup', 'pullup'];
    const bones = [['lShoulder', 'lElbow', 0.18, 0.36], ['lElbow', 'lHand', 0.22, 0.36], ['lHip', 'lKnee', 0.38, 0.50], ['lKnee', 'lAnkle', 0.36, 0.50]];
    for (const key of NEW) {
      for (const [i, pose] of ANIMATION_LIBRARY[key].poses.entries()) {
        for (const [a, b, lo, hi] of bones) {
          const d = dist(pose[a], pose[b]);
          expect(d, `${key} pose ${i} ${a}-${b}`).toBeGreaterThanOrEqual(lo);
          expect(d, `${key} pose ${i} ${a}-${b}`).toBeLessThanOrEqual(hi);
        }
        // left and right sides are mirror images
        for (const [l, r] of [['lShoulder', 'rShoulder'], ['lHand', 'rHand'], ['lKnee', 'rKnee']]) {
          expect(pose[r][0]).toBeCloseTo(-pose[l][0], 5);
        }
        // nobody goes through the floor
        for (const k of KEYS) expect(pose[k][1], `${key} ${k}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('the new animations actually move (first and middle pose differ)', () => {
    for (const key of ['curl', 'pushdown', 'calf_raise', 'plank', 'pushup', 'pullup']) {
      const [a, b] = ANIMATION_LIBRARY[key].poses;
      const moved = KEYS.some((k) => dist(a[k], b[k]) > 0.02);
      expect(moved, key).toBe(true);
    }
  });

  it('equipment props the animator knows about cover every animation', () => {
    const known = new Set(['mat', 'bench_press', 'seated_bench_db', 'leg_curl_machine', 'cable_row', 'lat_pulldown', 'pallof_cable', 'goblet', 'dumbbells_pair', 'pullup_bar', 'pushdown_cable', 'none']);
    for (const [key, a] of Object.entries(ANIMATION_LIBRARY)) expect(known.has(a.equipment), `${key}: ${a.equipment}`).toBe(true);
  });
});
