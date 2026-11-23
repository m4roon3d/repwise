/** Workout-log storage + the deterministic progression engine. */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROFILE, exportBackupJson, importBackupJson, loadWorkoutLogs, saveWorkoutLogs, sanitizeLogs,
  loadCoachChat, saveCoachChat, sanitizeChat, savePlan,
} from '../services/storage';
import { fromDisplayWeight, lastSession, logStats, suggestNext, summarizeLogsForPrompt, toDisplayWeight } from '../services/progress';

const entry = (over = {}) => ({ id: 'a', ts: Date.now(), exercise_id: 'goblet_squat', rpe: null, sets: [{ reps: 10, weightKg: 20 }, { reps: 10, weightKg: 20 }, { reps: 10, weightKg: 20 }], ...over });
const item = (over = {}) => ({ exercise_id: 'goblet_squat', sets: 3, rep_min: 8, rep_max: 10, target_rpe: 7, ...over });

describe('log storage', () => {
  it('round-trips, sorts newest first and drops garbage', () => {
    saveWorkoutLogs([entry({ id: 'old', ts: 1000 }), entry({ id: 'new', ts: 5000 }), { nope: true }, entry({ id: 'empty', ts: 9, sets: [{ reps: 0, weightKg: 5 }] })]);
    expect(loadWorkoutLogs().map((l) => l.id)).toEqual(['new', 'old']);
  });
  it('clamps absurd numbers and survives corrupt storage', () => {
    const [l] = sanitizeLogs([entry({ sets: [{ reps: 99999, weightKg: -5 }], rpe: 42 })]);
    expect(l.sets[0]).toEqual({ reps: 200, weightKg: 0 });
    expect(l.rpe).toBeNull();
    localStorage.setItem('mf_workout_logs_v1', '{not json');
    expect(loadWorkoutLogs()).toEqual([]);
  });
  it('caps stored history', () => {
    const many = Array.from({ length: 900 }, (_, i) => entry({ id: `x${i}`, ts: 1000 + i }));
    expect(sanitizeLogs(many)).toHaveLength(800);
  });
  it('is included in backups and restored through the sanitiser', () => {
    saveWorkoutLogs([entry({ id: 'keep', ts: 4242 })]);
    const json = exportBackupJson();
    localStorage.clear();
    const restored = importBackupJson(json);
    expect(restored.workoutLogs.map((l) => l.id)).toEqual(['keep']);
    const hostile = JSON.stringify({ workoutLogs: [{ exercise_id: 'x', ts: 'abc', sets: [] }, entry({ id: 'ok', ts: 7 })] });
    expect(importBackupJson(hostile).workoutLogs.map((l) => l.id)).toEqual(['ok']);
  });
  it('chat history is capped, typed and photo-free', () => {
    const msgs = Array.from({ length: 50 }, (_, i) => ({ role: i % 2 ? 'coach' : 'user', text: `m${i}`, photos: 1, data: 'BIGBASE64' }));
    saveCoachChat([...msgs, { role: 'system', text: 'x' }, { role: 'user', text: '   ' }]);
    const back = loadCoachChat();
    expect(back).toHaveLength(30);
    expect(back[29].text).toBe('m49');
    expect(JSON.stringify(back)).not.toContain('BIGBASE64');
    expect(sanitizeChat('nope')).toEqual([]);
  });
});

describe('unit handling', () => {
  it('stores kg, shows lb rounded to 0.5, and round-trips common plates', () => {
    expect(toDisplayWeight(20, 'metric')).toBe(20);
    expect(toDisplayWeight(fromDisplayWeight(45, 'imperial'), 'imperial')).toBe(45);
    expect(toDisplayWeight(fromDisplayWeight(135, 'imperial'), 'imperial')).toBe(135);
  });
});

describe('suggestNext (double progression)', () => {
  it('first time: no history, no number invented', () => {
    const t = suggestNext(null, item());
    expect(t.action).toBe('start');
    expect(t.weightKg).toBeNull();
  });
  it('all sets at the top of the range -> add weight (2.5 kg lower body, 2 kg upper)', () => {
    expect(suggestNext(entry(), item())).toMatchObject({ action: 'increase', weightKg: 22.5 });
    const press = suggestNext(entry({ exercise_id: 'db_incline_press' }), item({ exercise_id: 'db_incline_press' }));
    expect(press).toMatchObject({ action: 'increase', weightKg: 22 });
  });
  it('imperial steps are 5 lb and the message is in lb', () => {
    const t = suggestNext(entry({ sets: [10, 10, 10].map((reps) => ({ reps, weightKg: fromDisplayWeight(40, 'imperial') })) }), item(), 'imperial');
    expect(t.message).toMatch(/45 lb/);
  });
  it('some sets short of the top -> hold and chase reps', () => {
    const t = suggestNext(entry({ sets: [{ reps: 10, weightKg: 20 }, { reps: 9, weightKg: 20 }, { reps: 8, weightKg: 20 }] }), item());
    expect(t).toMatchObject({ action: 'hold', weightKg: 20 });
  });
  it('reps far below the minimum, or RPE well above target -> back off about 10%', () => {
    const low = suggestNext(entry({ sets: [{ reps: 5, weightKg: 20 }, { reps: 4, weightKg: 20 }] }), item());
    expect(low.action).toBe('reduce');
    expect(low.weightKg).toBeLessThan(20);
    const hard = suggestNext(entry({ rpe: 10 }), item());
    expect(hard.action).toBe('reduce');
  });
  it('does not add weight when top reps were reached but it felt too hard', () => {
    expect(suggestNext(entry({ rpe: 9.5 }), item({ target_rpe: 7 })).action).not.toBe('increase');
  });
  it('bodyweight work progresses by reps, never invents a load', () => {
    const bw = entry({ sets: [{ reps: 10, weightKg: 0 }, { reps: 10, weightKg: 0 }] });
    expect(suggestNext(bw, item())).toMatchObject({ action: 'reps', weightKg: null });
  });
});

describe('prompt summaries', () => {
  it('summarises only the latest session per exercise, in the user\'s unit', () => {
    const logs = [entry({ ts: Date.now() }), entry({ id: 'older', ts: Date.now() - 5 * 86400000, sets: [{ reps: 8, weightKg: 10 }] })];
    expect(lastSession(logs, 'goblet_squat').id).toBe('a');
    const text = summarizeLogsForPrompt(logs, 'metric');
    expect(text.split('\n')).toHaveLength(1);
    expect(text).toMatch(/Goblet Squat: 10x20, 10x20, 10x20 kg/);
    expect(summarizeLogsForPrompt([], 'metric')).toBe('');
  });
  it('logStats counts distinct training days', () => {
    expect(logStats([entry(), entry({ id: 'b' })]).sessions).toBe(1);
  });
});
